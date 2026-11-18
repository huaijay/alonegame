import { GEM_NAMES } from '../board';
import { applyMoveState, bonusesOf, paymentFor } from '../rules';
import type { AiStrength, GameState, Move } from '../types';
import { bestTarget, createEvaluator } from './evaluate';
import { aiLevelFor } from './levels';
import { samplePublicStates } from './knowledge';
import { searchMoves } from './moves';

export interface SearchOptions {
  strength?: AiStrength;
  /** 根行动之后的额外步数。 */
  depth?: number;
  samples?: number;
  beamWidth?: number;
  opponentWidth?: number;
  returnChoices?: number;
  /** 搜索中新生成并评估的局面上限；根候选静态评估不计入。 */
  nodeBudget?: number;
  budgetMs?: number;
}

export interface AiCandidate {
  move: Move;
  score: number;
  reason: string;
}

export interface AiAnalysis {
  chosen: Move;
  /** 全部基础行动及选入的退筹、贵族变体；界面自行截取展示数量。 */
  candidates: AiCandidate[];
  goal: string;
  strength: AiStrength;
  nodes: number;
  ms: number;
  depth: number;
  requestedDepth: number;
  interrupted: boolean;
  totalCandidates: number;
  samples: number;
  cacheHits: number;
}

interface SearchNode {
  state: GameState;
  values: number[];
  key?: string;
  /** 只有完整排序后才保留选中的分支，下一轮迭代复用已做过的规则转移和估值。 */
  children?: SearchNode[];
}

interface SearchContext {
  root: number;
  nodes: number;
  nodeBudget: number;
  deadline: number;
  beamWidth: number;
  opponentWidth: number;
  returnChoices: number;
  evaluator: ReturnType<typeof createEvaluator>;
  tables: Map<string, number[]>[];
  cacheEntries: number;
  cacheHits: number;
}

const ABORTED = Symbol('splendor-search-aborted');
// 相同策略的浮点末位误差不应改变行动顺序；缓存仅保留有限内部节点。
const EPSILON = 1e-9;
const CACHE_LIMIT = 8_192;
// 配置入口限制递归深度；十二步已覆盖四人局的三轮，避免异常参数造成栈溢出。
const MAX_SEARCH_DEPTH = 12;

/**
 * 将动作转换成决策面板可读的中文名称。
 * @param state 行动前的局面
 * @param move 待展示的行动
 * @returns 面向玩家的动作名称
 */
export function describeMove(state: GameState, move: Move): string {
  switch (move.kind) {
    case 'take': return '拿取 ' + move.colors.map((color) => GEM_NAMES[color]).join(' · ');
    case 'double': return '双取 ' + GEM_NAMES[move.color];
    case 'reserve': return '预留 ' + move.tier + ' 阶卡 ' + (move.slot + 1);
    case 'buy': {
      const card = move.source === 'market'
        ? state.market[move.tier - 1][move.slot]
        : state.players[state.current].reserved[move.slot];
      return card ? '购买 ' + card.tier + ' 阶' + GEM_NAMES[card.bonus] + '牌 · ' + card.points + ' 分' : '购买';
    }
    case 'pass': return '跳过';
  }
}

function reasonFor(state: GameState, move: Move): string {
  if (move.kind === 'pass') return '暂无可执行动作';
  let reason: string;
  if (move.kind === 'buy') {
    const card = move.source === 'market'
      ? state.market[move.tier - 1][move.slot]!
      : state.players[state.current].reserved[move.slot];
    reason = '增加' + GEM_NAMES[card.bonus] + '永久折扣' +
      (card.points ? '，获得 ' + card.points + ' 声望' : '，降低后续投资成本');
    if (move.nobleId) reason += '，选择贵族 ' + move.nobleId;
  } else if (move.kind === 'reserve') {
    const card = move.slot === null ? null : state.market[move.tier - 1][move.slot];
    const contested = card && state.players.some((player, seat) => seat !== state.current && paymentFor(card, player));
    reason = contested ? '锁定对手可以买到的关键发展卡' : '保留后续购卡机会';
    if (state.bank.gold > 0) reason += '，领取黄金通配筹码';
  } else {
    reason = '补充目标发展卡所需宝石，并保留后续选择';
  }
  if ('returns' in move && move.returns?.length) {
    reason += '；归还 ' + move.returns.map((color) => color === 'gold' ? '黄金' : GEM_NAMES[color]).join('、');
  }
  return reason;
}

function checkBudget(ctx: SearchContext): void {
  if (ctx.nodes >= ctx.nodeBudget || performance.now() >= ctx.deadline) throw ABORTED;
}

/** 牌序是当前公开信息样本的假设，必须进入缓存键，不能在不同样本之间混用。 */
function positionKey(state: GameState): string {
  return JSON.stringify([
    state.current, state.finalRound,
    state.bank,
    state.players.map((player) => [
      player.points, player.tokens, bonusesOf(player), player.cards.length,
      player.reserved.map((card) => card.id), player.nobles.map((noble) => noble.id),
    ]),
    state.market.map((row) => row.map((card) => card?.id ?? null)),
    state.decks.map((deck) => deck.map((card) => card.id)),
    state.nobles.map((noble) => noble.id),
  ]);
}

