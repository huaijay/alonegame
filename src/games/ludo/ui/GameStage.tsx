import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SEAT_META } from '@/games/ludo/engine/board';
import { GameSession } from '@/games/ludo/engine/session';
import type { LogEntry, SessionSnapshot } from '@/games/ludo/engine/session';
import type { GameConfig, GameState } from '@/games/ludo/engine/types';
import { loadStats, recordResult, resetStats } from '@/games/ludo/engine/stats';
import type { WinStats } from '@/games/ludo/engine/stats';
import { Board } from '@/games/ludo/ui/Board';
import type { BoardPulse } from '@/games/ludo/ui/Board';
import { ControlBar } from '@/games/ludo/ui/ControlBar';
import { ReplayBar } from '@/games/ludo/ui/ReplayBar';
import { PlayerCard } from '@/games/ludo/ui/PlayerCard';
import { AiPanel } from '@/games/ludo/ui/AiPanel';
import { EventLog } from '@/games/ludo/ui/EventLog';
import { StatsPanel } from '@/games/ludo/ui/StatsPanel';
import { Dice } from '@/games/ludo/ui/Dice';

interface GameStageProps {
  config: GameConfig;
  onExit: () => void;
}

/** 生成当前阶段的中文提示 */
function describePhase(snap: SessionSnapshot): string {
  const seat = snap.state.seats[snap.actingPlayer];
  const name = seat === undefined ? '玩家' : SEAT_META[seat].name;
  switch (snap.phase) {
    case 'rolling':
      return `${name} 掷骰`;
    case 'thinking':
      return `${name} 推演最优走法`;
    case 'moving':
      return `${name} 移动飞机`;
    case 'settling':
      return `${name} 回合结算`;
    case 'finished':
      return '本局结束';
    default:
      return `${name} 回合`;
  }
}

/** 侧栏展开状态的本地存储键 */
const SIDE_KEY = 'fxq:side-open';

/** 读取侧栏展开状态，默认展开 */
function readSideOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDE_KEY) !== 'closed';
  } catch {
    // 隐私模式下 localStorage 不可用，保持默认展开
    return true;
  }
}

/** 对局主界面：棋盘、玩家面板、AI 决策、事件日志与回放 */
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
    setStats(recordResult(snap.state.winner, snap.state.rolls));
  }, [snap.status, snap.state.winner, snap.state.rolls]);

  const replaying = snap.replayIndex !== null;
  const frame = snap.replayIndex === null ? null : snap.frames[snap.replayIndex];
  const viewState: GameState = frame
    ? { ...snap.state, planes: frame.planes, current: frame.current }
    : snap.state;

  /** 回放时展示的是历史帧，因此不显示行动高亮 */
  const activePlayer = replaying ? null : snap.actingPlayer;
  const activePlane =
    playbackPlane(replaying, snap.actingPlayer, snap.activePlane);
  /** 事件脉冲：跟随最新对局事件驱动棋盘爆发动画，回放时不触发 */
  const pulse = readPulse(snap.log, snap.state, replaying);

  const winnerSeat = snap.state.winner;
  const winnerMeta = winnerSeat === null ? null : SEAT_META[winnerSeat];
  const diceValue = frame ? frame.dice : (snap.dice?.value ?? null);
  const dicePlayer = frame ? frame.current : (snap.dice?.player ?? null);
  const diceKey = frame ? frame.index : (snap.dice?.seq ?? 0);

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
        {/* 四大基地式座位条：呼应棋盘四角机库的圆形语言 */}
        <div className="seat-rail">
          {snap.state.seats.map((seat, player) => (
            <PlayerCard
              key={seat}
              state={viewState}
              player={player}
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
                共 {snap.state.rolls} 手 · 四机归位
              </span>
            </div>
            <span className="text-[10px] tracking-[0.16em] text-[var(--dim)]">MATCH OVER</span>
          </div>
        ) : null}

        <div className="board-card">
          <Board state={viewState} activePlayer={activePlayer} activePlane={activePlane} pulse={pulse} />
          <div className="board-legend">
            <span className="legend-item">
              <span className="legend-swatch" data-kind="start" aria-hidden="true" />
              起点 · 掷 6 起飞
            </span>
            <span className="legend-item">
              <span className="legend-swatch" data-kind="jump" aria-hidden="true" />
              同色格 · 跳跃 4 格
            </span>
            <span className="legend-item">
              <span className="legend-swatch" data-kind="fly" aria-hidden="true" />
              飞行格 · 飞跃 12 格
            </span>
            <span className="legend-item">
              <span className="legend-swatch" data-kind="home" aria-hidden="true" />
              星标 · 精确归位
            </span>
          </div>
          <div className="board-status">
            <div className="status-main">
              <span className="phase-dot" data-paused={snap.status !== 'running'} />
              <span className="status-strong">
                {replaying ? '回放模式' : describePhase(snap)}
              </span>
              <span>· 第 {viewState.rolls} 手</span>
            </div>
            <Dice
              value={diceValue}
              rollKey={diceKey}
              rolling={!replaying && snap.phase === 'rolling'}
              player={dicePlayer}
            />
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
          {/* 折叠按钮单独靠右；原「决策 · 日志 · 统计」标题文字已移除 */}
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

/**
 * 计算棋盘上需要高亮的飞机
 *
 * @param replaying 是否处于回放视图
 * @param player 当前行动玩家序号
 * @param plane 正在移动的飞机序号，未移动为 null
 * @returns 高亮目标；回放或无移动时为 null
 */
function playbackPlane(
  replaying: boolean,
  player: number,
  plane: number | null,
): { player: number; plane: number } | null {
  if (replaying || plane === null) return null;
  return { player, plane };
}

/** 会触发棋盘爆发动画的日志音调 */
const PULSE_TONES: readonly LogEntry['tone'][] = ['jump', 'fly', 'capture', 'finish', 'win'];

/**
 * 从最新日志推导棋盘事件脉冲
 * @param log 事件日志
 * @param state 当前对局状态（用于把玩家序号映射为座位）
 * @param replaying 是否处于回放视图（回放不触发动画）
 * @returns 脉冲描述；无需动画时为 null
 */
function readPulse(log: LogEntry[], state: GameState, replaying: boolean): BoardPulse | null {
  if (replaying || log.length === 0) return null;
  const last = log[log.length - 1];
  if (!(PULSE_TONES as readonly string[]).includes(last.tone)) return null;
  return {
    id: last.id,
    tone: last.tone as BoardPulse['tone'],
    seat: state.seats[last.player],
  };
}
