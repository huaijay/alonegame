/**
 * 棋盘几何定义（纯数据，无渲染依赖）
 *
 * 棋盘为 15×15 十字结构：
 * - 四个 5×5 机库位于四角（占比 44%，为十字留出更多空间）
 * - 十字臂宽 5 格（行/列 5..9），52 格环形跑道贴臂外缘（行/列 5 与 9）
 * - 每条终点跑道 5 格居中（行/列 7），与主环之间各隔一整行空隙
 * - 中央 3×3 为终点核心：4 条终点跑道 + 1 格归位格
 */

/** 网格边长（格） */
export const BOARD_CELLS = 15;
/** 单个格子的 SVG 尺寸 */
export const CELL = 60;
/** 棋盘 SVG 画布尺寸 */
export const BOARD_SIZE = BOARD_CELLS * CELL;

/** 座位定义：0 红(左上) 1 黄(右上) 2 蓝(右下) 3 绿(左下) */
export type Seat = 0 | 1 | 2 | 3;

export interface SeatMeta {
  readonly seat: Seat;
  readonly name: string;
  readonly short: string;
  readonly color: string;
  /** 深色填充，用于机库与同色格 */
  readonly soft: string;
  readonly base: string;
}

/** 四色玩家元数据，按座位顺序索引 */
export const SEAT_META: readonly SeatMeta[] = [
  { seat: 0, name: '红方', short: '红', color: '#ff4d6d', soft: 'rgba(255,77,109,0.32)', base: 'rgba(255,77,109,0.16)' },
  { seat: 1, name: '黄方', short: '黄', color: '#ffd166', soft: 'rgba(255,209,102,0.32)', base: 'rgba(255,209,102,0.16)' },
  { seat: 2, name: '蓝方', short: '蓝', color: '#4dabff', soft: 'rgba(77,171,255,0.32)', base: 'rgba(77,171,255,0.16)' },
  { seat: 3, name: '绿方', short: '绿', color: '#3ddc97', soft: 'rgba(61,220,151,0.32)', base: 'rgba(61,220,151,0.16)' },
];

/**
 * 环形跑道坐标，索引即绝对位置（顺时针）
 *
 * why：十字加宽为 5 格后，主环贴住臂外缘（行/列 5 与 9），终点跑道居中（行/列 7），
 * 两者之间自然留出一整行空隙，满足「终点格不与外圈贴连」的布局要求。
 * 环保持 52 格与四重旋转对称，索引 1/14/27/40（起点）与 13/26/39/0（飞行格）
 * 的坐标与旧版逐格一致，因此 START_INDEX、FLIGHT_OFFSET 及全部规则逻辑无需改动。
 */
export const TRACK: readonly (readonly [number, number])[] = [
  [7, 0],
  [6, 0], [5, 0],
  [5, 1], [5, 2], [5, 3], [5, 4],
  [4, 5], [3, 5], [2, 5], [1, 5],
  [0, 5], [0, 6], [0, 7],
  [0, 8], [0, 9],
  [1, 9], [2, 9], [3, 9], [4, 9],
  [5, 10], [5, 11], [5, 12], [5, 13], [5, 14],
  [6, 14], [7, 14],
  [8, 14], [9, 14],
  [9, 13], [9, 12], [9, 11], [9, 10],
  [10, 9], [11, 9], [12, 9], [13, 9],
  [14, 9], [14, 8], [14, 7], [14, 6], [14, 5],
  [13, 5], [12, 5], [11, 5], [10, 5],
  [9, 4], [9, 3], [9, 2], [9, 1], [9, 0],
  [8, 0],
];

/** 每个座位的起跑格在环形跑道上的绝对索引 */
export const START_INDEX: readonly number[] = [1, 14, 27, 40];

/** 飞行格相对起点的步数（四个座位均为 12，正好落在各臂转角处） */
export const FLIGHT_OFFSET = 12;

/** 各座位终点跑道 5 格坐标（由外向内） */
export const HOME_LANES: readonly (readonly (readonly [number, number])[])[] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];

/** 各座位归位格（中央 3×3 的四向入口） */
export const FINISH_CELLS: readonly (readonly [number, number])[] = [
  [7, 6],
  [6, 7],
  [7, 8],
  [8, 7],
];

/** 四个机库左上角坐标（5×5 角区） */
export const BASE_ORIGINS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

/** 机库内 4 个停机位（相对机库左上角的格偏移）：2×2 矩阵，占满 5×5 角区四角 */
export const BASE_SLOTS: readonly (readonly [number, number])[] = [
  [1.15, 1.15],
  [1.15, 3.85],
  [3.85, 1.15],
  [3.85, 3.85],
];

/** 跑道绝对索引对应的格子颜色（座位号） */
export function colorOfTrackIndex(index: number): Seat {
  const normalized = ((index % TRACK.length) + TRACK.length) % TRACK.length;
  return ((normalized - 1 + TRACK.length) % 4) as Seat;
}

/** 将「相对起点步数」换算为跑道绝对索引 */
export function toTrackIndex(seat: Seat, relative: number): number {
  return (START_INDEX[seat]! + relative) % TRACK.length;
}

/** 某座位的飞行格绝对索引 */
export function flightIndex(seat: Seat): number {
  return (START_INDEX[seat]! + FLIGHT_OFFSET) % TRACK.length;
}

/** 取格子中心点（SVG 坐标） */
export function cellCenter(row: number, col: number): { x: number; y: number } {
  return { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL };
}

/** 计算朝向（角度，0° 指向右侧），用于飞机旋转 */
export function angleBetween(from: readonly [number, number], to: readonly [number, number]): number {
  return (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
}

/** 跑道格的行进方向角 */
export function trackAngle(index: number): number {
  const current = TRACK[((index % TRACK.length) + TRACK.length) % TRACK.length]!;
  const next = TRACK[(index + 1) % TRACK.length]!;
  return angleBetween(current, next);
}

/** 终点跑道格的行进方向角 */
export function homeAngle(seat: Seat, relative: number): number {
  const lane = HOME_LANES[seat]!;
  const offset = relative - 52;
  const current = lane[Math.min(offset, lane.length - 1)]!;
  const next = offset < lane.length - 1 ? lane[offset + 1]! : FINISH_CELLS[seat]!;
  return angleBetween(current, next);
}
