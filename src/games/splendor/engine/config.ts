import type { GameRules } from './types';

/** 经典版默认规则：仅宝石/贵族供应量依玩家人数调整。 */
export function classicRulesFor(playerCount: 2 | 3 | 4): GameRules {
  return {
    victoryPoints: 15,
    tokenLimit: 10,
    reserveLimit: 3,
    marketSize: 4,
    nobleCount: playerCount + 1,
    gemSupply: playerCount === 2 ? 4 : playerCount === 3 ? 5 : 7,
    goldSupply: 5,
    doubleTakeMinimum: 4,
  };
}

/** 高级选项边界，避免无意义或使界面无法呈现的极端值。 */
export const RULE_LIMITS: Readonly<Record<keyof GameRules, readonly [number, number]>> = {
  victoryPoints: [5, 30],
  tokenLimit: [6, 15],
  reserveLimit: [1, 5],
  marketSize: [3, 5],
  nobleCount: [0, 10],
  gemSupply: [3, 9],
  goldSupply: [0, 10],
  doubleTakeMinimum: [2, 6],
};

/** 将用户的覆写项叠加到经典版并校验；无效输入在开局边界明确报错。 */
export function resolveGameRules(
  playerCount: 2 | 3 | 4,
  overrides: Partial<GameRules> = {},
): GameRules {
  const rules = { ...classicRulesFor(playerCount), ...overrides };
  for (const key of Object.keys(RULE_LIMITS) as (keyof GameRules)[]) {
    const value = rules[key];
    const [min, max] = RULE_LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`无效的璀璨宝石规则 ${key}：必须为 ${min}–${max} 之间的整数`);
    }
  }
  return rules;
}
