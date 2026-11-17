import { SEAT_META, TILE_META } from './board';
import type { Seat } from './board';
import { chooseMove } from './ai/search';
import type { EvaluationBreakdown } from './ai/evaluate';
import { applyMove, cloneState, createInitialState, startNextRound } from './rules';
import { createRng } from './rng';
import type { GameConfig, GameState, Move, MoveStep } from './types';

/** 日志色调，决定前端配色 */
export type LogTone =
  | 'info'
  | 'pick'
  | 'place'
  | 'discard'
  | 'marker'
  | 'wall'
  | 'penalty'
  | 'roundEnd'
  | 'win';

/** 会话运行状态 */
export type SessionStatus = 'running' | 'paused' | 'finished';

/** 回合呈现阶段，用于界面提示 */
export type TurnPhase = 'idle' | 'thinking' | 'acting' | 'roundEnd' | 'finished';

/** AI 候选走法的展示数据 */
export interface AiCandidateView {
  move: Move;
  value: number;
  breakdown: EvaluationBreakdown;
  chosen: boolean;
}

/** AI 本轮决策的展示数据 */
export interface AiDecisionView {
  player: number;
  candidates: AiCandidateView[];
  nodes: number;
  ms: number;
  depth: number;
}

export interface LogEntry {
  id: number;
  turn: number;
  player: number;
  text: string;
  tone: LogTone;
}

/** 回放帧：每次行动或开轮后保存一份完整局面快照 */
export interface ReplayFrame {
  index: number;
  state: GameState;
  label: string;
}

/** 供 React 渲染的只读快照 */
export interface SessionSnapshot {
  config: GameConfig;
  state: GameState;
  status: SessionStatus;
  phase: TurnPhase;
  /** 当前行动玩家序号 */
  actingPlayer: number;
  /** 正在呈现的步骤，UI 据此高亮棋盘元素 */
  activeStep: MoveStep | null;
  ai: AiDecisionView | null;
  log: LogEntry[];
  frames: ReplayFrame[];
  replayIndex: number | null;
  replayPlaying: boolean;
  speed: number;
}

interface QueueItem {
  kind: 'think' | 'step' | 'frame';
  step?: MoveStep;
  decision?: AiDecisionView;
  label?: string;
}

const MAX_LOG = 320;
const MAX_FRAMES = 600;
/** AI 面板最多展示的候选条数（决策内部保留完整列表） */
const MAX_SHOWN_CANDIDATES = 8;

/** 各呈现步骤相对基础停顿的时长比例 */
const DELAY_RATIO = {
  think: 0.9,
  pick: 0.55,
  marker: 0.4,
  place: 0.55,
  discard: 0.5,
  wall: 0.6,
  penalty: 0.45,
  scoring: 0.7,
  refill: 0.55,
} as const;

/**
 * 自动对局会话：驱动 AI 选子 → 拿砖放置 → 轮末结算 → 开新轮的完整流程
 *
 * 该类不依赖 React，通过 subscribe/getSnapshot 暴露给界面，
 * 既可以在浏览器中播放，也可以在测试中无界面推进。
 */
export class GameSession {
  readonly config: GameConfig;

  private state: GameState;
  private readonly rng: () => number;
  private queue: QueueItem[] = [];
  private timer: number | null = null;
  private status: SessionStatus = 'running';
  private phase: TurnPhase = 'idle';
  private actingPlayer = 0;
  private activeStep: MoveStep | null = null;
  private ai: AiDecisionView | null = null;
  private log: LogEntry[] = [];
  private logSeq = 0;
  private frames: ReplayFrame[] = [];
  private replayIndex: number | null = null;
  private replayPlaying = false;
  private replayTimer: number | null = null;
  private speed = 1;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot;
  private disposed = false;
  private finishedNotified = false;
  /** 待记帧的行动结果，帧在行动步骤播完后统一落盘 */
  private pendingMove: { state: GameState } | null = null;

  constructor(
    config: GameConfig,
    private readonly onFinish?: (seats: Seat[], winner: Seat | null) => void,
  ) {
    this.config = config;
    this.rng = createRng(config.seed);
    this.state = createInitialState(config.seats, this.rng);
    this.frames.push(this.captureFrame('开局'));
    this.snapshot = this.buildSnapshot();
    this.log.push({
      id: ++this.logSeq,
      turn: 0,
      player: 0,
      text: `对局开始：${config.seats.map((s) => SEAT_META[s].name).join(' / ')}，每步停顿 ${config.turnDelayMs}ms`,
      tone: 'info',
    });
  }

  /** 订阅快照变化 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 读取当前快照（引用稳定，变更时才重建） */
  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  /** 开始播放 */
  start(): void {
    if (this.status === 'finished') return;
    this.status = 'running';
    this.schedule(0);
    this.notify();
  }

