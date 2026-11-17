import type { CSSProperties } from 'react';
import {
  BOARD_CENTER,
  BOARD_SIZE,
  CAMEL_META,
  FINISH_INDEX,
  SEAT_META,
  trackAngleOf,
  trackPointOf,
} from '@/games/camel-up/engine/board';
import type { GameState, MoveStep } from '@/games/camel-up/engine/types';

// ---------------------------------------------------------------- 棋盘几何

/** 赛道中线半径 */
const RING_R = 285;
/** 赛道格外/内半径 */
const TILE_OUTER = 332;
const TILE_INNER = 238;
/** 单格角半宽（含间隙） */
const HALF_ANG = 10.2;
/** 骆驼堆叠基准半径与层间距（沿径向向外叠放 = 骆驼的"上方"） */
const STACK_BASE = 286;
const STACK_GAP = 12.5;
/** 格号圆牌半径 */
const MEDAL_R = 221;
/** 外圈装饰带 */
const APRON_OUT = 378;
/** 凯旋区（终点桶的专属展示带）：径向范围与角度跨度 */
const LANE_OUT = 376;
const LANE_IN = 338;
const LANE_RIDE = 352;
const LANE_A1 = -128;
const LANE_A2 = -52;
/** 凯旋区相邻骆驼的角距 */
const LANE_SPAN = 15;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** 场景坐标：角度制极坐标转 x/y（0° 在正上方前的角度体系由 trackAngleOf 决定） */
const pt = (r: number, deg: number) => ({
  x: BOARD_CENTER + Math.cos(rad(deg)) * r,
  y: BOARD_CENTER + Math.sin(rad(deg)) * r,
});

/** 生成第 pos 格扇环瓦片路径 */
function tilePath(pos: number): string {
  const mid = trackAngleOf(pos);
  const a1 = mid - HALF_ANG;
  const a2 = mid + HALF_ANG;
  const p1 = pt(TILE_INNER, a1);
  const p2 = pt(TILE_OUTER, a1);
  const p3 = pt(TILE_OUTER, a2);
  const p4 = pt(TILE_INNER, a2);
  return [
    `M ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${TILE_OUTER} ${TILE_OUTER} 0 0 1 ${p3.x} ${p3.y}`,
    `L ${p4.x} ${p4.y}`,
    `A ${TILE_INNER} ${TILE_INNER} 0 0 0 ${p1.x} ${p1.y}`,
    'Z',
  ].join(' ');
}

/** 完整圆环路径（外圈逆时针 + 内圈顺时针，nonzero 填充即成环带） */
function ringPath(rOut: number, rIn: number): string {
  return [
    `M ${BOARD_CENTER - rOut} ${BOARD_CENTER}`,
    `A ${rOut} ${rOut} 0 1 0 ${BOARD_CENTER + rOut} ${BOARD_CENTER}`,
    `A ${rOut} ${rOut} 0 1 0 ${BOARD_CENTER - rOut} ${BOARD_CENTER}`,
    `M ${BOARD_CENTER - rIn} ${BOARD_CENTER}`,
    `A ${rIn} ${rIn} 0 1 1 ${BOARD_CENTER + rIn} ${BOARD_CENTER}`,
    `A ${rIn} ${rIn} 0 1 1 ${BOARD_CENTER - rIn} ${BOARD_CENTER}`,
    'Z',
  ].join(' ');
}

/** 弧形带路径（凯旋区等扇环装饰，a1 < a2 顺时针） */
function bandPath(rOut: number, rIn: number, a1: number, a2: number): string {
  const o1 = pt(rOut, a1);
  const o2 = pt(rOut, a2);
  const i2 = pt(rIn, a2);
  const i1 = pt(rIn, a1);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOut} ${rOut} 0 0 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${rIn} ${rIn} 0 0 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ');
}

