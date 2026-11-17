import { useMemo, useState } from 'react';
import { SEAT_META } from '@/games/camel-up/engine/board';
import type { Seat } from '@/games/camel-up/engine/board';
import { createInitialState } from '@/games/camel-up/engine/rules';
import type { GameConfig } from '@/games/camel-up/engine/types';
import { Board } from '@/games/camel-up/ui/Board';

interface SetupScreenProps {
  onStart: (config: GameConfig) => void;
}

/** 人数对应的座位组合（按座位号顺序取前 N 个） */
const SEAT_SETS: Record<number, Seat[]> = {
  2: [0, 1],
  3: [0, 1, 2],
  4: [0, 1, 2, 3],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
  8: [0, 1, 2, 3, 4, 5, 6, 7],
};

const DEPTH_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 1, label: '快速', hint: '向前看 1 步行动，决策最快' },
  { value: 2, label: '均衡', hint: '向前看 2 步行动，攻守兼顾' },
  { value: 3, label: '深度', hint: '向前看 3 步行动，思考更久' },
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
  { title: '四类行动', text: '每回合四选一：拿腿注片 / 放地形块 / 摇骰塔 / 打押注牌' },
  { title: '腿注片', text: '领先驼按票面 5/3/2 得币，第二名 +1，其余 -1；先拿者得 5' },
  { title: '骰子塔', text: '随机摇出一颗骰子，同色骆驼前进 1-3 格，摇骰者得金币片' },
  { title: '堆叠', text: '移动驼背上的骆驼随行，落到有驼之格跳到堆顶，顶者名次靠前' },
  { title: '地形块', text: '每腿可放一次，留到腿末收回；绿洲让落点驼 +1，海市蜃楼 -1 插底，触发时块主得 1 EP' },
  { title: '腿末', text: '五颗骰子摇空即结算本腿，金币片每张 +1，随后全部复位' },
  { title: '终局', text: '骆驼越过终点线：按放置顺序结算总冠/末名 8/5/3/2/1，错注 -1，最多金币者胜' },
];

/** 埃及风回纹饰线（英雄区装饰） */
function Ornament() {
  return (
    <svg viewBox="0 0 260 14" className="cmp-ornament" aria-hidden="true">
      <path
        d="M0 12 L13 2 L26 12 L39 2 L52 12 L65 2 L78 12 L91 2 L104 12 L117 2 L130 12 L143 2 L156 12 L169 2 L182 12 L195 2 L208 12 L221 2 L234 12 L247 2 L260 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

/** 开局配置页：选择人数、开局资金、停顿时间、AI 搜索深度与随机种子 */
export function SetupScreen({ onStart }: SetupScreenProps) {
  const [count, setCount] = useState(3);
  const [startCoins, setStartCoins] = useState(3);
  const [turnDelayMs, setTurnDelayMs] = useState(900);
  const [aiDepth, setAiDepth] = useState(2);
  const [seedText, setSeedText] = useState(() => String(randomSeed()));

  const seats = SEAT_SETS[count];
  // 预览使用确定性初始局面（不传随机源），资金随配置变化，保证每次进入配置页展示一致
  const preview = useMemo(() => createInitialState(seats, undefined, startCoins), [seats, startCoins]);

  /** 以当前配置开始（种子可手填，留空则现场随机） */
  const start = () => {
    onStart({
      seats,
      turnDelayMs,
      aiDepth,
      seed: parseSeed(seedText),
      startCoins,
    });
  };

  return (
    <div className="camel-stage camel-setup">
      <header className="cmp-hero">
        <p className="cmp-hero-eyebrow">CAMEL UP · AI 自动对弈</p>
        <h1 className="cmp-hero-title">骆驼大赛</h1>
        <p className="cmp-hero-sub">黄沙赛道上的押注博弈 —— 五峰骆驼、四类行动、一座骰子塔</p>
        <Ornament />
      </header>

      <div className="cmp-setup-grid">
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
              {[2, 3, 4, 5, 6, 7, 8].map((item) => (
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
              <span>开局资金</span>
              <span className="option-value">{startCoins} EP</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={startCoins}
              onChange={(event) => setStartCoins(Number(event.target.value))}
              aria-label="开局资金"
            />
            <p className="option-hint">每位玩家起手的埃及镑，资金越少越考验押注取舍。</p>
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
            <p className="option-hint">控制思考、掷骰、移动、结算之间的等待时间，数值越小节奏越快。</p>
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
              同一种子会得到相同的骰子序列；AI 决策受时间预算影响，同种子对局可能略有差异。
            </p>
          </div>

          <button type="button" className="btn btn-primary h-11 text-[13px]" onClick={start}>
            开始自动对局
          </button>
        </section>

        <section className="panel setup-card">
          <div className="cmp-preview-head">
            <h2 className="panel-title">棋盘预览</h2>
            <span className="panel-sub">
              {seats.map((seat) => SEAT_META[seat].name).join(' / ')}
            </span>
          </div>

          <div className="cmp-preview">
            <Board state={preview} activeStep={null} />
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
    </div>
  );
}
