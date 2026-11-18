import { PLAYER_NAMES } from './board';
import { analyzeMoves } from './ai/search';
import { resolveAiStrength } from './ai/levels';
import type { AiAnalysis } from './ai/search';
import { applyMove, createInitialState } from './rules';
import type { AiStrength, GameConfig, GameEvent, GameState, Move } from './types';

export interface ReplayFrame {
  state: GameState;
  label: string;
}

export interface SessionSnapshot {
  state: GameState;
  status: 'running' | 'paused' | 'finished';
  speed: number;
  log: GameEvent[];
  ai: AiAnalysis | null;
  lastMove: Move | null;
  frames: ReplayFrame[];
  replayIndex: number | null;
}

/** 驱动自动对弈与可选的人类席位；规则与 AI 决策完全复用纯引擎。 */
export class GameSession {
  private readonly config: GameConfig & { aiStrength: AiStrength };
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /**
   * 保存本局配置并生成开局分析，后续回合沿用同一算法强度。
   * @param config 人数、种子、真人席位、规则与可选 AI 档位
   * @returns 供界面订阅和推进的会话实例
   */
  constructor(config: GameConfig) {
    const strength = resolveAiStrength(config.aiStrength);
    const state = createInitialState(config.playerCount, config.seed, config.rules);
    // 会话保存独立配置，外部表单变化不会改变重开的规则和强度。
    this.config = { ...config, aiStrength: strength, rules: { ...state.rules } };
    this.snapshot = {
      state, status: 'running', speed: 1, log: [], ai: analyzeMoves(state, { strength: this.config.aiStrength }),
      lastMove: null, frames: [{ state, label: '开局 · 珠宝交易所' }], replayIndex: null,
    };
  }

  /** React useSyncExternalStore 的稳定订阅函数。 */
  subscribe = (notify: () => void): (() => void) => {
    this.listeners.add(notify);
    return () => this.listeners.delete(notify);
  };

  /** React useSyncExternalStore 的稳定快照读取函数。 */
  getSnapshot = (): SessionSnapshot => this.snapshot;

  private publish(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private queue(): void {
    this.clearTimer();
    const { state, status, replayIndex, speed } = this.snapshot;
    if (this.disposed || status !== 'running' || replayIndex !== null ||
        state.phase !== 'playing' || state.current === this.config.humanSeat) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.stepAi();
    }, Math.max(60, this.config.turnDelayMs / speed));
  }

  private commit(move: Move): void {
    const { state, events } = applyMove(this.snapshot.state, move);
    const status = state.phase === 'finished' ? 'finished' : this.snapshot.status;
    const labels = events.map((event) => event.text).join(' · ');
    this.publish({
      state, status, lastMove: move,
      log: [...events, ...this.snapshot.log].slice(0, 180),
      frames: [...this.snapshot.frames, { state, label: PLAYER_NAMES[(state.current + state.players.length - 1) % state.players.length] + ' · ' + labels }],
      ai: state.phase === 'playing' ? analyzeMoves(state, { strength: this.config.aiStrength }) : null,
    });
    this.queue();
  }

  private stepAi(): void {
    const { state, ai } = this.snapshot;
    if (state.phase !== 'playing' || state.current === this.config.humanSeat) return;
    // playing 快照已经为当前局面完成分析，执行时复用，避免每手搜索两遍。
    this.commit(ai!.chosen);
  }

  /** 开始运行 AI 时间轴。 */
  start(): void { this.queue(); }

  /** 暂停 / 恢复；真人对局的点击操作独立于计时器。 */
  toggle(): void {
    if (this.snapshot.status === 'finished') return;
    this.publish({ status: this.snapshot.status === 'running' ? 'paused' : 'running' });
    this.queue();
  }

  /** 暂停状态下只执行一手 AI，不推进额外回合。 */
  stepOnce(): void {
    this.clearTimer();
    if (this.snapshot.status === 'finished' || this.snapshot.replayIndex !== null) return;
    this.publish({ status: 'paused' });
    this.stepAi();
  }

  /** 设置自动演示速度。 */
  setSpeed(speed: number): void {
    this.publish({ speed });
    this.queue();
  }

  /** 真人行动与 AI 使用同一套合法规则；未轮到真人时拒绝。 */
  humanMove(move: Move): void {
    if (this.snapshot.state.current !== this.config.humanSeat ||
        this.snapshot.state.phase !== 'playing' || this.snapshot.replayIndex !== null) return;
    this.commit(move);
  }

  /**
   * 按创建会话时的种子、规则和 AI 强度重开。
   * @returns 无返回值；发布新的开局快照并恢复自动调度
   */
  restart(): void {
    this.clearTimer();
    const state = createInitialState(this.config.playerCount, this.config.seed, this.config.rules);
    this.publish({
      state, status: 'running', lastMove: null, log: [], ai: analyzeMoves(state, { strength: this.config.aiStrength }),
      frames: [{ state, label: '开局 · 珠宝交易所' }], replayIndex: null,
    });
    this.queue();
  }

  /** 打开回放；保留未来需要恢复的最新现场。 */
  openReplay(): void {
    this.clearTimer();
    this.publish({ status: this.snapshot.status === 'finished' ? 'finished' : 'paused', replayIndex: this.snapshot.frames.length - 1 });
  }

  /** 选取历史帧，仅影响可视层，不修改真实对局。 */
  setReplayIndex(index: number): void {
    if (this.snapshot.replayIndex === null) return;
    const last = this.snapshot.frames.length - 1;
    this.publish({ replayIndex: Math.min(last, Math.max(0, index)) });
  }

  /** 退出回放，恢复可操作的最新局面。 */
  closeReplay(): void {
    this.publish({ replayIndex: null });
    this.queue();
  }

  /** 卸载时释放计时器与全部订阅者。 */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }
}