/** 弧线路径（供 textPath 与描边复用） */
function arcPath(r: number, a1: number, a2: number): string {
  const p1 = pt(r, a1);
  const p2 = pt(r, a2);
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 1 ${p2.x} ${p2.y}`;
}

// ---------------------------------------------------------------- 高亮推导

interface Highlight {
  /** 需要呼吸脉冲 + 奔跑起伏的骆驼色 */
  camels: Set<number>;
  /** 需要呼吸脉冲的格号（地形块） */
  tiles: Set<number>;
  /** 需要呼吸脉冲的腿注色堆 */
  tickets: Set<number>;
  /** 需要呼吸脉冲的押注牌堆 */
  piles: Set<'winner' | 'loser'>;
  /** 骰子塔正在摇骰 */
  rolling: boolean;
  /** 本次摇出的骰子色 */
  rolled: number | null;
}

/** 从呈现步骤推导棋盘动效高亮的元素集合 */
function highlightOf(step: MoveStep | null, state: GameState): Highlight {
  const hl: Highlight = { camels: new Set(), tiles: new Set(), tickets: new Set(), piles: new Set(), rolling: false, rolled: null };
  if (!step) return hl;
  switch (step.kind) {
    case 'dieRoll':
      hl.camels.add(step.color);
      hl.rolled = step.color;
      hl.rolling = true;
      break;
    case 'camelMove':
      hl.camels.add(step.color);
      break;
    case 'desertTrigger': {
      hl.camels.add(step.color);
      const pos = state.players[step.owner].desert.pos;
      if (pos !== null) hl.tiles.add(pos);
      break;
    }
    case 'desert':
      hl.tiles.add(step.pos);
      break;
    case 'legBet':
      hl.tickets.add(step.color);
      break;
    case 'raceBet':
      hl.piles.add(step.target);
      break;
    case 'pyramid':
      hl.rolling = true;
      break;
    default:
      break;
  }
  return hl;
}

// ---------------------------------------------------------------- 沙漠场景

/** 远景：天空渐变、落日、沙丘与金字塔剪影，仅露出棋盘四角 */
function Backdrop() {
  return (
    <g>
      <rect x={0} y={0} width={BOARD_SIZE} height={BOARD_SIZE} fill="url(#cmp-sky)" />
      {/* 落日与光晕 */}
      <circle cx={618} cy={112} r={72} className="cmp-sun-halo" />
      <circle cx={618} cy={112} r={44} className="cmp-sun" />
      {/* 星点（浅色主题下退为淡金斑点） */}
      {[
        [86, 96], [176, 58], [300, 40], [470, 30], [700, 210],
        [58, 250], [712, 330], [40, 420], [726, 470], [150, 130],
      ].map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={index % 3 === 0 ? 2.4 : 1.6} className="cmp-star" />
      ))}
      {/* 地平沙丘：大椭圆藏在棋盘后，只在角落露出 */}
      <ellipse cx={380} cy={940} rx={620} ry={230} className="cmp-dune cmp-dune-far" />
      <ellipse cx={80} cy={880} rx={380} ry={200} className="cmp-dune cmp-dune-near" />
      {/* 金字塔剪影（左下角） */}
      <path d="M28 748 L118 606 L212 748 Z" className="cmp-silhouette" />
      <path d="M150 748 L216 648 L286 748 Z" className="cmp-silhouette cmp-silhouette-2" />
      {/* 棕榈剪影（右下角） */}
      <g transform="translate(690 742) scale(1.5)" className="cmp-palm cmp-palm-silhouette">
        <path d="M0 0 C-3 -12 0 -26 4 -38" className="cmp-palm-trunk" />
        <path d="M4 -38 q-18 -8 -28 2 M4 -38 q-14 -14 -2 -22 M4 -38 q6 -18 20 -16 M4 -38 q18 -4 24 8 M4 -38 q-4 -16 -14 -20" className="cmp-palm-frond" />
      </g>
    </g>
  );
}

/** 单株棕榈（棋盘场地装饰） */
function Palm({ x, y, scale = 1, flip = false }: { x: number; y: number; scale?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`} className="cmp-palm">
      <ellipse cx={2} cy={5} rx={13} ry={4} className="cmp-palm-mound" />
      <path d="M0 5 C-2 -6 1 -18 5 -30" className="cmp-palm-trunk" />
      <path
        d="M5 -30 q-16 -9 -26 1 M5 -30 q-12 -13 -1 -21 M5 -30 q7 -17 19 -14 M5 -30 q16 -3 22 9 M5 -30 q-3 -15 -13 -19"
        className="cmp-palm-frond"
      />
      <circle cx={3} cy={-27} r={1.8} className="cmp-palm-nut" />
      <circle cx={7} cy={-26} r={1.8} className="cmp-palm-nut" />
    </g>
  );
}

