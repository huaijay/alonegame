import { CAMEL_META, SEAT_META } from '@/games/camel-up/engine/board';
import type { AiDecisionView } from '@/games/camel-up/engine/session';
import type { GameState, Move } from '@/games/camel-up/engine/types';
import type { EvaluationBreakdown } from '@/games/camel-up/engine/ai/evaluate';

interface AiPanelProps {
  ai: AiDecisionView | null;
  state: GameState;
  thinking: boolean;
}

type MetricKey = Exclude<keyof EvaluationBreakdown, 'total'>;

/** 评估分项标签（配色由 camel-metric 系列类控制） */
const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'coins', label: '金币' },
  { key: 'legTickets', label: '腿注' },
  { key: 'pyramid', label: '金币片' },
  { key: 'raceBets', label: '押注牌' },
  { key: 'hand', label: '手牌' },
  { key: 'desert', label: '地形块' },
];

function formatValue(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/** 候选行动的中文描述：押注 / 地形块 / 掷骰塔 / 押注牌 */
function describeMove(move: Move): string {
  switch (move.kind) {
    case 'legBet':
      return `押注${CAMEL_META[move.color].name}腿部`;
    case 'desert':
      return `地形块→第 ${move.pos + 1} 格（${move.face === 'oasis' ? '绿洲' : '海市蜃楼'}）`;
    case 'roll':
      return '掷骰塔摇骰';
    case 'raceBet':
      return `押注${move.target === 'winner' ? '总冠' : '总末名'}·${CAMEL_META[move.color].name}`;
  }
}

/**
 * AI 决策解释面板：展示本轮候选行动的期望评分与评估分项
 *
 * @param ai 本轮 AI 决策展示数据，无决策时为 null
 * @param state 当前对局状态（用于展示行动方座位配色）
 * @param thinking 是否正在推演候选行动
 * @returns 渲染 AI 决策面板
 */
export function AiPanel({ ai, state, thinking }: AiPanelProps) {
  if (!ai) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">AI 决策</h2>
          <span className="panel-sub">Expectimax</span>
        </div>
        <div className="ai-empty">{thinking ? '正在推演候选行动…' : '等待下一次押注或掷骰'}</div>
      </section>
    );
  }

  const meta = SEAT_META[state.seats[ai.player]];
  const best = Math.max(...ai.candidates.map((item) => Math.abs(item.value)), 1);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">AI 决策</h2>
        <span className="panel-sub" style={{ color: meta.color }}>
          {meta.name}
        </span>
      </div>
      <div className="panel-body flex flex-col gap-2.5">
        <div className="ai-head">
          <span>
            {ai.candidates.length} 条候选 · 深度 {ai.depth}
          </span>
          <span className="ai-total">
            {ai.nodes} 节点 · {ai.ms.toFixed(1)}ms
          </span>
        </div>

        {ai.candidates.map((candidate) => (
          // 候选动作互不重复，序列化 Move 即可作为稳定唯一键
          <div
            key={JSON.stringify(candidate.move)}
            className="ai-row"
            data-chosen={candidate.chosen}
          >
            <div className="flex items-center gap-2">
              <span className="ai-row-name">{describeMove(candidate.move)}</span>
              {candidate.chosen ? <span className="camel-ai-badge">最佳</span> : null}
            </div>
            <span className="ai-score">{candidate.value.toFixed(1)}</span>

            <div className="ai-metrics">
              {METRICS.map((metric) => {
                const value = candidate.breakdown[metric.key];
                return (
                  <span key={metric.key}>
                    {metric.label}{' '}
                    <b
                      className={value < 0 ? 'camel-metric camel-metric-neg' : 'camel-metric'}
                      data-metric={metric.key}
                    >
                      {formatValue(value)}
                    </b>
                  </span>
                );
              })}
            </div>

            <div className="ai-bar">
              <i
                className={
                  candidate.chosen ? 'camel-ai-bar-fill camel-ai-bar-fill-best' : 'camel-ai-bar-fill'
                }
                style={{ width: `${Math.min(100, (Math.abs(candidate.value) / best) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
