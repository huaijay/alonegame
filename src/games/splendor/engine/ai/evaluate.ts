import { emptyGems } from '../board';
import { bonusesOf } from '../rules';
import { GEM_COLORS } from '../types';
import type { DevelopmentCard, GameState, GemColor, Gems, Player } from '../types';

/** 独胜分值；并列赢家平分这份正收益，其余玩家记为负值。 */
export const WIN_VALUE = 1_000_000;

export interface EvaluationBreakdown {
  points: number;
  engine: number;
  resources: number;
  targets: number;
  nobles: number;
  reservations: number;
  competition: number;
  total: number;
}

// 一份折扣会在未来多次购卡中重复使用；同色越多，能继续减价的牌就越少。
const DISCOUNT_VALUES = [60, 46, 34, 24, 16, 10, 6, 3] as const;
const POINT_VALUE = 100;

interface PlayerFeatures {
  player: Player | null;
  discounts: Gems;
  engine: number;
}

interface EvaluationWorkspace {
  features: PlayerFeatures[];
  parts: EvaluationBreakdown[];
  market: DevelopmentCard[];
  targets: DevelopmentCard[];
  needs: number[];
  totals: Float64Array;
}

function emptyBreakdown(): EvaluationBreakdown {
  return { points: 0, engine: 0, resources: 0, targets: 0, nobles: 0, reservations: 0, competition: 0, total: 0 };
}

function createWorkspace(): EvaluationWorkspace {
  return {
    features: Array.from({ length: 4 }, () => ({ player: null, discounts: emptyGems(), engine: 0 })),
    parts: Array.from({ length: 4 }, emptyBreakdown),
    market: [],
    targets: [],
    needs: new Array<number>(GEM_COLORS.length).fill(0),
    totals: new Float64Array(4),
  };
}

function marginalDiscount(owned: number): number {
  return DISCOUNT_VALUES[owned] ?? 1;
}

function engineWeight(state: GameState): number {
  let leadingPoints = 0;
  for (const player of state.players) leadingPoints = Math.max(leadingPoints, player.points);
  // 有人接近冲线时，长期折扣必须让位于当下的声望。
  return Math.max(0.28, 1 - leadingPoints / state.rules.victoryPoints * 0.72);
}

function collectPlayer(player: Player, cached: PlayerFeatures): PlayerFeatures {
  if (cached.player === player) return cached;
  for (const color of GEM_COLORS) cached.discounts[color] = 0;
  for (const card of player.cards) cached.discounts[card.bonus] += 1;
  cached.engine = 0;
  for (const color of GEM_COLORS) {
    for (let count = 0; count < cached.discounts[color]; count += 1) {
      cached.engine += marginalDiscount(count);
    }
  }
  cached.player = player;
  return cached;
}

function fillMarket(state: GameState, cards: DevelopmentCard[]): void {
  cards.length = 0;
  for (const row of state.market) {
    for (const card of row) if (card !== null) cards.push(card);
  }
}

function fillTargets(market: DevelopmentCard[], player: Player, targets: DevelopmentCard[]): void {
  targets.length = 0;
  for (const card of player.reserved) targets.push(card);
  for (const card of market) targets.push(card);
}

/**
 * 计算购买此卡仍缺少的真实筹码数，先用永久折扣，再抵扣持有筹码及黄金。
 * @param card 待评估的发展卡
 * @param player 买方当前持仓
 * @param discounts 买方五色永久折扣
 * @returns 非负缺口；零表示现在可以买入
 */
export function cardShortfall(card: DevelopmentCard, player: Player, discounts: Gems): number {
  let deficit = 0;
  for (const color of GEM_COLORS) {
    deficit += Math.max(0, card.cost[color] - discounts[color] - player.tokens[color]);
  }
  return Math.max(0, deficit - player.tokens.gold);
}

