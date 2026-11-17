import type { ReactElement } from 'react';
import type { DevelopmentCard, GemColor, Noble, Tier } from '../engine/types';
import { GemToken } from './GemToken';

/** 单颗水晶：菱形主体 + 顶部白色高光切面。 */
function Crystal({ x, baseY, w, h }: { x: number; baseY: number; w: number; h: number }) {
  return (
    <g>
      <path d={`M ${x} ${baseY - h} L ${x + w} ${baseY} L ${x} ${baseY + h * 0.3} L ${x - w} ${baseY} Z`}
        className="sp-crystal" />
      <path d={`M ${x} ${baseY - h} L ${x + w * 0.45} ${baseY - h * 0.15} L ${x} ${baseY + h * 0.1} Z`}
        className="sp-crystal-glint" />
    </g>
  );
}

/** 一阶 · 矿脉：洞穴拱顶、钟乳石与成簇的宝石原矿。 */
function MineScene() {
  return (
    <svg className="sp-scene" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse className="sp-scene-glow" cx="100" cy="92" rx="72" ry="30" />
      <path className="sp-scene-ink" d="M0 110 L0 40 Q100 -34 200 40 L200 110 L168 110 L168 62 Q100 12 32 62 L32 110 Z" />
      <path className="sp-scene-stroke" d="M32 62 Q100 12 168 62" />
      <path className="sp-scene-ink" d="M52 26 l5 20 5 -20 Z M74 20 l4 14 4 -14 Z M120 18 l5 18 5 -18 Z M142 26 l4 15 4 -15 Z" />
      <Crystal x={64} baseY={104} w={11} h={30} />
      <Crystal x={96} baseY={107} w={14} h={38} />
      <Crystal x={130} baseY={104} w={10} h={26} />
      <circle className="sp-scene-spark" cx="96" cy="66" r="2" />
      <circle className="sp-scene-spark" cx="138" cy="80" r="1.6" />
      <circle className="sp-scene-spark" cx="58" cy="78" r="1.6" />
    </svg>
  );
}

/** 二阶 · 工坊：山墙屋脊、齿轮与熔炉火光。 */
function CraftScene() {
  const teeth = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg className="sp-scene" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse className="sp-scene-glow" cx="100" cy="86" rx="78" ry="26" />
      <path className="sp-scene-ink" d="M18 110 L18 58 L58 24 L98 58 L98 110 Z" />
      <path className="sp-scene-ink" d="M44 24 L44 10 L56 10 L56 15 Z" />
      <path className="sp-scene-ink" d="M102 110 L102 44 L188 44 L188 110 Z" />
      <path className="sp-scene-stroke" d="M18 58 L58 24 L98 58 M102 44 L188 44" />
      <path className="sp-scene-glow-arch" d="M118 110 L118 74 Q136 58 154 74 L154 110 Z" />
      <g className="sp-scene-gear" transform="translate(136 60)">
        {teeth.map((deg) => <rect key={deg} x={-3} y={-21} width={6} height={7} transform={`rotate(${deg})`} />)}
        <circle r="14" />
        <circle className="sp-scene-gear-hole" r="5" />
      </g>
      <path className="sp-scene-ink" d="M40 110 L40 96 L82 96 L82 110 Z M50 96 L50 86 L72 86 L50 96 Z" />
    </svg>
  );
}

/** 三阶 · 行会：穹顶殿堂、玫瑰窗与立柱横幅。 */
function GuildScene() {
  return (
    <svg className="sp-scene" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse className="sp-scene-glow" cx="100" cy="60" rx="80" ry="40" />
      <path className="sp-scene-ink" d="M8 110 L8 52 Q8 40 24 40 L40 40 L40 110 Z M160 110 L160 40 L176 40 Q192 40 192 52 L192 110 Z" />
      <path className="sp-scene-ink" d="M40 110 L40 46 Q100 -18 160 46 L160 110 Z" />
      <path className="sp-scene-stroke" d="M40 46 Q100 -18 160 46" />
      <path className="sp-scene-ink" d="M40 110 L52 110 L52 58 L40 58 Z M148 110 L160 110 L160 58 L148 58 Z M94 110 L106 110 L106 62 L94 62 Z" />
      <path className="sp-scene-stroke" d="M52 58 L148 58" />
      <circle className="sp-scene-rose" cx="100" cy="42" r="16" />
      <g className="sp-scene-rose-line">
        <path d="M100 26 L100 58 M84 42 L116 42 M88 30 L112 54 M112 30 L88 54" />
      </g>
      <path className="sp-scene-ink" d="M100 18 L100 10" />
      <path className="sp-scene-flag" d="M70 58 L70 92 L64 86 L58 92 L58 58 Z" />
    </svg>
  );
}

