import type { ReactElement } from 'react';
import type { DevelopmentCard, GemColor, Noble } from '../engine/types';
import { GemToken } from './GemToken';

/** 单颗水晶：菱形主体 + 顶部白色高光切面。 */
function Crystal({ x, baseY, w, h }: { x: number; baseY: number; w: number; h: number }) {
  return (
    <g>
      <path d={`M ${x} ${baseY - h} L ${x + w} ${baseY} L ${x} ${baseY + h * 0.3} L ${x - w} ${baseY} Z`}
        className="sp-art-mid" />
      <path d={`M ${x} ${baseY - h} L ${x + w * 0.45} ${baseY - h * 0.15} L ${x} ${baseY + h * 0.1} Z`}
        className="sp-art-glint" />
    </g>
  );
}

/** 同阶卡面序号：族 × 布局两轴组合对每张卡唯一，保证同阶构图互不重复。 */
function cardVariant(card: DevelopmentCard): { family: number; layout: number } {
  const index = Number(card.id.slice(1)) - 1;
  const base = card.tier === 1 ? 0 : card.tier === 2 ? 40 : 70;
  const variant = index - base;
  const families = card.tier === 1 ? 4 : card.tier === 2 ? 5 : 4;
  return { family: variant % families, layout: Math.floor(variant / families) };
}

/** 一阶 · 矿脉（蓝 · 低复杂度）：岩层底纹与少量晶体，族区分晶簇形态，布局推进位置与尺寸。 */
function VeinScene({ family, layout }: { family: number; layout: number }) {
  const cx = 52 + layout * 10;
  const w = 8 + (layout % 3) * 3;
  const h = 20 + (layout % 4) * 6;
  const y = 104 - (layout % 3) * 5;
  const crest = 40 - (layout % 4) * 4;
  return (
    <svg className="sp-scene" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse className="sp-art-glow" cx={cx} cy={86} rx={46 + (layout % 3) * 8} ry={17 + (layout % 4) * 3} />
      <path className="sp-art-ink" d={`M0 110 L0 ${70 + (layout % 3) * 6} Q100 ${crest} 200 ${70 + (layout % 3) * 6} L200 110 Z`} />
      <path className="sp-art-stroke" d={`M24 ${64 + (layout % 3) * 5} Q100 ${crest + 20} 176 ${64 + (layout % 3) * 5}`} />
      {family === 0 ? <Crystal x={cx} baseY={y} w={w + 4} h={h + 8} />
        : family === 1 ? <>
          <Crystal x={cx - w - 5} baseY={y} w={w} h={h} />
          <Crystal x={cx + w + 5} baseY={y - 4} w={w} h={h + 6} />
        </>
        : family === 2 ? <>
          <Crystal x={cx - w - 7} baseY={y} w={w - 2} h={h - 7} />
          <Crystal x={cx} baseY={y} w={w} h={h + 4} />
          <Crystal x={cx + w + 7} baseY={y} w={w - 2} h={h - 9} />
        </>
        : <>
          <path className="sp-art-ink" d={`M${cx - 22} ${y} Q${cx} ${y - h - 16} ${cx + 22} ${y} Z`} />
          <Crystal x={cx} baseY={y} w={w} h={h - 6} />
        </>}
      <circle className="sp-art-spark" cx={cx - 16 - (layout % 4) * 5} cy={60 + (layout % 4) * 6} r={1.8} />
      {family !== 2 ? <circle className="sp-art-spark" cx={cx + 15 + (layout % 3) * 4} cy={50 + (layout % 3) * 6} r={1.4} /> : null}
    </svg>
  );
}