// ---------------------------------------------------------------- 棋子与元素

interface CamelIconProps {
  color: number;
  /** 呼吸脉冲（本步主角） */
  pulse: boolean;
  /** 奔跑起伏（正在移动的骆驼） */
  racing: boolean;
  /** 当前领跑者（头顶小金旗） */
  leader: boolean;
}

/** 单峰骆驼侧影（面向 +x，脚在 y≈+13），鞍毯 + 金饰 + 落影 */
function CamelIcon({ color, pulse, racing, leader }: CamelIconProps) {
  const meta = CAMEL_META[color];
  return (
    <g
      className={pulse ? 'camel-breathe' : undefined}
      style={{ '--glow': meta.color } as CSSProperties}
    >
      <ellipse cx={0} cy={14.2} rx={15.5} ry={3.4} className="camel-foot-shadow" />
      <g className={racing ? 'camel-body camel-racing' : 'camel-body'}>
        <g fill={meta.color} stroke={meta.stroke} strokeWidth={1.3} strokeLinecap="round">
          {/* 四条腿 */}
          <rect x={-14} y={-2} width={4.4} height={14} rx={2.1} />
          <rect x={-5.5} y={-2} width={4.4} height={14} rx={2.1} />
          <rect x={6} y={-2} width={4.4} height={14} rx={2.1} />
          <rect x={14} y={-2} width={4.4} height={14} rx={2.1} />
          {/* 躯干与驼峰 */}
          <ellipse cx={0} cy={-5} rx={15.5} ry={8.6} />
          <circle cx={-2} cy={-13.5} r={7.6} />
        </g>
        {/* 鞍毯：深色坐垫压在驼峰上，一条金线收边 */}
        <rect x={-10.5} y={-20.5} width={13.5} height={12.5} rx={3.4} fill={meta.stroke} opacity={0.95} />
        <path d="M-9.2 -17.6 h11.6" stroke="var(--cmp-gold)" strokeWidth={1.5} strokeLinecap="round" opacity={0.92} fill="none" />
        {/* 颈、头、耳与吻部 */}
        <path d="M11 -8 L20.5 -20.5" stroke={meta.color} strokeWidth={7.4} strokeLinecap="round" fill="none" />
        <ellipse cx={24.5} cy={-22.5} rx={6.6} ry={4.6} transform="rotate(18 24.5 -22.5)" fill={meta.color} stroke={meta.stroke} strokeWidth={1.3} />
        <path d="M24 -28.5 L26 -32.5 L28.5 -28 Z" fill={meta.color} stroke={meta.stroke} strokeWidth={1.1} />
        <circle cx={30} cy={-20} r={3} fill={meta.color} stroke={meta.stroke} strokeWidth={1.1} />
        <circle cx={26.5} cy={-24} r={1.3} fill="var(--cmp-die-ink)" stroke="none" />
        {/* 尾巴 */}
        <path d="M-14.5 -6 q-5.5 2.5 -4 9.5" stroke={meta.stroke} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        {/* 领跑小金旗 */}
        {leader ? (
          <g className="cmp-leader-flag">
            <path d="M13 -34 V-54" stroke="var(--cmp-gold-deep)" strokeWidth={1.8} strokeLinecap="round" />
            <path d="M13 -54 L28 -49 L13 -43.5 Z" fill="var(--cmp-gold)" stroke="var(--cmp-gold-deep)" strokeWidth={1} />
          </g>
        ) : null}
      </g>
    </g>
  );
}

