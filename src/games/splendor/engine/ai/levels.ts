import type { AiStrength } from '../types';

export interface AiLevel {
  id: AiStrength;
  label: string;
  description: string;
  /** 根行动之后的搜索步数；高档位按人数覆盖一轮响应。 */
  depth: number;
  samples: number;
  beamWidth: number;
  opponentWidth: number;
  returnChoices: number;
  nodeBudget: number;
  budgetMs: number;
}

export const DEFAULT_AI_STRENGTH: AiStrength = 'normal';

/** 档位同时控制未知牌抽样、后续选择数量和思考预算。 */
export const AI_LEVELS: readonly AiLevel[] = [
  {
    id: 'easy', label: '入门', description: '着眼当前收益，适合熟悉交易规则。',
    depth: 0, samples: 1, beamWidth: 3, opponentWidth: 1, returnChoices: 1,
    nodeBudget: 0, budgetMs: 0,
  },
  {
    id: 'normal', label: '标准', description: '兼顾折扣与声望，考虑下一手竞争。',
    depth: 1, samples: 1, beamWidth: 4, opponentWidth: 2, returnChoices: 2,
    nodeBudget: 4_000, budgetMs: 40,
  },
  {
    id: 'hard', label: '进阶', description: '规划后续投资，预判对手的抢牌与冲线。',
    depth: 3, samples: 2, beamWidth: 6, opponentWidth: 2, returnChoices: 3,
    nodeBudget: 16_000, budgetMs: 110,
  },
  {
    id: 'expert', label: '专家', description: '更充分比较后续变化，争取关键牌与最后一轮优势。',
    depth: 5, samples: 3, beamWidth: 8, opponentWidth: 3, returnChoices: 4,
    nodeBudget: 40_000, budgetMs: 220,
  },
];

/**
 * 在配置边界解析算法强度，旧配置沿用标准档。
 * @param value 用户选择的档位
 * @returns 已校验的强度标识
 */
export function resolveAiStrength(value: AiStrength = DEFAULT_AI_STRENGTH): AiStrength {
  if (!AI_LEVELS.some((level) => level.id === value)) throw new RangeError('无效的算法强度：' + value);
  return value;
}

/**
 * 取得本局的算法档位参数。
 * @param strength 算法强度，缺省使用标准档
 * @param playerCount 对局人数，用于让高档位覆盖下一轮自身行动
 * @returns 独立参数对象，修改它不会影响其他对局
 */
export function aiLevelFor(strength: AiStrength = DEFAULT_AI_STRENGTH, playerCount = 2): AiLevel {
  const id = resolveAiStrength(strength);
  const level = AI_LEVELS.find((item) => item.id === id)!;
  return {
    ...level,
    depth: id === 'hard' ? playerCount : id === 'expert' ? playerCount + 1 : level.depth,
  };
}
