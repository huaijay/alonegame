interface ReplayBarProps {
  /** 当前帧下标 */
  index: number;
  /** 总帧数 */
  total: number;
  /** 当前帧描述 */
  label: string;
  playing: boolean;
  onIndex: (index: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
}

/** 回放控制条：拖动进度、自动播放与退出回放 */
export function ReplayBar({
  index,
  total,
  label,
  playing,
  onIndex,
  onTogglePlay,
  onClose,
}: ReplayBarProps) {
  return (
    <div className="replay-bar">
      <span className="rounded bg-[rgba(255,79,216,0.16)] px-2 py-0.5 text-[10px] tracking-[0.14em] text-[var(--accent-2)]">
        REPLAY
      </span>
      <button
        type="button"
        className="btn btn-icon"
        onClick={onTogglePlay}
        title={playing ? '暂停回放' : '自动播放'}
        aria-label={playing ? '暂停回放' : '自动播放'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        )}
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        step={1}
        value={index}
        onChange={(event) => onIndex(Number(event.target.value))}
        aria-label="回放进度"
      />

      <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--ink-soft)]">
        {index + 1} / {total} · {label}
      </span>

      <button type="button" className="btn" onClick={onClose}>
        退出回放
      </button>
    </div>
  );
}
