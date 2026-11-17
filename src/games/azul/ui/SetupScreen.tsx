import { useMemo, useState } from 'react';
import { SEAT_META } from '@/games/azul/engine/board';
import type { Seat } from '@/games/azul/engine/board';
import { createInitialState } from '@/games/azul/engine/rules';
import type { GameConfig } from '@/games/azul/engine/types';
import { Board } from '@/games/azul/ui/Board';

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
  { value: 1, label: '快速', hint: '向前看 1 个回合，决策最快' },
  { value: 2, label: '均衡', hint: '向前看 2 个回合，攻守兼顾' },
  { value: 3, label: '深度', hint: '向前看 3 个回合，思考更久' },
];

/** 轮次上限候选：0 表示不限（标准规则），其余为该轮结算后直接终局 */
const ROUND_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '不限' },
  { value: 3, label: '3 轮' },
  { value: 5, label: '5 轮' },
  { value: 8, label: '8 轮' },
];

/** 生成 0 ~ 999999999 的随机种子 */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** 解析种子输入；为空或非法时回退到新的随机种子 */
function parseSeed(text: string): number {
  const value = Math.floor(Number(text));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : randomSeed();
}

const RULES: { title: string; text: string }[] = [
  { title: '拿砖', text: '轮到谁就从某个工厂盘或中央区整色拿走全部花砖' },
  { title: '余砖', text: '工厂盘被拿后剩下的砖全部移入中央区' },
  { title: '首标记', text: '本轮第一个从中央区拿砖的玩家获得先手标记，下轮先手' },
  { title: '图案行', text: '砖只能放到同色的未满行中，超出容量的部分罚入地板' },
  { title: '地板', text: '地板上的砖按 -1/-1/-2/-2/-2/-3/-3 扣分，本轮结算后清空' },
  { title: '上墙', text: '每轮结束时满行移入分数墙，按横纵连接数计分' },
  { title: '终局', text: '有人拼出完整墙行即终局：满行 +6 / 满列 +2 / 集齐一色 +10' },
];

/** 开局配置页：选择人数、轮次上限、停顿时间、AI 搜索深度与随机种子 */
export function SetupScreen({ onStart }: SetupScreenProps) {
  const [count, setCount] = useState(2);
  const [rounds, setRounds] = useState(0);
  const [turnDelayMs, setTurnDelayMs] = useState(900);
  const [aiDepth, setAiDepth] = useState(2);
  const [seedText, setSeedText] = useState(() => String(randomSeed()));

  const seats = SEAT_SETS[count];
  // 预览使用确定性初始局面（不传随机源），保证每次进入配置页展示一致
  const preview = useMemo(() => createInitialState(seats), [seats]);

  /** 以当前配置开始（种子可手填，留空则现场随机） */
  const start = () => {
    onStart({
      seats,
      turnDelayMs,
      aiDepth,
      seed: parseSeed(seedText),
      rounds,
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
            <span>轮次上限</span>
            <span className="option-value">{rounds === 0 ? '不限' : `${rounds} 轮`}</span>
          </div>
          <div className="seg" role="group" aria-label="轮次上限">
            {ROUND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="seg-item"
                data-active={rounds === option.value}
                onClick={() => setRounds(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="option-hint">
            {rounds === 0
              ? '标准规则：任一玩家完成一整行花砖即进入终局结算。'
              : `最多进行 ${rounds} 轮，该轮结算后直接终局；若提前有人完成一整行，仍按标准规则提前结束。`}
          </p>
        </div>

        <div className="option-block">
          <div className="option-label">
            <span>每步停顿</span>
            <span className="option-value">{turnDelayMs} ms</span>
          </div>
          <input
            type="range"
            min={200}
            max={2000}
            step={100}
            value={turnDelayMs}
            onChange={(event) => setTurnDelayMs(Number(event.target.value))}
            aria-label="每步停顿时间"
          />
          <p className="option-hint">控制拿砖、放置、结算之间的等待时间，数值越小节奏越快。</p>
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

        <div className="option-block">
          <div className="option-label">
            <span>随机种子</span>
            <span className="option-value">可复现</span>
          </div>
          <div className="seed-row">
            <input
              className="seed-input"
              type="number"
              min={0}
              step={1}
              value={seedText}
              onChange={(event) => setSeedText(event.target.value)}
              aria-label="随机种子"
            />
            <button type="button" className="btn" onClick={() => setSeedText(String(randomSeed()))}>
              换一个
            </button>
          </div>
          <p className="option-hint">
            同一种子会得到相同的补盘与砖袋序列；AI 决策受时间预算影响，同种子对局可能略有差异。
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
          <div style={{ width: '100%' }}>
            <Board state={preview} viewPlayer={0} activeStep={null} />
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
