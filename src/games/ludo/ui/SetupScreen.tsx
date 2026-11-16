import { useMemo, useState } from 'react';
import { SEAT_META } from '@/games/ludo/engine/board';
import type { Seat } from '@/games/ludo/engine/board';
import { createInitialState } from '@/games/ludo/engine/rules';
import type { GameConfig } from '@/games/ludo/engine/types';
import { Board } from '@/games/ludo/ui/Board';

interface SetupScreenProps {
  onStart: (config: GameConfig) => void;
}

/** 人数对应的座位组合（尽量保持对称） */
const SEAT_SETS: Record<number, Seat[]> = {
  2: [0, 2],
  3: [0, 1, 2],
  4: [0, 1, 2, 3],
};

const DEPTH_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 1, label: '快速', hint: '搜索 1 次掷骰，决策更快' },
  { value: 2, label: '均衡', hint: '搜索 2 次掷骰，攻守兼顾' },
  { value: 3, label: '深度', hint: '搜索 3 次掷骰，思考更久' },
];

const RULES: { title: string; text: string }[] = [
  { title: '起飞', text: '每人 4 架飞机，掷出 6 点方可起飞，并可追加一次掷骰' },
  { title: '跳跃', text: '落在与己方同色的格子上，可额外前进 4 格' },
  { title: '飞跃', text: '落在带飞行标记的格子，直接飞跃 12 格' },
  { title: '踩子', text: '落点若有对手飞机，将其送回机库重新起飞' },
  { title: '归位', text: '进入终点跑道后需要精确点数，超出则该机不可移动' },
  { title: '限制', text: '连续三次掷出 6 点，追加回合立即终止' },
  { title: '获胜', text: '最先让 4 架飞机全部归位的玩家赢下本局' },
];

/** 开局配置页：选择人数、停顿时间与 AI 搜索深度 */
export function SetupScreen({ onStart }: SetupScreenProps) {
  const [count, setCount] = useState(4);
  const [turnDelayMs, setTurnDelayMs] = useState(600);
  const [aiDepth, setAiDepth] = useState(2);

  const seats = SEAT_SETS[count];
  const preview = useMemo(() => createInitialState(seats), [seats]);

  /** 以当前配置开始一局（每次使用新的随机种子） */
  const start = () => {
    onStart({
      seats,
      turnDelayMs,
      aiDepth,
      seed: Math.floor(Math.random() * 1_000_000_000),
    });
  };

  return (
    <div className="setup-grid">
      <section className="panel setup-card">
        <div>
          <p className="eyebrow">SETUP</p>
          <h2 className="mt-1 text-[17px] font-semibold">对局配置</h2>
          <p className="option-hint mt-1.5">
            全部流程由 AI 自动完成，你可以随时暂停、单步观察或回看整局。
          </p>
        </div>

        <div className="option-block">
          <div className="option-label">
            <span>参与人数</span>
            <span className="option-value">{count} 人</span>
          </div>
          <div className="seat-picker">
            {[2, 3, 4].map((item) => (
              <button
                key={item}
                type="button"
                className="seat-option"
                data-active={count === item}
                onClick={() => setCount(item)}
              >
                <span className="text-[13px] font-semibold">{item} 人</span>
                <span className="seat-dots">
                  {SEAT_SETS[item].map((seat) => (
                    <i
                      key={seat}
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: SEAT_META[seat].color,
                        boxShadow: `0 0 8px ${SEAT_META[seat].color}`,
                      }}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="option-block">
          <div className="option-label">
            <span>每轮停顿</span>
            <span className="option-value">{turnDelayMs} ms</span>
          </div>
          <input
            type="range"
            min={200}
            max={2000}
            step={100}
            value={turnDelayMs}
            onChange={(event) => setTurnDelayMs(Number(event.target.value))}
            aria-label="每轮停顿时间"
          />
          <p className="option-hint">控制每个动作之间的等待时间，数值越小节奏越快。</p>
        </div>

        <div className="option-block">
          <div className="option-label">
            <span>AI 搜索深度</span>
            <span className="option-value">{aiDepth} 层</span>
          </div>
          <div className="seg" role="group" aria-label="AI 搜索深度">
            {DEPTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="seg-item"
                data-active={aiDepth === option.value}
                onClick={() => setAiDepth(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="option-hint">
            {DEPTH_OPTIONS.find((option) => option.value === aiDepth)?.hint}
          </p>
        </div>

        <button type="button" className="btn btn-primary h-11 text-[13px]" onClick={start}>
          开始自动对局
        </button>
      </section>

      <section className="panel setup-card">
        <div className="flex items-baseline justify-between">
          <h2 className="panel-title">棋盘预览</h2>
          <span className="panel-sub">
            {seats.map((seat) => SEAT_META[seat].name).join(' / ')}
          </span>
        </div>

        <div className="setup-preview">
          <div style={{ width: '100%', maxWidth: 380 }}>
            <Board state={preview} activePlayer={null} activePlane={null} pulse={null} />
          </div>
        </div>

        <ul className="rule-list list-none p-0">
          {RULES.map((rule, index) => (
            <li key={rule.title}>
              <span className="rule-index">{String(index + 1).padStart(2, '0')}</span>
              <span>
                <b>{rule.title}</b> · {rule.text}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
