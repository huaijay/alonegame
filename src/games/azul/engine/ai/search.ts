import { applyMoveState, getLegalMoves, startNextRound } from '../rules';
import { FACTORY_TILES, TILE_COLORS, WALL_SIZE } from '../types';
import type { GameState, Move, PlayerBoard } from '../types';
import { createEvaluator, WIN_VALUE } from './evaluate';
import type { EvaluationBreakdown } from './evaluate';

export interface SearchOptions {
  /** 最多继续搜索的玩家行动数；遇到未知的下轮补砖时停止展开 */
  depth: number;
  /** 时间预算；零预算仍计算所有根候选的静态估值 */
  budgetMs: number;
  /** 搜索访问节点硬上限，含缓存命中，不含根候选静态估值 */
  nodeBudget: number;
}

export interface Candidate {
  move: Move;
  /** 所有根候选来自同一完整迭代 */
  value: number;
  breakdown: EvaluationBreakdown;
  /** 可确定返回同一局面的行动；存在正常替代时按无进展策略排除。 */
  repeatsPosition?: true;
}

export interface Decision {
  move: Move;
  value: number;
  candidates: Candidate[];
  nodes: number;
  ms: number;
  /** 全部候选已完成的搜索深度；轮末和终局允许提前成为叶子 */
  depth: number;
  requestedDepth: number;
  interrupted: boolean;
  cacheHits: number;
}

interface SearchContext {
  nodes: number;
  nodeBudget: number;
  deadline: number;
  evaluator: ReturnType<typeof createEvaluator>;
  tables: Map<string, number[]>[];
  cacheEntries: number;
  cacheHits: number;
  /** 规则采用不可变转移，未变化的板与工厂可以直接复用签名。 */
  boardKeys: WeakMap<PlayerBoard, string>;
  factoryKeys: WeakMap<number[], string>;
}

const SEARCH_ABORTED = Symbol('search-aborted');
// 同分不受浮点求和末位影响；有限缓存避免深搜时无上限占用内存。
const SCORE_EPSILON = 1e-9;
const MAX_CACHE_ENTRIES = 32_768;
// 这是排除原地拖延的策略值，不代表正式规则中的败局分数。
const REPEATED_POSITION_VALUE = -WIN_VALUE - 1;

function factoryKey(plate: number[], ctx: SearchContext): string {
  let key = ctx.factoryKeys.get(plate);
  if (key === undefined) {
    key = String.fromCharCode(...plate);
    ctx.factoryKeys.set(plate, key);
  }
  return key;
}

function boardKey(board: PlayerBoard, ctx: SearchContext): string {
  const cached = ctx.boardKeys.get(board);
  if (cached !== undefined) return cached;
  let wall = 0;
  let key = String.fromCharCode(board.score, Number(board.hasFirstMarker));
  for (let row = 0; row < WALL_SIZE; row += 1) {
    const pattern = board.rows[row];
    key += String.fromCharCode(pattern.color === null ? 0 : pattern.color + 1, pattern.count);
    for (let col = 0; col < WALL_SIZE; col += 1) {
      if (board.wall[row][col]) wall |= 1 << (row * WALL_SIZE + col);
    }
  }
  key += String.fromCharCode(wall & 0xffff, wall >>> 16);
  const floor = new Array<number>(TILE_COLORS).fill(0);
  for (const color of board.floor) floor[color] += 1;
  key += String.fromCharCode(...floor);
  ctx.boardKeys.set(board, key);
  return key;
}

function positionKey(state: GameState, ctx: SearchContext, round = state.round): string {
  // 单次决策的 seats 和 factoryCount 固定。工厂编号只影响展示，不影响后续规则。
  let key = String.fromCharCode(
    state.current,
    state.firstPlayer === null ? 0 : state.firstPlayer + 1,
    Number(state.centerMarker),
    round,
    ...state.center,
    ...state.bag,
    ...state.discard,
  );
  key += state.factories.map((plate) => factoryKey(plate, ctx)).sort().join('');
  for (const board of state.players) key += boardKey(board, ctx);
  return key;
}

/** 内部按工厂内容排序，并合并相同工厂；根层仍保留所有真实 source。 */
function searchMoves(state: GameState, ctx: SearchContext): Move[] {
  const signatures = state.factories.map((plate) => factoryKey(plate, ctx));
  const seen = new Set<string>();
  let sources = 0;
  for (let source = 0; source < signatures.length; source += 1) {
    if (seen.has(signatures[source])) continue;
    seen.add(signatures[source]);
    sources |= 1 << source;
  }
  const moves = getLegalMoves(state).filter((move) =>
    move.source === state.factoryCount || (sources & (1 << move.source)) !== 0);
  moves.sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === state.factoryCount) return 1;
      if (b.source === state.factoryCount) return -1;
      const left = signatures[a.source];
      const right = signatures[b.source];
      if (left !== right) return left < right ? -1 : 1;
    }
    return a.color - b.color || (a.row < 0 ? WALL_SIZE : a.row) - (b.row < 0 ? WALL_SIZE : b.row);
  });
  return moves;
}

/** 本轮按正式规则结算，只有流通砖耗尽时才跨过边界确认终局。 */
function afterMove(state: GameState, move: Move): GameState {
  const after = applyMoveState(state, move);
  if (
    after.phase === 'roundEnd' &&
    after.bag.every((count) => count === 0) &&
    after.discard.every((count) => count === 0)
  ) {
    return startNextRound(after);
  }
  return after;
}

