import type { CSSProperties } from 'react';
import { SEAT_META } from '@/games/ludo/engine/board';
import { FINISH, TRACK_LAST } from '@/games/ludo/engine/types';
import type { GameState } from '@/games/ludo/engine/types';
import { finishedCount, progressOf } from '@/games/ludo/engine/rules';

interface PlayerCardProps {
  state: GameState;
  player: number;
  active: boolean;
  winner: boolean;
}

/** 单架飞机的状态标签 */
function planeLabel(pos: number): string {
  if (pos < 0) return '机库';
  if (pos === FINISH) return '归位';
  if (pos > TRACK_LAST) return `终${pos - TRACK_LAST}`;
  return `第${pos + 1}步`;
}

function planeState(pos: number): 'base' | 'track' | 'home' | 'finish' {
  if (pos < 0) return 'base';
  if (pos === FINISH) return 'finish';
  if (pos > TRACK_LAST) return 'home';
  return 'track';
}

/** 玩家信息卡：机库状态、推进度与归位数量 */
export function PlayerCard({ state, player, active, winner }: PlayerCardProps) {
  const seat = state.seats[player];
  const meta = SEAT_META[seat];
  const progress = Math.round(progressOf(state, player) * 100);
  const home = finishedCount(state, player);

  return (
    <div
      className="player-card"
      data-active={active}
      style={{ '--seat-color': meta.color, '--p': `${progress}%` } as CSSProperties}
    >
      {/* 圆形徽章：外圈 conic-gradient 表示推进进度，呼应棋盘圆形机库 */}
      <span className="seat-avatar" aria-hidden="true">
        <span>{meta.short}</span>
      </span>

      <div className="player-main">
        <div className="player-row">
          <span className="seat-name">{meta.name}</span>
          <span className="text-[10px] tracking-[0.16em] text-[var(--dim)]">AI</span>
          <span className="flex-1" />
          {winner ? (
            <span className="rounded-md bg-[linear-gradient(135deg,#ffd166,#3ddc97)] px-2 py-0.5 text-[10px] font-bold text-[#06251b]">
              获胜
            </span>
          ) : active ? (
            <span className="text-[10px] tracking-[0.12em]" style={{ color: meta.color }}>
              行动中
            </span>
          ) : (
            <span className="text-[10px] text-[var(--dim)]">待机</span>
          )}
        </div>

        <div className="player-progress">
          <i style={{ width: `${progress}%` }} />
        </div>

        <div className="player-meta">
          <span>推进 {progress}%</span>
          <span>
            归位 <b className="text-[var(--ink-strong)]">{home}</b> / 4
          </span>
        </div>

        <div className="plane-status">
          {state.planes[player].map((pos, plane) => (
            <span key={plane} className="plane-chip" data-state={planeState(pos)}>
              {plane + 1}号 · {planeLabel(pos)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
