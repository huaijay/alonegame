import { TILE_META } from '@/games/azul/engine/board';
import { FLOOR_LIMIT } from '@/games/azul/engine/types';
import type { GameState, MoveStep, TileColor } from '@/games/azul/engine/types';
import { FirstMarker, Tile } from '@/games/azul/ui/Tile';
import { PlayerBoardView } from '@/games/azul/ui/PlayerBoardView';

interface BoardProps {
  state: GameState;
  /** 展示哪位玩家的板（对局中为当前行动玩家，回放时为帧内先手） */
  viewPlayer: number;
  /** 正在呈现的步骤，据此高亮供应区 / 图案行 / 墙 / 地板 */
  activeStep: MoveStep | null;
}

/** 从当前呈现步骤推导各区域的高亮标记 */
function readHighlight(step: MoveStep | null, factoryCount: number) {
  const source = step?.kind === 'pick' ? step.source : null;
  return {
    source,
    isCenterPick: source === factoryCount,
    centerMarker: step?.kind === 'marker',
    row: step?.kind === 'place' ? step.row : null,
    wall: step?.kind === 'wall' ? { row: step.row, col: step.col } : null,
    floor: step?.kind === 'discard' || step?.kind === 'penalty',
  };
}

/** 供应盘：工厂盘为圆碟，中央区为更大的托盘 */
function Supply({ state, highlight }: { state: GameState; highlight: ReturnType<typeof readHighlight> }) {
  return (
    <div className="azul-supply">
      {state.factories.map((plate, index) => {
        const tiles: { color: TileColor; key: string }[] = [];
        plate.forEach((count, color) => {
          const tileColor = color as TileColor;
          for (let i = 0; i < count; i += 1) tiles.push({ color: tileColor, key: `${index}-${color}-${i}` });
        });
        const active = highlight.source === index;
        return (
          <div key={index} className="azul-factory" data-active={active} data-empty={tiles.length === 0}>
            <span className="azul-factory-label">{index + 1}</span>
            {tiles.map((tile) => (
              <Tile key={tile.key} color={tile.color} pulse={active} />
            ))}
          </div>
        );
      })}
      <div className="azul-center" data-active={highlight.isCenterPick}>
        <span className="azul-factory-label">中央</span>
        {state.centerMarker ? <FirstMarker pulse={highlight.centerMarker} /> : null}
        {state.center.flatMap((count, color) =>
          Array.from({ length: count }, (_, i) => (
            <Tile key={`c-${color}-${i}`} color={color as TileColor} pulse={highlight.isCenterPick} />
          )),
        )}
      </div>
    </div>
  );
}

/** 对局主视图：供应区 + 当前玩家板，所有高亮跟随会话步骤 */
export function Board({ state, viewPlayer, activeStep }: BoardProps) {
  const highlight = readHighlight(activeStep, state.factoryCount);
  const board = state.players[viewPlayer];

  return (
    <div className="azul-stage">
      <Supply state={state} highlight={highlight} />
      <div className="azul-table" data-thinking={activeStep === null}>
        <div className="azul-table-head">
          <span className="azul-table-title">当前玩家板</span>
          <span className="azul-table-sub">
            {TILE_META.map((meta) => (
              <i key={meta.name} title={meta.name} style={{ background: meta.color }} />
            ))}
          </span>
        </div>
        {board ? (
          <PlayerBoardView
            board={board}
            highlightRow={highlight.row}
            highlightWall={highlight.wall}
            highlightFloor={highlight.floor}
          />
        ) : null}
        <div className="azul-floor-hint">
          地板罚分顺序：-1 · -1 · -2 · -2 · -2 · -3 · -3（共 {FLOOR_LIMIT} 格）
        </div>
      </div>
    </div>
  );
}
