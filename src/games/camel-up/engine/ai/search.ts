import { applyMoveState, getLegalMoves, rollOutcomes } from '../rules';
import type { GameState, Move, PlayerState, RollOutcome } from '../types';
import { breakdownsOf, evaluateAll } from './evaluate';
import type { EvaluationBreakdown } from './evaluate';

export interface SearchOptions {
  /** 最多继续搜索的玩家行动数 */
  depth: number;
  /** 时间预算；零预算仍计算所有根候选的静态估值 */
  budgetMs: number;
  /** 搜索访问节点硬上限，含缓存命中 */
  nodeBudget: number;
}

export interface Candidate {
  move: Move;
  /** 所有根候选来自同一完整迭代 */
  value: number;
  breakdown: EvaluationBreakdown;
}

export interface Decision {
  move: Move;
  value: number;
  candidates: Candidate[];
  nodes: number;
  ms: number;
  /** 全部候选已完成的搜索深度；终局允许提前成为叶子 */
  depth: number;
  requestedDepth: number;
  interrupted: boolean;
  cacheHits: number;
}

interface SearchContext {
  nodes: number;
  nodeBudget: number;
  deadline: number;
  tables: Map<string, number[]>[];
  /** 按剩余骰色组合缓存的掷骰机会节点分支，避免同一局面反复分配 15 个结果对象 */
  rollCache: Map<string, readonly { outcome: RollOutcome; prob: number }[]>;
  cacheEntries: number;
  cacheHits: number;
  ticks: number;
}

const SEARCH_ABORTED = Symbol('search-aborted');
// 同分不受浮点求和末位影响；有限缓存避免深搜时无上限占用内存。
const SCORE_EPSILON = 1e-9;
const MAX_CACHE_ENTRIES = 32_768;
// why：performance.now() 每次调用都有系统调用开销，按 32 节点抽样检查时间，
// 仍能把超预算幅度控制在一次小批量展开之内。
const TIME_CHECK_MASK = 31;

/**
 * 局面缓存键：覆盖一切影响规则与估值的字段（leg 与骰面仅展示，不入键）。
 * 每段变长数据都显式带上长度前缀，避免不同分配拼出同一字符串造成缓存串味。
 *
 * @param state 待编码局面
 * @returns 可直接作为置换表键的字符串
 */
export function positionKey(state: GameState): string {
  let key = String.fromCharCode(
    state.current,
    state.phase === 'gameEnd' ? 1 : 0,
    state.winner === null ? 0 : state.winner + 1,
  );
  for (const player of state.players) key += playerKey(player);
  for (const stack of state.stacks) {
    key += String.fromCharCode(48 + stack.length, ...stack);
  }
  // 腿注堆内容虽是 [5,3,2] 的前缀，但只有长度无法区分「哪个颜色被拿过」
  for (const stack of state.legStacks) {
    key += String.fromCharCode(48 + stack.length, ...stack);
  }
  key += String.fromCharCode(48 + state.diceRemaining.length, ...state.diceRemaining);
  key += String.fromCharCode(state.pyramidRemaining);
  for (const bet of state.winnerPile) key += String.fromCharCode(bet.player, bet.color);
  key += '|';
  for (const bet of state.loserPile) key += String.fromCharCode(bet.player, bet.color);
  return key;
}

function playerKey(player: PlayerState): string {
  // 票面只有 5/3/2，压成 char 可直接拼接；变长字段带长度标记，避免跨玩家拼接产生歧义
  return String.fromCharCode(
    player.coins,
    player.pyramidTickets,
    player.desert.pos === null ? 0 : player.desert.pos + 1,
    player.desert.face === 'oasis' ? 1 : 2,
    player.hand.length,
    ...player.hand,
    player.legTickets.length,
    ...player.legTickets.map((ticket) => ticket.color * 8 + ticket.value),
  );
}

/**
 * 统一的预算检查：节点上限逐节点判断，时间按批抽样，超限即中止本次迭代。
 * @param ctx 当前搜索上下文
 */
function checkBudget(ctx: SearchContext): void {
  if (ctx.nodes >= ctx.nodeBudget) throw SEARCH_ABORTED;
  if ((ctx.ticks++ & TIME_CHECK_MASK) === 0 && performance.now() >= ctx.deadline) {
    throw SEARCH_ABORTED;
  }
}

/**
 * 取当前剩余骰色的掷骰机会分支；同一骰色组合在整次搜索内复用。
 * @param ctx 当前搜索上下文
 * @param state 当前局面
 * @returns 结果与概率列表（只读，禁止修改）
 */
