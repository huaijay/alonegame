import { SEAT_META, TILE_META } from '@/games/azul/engine/board';
import type { AiDecisionView } from '@/games/azul/engine/session';
import type { GameState } from '@/games/azul/engine/types';
import type { EvaluationBreakdown } from '@/games/azul/engine/ai/evaluate';

interface AiPanelProps {
  ai: AiDecisionView | null;
  state: GameState;
  thinking: boolean;
}

type MetricKey = Exclude<keyof EvaluationBreakdown, 'total'>;

const METRICS: { key: MetricKey; label: string; color: string }[] = [
  { key: 'score', label: '分差', color: '#38e8ff' },
  { key: 'rows', label: '行势', color: '#ffd166' },
  { key: 'wall', label: '墙值', color: '#3ddc97' },
  { key: 'floor', label: '地板', color: '#ff8fa3' },
  { key: 'marker', label: '先手', color: '#ff4fd8' },
];

function formatValue(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/** 候选行动的中文描述：来源 · 颜色 → 目标行 */
function describeMove(move: AiDecisionView['candidates'][number]['move'], factoryCount: number): string {
  const source = move.source < factoryCount ? `盘 ${move.source + 1}` : '中央';
  const target = move.row >= 0 ? `第 ${move.row + 1} 行` : '地板';
  return `${source} · ${TILE_META[move.color].name} → ${target}`;
}

/** AI 决策解释面板：候选行动的期望评分与分项评分 */
export function AiPanel({ ai, state, thinking }: AiPanelProps) {
  if (!ai) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">AI 决策</h2>
          <span className="panel-sub">Max-n</span>
        </div>
        <div className="ai-empty">{thinking ? '正在推演候选行动…' : '等待下一次拿砖'}</div>
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
          <div
            key={`${candidate.move.source}-${candidate.move.color}-${candidate.move.row}`}
            className="ai-row"
            data-chosen={candidate.chosen}
          >
            <div className="flex items-center gap-2">
              <span className="ai-row-name">{describeMove(candidate.move, state.factoryCount)}</span>
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