/** 沙漠地形块：绿洲（棕榈）/ 海市蜃楼（热浪），描边为持有者座位色 */
function DesertToken({ pos, face, owner, pulse }: { pos: number; face: string; owner: number; pulse: boolean }) {
  const point = trackPointOf(pos, 253);
  return (
    <g
      transform={`translate(${point.x} ${point.y}) rotate(${trackAngleOf(pos) + 90})`}
      className={pulse ? 'camel-desert camel-breathe' : 'camel-desert'}
      data-face={face}
      style={{ '--glow': face === 'oasis' ? 'var(--camel-oasis)' : 'var(--camel-mirage)' } as CSSProperties}
    >
      <rect x={-14} y={-14} width={28} height={28} rx={7.5} className="camel-desert-bg" stroke={SEAT_META[owner].color} strokeWidth={2.2} />
      {face === 'oasis' ? (
        <g className="cmp-desert-palm">
          <path d="M0 7 C-0.8 3 0.4 -1 1.6 -4.5" fill="none" stroke="var(--cmp-die-ink)" strokeWidth={1.8} strokeLinecap="round" />
          <path
            d="M1.6 -4.5 q-5.5 -3 -9 0.5 M1.6 -4.5 q-4 -5 0 -7.5 M1.6 -4.5 q5 -4.5 8.5 -1.5 M1.6 -4.5 q5.5 -1 7.5 3"
            fill="none"
            stroke="var(--cmp-die-ink)"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <path d="M-6 8 q6 2.5 12 0" fill="none" stroke="var(--cmp-die-ink)" strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
        </g>
      ) : (
        <g fill="none" stroke="var(--cmp-die-ink)" strokeWidth={1.7} strokeLinecap="round">
          <path d="M-8 -3 q4 -3.5 8 0 t8 0" />
          <path d="M-8 2.5 q4 -3.5 8 0 t8 0" opacity={0.85} />
          <path d="M-5 8 q4 -3 8 0 t8 0" opacity={0.6} />
        </g>
      )}
      {/* 持有者角标 */}
      <circle cx={10.5} cy={-10.5} r={4.2} fill={SEAT_META[owner].color} stroke="var(--cmp-stage-1)" strokeWidth={1.4} />
    </g>
  );
}

/** 一颗骰子：驼色底 + 1-3 点 */
function DieIcon({ x, y, color, value, pulse }: { x: number; y: number; color: number; value: number; pulse: boolean }) {
  const meta = CAMEL_META[color];
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-6.5, -6.5], [6.5, 6.5]],
    3: [[-6.5, -6.5], [0, 0], [6.5, 6.5]],
  };
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* 动画作用在内层：CSS transform 动画不会覆盖外层的属性 transform 定位 */}
      <g
        className={pulse ? 'camel-die camel-breathe' : 'camel-die'}
        style={{ '--glow': meta.color } as CSSProperties}
      >
        <rect x={-15} y={-15} width={30} height={30} rx={8.5} fill={meta.color} stroke={meta.stroke} strokeWidth={1.6} />
        <rect x={-11} y={-13.5} width={22} height={10} rx={5} fill="#ffffff" opacity={0.28} stroke="none" />
        {(pips[value] ?? []).map(([px, py], index) => (
          <circle key={index} cx={px} cy={py} r={3.2} fill="var(--cmp-die-ink)" />
        ))}
      </g>
    </g>
  );
}

/** 腿注票架：堆顶票面可见，余量以错位叠层暗示 */
function TicketStand({ x, y, color, values, pulse }: { x: number; y: number; color: number; values: number[]; pulse: boolean }) {
  const meta = CAMEL_META[color];
  // 自底向顶绘制，堆顶（values[0]）最后落笔画在最前
  const layers = [...values].reverse();
  return (
    <g
      transform={`translate(${x} ${y})`}
      className={pulse ? 'camel-breathe' : undefined}
      style={{ '--glow': meta.color } as CSSProperties}
    >
      <rect x={-20} y={-31} width={40} height={62} rx={9} className="cmp-stand" />
      {layers.length === 0 ? (
        <rect x={-14} y={-24} width={28} height={42} rx={6.5} className="cmp-ticket-ghost" />
      ) : (
        layers.map((value, index) => (
          <g key={index} transform={`translate(${-index * 2.6} ${8 - index * 7.5})`}>
            <rect x={-14.5} y={-22} width={29} height={44} rx={6} fill={meta.color} stroke={meta.stroke} strokeWidth={1.3} opacity={index === layers.length - 1 ? 1 : 0.9} />
            <text x={0} y={6} textAnchor="middle" className="cmp-ticket-value" fill="var(--cmp-die-ink)">
              {value}
            </text>
            <path d="M-8 14 h16" stroke="var(--cmp-gold)" strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />
          </g>
        ))
      )}
      <text x={0} y={46} textAnchor="middle" className="cmp-stand-label" fill="var(--cmp-ink-dim)">
        {meta.name.slice(0, 1)}
      </text>
    </g>
  );
}

