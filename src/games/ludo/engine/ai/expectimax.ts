import { toTrackIndex } from '../board';
import { applyMove, getLegalMoves, landingPosition } from '../rules';
import { FINISH, PLANES_PER_PLAYER, TRACK_LAST } from '../types';
import type { GameState, Move } from '../types';
import { createEvaluator } from './evaluate';
import type { EvaluationBreakdown } from './evaluate';

export interface SearchOptions {
  /** 最多继续搜索多少次掷骰；实际完成深度见 Decision.depth */
  depth: number;
  /** 搜索时间预算；零预算仍返回所有候选的静态估值 */
  budgetMs: number;
  /** 后续搜索节点的硬上限，含叶子和缓存命中，不含根候选静态估值 */
  nodeBudget: number;
}

export interface Candidate {
  move: Move;
  /** 所有候选均来自同一完整搜索深度 */
  value: number;
  /** 立即结算后的分项评分，用于解释面板 */
  breakdown: EvaluationBreakdown;
}

export interface Decision {
  move: Move;
  value: number;
  candidates: Candidate[];
  nodes: number;
  ms: number;
  /** 所有根候选完整完成的掷骰深度；0 表示静态估值 */
  depth: number;
  requestedDepth: number;
  interrupted: boolean;
  cacheHits: number;
}

interface UndoFrame {
  player: number;
  plane: number;
  from: number;
  sixStreak: number;
  finishedCount: number;
  captureCount: number;
  /** 每次捕获保存玩家/飞机编码及原位置 */
  captures: Int16Array;
}

interface SearchContext {
  nodes: number;
  nodeBudget: number;
  deadline: number;
  cacheHits: number;
  cacheEntries: number;
  tables: Map<string, number[]>[];
  frames: UndoFrame[];
  evaluator: ReturnType<typeof createEvaluator>;
}

const SEARCH_ABORTED = Symbol('search-aborted');
// 同一局面换飞机编号后，浮点求和顺序可能产生末位误差。
const SCORE_EPSILON = 1e-9;
const MAX_CACHE_ENTRIES = 32_768;
const POSITION_COUNT = FINISH + 2;

// 规则查表只在模块加载时建立，递归里不再生成动画路线或重复计算跳飞。
const DESTINATIONS = Array.from({ length: 4 }, (_, seat) => {
  const table = new Int16Array(POSITION_COUNT * 6);
  for (let pos = -1; pos <= FINISH; pos += 1) {
    for (let dice = 1; dice <= 6; dice += 1) {
      table[(pos + 1) * 6 + dice - 1] = landingPosition(seat as 0 | 1 | 2 | 3, pos, dice);
    }
  }
  return table;
});

/** 飞机编号不影响未来规则；固定排序也让叠子与换编号的局面共享缓存。 */
function positionKey(state: GameState): string {
  let key = String.fromCharCode(state.current * 3 + state.sixStreak);
  for (const row of state.planes) {
    let a = row[0];
    let b = row[1];
    let c = row[2];
    let d = row[3];
    let swap: number;
    if (a > b) { swap = a; a = b; b = swap; }
    if (c > d) { swap = c; c = d; d = swap; }
    if (a > c) { swap = a; a = c; c = swap; }
    if (b > d) { swap = b; b = d; d = swap; }
    if (b > c) { swap = b; b = c; c = swap; }
    key += String.fromCharCode(a + 1, b + 1, c + 1, d + 1);
  }
  return key;
}

function frameAt(ctx: SearchContext, ply: number): UndoFrame {
  return ctx.frames[ply] ??= {
    player: 0,
    plane: 0,
    from: 0,
    sixStreak: 0,
    finishedCount: 0,
    captureCount: 0,
    captures: new Int16Array(2 * PLANES_PER_PLAYER * 3),
  };
}

/** 只改搜索持有的副本；每次调用必须与 finally 中的 undoMove 配对。 */
function makeMove(state: GameState, plane: number, target: number, dice: number, undo: UndoFrame): void {
  const player = state.current;
  const row = state.planes[player];
  undo.player = player;
  undo.plane = plane;
  undo.from = row[plane];
  undo.sixStreak = state.sixStreak;
  undo.finishedCount = state.finishedOrder.length;
  undo.captureCount = 0;
  row[plane] = target;

  if (target <= TRACK_LAST) {
    const absolute = toTrackIndex(state.seats[player], target);
    for (let rival = 0; rival < state.planes.length; rival += 1) {
      if (rival === player) continue;
      const rivals = state.planes[rival];
      for (let index = 0; index < rivals.length; index += 1) {
        const pos = rivals[index];
        if (pos >= 0 && pos <= TRACK_LAST && toTrackIndex(state.seats[rival], pos) === absolute) {
          undo.captures[undo.captureCount++] = rival * PLANES_PER_PLAYER + index;
          undo.captures[undo.captureCount++] = pos;
          rivals[index] = -1;
        }
      }
    }
  }

  if (target === FINISH && row.every((pos) => pos === FINISH)) {
    state.winner = state.seats[player];
    state.finishedOrder.push(state.winner);
    state.sixStreak = 0;
  } else if (dice === 6 && state.sixStreak < 2) {
    state.sixStreak += 1;
  } else {
    state.current = (player + 1) % state.planes.length;
    state.sixStreak = 0;
  }
  state.rolls += 1;
}

