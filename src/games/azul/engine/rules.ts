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

/** 深拷贝对局状态：所有规则转移与 AI 搜索的副本都基于它 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    seats: [...state.seats],
    factories: state.factories.map((plate) => [...plate]),
    center: [...state.center],
    players: state.players.map((board) => ({
      score: board.score,
      rows: board.rows.map((row) => ({ ...row })),
      wall: board.wall.map((line) => [...line]),
      floor: [...board.floor],
      hasFirstMarker: board.hasFirstMarker,
    })),
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
 * @param rng 随机源；缺省时按色号轮转均匀抽取（AI 搜索与测试使用确定性模式）
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
 */
export function createInitialState(seats: Seat[], rng?: () => number): GameState {
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
  for (let col = 0; col < WALL_SIZE; col += 1) {
    if (wallColorOf(row, col) === color && board.wall[row][col]) return false;
  }
  return true;
}

/**
 * 计算当前玩家的全部合法行动
 *
 * @param state 当前对局状态（须处于 placing 阶段）
 * @returns 合法行动列表；弃入地板的兜底行动始终存在
 */
export function getLegalMoves(state: GameState): Move[] {
  const board = state.players[state.current];
  const moves: Move[] = [];
  for (let source = 0; source <= state.factoryCount; source += 1) {
    const supply = source < state.factoryCount ? state.factories[source] : state.center;
    for (const color of nonEmptyColors(supply)) {
      for (let row = 0; row < WALL_SIZE; row += 1) {
        if (canPlaceRow(board, row, color)) moves.push({ source, color, row });
      }
      moves.push({ source, color, row: -1 });
    }
  }
  return moves;
}

/** 墙格得分：横向连续数 + 纵向连续数 +（两向均成串时 +1） */
function scoreForCell(wall: boolean[][], row: number, col: number): number {
  let horizontal = 1;
  for (let c = col - 1; c >= 0 && wall[row][c]; c -= 1) horizontal += 1;
  for (let c = col + 1; c < WALL_SIZE && wall[row][c]; c += 1) horizontal += 1;
  let vertical = 1;
  for (let r = row - 1; r >= 0 && wall[r][col]; r -= 1) vertical += 1;
  for (let r = row + 1; r < WALL_SIZE && wall[r][col]; r += 1) vertical += 1;
  return horizontal + vertical + (horizontal > 1 && vertical > 1 ? 1 : 0);
}

/** 终局加分明细：满行 +6 / 满列 +2 / 每种颜色集齐 +10 */
function endgameBonus(board: PlayerBoard): { rows: number; cols: number; colors: number; total: number } {
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
 * @param steps 行动阶段的呈现步骤，轮末步骤会追加其上
 * @returns 轮末结算后的局面与全部步骤
 */
function finishRound(state: GameState, steps: MoveStep[]): MoveResult {
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
        steps.push({ kind: 'penalty', player, penalty, after: cloneState(next) });
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
      steps.push({ kind: 'wall', player, row, col, color, gained, after: cloneState(next) });
    }
  }

  // 终局检测：任一玩家墙上有完整行即进入终局加分
  const gameEnd = next.players.some((board) => board.wall.some((line) => line.every(Boolean)));
  if (gameEnd) {
    for (let player = 0; player < next.players.length; player += 1) {
      const bonus = endgameBonus(next.players[player]);
      next.players[player].score += bonus.total;
      steps.push({
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
  return { state: next, steps };
}

/**
 * 应用一次拿砖放行动作：整色拿砖 → 余砖进中央 / 拿首标记 → 放行或弃置 →
 * 轮转到下一位；供应全空时自动完成轮末结算。
 *
 * @param state 行动前的对局状态
 * @param move 选定的行动
 * @returns 结算后的新状态与逐步呈现步骤
 */
export function applyMove(state: GameState, move: Move): MoveResult {
  const next = cloneState(state);
  const player = next.current;
  const board = next.players[player];
  const steps: MoveStep[] = [];
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
  steps.push({ kind: 'pick', player, source: move.source, color: move.color, count, toCenter, after: cloneState(next) });

  // 2. 从中央拿砖时顺手拿下首玩家标记：该玩家将成为下轮先手
  if (isCenter && next.centerMarker) {
    next.centerMarker = false;
    board.hasFirstMarker = true;
    next.firstPlayer = player;
    steps.push({ kind: 'marker', player, after: cloneState(next) });
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
    steps.push({
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
    steps.push({ kind: 'discard', player, color: move.color, count, after: cloneState(next) });
  }

  // 4. 轮转到下一位玩家
  next.current = (player + 1) % next.players.length;

  // 5. 供应全空（工厂盘与中央均无砖）时立即结算本轮
  const supplyEmpty =
    next.factories.every((plate) => plate.every((value) => value === 0)) &&
    next.center.every((value) => value === 0);
  if (supplyEmpty) return finishRound(next, steps);
  return { state: next, steps };
}

/**
 * 开启下一轮：弃堆倒回袋中，为空盘补砖，由首玩家标记决定先手。
 * 若补盘后供应仍为空（流通砖全部被玩家板固化吸收），按当前分数直接终局，
 * 否则供应为空的 placing 局面会让搜索与对局陷入死循环。
 *
 * @param state 轮末已结算、处于 roundEnd 阶段的局面
 * @param rng 随机源；缺省时使用确定性补砖（AI 搜索使用）
 * @returns 新一轮的初始局面（可能直接进入终局）
 */
export function startNextRound(state: GameState, rng?: () => number): GameState {
  if (state.phase !== 'roundEnd') return state;
  const next = cloneState(state);
  // 弃堆全部倒回袋中：袋与弃堆总数守恒，保证砖不凭空消失
  next.bag = next.bag.map((value, color) => value + next.discard[color]);
  next.discard = new Array<number>(TILE_COLORS).fill(0);
  next.round += 1;
  next.current = next.firstPlayer ?? 0;
  next.firstPlayer = null;
  next.phase = 'placing';
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
 * AI 搜索与批量模拟共用该口径，保证与真实对局的轮转完全一致。
 *
 * @param state 当前待行动局面
 * @param move 选定的行动
 * @param rng 随机源；缺省时轮末补砖为确定性模式
 */
export function advanceState(state: GameState, move: Move, rng?: () => number): GameState {
  const result = applyMove(state, move);
  return result.state.phase === 'roundEnd' ? startNextRound(result.state, rng) : result.state;
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
