import { TILE_COLORS, WALL_SIZE } from './types';
import type { TileColor } from './types';

/** 座位定义：0 红 1 黄 2 蓝 3 绿（与大厅四色玩家一致） */
export type Seat = 0 | 1 | 2 | 3;

export interface SeatMeta {
  readonly seat: Seat;
  readonly name: string;
  readonly short: string;
  readonly color: string;
}

/** 四色玩家元数据，按座位顺序索引（沿用飞行棋配色，保持大厅视觉统一） */
export const SEAT_META: readonly SeatMeta[] = [
  { seat: 0, name: '红方', short: '红', color: '#ff4d6d' },
  { seat: 1, name: '黄方', short: '黄', color: '#ffd166' },
  { seat: 2, name: '蓝方', short: '蓝', color: '#4dabff' },
  { seat: 3, name: '绿方', short: '绿', color: '#3ddc97' },
];

/** 人数对应的工厂盘数量 */
export const FACTORY_COUNT: Record<number, number> = { 2: 5, 3: 7, 4: 9 };

/** 地板罚分序列：第 n 块砖对应第 n 项扣分 */
export const FLOOR_PENALTIES: readonly number[] = [-1, -1, -2, -2, -2, -3, -3];

/** 墙格颜色：第 row 行第 col 列应放置的砖色（行间错位一格） */
export function wallColorOf(row: number, col: number): TileColor {
  return ((((col - row) % WALL_SIZE) + WALL_SIZE) % WALL_SIZE) as TileColor;
}

/** 落点列：第 row 行放置 color 色砖应落入的列（wallColorOf 的逆映射） */
export function wallColOf(row: number, color: TileColor): number {
  return (color + row) % WALL_SIZE;
}

/** 图案行容量 = 行号 + 1 */
export function rowCapacity(row: number): number {
  return row + 1;
}

/** 地板前 length 块砖的累计罚分 */
export function floorPenalty(length: number): number {
  let total = 0;
  for (let i = 0; i < Math.min(length, FLOOR_PENALTIES.length); i += 1) {
    total += FLOOR_PENALTIES[i];
  }
  return total;
}

export interface TileMeta {
  readonly name: string;
  /** 砖的固有色（明亮配色，深浅主题下均可辨识） */
  readonly color: string;
}

/** 五色花砖元数据，按 TileColor 顺序索引 */
export const TILE_META: readonly TileMeta[] = [
  { name: '蓝', color: '#4dabff' },
  { name: '黄', color: '#ffd166' },
  { name: '红', color: '#ff4d6d' },
  { name: '黑', color: '#7d8fb3' },
  { name: '青', color: '#35d0c0' },
];

/** 从五色计数数组中取非空颜色列表（用于抽砖与拿砖枚举） */
export function nonEmptyColors(counts: readonly number[]): TileColor[] {
  const colors: TileColor[] = [];
  for (let c = 0; c < TILE_COLORS; c += 1) {
    if (counts[c] > 0) colors.push(c as TileColor);
  }
  return colors;
}
