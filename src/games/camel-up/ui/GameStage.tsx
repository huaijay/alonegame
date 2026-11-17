import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SEAT_META } from '@/games/camel-up/engine/board';
import { GameSession } from '@/games/camel-up/engine/session';
import type { SessionSnapshot } from '@/games/camel-up/engine/session';
import type { GameConfig, GameState } from '@/games/camel-up/engine/types';
import { loadStats, recordResult, resetStats } from '@/games/camel-up/engine/stats';
import type { WinStats } from '@/games/camel-up/engine/stats';
import { Board } from '@/games/camel-up/ui/Board';
import { ControlBar } from '@/games/camel-up/ui/ControlBar';
import { ReplayBar } from '@/games/camel-up/ui/ReplayBar';
import { PlayerCard } from '@/games/camel-up/ui/PlayerCard';
import { AiPanel } from '@/games/camel-up/ui/AiPanel';
import { EventLog } from '@/games/camel-up/ui/EventLog';
import { StatsPanel } from '@/games/camel-up/ui/StatsPanel';

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
      return `${name} 推演最优行动`;
    case 'acting':
      return `${name} 行动中`;
    case 'finished':
      return '本局结束';
    default:
      return `${name} 回合`;
  }
}

/** 侧栏展开状态的本地存储键 */
const SIDE_KEY = 'fxq:camel-up-side-open';

/** 读取侧栏展开状态，默认展开 */
function readSideOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDE_KEY) !== 'closed';
  } catch {
    // 隐私模式下 localStorage 不可用，保持默认展开
    return true;
  }
}

/** 对局主界面：黄沙嘉年华舞台 —— 环形赛道、座位卡、事件日志、胜率统计与 AI 决策 */
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
    setStats(recordResult(snap.state.winner, snap.state.leg));
  }, [snap.status, snap.state.winner, snap.state.leg]);

  const replaying = snap.replayIndex !== null;
  const frame = snap.replayIndex === null ? null : snap.frames[snap.replayIndex];
  const viewState: GameState = frame ? frame.state : snap.state;

  /** 回放时展示的是历史帧，因此不显示行动高亮 */
  const activeStep = replaying ? null : snap.activeStep;

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
    <div className="camel-stage" data-side={sideOpen ? 'open' : 'closed'}>
      <div className="cmp-main">
        {/* 座位条：金币与手牌、腿注的实时缩影 */}
        <div className="cmp-seat-rail">
          {snap.state.seats.map((seat, player) => (
            <PlayerCard
              key={seat}
              seat={seat}
              player={viewState.players[player]}
              active={!replaying && snap.actingPlayer === player && snap.status !== 'finished'}
              winner={winnerSeat === seat}
            />
          ))}
        </div>

        {/* 终局横幅：金色缎带 + 掠光动效 */}
        {winnerMeta ? (
          <div className="cmp-winner">
            <span className="cmp-winner-trophy" aria-hidden="true">
              🏆
            </span>
            <div className="cmp-winner-body">
              <span className="cmp-winner-title">{winnerMeta.name} 获胜</span>
              <span className="cmp-winner-sub">
                共 {snap.state.leg} 腿 · 最高 {Math.max(...snap.state.players.map((p) => p.coins))} EP
              </span>
            </div>
            <span className="cmp-winner-tag">MATCH OVER</span>
          </div>
        ) : null}

        <div className="cmp-board-card">
          <Board state={viewState} activeStep={activeStep} />
          <div className="cmp-legend">
            <span className="cmp-legend-item">
              <span className="cmp-swatch" style={{ background: 'var(--cmp-gold)' }} aria-hidden="true" />
              骆驼棋子 · 堆顶名次靠前
            </span>
            <span className="cmp-legend-item">
              <span className="cmp-swatch" style={{ background: 'var(--camel-oasis)' }} aria-hidden="true" />
              绿洲地形块 · 触发 +1 前进
            </span>
            <span className="cmp-legend-item">
              <span className="cmp-swatch" style={{ background: 'var(--camel-mirage)' }} aria-hidden="true" />
              海市蜃楼 · 触发 -1 插底
            </span>
            <span className="cmp-legend-item">
              <span className="cmp-swatch" style={{ background: 'var(--cmp-tile-first)' }} aria-hidden="true" />
              腿注片 5/3/2 · 骰子塔摇骰
            </span>
          </div>
          <div className="cmp-status" data-paused={snap.status !== 'running'}>
            <div className="cmp-status-main">
              <span className="cmp-status-dot" />
              <span className="cmp-status-strong">{replaying ? '回放模式' : describePhase(snap)}</span>
              <span>· 第 {viewState.leg} 腿</span>
            </div>
            <span className="cmp-status-mark">CAMEL UP</span>
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
        <aside className="cmp-side">
          {/* 折叠按钮单独靠右；面板顺序固定：事件日志 → 胜率统计 → AI 决策 */}
          <div className="cmp-side-bar">
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
          className="cmp-side-dock"
          onClick={toggleSide}
          aria-label="展开侧边面板"
          title="展开侧边面板"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