  /** 暂停 */
  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.clearTimer();
    this.notify();
  }

  /** 继续 */
  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.schedule(0);
    this.notify();
  }

  /** 暂停/继续切换 */
  toggle(): void {
    if (this.status === 'running') this.pause();
    else if (this.status === 'paused') this.resume();
  }

  /** 单步推进一个呈现步骤（思考、拿砖、放置或轮末结算） */
  stepOnce(): void {
    if (this.status === 'finished') return;
    this.clearTimer();
    this.status = 'paused';
    if (this.queue.length === 0) this.beginTurn();
    const item = this.queue.shift();
    if (item) this.applyItem(item);
    this.notify();
  }

  /** 设置播放倍速 */
  setSpeed(speed: number): void {
    this.speed = Math.min(8, Math.max(0.25, speed));
    this.notify();
  }

  /** 重开一局：续用同一随机源，保证同种子对局可复现 */
  restart(): void {
    this.clearTimer();
    this.clearReplayTimer();
    this.state = createInitialState(this.config.seats, this.rng);
    this.queue = [];
    this.status = 'running';
    this.phase = 'idle';
    this.activeStep = null;
    this.ai = null;
    this.log = [];
    this.frames = [this.captureFrame('开局')];
    this.replayIndex = null;
    this.replayPlaying = false;
    this.logSeq = 0;
    this.pushLog(0, `新对局开始：${this.config.seats.map((s) => SEAT_META[s].name).join(' / ')}`, 'info');
    this.schedule(0);
    this.notify();
  }

  /** 进入回放模式 */
  openReplay(): void {
    if (this.frames.length < 2) return;
    this.pause();
    this.replayIndex = 0;
    this.replayPlaying = false;
    this.notify();
  }

  /** 退出回放 */
  closeReplay(): void {
    this.clearReplayTimer();
    this.replayIndex = null;
    this.replayPlaying = false;
    this.notify();
  }

  /** 拖动回放进度 */
  setReplayIndex(index: number): void {
    if (this.replayIndex === null) return;
    this.replayIndex = Math.min(this.frames.length - 1, Math.max(0, index));
    this.notify();
  }

  /** 回放自动播放/暂停 */
  toggleReplayPlay(): void {
    if (this.replayIndex === null) return;
    if (this.replayPlaying) {
      this.clearReplayTimer();
      this.replayPlaying = false;
      this.notify();
      return;
    }
    if (this.replayIndex >= this.frames.length - 1) this.replayIndex = 0;
    this.replayPlaying = true;
    this.runReplayTick();
    this.notify();
  }

  /** 释放定时器与监听 */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.clearReplayTimer();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- 内部实现

  private runReplayTick(): void {
    this.clearReplayTimer();
    this.replayTimer = window.setTimeout(() => {
      if (!this.replayPlaying || this.replayIndex === null) return;
      if (this.replayIndex >= this.frames.length - 1) {
        this.replayPlaying = false;
        this.notify();
        return;
      }
      this.replayIndex += 1;
      this.notify();
      this.runReplayTick();
    }, Math.max(120, 700 / this.speed));
  }

  private clearReplayTimer(): void {
    if (this.replayTimer !== null) {
      window.clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 是否已结束（以方法调用规避 TS 对 status 的类型收窄） */
  private isFinished(): boolean {
    return this.status === 'finished';
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => this.tick(), delay);
  }

  private tick(): void {
    this.timer = null;
    if (this.disposed || this.status !== 'running') return;

    if (this.queue.length === 0) {
      if (this.state.phase === 'gameEnd') {
        this.finishGame();
        return;
      }
      this.beginTurn();
    }

    const item = this.queue.shift();
    if (!item) return;
    const delay = this.applyItem(item);
    if (this.isFinished()) {
      this.notify();
      return;
    }
    this.notify();
    this.schedule(delay);
  }

  /** 生成一个完整行动的呈现队列（思考、拿砖放置、轮末结算与补盘） */
  private beginTurn(): void {
    const player = this.state.current;
    this.actingPlayer = player;
    this.activeStep = null;

    const decision = chooseMove(this.state, {
      depth: this.config.aiDepth,
      // 实测深度 2 完整搜索约 140ms，预算放宽到 200ms 保证多数回合不被打断
      budgetMs: 200,
      nodeBudget: 120_000,
    });
    // placing 阶段始终存在兜底行动；无决策只可能出现在终局，由 tick 上游拦截
    if (!decision) {
      this.finishGame();
      return;
    }

    const view: AiDecisionView = {
      player,
      candidates: decision.candidates.slice(0, MAX_SHOWN_CANDIDATES).map((candidate) => ({
        move: candidate.move,
        value: candidate.value,
        breakdown: candidate.breakdown,
        chosen: candidate.move === decision.move,
      })),
      nodes: decision.nodes,
      ms: decision.ms,
      depth: decision.depth,
    };

    const result = applyMove(this.state, decision.move);
    this.queue.push({ kind: 'think', decision: view });
    for (const step of result.steps) {
      this.queue.push({ kind: 'step', step });
    }
    if (result.state.phase === 'roundEnd') {
      // 轮末已随行动自动结算；此处补上开新轮的补盘呈现
      const next = startNextRound(result.state, this.rng);
      this.queue.push({
        kind: 'step',
        step: { kind: 'refill', player: next.current, after: next },
      });
    }
    const seatName = SEAT_META[this.state.seats[player]].name;
    this.pendingMove = { state: result.state };
    this.queue.push({ kind: 'frame', label: `第 ${result.state.round} 轮 · ${seatName} 拿砖` });
  }

  /** 应用一个呈现步骤并返回该步骤的停顿时间 */
  private applyItem(item: QueueItem): number {
    const base = this.config.turnDelayMs;
    const speed = this.speed;

    switch (item.kind) {
      case 'think': {
        this.phase = 'thinking';
        this.ai = item.decision ?? null;
        return Math.max(60, (base * DELAY_RATIO.think) / speed);
      }
      case 'step': {
        const step = item.step;
        if (!step) return 0;
        this.phase = 'acting';
        this.activeStep = step;
        this.state = step.after;
        this.logStep(step);
        if (step.kind === 'refill') {
          this.actingPlayer = step.player;
          this.activeStep = null;
        }
        const ratio = DELAY_RATIO[step.kind] ?? 0.5;
        return Math.max(70, (base * ratio) / speed);
      }
      case 'frame': {
        if (this.pendingMove) {
          this.recordFrame(item.label ?? `第 ${this.state.round} 轮`);
          this.pendingMove = null;
        }
        if (this.state.phase === 'gameEnd') {
          const winnerSeat = this.state.winner;
          const winnerText =
            winnerSeat === null
              ? `${this.topScore()} 分`
              : `${SEAT_META[winnerSeat].name} 以 ${this.topScore()} 分获胜`;
          this.pushLog(this.actingPlayer, winnerText, 'win');
          this.finishGame();
          return 0;
        }
        return Math.max(40, (base * 0.2) / speed);
      }
      default:
        return 0;
    }
  }

  private logStep(step: MoveStep): void {
    switch (step.kind) {
      case 'pick': {
        const sourceName = step.source < this.state.factoryCount ? `工厂盘 ${step.source + 1}` : '中央区';
        const suffix = step.toCenter > 0 ? `，余 ${step.toCenter} 块入中央` : '';
        this.pushLog(step.player, `从${sourceName}拿走 ${step.count} 块${TILE_META[step.color].name}砖${suffix}`, 'pick');
        break;
      }
      case 'marker':
        this.pushLog(step.player, '拿下首玩家标记，下轮先手', 'marker');
        break;
      case 'place': {
        const overflowText = step.overflow > 0 ? `，${step.overflow} 块溢入地板` : '';
        this.pushLog(
          step.player,
          `${step.kept} 块${TILE_META[step.color].name}砖放入第 ${step.row + 1} 行${overflowText}`,
          'place',
        );
        break;
      }
      case 'discard':
        this.pushLog(step.player, `${step.count} 块${TILE_META[step.color].name}砖弃入地板`, 'discard');
        break;
      case 'wall':
        this.pushLog(
          step.player,
          `${TILE_META[step.color].name}砖上墙（${step.row + 1} 行 ${step.col + 1} 列）+${step.gained} 分`,
          'wall',
        );
        break;
      case 'penalty':
        this.pushLog(step.player, `地板结算扣 ${Math.abs(step.penalty)} 分`, 'penalty');
        break;
      case 'scoring':
        this.pushLog(
          step.player,
          `终局加分 +${step.gained}（满行 ${step.rows} · 满列 ${step.cols} · 色齐全 ${step.colors}）`,
          'wall',
        );
        break;
      case 'refill':
        this.pushLog(step.player, `第 ${this.state.round} 轮开始`, 'roundEnd');
        break;
      default:
        break;
    }
  }

  /** 当前最高分（用于胜利日志） */
  private topScore(): number {
    return Math.max(...this.state.players.map((board) => board.score));
  }

  private finishGame(): void {
    this.status = 'finished';
    this.phase = 'finished';
    this.clearTimer();
    this.queue = [];
    if (!this.finishedNotified) {
      this.finishedNotified = true;
      this.onFinish?.(this.config.seats, this.state.winner);
    }
    this.notify();
  }

  private recordFrame(label: string): void {
    if (this.frames.length >= MAX_FRAMES) return;
    this.frames.push(this.captureFrame(label));
  }

  private captureFrame(label: string): ReplayFrame {
    return {
      index: this.frames.length,
      state: cloneState(this.state),
      label,
    };
  }

  private pushLog(player: number, text: string, tone: LogTone): void {
    this.log.push({
      id: ++this.logSeq,
      turn: this.state.round,
      player,
      text: `${SEAT_META[this.state.seats[player]].name} · ${text}`,
      tone,
    });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private notify(): void {
    if (this.disposed) return;
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private buildSnapshot(): SessionSnapshot {
    return {
      config: this.config,
      state: this.state,
      status: this.status,
      phase: this.phase,
      actingPlayer: this.actingPlayer,
      activeStep: this.activeStep,
      ai: this.ai,
      log: this.log,
      frames: this.frames,
      replayIndex: this.replayIndex,
      replayPlaying: this.replayPlaying,
      speed: this.speed,
    };
  }
}
