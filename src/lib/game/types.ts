import type { Seat } from './board';

/**
 * 飞机位置编码：
 * -1     停在机库
 * 0..51  环形跑道上的相对步数（相对本座位起点）
 * 52..56 终点跑道（由外向内）
 * 57     已归位
 */
export type PlanePos = number;

/** 相对步数常量 */
export const TRACK_LAST = 51;
export const HOME_FIRST = 52;
export const FINISH = 57;
export const PLANES_PER_PLAYER = 4;

/** 单局配置 */
export interface GameConfig {
  /** 参与座位（2-4 个，按座位号升序） */
  seats: Seat[];
  /** 每轮基础停顿（毫秒） */
  turnDelayMs: number;
  /** AI 向前搜索的掷骰次数 */
  aiDepth: number;
  /** 随机种子 */
  seed: number;
}

/** 一局游戏的完整状态（所有变更返回新对象） */
export interface GameState {
  seats: Seat[];
  /** planes[玩家序号][飞机序号] = PlanePos */
  planes: PlanePos[][];
  /** 当前行动玩家序号（对应 seats 下标） */
  current: number;
  /** 当前玩家已连续掷出 6 的次数 */
  sixStreak: number;
  /** 累计掷骰次数 */
  rolls: number;
  /** 已全部归位的玩家（按完成顺序） */
  finishedOrder: Seat[];
  /** 获胜座位，未结束为 null */
  winner: Seat | null;
}

export type MoveKind = 'launch' | 'advance';

/** 一次选子决策 */
export interface Move {
  kind: MoveKind;
  /** 飞机序号 0-3 */
  plane: number;
}

export type StepKind = 'launch' | 'walk' | 'jump' | 'fly' | 'home' | 'finish';

/** 飞机被踩回机库的引用 */
export interface CaptureRef {
  player: number;
  plane: number;
}

/** 单段移动（用于逐段动画） */
export interface MoveStep {
  plane: number;
  from: PlanePos;
  to: PlanePos;
  kind: StepKind;
  captures: CaptureRef[];
  /** 落点对应的跑道绝对索引，终点跑道内为 null */
  trackIndex: number | null;
}

/** 一次移动的结算结果 */
export interface MoveResult {
  state: GameState;
  steps: MoveStep[];
  /** 是否因连续三次掷出 6 而终止追加回合 */
  sixLimit: boolean;
}
