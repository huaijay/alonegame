import {
  BASE_ORIGINS,
  BASE_SLOTS,
  BOARD_SIZE,
  CELL,
  FINISH_CELLS,
  FLIGHT_OFFSET,
  HOME_LANES,
  SEAT_META,
  START_INDEX,
  TRACK,
  colorOfTrackIndex,
  flightIndex,
  homeAngle,
  toTrackIndex,
  trackAngle,
} from '@/games/ludo/engine/board';
import type { Seat, SeatMeta } from '@/games/ludo/engine/board';
import { FINISH, HOME_FIRST, TRACK_LAST } from '@/games/ludo/engine/types';
import type { GameState } from '@/games/ludo/engine/types';
import { useEffect, useRef } from 'react';

interface BoardProps {
  state: GameState;
  /** 当前行动的玩家序号（用于机库高亮），无则为 null */
  activePlayer: number | null;
  /** 正在移动的飞机（用于脉冲光圈） */
  activePlane: { player: number; plane: number } | null;
  /** 事件脉冲：由最新对局事件驱动的一次性爆发动画，无则为 null */
  pulse: BoardPulse | null;
}

/** 棋盘事件脉冲：触发一次性爆发动画 */
export interface BoardPulse {
  /** 事件唯一 id，用于重放动画 */
  id: number;
  tone: 'jump' | 'fly' | 'capture' | 'finish' | 'win';
  /** 触发事件的座位 */
  seat: Seat;
}

interface Placement {
  player: number;
  plane: number;
  seat: Seat;
  x: number;
  y: number;
  rotation: number;
}

/** 事件脉冲的爆发颜色：踩子危险红、归位/获胜金色、跳跃/飞行用座位色 */
const PULSE_COLORS: Record<BoardPulse['tone'], string | null> = {
  jump: null,
  fly: null,
  capture: '#ff5d78',
  finish: '#ffd166',
  win: '#ffd166',
};

/** 星点装饰：确定函数生成坐标，避免每次渲染随机跳动 */
const STARS = Array.from({ length: 46 }, (_, i) => {
  const hash = (n: number) => {
    const v = Math.sin(i * n) * 10000;
    return v - Math.floor(v);
  };
  return {
    x: 26 + hash(127.1) * 848,
    y: 26 + hash(311.7) * 848,
    r: 0.7 + hash(74.7) * 1.5,
    twinkle: hash(53.3) > 0.45,
    delay: Number((hash(269.5) * 4).toFixed(2)),
  };
});

const START_SET = new Set<number>(START_INDEX);
const FLIGHT_SET = new Set<number>(SEAT_META.map((meta) => flightIndex(meta.seat)));
const BOARD_CENTER = BOARD_SIZE / 2;

/** 整圈流向线：把 52 个跑道格中心串成闭合折线，用于表达顺时针动线 */
const TRACK_FLOW = `${TRACK.map(
  ([row, col], index) =>
    `${index === 0 ? 'M' : 'L'}${(col + 0.5) * CELL} ${(row + 0.5) * CELL}`,
).join(' ')} Z`;

/** 飞机剪影：机头朝上，便于按航向旋转 */
const PLANE_PATH =
  'M0 -18 C2.4 -18 3.8 -16.4 3.8 -13.6 L3.8 -5.2 L15 1.6 L15 4.8 L3.8 2 ' +
  'L3.8 8.6 L8 11.4 L8 13.4 L0 11.6 L-8 13.4 L-8 11.4 L-3.8 8.6 L-3.8 2 ' +
  'L-15 4.8 L-15 1.6 L-3.8 -5.2 L-3.8 -13.6 C-3.8 -16.4 -2.4 -18 0 -18 Z';

