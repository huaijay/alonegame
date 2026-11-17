import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SEAT_META } from '@/games/azul/engine/board';
import { GameSession } from '@/games/azul/engine/session';
import type { SessionSnapshot } from '@/games/azul/engine/session';
import type { GameConfig, GameState } from '@/games/azul/engine/types';
import { loadStats, recordResult, resetStats } from '@/games/azul/engine/stats';
import type { WinStats } from '@/games/azul/engine/stats';
import { Board } from '@/games/azul/ui/Board';
import { ControlBar } from '@/games/azul/ui/ControlBar';
import { ReplayBar } from '@/games/azul/ui/ReplayBar';
import { PlayerCard } from '@/games/azul/ui/PlayerCard';
import { AiPanel } from '@/games/azul/ui/AiPanel';
import { EventLog } from '@/games/azul/ui/EventLog';
import { StatsPanel } from '@/games/azul/ui/StatsPanel';

interface GameStageProps {
  config: GameConfig;
  onExit: () => void;
}

/** 生成当前阶段的中文提示 */
function describePhase(snap: SessionSnapshot): string {
  const seat = snap.state.seats[snap.actingPlayer];
  const name = seat === undefined ? '玩家' : SEAT_META[seat].name;
  switch (snap.phase) {
    case 'thinking':
      return `${name} 推演最优拿砖`;
    case 'acting':
      return `${name} 放置花砖`;
    case 'roundEnd':
      return `${name} 轮末结算`;
    case 'finished':
      return '本局结束';
    default:
      return `${name} 回合`;
  }
}

/** 侧栏展开状态的本地存储键 */
const SIDE_KEY = 'fxq:azul-side-open';

/** 读取侧栏展开状态，默认展开 */
function readSideOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDE_KEY) !== 'closed';
  } catch {
    // 隐私模式下 localStorage 不可用，保持默认展开
    return true;
  }
}

