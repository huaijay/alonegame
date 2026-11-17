import { FACTORY_COUNT, floorPenalty, nonEmptyColors, rowCapacity, wallColOf, wallColorOf } from './board';
import type { Seat } from './board';
import {
  FACTORY_TILES,
  FLOOR_LIMIT,
  TILE_COLORS,
  TILES_PER_COLOR,
  WALL_SIZE,
} from './types';
import type {
  GameState,
  Move,
  MoveResult,
  MoveStep,
  PlayerBoard,
  TileColor,
} from './types';

/** 创建空玩家板 */
function createPlayerBoard(): PlayerBoard {
  return {
    score: 0,
    rows: Array.from({ length: WALL_SIZE }, () => ({ color: null, count: 0 })),
    wall: Array.from({ length: WALL_SIZE }, () => Array<boolean>(WALL_SIZE).fill(false)),
    floor: [],
    hasFirstMarker: false,
  };
}

/** 复制玩家板，供完整快照与轮末结算取得独占可写副本。 */
function clonePlayerBoard(board: PlayerBoard): PlayerBoard {
  return {
    score: board.score,
    rows: board.rows.map((row) => ({ ...row })),
    wall: board.wall.map((line) => [...line]),
    floor: [...board.floor],
    hasFirstMarker: board.hasFirstMarker,
  };
}

/**
 * 深拷贝对局状态，生成相互独立的动画或回放快照。
 * @param state 原始局面
 * @returns 所有数组和玩家板都独立的新局面
 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    seats: [...state.seats],
    factories: state.factories.map((plate) => [...plate]),
    center: [...state.center],
    players: state.players.map(clonePlayerBoard),
    bag: [...state.bag],
    discard: [...state.discard],
  };
}

interface DrawResult {
  /** 本次抽到的各色数量 */
  drawn: number[];
  bag: number[];
  discard: number[];
}

/**
 * 从袋中抽砖；袋不足时先把弃堆全部倒回袋中。
 *
 * @param bag 袋中五色计数
 * @param discard 弃堆五色计数
 * @param count 需要抽取的砖数
 * @param rng 随机源；缺省时按色号轮转均匀抽取（测试与预览使用确定性模式）
 * @returns 抽到的砖与新袋 / 新弃堆
 */
function drawTiles(bag: number[], discard: number[], count: number, rng?: () => number): DrawResult {
  let pool = [...bag];
  let rest = [...discard];
  // 袋中砖不够本轮补给时，把弃堆全部倒回袋中再抽
  const inBag = pool.reduce((sum, value) => sum + value, 0);
  if (inBag < count && rest.some((value) => value > 0)) {
    pool = pool.map((value, color) => value + rest[color]);
    rest = rest.map(() => 0);
  }

  const drawn = new Array<number>(TILE_COLORS).fill(0);
  let remaining = count;
  // 确定性模式的轮转游标：按非空色序循环取色，保证无随机源时供应依旧均衡
  let turn = 0;
  while (remaining > 0) {
    const available = nonEmptyColors(pool);
    if (available.length === 0) break;
    if (rng) {
      // 按袋中剩余比例随机挑色，等价于把砖洗匀后逐块抽取
      const totalLeft = available.reduce<number>((sum, color) => sum + pool[color], 0);
      let roll = rng() * totalLeft;
      let color: TileColor = available[available.length - 1];
      for (const candidate of available) {
        roll -= pool[candidate];
        if (roll <= 0) {
          color = candidate;
          break;
        }
      }
      pool[color] -= 1;
      drawn[color] += 1;
    } else {
      // why：按最小色号连抽会把整袋抽成单一颜色；轮转取色配合补盘的按色分组切分，
      // 恰好让每个工厂盘得到一整色的确定性供应
      const color = available[turn % available.length];
      turn += 1;
      pool[color] -= 1;
      drawn[color] += 1;
    }
    remaining -= 1;
  }
  return { drawn, bag: pool, discard: rest };
}

