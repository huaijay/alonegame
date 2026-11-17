import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SEAT_META } from '@/games/camel-up/engine/board';
import type { Seat } from '@/games/camel-up/engine/board';
import type { WinStats } from '@/games/camel-up/engine/stats';
import { simulateGame } from '@/games/camel-up/engine/simulate';
import type { BatchResult } from '@/games/camel-up/engine/simulate';

interface StatsPanelProps {
  seats: Seat[];
  stats: WinStats;
  onReset: () => void;
}

/** 批量模拟局数 */
const BATCH_GAMES = 30;

/** 胜率条：按座位展示胜场占比 */
function WinBar({ rate, seat }: { rate: number; seat: Seat }) {
  const meta = SEAT_META[seat];
  return (
    <div className="stat-row" style={{ '--seat-color': meta.color } as CSSProperties}>
      <span className="w-9 text-[var(--ink-soft)]">{meta.name}</span>
      <span className="stat-bar">
        <i style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
      <span className="stat-num">{(rate * 100).toFixed(0)}%</span>
    </div>
  );
}

/**
 * 胜率统计面板：展示本机累计战绩（按腿统计局长），并可发起分片批量模拟
 *
 * @param seats 参与座位列表
 * @param stats 本机累计统计（胜场 / 总局数 / 累计腿数）
 * @param onReset 清空累计统计的回调
 * @returns 渲染统计面板；批量模拟为分片异步推进，不阻塞界面
 */
export function StatsPanel({ seats, stats, onReset }: StatsPanelProps) {
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [running, setRunning] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  /** 分片推进批量模拟，避免长时间阻塞界面 */
  const runBatch = () => {
    if (running) return;
    setRunning(true);
    setBatch(null);

    const seedBase = Date.now() % 1_000_000;
    const acc: BatchResult = { games: 0, wins: {}, totalLegs: 0 };

    const tick = (index: number) => {
      if (cancelledRef.current) return;
      const outcome = simulateGame(seats, seedBase + index * 7919, 2);
      acc.games += 1;
      acc.totalLegs += outcome.legs;
      if (outcome.winner !== null) {
        const key = String(outcome.winner);
        acc.wins[key] = (acc.wins[key] ?? 0) + 1;
      }
      setBatch({ ...acc, wins: { ...acc.wins } });

      if (index + 1 < BATCH_GAMES) {
        window.setTimeout(() => tick(index + 1), 0);
      } else {
        setRunning(false);
      }
    };
    tick(0);
  };

  const avgLegs = batch && batch.games > 0 ? batch.totalLegs / batch.games : 0;
  const localAvg = stats.games > 0 ? stats.legs / stats.games : 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">胜率统计</h2>
        <span className="panel-sub">本机累计</span>
      </div>
      <div className="panel-body flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between text-[11px] text-[var(--muted)]">
          <span>
            已记录 <b className="text-[var(--ink-strong)]">{stats.games}</b> 局
          </span>
          <span className="tabular-nums">平均 {localAvg.toFixed(1)} 腿 / 局</span>
        </div>

        {stats.games === 0 ? (
          <p className="option-hint">对局结束后将自动累计各座位胜率。</p>
        ) : (
          seats.map((seat) => (
            <WinBar
              key={seat}
              seat={seat}
              rate={(stats.wins[String(seat)] ?? 0) / stats.games}
            />
          ))
        )}

        <div className="divider" />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--muted)]">
            批量模拟 {BATCH_GAMES} 局 · 深度 2
          </span>
          <button type="button" className="btn" onClick={runBatch} disabled={running}>
            {running ? '推演中…' : '开始模拟'}
          </button>
        </div>

        {batch ? (
          <div className="flex flex-col gap-2">
            {seats.map((seat) => (
              <WinBar
                key={seat}
                seat={seat}
                rate={(batch.wins[String(seat)] ?? 0) / Math.max(1, batch.games)}
              />
            ))}
            <p className="option-hint">
              完成 {batch.games} 局 · 平均 {avgLegs.toFixed(1)} 腿
            </p>
          </div>
        ) : null}

        {stats.games > 0 ? (
          <button
            type="button"
            className="self-start text-[10.5px] text-[var(--dim)] underline decoration-dotted hover:text-[var(--ink-soft)]"
            onClick={onReset}
          >
            清空累计统计
          </button>
        ) : null}
      </div>
    </section>
  );
}
