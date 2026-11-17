import { CAMEL_META, FINISH_INDEX, SEAT_META } from './board';
import type { Seat } from './board';
import { chooseMove } from './ai/search';
import type { EvaluationBreakdown } from './ai/evaluate';
import { applyMove, cloneState, createInitialState, drawRollOutcome } from './rules';
import { createRng } from './rng';
import type { GameConfig, GameState, Move, MoveStep, RollOutcome } from './types';

/** 日志色调，决定前端配色 */
export type LogTone =
  | 'info'
  | 'bet'
  | 'tile'
  | 'dice'
  | 'move'
  | 'trigger'
  | 'score'
  | 'win';

/** 会话运行状态 */
export type SessionStatus = 'running' | 'paused' | 'finished';

/** 回合呈现阶段，用于界面提示 */
export type TurnPhase = 'idle' | 'thinking' | 'acting' | 'finished';

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

/** 回放帧：每次行动后保存一份完整局面快照 */
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
  legBet: 0.5,
  desert: 0.6,
  pyramid: 0.45,
  dieRoll: 0.7,
  camelMove: 0.8,
  desertTrigger: 0.75,
  legScore: 0.5,
  legReset: 0.5,
  raceBet: 0.5,
  raceScore: 0.55,
} as const;

/** 骆驼名的简短展示（日志用） */
function camelName(color: number): string {
  return CAMEL_META[color].name;
}

/**
 * 自动对局会话：驱动 AI 决策 → 行动呈现 → 腿末/终局结算的完整流程
 *
 * 该类不依赖 React，通过 subscribe/getSnapshot 暴露给界面，
 * 既可以在浏览器中播放，也可以在测试中无界面推进。
 */
export class GameSession {
  readonly config: GameConfig;

  private state: GameState;
  private readonly rng: () => number;
  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
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
  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private speed = 1;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot;
  private disposed = false;
  private finishedNotified = false;
  /** 待记帧的行动结果，帧在行动步骤播完后统一落盘 */
  private pendingMove: { state: GameState; label: string } | null = null;

  constructor(
    config: GameConfig,
    private readonly onFinish?: (seats: Seat[], winner: Seat | null) => void,
  ) {
    this.config = config;
    this.rng = createRng(config.seed);
    this.state = createInitialState(config.seats, this.rng, config.startCoins);
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

  /** 单步推进一个呈现步骤（思考、押注、掷骰或结算） */
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
    this.state = createInitialState(this.config.seats, this.rng, this.config.startCoins);
    this.queue = [];
    this.status = 'running';
    this.phase = 'idle';
    this.activeStep = null;
    this.ai = null;
    this.pendingMove = null;
    this.finishedNotified = false;
    this.actingPlayer = this.state.current;
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
    this.replayTimer = globalThis.setTimeout(() => {
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
      globalThis.clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 是否已结束（以方法调用规避 TS 对 status 的类型收窄） */
  private isFinished(): boolean {
    return this.status === 'finished';
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = globalThis.setTimeout(() => this.tick(), delay);
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

  /** 生成一个完整行动的呈现队列（思考、行动步骤与落帧） */
  private beginTurn(): void {
    const player = this.state.current;
    this.actingPlayer = player;
    this.activeStep = null;

    const decision = chooseMove(this.state, {
      depth: this.config.aiDepth,
      // 界面预算允许较深搜索；时间用尽时采用上一完整迭代的决定。
      budgetMs: 200,
      nodeBudget: 120_000,
    });
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

    // 掷骰结果由会话随机源现场摇出，再交规则核心结算（随机只经 createRng）
    const outcome: RollOutcome | undefined =
      decision.move.kind === 'roll' ? drawRollOutcome(this.state, this.rng) : undefined;
    const result = applyMove(this.state, decision.move, outcome);
    this.queue.push({ kind: 'think', decision: view });
    for (const step of result.steps) {
      this.queue.push({ kind: 'step', step });
    }
    const seatName = SEAT_META[this.state.seats[player]].name;
    this.pendingMove = { state: result.state, label: `第 ${this.state.leg} 腿 · ${seatName}` };
    this.queue.push({ kind: 'frame', label: `第 ${this.state.leg} 腿 · ${seatName}` });
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
        const ratio = DELAY_RATIO[step.kind] ?? 0.5;
        return Math.max(70, (base * ratio) / speed);
      }
      case 'frame': {
        if (this.pendingMove) {
          // 动画快照停在各事件发生时，回合轮转与终局标记以最终规则结果为准。
          this.state = this.pendingMove.state;
          this.recordFrame(this.pendingMove.label);
          this.pendingMove = null;
        }
        if (this.state.phase === 'gameEnd') {
          const winnerSeat = this.state.winner;
          const winnerText =
            winnerSeat === null
              ? `最高 ${this.topCoins()} EP`
              : `${SEAT_META[winnerSeat].name} 以 ${this.topCoins()} EP 获胜`;
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
      case 'legBet':
        this.pushLog(step.player, `押注${camelName(step.color)}腿部，拿下 ${step.value} EP 金币片`, 'bet');
        break;
      case 'desert': {
        const side = step.face === 'oasis' ? '绿洲' : '海市蜃楼';
        this.pushLog(step.player, `放置地形块至第 ${step.pos + 1} 格（${side}面朝上）`, 'tile');
        break;
      }
      case 'pyramid':
        this.pushLog(step.player, '取走一张金字塔金币片', 'dice');
        break;
      case 'dieRoll':
        this.pushLog(step.player, `摇出${camelName(step.color)}骰：${step.value} 点`, 'dice');
        break;
      case 'camelMove': {
        const carriedText = step.carried.length > 0
          ? `，背负${step.carried.map((color) => camelName(color)).join('、')}`
          : '';
        const destText = step.to >= FINISH_INDEX ? '越过终点线' : `第 ${step.to + 1} 格`;
        this.pushLog(step.player, `${camelName(step.color)}前进至${destText}${carriedText}`, 'move');
        break;
      }
      case 'desertTrigger': {
        const side = step.face === 'oasis' ? '绿洲前进一格' : '海市蜃楼后退一格';
        const ownerName = SEAT_META[this.state.seats[step.owner]].name;
        this.pushLog(
          step.player,
          `${camelName(step.color)}触发${ownerName}的地形块：${side}，${ownerName} +${step.gained} EP`,
          'trigger',
        );
        break;
      }
      case 'legScore':
        this.pushLog(
          step.player,
          `腿部结算：押注 ${step.tickets >= 0 ? '+' : ''}${step.tickets} · 金币片 +${step.pyramid}（净 ${step.gained >= 0 ? '+' : ''}${step.gained}）`,
          'score',
        );
        break;
      case 'legReset':
        this.pushLog(step.player, `第 ${step.leg} 腿开始`, 'info');
        break;
      case 'raceBet': {
        const targetText = step.target === 'winner' ? '总冠' : '总末名';
        this.pushLog(step.player, `押注${targetText}：${camelName(step.color)}明牌入堆`, 'bet');
        break;
      }
      case 'raceScore': {
        const targetText = step.target === 'winner' ? '总冠' : '总末名';
        const resultText = step.correct ? '命中' : '未中';
        this.pushLog(
          step.player,
          `终局${targetText}结算：${camelName(step.color)}${resultText} ${step.gained >= 0 ? '+' : ''}${step.gained} EP`,
          'score',
        );
        break;
      }
      default:
        break;
    }
  }

  /** 当前最高金币（用于胜利日志） */
  private topCoins(): number {
    return Math.max(...this.state.players.map((player) => player.coins));
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
      turn: this.state.leg,
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