/**
 * 为空盘补砖：把抽到的砖按顺序切分成每盘 4 块。
 *
 * @param state 供应已清空的局面
 * @param rng 随机源；缺省时使用确定性抽取
 * @returns 携带新供应的局面
 */
function refillFactories(state: GameState, rng?: () => number): GameState {
  const { drawn, bag, discard } = drawTiles(state.bag, state.discard, state.factoryCount * FACTORY_TILES, rng);
  const pool: TileColor[] = [];
  for (let color = 0; color < TILE_COLORS; color += 1) {
    for (let i = 0; i < drawn[color]; i += 1) pool.push(color as TileColor);
  }
  const factories: number[][] = [];
  for (let plate = 0; plate < state.factoryCount; plate += 1) {
    const counts = new Array<number>(TILE_COLORS).fill(0);
    for (let slot = 0; slot < FACTORY_TILES; slot += 1) {
      const tile = pool[plate * FACTORY_TILES + slot];
      // 供应不足的极端局面允许出现不满的盘，规则结算不受影响
      if (tile === undefined) break;
      counts[tile] += 1;
    }
    factories.push(counts);
  }
  return { ...state, bag, discard, factories };
}

/**
 * 创建一局初始状态：洗好砖袋并补满工厂盘，红方（0 号玩家）先手。
 *
 * @param seats 参与座位
 * @param rng 随机源；缺省时初始供应按颜色顺序确定性生成（便于测试与预览）
 * @param maxRounds 轮次上限；0 表示不限（标准规则）
 */
export function createInitialState(seats: Seat[], rng?: () => number, maxRounds = 0): GameState {
  const factoryCount = FACTORY_COUNT[seats.length] ?? FACTORY_COUNT[2];
  const state: GameState = {
    seats: [...seats],
    factoryCount,
    factories: [],
    center: new Array<number>(TILE_COLORS).fill(0),
    centerMarker: true,
    players: seats.map(() => createPlayerBoard()),
    current: 0,
    round: 1,
    maxRounds,
    bag: new Array<number>(TILE_COLORS).fill(TILES_PER_COLOR),
    discard: new Array<number>(TILE_COLORS).fill(0),
    phase: 'placing',
    winner: null,
    firstPlayer: null,
  };
  return refillFactories(state, rng);
}

/** 判断某图案行能否放置给定颜色：行未满、行空或同色，且墙该行尚未上过该色 */
function canPlaceRow(board: PlayerBoard, row: number, color: TileColor): boolean {
  const pattern = board.rows[row];
  if (pattern.count >= rowCapacity(row)) return false;
  if (pattern.color !== null && pattern.color !== color) return false;
  return !board.wall[row][wallColOf(row, color)];
}

/**
 * 计算当前玩家的全部合法行动
 *
 * @param state 当前对局状态（须处于 placing 阶段）
 * @returns 合法行动列表；弃入地板的兜底行动始终存在
 */
export function getLegalMoves(state: GameState): Move[] {
  const board = state.players[state.current];
  const allowedRows = new Int8Array(TILE_COLORS);
  // 同色在不同工厂盘的放行条件相同，每次枚举只检查一遍玩家板。
  for (let color = 0; color < TILE_COLORS; color += 1) {
    for (let row = 0; row < WALL_SIZE; row += 1) {
      if (canPlaceRow(board, row, color as TileColor)) allowedRows[color] |= 1 << row;
    }
  }

  const moves: Move[] = [];
  for (let source = 0; source <= state.factoryCount; source += 1) {
    const supply = source < state.factoryCount ? state.factories[source] : state.center;
    for (let color = 0; color < TILE_COLORS; color += 1) {
      if (supply[color] <= 0) continue;
      for (let row = 0; row < WALL_SIZE; row += 1) {
        if ((allowedRows[color] & (1 << row)) !== 0) {
          moves.push({ source, color: color as TileColor, row });
        }
      }
      moves.push({ source, color: color as TileColor, row: -1 });
    }
  }
  return moves;
}