/** 总冠/总末名押注看板：明注牌叠放 + 张数角标 */
function BetBoard({ x, y, title, target, bets, pulse }: {
  x: number;
  y: number;
  title: string;
  target: 'winner' | 'loser';
  bets: { player: number; color: number }[];
  pulse: boolean;
}) {
  const recent = bets.slice(-5);
  return (
    <g
      transform={`translate(${x} ${y})`}
      className={pulse ? 'camel-breathe' : undefined}
      style={{ '--glow': target === 'winner' ? 'var(--cmp-gold)' : 'var(--camel-mirage)' } as CSSProperties}
    >
      <rect x={-44} y={-58} width={88} height={116} rx={13} className="cmp-betboard" />
      <path d="M-44 -45 L-44 -45 a13 13 0 0 1 13 -13 h62 a13 13 0 0 1 13 13 Z" className={`cmp-betboard-head cmp-betboard-head-${target}`} />
      <text x={0} y={-41} textAnchor="middle" className="cmp-betboard-title" fill="var(--cmp-ink)">
        {title}
      </text>
      {recent.length === 0 ? (
        <g>
          <rect x={-32} y={-18} width={64} height={44} rx={7} className="cmp-betboard-empty" />
          <text x={0} y={8} textAnchor="middle" className="cmp-betboard-empty-text" fill="var(--cmp-ink-dim)">
            虚位以待
          </text>
        </g>
      ) : (
        recent.map((bet, index) => {
          const meta = CAMEL_META[bet.color];
          return (
            <g key={`${bet.player}-${bet.color}`} transform={`translate(0 ${-14 + index * 12.4})`}>
              <rect x={-33} y={-5.4} width={66} height={11.4} rx={4} fill={meta.color} stroke={meta.stroke} strokeWidth={1} />
              <circle cx={-24} cy={0.2} r={3.4} fill={SEAT_META[bet.player].color} stroke="var(--cmp-hub-card)" strokeWidth={1.2} />
            </g>
          );
        })
      )}
      <circle cx={34} cy={-48} r={10.5} className="cmp-betboard-badge" />
      <text x={34} y={-44.4} textAnchor="middle" className="cmp-betboard-count">
        {bets.length}
      </text>
    </g>
  );
}

