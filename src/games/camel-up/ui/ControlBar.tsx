import type { SessionStatus } from '@/games/camel-up/engine/session';

interface ControlBarProps {
  status: SessionStatus;
  speed: number;
  /** 当前阶段的中文描述，如「红方 押注」 */
  phaseLabel: string;
  /** 是否处于回放视图 */
  replaying: boolean;
  onToggle: () => void;
  onStep: () => void;
  onSpeed: (speed: number) => void;
  onRestart: () => void;
  onReplay: () => void;
  onExit: () => void;
}

const SPEEDS = [0.5, 1, 2, 4, 8];

/** 播放 / 暂停图标 */
function PlayIcon({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

/**
 * 对局控制条：暂停、单步、倍速、重开、回放与返回配置
 *
 * @param status 会话运行状态（running / paused / finished）
 * @param speed 当前播放倍速
 * @param phaseLabel 当前阶段的中文描述
 * @param replaying 是否处于回放视图（回放时禁用播放控制）
 * @param onToggle 暂停/继续切换
 * @param onStep 单步推进
 * @param onSpeed 设置播放倍速
 * @param onRestart 重开一局
 * @param onReplay 进入回放
 * @param onExit 返回配置页
 * @returns 渲染控制条；所有操作通过回调委托给会话层
 */
export function ControlBar({
  status,
  speed,
  phaseLabel,
  replaying,
  onToggle,
  onStep,
  onSpeed,
  onRestart,
  onReplay,
  onExit,
}: ControlBarProps) {
  const paused = status === 'paused';

  return (
    <div className="panel control-bar">
      <button
        type="button"
        className="btn btn-primary"
        onClick={onToggle}
        disabled={status === 'finished' || replaying}
      >
        <PlayIcon paused={paused} />
        {paused ? '继续' : '暂停'}
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={onStep}
        disabled={status === 'finished' || replaying}
        title="单步推进"
        aria-label="单步推进"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M6 5.5v13l9-6.5z" />
          <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
        </svg>
      </button>

      <div className="hidden text-[11px] text-[var(--muted)] sm:block">{phaseLabel}</div>

      <span className="control-spacer" />

      <span className="text-[10px] tracking-[0.16em] text-[var(--dim)]">SPEED</span>
      <div className="seg" role="group" aria-label="播放倍速">
        {SPEEDS.map((item) => (
          <button
            key={item}
            type="button"
            className="seg-item"
            data-active={speed === item}
            onClick={() => onSpeed(item)}
          >
            {item}x
          </button>
        ))}
      </div>

      <button type="button" className="btn" onClick={onReplay} disabled={replaying}>
        回放
      </button>
      <button type="button" className="btn" onClick={onRestart}>
        重开
      </button>
      <button type="button" className="btn" onClick={onExit}>
        返回配置
      </button>
    </div>
  );
}