/** 每位行动方最大化自己的收益；先评估全部后续动作，再选取有限分支继续。 */
function search(node: SearchNode, depth: number, ctx: SearchContext): number[] {
  if (node.state.phase === 'finished' || depth === 0) return node.values;
  if (performance.now() >= ctx.deadline) throw ABORTED;
  const key = node.key ??= positionKey(node.state);
  const table = ctx.tables[depth] ??= new Map<string, number[]>();
  const cached = table.get(key);
  if (cached) {
    ctx.cacheHits += 1;
    return cached;
  }

  const actor = node.state.current;
  if (node.children === undefined) {
    const children: SearchNode[] = [];
    for (const move of searchMoves(node.state, ctx.returnChoices)) {
      checkBudget(ctx);
      ctx.nodes += 1;
      const state = applyMoveState(node.state, move);
      children.push({ state, values: ctx.evaluator.evaluateAll(state) });
    }
    children.sort((a, b) => {
      const difference = b.values[actor] - a.values[actor];
      return Math.abs(difference) <= EPSILON ? 0 : difference;
    });
    const width = actor === ctx.root ? ctx.beamWidth : ctx.opponentWidth;
    node.children = children.slice(0, width);
  }
  let best: number[] | undefined;
  for (const child of node.children) {
    const values = search(child, depth - 1, ctx);
    if (best === undefined || values[actor] > best[actor] + EPSILON) best = values;
  }
  const result = best ?? node.values;
  if (ctx.cacheEntries < CACHE_LIMIT) {
    table.set(key, result);
    ctx.cacheEntries += 1;
  }
  return result;
}

function resolveOptions(state: GameState, options: SearchOptions) {
  const level = aiLevelFor(options.strength, state.players.length);
  const resolved = {
    ...level,
    depth: options.depth ?? level.depth,
    samples: options.samples ?? level.samples,
    beamWidth: options.beamWidth ?? level.beamWidth,
    opponentWidth: options.opponentWidth ?? level.opponentWidth,
    returnChoices: options.returnChoices ?? level.returnChoices,
    nodeBudget: options.nodeBudget ?? level.nodeBudget,
    budgetMs: options.budgetMs ?? level.budgetMs,
  };
  for (const name of ['depth', 'nodeBudget'] as const) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] < 0) throw new RangeError(name + ' 必须是非负安全整数');
  }
  for (const name of ['samples', 'beamWidth', 'opponentWidth', 'returnChoices'] as const) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] < 1) throw new RangeError(name + ' 必须是正安全整数');
  }
  if (resolved.depth > MAX_SEARCH_DEPTH) throw new RangeError('depth 不能超过 ' + MAX_SEARCH_DEPTH);
  if (resolved.samples > 32) throw new RangeError('samples 不能超过 32');
  if (!Number.isFinite(resolved.budgetMs) || resolved.budgetMs < 0) throw new RangeError('budgetMs 必须是非负有限数');
  return resolved;
}

/**
 * 根据公开信息抽样未知牌，执行有预算的多人搜索并返回决策解释。
 * @param state 待行动局面，不修改真实牌堆或玩家数据
 * @param options 强度档位及可选的搜索参数；缺省使用标准档
 * @returns 全部根候选和最后完成的搜索深度；终局返回空候选与 pass
 */
export function analyzeMoves(state: GameState, options: SearchOptions = {}): AiAnalysis {
  const startedAt = performance.now();
  const settings = resolveOptions(state, options);
  const root = state.current;
  const evaluator = createEvaluator();
  const ctx: SearchContext = {
    root, evaluator,
    nodes: 0, nodeBudget: settings.nodeBudget, deadline: startedAt + settings.budgetMs,
    beamWidth: settings.beamWidth, opponentWidth: settings.opponentWidth,
    returnChoices: settings.returnChoices,
    tables: [], cacheEntries: 0, cacheHits: 0,
  };
  const moves = state.phase === 'playing' ? searchMoves(state, settings.returnChoices) : [];
  const worlds = moves.length ? samplePublicStates(state, settings.samples) : [];
  const roots = worlds.map((world) => moves.map((move): SearchNode => {
    const after = applyMoveState(world, move);
    return { state: after, values: evaluator.evaluateAll(after) };
  }));
  const candidates: AiCandidate[] = moves.map((move, index) => ({
    move,
    score: roots.reduce((sum, nodes) => sum + nodes[index].values[root], 0) / roots.length,
    reason: reasonFor(state, move),
  }));

  // 全部根行动都已结算时，静态结果就是终局值，不再重复空搜索。
  const fullyResolved = roots.length > 0 && roots.every((nodes) => nodes.every((node) => node.state.phase === 'finished'));
  let completedDepth = fullyResolved ? settings.depth : 0;
  let interrupted = false;
  for (let depth = 1; moves.length && !fullyResolved && depth <= settings.depth; depth += 1) {
    const values = new Array<number>(moves.length).fill(0);
    try {
      // 所有根候选和抽样世界都完成后再提交，防止预算中断偏爱先枚举的行动。
      for (const nodes of roots) {
        for (let index = 0; index < moves.length; index += 1) {
          values[index] += search(nodes[index], depth, ctx)[root] / roots.length;
        }
      }
    } catch (error) {
      if (error !== ABORTED) throw error;
      interrupted = true;
      break;
    }
    for (let index = 0; index < candidates.length; index += 1) candidates[index].score = values[index];
    completedDepth = depth;
  }
  candidates.sort((a, b) => {
    const difference = b.score - a.score;
    return Math.abs(difference) <= EPSILON ? 0 : difference;
  });
  const target = moves.length ? bestTarget(state, state.players[root]) : null;
  return {
    chosen: candidates[0]?.move ?? { kind: 'pass' },
    candidates,
    goal: target ? target.tier + ' 阶' + GEM_NAMES[target.bonus] + '发展卡（' + target.points + ' 声望）'
      : moves.length ? '寻找高效投资与声望机会' : '对局已结束',
    strength: settings.id,
    nodes: ctx.nodes, ms: performance.now() - startedAt,
    depth: completedDepth, requestedDepth: settings.depth, interrupted,
    totalCandidates: candidates.length, samples: settings.samples, cacheHits: ctx.cacheHits,
  };
}
