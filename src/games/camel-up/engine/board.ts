/** 座位定义：0-7 号（支持 2-8 名玩家） */
export type Seat = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SeatMeta {
  readonly seat: Seat;
  readonly name: string;
  readonly short: string;
  readonly color: string;
}

/** 八色玩家元数据，按座位顺序索引（沿用大厅明亮配色） */
export const SEAT_META: readonly SeatMeta[] = [
  { seat: 0, name: '红方', short: '红', color: '#ff4d6d' },
  { seat: 1, name: '黄方', short: '黄', color: '#ffd166' },
  { seat: 2, name: '蓝方', short: '蓝', color: '#4dabff' },
  { seat: 3, name: '绿方', short: '绿', color: '#3ddc97' },
  { seat: 4, name: '橙方', short: '橙', color: '#ff9f43' },
  { seat: 5, name: '紫方', short: '紫', color: '#b18cff' },
  { seat: 6, name: '青方', short: '青', color: '#35d0c0' },
  { seat: 7, name: '粉方', short: '粉', color: '#ff7ac6' },
];

export interface CamelMeta {
  readonly name: string;
  /** 骆驼固有色（明亮配色，深浅主题下均可辨识） */
  readonly color: string;
  /** 描边色：白骆驼在浅色主题下需要深描边保持可见 */
  readonly stroke: string;
}

/** 五峰骆驼元数据，按 CamelColor 顺序索引 */
export const CAMEL_META: readonly CamelMeta[] = [
  { name: '黄驼', color: '#ffd166', stroke: '#a97e1f' },
  { name: '橙驼', color: '#ff9f43', stroke: '#b56a12' },
  { name: '蓝驼', color: '#4dabff', stroke: '#1f6fb8' },
  { name: '绿驼', color: '#3ddc97', stroke: '#1e8a5e' },
  { name: '白驼', color: '#f2f4f8', stroke: '#7d8fb3' },
];

// ---------------------------------------------------------------- 赛道几何

/** 棋盘场景边长（SVG viewBox 正方形） */
export const BOARD_SIZE = 760;

/** 赛道圆心（场景坐标） */
export const BOARD_CENTER = BOARD_SIZE / 2;

/** 赛道格数（环形一圈） */
export const TRACK_SPACES = 16;

/** 终点线桶索引：骆驼越过终点线即停在此桶（与 stacks 数组下标一致） */
export const FINISH_INDEX = TRACK_SPACES;

/** 环形赛道上第 pos 格的角度（度）；0 格在正上方，顺时针递增 */
export function trackAngleOf(pos: number): number {
  return -90 + (pos * 360) / TRACK_SPACES;
}

/**
 * 环形赛道上第 pos 格的场景坐标（圆心为 BOARD_CENTER，y 向下为正）
 * @param pos 格号（支持小数，用于格缝定位）
 * @param radius 距圆心的半径
 */
export function trackPointOf(pos: number, radius: number): { x: number; y: number } {
  const rad = (trackAngleOf(pos) * Math.PI) / 180;
  return {
    x: BOARD_CENTER + Math.cos(rad) * radius,
    y: BOARD_CENTER + Math.sin(rad) * radius,
  };
}

/** 地形块禁止放置的格（规则：第 1 格永不放块） */
export const DESERT_FORBIDDEN_POS = 0;
