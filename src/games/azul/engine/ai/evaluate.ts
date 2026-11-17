import { floorPenalty, rowCapacity } from '../board';
import { WALL_SIZE } from '../types';
import type { GameState, PlayerBoard } from '../types';

/** 局面评估的分项得分，用于 AI 决策解释面板 */
export interface EvaluationBreakdown {
  /** 已入账分数（含地板扣分与上墙得分） */
  score: number;
  /** 图案行完成潜力：越接近满行价值越高 */
  rows: number;
  /** 已上墙的结构价值：砖块数量与相邻连接加成 */
  wall: number;
  /** 本轮地板尚未结算的罚分（负值） */
  floor: number;
  /** 持有首玩家标记的先手价值 */
  marker: number;
  total: number;
}

/** 终局胜负分值 */
export const WIN_VALUE = 1_000_000;

/** 分项权重：真实分数项 ×10 主导，潜力项按期望价值折算 */
const SCORE_WEIGHT = 10;
const ROW_BONUS = 2.6;
const LINK_BONUS = 0.4;
const MARKER_BONUS = 1.6;
/** 对手分量总权重：多人时按人数分摊 */
const RIVAL_WEIGHT = 0.85;

/** 单个玩家板的分项价值（不含对手比较） */
function boardValue(board: PlayerBoard): EvaluationBreakdown {
  let rows = 0;
  board.rows.forEach((pattern, row) => {
    if (pattern.color === null || pattern.count <= 0) return;
    // 完成一行至少得 1 分，这里按平均连接价值估算完成后的期望收益
    rows += (pattern.count / rowCapacity(row)) * ROW_BONUS;
  });

  let wall = 0;
  for (let row = 0; row < WALL_SIZE; row += 1) {
    for (let col = 0; col < WALL_SIZE; col += 1) {
      if (!board.wall[row][col]) continue;
      wall += 1;
      // 每个相邻墙块提升后续连接得分的期望
      let links = 0;
      if (row > 0 && board.wall[row - 1][col]) links += 1;
      if (row < WALL_SIZE - 1 && board.wall[row + 1][col]) links += 1;
      if (col > 0 && board.wall[row][col - 1]) links += 1;
      if (col < WALL_SIZE - 1 && board.wall[row][col + 1]) links += 1;
      wall += links * LINK_BONUS;
    }
  }

  // 放置阶段地板上的砖在本轮结算时必然扣分，按当前数量预期
  const floor = board.floor.length > 0 ? floorPenalty(board.floor.length) : 0;
  const marker = board.hasFirstMarker ? MARKER_BONUS : 0;
  return {
    score: board.score,
    rows,
    wall,
    floor,
    marker,
    total: board.score * SCORE_WEIGHT + rows + wall + floor * SCORE_WEIGHT + marker,
  };
}

/** 由各玩家分项合成 root 视角的评分：对手分量按人数分摊扣减 */
function breakdownFrom(values: EvaluationBreakdown[], root: number): EvaluationBreakdown {
  const rivals = values.length - 1;
  const rivalWeight = rivals > 0 ? RIVAL_WEIGHT / rivals : 0;
  const own = values[root];
  const result: EvaluationBreakdown = { ...own };
  for (let player = 0; player < values.length; player += 1) {
    if (player === root) continue;
    result.score -= values[player].score * rivalWeight;
    result.rows -= values[player].rows * rivalWeight;
    result.wall -= values[player].wall * rivalWeight;
    result.floor -= values[player].floor * rivalWeight;
    result.marker -= values[player].marker * rivalWeight;
  }
  result.total =
    result.score * SCORE_WEIGHT +
    result.rows +
    result.wall +
    result.floor * SCORE_WEIGHT +
    result.marker;
  return result;
}

/** 终局向量：胜者 WIN_VALUE，败者 -WIN_VALUE */
function terminalValues(state: GameState): number[] {
  const best = Math.max(...state.players.map((board) => board.score));
  return state.players.map((board) => (board.score === best ? WIN_VALUE : -WIN_VALUE));
}

/**
 * 所有玩家的收益向量；对手在自己的回合最大化自己的分量（Max-n）。
 *
 * @param state 待评估局面
 * @returns 与玩家序号对应的评分数组
 */
export function evaluateAll(state: GameState): number[] {
  if (state.phase === 'gameEnd') return terminalValues(state);
  const values = state.players.map((board) => boardValue(board));
  return state.players.map((_, root) => breakdownFrom(values, root).total);
}

/**
 * 当前局面的分项解释，终局总分与搜索使用的分值保持一致。
 *
 * @param state 待评估局面
 * @param root 视角玩家序号
 */
export function breakdownOf(state: GameState, root: number): EvaluationBreakdown {
  if (state.phase === 'gameEnd') {
    const value = terminalValues(state)[root];
    return { score: value, rows: 0, wall: 0, floor: 0, marker: 0, total: value };
  }
  const values = state.players.map((board) => boardValue(board));
  return breakdownFrom(values, root);
}

/** 一次搜索复用一个评估器；当前实现无内部缓冲，保留工厂签名便于后续引入查表 */
export function createEvaluator(): {
  evaluateAll: (state: GameState) => number[];
  breakdownOf: (state: GameState, root: number) => EvaluationBreakdown;
} {
  return { evaluateAll, breakdownOf };
}
