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

/**
 * 回放控制条：拖动进度、自动播放与退出回放
 *
 * @param index 当前帧下标
 * @param total 总帧数
 * @param label 当前帧描述
 * @param playing 是否正在自动播放
 * @param onIndex 拖动进度到指定帧
 * @param onTogglePlay 自动播放/暂停切换
 * @param onClose 退出回放
 * @returns 渲染回放控制条；所有操作通过回调委托给会话层
 */
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
      <span className="camel-replay-badge">REPLAY</span>
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