/** 计算飞机在棋盘上的显示坐标与朝向（叠加同格偏移） */
function buildPlacements(state: GameState): Placement[] {
  const raw: (Placement & { key: string })[] = [];

  state.planes.forEach((row, player) => {
    const seat = state.seats[player];
    row.forEach((pos, plane) => {
      let key: string;
      let x: number;
      let y: number;
      let rotation: number;

      if (pos < 0) {
        const [originRow, originCol] = BASE_ORIGINS[seat];
        const [slotRow, slotCol] = BASE_SLOTS[plane];
        const cellX = originCol + slotCol;
        const cellY = originRow + slotRow;
        x = cellX * CELL;
        y = cellY * CELL;
        rotation = (Math.atan2(7.5 - cellY, 7.5 - cellX) * 180) / Math.PI + 90;
        key = `base-${seat}-${plane}`;
      } else if (pos <= TRACK_LAST) {
        const absolute = toTrackIndex(seat, pos);
        const [row0, col0] = TRACK[absolute];
        x = (col0 + 0.5) * CELL;
        y = (row0 + 0.5) * CELL;
        rotation = trackAngle(absolute) + 90;
        key = `track-${absolute}`;
      } else if (pos < FINISH) {
        const [row0, col0] = HOME_LANES[seat][pos - HOME_FIRST];
        x = (col0 + 0.5) * CELL;
        y = (row0 + 0.5) * CELL;
        rotation = homeAngle(seat, pos) + 90;
        key = `home-${seat}-${pos}`;
      } else {
        const [row0, col0] = FINISH_CELLS[seat];
        x = (col0 + 0.5) * CELL;
        y = (row0 + 0.5) * CELL;
        rotation = (Math.atan2(7.5 - (row0 + 0.5), 7.5 - (col0 + 0.5)) * 180) / Math.PI + 90;
        key = `finish-${seat}`;
      }

      raw.push({ player, plane, seat, x, y, rotation, key });
    });
  });

  // 同格飞机做环形偏移，避免完全重叠
  const counts = new Map<string, number>();
  raw.forEach((item) => counts.set(item.key, (counts.get(item.key) ?? 0) + 1));
  const cursor = new Map<string, number>();

  return raw.map((item) => {
    const total = counts.get(item.key) ?? 1;
    const index = cursor.get(item.key) ?? 0;
    cursor.set(item.key, index + 1);
    if (total <= 1) return item;

    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    const radius = (total === 2 ? 0.14 : 0.18) * CELL;
    return {
      ...item,
      x: item.x + Math.cos(angle) * radius,
      y: item.y + Math.sin(angle) * radius,
    };
  });
}

/**
 * 机库：占满 5×5 角区的基地平台
 *
 * 结构（由外到内）：外场停机坪 → 平台本体 → 内衬虚线 →
 * 中央雷达塔（旋转扫掠，行动方加速）→ 机库名牌 → 起飞闸门 → 2×2 停机位
 */
