import { GEM_NAMES } from '../board';
import { GEM_COLORS } from '../types';
import { applyMoveState, bonusesOf, getLegalMoves, paymentFor, tokenCount } from '../rules';
import { bestTarget, bonusValue, cardShortfall, resourceValue } from './evaluate';
import type { DevelopmentCard, GameState, Move } from '../types';

export interface AiCandidate {
  move: Move;
  score: number;
  reason: string;
}

export interface AiAnalysis {
  chosen: Move;
  candidates: AiCandidate[];
  goal: string;
}

/** 将动作转换成决策面板可读的中文名称。 */
export function describeMove(state: GameState, move: Move): string {
  switch (move.kind) {
    case 'take': return '拿取 ' + move.colors.map((color) => GEM_NAMES[color]).join(' · ');
    case 'double': return '双取 ' + GEM_NAMES[move.color];
    case 'reserve': return '预留 ' + move.tier + ' 阶' + (move.slot === null ? '盲牌' : '卡 ' + (move.slot + 1));
    case 'buy': {
      const card = move.source === 'market'
        ? state.market[move.tier - 1][move.slot]
        : state.players[state.current].reserved[move.slot];
      return card ? '购买 ' + card.tier + ' 阶' + GEM_NAMES[card.bonus] + '牌 · ' + card.points + ' 分' : '购买';
    }
    case 'pass': return '跳过';
  }
}

/** 评估候选动作：优先扩张引擎，后期转向声望和贵族；不复制规则合法性逻辑。 */
export function analyzeMoves(state: GameState): AiAnalysis {
  const player = state.players[state.current];
  const discounts = bonusesOf(player);
  const target = bestTarget(state, player);
  const beforeResource = resourceValue(state, player);
  const beforeMissing = target ? cardShortfall(target, player, discounts) : 0;

  const candidates = getLegalMoves(state).map((move): AiCandidate => {
    if (move.kind === 'pass') return { move, score: -100, reason: '暂无可执行动作' };
    if (move.kind === 'buy') {
      const card = (move.source === 'market'
        ? state.market[move.tier - 1][move.slot]
        : player.reserved[move.slot]) as DevelopmentCard;
      const spend = paymentFor(card, player);
      if (!spend) throw new Error('AI 发现不存在的购买行动');
      const spent = GEM_COLORS.reduce((sum, color) => sum + spend[color], 0);
      const newer = applyMoveState(state, move);
      const gained = newer.players[state.current].points - player.points;
      const upcoming = Math.max(0, bonusValue(state, player, card.bonus));
      const urgency = player.points >= state.rules.victoryPoints * 0.55 ? 1.5 : 1;
      const score = 11 + gained * 11 * urgency + upcoming * (player.cards.length < 7 ? 1.7 : 0.95) -
        spent * 1.35 - spend.gold * 2.5 +
        (newer.players[state.current].nobles.length > player.nobles.length ? 20 : 0) +
        (newer.finalRound && !state.finalRound ? 45 : 0);
      return { move, score, reason: '新增' + GEM_NAMES[card.bonus] + '永久折扣，' + (gained ? '收获 ' + gained + ' 声望' : '降低后续购卡成本') };
    }
    if (move.kind === 'reserve') {
      const card = move.slot === null ? state.decks[move.tier - 1][0] : state.market[move.tier - 1][move.slot];
      const missing = card ? cardShortfall(card, player, discounts) : 8;
      const hasGold = state.bank.gold > 0;
      const score = 3 + (hasGold ? 5.6 : 0) +
        (card && missing <= 3 ? card.points * 1.8 + 2.4 : 0) -
        (missing >= 5 ? 5 : 0) - player.reserved.length * (10 / state.rules.reserveLimit);
      return { move, score, reason: hasGold ? '锁定发展卡，同时换取黄金通配筹码' : '锁定下一轮的目标卡' };
    }
    const next = applyMoveState(state, move);
    const changedPlayer = next.players[state.current];
    const afterResource = resourceValue(next, changedPlayer);
    const afterMissing = target ? cardShortfall(target, changedPlayer, discounts) : 0;
    const gain = Math.max(0, beforeMissing - afterMissing);
    const netTokens = tokenCount(changedPlayer.tokens) - tokenCount(player.tokens);
    const colorNames = move.kind === 'double' ? [GEM_NAMES[move.color]] : move.colors.map((color) => GEM_NAMES[color]);
    const score = 4.3 + gain * (target ? 5.8 : 1.6) +
      (afterResource - beforeResource) * 2 + Math.max(-1, netTokens) * 0.9 +
      (move.kind === 'take' ? 0.8 : 0);
    return { move, score, reason: target ? '为目标发展卡补充' + colorNames.join('、') : '优化手中宝石储备' };
  });

  candidates.sort((a, b) => b.score - a.score);
  return {
    chosen: candidates[0]?.move ?? { kind: 'pass' },
    candidates: candidates.slice(0, 5),
    goal: target ? target.tier + ' 阶' + GEM_NAMES[target.bonus] + '发展卡（' + target.points + ' 声望）' : '寻找新的购卡机会',
  };
}