/** 颜色瓶颈、银行短缺与持筹上限共同决定补齐目标所需的行动潜力。 */
function acquisitionTurns(
  state: GameState,
  card: DevelopmentCard,
  player: Player,
  discounts: Gems,
  needs: number[],
): number {
  let totalDue = 0;
  for (let index = 0; index < GEM_COLORS.length; index += 1) {
    const color = GEM_COLORS[index];
    const due = Math.max(0, card.cost[color] - discounts[color]);
    totalDue += due;
    needs[index] = Math.max(0, due - player.tokens[color]);
  }
  // 黄金优先消除最紧的单色瓶颈；这是拿筹回合数的平滑估计，不是精确概率。
  for (let gold = player.tokens.gold; gold > 0; gold -= 1) {
    let biggest = 0;
    for (let index = 1; index < needs.length; index += 1) {
      if (needs[index] > needs[biggest]) biggest = index;
    }
    if (needs[biggest] === 0) break;
    needs[biggest] -= 1;
  }
  let totalMissing = 0;
  let colorTurns = 0;
  let shortage = 0;
  for (let index = 0; index < GEM_COLORS.length; index += 1) {
    const color = GEM_COLORS[index];
    const rate = state.bank[color] >= state.rules.doubleTakeMinimum ? 2 : 1;
    totalMissing += needs[index];
    colorTurns = Math.max(colorTurns, needs[index] / rate);
    shortage += Math.max(0, needs[index] - state.bank[color]);
  }
  // 超过持筹上限的卡还需要先建设折扣，不能把它当成单纯多拿几次宝石即可买到。
  const missingDiscounts = Math.max(0, totalDue - state.rules.tokenLimit);
  return Math.max(totalMissing / 3, colorTurns) + shortage * 0.4 + missingDiscounts * 0.9;
}

function usefulResources(player: Player, discounts: Gems, targets: DevelopmentCard[]): number {
  let value = player.tokens.gold * 9.5;
  for (const color of GEM_COLORS) {
    let demand = 0;
    for (const card of targets) demand = Math.max(demand, card.cost[color] - discounts[color]);
    const useful = Math.min(player.tokens[color], demand);
    for (let count = 0; count < useful; count += 1) value += 5 / (1 + count * 0.2);
  }
  return value;
}

function targetValue(
  state: GameState,
  card: DevelopmentCard,
  player: Player,
  discounts: Gems,
  weight: number,
  needs: number[],
): number {
  const turns = acquisitionTurns(state, card, player, discounts, needs);
  const reward = 8 + card.points * 8 + marginalDiscount(discounts[card.bonus]) * weight * 0.12;
  return reward / (1 + turns * 1.5);
}

function nobleGap(discounts: Gems, requirement: Gems): number {
  let gap = 0;
  for (const color of GEM_COLORS) gap += Math.max(0, requirement[color] - discounts[color]);
  return gap;
}

function noblePotential(state: GameState, seat: number, workspace: EvaluationWorkspace): number {
  let best = 0;
  let second = 0;
  for (const noble of state.nobles) {
    const gap = nobleGap(workspace.features[seat].discounts, noble.requirement);
    let rivalGap = Infinity;
    for (let other = 0; other < state.players.length; other += 1) {
      if (other !== seat) rivalGap = Math.min(rivalGap, nobleGap(workspace.features[other].discounts, noble.requirement));
    }
    const contested = 1 + Math.max(0, gap - rivalGap) * 0.25;
    const value = noble.points * 26 / ((1 + gap * 1.5) * contested);
    if (value > best) { second = best; best = value; }
    else if (value > second) second = value;
  }
  // 一回合至多拜访一位，不能把所有相似贵族的潜力完整相加。
  return best + second * 0.35;
}