function Hangar({
  meta,
  active,
  basePositions,
}: {
  meta: SeatMeta;
  active: boolean;
  basePositions: number[];
}) {
  const [row, col] = BASE_ORIGINS[meta.seat];
  const x = col * CELL;
  const y = row * CELL;
  // 5×5 角区的几何中心
  const cx = x + 2.5 * CELL;
  const cy = y + 2.5 * CELL;
  // 上半区机库门朝下（+y）面向棋盘中心，下半区朝上（-y）
  const inward = row < 7.5 ? 1 : -1;
  // 起飞闸门：三道 chevron，越靠近门口越亮
  const gateOffsets = [104, 118, 130];
  const gateOpacity = [0.2, 0.36, 0.55];
  // 各停机位占用状态：-1 表示该序号飞机停在机库，同时驱动停机位编号与雷达光点
  const padOccupied = BASE_SLOTS.map(
    (_, index) => basePositions[index] !== undefined && basePositions[index] < 0,
  );
  // 雷达扫掠元素与其 WAAPI 旋转动画：动画只创建一次，变速不重置旋转相位
  const sweepRef = useRef<SVGGElement>(null);
  const sweepAnimRef = useRef<Animation | null>(null);

  // 挂载时创建持续旋转动画；系统偏好「减少动态」时暂停，偏好变化时实时暂停/恢复
  useEffect(() => {
    const el = sweepRef.current;
    if (!el) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 9000, iterations: Infinity },
    );
    sweepAnimRef.current = anim;
    if (mq.matches) anim.pause();
    const onChange = () => (mq.matches ? anim.pause() : anim.play());
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      anim.cancel();
      sweepAnimRef.current = null;
    };
  }, []);

  // 行动方切换：仅在原相位上无缝调速（updatePlaybackRate 保证不跳变），普通态恢复原速
  useEffect(() => {
    const anim = sweepAnimRef.current;
    if (!anim) return;
    const rate = active ? 2.6 : 1;
    if (typeof anim.updatePlaybackRate === 'function') {
      anim.updatePlaybackRate(rate);
    } else {
      anim.playbackRate = rate;
    }
  }, [active]);

  return (
    <g>
      {/* 外场停机坪：占满整个角区，带网格纹理与座位色描边 */}
      <rect
        x={x + 8}
        y={y + 8}
        width={5 * CELL - 16}
        height={5 * CELL - 16}
        rx={26}
        style={{ fill: 'var(--board-apron)' }}
        stroke={meta.color}
        strokeOpacity={0.28}
        strokeWidth={1.2}
      />
      <rect
        x={x + 8}
        y={y + 8}
        width={5 * CELL - 16}
        height={5 * CELL - 16}
        rx={26}
        fill="url(#apron-grid)"
        opacity={0.75}
      />

      {/* 平台本体：行动方加亮描边并投射座位色光晕 */}
      <rect
        x={x + 16}
        y={y + 16}
        width={5 * CELL - 32}
        height={5 * CELL - 32}
        rx={20}
        style={{
          fill: `color-mix(in srgb, ${meta.color} 12%, var(--board-hangar))`,
          filter: active ? `drop-shadow(0 0 16px ${meta.color}55)` : undefined,
        }}
        stroke={meta.color}
        strokeOpacity={active ? 0.95 : 0.55}
        strokeWidth={active ? 2.6 : 1.5}
      />

      {/* 内衬虚线：贴着平台内侧走一圈 */}
      <rect
        x={x + 26}
        y={y + 26}
        width={5 * CELL - 52}
        height={5 * CELL - 52}
        rx={14}
        fill="none"
        style={{ stroke: 'var(--board-hangar-line)' }}
        strokeDasharray="9 9"
      />

      {/* 中央雷达塔：圆形基座 + 旋转扫掠 + 占用光点 + 中心触点 */}
      <g transform={`translate(${cx} ${cy})`}>
        <circle r={30} style={{ fill: 'var(--board-pad)' }} stroke={meta.color} strokeOpacity={0.6} strokeWidth={1.5} />
        <g ref={sweepRef} className="hangar-sweep">
          {/* 校准环：让扫掠组的包围盒以雷达圆心对称，旋转才绕圆心 */}
          <circle r={24} fill="none" />
          {/* 扫掠叶：激活时通过透明度过渡加深颜色，旋转相位不受影响 */}
          <path
            d="M0 0 L20.8 -12 A 24 24 0 0 1 20.8 12 Z"
            fill={meta.color}
            style={{ transition: 'opacity 0.4s ease' }}
            opacity={active ? 0.45 : 0.2}
          />
        </g>
        <circle
          r={24}
          fill="none"
          stroke={meta.color}
          style={{ transition: 'stroke-opacity 0.4s ease' }}
          strokeOpacity={active ? 0.55 : 0.32}
          strokeDasharray="2 5"
        />
        {/* 占用光点：雷达记录各停机位状态，光点象限与 2×2 停机位一一对应 */}
        {padOccupied.map((occupied, index) =>
          occupied ? (
            <circle
              key={`blip-${index}`}
              className="radar-blip"
              cx={BASE_SLOTS[index][1] < 2.5 ? -10 : 10}
              cy={BASE_SLOTS[index][0] < 2.5 ? -10 : 10}
              r={2.4}
              fill={meta.color}
              style={{ animationDelay: `${index * 0.5}s` }}
            />
          ) : null,
        )}
        <circle r={2.6} fill={meta.color} opacity={0.9} />
      </g>

      {/* 机库名牌：雷达塔上下两行 */}
      <text
        x={cx}
        y={cy - 42}
        textAnchor="middle"
        fontSize={11.5}
        letterSpacing={2.4}
        fill={meta.color}
        opacity={0.92}
      >
        {`${meta.name}机库`}
      </text>
      <text
        x={cx}
        y={cy + 48}
        textAnchor="middle"
        fontSize={7}
        letterSpacing={2.6}
        fill={meta.color}
        opacity={0.6}
      >
        {`HANGAR 0${meta.seat + 1}`}
      </text>

      {/* 起飞闸门：朝棋盘中心的三道 chevron */}
      {gateOffsets.map((offset, index) => (
        <path
          key={`gate-${index}`}
          d="M-7 -3.2 L0 3.2 L7 -3.2"
          transform={`translate(${cx} ${cy + inward * offset}) scale(1 ${inward})`}
          fill="none"
          stroke={meta.color}
          strokeOpacity={gateOpacity[index]}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {/* 四个停机位：2×2 占满角区四角 */}
      {BASE_SLOTS.map((slot, index) => {
        const padX = x + slot[1] * CELL;
        const padY = y + slot[0] * CELL;
        const occupied = padOccupied[index];
        return (
          <g key={`pad-${index}`}>
            <circle
              cx={padX}
              cy={padY}
              r={CELL * 0.36}
              style={{ fill: 'var(--board-pad)' }}
              stroke={meta.color}
              strokeOpacity={occupied ? 0.42 : 0.75}
              strokeWidth={1.5}
            />
            <circle
              cx={padX}
              cy={padY}
              r={CELL * 0.23}
              fill="none"
              stroke={meta.color}
              strokeOpacity={0.3}
              strokeDasharray="3 4"
            />
            {!occupied ? (
              <text
                x={padX}
                y={padY + 4}
                textAnchor="middle"
                fontSize={11}
                fill={meta.color}
                opacity={0.65}
              >
                {index + 1}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** 起点格的起飞标记：虚线框缓慢呼吸 */
function StartMark({ meta, x, y }: { meta: SeatMeta; x: number; y: number }) {
  return (
    <g transform={`translate(${x + CELL / 2} ${y + CELL / 2})`}>
      <rect
        className="start-mark"
        x={-18}
        y={-18}
        width={36}
        height={36}
        rx={8}
        fill="none"
        stroke={meta.color}
        strokeOpacity={0.55}
        strokeDasharray="5 4"
      />
      <path
        d="M-6 6 L2 -4 L10 6"
        fill="none"
        stroke={meta.color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M-6 13 L2 3 L10 13"
        fill="none"
        stroke={meta.color}
        strokeOpacity={0.5}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** 飞行格的飞跃标记 */
function FlightMark({ meta, x, y }: { meta: SeatMeta; x: number; y: number }) {
  return (
    <g transform={`translate(${x + CELL / 2} ${y + CELL / 2})`} className="flight-glyph">
      <circle r={15} fill={meta.color} opacity={0.16} />
      <circle r={15} fill="none" stroke={meta.color} strokeOpacity={0.55} strokeDasharray="3 3" />
      <path d="M-8 -5 L3 -9 L0 -1 Z" fill={meta.color} opacity={0.85} />
      <path d="M8 5 L-3 9 L0 1 Z" fill={meta.color} opacity={0.5} />
    </g>
  );
}

/** 同色格的双箭头跳跃水印 */
function JumpMark({ meta, angle, x, y }: { meta: SeatMeta; angle: number; x: number; y: number }) {
  return (
    <g transform={`translate(${x + CELL / 2} ${y + CELL / 2}) rotate(${angle + 90})`} opacity={0.24}>
      <path
        d="M-7 1 L0 -5 L7 1"
        fill="none"
        stroke={meta.color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M-7 8 L0 2 L7 8"
        fill="none"
        stroke={meta.color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** 棋盘主渲染：停机坪、机库、跑道、机制标记、航线与飞机 */
export function Board({ state, activePlayer, activePlane, pulse }: BoardProps) {
  const placements = buildPlacements(state);
  const activeSeat = activePlayer === null ? null : state.seats[activePlayer];
  const activePlacement = activePlane
    ? placements.find((item) => item.player === activePlane.player && item.plane === activePlane.plane)
    : undefined;
  // 事件爆发位置：获胜在棋盘中心，其余跟随正在移动的飞机
  const pulsePos =
    pulse?.tone === 'win'
      ? { x: BOARD_CENTER, y: BOARD_CENTER }
      : activePlacement && pulse
        ? { x: activePlacement.x, y: activePlacement.y }
        : null;
  const pulseColor = pulse ? PULSE_COLORS[pulse.tone] ?? SEAT_META[pulse.seat].color : null;

  return (
    // why：显式声明固有尺寸——无 width/height 属性的 svg 固有尺寸会退化为 300×150，
    // 无法配合 CSS 的 max-width/max-height 做「宽高中取小」的等比缩放
    <svg
      className="board-svg"
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      width={BOARD_SIZE}
      height={BOARD_SIZE}
      role="img"
      aria-label="自动飞行棋棋盘"
    >
      <defs>
        <radialGradient id="board-bg" cx="50%" cy="42%" r="72%">
          <stop offset="0%" style={{ stopColor: 'var(--board-bg-1)' }} />
          <stop offset="62%" style={{ stopColor: 'var(--board-bg-2)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--board-bg-3)' }} />
        </radialGradient>
        <radialGradient id="center-bg" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="rgba(56,232,255,0.18)" />
          <stop offset="55%" stopColor="rgba(139,125,255,0.12)" />
          <stop offset="100%" style={{ stopColor: 'var(--board-bg-3)' }} />
        </radialGradient>
        <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(56,232,255,0.5)" />
          <stop offset="100%" stopColor="rgba(56,232,255,0)" />
        </radialGradient>
        {/* 极光晕：青色与品红两团柔雾，晕染棋盘对角 */}
        <radialGradient id="aurora-cyan" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(56,232,255,0.13)" />
          <stop offset="100%" stopColor="rgba(56,232,255,0)" />
        </radialGradient>
        <radialGradient id="aurora-magenta" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,96,216,0.11)" />
          <stop offset="100%" stopColor="rgba(255,96,216,0)" />
        </radialGradient>
        <pattern id="apron-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0 H0 V30" fill="none" style={{ stroke: 'var(--board-apron-line)' }} strokeWidth="1" />
        </pattern>
        {/* 四角座位光晕：让棋盘底色带上基地色，贴近参考图的高饱和氛围 */}
        {SEAT_META.map((meta) => (
          <radialGradient key={`seat-glow-${meta.seat}`} id={`seat-glow-${meta.seat}`}>
            <stop offset="0%" style={{ stopColor: meta.color }} stopOpacity={0.2} />
            <stop offset="100%" style={{ stopColor: meta.color }} stopOpacity={0} />
          </radialGradient>
        ))}
        {SEAT_META.map((meta) => (
          <marker
            key={`arrow-${meta.seat}`}
            id={`flight-arrow-${meta.seat}`}
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="4.5"
            markerHeight="4.5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 Z" fill={meta.color} />
          </marker>
        ))}
      </defs>

      <rect width={BOARD_SIZE} height={BOARD_SIZE} rx={28} fill="url(#board-bg)" />

      {/* 极光晕：两团柔和的色彩雾，给深色底加空气感 */}
      <ellipse cx={230} cy={168} rx={265} ry={190} fill="url(#aurora-cyan)" />
      <ellipse cx={678} cy={742} rx={285} ry={205} fill="url(#aurora-magenta)" />

      {/* 星野：细碎星点，部分缓慢闪烁 */}
      {STARS.map((star, index) => (
        <circle
          key={`star-${index}`}
          className={star.twinkle ? 'star star-twinkle' : 'star'}
          cx={star.x}
          cy={star.y}
          r={star.r}
          style={star.twinkle ? { animationDelay: `${star.delay}s` } : undefined}
        />
      ))}

      <rect
        x={1}
        y={1}
        width={BOARD_SIZE - 2}
        height={BOARD_SIZE - 2}
        rx={28}
        fill="none"
        style={{ stroke: 'var(--board-frame)' }}
      />

      {/* 四角基地色光晕：行动方缓慢呼吸 */}
      {SEAT_META.map((meta) => {
        const [row, col] = BASE_ORIGINS[meta.seat];
        return (
          <circle
            key={`glow-${meta.seat}`}
            className={activeSeat === meta.seat ? 'corner-glow corner-glow-active' : 'corner-glow'}
            cx={(col + 2.5) * CELL}
            cy={(row + 2.5) * CELL}
            r={3.1 * CELL}
            fill={`url(#seat-glow-${meta.seat})`}
          />
        );
      })}

      {/* 背景轨道装饰 */}
      <circle
        cx={BOARD_CENTER}
        cy={BOARD_CENTER}
        r={360}
        fill="none"
        style={{ stroke: 'var(--board-apron-line)' }}
        strokeDasharray="2 16"
        opacity={0.5}
      />
      <circle
        cx={BOARD_CENTER}
        cy={BOARD_CENTER}
        r={250}
        fill="none"
        style={{ stroke: 'var(--board-apron-line)' }}
        strokeDasharray="2 12"
        opacity={0.4}
      />

      {/* 四角停机坪与机库 */}
      {SEAT_META.map((meta) => {
        const player = state.seats.indexOf(meta.seat);
        const basePositions = player >= 0 ? state.planes[player] : [];
        return (
          <Hangar
            key={`hangar-${meta.seat}`}
            meta={meta}
            active={activeSeat === meta.seat}
            basePositions={basePositions}
          />
        );
      })}

      {/* 环形跑道 */}
      {TRACK.map(([row, col], index) => {
        const seat = colorOfTrackIndex(index);
        const meta = SEAT_META[seat];
        const isStart = START_SET.has(index);
        const isFlight = FLIGHT_SET.has(index);
        const x = col * CELL;
        const y = row * CELL;
        return (
          <g key={`track-${index}`}>
            <rect
              className="board-cell"
              x={x + 3}
              y={y + 3}
              width={CELL - 6}
              height={CELL - 6}
              rx={11}
              fill={isStart ? meta.soft : meta.base}
              stroke={meta.color}
              strokeOpacity={
                isStart ? 0.85 : isFlight ? 0.55 : activeSeat === seat ? 0.45 : 0.26
              }
              strokeWidth={isStart ? 2.2 : 1.2}
              strokeDasharray={isFlight ? '5 4' : undefined}
            />
            {isStart ? (
              <StartMark meta={meta} x={x} y={y} />
            ) : isFlight ? (
              <FlightMark meta={meta} x={x} y={y} />
            ) : (
              <JumpMark meta={meta} angle={trackAngle(index)} x={x} y={y} />
            )}
          </g>
        );
      })}

      {/* 整圈流向线：虚线沿跑道顺时针缓慢流动，明确行进方向 */}
      <path
        className="track-flow"
        d={TRACK_FLOW}
        fill="none"
        strokeWidth={2.6}
        strokeDasharray="12 18"
        strokeLinecap="round"
        style={{ stroke: 'var(--board-flow)' }}
      />

      {/* 终点跑道：整条通道独立成形，与外圈跑道格留出空隙形成隔离感 */}
      {HOME_LANES.map((lane, seat) => {
        const meta = SEAT_META[seat as Seat];
        const rows = lane.map(([row]) => row);
        const cols = lane.map(([, col]) => col);
        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);
        // 通道底四周内缩 8px，配合居中悬浮的几何布局，与外圈跑道拉开明显间距
        const inset = 8;
        const chX = minCol * CELL + inset;
        const chY = minRow * CELL + inset;
        const chW = (maxCol - minCol + 1) * CELL - inset * 2;
        const chH = (maxRow - minRow + 1) * CELL - inset * 2;

        return (
          <g key={`home-${seat}`}>
            {/* 滑行道边线：通道两侧的引导虚线，强化专属通道的空间隔离 */}
            {(() => {
              const horizontal = minRow === maxRow;
              // 通道两端在行进方向上的网格跨度
              const spanStart = (horizontal ? minCol : minRow) * CELL;
              const spanEnd = ((horizontal ? maxCol : maxRow) + 1) * CELL;
              // 通道在横向/纵向上的网格跨度
              const laneStart = (horizontal ? minRow : minCol) * CELL;
              const laneEnd = ((horizontal ? maxRow : maxCol) + 1) * CELL;
              const gap = 13;
              const lines = horizontal
                ? [
                    [spanStart + 10, laneStart - gap, spanEnd - 10, laneStart - gap],
                    [spanStart + 10, laneEnd + gap, spanEnd - 10, laneEnd + gap],
                  ]
                : [
                    [laneStart - gap, spanStart + 10, laneStart - gap, spanEnd - 10],
                    [laneEnd + gap, spanStart + 10, laneEnd + gap, spanEnd - 10],
                  ];
              return lines.map(([x1, y1, x2, y2], index) => (
                <line
                  key={`taxi-${index}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={meta.color}
                  strokeOpacity={0.16}
                  strokeWidth={1.4}
                  strokeDasharray="3 8"
                  strokeLinecap="round"
                />
              ));
            })()}

            {/* 通道底：虚线描边缓慢行进，暗示终点方向 */}
            <rect
              className="home-channel"
              x={chX}
              y={chY}
              width={chW}
              height={chH}
              rx={16}
              style={{
                fill: `color-mix(in srgb, ${meta.color} 10%, var(--board-hangar))`,
              }}
              stroke={meta.color}
              strokeOpacity={0.5}
              strokeWidth={1.2}
              strokeDasharray="7 7"
            />

            {lane.map(([row, col], index) => {
              const x = col * CELL;
              const y = row * CELL;
              const angle = homeAngle(seat as Seat, 52 + index);
              return (
                <g key={`home-cell-${index}`}>
                  <rect
                    x={x + 12}
                    y={y + 12}
                    width={CELL - 24}
                    height={CELL - 24}
                    rx={12}
                    fill={meta.soft}
                    stroke={meta.color}
                    strokeOpacity={0.55}
                    strokeWidth={1.2}
                  />
                  <g transform={`translate(${x + CELL / 2} ${y + CELL / 2}) rotate(${angle})`}>
                    <line
                      x1={-15}
                      y1={0}
                      x2={15}
                      y2={0}
                      style={{ stroke: 'var(--board-text)' }}
                      strokeOpacity={0.26}
                      strokeDasharray="5 5"
                    />
                    <path
                      d="M-4 -6 L3 0 L-4 6"
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.75}
                    />
                  </g>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* 中央终点核心：圆形徽章 + 雷达幕 + 双旋转环 + 四向内收闸门 */}
      <circle
        cx={BOARD_CENTER}
        cy={BOARD_CENTER}
        r={88}
        fill="url(#center-bg)"
        style={{ stroke: 'var(--board-frame)' }}
      />
      {/* 雷达幕：单叶扫掠绕中心缓转，营造空管塔台氛围 */}
      <g className="hub-sweep" opacity={0.14}>
        {/* 校准圆：保证扫掠组包围盒以棋盘中心对称 */}
        <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={72} fill="none" />
        <path
          d={`M${BOARD_CENTER} ${BOARD_CENTER} L${BOARD_CENTER + 62} ${BOARD_CENTER - 36} A 72 72 0 0 1 ${BOARD_CENTER + 62} ${BOARD_CENTER + 36} Z`}
          fill="#38e8ff"
        />
      </g>
      <circle
        cx={BOARD_CENTER}
        cy={BOARD_CENTER}
        r={1.32 * CELL}
        fill="none"
        stroke="rgba(56,232,255,0.32)"
        strokeWidth={1.2}
        strokeDasharray="4 10"
        className="center-ring"
      />
      <circle
        cx={BOARD_CENTER}
        cy={BOARD_CENTER}
        r={0.98 * CELL}
        fill="none"
        stroke="rgba(255,79,216,0.28)"
        strokeWidth={1.2}
        strokeDasharray="3 8"
        className="center-ring center-ring-reverse"
      />
      {/* 四向闸门：指向中心的 chevron，表示四条终点跑道在此汇聚 */}
      {[
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ].map(([dx, dy]) => {
        const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
        return (
          <path
            key={`gate-${dx}-${dy}`}
            d="M-5 -6 L4 0 L-5 6"
            transform={`translate(${BOARD_CENTER + dx * CELL * 0.5} ${
              BOARD_CENTER + dy * CELL * 0.5
            }) rotate(${angle})`}
            fill="none"
            stroke="rgba(139,125,255,0.6)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={0.46 * CELL} fill="url(#hub-glow)" opacity={0.8} />
      <text
        x={BOARD_CENTER}
        y={BOARD_CENTER + 6}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        letterSpacing={4}
        style={{ fill: 'var(--board-text)' }}
      >
        终点
      </text>

      {/* 四个归位格 */}
      {FINISH_CELLS.map(([row, col], seat) => {
        const meta = SEAT_META[seat as Seat];
        const cx = (col + 0.5) * CELL;
        const cy = (row + 0.5) * CELL;
        return (
          <g key={`finish-${seat}`}>
            <rect
              x={col * CELL + 10}
              y={row * CELL + 10}
              width={CELL - 20}
              height={CELL - 20}
              rx={12}
              fill={meta.soft}
              stroke={meta.color}
              strokeOpacity={0.5}
              strokeWidth={1.2}
            />
            <circle cx={cx} cy={cy} r={17} fill={meta.color} opacity={0.14} />
            <path
              d="M0 -9 L2.6 -2.6 L9 0 L2.6 2.6 L0 9 L-2.6 2.6 L-9 0 L-2.6 -2.6 Z"
              transform={`translate(${cx} ${cy})`}
              fill={meta.color}
              opacity={0.7}
            />
          </g>
        );
      })}

      {/* 飞行航线 */}
      {SEAT_META.map((meta) => {
        const fromIndex = flightIndex(meta.seat);
        const fromCell = TRACK[fromIndex];
        const toCell = TRACK[(fromIndex + FLIGHT_OFFSET) % TRACK.length];
        const x1 = (fromCell[1] + 0.5) * CELL;
        const y1 = (fromCell[0] + 0.5) * CELL;
        const x2 = (toCell[1] + 0.5) * CELL;
        const y2 = (toCell[0] + 0.5) * CELL;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy) || 1;
        const cx = (x1 + x2) / 2 - (dy / length) * length * 0.16;
        const cy = (y1 + y2) / 2 + (dx / length) * length * 0.16;
        const active = activeSeat === meta.seat;
        return (
          <path
            key={`arc-${meta.seat}`}
            className="flight-arc"
            d={`M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`}
            fill="none"
            stroke={meta.color}
            strokeOpacity={active ? 0.5 : 0.1}
            strokeWidth={active ? 2.2 : 1.1}
            strokeDasharray="7 9"
            strokeLinecap="round"
            markerEnd={active ? `url(#flight-arrow-${meta.seat})` : undefined}
          />
        );
      })}

      {/* 行动飞机的高亮光圈 */}
      {activePlacement && (
        <circle
          className="plane-ring"
          cx={activePlacement.x}
          cy={activePlacement.y}
          r={CELL * 0.42}
          fill="none"
          stroke={SEAT_META[activePlacement.seat].color}
          strokeWidth={2}
          opacity={0.85}
        />
      )}

      {/* 事件爆发：踩子/归位/跳跃/飞行/获胜的一次性扩散动画，按事件 id 重放 */}
      {pulse && pulsePos && pulseColor && (
        <g key={`pulse-${pulse.id}`} className="event-burst" transform={`translate(${pulsePos.x} ${pulsePos.y})`}>
          <circle className="event-burst-ring" r={26} fill="none" stroke={pulseColor} strokeWidth={3} />
          <circle
            className="event-burst-ring event-burst-ring-slow"
            r={26}
            fill="none"
            stroke={pulseColor}
            strokeWidth={1.4}
          />
          <circle className="event-burst-core" r={11} fill={pulseColor} />
        </g>
      )}

      {/* 飞机 */}
      {placements.map((item) => {
        const meta = SEAT_META[item.seat];
        const isActive =
          activePlane !== null && activePlane.player === item.player && activePlane.plane === item.plane;
        return (
          <g
            key={`plane-${item.player}-${item.plane}`}
            className={isActive ? 'plane plane-active' : 'plane'}
            style={{
              transform: `translate(${item.x}px, ${item.y}px) rotate(${item.rotation}deg) scale(1.18)`,
              transformOrigin: '0 0',
              color: meta.color,
            }}
          >
            <ellipse
              cx={0}
              cy={9}
              rx={12}
              ry={4.5}
              style={{ fill: 'var(--board-plane-shadow)' }}
              opacity={0.35}
            />
            <g style={{ filter: `drop-shadow(0 0 ${isActive ? 11 : 5}px ${meta.color})` }}>
              <path
                d={PLANE_PATH}
                fill={meta.color}
                style={{ stroke: 'var(--board-plane-edge)' }}
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
              <path
                d="M0 -16 L0 11"
                style={{ stroke: 'var(--board-plane-shadow)' }}
                strokeWidth={1}
                opacity={0.55}
              />
              <ellipse cx={0} cy={-10.5} rx={1.9} ry={3.4} fill="#fff" opacity={0.8} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
