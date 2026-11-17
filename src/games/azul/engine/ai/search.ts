import { advanceState, getLegalMoves } from '../rules';
import type { GameState, Move } from '../types';
import { createEvaluator } from './evaluate';
import type { EvaluationBreakdown } from './evaluate';

export interface SearchOptions {
  /** 最多向前搜索多少个玩家回合；实际完成深度见 Decision.depth */
  depth: number;
  /** 搜索时间预算；零预算仍返回所有候选的静态估值 */
  budgetMs: number;
  /** 搜索节点硬上限，不含根候选的静态估值 */
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
  /** 所有根候选完整完成的搜索深度；0 表示仅静态估值 */
  depth: number;
  requestedDepth: number;
  interrupted: boolean;
}

interface SearchContext {
  nodes: number;
  nodeBudget: number;
  deadline: number;
  evaluator: ReturnType<typeof createEvaluator>;
}

const SEARCH_ABORTED = Symbol('search-aborted');
const SCORE_EPSILON = 1e-9;

/**
 * Max-n 确定性搜索：每个节点是「某玩家待行动」的局面，
 * 当前玩家最大化自己的分量；轮末结算与开新轮由 advanceState 自动完成。
 */
function search(state: GameState, depth: number, ctx: SearchContext): number[] {
  if (ctx.nodes >= ctx.nodeBudget || performance.now() >= ctx.deadline) throw SEARCH_ABORTED;
  ctx.nodes += 1;
  if (state.phase === 'gameEnd') {
    return state.players.map((board) =>
      board.score === Math.max(...state.players.map((other) => other.score)) ? 1_000_000 : -1_000_000,
    );
  }
  if (depth === 0) return ctx.evaluator.evaluateAll(state);

  const player = state.current;
  let best: number[] | null = null;
  for (const move of getLegalMoves(state)) {
    const child = search(advanceState(state, move), depth - 1, ctx);
    if (best === null || child[player] > best[player] + SCORE_EPSILON) best = child;
  }
  // placing 阶段始终存在弃地板的兜底行动，循环至少赋值一次
  return best as number[];
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
 * 为当前玩家选出最优行动。
 *
 * @param state 待行动局面（须处于 placing 阶段）
 * @param options 搜索深度与预算
 * @returns 决策结果；局面不在 placing 阶段时返回 null
 */
export function chooseMove(state: GameState, options: SearchOptions): Decision | null {
  validateOptions(options);
  if (state.phase !== 'placing') return null;
  const moves = getLegalMoves(state);
  if (moves.length === 0) return null;

  const startedAt = performance.now();
  const root = state.current;
  const evaluator = createEvaluator();
  const afterStates = moves.map((move) => advanceState(state, move));
  const candidates: Candidate[] = moves.map((move, index) => {
    const breakdown = evaluator.breakdownOf(afterStates[index], root);
    return { move, value: breakdown.total, breakdown };
  });
  const ctx: SearchContext = {
    nodes: 0,
    nodeBudget: options.nodeBudget,
    deadline: startedAt + options.budgetMs,
    evaluator,
  };

  let completedDepth = 0;
  let interrupted = false;
  for (let depth = 1; depth <= options.depth; depth += 1) {
    const iteration: number[] = [];
    try {
      for (const after of afterStates) iteration.push(search(after, depth, ctx)[root]);
    } catch (error) {
      if (error !== SEARCH_ABORTED) throw error;
      interrupted = true;
      break;
    }
    for (let index = 0; index < candidates.length; index += 1) candidates[index].value = iteration[index];
    completedDepth = depth;
  }

  // 稳定排序：同分候选保持 source/color/row 的枚举顺序，保证决策可复现
  candidates.sort((a, b) => b.value - a.value);
  return {
    move: candidates[0].move,
    value: candidates[0].value,
    candidates,
    nodes: ctx.nodes,
    ms: performance.now() - startedAt,
    depth: completedDepth,
    requestedDepth: options.depth,
    interrupted,
  };
}
