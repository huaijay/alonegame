import { SEAT_META, TILE_META, rowCapacity } from '@/games/azul/engine/board';
import type { Seat } from '@/games/azul/engine/board';
import { progressOf } from '@/games/azul/engine/rules';
import type { PlayerBoard } from '@/games/azul/engine/types';

interface PlayerCardProps {
  seat: Seat;
  board: PlayerBoard;
  /** 是否为当前行动玩家 */
  active: boolean;
  winner: boolean;
}

/** 座位卡：得分、图案行进度、墙块与地板简况 */
export function PlayerCard({ seat, board, active, winner }: PlayerCardProps) {
  const meta = SEAT_META[seat];
  const progress = progressOf(board);

  return (
    <div className="player-card" data-active={active} style={{ '--seat-color': meta.color } as React.CSSProperties}>
      <div className="seat-avatar" style={{ '--p': `${Math.round(progress * 100)}%` } as React.CSSProperties}>
        <span>{board.score}</span>
      </div>
      <div className="player-main">
        <div className="player-row">
          <span className="seat-name">{meta.name}</span>
          {winner ? <span className="plane-chip" data-state="finish">胜者</span> : null}
          {active ? <span className="plane-chip" data-state="track">行动中</span> : null}
          {board.hasFirstMarker ? <span className="plane-chip" data-state="home">先手</span> : null}
        </div>
        <div className="azul-row-dots">
          {board.rows.map((pattern, row) => (
            <span key={row} className="azul-row-dot-group" title={`第 ${row + 1} 行`}>
              {Array.from({ length: rowCapacity(row) }, (_, slot) => {
                const filled = slot < pattern.count;
                return (
                  <i
                    key={slot}
                    data-filled={filled}
                    style={filled && pattern.color !== null
                      ? ({ background: TILE_META[pattern.color].color } as React.CSSProperties)
                      : undefined}
                  />
                );
              })}
            </span>
          ))}
        </div>
        <div className="player-meta">
          <span>墙 {board.wall.flat().filter(Boolean).length}/25</span>
          <span>地板 {board.floor.length}</span>
        </div>
      </div>
    </div>
  );
}