function rollOutcomesOf(
  ctx: SearchContext,
  state: GameState,
): readonly { outcome: RollOutcome; prob: number }[] {
  const key = state.diceRemaining.join(',');
  const cached = ctx.rollCache.get(key);
  if (cached !== undefined) return cached;
  const list = rollOutcomes(state);
  ctx.rollCache.set(key, list);
  return list;
}

/** 一步行动后的期望收益向量：掷骰行动按机会节点展开全部骰色×点数 */
function moveValue(state: GameState, move: Move, rest: number, ctx: SearchContext): number[] {
  if (move.kind !== 'roll') {
    return search(applyMoveState(state, move), rest, ctx);
  }

  const outcomes = rollOutcomesOf(ctx, state);
  const total = new Array<number>(state.players.length).fill(0);
  for (const { outcome, prob } of outcomes) {
    const child = search(applyMoveState(state, move, outcome), rest, ctx);
    for (let i = 0; i < total.length; i += 1) total[i] += prob * child[i];
  }
  return total;
}

/** 期望值搜索：当前玩家在自己的回合最大化自己的收益分量 */
function search(state: GameState, depth: number, ctx: SearchContext): number[] {
  checkBudget(ctx);
  ctx.nodes += 1;
  if (depth === 0 || state.phase !== 'racing') return evaluateAll(state);

  const table = ctx.tables[depth] ??= new Map<string, number[]>();
  const key = positionKey(state);
  const cached = table.get(key);
  if (cached !== undefined) {
    ctx.cacheHits += 1;
    return cached;
  }

  const player = state.current;
  let best: number[] | undefined;
  for (const move of getLegalMoves(state)) {
    const child = moveValue(state, move, depth - 1, ctx);
    if (best === undefined || child[player] > best[player] + SCORE_EPSILON) best = child;
  }

  const values = best ?? evaluateAll(state);
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
 * 根候选的静态估值：掷骰行动按机会节点取期望，其余行动直接结算。
 * why：若掷骰只按某一颗骰子的默认结果估值，预算中断时随机行动会被系统性低估，
 * AI 就会偏向「反复搬地形块」这类确定性行动而拖延对局。
 *
 * @param state 根局面
 * @param move 根候选行动
 * @param root 行动方序号
 * @returns 带期望分项的根候选
 */
function staticCandidate(state: GameState, move: Move, root: number): Candidate {
  if (move.kind !== 'roll') {
    const breakdown = breakdownsOf(applyMoveState(state, move))[root];
    return { move, value: breakdown.total, breakdown };
  }

  const expected: EvaluationBreakdown = {
    coins: 0,
    legTickets: 0,
    pyramid: 0,
    raceBets: 0,
    hand: 0,
    desert: 0,
    total: 0,
  };
  for (const { outcome, prob } of rollOutcomes(state)) {
    const breakdown = breakdownsOf(applyMoveState(state, move, outcome))[root];
    expected.coins += prob * breakdown.coins;
    expected.legTickets += prob * breakdown.legTickets;
    expected.pyramid += prob * breakdown.pyramid;
    expected.raceBets += prob * breakdown.raceBets;
    expected.hand += prob * breakdown.hand;
    expected.desert += prob * breakdown.desert;
    expected.total += prob * breakdown.total;
  }
  return { move, value: expected.total, breakdown: expected };
}

/**
 * 在当前局面下为行动方选择动作；完整迭代提交，预算中断时保留上一完整层。
 *
 * @param state 当前待行动局面
 * @param options 后续行动深度、时间及节点预算
 * @returns 包含全部合法根候选的决策；终局或无合法行动时返回 null
 */
export function chooseMove(state: GameState, options: SearchOptions): Decision | null {
  validateOptions(options);
  if (state.phase !== 'racing') return null;
  const startedAt = performance.now();
  const moves = getLegalMoves(state);
  if (moves.length === 0) return null;

  const root = state.current;
  const ctx: SearchContext = {
    nodes: 0,
    nodeBudget: options.nodeBudget,
    deadline: startedAt + options.budgetMs,
    tables: [],
    rollCache: new Map(),
    cacheEntries: 0,
    cacheHits: 0,
    ticks: 0,
  };
  const candidates: Candidate[] = moves.map((move) => staticCandidate(state, move, root));

  let completedDepth = 0;
  let interrupted = false;
  for (let depth = 1; depth <= options.depth; depth += 1) {
    const iteration: number[] = [];
    try {
      for (const move of moves) {
        iteration.push(moveValue(state, move, depth - 1, ctx)[root]);
      }
    } catch (error) {
      if (error !== SEARCH_ABORTED) throw error;
      interrupted = true;
      break;
    }
    for (let index = 0; index < candidates.length; index += 1) candidates[index].value = iteration[index];
    completedDepth = depth;
  }

  // 稳定排序保留根层枚举顺序，同分不抖动
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