function undoMove(state: GameState, undo: UndoFrame): void {
  state.planes[undo.player][undo.plane] = undo.from;
  for (let index = 0; index < undo.captureCount; index += 2) {
    const encoded = undo.captures[index];
    state.planes[Math.floor(encoded / PLANES_PER_PLAYER)][encoded % PLANES_PER_PLAYER] =
      undo.captures[index + 1];
  }
  state.current = undo.player;
  state.sixStreak = undo.sixStreak;
  state.finishedOrder.length = undo.finishedCount;
  // 终局节点不会展开，因此行动前 winner 一定为 null。
  state.winner = null;
  state.rolls -= 1;
}

/**
 * 骰子节点取六面均值；行动节点由当前玩家最大化自己的分量（Max-n）。
 * 缓存只保存完整结果，预算中断直接回退至上一完整迭代。
 */
function search(state: GameState, depth: number, ctx: SearchContext, ply: number): number[] {
  if (ctx.nodes >= ctx.nodeBudget || performance.now() >= ctx.deadline) throw SEARCH_ABORTED;
  ctx.nodes += 1;
  // 叶子估值只需一次查表扫描；缓存内部节点才足以抵消键构造的成本。
  if (state.winner !== null || depth === 0) return ctx.evaluator.evaluateAll(state);

  // 同一次决策中 seats 不变；rolls 和 finishedOrder 不影响后续合法行动。
  const table = ctx.tables[depth] ??= new Map<string, number[]>();
  const key = positionKey(state);
  const cached = table.get(key);
  if (cached !== undefined) {
    ctx.cacheHits += 1;
    return cached;
  }

  const player = state.current;
  const row = state.planes[player];
  const destinations = DESTINATIONS[state.seats[player]];
  const values = new Array<number>(state.seats.length).fill(0);
  let passValues: number[] | undefined;

  for (let dice = 1; dice <= 6; dice += 1) {
    let best: number[] | undefined;
    let previousPosition = -2;

    // 按位置处理同分走法，与飞机编号无关；相同位置只扩展一次。
    for (;;) {
      let plane = -1;
      let position = FINISH;
      let target = -2;
      for (let index = 0; index < row.length; index += 1) {
        const pos = row[index];
        if (pos <= previousPosition || pos >= position) continue;
        const destination = destinations[(pos + 1) * 6 + dice - 1];
        if (destination < 0) continue;
        plane = index;
        position = pos;
        target = destination;
      }
      if (plane < 0) break;
      previousPosition = position;

      const undo = frameAt(ctx, ply);
      makeMove(state, plane, target, dice, undo);
      let child: number[];
      try {
        child = search(state, depth - 1, ctx, ply + 1);
      } finally {
        undoMove(state, undo);
      }
      if (best === undefined || child[player] > best[player] + SCORE_EPSILON) best = child;
    }

    if (best === undefined) {
      // 所有无法行动的骰面都交给下一位，含无法行动的六点。
      if (passValues === undefined) {
        const sixStreak = state.sixStreak;
        state.current = (player + 1) % state.planes.length;
        state.sixStreak = 0;
        state.rolls += 1;
        try {
          passValues = search(state, depth - 1, ctx, ply + 1);
        } finally {
          state.current = player;
          state.sixStreak = sixStreak;
          state.rolls -= 1;
        }
      }
      best = passValues;
    }

    for (let index = 0; index < values.length; index += 1) values[index] += best[index];
  }
  for (let index = 0; index < values.length; index += 1) values[index] /= 6;

  if (ctx.cacheEntries < MAX_CACHE_ENTRIES) {
    table.set(key, values);
    ctx.cacheEntries += 1;
  }
  return values;
}

function validateOptions(dice: number, options: SearchOptions): void {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new RangeError('dice 必须是 1 到 6 的整数');
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

export function chooseMove(state: GameState, dice: number, options: SearchOptions): Decision | null {
  validateOptions(dice, options);
  if (state.winner !== null) return null;
  const startedAt = performance.now();
  const moves = getLegalMoves(state, dice);
  if (moves.length === 0) return null;

  const root = state.current;
  const evaluator = createEvaluator();
  const afterStates = moves.map((move) => applyMove(state, move, dice).state);
  const candidates: Candidate[] = moves.map((move, index) => {
    const breakdown = evaluator.breakdownOf(afterStates[index], root);
    return { move, value: breakdown.total, breakdown };
  });
  const ctx: SearchContext = {
    nodes: 0,
    nodeBudget: options.nodeBudget,
    deadline: startedAt + options.budgetMs,
    cacheHits: 0,
    cacheEntries: 0,
    tables: [],
    frames: [],
    evaluator,
  };

  let completedDepth = 0;
  let interrupted = false;
  for (let depth = 1; depth <= options.depth; depth += 1) {
    const iteration: number[] = [];
    try {
      for (const after of afterStates) iteration.push(search(after, depth, ctx, 0)[root]);
    } catch (error) {
      if (error !== SEARCH_ABORTED) throw error;
      interrupted = true;
      break;
    }
    for (let index = 0; index < candidates.length; index += 1) candidates[index].value = iteration[index];
    completedDepth = depth;
  }

  candidates.sort((a, b) => {
    const difference = b.value - a.value;
    return Math.abs(difference) > SCORE_EPSILON ? difference : a.move.plane - b.move.plane;
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
