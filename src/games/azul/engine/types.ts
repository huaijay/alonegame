import type { Seat } from './board';

/** 砖色编码：0 蓝 1 黄 2 红 3 黑 4 青 */
export type TileColor = 0 | 1 | 2 | 3 | 4;

/** 砖色总数 */
export const TILE_COLORS = 5;

/** 图案行 / 墙的边长 */
export const WALL_SIZE = 5;

/** 每种颜色的砖块总数 */
export const TILES_PER_COLOR = 20;

/** 每个工厂盘的容量 */
export const FACTORY_TILES = 4;

/** 地板可容纳的砖块数（首玩家标记不占格） */
export const FLOOR_LIMIT = 7;

/** 对局配置：单局引擎参数 + 界面编排参数 */
export interface GameConfig {
  /** 参与座位（2-4 个，按座位号升序） */
  seats: Seat[];
  /** 每步呈现的基础停顿（毫秒） */
  turnDelayMs: number;
  /** AI 向前搜索的玩家回合数 */
  aiDepth: number;
  /** 随机种子 */
  seed: number;
  /** 轮次上限：0 表示不限（标准规则），大于 0 时该轮结算后直接终局 */
  rounds: number;
}

/** 图案行：count 为已放置砖数，color 为行内砖色（空行为 null） */
export interface PatternRow {
  color: TileColor | null;
  count: number;
}

/** 玩家板：得分、图案行、墙、地板与首玩家标记 */
export interface PlayerBoard {
  score: number;
  rows: PatternRow[];
  /** wall[row][col] = 是否已上墙 */
  wall: boolean[][];
  /** 地板上的砖（按落板顺序） */
  floor: TileColor[];
  /** 是否持有首玩家标记 */
  hasFirstMarker: boolean;
}

/** 对局阶段：放置中 / 本轮已结算待开下轮 / 终局 */
export type GamePhase = 'placing' | 'roundEnd' | 'gameEnd';

/** 一局游戏的完整状态（所有变更返回新对象） */
export interface GameState {
  seats: Seat[];
  /** 工厂盘数量（由人数决定） */
  factoryCount: number;
  /** factories[盘号] = 五色计数（长度 TILE_COLORS） */
  factories: number[][];
  /** 中央区五色计数 */
  center: number[];
  /** 中央区是否摆放着首玩家标记 */
  centerMarker: boolean;
  /** players[玩家序号] = 玩家板 */
  players: PlayerBoard[];
  /** 当前行动玩家序号（对应 seats 下标） */
  current: number;
  /** 当前轮次（从 1 开始） */
  round: number;
  /** 轮次上限：0 表示不限，达到上限的轮次结算后直接终局 */
  maxRounds: number;
  /** 袋中五色计数 */
  bag: number[];
  /** 弃堆五色计数 */
  discard: number[];
  phase: GamePhase;
  /** 获胜座位，未结束为 null */
  winner: Seat | null;
  /** 下轮先手玩家序号；null 表示尚未确定（开局由 0 号先手） */
  firstPlayer: number | null;
}

/**
 * 一次拿砖放行决策。
 * source < factoryCount 为工厂盘，等于 factoryCount 为中央区；
 * row 0-4 为图案行行号，-1 表示弃入地板。
 */
export interface Move {
  source: number;
  color: TileColor;
  row: number;
}

export type StepKind =
  | 'pick'     // 从供应拿走一整色
  | 'marker'   // 从中央拿下首玩家标记
  | 'place'    // 放入图案行
  | 'discard'  // 弃入地板
  | 'wall'     // 轮末移砖上墙
  | 'penalty'  // 轮末地板扣分
  | 'scoring'  // 终局加分
  | 'refill';  // 补盘开新轮

/** 呈现步骤联合类型：每步携带完成后的完整状态快照，供会话逐步推进 */
export type MoveStep =
  | { kind: 'pick'; player: number; source: number; color: TileColor; count: number; toCenter: number; after: GameState }
  | { kind: 'marker'; player: number; after: GameState }
  | { kind: 'place'; player: number; row: number; color: TileColor; kept: number; overflow: number; after: GameState }
  | { kind: 'discard'; player: number; color: TileColor; count: number; after: GameState }
  | { kind: 'wall'; player: number; row: number; col: number; color: TileColor; gained: number; after: GameState }
  | { kind: 'penalty'; player: number; penalty: number; after: GameState }
  | { kind: 'scoring'; player: number; rows: number; cols: number; colors: number; gained: number; after: GameState }
  | { kind: 'refill'; player: number; after: GameState };

/** 一次行动的结算结果（含轮末自动结算的全部步骤） */
export interface MoveResult {
  state: GameState;
  steps: MoveStep[];
}