/**
 * 按项目现行规则计算上墙格的横纵连接分，供结算与 AI 投影共用。
 * @param wall 已包含新砖的墙
 * @param row 新砖所在行
 * @param col 新砖所在列
 * @returns 横向连续数加纵向连续数，双向成串时再加一分
 */
export function scoreForCell(wall: readonly (readonly boolean[])[], row: number, col: number): number {
  let horizontal = 1;
  for (let c = col - 1; c >= 0 && wall[row][c]; c -= 1) horizontal += 1;
  for (let c = col + 1; c < WALL_SIZE && wall[row][c]; c += 1) horizontal += 1;
  let vertical = 1;
  for (let r = row - 1; r >= 0 && wall[r][col]; r -= 1) vertical += 1;
  for (let r = row + 1; r < WALL_SIZE && wall[r][col]; r += 1) vertical += 1;
  return horizontal + vertical + (horizontal > 1 && vertical > 1 ? 1 : 0);
}

/**
 * 按项目现行规则汇总终局加分：满行 +6、满列 +2、每种已出现颜色 +10。
 * @param board 待计算的玩家墙，可传入 AI 投影墙
 * @returns 满行数、满列数、已出现颜色数和加分总额
 */
export function endgameBonus(board: Pick<PlayerBoard, 'wall'>): {
  rows: number;
  cols: number;
  colors: number;
  total: number;
} {
  let rows = 0;
  let cols = 0;
  for (let index = 0; index < WALL_SIZE; index += 1) {
    if (board.wall[index].every(Boolean)) rows += 1;
    if (board.wall.every((line) => line[index])) cols += 1;
  }
  let colors = 0;
  for (let color = 0; color < TILE_COLORS; color += 1) {
    let found = false;
    for (let row = 0; row < WALL_SIZE && !found; row += 1) {
      for (let col = 0; col < WALL_SIZE; col += 1) {
        if (board.wall[row][col] && wallColorOf(row, col) === color) {
          found = true;
          break;
        }
      }
    }
    if (found) colors += 1;
  }
  return { rows, cols, colors, total: rows * 6 + cols * 2 + colors * 10 };
}

/** 最高分者获胜；平分时玩家序号更小者胜（先手 tie-break） */
function winnerOf(players: readonly PlayerBoard[], seats: readonly Seat[]): Seat {
  let best = 0;
  for (let player = 1; player < players.length; player += 1) {
    if (players[player].score > players[best].score) best = player;
  }
  return seats[best];
}

/**
 * 结算本轮：按玩家顺序清地板扣分、满行移砖上墙，并检测终局。
 *
 * @param state 供应刚清空的局面（applyMove 内部传入，已是被本方持有的副本）
 * @param steps 可选的呈现步骤数组；未提供时只结算状态
 * @returns 轮末结算后的局面
 */
function finishRound(state: GameState, steps?: MoveStep[]): GameState {
  const next = state;
  for (let player = 0; player < next.players.length; player += 1) {
    const board = next.players[player];

    // 地板扣分：持首标记的玩家本会被计入，扣完清空并把砖送入弃堆
    if (board.hasFirstMarker || board.floor.length > 0) {
      if (board.floor.length > 0) {
        const penalty = floorPenalty(board.floor.length);
        board.score = Math.max(0, board.score + penalty);
        for (const color of board.floor) next.discard[color] += 1;
        board.floor = [];
        if (steps) steps.push({ kind: 'penalty', player, penalty, after: cloneState(next) });
      }
      board.hasFirstMarker = false;
    }

    // 满行移砖上墙：每行独立结算，行内砖色即落点列
    for (let row = 0; row < WALL_SIZE; row += 1) {
      const pattern = board.rows[row];
      if (pattern.color === null || pattern.count < rowCapacity(row)) continue;
      const color: TileColor = pattern.color;
      // 落点列由行错位几何的逆映射给出，禁止直接把色号当列号代入 wallColorOf
      const col = wallColOf(row, color);
      board.wall[row][col] = true;
      pattern.color = null;
      pattern.count = 0;
      const gained = scoreForCell(board.wall, row, col);
      board.score += gained;
      if (steps) steps.push({ kind: 'wall', player, row, col, color, gained, after: cloneState(next) });
    }
  }

  // 终局检测：任一玩家墙上有完整行，或已跑满配置的轮次上限
  const rowComplete = next.players.some((board) => board.wall.some((line) => line.every(Boolean)));
  const roundLimitReached = next.maxRounds > 0 && next.round >= next.maxRounds;
  if (rowComplete || roundLimitReached) {
    for (let player = 0; player < next.players.length; player += 1) {
      const bonus = endgameBonus(next.players[player]);
      next.players[player].score += bonus.total;
      if (steps) steps.push({
        kind: 'scoring',
        player,
        rows: bonus.rows,
        cols: bonus.cols,
        colors: bonus.colors,
        gained: bonus.total,
        after: cloneState(next),
      });
    }
    next.phase = 'gameEnd';
    next.winner = winnerOf(next.players, next.seats);
  } else {
    next.phase = 'roundEnd';
  }
  return next;
}

