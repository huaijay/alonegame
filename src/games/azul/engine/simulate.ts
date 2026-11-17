import type { Seat } from './board';
import { chooseMove } from './ai/search';
import { advanceState, createInitialState, startNextRound } from './rules';
import { createRng } from './rng';
import type { GameState } from './types';

/** 单局模拟结果 */
export interface SimOutcome {
  winner: Seat | null;
  rounds: number;
}

/** 防止极端情况下模拟无法收敛 */
const MAX_MOVES = 3000;

/**
 * 无界面推进一整局，用于批量胜率模拟
 *
 * @param seats 参与座位
 * @param seed 随机种子
 * @param depth AI 搜索深度
 * @returns 胜者与轮数
 */
export function simulateGame(seats: Seat[], seed: number, depth: number): SimOutcome {
  const rng = createRng(seed);
  let state: GameState = createInitialState(seats, rng);

  let moves = 0;
  while (state.phase !== 'gameEnd' && moves < MAX_MOVES) {
    if (state.phase === 'roundEnd') {
      state = startNextRound(state, rng);
      continue;
    }
    const decision = chooseMove(state, { depth, budgetMs: 8, nodeBudget: 3_000 });
    // placing 阶段始终存在兜底行动，决策不可能为空；守卫仅为满足类型收窄
    if (!decision) break;
    state = advanceState(state, decision.move, rng);
    moves += 1;
  }

  return { winner: state.winner, rounds: state.round };
}

/** 批量模拟的汇总结果 */
export interface BatchResult {
  games: number;
  /** 座位号 -> 胜场 */
  wins: Record<string, number>;
  totalRounds: number;
}