/** 只在补盘及以后供应不含随机信息时，识别整轮回到原位的弃砖行动。 */
function repeatsPosition(state: GameState, move: Move, after: GameState, ctx: SearchContext): boolean {
  if (move.row !== -1 || after.phase !== 'roundEnd') return false;
  let total = 0;
  let colors = 0;
  for (let color = 0; color < TILE_COLORS; color += 1) {
    const count = after.bag[color] + after.discard[color];
    total += count;
    if (count > 0) colors += 1;
  }
  // refillFactories 按颜色计数分组再切盘；整池抽尽或单色时随机源无法改变供应。
  if (total > after.factoryCount * FACTORY_TILES && colors > 1) return false;
  const next = startNextRound(after);
  // round 只用于显示，不改变规则或估值；其余状态必须完整相同。
  return next.phase === 'placing' && positionKey(state, ctx, 0) === positionKey(next, ctx, 0);
}

/** Max-n：当前玩家选择自己的最优分量，未知补砖以轮末估值接续。 */
function search(state: GameState, depth: number, ctx: SearchContext): number[] {
  if (ctx.nodes >= ctx.nodeBudget || performance.now() >= ctx.deadline) throw SEARCH_ABORTED;
  ctx.nodes += 1;
  if (depth === 0 || state.phase !== 'placing') return ctx.evaluator.evaluateAll(state);

  const table = ctx.tables[depth] ??= new Map<string, number[]>();
  const key = positionKey(state, ctx);
  const cached = table.get(key);
  if (cached !== undefined) {
    ctx.cacheHits += 1;
    return cached;
  }

  const player = state.current;
  let best: number[] | undefined;
  for (const move of searchMoves(state, ctx)) {
    const after = afterMove(state, move);
    // 相同信息下把同一选择无限推迟，不会增加任何可达的获胜路径。
    if (repeatsPosition(state, move, after, ctx)) continue;
    const child = search(after, depth - 1, ctx);
    if (best === undefined || child[player] > best[player] + SCORE_EPSILON) best = child;
  }

  // 如果所有行动都只会原地循环，保留静态估值，不虚构规则中的终局。
  const values = best ?? ctx.evaluator.evaluateAll(state);
  if (ctx.cacheEntries < MAX_CACHE_ENTRIES) {
    table.set(key, values);
    ctx.cacheEntries += 1;
  }
  return values;
}

function validateOptions(options: SearchOptions): void {
  if (!Number.isSafeInteger(options.depth) || options.depth < 0) {
    throw new RangeError('depth 必须是非负安全整数');
  }
  if (!Number.isFinite(options.budgetMs) || options.budgetMs < 0) {
    throw new RangeError('budgetMs 必须是非负有限数');
  }
  if (!Number.isSafeInteger(options.nodeBudget) || options.nodeBudget < 0) {
    throw new RangeError('nodeBudget 必须是非负安全整数');
  }
}

/**
 * 在当前可见供应下选择行动；完整迭代提交，预算中断时保留上一完整层。
 *
 * @param state 当前待行动局面
 * @param options 后续行动深度、时间及节点预算
 * @returns 包含全部合法根候选的决策；非 placing 阶段或无合法行动时返回 null
 */
export function chooseMove(state: GameState, options: SearchOptions): Decision | null {
  validateOptions(options);
  if (state.phase !== 'placing') return null;
  const startedAt = performance.now();
  const moves = getLegalMoves(state);
  if (moves.length === 0) return null;

  const root = state.current;
  const evaluator = createEvaluator();
  const afterStates = moves.map((move) => afterMove(state, move));
  const ctx: SearchContext = {
    nodes: 0,
    nodeBudget: options.nodeBudget,
    deadline: startedAt + options.budgetMs,
    evaluator,
    tables: [],
    cacheEntries: 0,
    cacheHits: 0,
    boardKeys: new WeakMap(),
    factoryKeys: new WeakMap(),
  };
  const repeated = moves.map((move, index) => repeatsPosition(state, move, afterStates[index], ctx));
  const hasProgress = repeated.some((value) => !value);
  const candidates: Candidate[] = moves.map((move, index) => {
    const breakdown = evaluator.breakdownOf(afterStates[index], root);
    return {
      move,
      value: hasProgress && repeated[index] ? REPEATED_POSITION_VALUE : breakdown.total,
      breakdown,
      ...(repeated[index] ? { repeatsPosition: true as const } : {}),
    };
  });

  let completedDepth = 0;
  let interrupted = false;
  for (let depth = 1; depth <= options.depth; depth += 1) {
    const iteration: number[] = [];
    try {
      for (let index = 0; index < afterStates.length; index += 1) {
        iteration.push(hasProgress && repeated[index]
          ? REPEATED_POSITION_VALUE
          : search(afterStates[index], depth, ctx)[root]);
      }
    } catch (error) {
      if (error !== SEARCH_ABORTED) throw error;
      interrupted = true;
      break;
    }
    for (let index = 0; index < candidates.length; index += 1) candidates[index].value = iteration[index];
    completedDepth = depth;
  }

  // 稳定排序保留根层 source/color/row 枚举顺序，展示始终使用实际工厂编号。
  candidates.sort((a, b) => {
    const difference = b.value - a.value;
    return Math.abs(difference) <= SCORE_EPSILON ? 0 : difference;
  });
  return {
    move: candidates[0].move,
    value: candidates[0].value,
    candidates,
    nodes: ctx.nodes,
    ms: performance.now() - startedAt,
    depth: completedDepth,
    requestedDepth: options.depth,
    interrupted,
    cacheHits: ctx.cacheHits,
  };
}