const SCENES: Record<Tier, () => ReactElement> = { 1: MineScene, 2: CraftScene, 3: GuildScene };

interface DevelopmentCardProps {
  card: DevelopmentCard;
  affordable?: boolean;
  onBuy?: () => void;
  onReserve?: () => void;
  compact?: boolean;
}

/** 发展卡：顶部声望徽记与永久折扣宝石，中部三阶插画，底部费用宝石条。 */
export function DevelopmentCardView({ card, affordable = false, onBuy, onReserve, compact = false }: DevelopmentCardProps) {
  const Scene = SCENES[card.tier];
  return (
    <article className={'sp-dev-card' + (compact ? ' sp-dev-card-compact' : '')}
      data-tier={card.tier} data-color={card.bonus} data-affordable={affordable}>
      <div className="sp-card-scene" aria-hidden="true"><Scene /></div>
      <div className="sp-card-topline">
        {card.points > 0 ? (
          <span className="sp-card-vp"><svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 L14 9 L20 9 L15.2 12.6 L17 18.6 L12 15 L7 18.6 L8.8 12.6 L4 9 L10 9 Z" />
          </svg><b>{card.points}</b></span>
        ) : <span className="sp-card-vp is-blank" />}
        <GemToken color={card.bonus} size="sm" />
      </div>
      <div className="sp-card-foot">
        {(['white', 'blue', 'green', 'red', 'black'] as GemColor[]).filter((color) => card.cost[color] > 0).map((color) => (
          <span key={color} className="sp-cost" data-color={color}>
            <GemToken color={color} size="xs" /><b>{card.cost[color]}</b>
          </span>
        ))}
      </div>
      {(onBuy || onReserve) ? (
        <div className="sp-card-actions">
          {onBuy ? <button type="button" className="sp-card-buy" onClick={onBuy}
            aria-label={'购买' + card.tier + '阶发展卡'}>购入</button> : null}
          {onReserve ? <button type="button" className="sp-card-reserve" onClick={onReserve}
            aria-label={'预留' + card.tier + '阶发展卡'}>预留</button> : null}
        </div>
      ) : null}
    </article>
  );
}

/** 贵族纹章：月桂环拱卫王冠，下方以微型宝石标明所需永久折扣。 */
export function NobleTile({ noble, awarded = false }: { noble: Noble; awarded?: boolean }) {
  return (
    <div className={'sp-noble' + (awarded ? ' is-awarded' : '')}>
      <svg className="sp-noble-crest" viewBox="0 0 120 64" aria-hidden="true">
        <path className="sp-noble-laurel" d="M22 52 Q10 32 20 14 M24 50 Q14 32 22 18" />
        <path className="sp-noble-laurel" d="M98 52 Q110 32 100 14 M96 50 Q106 32 98 18" />
        <path className="sp-noble-crown" d="M42 44 L46 24 L56 36 L60 20 L64 36 L74 24 L78 44 Z" />
        <path className="sp-noble-band" d="M40 44 L80 44 L80 50 L40 50 Z" />
        <circle className="sp-noble-jewel" cx="46" cy="26" r="2.4" />
        <circle className="sp-noble-jewel" cx="60" cy="22" r="2.4" />
        <circle className="sp-noble-jewel" cx="74" cy="26" r="2.4" />
      </svg>
      <div className="sp-noble-foot">
        <span className="sp-noble-vp">+3</span>
        <span className="sp-noble-costs">
          {(['white', 'blue', 'green', 'red', 'black'] as GemColor[]).filter((color) => noble.requirement[color] > 0).map((color) => (
            <span key={color} className="sp-cost" data-color={color}>
              <GemToken color={color} size="xs" /><b>{noble.requirement[color]}</b>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