/** 二阶 · 工坊（紫 · 中复杂度）：齿轮、熔炉、吊架等器械主题，族换器械、布局推进尺寸与落点。 */
function WorkshopScene({ family, layout }: { family: number; layout: number }) {
  const cx = 58 + layout * 16;
  const r = 12 + (layout % 3) * 3;
  const teeth = Array.from({ length: 6 + (layout % 3) * 2 }, (_, i) => (360 / (6 + (layout % 3) * 2)) * i);
  const gear = (x: number, y: number, radius: number) => (
    <g className="sp-art-gear" transform={`translate(${x} ${y})`}>
      {teeth.map((deg) => <rect key={deg} x={-3} y={-(radius + 6)} width={6} height={7}
        transform={`rotate(${deg})`} />)}
      <circle r={radius} />
      <circle className="sp-art-gear-hole" r={radius * 0.38} />
    </g>
  );
  return (
    <svg className="sp-scene" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse className="sp-art-glow" cx={cx} cy={78} rx={60 + (layout % 3) * 10} ry={20 + (layout % 4) * 3} />
      <path className="sp-art-ink" d={`M0 110 L0 76 Q100 ${52 - (layout % 3) * 4} 200 76 L200 110 Z`} />
      <path className="sp-art-stroke" d={`M18 ${74 + (layout % 3) * 3} Q100 ${48 - (layout % 3) * 4} 182 ${74 + (layout % 3) * 3}`} />
      {family === 0 ? <>
        {gear(cx, 70 - r, r)}
        <Crystal x={cx + r + 22} baseY={98} w={9 + (layout % 3) * 2} h={26 + (layout % 3) * 5} />
        <path className="sp-art-ink" d={`M${cx - r - 12} 110 L${cx - r - 12} 98 L${cx + r + 4} 98 L${cx + r + 4} 110 Z`} />
      </>
        : family === 1 ? <>
          {gear(cx - r - 4, 62, r)}
          {gear(cx + r + 4, 74, r - 2)}
          <Crystal x={cx + r + 26} baseY={100} w={8} h={20 + (layout % 3) * 4} />
        </>
        : family === 2 ? <>
          <path className="sp-art-ink" d={`M${cx - 26} 110 L${cx - 26} 66 Q${cx} ${44 - (layout % 3) * 3} ${cx + 26} 66 L${cx + 26} 110 Z`} />
          <path className="sp-art-stroke" d={`M${cx - 18} 72 Q${cx} ${56 - (layout % 3) * 3} ${cx + 18} 72`} />
          <path className="sp-art-soft" d={`M${cx} ${96 - (layout % 3) * 4} q7 8 0 16 q-7 -8 0 -16 Z`} />
          <circle className="sp-art-spark" cx={cx + 8} cy={84} r={1.6} />
        </>
        : family === 3 ? <>
          <path className="sp-art-ink" d={`M${cx - 20} 110 L${cx - 20} 84 L${cx + 14} 84 L${cx + 14} 92 L${cx + 26} 92 L${cx + 26} 110 Z`} />
          <path className="sp-art-stroke" d={`M${cx - 26} 84 L${cx + 20} 84`} />
          {Array.from({ length: 3 }, (_, i) => (
            <circle key={i} className="sp-art-spark" cx={cx - 10 + i * 14 + (layout % 3) * 2} cy={70 - (i % 2) * 8 - (layout % 3) * 3} r={2.2 - i * 0.4} />
          ))}
          <Crystal x={cx - 2} baseY={84} w={8} h={16 + (layout % 3) * 4} />
        </>
        : <>
          <path className="sp-art-stroke" d={`M${cx} 34 L${cx} 110`} />
          <circle className="sp-art-soft" cx={cx} cy={40 + (layout % 3) * 3} r={7} />
          <line className="sp-art-stroke" x1={cx - 14} y1={52 + (layout % 3) * 3} x2={cx + 14} y2={52 + (layout % 3) * 3} />
          <Crystal x={cx - 12} baseY={82 + (layout % 3) * 2} w={6} h={14 + (layout % 3) * 3} />
          <Crystal x={cx + 12} baseY={88 + (layout % 3) * 2} w={6} h={12 + (layout % 3) * 3} />
        </>}
      <circle className="sp-art-spark" cx={cx - 30 - (layout % 4) * 4} cy={58 + (layout % 3) * 6} r={1.6} />
    </svg>
  );
}

