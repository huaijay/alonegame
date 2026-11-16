import { SEAT_META } from '@/games/ludo/engine/board';

interface DiceProps {
  value: number | null;
  /** 每次掷骰递增，用于重新触发滚动动画 */
  rollKey: number;
  rolling: boolean;
  player: number | null;
}

/** 骰子点位布局：3×3 网格中的索引 */
const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** 立体骰子：显示点数并在掷骰时抖动 */
export function Dice({ value, rollKey, rolling, player }: DiceProps) {
  const pips = new Set(value === null ? [] : (PIP_LAYOUT[value] ?? []));
  const color = player === null ? '#38e8ff' : SEAT_META[player].color;

  return (
    <div className="flex items-center gap-3">
      <div
        key={rollKey}
        className="dice"
        data-empty={value === null}
        data-rolling={rolling}
        aria-label={value === null ? '等待掷骰' : `骰子 ${value} 点`}
      >
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className="dice-cell">
            {pips.has(index) ? <span className="dice-pip" /> : null}
          </span>
        ))}
      </div>
      <div className="leading-tight">
        <div className="text-[10px] tracking-[0.2em] text-[var(--muted)]">DICE</div>
        <div className="text-[15px] font-semibold tabular-nums" style={{ color }}>
          {value === null ? '—' : `${value} 点`}
        </div>
      </div>
    </div>
  );
}
