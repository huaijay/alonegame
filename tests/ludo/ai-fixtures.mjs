import { createInitialState } from '../../src/games/ludo/engine/rules.ts';

export function makeState(seats, planes, current = 0, sixStreak = 0) {
  return { ...createInitialState(seats), planes: planes.map((row) => [...row]), current, sixStreak };
}

// 固定中局与残局，不把机器运行时间作为输入的一部分。
// 位置编码：轨道 0-50，终点跑道 51-55，归位 56（与 types.ts 常量一致）。
export const fixtures = [
  { name: 'opening', dice: 6, state: makeState([0, 1, 2, 3], [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]) },
  { name: 'two-player-midgame', dice: 3, state: makeState([0, 2], [[6, 18, 37, 51], [3, 15, 29, 53]]) },
  { name: 'three-player-midgame', dice: 6, state: makeState([0, 1, 3], [[-1, 9, 25, 46], [2, 13, 32, 54], [5, 20, 39, 56]], 1, 1) },
  { name: 'four-player-midgame', dice: 4, state: makeState([0, 1, 2, 3], [[8, 19, 34, 47], [4, 16, 31, 50], [6, 21, 38, 52], [11, 23, 41, 53]]) },
  { name: 'stacked-planes', dice: 6, state: makeState([1, 3], [[0, 0, 12, 12], [26, 26, 38, 38]], 0, 2) },
  { name: 'finish-race', dice: 2, state: makeState([1, 2, 3], [[51, 54, 56, 56], [53, 55, 56, 56], [49, 52, 56, 56]]) },
];
