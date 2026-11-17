import { GEM_COLORS } from '../types';
import { bonusesOf, paymentFor, tokenCount } from '../rules';
import type { DevelopmentCard, GameState, GemColor, Gems, Player } from '../types';

/** 某颜色新添一份永久折扣对该玩家的长期价值。 */
export function bonusValue(state: GameState, player: Player, color: GemColor): number {
  const owned = bonusesOf(player)[color];
  const marketNeed = state.market.flat().filter((card): card is DevelopmentCard => card !== null)
    .reduce((sum, card) => sum + (card.cost[color] > owned ? 1 : 0), 0);
  const nobleNeed = state.nobles.reduce((sum, noble) =>
    sum + (noble.requirement[color] > owned ? 1 : 0), 0);
  return 4 + Math.min(4, marketNeed) * 0.6 + Math.min(2, nobleNeed) * 1.2 - owned * 1.45;
}

/** 预计还差多少真实筹码可购买一张卡（黄金视作通配）。 */
export function cardShortfall(card: DevelopmentCard, player: Player, discounts: Gems): number {
  let deficit = 0;
  for (const color of GEM_COLORS) {
    deficit += Math.max(0, card.cost[color] - discounts[color] - player.tokens[color]);
  }
  return Math.max(0, deficit - player.tokens.gold);
}

/** 计算当前最值得围绕其收集宝石的目标卡。 */
export function bestTarget(state: GameState, player: Player): DevelopmentCard | null {
  const discounts = bonusesOf(player);
  const cards = [
    ...player.reserved,
    ...state.market.flat().filter((card): card is DevelopmentCard => card !== null),
  ];
  let best: DevelopmentCard | null = null;
  let top = -Infinity;
  for (const card of cards) {
    const missing = cardShortfall(card, player, discounts);
    const free = paymentFor(card, player) !== null;
    const value = 5 + card.points * (player.points >= state.rules.victoryPoints * 0.55 ? 13 : 8) +
      bonusValue(state, player, card.bonus) * (player.cards.length < 7 ? 1.3 : 0.6);
    const projected = value / (1 + missing * 0.85) + (player.reserved.some((item) => item.id === card.id) ? 2 : 0);
    // 已经买得起的牌不需要再为它领取宝石；让 AI 优先规划下一份投资。
    if (!free && projected > top) {
      best = card;
      top = projected;
    }
  }
  return best;
}

/** 当前玩家的资源总价值摘要，用于对比宝石动作。 */
export function resourceValue(state: GameState, player: Player): number {
  const discounts = bonusesOf(player);
  const targets = [
    ...player.reserved,
    ...state.market.flat().filter((card): card is DevelopmentCard => card !== null),
  ];
  const colorValue = GEM_COLORS.reduce((total, color) => {
    const demand = Math.max(0, ...targets.map((card) => card.cost[color] - discounts[color]));
    return total + Math.min(player.tokens[color], demand) * 1.25;
  }, 0);
  return colorValue + player.tokens.gold * 2 + Math.min(state.rules.tokenLimit, tokenCount(player.tokens)) * 0.35;
}
