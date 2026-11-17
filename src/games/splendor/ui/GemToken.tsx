import { GEM_NAMES } from '../engine/board';
import type { TokenColor } from '../engine/types';

/** 计算正八边形顶点；rot 控制初始相位（弧度），保证顶边水平、嵌入圆形筹码更饱满。 */
function octagon(cx: number, cy: number, r: number, rot: number): [number, number][] {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = rot + (Math.PI / 4) * i;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

/** 顶点数组转 SVG points 字符串。 */
const toPoints = (points: [number, number][]): string =>
  points.map(([x, y]) => x.toFixed(2) + ',' + y.toFixed(2)).join(' ');

const PHASE = Math.PI / 8;
const OUTER = octagon(50, 50, 33, PHASE);
const TABLE = octagon(50, 50, 19, PHASE);
const CORE = octagon(50, 50, 10, PHASE);
/** 冠面刻片：外八边形与台面之间的八个梯形，交替明暗模拟折射。 */
const FACETS: [number, number][][] = OUTER.map((point, i) => [
  point, OUTER[(i + 1) % 8], TABLE[(i + 1) % 8], TABLE[i],
]);
const OUTER_POINTS = toPoints(OUTER);
const TABLE_POINTS = toPoints(TABLE);
const CORE_POINTS = toPoints(CORE);
/** 黄金通配的四芒星，区分普通宝石。 */
const STAR_PATH = 'M50 36 L54.5 45.5 L64 50 L54.5 54.5 L50 64 L45.5 54.5 L36 50 L45.5 45.5 Z';

export type GemSize = 'md' | 'sm' | 'xs';

interface GemTokenProps {
  color: TokenColor;
  count?: number;
  size?: GemSize;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * 宝石筹码：圆形铸币底盘内嵌八面切工宝石，颜色完全由 CSS 变量驱动以适配双主题。
 *
 * @param color 宝石颜色，gold 为黄金通配
 * @param count 右下角数量徽标（可选）
 * @param size 尺寸档位：md 银行主筹码 / sm 卡牌与侧栏 / xs 席位微缩
 * @param selected 已被选入领取托盘时高亮
 */
export function GemToken({ color, count, size = 'md', selected = false, disabled = false, onClick }: GemTokenProps) {
  const name = color === 'gold' ? '黄金通配' : GEM_NAMES[color];
  const face = (
    <svg className="sp-gem-svg" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="sp-chip-edge" cx="50" cy="50" r="48" />
      <circle className="sp-chip-face" cx="50" cy="50" r="41" />
      <circle className="sp-chip-notch" cx="50" cy="50" r="37" />
      <polygon className="sp-gem-base" points={OUTER_POINTS} />
      {FACETS.map((quad, i) => (
        <polygon key={i} points={toPoints(quad)}
          className={i === 6 ? 'sp-facet-glint' : i % 2 === 0 ? 'sp-facet-light' : 'sp-facet-dark'} />
      ))}
      <polygon className="sp-gem-table" points={TABLE_POINTS} />
      <polygon className="sp-gem-core" points={CORE_POINTS} />
      {color === 'gold' ? <path className="sp-gem-star" d={STAR_PATH} /> : null}
      <polygon className="sp-gem-outline" points={OUTER_POINTS} />
    </svg>
  );
  const className = 'sp-gem sp-gem-' + size + (selected ? ' is-selected' : '');
  const badge = count !== undefined ? <span className="sp-gem-count">{count}</span> : null;
  return onClick ? (
    <button className={className} data-color={color} type="button" disabled={disabled}
      onClick={onClick} title={name + (count === undefined ? '' : '，剩余 ' + count + ' 枚')}
      aria-label={name + (count === undefined ? '' : '，剩余 ' + count + ' 枚')} aria-pressed={selected}>
      {face}{badge}
    </button>
  ) : (
    <span className={className} data-color={color}
      title={name + (count === undefined ? '' : ' ' + count + ' 枚')}
      aria-label={name + (count === undefined ? '' : ' ' + count + ' 枚')}>
      {face}{badge}
    </span>
  );
}