/** 同一结算流程可选择记录动画；无 steps 时不创建事件对象或完整快照。 */
function applyMoveCore(state: GameState, move: Move, steps?: MoveStep[]): GameState {
  const player = state.current;
  const originalBoard = state.players[player];
  // 普通拿砖只改当前玩家、选中工厂、中央和弃堆；其余数据保持只读共享。
  const next: GameState = {
    ...state,
    factories: [...state.factories],
    center: [...state.center],
    players: [...state.players],
    discard: [...state.discard],
  };
  const board: PlayerBoard = {
    ...originalBoard,
    rows: [...originalBoard.rows],
    floor: [...originalBoard.floor],
  };
  if (move.row >= 0) board.rows[move.row] = { ...originalBoard.rows[move.row] };
  next.players[player] = board;
  if (move.source < next.factoryCount) next.factories[move.source] = [...state.factories[move.source]];
  const isCenter = move.source >= next.factoryCount;
  const supply = isCenter ? next.center : next.factories[move.source];
  const count = supply[move.color];

  // 1. 拿砖：整色拿走；工厂盘余砖移入中央
  supply[move.color] = 0;
  let toCenter = 0;
  if (!isCenter) {
    const plate = next.factories[move.source];
    for (let color = 0; color < TILE_COLORS; color += 1) {
      if (plate[color] > 0) {
        next.center[color] += plate[color];
        toCenter += plate[color];
        plate[color] = 0;
      }
    }
  }
  if (steps) steps.push({ kind: 'pick', player, source: move.source, color: move.color, count, toCenter, after: cloneState(next) });

  // 2. 从中央拿砖时顺手拿下首玩家标记：该玩家将成为下轮先手
  if (isCenter && next.centerMarker) {
    next.centerMarker = false;
    board.hasFirstMarker = true;
    next.firstPlayer = player;
    if (steps) steps.push({ kind: 'marker', player, after: cloneState(next) });
  }

  // 3. 放置：图案行可放则放入，溢出与弃置统一走地板（超出 7 格容量的部分直接进弃堆）
  if (move.row >= 0) {
    const capacity = rowCapacity(move.row);
    const pattern = board.rows[move.row];
    pattern.color = move.color;
    pattern.count += count;
    const overflow = Math.max(0, pattern.count - capacity);
    pattern.count = Math.min(pattern.count, capacity);
    const toFloor = Math.min(overflow, Math.max(0, FLOOR_LIMIT - board.floor.length));
    for (let i = 0; i < toFloor; i += 1) board.floor.push(move.color);
    for (let i = 0; i < overflow - toFloor; i += 1) next.discard[move.color] += 1;
    if (steps) steps.push({
      kind: 'place',
      player,
      row: move.row,
      color: move.color,
      kept: pattern.count,
      overflow,
      after: cloneState(next),
    });
  } else {
    const toFloor = Math.min(count, Math.max(0, FLOOR_LIMIT - board.floor.length));
    for (let i = 0; i < toFloor; i += 1) board.floor.push(move.color);
    for (let i = 0; i < count - toFloor; i += 1) next.discard[move.color] += 1;
    if (steps) steps.push({ kind: 'discard', player, color: move.color, count, after: cloneState(next) });
  }

  // 4. 轮转到下一位玩家
  next.current = (player + 1) % next.players.length;

  // 5. 供应全空（工厂盘与中央均无砖）时立即结算本轮
  const supplyEmpty =
    next.factories.every((plate) => plate.every((value) => value === 0)) &&
    next.center.every((value) => value === 0);
  if (supplyEmpty) {
    // 轮末可能修改所有玩家的分数、图案行与墙，此时才取得完整玩家板副本。
    next.players = next.players.map(clonePlayerBoard);
    return finishRound(next, steps);
  }
  return next;
}

