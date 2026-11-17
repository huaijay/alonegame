import type { CSSProperties } from 'react';
import { TILE_META } from '@/games/azul/engine/board';
import type { TileColor } from '@/games/azul/engine/types';

interface TileProps {
  color: TileColor;
  /** 尺寸档位：供应区与墙用 sm，图案行用 md */
  size?: 'sm' | 'md';
  /** 是否呼吸脉冲高亮（当前行动元素） */
  pulse?: boolean;
  /** 弹入动画序号：变化时重放 tile-pop 动画 */
  popKey?: number | string;
}

/** 单块花砖：圆形色块，颜色来自砖色元数据 */
export function Tile({ color, size = 'sm', pulse = false, popKey }: TileProps) {
  return (
    <span
      key={popKey}
      className="azul-tile"
      data-size={size}
      data-pulse={pulse}
      style={{ '--tile': TILE_META[color].color } as CSSProperties}
    />
  );
}

/** 首玩家标记：方形徽记，用于中央区与地板 */
export function FirstMarker({ pulse = false }: { pulse?: boolean }) {
  return <span className="azul-marker" data-pulse={pulse} aria-label="首玩家标记" />;
}
