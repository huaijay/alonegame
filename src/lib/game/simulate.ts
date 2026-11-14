import type { Seat } from './board';
import { chooseMove } from './ai/expectimax';
import { applyMove, createInitialState, getLegalMoves, passTurn } from './rules';
import { createRng, rollDice } from './rng';
import type { GameState } from './types';

/** 单局模拟结果 */
export interface SimOutcome {
  winner: Seat | null;
  rolls: number;
}

/** 防止极端情况下模拟无法收敛 */
const MAX_ROLLS = 1500;

/**
 * 无界面推进一整局，用于批量胜率模拟
 *
 * @param seats 参与座位
 * @param seed 随机种子
 * @param depth AI 搜索层数
 * @returns 胜者与掷骰次数
 */
export function simulateGame(seats: Seat[], seed: number, depth: number): SimOutcome {
  const rng = createRng(seed);
  let state: GameState = createInitialState(seats);

  while (state.winner === null && state.rolls < MAX_ROLLS) {
    const dice = rollDice(rng);
    const moves = getLegalMoves(state, dice);
    if (moves.length === 0) {
      state = passTurn(state);
      continue;
    }
    const decision = chooseMove(state, dice, { depth, budgetMs: 12, nodeBudget: 4_000 });
    if (!decision) {
      state = passTurn(state);
      continue;
    }
    state = applyMove(state, decision.move, dice).state;
  }

  return { winner: state.winner, rolls: state.rolls };
}

/** 批量模拟的汇总结果 */
export interface BatchResult {
  games: number;
  /** 座位号 -> 胜场 */
  wins: Record<string, number>;
  draws: number;
  totalRolls: number;
}