/**
 * 应用一次拿砖放行动作，并记录逐步呈现快照；供应全空时结算本轮。
 * @param state 行动前的局面
 * @param move 选定的合法行动
 * @returns 结算后的新状态与逐步呈现步骤
 */
export function applyMove(state: GameState, move: Move): MoveResult {
  const steps: MoveStep[] = [];
  return { state: applyMoveCore(state, move, steps), steps };
}

/**
 * 应用合法行动并结算当前轮，省去动画快照；本函数不补下一轮供应。
 * @param state 行动前的局面
 * @param move 选定的合法行动
 * @returns 不修改输入的下一局面，可能处于 roundEnd 或 gameEnd
 */
export function applyMoveState(state: GameState, move: Move): GameState {
  return applyMoveCore(state, move);
}

/**
 * 开启下一轮：弃堆回袋并补盘，由上一轮首标记决定先手，再把标记放回中央。
 * 若补盘后供应仍为空（流通砖全部被玩家板固化吸收），按当前分数直接终局，
 * 否则供应为空的 placing 局面会让搜索与对局陷入死循环。
 *
 * @param state 轮末已结算、处于 roundEnd 阶段的局面
 * @param rng 随机源；缺省时使用确定性补砖（测试与预览使用）
 * @returns 新一轮的初始局面（可能直接进入终局）
 */
export function startNextRound(state: GameState, rng?: () => number): GameState {
  if (state.phase !== 'roundEnd') return state;
  // 开轮只改供应与回合信息，玩家板保持只读共享。
  const next: GameState = {
    ...state,
    bag: state.bag.map((value, color) => value + state.discard[color]),
    discard: new Array<number>(TILE_COLORS).fill(0),
    round: state.round + 1,
    current: state.firstPlayer ?? 0,
    firstPlayer: null,
    centerMarker: true,
    phase: 'placing',
  };
  const refilled = refillFactories(next, rng);
  const supplyEmpty =
    refilled.factories.every((plate) => plate.every((value) => value === 0)) &&
    refilled.center.every((value) => value === 0);
  if (supplyEmpty) {
    refilled.phase = 'gameEnd';
    refilled.winner = winnerOf(refilled.players, refilled.seats);
  }
  return refilled;
}

/**
 * 应用行动并自动完成轮末流转，返回「下一个玩家待行动」的局面。
 * 批量模拟通过随机源补盘；AI 树搜索使用 applyMoveState，停在未知补盘边界。
 *
 * @param state 当前待行动局面
 * @param move 选定的行动
 * @param rng 随机源；缺省时轮末补砖为确定性模式
 * @returns 自动开轮后的下一局面，全程不生成动画快照
 */
export function advanceState(state: GameState, move: Move, rng?: () => number): GameState {
  const next = applyMoveState(state, move);
  return next.phase === 'roundEnd' ? startNextRound(next, rng) : next;
}

/** 某玩家墙上已放置的砖块数量 */
export function wallFilledCount(board: PlayerBoard): number {
  let count = 0;
  for (const line of board.wall) {
    for (const filled of line) if (filled) count += 1;
  }
  return count;
}

/** 某玩家的总体推进度（0-1），按墙上砖块数衡量 */
export function progressOf(board: PlayerBoard): number {
  return wallFilledCount(board) / (WALL_SIZE * WALL_SIZE);
}