/** 三阶 · 行会（绿 · 高复杂度）：殿堂穹顶、玫瑰窗、横幅立柱与宝石堆，层次最多。 */
function GuildScene({ family, layout }: { family: number; layout: number }) {
  const cx = 100;
  const span = 52 + (layout % 3) * 10;
  const crown = 22 - (layout % 3) * 5;
  const petals = 4 + (layout % 3) * 2;
  const row = (y: number) => Array.from({ length: petals }, (_, i) => cx - span + ((i + 0.5) * (span * 2)) / petals)
    .map((x, i) => <circle key={i} className="sp-art-soft" cx={x} cy={y} r={3 - (i % 2) * 0.8} />);
  return (
    <svg className="sp-scene" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse className="sp-art-glow" cx={cx} cy={64} rx={78} ry={34 + (layout % 3) * 5} />
      <path className="sp-art-ink" d={`M${cx - span - 22} 110 L${cx - span - 22} 46 Q${cx - span - 22} 36 ${cx - span - 8} 36 L${cx - span - 8} 110 Z`} />
      <path className="sp-art-ink" d={`M${cx + span + 22} 110 L${cx + span + 22} 36 L${cx + span + 8} 36 Q${cx + span + 22} 36 ${cx + span + 22} 46 L${cx + span + 22} 110 Z`} />
      <path className="sp-art-ink" d={`M${cx - span} 110 L${cx - span} 48 Q${cx} ${crown} ${cx + span} 48 L${cx + span} 110 Z`} />
      <path className="sp-art-stroke" d={`M${cx - span} 48 Q${cx} ${crown} ${cx + span} 48`} />
      <path className="sp-art-stroke" d={`M${cx - span + 10} 60 L${cx + span - 10} 60`} />
      {family === 0 ? <>
        <circle className="sp-art-rose" cx={cx} cy={40 + (layout % 3) * 3} r={13 + (layout % 3) * 2} />
        <g className="sp-art-rose-line">
          {Array.from({ length: petals }, (_, i) => (
            <line key={i} x1={cx} y1={40 + (layout % 3) * 3}
              x2={cx + 12 * Math.cos((Math.PI * 2 * i) / petals)}
              y2={40 + (layout % 3) * 3 + 12 * Math.sin((Math.PI * 2 * i) / petals)} />
          ))}
        </g>
        <path className="sp-art-mid" d={`M${cx - span + 16} 60 L${cx - span + 16} 96 L${cx - span + 8} 89 L${cx - span} 96 L${cx - span} 60 Z`} />
        <path className="sp-art-mid" d={`M${cx + span - 16} 60 L${cx + span - 16} 96 L${cx + span - 8} 89 L${cx + span} 96 L${cx + span} 60 Z`} />
        {row(96)}
      </>
        : family === 1 ? <>
          <path className="sp-art-ink" d={`M${cx} ${crown + 6} Q${cx - span * 0.6} ${crown + 10} ${cx - span * 0.6} 62 L${cx + span * 0.6} 62 Q${cx + span * 0.6} ${crown + 10} ${cx} ${crown + 6} Z`} />
          {Array.from({ length: 3 }, (_, i) => (
            <path key={i} className="sp-art-mid" d={`M${cx - span + 14 + i * (span - 8)} 110 L${cx - span + 14 + i * (span - 8)} 62 L${cx - span + 20 + i * (span - 8)} 62 L${cx - span + 20 + i * (span - 8)} 110 Z`} />
          ))}
          {row(70)}
          <Crystal x={cx} baseY={104} w={11} h={26 + (layout % 3) * 4} />
        </>
        : family === 2 ? <>
          <path className="sp-art-ink" d={`M${cx - span * 0.7} 110 L${cx - span * 0.7} ${54 + (layout % 3) * 4} Q${cx} ${crown + 10} ${cx + span * 0.7} ${54 + (layout % 3) * 4} L${cx + span * 0.7} 110 Z`} />
          <path className="sp-art-stroke" d={`M${cx - span * 0.5} ${64 + (layout % 3) * 4} Q${cx} ${crown + 18} ${cx + span * 0.5} ${64 + (layout % 3) * 4}`} />
          <path className="sp-art-mid" d={`M${cx - 18} 110 L${cx - 12} 92 L${cx + 12} 92 L${cx + 18} 110 Z`} />
          <Crystal x={cx - 8} baseY={92} w={6} h={13} />
          <Crystal x={cx + 8} baseY={92} w={6} h={15} />
          <Crystal x={cx} baseY={92} w={7} h={17} />
          {row(80)}
        </>
        : <>
          <g className="sp-art-sun" transform={`translate(${cx} ${44 + (layout % 3) * 3})`}>
            {Array.from({ length: petals + 4 }, (_, i) => (
              <rect key={i} x={-1.6} y={-19 - (layout % 3) * 2} width={3.2} height={7}
                transform={`rotate(${(180 / (petals + 4)) * i})`} />
            ))}
            <circle r={9 + (layout % 3)} />
            <circle className="sp-art-gear-hole" r={3.5} />
          </g>
          <path className="sp-art-mid" d={`M${cx - span + 10} 62 L${cx - span + 10} 98 L${cx - span + 2} 91 L${cx - span - 6} 98 L${cx - span - 6} 62 Z`} />
          <path className="sp-art-mid" d={`M${cx + span - 10} 62 L${cx + span - 10} 98 L${cx + span - 2} 91 L${cx + span + 6} 98 L${cx + span + 6} 62 Z`} />
          {row(102)}
        </>}
      <circle className="sp-art-spark" cx={cx - span - 14} cy={40 + (layout % 4) * 5} r={1.6} />
      <circle className="sp-art-spark" cx={cx + span + 14} cy={52 + (layout % 3) * 6} r={1.4} />
    </svg>
  );
}

const SCENES: Record<number, (params: { family: number; layout: number }) => ReactElement> = {
  1: VeinScene,
  2: WorkshopScene,
  3: GuildScene,
};

