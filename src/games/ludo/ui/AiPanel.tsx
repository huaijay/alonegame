import { SEAT_META } from '@/games/ludo/engine/board';
import type { AiDecisionView } from '@/games/ludo/engine/session';
import type { GameState } from '@/games/ludo/engine/types';
import type { EvaluationBreakdown } from '@/games/ludo/engine/ai/evaluate';

interface AiPanelProps {
  ai: AiDecisionView | null;
  state: GameState;
  thinking: boolean;
}

type MetricKey = Exclude<keyof EvaluationBreakdown, 'total'>;

const METRICS: { key: MetricKey; label: string; color: string }[] = [
  { key: 'progress', label: '进度', color: '#38e8ff' },
  { key: 'safety', label: '安全', color: '#3ddc97' },
  { key: 'attack', label: '进攻', color: '#ff4fd8' },
  { key: 'home', label: '归位', color: '#ffd166' },
  { key: 'boost', label: '捷径', color: '#8b7dff' },
];

function formatValue(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/** 单条候选的起飞 / 前进描述 */
function describeCandidate(kind: 'launch' | 'advance', position: number): string {
  if (kind === 'launch') return '起飞进入跑道';
  if (position >= 52) return '终点跑道精确推进';
  return `第 ${position + 1} 步起走`;
}

/** AI 决策解释面板：候选走法的期望得分与分项评分 */
export function AiPanel({ ai, state, thinking }: AiPanelProps) {
  if (!ai) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">AI 决策</h2>
          <span className="panel-sub">Expectimax</span>
        </div>
        <div className="ai-empty">{thinking ? '正在推演候选走法…' : '等待下一次掷骰'}</div>
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
          {meta.name} · {ai.dice} 点
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
          <div
            key={`${candidate.kind}-${candidate.plane}`}
            className="ai-row"
            data-chosen={candidate.chosen}
          >
            <div className="flex items-center gap-2">
              <span className="ai-row-name">
                {candidate.plane + 1} 号机 · {candidate.kind === 'launch' ? '起飞' : '前进'}
              </span>
              <span className="text-[10px] text-[var(--dim)]">
                {describeCandidate(candidate.kind, state.planes[ai.player][candidate.plane])}
              </span>
              {candidate.chosen ? (
                <span className="rounded bg-[rgba(56,232,255,0.16)] px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-[var(--accent-ink)]">
                  最佳
                </span>
              ) : null}
            </div>
            <span className="ai-score">{candidate.value.toFixed(1)}</span>

            <div className="ai-metrics">
              {METRICS.map((metric) => {
                const value = candidate.breakdown[metric.key];
                return (
                  <span key={metric.key}>
                    {metric.label}{' '}
                    <b style={{ color: value < 0 ? '#ff8fa3' : metric.color }}>
                      {formatValue(value)}
                    </b>
                  </span>
                );
              })}
            </div>

            <div className="ai-bar">
              <i
                style={{
                  width: `${Math.min(100, (Math.abs(candidate.value) / best) * 100)}%`,
                  background: candidate.chosen
                    ? 'linear-gradient(90deg,#38e8ff,#8b7dff)'
                    : 'var(--line-strong)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
