import { SEAT_META } from './board';
import { chooseMove } from './ai/expectimax';
import type { EvaluationBreakdown } from './ai/evaluate';
import { applyMove, createInitialState, getLegalMoves, passTurn } from './rules';
import { createRng, rollDice } from './rng';
import { HOME_FIRST } from './types';
import type { GameConfig, GameState, MoveStep, PlanePos } from './types';

/** 日志色调，决定前端配色 */
export type LogTone =
  | 'info'
  | 'roll'
  | 'move'
  | 'jump'
  | 'fly'
  | 'capture'
  | 'finish'
  | 'win'
  | 'skip';

/** 会话运行状态 */
export type SessionStatus = 'running' | 'paused' | 'finished';

/** 回合呈现阶段，用于界面提示 */
export type TurnPhase = 'idle' | 'rolling' | 'thinking' | 'moving' | 'settling' | 'finished';

/** 骰子展示数据 */
export interface DiceView {
  value: number;
  player: number;
  /** 每次掷骰递增，用于触发滚动动画 */
  seq: number;
}

/** AI 候选走法的展示数据 */
export interface AiCandidateView {
  plane: number;
  kind: 'launch' | 'advance';
  value: number;
  breakdown: EvaluationBreakdown;
  chosen: boolean;
}

/** AI 本轮决策的展示数据 */
export interface AiDecisionView {
  player: number;
  dice: number;
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

/** 回放帧：每次回合结束后保存一次棋盘快照 */
export interface ReplayFrame {
  index: number;
  planes: PlanePos[][];
  current: number;
  dice: number | null;
  rolls: number;
  label: string;
}

/** 供 React 渲染的只读快照 */
export interface SessionSnapshot {
  config: GameConfig;
  state: GameState;
  status: SessionStatus;
  phase: TurnPhase;
  dice: DiceView | null;
  actingPlayer: number;
  activePlane: number | null;
  ai: AiDecisionView | null;
  log: LogEntry[];
  frames: ReplayFrame[];
  replayIndex: number | null;
  replayPlaying: boolean;
  speed: number;
}

interface QueueItem {
  kind: 'roll' | 'think' | 'step' | 'settle' | 'skip';
  dice?: number;
  player?: number;
  decision?: AiDecisionView;
  step?: MoveStep;
  finalState?: GameState;
  sixLimit?: boolean;
}

const MAX_LOG = 320;
const MAX_FRAMES = 900;

/** 各呈现步骤相对基础停顿的时长比例 */
const DELAY_RATIO = {
  roll: 0.5,
  think: 0.55,
  launch: 0.6,
  walk: 0.62,
  jump: 0.8,
  fly: 0.95,
  home: 0.55,
  finish: 0.8,
  settle: 0.34,
  skip: 0.45,
} as const;

/**
 * 自动对局会话：驱动掷骰 → AI 选子 → 逐段移动 → 回合结算的完整流程
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
  private dice: DiceView | null = null;
  private diceSeq = 0;
  private actingPlayer = 0;
  private activePlane: number | null = null;
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

  constructor(
    config: GameConfig,
    private readonly onFinish?: (seats: GameState['seats'], winner: GameState['winner']) => void,
  ) {
    this.config = config;
    this.rng = createRng(config.seed);
    this.state = createInitialState(config.seats);
    this.frames.push(this.captureFrame('开局'));
    this.snapshot = this.buildSnapshot();
    this.log.push({
      id: ++this.logSeq,
      turn: 0,
      player: 0,
      text: `对局开始：${config.seats.map((s) => SEAT_META[s].name).join(' / ')}，每轮停顿 ${config.turnDelayMs}ms`,
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

  /** 单步推进一个呈现步骤（掷骰、思考、一段移动或结算） */
  stepOnce(): void {
    if (this.status === 'finished') return;
    this.clearTimer();
    this.status = 'paused';
    if (this.queue.length === 0) {
      this.beginTurn();
    }
    const item = this.queue.shift();
    if (item) this.applyItem(item);
    this.notify();
  }

  /** 设置播放倍速 */
  setSpeed(speed: number): void {
    this.speed = Math.min(8, Math.max(0.25, speed));
    this.notify();
  }

