import { bonusesOf, getLegalMoves, tokenCount } from '../rules';
import { GEM_COLORS } from '../types';
import type { DevelopmentCard, GameState, Move, Player, TokenColor, Tokens } from '../types';
import { cardShortfall, resourceValue } from './evaluate';

const TOKEN_COLORS: readonly TokenColor[] = [...GEM_COLORS, 'gold'];

/** 退筹只改变当前持仓，按可见购卡距离与有效资源挑选少量不同方案。 */
function returnChoices(state: GameState, move: Extract<Move, { kind: 'take' | 'double' | 'reserve' }>, limit: number): TokenColor[][] {
  const player = state.players[state.current];
  const held: Tokens = { ...player.tokens };
  if (move.kind === 'take') for (const color of move.colors) held[color] += 1;
  else if (move.kind === 'double') held[move.color] += 2;
  else if (state.bank.gold > 0) held.gold += 1;
  const excess = Math.max(0, tokenCount(held) - state.rules.tokenLimit);
  if (excess === 0 || limit === 0) return [];

  const discounts = bonusesOf(player);
  const targets = [...player.reserved, ...state.market.flat().filter((card): card is DevelopmentCard => card !== null)];
  const choices: { returns: TokenColor[]; score: number }[] = [];
  const returned: TokenColor[] = [];
  const tokens = { ...held };
  const projected: Player = { ...player, tokens };

  function visit(index: number, remaining: number): void {
    if (remaining === 0) {
      let opportunity = 0;
      for (const card of targets) {
        const value = (5 + card.points * 6) / (1 + cardShortfall(card, projected, discounts));
        if (value > opportunity) opportunity = value;
      }
      choices.push({ returns: [...returned], score: resourceValue(state, projected) + opportunity });
      return;
    }
    if (index === TOKEN_COLORS.length) return;
    const color = TOKEN_COLORS[index];
    const max = Math.min(tokens[color], remaining);
    for (let count = 0; count <= max; count += 1) {
      tokens[color] -= count;
      for (let n = 0; n < count; n += 1) returned.push(color);
      visit(index + 1, remaining - count);
      returned.length -= count;
      tokens[color] += count;
    }
  }
  visit(0, excess);
  choices.sort((a, b) => b.score - a.score);
  return choices.slice(0, limit).map((choice) => choice.returns);
}

/**
 * 扩展正式规则的基础动作，加入贵族选择及有限的显式退筹方案。
 * @param state 当前可见局面或搜索抽样局面
 * @param maxReturnChoices 每个拿筹动作最多保留的退筹策略数，包含默认策略
 * @returns 保留全部基础动作的独立候选数组
 */
export function searchMoves(state: GameState, maxReturnChoices: number): Move[] {
  const player = state.players[state.current];
  const discounts = bonusesOf(player);
  const result: Move[] = [];
  for (const move of getLegalMoves(state)) {
    result.push(move);
    if (move.kind === 'buy') {
      const card = move.source === 'market'
        ? state.market[move.tier - 1][move.slot]
        : player.reserved[move.slot];
      if (!card) continue;
      const eligible = state.nobles.filter((noble) => GEM_COLORS.every((color) =>
        discounts[color] + (color === card.bonus ? 1 : 0) >= noble.requirement[color]));
      // 正式规则默认选第一个；其余贵族需要显式选择，避免把数组顺序当策略。
      for (const noble of eligible.slice(1)) result.push({ ...move, nobleId: noble.id });
    } else if (move.kind !== 'pass' && maxReturnChoices > 1) {
      for (const returns of returnChoices(state, move, maxReturnChoices - 1)) result.push({ ...move, returns });
    }
  }
  return result;
}