interface DevelopmentCardProps {
  card: DevelopmentCard;
  affordable?: boolean;
  onBuy?: () => void;
  onReserve?: () => void;
}

/** 发展卡：顶部声望徽记与永久折扣宝石，中部按档位着色且每张独一无二的插画，底部费用宝石条。 */
export function DevelopmentCardView({ card, affordable = false, onBuy, onReserve }: DevelopmentCardProps) {
  const Scene = SCENES[card.tier];
  return (
    <article className="sp-dev-card" data-tier={card.tier} data-color={card.bonus} data-affordable={affordable}>
      <div className="sp-card-scene" aria-hidden="true"><Scene {...cardVariant(card)} /></div>
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
            title="只差 1 枚筹码时可锁定，并获得 1 枚黄金"
            aria-label={'预留' + card.tier + '阶发展卡'}>预留</button> : null}
        </div>
      ) : null}
    </article>
  );
}

/** 贵族胸像底稿：发式 × 佩饰由序号唯一决定，NobleTile 与 NobleChip 共用。 */
function NobleBust({ variant }: { variant: number }) {
  const hair = variant % 5;
  const adorned = Math.floor(variant / 5) === 1;
  return (
    <g>
      {/* 胸像：肩部弧线 + 头部圆脸，全部贵族共享同一底稿 */}
      <path className="sp-noble-body" d="M38 64 Q38 50 60 48 Q82 50 82 64 Z" />
      <circle className="sp-noble-face" cx="60" cy="30" r="13" />
      {hair === 0 ? (
        <path className="sp-noble-hair" d="M47 28 Q48 15 60 15 Q72 15 73 28 Q66 21 60 21 Q54 21 47 28 Z" />
      ) : hair === 1 ? (
        <path className="sp-noble-hair" d="M46 29 Q44 14 60 15 Q76 14 74 29 Q68 18 60 19 Q52 18 46 29 Z
          M46 29 q-3 3 -1 7 q3 0 4 -4 Z M74 29 q3 3 1 7 q-3 0 -4 -4 Z" />
      ) : hair === 2 ? (
        <path className="sp-noble-hair" d="M43 42 Q41 12 60 14 Q79 12 77 42 L70 42 Q73 20 60 20 Q47 20 50 42 Z" />
      ) : hair === 3 ? (
        <g>
          <path className="sp-noble-hair" d="M47 28 Q48 15 60 15 Q72 15 73 28 Q66 21 60 21 Q54 21 47 28 Z" />
          <circle className="sp-noble-hair" cx="60" cy="10" r="5.5" />
          <circle className="sp-noble-jewel" cx="60" cy="10" r="1.8" />
        </g>
      ) : (
        <g>
          <path className="sp-noble-hair" d="M46 23 Q47 13 60 13 Q73 13 74 23 Z" />
          <rect className="sp-noble-hair" x="38" y="21" width="44" height="4.5" rx="2.2" />
        </g>
      )}
      {adorned ? (
        <g>
          <path className="sp-noble-beard" d="M50 37 Q52 49 60 49 Q68 49 70 37 Q66 43 60 43 Q54 43 50 37 Z" />
          <rect className="sp-noble-collar" x="51" y="51" width="18" height="6" rx="2.5" />
        </g>
      ) : (
        <g>
          <circle className="sp-noble-jewel" cx="47" cy="35" r="2" />
          <circle className="sp-noble-jewel" cx="63" cy="52" r="3" />
        </g>
      )}
    </g>
  );
}

/** 贵族纹章：月桂环拱卫统一风格的几何人物胸像，十位贵族形象互不相同。 */
export function NobleTile({ noble, awarded = false }: { noble: Noble; awarded?: boolean }) {
  return (
    <div className={'sp-noble' + (awarded ? ' is-awarded' : '')} data-noble={Number(noble.id.slice(1))}>
      <svg className="sp-noble-crest" viewBox="0 0 120 64" aria-hidden="true">
        <path className="sp-noble-laurel" d="M22 52 Q10 32 20 14 M24 50 Q14 32 22 18" />
        <path className="sp-noble-laurel" d="M98 52 Q110 32 100 14 M96 50 Q106 32 98 18" />
        <NobleBust variant={Number(noble.id.slice(1)) - 1} />
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

/** 贵族微缩徽章：仅裁取头像部分，用于席位行与玩家档案中展示已拜访的贵族。 */
export function NobleChip({ noble }: { noble: Noble }) {
  return (
    <svg className="sp-noble-chip" viewBox="36 6 48 58" role="img"
      aria-label={'贵族 ' + noble.id}><NobleBust variant={Number(noble.id.slice(1)) - 1} /></svg>
  );
}
