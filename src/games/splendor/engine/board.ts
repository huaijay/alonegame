import type { GemColor, Gems, Tokens } from './types';

/** 对应宝石的中文名，仅为展示服务的共享元数据。 */
export const GEM_NAMES: Record<GemColor, string> = {
  white: '钻石',
  blue: '蓝宝石',
  green: '祖母绿',
  red: '红宝石',
  black: '黑玛瑙',
};

export const PLAYER_NAMES = ['玩家一', '玩家二', '玩家三', '玩家四'] as const;

/** 构造独立的五色计数，避免跨玩家共享可变引用。 */
export function emptyGems(): Gems {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

/** 构造独立的六色筹码计数。 */
export function emptyTokens(): Tokens {
  return { ...emptyGems(), gold: 0 };
}