/** 对局主界面：供应区、玩家板、座位卡、AI 决策、事件日志与回放 */
export function GameStage({ config, onExit }: GameStageProps) {
  const session = useMemo(() => new GameSession(config), [config]);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  const [stats, setStats] = useState<WinStats>(() => loadStats());
  const [sideOpen, setSideOpen] = useState<boolean>(readSideOpen);
  const recordedRef = useRef(false);

  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);

  /** 每局结束写入一次累计统计 */
  useEffect(() => {
    if (snap.status !== 'finished' || recordedRef.current) return;
    recordedRef.current = true;
    setStats(recordResult(snap.state.winner, snap.state.round));
  }, [snap.status, snap.state.winner, snap.state.round]);

  const replaying = snap.replayIndex !== null;
  const frame = snap.replayIndex === null ? null : snap.frames[snap.replayIndex];
  const viewState: GameState = frame ? frame.state : snap.state;

  /** 回放时展示的是历史帧，因此不显示行动高亮 */
  const activeStep = replaying ? null : snap.activeStep;
  const viewPlayer = replaying ? frame?.state.current ?? 0 : snap.state.current;

  const winnerSeat = snap.state.winner;
  const winnerMeta = winnerSeat === null ? null : SEAT_META[winnerSeat];

  /** 重开：清空本局记账标记并重新开始 */
  const handleRestart = () => {
    recordedRef.current = false;
    session.restart();
  };

  /** 折叠 / 展开右侧决策栏，并写入本地存储 */
  const toggleSide = () => {
    const next = !sideOpen;
    try {
      window.localStorage.setItem(SIDE_KEY, next ? 'open' : 'closed');
    } catch {
      // 写入失败不影响当前会话的折叠操作
    }
    setSideOpen(next);
  };

  return (
    <div className="game-layout" data-side={sideOpen ? 'open' : 'closed'}>
      <div className="col-main">
        {/* 座位条：分数与图案行进度的实时缩影 */}
        <div className="seat-rail">
          {snap.state.seats.map((seat, player) => (
            <PlayerCard
              key={seat}
              seat={seat}
              board={viewState.players[player]}
              active={!replaying && snap.actingPlayer === player && snap.status !== 'finished'}
              winner={winnerSeat === seat}
            />
          ))}
        </div>

        {winnerMeta ? (
          <div
            className="panel flex items-center justify-between gap-3 px-4 py-3"
            style={{ borderColor: `${winnerMeta.color}66` }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: winnerMeta.color, boxShadow: `0 0 12px ${winnerMeta.color}` }}
              />
              <span className="text-[13px] font-semibold" style={{ color: winnerMeta.color }}>
                {winnerMeta.name} 获胜
              </span>
              <span className="text-[11px] text-[var(--muted)]">
                共 {snap.state.round} 轮 · 最高 {Math.max(...snap.state.players.map((p) => p.score))} 分
              </span>
            </div>
            <span className="text-[10px] tracking-[0.16em] text-[var(--dim)]">MATCH OVER</span>
          </div>
        ) : null}

        <div className="board-card">
          <Board state={viewState} viewPlayer={viewPlayer} activeStep={activeStep} />
          <div className="board-legend">
            <span className="legend-item">
              <span className="legend-swatch azul-legend-swatch" style={{ background: 'rgba(77,171,255,0.35)' }} aria-hidden="true" />
              五色工厂盘 · 整色拿走
            </span>
            <span className="legend-item">
              <span className="legend-swatch azul-legend-swatch" style={{ background: 'rgba(255,79,216,0.3)' }} aria-hidden="true" />
              首玩家标记 · 下轮先手
            </span>
            <span className="legend-item">
              <span className="legend-swatch azul-legend-swatch" style={{ background: 'rgba(255,209,102,0.3)' }} aria-hidden="true" />
              图案行 · 满行上墙
            </span>
            <span className="legend-item">
              <span className="legend-swatch azul-legend-swatch" style={{ background: 'rgba(255,143,163,0.3)' }} aria-hidden="true" />
              地板 · 罚分结算
            </span>
          </div>
          <div className="board-status">
            <div className="status-main">
              <span className="phase-dot" data-paused={snap.status !== 'running'} />
              <span className="status-strong">
                {replaying ? '回放模式' : describePhase(snap)}
              </span>
              <span>· 第 {viewState.round} 轮</span>
            </div>
            <span className="text-[10px] tracking-[0.16em] text-[var(--dim)]">AZUL</span>
          </div>
        </div>

        {replaying && frame ? (
          <ReplayBar
            index={frame.index}
            total={snap.frames.length}
            label={frame.label}
            playing={snap.replayPlaying}
            onIndex={(index) => session.setReplayIndex(index)}
            onTogglePlay={() => session.toggleReplayPlay()}
            onClose={() => session.closeReplay()}
          />
        ) : (
          <ControlBar
            status={snap.status}
            speed={snap.speed}
            phaseLabel={describePhase(snap)}
            replaying={replaying}
            onToggle={() => session.toggle()}
            onStep={() => session.stepOnce()}
            onSpeed={(speed) => session.setSpeed(speed)}
            onRestart={handleRestart}
            onReplay={() => session.openReplay()}
            onExit={onExit}
          />
        )}
      </div>

      {sideOpen ? (
        <aside className="col-side">
          {/* 折叠按钮单独靠右；面板顺序固定：事件日志 → 胜率统计 → AI 决策 */}
          <div className="side-bar">
            <button
              type="button"
              className="side-toggle"
              onClick={toggleSide}
              aria-label="收起侧边面板"
              title="收起侧边面板"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {/* 侧栏顺序：日志与统计位置固定，AI 决策高度随候选数变化，置于底部避免推挤上方面板 */}
          <EventLog log={snap.log} />
          <StatsPanel seats={snap.state.seats} stats={stats} onReset={() => setStats(resetStats())} />
          <AiPanel ai={snap.ai} state={snap.state} thinking={snap.phase === 'thinking'} />
        </aside>
      ) : (
        <button
          type="button"
          className="side-dock"
          onClick={toggleSide}
          aria-label="展开侧边面板"
          title="展开侧边面板"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>决策面板</span>
        </button>
      )}
    </div>
  );
}