function finalTurnGain(state: GameState, player: Player, discounts: Gems, targets: DevelopmentCard[]): number {
  let best = 0;
  // 已满足的贵族不要求本回合购卡，也可以在拿筹或预留后到访。
  for (const noble of state.nobles) {
    if (nobleGap(discounts, noble.requirement) === 0) best = Math.max(best, noble.points);
  }
  for (const card of targets) {
    if (cardShortfall(card, player, discounts) !== 0) continue;
    let noblePoints = 0;
    for (const noble of state.nobles) {
      let eligible = true;
      for (const color of GEM_COLORS) {
        if (discounts[color] + Number(card.bonus === color) < noble.requirement[color]) {
          eligible = false;
          break;
        }
      }
      if (eligible) noblePoints = Math.max(noblePoints, noble.points);
    }
    best = Math.max(best, card.points + noblePoints);
  }
  return best;
}

/**
 * 判断某席位在终轮中是否还有行动机会：从当前行动方沿座位顺序到先手玩家之前（不含）。
 * @param state 终轮局面
 * @param seat 待判断的玩家序号
 * @returns 该席位仍可行动时为真
 */
function stillToAct(state: GameState, seat: number): boolean {
  const { current, firstPlayer, players } = state;
  for (let index = current; index !== firstPlayer; index = (index + 1) % players.length) {
    if (index === seat) return true;
  }
  return false;
}

function collect(state: GameState, workspace: EvaluationWorkspace): void {
  fillMarket(state, workspace.market);
  for (let seat = 0; seat < state.players.length; seat += 1) {
    collectPlayer(state.players[seat], workspace.features[seat]);
  }
  const weight = engineWeight(state);
  for (let seat = 0; seat < state.players.length; seat += 1) {
    const player = state.players[seat];
    const { discounts, engine } = workspace.features[seat];
    const parts = workspace.parts[seat];
    fillTargets(workspace.market, player, workspace.targets);
    parts.points = player.points * POINT_VALUE;
    parts.engine = 0;
    parts.resources = 0;
    parts.targets = 0;
    parts.nobles = 0;
    parts.reservations = 0;
    parts.competition = 0;
    if (state.finalRound) {
      // 已行动的席位没有下一回合，剩余筹码和长期折扣不再有独立价值。
      parts.points = player.points * 1000 - player.cards.length;
      if (stillToAct(state, seat)) {
        // 公开牌仍可能被前手抢走，潜力保留折扣，真正终局由规则胜者覆盖。
        parts.targets = finalTurnGain(state, player, discounts, workspace.targets) * 750;
      }
    } else {
      parts.engine = engine * weight;
      parts.resources = usefulResources(player, discounts, workspace.targets);
      let best = 0;
      let second = 0;
      for (const card of workspace.targets) {
        const value = targetValue(state, card, player, discounts, weight, workspace.needs);
        if (value > best) { second = best; best = value; }
        else if (value > second) second = value;
      }
      parts.targets = best + second * 0.25;
      parts.nobles = noblePotential(state, seat, workspace);
      for (const card of player.reserved) {
        const turns = acquisitionTurns(state, card, player, discounts, workspace.needs);
        parts.reservations -= 2.5 + Math.max(0, turns - 2) * 1.4;
      }
    }
    parts.total = parts.points + parts.engine + parts.resources + parts.targets + parts.nobles + parts.reservations;
  }
  // 主要关注最接近获胜的竞争者，另保留少量多人平均压力；每人仍独立最大化自身收益。
  const totals = workspace.totals;
  for (let seat = 0; seat < state.players.length; seat += 1) totals[seat] = workspace.parts[seat].total;
  for (let seat = 0; seat < state.players.length; seat += 1) {
    let strongest = -Infinity;
    let sum = 0;
    for (let other = 0; other < state.players.length; other += 1) {
      if (other === seat) continue;
      strongest = Math.max(strongest, totals[other]);
      sum += totals[other];
    }
    const parts = workspace.parts[seat];
    // 末轮直接比较排名差距，不能因扩大声望尺度而把落后者也评成大幅正收益。
    parts.competition = state.players.length <= 1 ? 0 : state.finalRound
      ? -strongest
      : -strongest * 0.72 - sum / (state.players.length - 1) * 0.08;
    parts.total += parts.competition;
  }
}