/** 骰子塔（金字塔）：砖纹 + 金顶 + 出料口与余量签 */
function PyramidIcon({ remaining, rolling, pulse }: { remaining: number; rolling: boolean; pulse: boolean }) {
  // 砖缝横线：随金字塔收窄逐层缩短
  const tiers = [258, 288, 318].map((y) => {
    const half = ((y - 216) / (346 - 216)) * 76;
    return { y, half };
  });
  return (
    <g
      className={rolling ? 'camel-pyramid camel-shake' : pulse ? 'camel-pyramid camel-breathe' : 'camel-pyramid'}
      style={{ '--glow': 'var(--cmp-gold)' } as CSSProperties}
    >
      <circle cx={380} cy={252} r={58} className="cmp-pyramid-halo" />
      <path d="M380 216 L456 346 L304 346 Z" className="cmp-pyramid-face" />
      <path d="M380 216 L456 346 L380 346 Z" className="cmp-pyramid-shade" />
      {tiers.map(({ y, half }) => (
        <path key={y} d={`M${380 - half} ${y} H${380 + half}`} className="cmp-pyramid-brick" />
      ))}
      <path d="M352 288 h10 M406 288 h10 M332 318 h10 M368 318 h10 M404 318 h10" className="cmp-pyramid-brick" />
      {/* 金字塔顶 */}
      <path d="M380 216 L390.5 236 L369.5 236 Z" fill="var(--cmp-gold)" stroke="var(--cmp-gold-deep)" strokeWidth={1.2} />
      {/* 出料口与余量签 */}
      <rect x={362} y={328} width={36} height={18} rx={4} className="cmp-pyramid-door" />
      <rect x={404} y={325} width={50} height={22} rx={11} className="cmp-pyramid-pill" />
      <text x={429} y={340.5} textAnchor="middle" className="cmp-pyramid-pill-text" fill="var(--cmp-ink)">
        剩 {remaining}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------- 主组件

interface BoardProps {
  /** 待渲染的局面（回放时为历史帧） */
  state: GameState;
  /** 正在呈现的步骤，用于动效高亮 */
  activeStep: MoveStep | null;
}

/** 计算 camel-actor 变换（平移到落点并沿赛道方向旋转） */
function actorTransform(pos: number, radius: number): string {
  const point = trackPointOf(pos, radius);
  return `translate(${point.x} ${point.y}) rotate(${trackAngleOf(pos) + 90})`;
}

/**
 * 骆驼大赛环形赛道棋盘：沙漠全景 + 16 格扇环赛道、终点凯旋区、鞍毯骆驼堆叠、
 * 金字塔骰子塔、腿注票架与总冠/末名押注看板，全部以 SVG 精绘。
 *
 * @param props 局面快照与当前呈现步骤
 * @returns 可缩放的 SVG 棋盘
 */
export function Board({ state, activeStep }: BoardProps) {
  const hl = highlightOf(activeStep, state);
  const finishers = state.stacks[FINISH_INDEX];

  // 领跑者 = 终点桶之外最深堆叠的堆顶骆驼，头顶小金旗标记
  let leader: number | null = null;
  for (let pos = FINISH_INDEX - 1; pos >= 0; pos -= 1) {
    const stack = state.stacks[pos];
    if (stack.length > 0) {
      leader = stack[stack.length - 1];
      break;
    }
  }

  return (
    <svg viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`} className="camel-board board-svg" role="img" aria-label="骆驼大赛环形赛道">
      <defs>
        <linearGradient id="cmp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--cmp-sky-1)" />
          <stop offset="0.62" stopColor="var(--cmp-sky-2)" />
          <stop offset="1" stopColor="var(--cmp-sky-3)" />
        </linearGradient>
        <linearGradient id="cmp-apron-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--cmp-apron)" />
          <stop offset="1" stopColor="var(--cmp-apron-2)" />
        </linearGradient>
        <pattern id="cmp-zig" width={26} height={14} patternUnits="userSpaceOnUse">
          <path d="M0 12 L6.5 3 L13 12 L19.5 3 L26 12" fill="none" stroke="var(--cmp-gold)" strokeWidth={1.6} opacity={0.45} />
        </pattern>
        <pattern id="cmp-checker" width={11} height={11} patternUnits="userSpaceOnUse">
          <rect width={11} height={11} fill="var(--cmp-apron)" />
          <rect width={5.5} height={5.5} fill="var(--cmp-ink)" />
          <rect x={5.5} y={5.5} width={5.5} height={5.5} fill="var(--cmp-ink)" />
        </pattern>
      </defs>

      <Backdrop />

      {/* 外圈装饰带 + 回纹饰带 */}
      <path d={ringPath(APRON_OUT, TILE_OUTER)} fill="url(#cmp-apron-grad)" />
      <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={APRON_OUT} className="cmp-apron-edge" />
      <path d={ringPath(368, 346)} fill="url(#cmp-zig)" opacity={0.5} />

      {/* 流向指示箭头（避开顶部凯旋区） */}
      {[2.5, 6.5, 10.5, 13.5].map((pos) => {
        const angle = trackAngleOf(pos);
        const point = trackPointOf(pos, 357);
        return (
          <path
            key={pos}
            d="M-8 -6.5 L8 0 L-8 6.5"
            transform={`translate(${point.x} ${point.y}) rotate(${angle + 90})`}
            className="cmp-chevron"
            fill="none"
          />
        );
      })}

      {/* 终点凯旋区：终点桶骆驼在此列队，双柱拱门 + 弧形题字 */}
      <path d={bandPath(LANE_OUT, LANE_IN, LANE_A1, LANE_A2)} className="cmp-lane" />
      <path d={arcPath(LANE_OUT - 2, LANE_A1, LANE_A2)} className="cmp-lane-edge" fill="none" />
      <path d={arcPath(LANE_IN + 2, LANE_A1, LANE_A2)} className="cmp-lane-edge" fill="none" />
      <path d={`M${pt(336, LANE_A1 + 3).x} ${pt(336, LANE_A1 + 3).y} L${pt(381, LANE_A1 + 3).x} ${pt(381, LANE_A1 + 3).y}`} className="cmp-lane-pillar" />
      <path d={`M${pt(336, LANE_A2 - 3).x} ${pt(336, LANE_A2 - 3).y} L${pt(381, LANE_A2 - 3).x} ${pt(381, LANE_A2 - 3).y}`} className="cmp-lane-pillar" />
      <path id="cmp-lane-arc" d={arcPath(343.5, LANE_A1 + 14, LANE_A2 - 14)} fill="none" />
      <text className="cmp-lane-label" fill="var(--cmp-ink-dim)">
        <textPath href="#cmp-lane-arc" startOffset="50%" textAnchor="middle">
          终 点 · 凯 旋 区
        </textPath>
      </text>

      {/* 场地（沙盘）与分隔金环 */}
      <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={TILE_INNER} className="cmp-arena" />
      <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={TILE_INNER - 30} className="cmp-arena-ring" />
      <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={TILE_INNER + 1} className="cmp-arena-sep" />

      {/* 场地棕榈（避开骰塔/看板/票架） */}
      <Palm x={268} y={210} />
      <Palm x={492} y={210} flip />
      <Palm x={252} y={436} />
      <Palm x={508} y={436} flip />

      {/* 赛道底环与 16 格扇环瓦片 */}
      <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={RING_R} className="camel-ring-base" strokeWidth={TILE_OUTER - TILE_INNER} />
      {Array.from({ length: FINISH_INDEX }, (_, pos) => (
        <path key={pos} d={tilePath(pos)} className="camel-tile" data-first={pos === 0} />
      ))}

      {/* 起点小旗（第 1 格永不放地形块，此位安全） */}
      <g transform={`translate(${trackPointOf(0, 249).x} ${trackPointOf(0, 249).y})`}>
        <path d="M0 9 V-10" stroke="var(--cmp-gold-deep)" strokeWidth={2} strokeLinecap="round" fill="none" />
        <path d="M0 -10 L13 -5.5 L0 -1 Z" fill="var(--cmp-gold)" stroke="var(--cmp-gold-deep)" strokeWidth={1} />
      </g>

      {/* 终点线：棋盘格纹横跨赛道 */}
      <g transform={`translate(${trackPointOf(FINISH_INDEX - 0.5, RING_R).x} ${trackPointOf(FINISH_INDEX - 0.5, RING_R).y}) rotate(${trackAngleOf(FINISH_INDEX - 0.5)})`}>
        <rect x={-9} y={-(TILE_OUTER - TILE_INNER) / 2 - 5} width={18} height={TILE_OUTER - TILE_INNER + 10} className="camel-finish" />
      </g>

      {/* 格号圆牌 */}
      {Array.from({ length: FINISH_INDEX }, (_, pos) => {
        const point = trackPointOf(pos, MEDAL_R);
        return (
          <g key={pos}>
            <circle cx={point.x} cy={point.y} r={10.5} className="cmp-medal" data-first={pos === 0} />
            <text x={point.x} y={point.y + 3.8} textAnchor="middle" className="cmp-medal-num">
              {pos + 1}
            </text>
          </g>
        );
      })}

      {/* 沙漠地形块 */}
      {state.players.map((player, owner) =>
        player.desert.pos === null ? null : (
          <DesertToken
            key={owner}
            pos={player.desert.pos}
            face={player.desert.face}
            owner={state.seats[owner]}
            pulse={hl.tiles.has(player.desert.pos)}
          />
        ),
      )}

      {/* 中央区：骰子塔、五颗骰子 */}
      <PyramidIcon remaining={state.pyramidRemaining} rolling={hl.rolling} pulse={hl.rolling} />
      {CAMEL_META.map((meta, color) => {
        const value = state.diceValues[color];
        const x = 292 + color * 44;
        return value === null ? (
          <g key={color} transform={`translate(${x} 398)`} className="cmp-die-hidden">
            <rect x={-15} y={-15} width={30} height={30} rx={8.5} className="cmp-die-ghost" />
            <circle cx={0} cy={0} r={3.4} fill={meta.color} opacity={0.8} />
          </g>
        ) : (
          <DieIcon key={color} x={x} y={398} color={color} value={value} pulse={hl.rolled === color} />
        );
      })}

      {/* 腿注票架 */}
      {CAMEL_META.map((_meta, color) => (
        <TicketStand
          key={color}
          x={250 + color * 65}
          y={505}
          color={color}
          values={state.legStacks[color]}
          pulse={hl.tickets.has(color)}
        />
      ))}

      {/* 总冠 / 总末名押注看板 */}
      <BetBoard x={254} y={292} title="总冠" target="winner" bets={state.winnerPile} pulse={hl.piles.has('winner')} />
      <BetBoard x={506} y={292} title="总末名" target="loser" bets={state.loserPile} pulse={hl.piles.has('loser')} />

      {/* 赛道骆驼堆叠（终点桶走凯旋区） */}
      {state.stacks.flatMap((stack, pos) =>
        pos === FINISH_INDEX
          ? []
          : stack.map((color, index) => {
              const racing = hl.camels.has(color);
              return (
                <g key={color} className="camel-actor" transform={`${actorTransform(pos, STACK_BASE + index * STACK_GAP)} scale(1.1)`}>
                  <CamelIcon color={color} pulse={racing} racing={racing} leader={color === leader} />
                </g>
              );
            }),
      )}

      {/* 凯旋区列队：到达顺序自左向右，头顶名次奖牌 */}
      {finishers.map((color, index) => {
        const angle = -90 + (index - (finishers.length - 1) / 2) * LANE_SPAN;
        const point = trackPointOf(angle, LANE_RIDE);
        return (
          <g key={color} className="camel-actor" transform={`translate(${point.x} ${point.y}) rotate(${angle + 90}) scale(0.72)`}>
            <CamelIcon color={color} pulse={false} racing={false} leader={false} />
            <g className="cmp-rank">
              <circle cx={0} cy={-38} r={8} fill="var(--cmp-gold)" stroke="var(--cmp-gold-deep)" strokeWidth={1.2} />
              <text x={0} y={-34.4} textAnchor="middle" className="cmp-rank-num">
                {index + 1}
              </text>
            </g>
          </g>
        );
      })}

      {/* 终局彩带：胜者决出后飘落 */}
      {state.winner !== null ? (
        <g className="cmp-confetti">
          {[
            [120, 0.2, 4.6, 2.8], [205, 1.1, 3.8, 2.2], [292, 0.6, 5.2, 3], [352, 1.7, 4.1, 2.4],
            [420, 0.35, 4.9, 2.6], [505, 1.35, 3.6, 3.1], [588, 0.85, 4.4, 2.2], [665, 1.9, 5, 2.8],
            [160, 2.3, 4.2, 2.5], [322, 2.75, 3.9, 2.9], [465, 2.15, 4.7, 2.3], [610, 2.5, 4, 2.7],
            [240, 3.1, 4.5, 2.4], [545, 3.4, 3.7, 3], [85, 2.9, 5.1, 2.6], [692, 3.2, 4.3, 2.5],
          ].map(([x, delay, dur, size], index) => (
            <rect
              key={index}
              x={x}
              y={-16}
              width={size}
              height={size * 2.1}
              rx={1.4}
              className="cmp-confetti-bit"
              fill={index % 4 === 0 ? 'var(--cmp-gold)' : CAMEL_META[index % CAMEL_META.length].color}
              style={{ '--delay': `${delay}s`, '--dur': `${dur}s` } as CSSProperties}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
