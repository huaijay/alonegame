import { useEffect, useRef } from 'react';
import type { LogEntry } from '@/games/camel-up/engine/session';

interface EventLogProps {
  log: LogEntry[];
}

/**
 * 事件日志面板：按事件粒度展示骆驼大赛对局过程（押注/掷骰/移动/结算）
 * 色调配色由 camel-up.css 的 .camel-stage .log-row[data-tone] 提供。
 *
 * @param log 会话产出的日志条目列表（只读快照）
 * @returns 渲染日志面板；副作用仅限在新日志写入后自动滚动列表到底部
 */
export function EventLog({ log }: EventLogProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // 日志达到上限后会剔除旧条目，长度不再变化，因此以最后一条 id 触发滚动
  const lastId = log.length > 0 ? log[log.length - 1].id : 0;

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastId]);

  return (
    <section className="panel event-log">
      <div className="panel-head">
        <h2 className="panel-title">事件日志</h2>
        <span className="panel-sub">{log.length} 条</span>
      </div>
      <div className="log-list" ref={listRef}>
        {log.map((entry) => (
          <div key={entry.id} className="log-row" data-tone={entry.tone}>
            <span className="log-turn">#{entry.turn}</span>
            <span>{entry.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