function terminalValue(state: GameState, seat: number): number {
  return state.winners.includes(seat) ? WIN_VALUE / state.winners.length : -WIN_VALUE;
}

function valuesWith(state: GameState, workspace: EvaluationWorkspace): number[] {
  if (state.phase === 'finished') return state.players.map((_, seat) => terminalValue(state, seat));
  collect(state, workspace);
  return state.players.map((_, seat) => workspace.parts[seat].total);
}

function breakdownWith(state: GameState, seat: number, workspace: EvaluationWorkspace): EvaluationBreakdown {
  if (state.phase === 'finished') {
    const total = terminalValue(state, seat);
    return { ...emptyBreakdown(), points: total, total };
  }
  collect(state, workspace);
  return { ...workspace.parts[seat] };
}

/**
 * 计算新增一份该色永久折扣的边际潜力，重复同色和临近终局时递减。
 * @param state 当前公开局面
 * @param player 待评估玩家
 * @param color 折扣颜色
 * @returns 与局面估值使用同一尺度的长期收益
 */
export function bonusValue(state: GameState, player: Player, color: GemColor): number {
  if (state.finalRound) return 0;
  const discounts = bonusesOf(player);
  return marginalDiscount(discounts[color]) * engineWeight(state);
}

/**
 * 选取值得继续筹集宝石、但当前尚未买得起的公开或已预留目标。
 * @param state 当前局面
 * @param player 目标玩家
 * @returns 最佳目标卡；没有待筹资目标时返回 null
 */
export function bestTarget(state: GameState, player: Player): DevelopmentCard | null {
  const discounts = bonusesOf(player);
  const market: DevelopmentCard[] = [];
  fillMarket(state, market);
  const targets = [...player.reserved, ...market];
  const needs = new Array<number>(GEM_COLORS.length).fill(0);
  const weight = engineWeight(state);
  let best: DevelopmentCard | null = null;
  let top = -Infinity;
  for (const card of targets) {
    if (cardShortfall(card, player, discounts) === 0) continue;
    const value = targetValue(state, card, player, discounts, weight, needs);
    if (value > top) { best = card; top = value; }
  }
  return best;
}

/**
 * 估计真正可服务于当前目标的宝石价值，不给已经过量的颜色继续加分。
 * @param state 当前公开局面
 * @param player 待评估玩家
 * @returns 普通宝石与黄金的可用价值；最终轮没有下一次拿筹价值
 */
export function resourceValue(state: GameState, player: Player): number {
  if (state.finalRound) return 0;
  const market: DevelopmentCard[] = [];
  fillMarket(state, market);
  return usefulResources(player, bonusesOf(player), [...player.reserved, ...market]);
}

/**
 * 创建一次搜索专用的估值器，复用各玩家折扣和小型工作数组。
 * @returns 仅依赖传入状态公开信息、返回独立数组及分项对象的估值器
 */
export function createEvaluator(): {
  evaluateAll: (state: GameState) => number[];
  breakdownOf: (state: GameState, seat: number) => EvaluationBreakdown;
} {
  const workspace = createWorkspace();
  return {
    evaluateAll: (state) => valuesWith(state, workspace),
    breakdownOf: (state, seat) => breakdownWith(state, seat, workspace),
  };
}

/**
 * 评估所有玩家的局面收益，供 Max-n 分别选择各自的最佳行动。
 * @param state 当前局面，终局胜者以正式规则写入的 state.winners 为准
 * @returns 按玩家序号排列的独立收益向量
 */
export function evaluateAll(state: GameState): number[] {
  return valuesWith(state, createWorkspace());
}

/**
 * 给出指定玩家的估值分项，便于验证与决策解释。
 * @param state 当前局面
 * @param seat 玩家序号
 * @returns 与 evaluateAll 对应分量相同的总分及各项贡献
 */
export function breakdownOf(state: GameState, seat: number): EvaluationBreakdown {
  return breakdownWith(state, seat, createWorkspace());
}