  /** 重开一局（换一个随机种子） */
  restart(): void {
    this.clearTimer();
    this.clearReplayTimer();
    this.state = createInitialState(this.config.seats);
    this.queue = [];
    this.status = 'running';
    this.phase = 'idle';
    this.dice = null;
    this.ai = null;
    this.activePlane = null;
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
      if (this.state.winner !== null) {
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

  /** 生成一个完整回合的呈现队列（掷骰、思考、移动、结算） */
  private beginTurn(): void {
    const player = this.state.current;
    const dice = rollDice(this.rng);
    this.actingPlayer = player;
    this.activePlane = null;
    this.dice = { value: dice, player, seq: ++this.diceSeq };
    this.phase = 'rolling';

    const moves = getLegalMoves(this.state, dice);
    if (moves.length === 0) {
      this.queue.push({ kind: 'roll', dice, player }, { kind: 'skip', player, dice });
      return;
    }

    const decision = chooseMove(this.state, dice, {
      depth: this.config.aiDepth,
      budgetMs: 90,
      nodeBudget: 80_000,
    });
    if (!decision) {
      this.queue.push({ kind: 'roll', dice, player }, { kind: 'skip', player, dice });
      return;
    }

    const view: AiDecisionView = {
      player,
      dice,
      candidates: decision.candidates.map((candidate) => ({
        plane: candidate.move.plane,
        kind: candidate.move.kind,
        value: candidate.value,
        breakdown: candidate.breakdown,
        chosen: candidate.move.plane === decision.move.plane && candidate.move.kind === decision.move.kind,
      })),
      nodes: decision.nodes,
      ms: decision.ms,
      depth: decision.depth,
    };

    const result = applyMove(this.state, decision.move, dice);
    this.queue.push({ kind: 'roll', dice, player });
    this.queue.push({ kind: 'think', decision: view });
    for (const step of result.steps) {
      this.queue.push({ kind: 'step', step });
    }
    this.queue.push({ kind: 'settle', dice, player, finalState: result.state, sixLimit: result.sixLimit });
  }

  /** 应用一个呈现步骤并返回该步骤的停顿时间 */
  private applyItem(item: QueueItem): number {
    const base = this.config.turnDelayMs;
    const speed = this.speed;

    switch (item.kind) {
      case 'roll': {
        this.phase = 'rolling';
        this.dice = { value: item.dice ?? 0, player: item.player ?? 0, seq: ++this.diceSeq };
        this.ai = null;
        this.pushLog(this.actingPlayer, `掷出 ${item.dice} 点`, 'roll');
        return Math.max(60, (base * DELAY_RATIO.roll) / speed);
      }
      case 'think': {
        this.phase = 'thinking';
        this.ai = item.decision ?? null;
        return Math.max(60, (base * DELAY_RATIO.think) / speed);
      }
      case 'step': {
        const step = item.step;
        if (!step) return 0;
        this.phase = 'moving';
        this.activePlane = step.plane;
        this.state.planes[this.actingPlayer][step.plane] = step.to;
        for (const victim of step.captures) {
          this.state.planes[victim.player][victim.plane] = -1;
        }
        this.logStep(step);
        const ratio = DELAY_RATIO[step.kind] ?? 0.6;
        return Math.max(70, (base * ratio) / speed);
      }
      case 'settle': {
        this.phase = 'settling';
        if (item.finalState) this.state = item.finalState;
        if (item.sixLimit && this.state.winner === null) {
          this.pushLog(this.actingPlayer, '连续三次掷出 6，追加回合终止', 'skip');
        }
        if (this.state.winner !== null) {
          this.pushLog(this.actingPlayer, '四机归位，赢下本局', 'win');
        }
        this.activePlane = null;
        this.recordFrame(item.dice ?? null);
        if (this.state.winner !== null) {
          this.finishGame();
          return 0;
        }
        this.phase = 'idle';
        return Math.max(50, (base * DELAY_RATIO.settle) / speed);
      }
      case 'skip': {
        this.phase = 'settling';
        this.pushLog(this.actingPlayer, '没有可移动的飞机，跳过回合', 'skip');
        this.state = passTurn(this.state);
        this.activePlane = null;
        this.recordFrame(item.dice ?? null);
        this.phase = 'idle';
        return Math.max(50, (base * DELAY_RATIO.skip) / speed);
      }
      default:
        return 0;
    }
  }

  private logStep(step: MoveStep): void {
    const name = `${SEAT_META[this.state.seats[this.actingPlayer]].name} ${step.plane + 1} 号机`;
    switch (step.kind) {
      case 'launch':
        this.pushLog(this.actingPlayer, `${name} 起飞进入跑道`, 'move');
        break;
      case 'walk':
        this.pushLog(this.actingPlayer, `${name} 前进 ${step.to - step.from} 步`, 'move');
        break;
      case 'jump':
        this.pushLog(this.actingPlayer, `${name} 落在同色格，跳跃 +4`, 'jump');
        break;
      case 'fly':
        this.pushLog(this.actingPlayer, `${name} 触发飞行格，飞跃 +12`, 'fly');
        break;
      case 'home':
        this.pushLog(this.actingPlayer, `${name} 进入终点跑道第 ${step.to - HOME_FIRST + 1} 格`, 'move');
        break;
      case 'finish':
        this.pushLog(this.actingPlayer, `${name} 精确归位`, 'finish');
        break;
      default:
        break;
    }

    if (step.captures.length > 0) {
      const victims = step.captures
        .map((victim) => `${SEAT_META[this.state.seats[victim.player]].name} ${victim.plane + 1} 号机`)
        .join('、');
      this.pushLog(this.actingPlayer, `${name} 踩中 ${victims}，对手返回机库`, 'capture');
    }
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

  private recordFrame(dice: number | null): void {
    if (this.frames.length >= MAX_FRAMES) return;
    this.frames.push(
      this.captureFrame(`第 ${this.state.rolls} 手${dice === null ? '' : ` · ${dice} 点`}`),
    );
  }

  private captureFrame(label: string): ReplayFrame {
    return {
      index: this.frames.length,
      planes: this.state.planes.map((row) => [...row]),
      current: this.state.current,
      dice: this.dice?.value ?? null,
      rolls: this.state.rolls,
      label,
    };
  }

  private pushLog(player: number, text: string, tone: LogTone): void {
    this.log.push({
      id: ++this.logSeq,
      turn: this.state.rolls,
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
      dice: this.dice,
      actingPlayer: this.actingPlayer,
      activePlane: this.activePlane,
      ai: this.ai,
      log: this.log,
      frames: this.frames,
      replayIndex: this.replayIndex,
      replayPlaying: this.replayPlaying,
      speed: this.speed,
    };
  }
}
