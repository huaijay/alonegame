import { DEVELOPMENT_CARDS } from '../cards';
import { createRng, shuffled } from '../rng';
import type { GameState } from '../types';

/**
 * 根据公开信息构造共同抽样牌序，真实未翻开牌堆仅提供剩余张数。
 * @param state 当前局面；本项目界面可查看所有预留牌，故预留牌属于公开信息
 * @param samples 需要比较的未知牌样本数量
 * @returns 共享不可变公开状态、分别持有抽样牌堆的新局面
 */
export function samplePublicStates(state: GameState, samples: number): GameState[] {
  const visible = new Set<string>();
  for (const player of state.players) {
    for (const card of player.cards) visible.add(card.id);
    for (const card of player.reserved) visible.add(card.id);
  }
  for (const row of state.market) {
    for (const card of row) if (card) visible.add(card.id);
  }
  const pools = [1, 2, 3].map((tier) =>
    DEVELOPMENT_CARDS.filter((card) => card.tier === tier && !visible.has(card.id)));
  // 种子只取公开信息；不读取实际 deck 的卡牌身份或顺序，也不消耗对局随机源。
  const publicKey = JSON.stringify([
    state.rules, state.current, state.turn, state.finalRound, state.bank,
    state.players, state.market, state.nobles, state.decks.map((deck) => deck.length),
  ]);
  let seed = 2166136261;
  for (let i = 0; i < publicKey.length; i += 1) {
    seed = Math.imul(seed ^ publicKey.charCodeAt(i), 16777619);
  }
  return Array.from({ length: samples }, (_, sample) => {
    const rng = createRng((seed + Math.imul(sample + 1, 0x9e3779b9)) >>> 0);
    return {
      ...state,
      decks: pools.map((pool, tier) => shuffled(pool, rng).slice(0, state.decks[tier].length)) as GameState['decks'],
    };
  });
}
