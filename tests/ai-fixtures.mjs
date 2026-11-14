import { createInitialState } from '../src/lib/game/rules.ts';

export function makeState(seats, planes, current = 0, sixStreak = 0) {
  return { ...createInitialState(seats), planes: planes.map((row) => [...row]), current, sixStreak };
}

// 固定中局与残局，不把机器运行时间作为输入的一部分。
export const fixtures = [
  { name: 'opening', dice: 6, state: makeState([0, 1, 2, 3], [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]) },
  { name: 'two-player-midgame', dice: 3, state: makeState([0, 2], [[6, 18, 37, 52], [3, 15, 29, 54]]) },
  { name: 'three-player-midgame', dice: 6, state: makeState([0, 1, 3], [[-1, 9, 25, 46], [2, 13, 32, 55], [5, 20, 39, 57]], 1, 1) },
  { name: 'four-player-midgame', dice: 4, state: makeState([0, 1, 2, 3], [[8, 19, 34, 47], [4, 16, 31, 51], [6, 21, 38, 53], [11, 23, 41, 54]]) },
  { name: 'stacked-planes', dice: 6, state: makeState([1, 3], [[0, 0, 12, 12], [26, 26, 38, 38]], 0, 2) },
  { name: 'finish-race', dice: 2, state: makeState([1, 2, 3], [[52, 55, 57, 57], [54, 56, 57, 57], [49, 53, 57, 57]]) },
];
