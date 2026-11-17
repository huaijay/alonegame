import type { CSSProperties } from 'react';
import { TILE_META, rowCapacity, wallColorOf } from '@/games/azul/engine/board';
import { FLOOR_LIMIT } from '@/games/azul/engine/types';
import type { PlayerBoard, TileColor } from '@/games/azul/engine/types';
import { FirstMarker, Tile } from '@/games/azul/ui/Tile';

interface PlayerBoardViewProps {
  board: PlayerBoard;
  /** 正在放置的图案行行号（高亮），无则 null */
  highlightRow?: number | null;
  /** 刚上墙的格子（高亮），无则 null */
  highlightWall?: { row: number; col: number } | null;
  /** 地板是否处于结算 / 弃置高亮 */
  highlightFloor?: boolean;
}

/** 图案行阶梯：每行 row+1 个槽位，从上到下递增 */
function PatternRows({ board, highlightRow }: { board: PlayerBoard; highlightRow: number | null }) {
  return (
    <div className="azul-pattern">
      {board.rows.map((pattern, row) => {
        const slots = Array.from({ length: rowCapacity(row) }, (_, slot) => slot);
        return (
          <div key={row} className="azul-pattern-row" data-active={highlightRow === row}>
            {slots.map((slot) => {
              const filled = slot < pattern.count;
              return (
                <span key={slot} className="azul-slot">
                  {filled && pattern.color !== null ? (
                    <Tile color={pattern.color} size="md" popKey={`${row}-${pattern.count}`} />
                  ) : null}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** 分数墙：5×5 网格，格底提示应放颜色，已上墙显示实砖 */
function ScoreWall({
  board,
  highlight,
}: {
  board: PlayerBoard;
  highlight: { row: number; col: number } | null;
}) {
  return (
    <div className="azul-wall">
      {board.wall.map((line, row) =>
        line.map((filled, col) => {
          const color = wallColorOf(row, col);
          const isNew = highlight !== null && highlight.row === row && highlight.col === col;
          return (
            <span
              key={`${row}-${col}`}
              className="azul-wall-cell"
              data-new={isNew}
              style={{ '--cell': TILE_META[color].color } as CSSProperties}
            >
              {filled ? <Tile color={color} size="md" pulse={isNew} popKey={isNew ? `${row}-${col}` : undefined} /> : null}
            </span>
          );
        }),
      )}
    </div>
  );
}

/** 地板条：7 个罚分槽位 + 首玩家标记位 */
function FloorLine({ board, highlight }: { board: PlayerBoard; highlight: boolean }) {
  const slots = Array.from({ length: FLOOR_LIMIT }, (_, i) => i);
  return (
    <div className="azul-floor" data-active={highlight}>
      <FirstMarker pulse={board.hasFirstMarker && highlight} />
      {slots.map((slot) => {
        const color: TileColor | null = board.floor[slot] ?? null;
        return (
          <span key={slot} className="azul-slot" data-floor>
            {color !== null ? <Tile color={color} popKey={`floor-${board.floor.length}`} /> : null}
          </span>
        );
      })}
      <span className="azul-floor-penalty">
        {board.floor.length > 0 ? `${Math.min(board.floor.length, 7)} 块待结算` : '地板'}
      </span>
    </div>
  );
}

/** 玩家板视图：图案行阶梯 + 分数墙 + 地板，只读展示 */
export function PlayerBoardView({
  board,
  highlightRow = null,
  highlightWall = null,
  highlightFloor = false,
}: PlayerBoardViewProps) {
  return (
    <div className="azul-playerboard">
      <PatternRows board={board} highlightRow={highlightRow} />
      <ScoreWall board={board} highlight={highlightWall} />
      <FloorLine board={board} highlight={highlightFloor} />
    </div>
  );
}
