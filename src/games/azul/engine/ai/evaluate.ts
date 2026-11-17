import { floorPenalty, rowCapacity, wallColOf } from '../board';
import { endgameBonus, scoreForCell } from '../rules';
import { FACTORY_TILES, TILE_COLORS, WALL_SIZE } from '../types';
import type { GameState, PlayerBoard, TileColor } from '../types';

/** 局面评估的分项得分，用于 AI 决策解释面板。 */
export interface EvaluationBreakdown {
  /** 已入账分数；合成总分时乘以 SCORE_WEIGHT。 */
  score: number;
  /** 已满图案行的准确上墙收益，以及未满行的折扣潜力。 */
  rows: number;
  /** 投影墙的终局加分与后续结构价值。 */
  wall: number;
  /** 按当前分数触底后的地板罚分；合成总分时乘以 SCORE_WEIGHT。 */
  floor: number;
  /** 本轮确定的下轮先手价值。 */
  marker: number;
  total: number;
}

/** 终局胜负分值，按规则给出的 winner 判断，包括同分裁决。 */
export const WIN_VALUE = 1_000_000;

// 实际得分与待结算得分使用同一尺度，避免把一整行收益压成几分填充奖励。
const SCORE_WEIGHT = 10;
const RIVAL_WEIGHT = 0.85;
// 先手只有一小份机会价值，不能抵消确定的上墙得分或地板损失。
const MARKER_BONUS = 1.6;

interface PartialRowValue {
  color: TileColor;
  missing: number;
  fill: number;
  score: number;
  bonus: number;
}

/** 只由不可变玩家板决定；供应、轮次与先手不进入这份缓存。 */
interface BoardValue {
  board: PlayerBoard | null;
  score: number;
  rows: number;
  wall: number;
  floor: number;
  finalRound: boolean;
  floorColors: Uint8Array;
  partialRows: PartialRowValue[];
  partialCount: number;
}

interface EvaluationWorkspace {
  players: number;
  components: Float64Array;
  score: Float64Array;
  rows: Float64Array;
  wall: Float64Array;
  floor: Float64Array;
  marker: Float64Array;
  supply: Float64Array;
  reserve: Float64Array;
  bonusPotential: Float64Array;
  perspective: Float64Array;
  projection: { wall: boolean[][] };
  boards: BoardValue[];
}

function createWorkspace(): EvaluationWorkspace {
  const maxPlayers = 4;
  const components = new Float64Array(maxPlayers * 5);
  return {
    players: 0,
    components,
    score: components.subarray(0, maxPlayers),
    rows: components.subarray(maxPlayers, maxPlayers * 2),
    wall: components.subarray(maxPlayers * 2, maxPlayers * 3),
    floor: components.subarray(maxPlayers * 3, maxPlayers * 4),
    marker: components.subarray(maxPlayers * 4),
    supply: new Float64Array(TILE_COLORS),
    reserve: new Float64Array(TILE_COLORS),
    bonusPotential: new Float64Array(TILE_COLORS),
    perspective: new Float64Array(5),
    projection: {
      wall: Array.from({ length: WALL_SIZE }, () => new Array<boolean>(WALL_SIZE).fill(false)),
    },
    // 深度优先搜索的相邻叶子通常只变一块玩家板；每个玩家保留一个可复用槽。
    boards: Array.from({ length: maxPlayers }, () => ({
      board: null,
      score: 0,
      rows: 0,
      wall: 0,
      floor: 0,
      finalRound: false,
      floorColors: new Uint8Array(TILE_COLORS),
      partialRows: Array.from({ length: WALL_SIZE }, () => ({
        color: 0 as TileColor,
        missing: 0,
        fill: 0,
        score: 0,
        bonus: 0,
      })),
      partialCount: 0,
    })),
  };
}

/** 复用该玩家上次板面投影，引用改变时直接覆写固定槽位，不保留搜索中间板。 */
function boardValue(board: PlayerBoard, player: number, workspace: EvaluationWorkspace): BoardValue {
  const value = workspace.boards[player];
  if (value.board === board) return value;

  const projection = workspace.projection;
  const projected = projection.wall;
  for (let row = 0; row < WALL_SIZE; row += 1) {
    for (let col = 0; col < WALL_SIZE; col += 1) projected[row][col] = board.wall[row][col];
  }

  let rows = 0;
  // 按真实结算的行顺序投影，后上墙的砖能利用前面新建立的连接。
  for (let row = 0; row < WALL_SIZE; row += 1) {
    const pattern = board.rows[row];
    if (pattern.color === null || pattern.count < rowCapacity(row)) continue;
    const col = wallColOf(row, pattern.color);
    projected[row][col] = true;
    rows += scoreForCell(projected, row, col) * SCORE_WEIGHT;
  }

  const bonus = endgameBonus(projection).total;
  let wall = bonus * SCORE_WEIGHT;
  let finalRound = false;
  for (let row = 0; row < WALL_SIZE; row += 1) {
    let filled = 0;
    for (let col = 0; col < WALL_SIZE; col += 1) {
      if (!projected[row][col]) continue;
      filled += 1;
      // 很小的结构修正，只表达连片墙为后续砖提供的连接机会。
      wall += 0.25;
      if (col + 1 < WALL_SIZE && projected[row][col + 1]) wall += 0.4;
      if (row + 1 < WALL_SIZE && projected[row + 1][col]) wall += 0.4;
    }
    if (filled === WALL_SIZE) finalRound = true;
  }

  value.partialCount = 0;
  for (let row = 0; row < WALL_SIZE; row += 1) {
    const pattern = board.rows[row];
    const capacity = rowCapacity(row);
    if (pattern.color === null || pattern.count === 0 || pattern.count >= capacity) continue;
    const color = pattern.color;
    const col = wallColOf(row, color);
    const gained = scoreForCell(projected, row, col) * SCORE_WEIGHT;
    const occupied = projected[row][col];
    projected[row][col] = true;
    const bonusGain = endgameBonus(projection).total - bonus;
    projected[row][col] = occupied;
    const partial = value.partialRows[value.partialCount++];
    partial.color = color;
    partial.missing = capacity - pattern.count;
    partial.fill = pattern.count / capacity;
    partial.score = gained;
    partial.bonus = bonusGain;
  }

  value.floorColors.fill(0);
  for (const color of board.floor) value.floorColors[color] += 1;
  value.board = board;
  value.score = board.score;
  value.rows = rows;
  value.wall = wall;
  // 项目规则先扣地板、最低归零，再处理上墙收益。
  value.floor = Math.max(-board.score, floorPenalty(board.floor.length));
  value.finalRound = finalRound;
  return value;
}

/** 只重算供给相关潜力；未满行不依靠一套虚构的未来工厂盘。 */
function collectFeatures(state: GameState, workspace: EvaluationWorkspace): void {
  const { score, rows, wall, floor, marker, supply, reserve, boards } = workspace;
  workspace.players = state.players.length;
  workspace.components.fill(0);
  supply.fill(0);
  reserve.fill(0);
  for (let color = 0; color < TILE_COLORS; color += 1) {
    supply[color] = state.center[color];
    reserve[color] = state.bag[color] + state.discard[color];
  }
  for (const plate of state.factories) {
    for (let color = 0; color < TILE_COLORS; color += 1) supply[color] += plate[color];
  }

  let finalRound = false;
  for (let player = 0; player < state.players.length; player += 1) {
    const features = boardValue(state.players[player], player, workspace);
    score[player] = features.score;
    rows[player] = features.rows;
    wall[player] = features.wall;
    floor[player] = features.floor;
    if (features.finalRound) finalRound = true;
    for (let color = 0; color < TILE_COLORS; color += 1) reserve[color] += features.floorColors[color];
  }

  if (state.phase === 'roundEnd') {
    // 轮末只估算补盘的颜色期望，不为搜索制造一套确定的未来工厂盘。
    let total = 0;
    for (const count of reserve) total += count;
    const drawn = Math.min(total, state.factoryCount * FACTORY_TILES);
    for (let color = 0; color < TILE_COLORS; color += 1) {
      supply[color] = total > 0 ? drawn * reserve[color] / total : 0;
    }
  }

  for (let player = 0; player < state.players.length; player += 1) {
    const potentials = workspace.bonusPotential;
    potentials.fill(0);
    for (let row = 0; row < boards[player].partialCount; row += 1) {
      const partial = boards[player].partialRows[row];
      const coverage = Math.min(1, supply[partial.color] / partial.missing);
      // 未满行可带入以后轮次，但最终轮不能依靠不存在的后续供应。
      const carry = !finalRound && reserve[partial.color] > 0 ? 0.25 : 0;
      const completion = partial.fill * (carry + (1 - carry) * coverage);
      if (completion === 0) continue;
      rows[player] += partial.score * completion;
      // 同色的多条半成品行不能反复预支同一份终局色彩奖励。
      potentials[partial.color] = Math.max(potentials[partial.color], partial.bonus * completion);
    }
    for (const potential of potentials) wall[player] += potential * SCORE_WEIGHT;
    if (!finalRound && (state.players[player].hasFirstMarker || state.firstPlayer === player)) {
      marker[player] = MARKER_BONUS;
    }
  }
}

/** 同一算术顺序同时服务收益向量与解释面板，避免浮点舍入改变同分行动。 */
function perspectiveValue(workspace: EvaluationWorkspace, root: number): number {
  const rivalWeight = workspace.players > 1 ? RIVAL_WEIGHT / (workspace.players - 1) : 0;
  let score = workspace.score[root];
  let rows = workspace.rows[root];
  let wall = workspace.wall[root];
  let floor = workspace.floor[root];
  let marker = workspace.marker[root];
  for (let player = 0; player < workspace.players; player += 1) {
    if (player === root) continue;
    score -= workspace.score[player] * rivalWeight;
    rows -= workspace.rows[player] * rivalWeight;
    wall -= workspace.wall[player] * rivalWeight;
    floor -= workspace.floor[player] * rivalWeight;
    marker -= workspace.marker[player] * rivalWeight;
  }
  workspace.perspective[0] = score;
  workspace.perspective[1] = rows;
  workspace.perspective[2] = wall;
  workspace.perspective[3] = floor;
  workspace.perspective[4] = marker;
  return score * SCORE_WEIGHT + rows + wall + floor * SCORE_WEIGHT + marker;
}

function valuesWith(state: GameState, workspace: EvaluationWorkspace): number[] {
  if (state.phase === 'gameEnd') {
    return state.seats.map((seat) => seat === state.winner ? WIN_VALUE : -WIN_VALUE);
  }
  collectFeatures(state, workspace);
  const values = new Array<number>(state.players.length);
  for (let player = 0; player < values.length; player += 1) {
    values[player] = perspectiveValue(workspace, player);
  }
  return values;
}

function breakdownWith(state: GameState, root: number, workspace: EvaluationWorkspace): EvaluationBreakdown {
  if (state.phase === 'gameEnd') {
    const value = state.seats[root] === state.winner ? WIN_VALUE : -WIN_VALUE;
    return { score: value, rows: 0, wall: 0, floor: 0, marker: 0, total: value };
  }
  collectFeatures(state, workspace);
  const total = perspectiveValue(workspace, root);
  const values = workspace.perspective;
  return { score: values[0], rows: values[1], wall: values[2], floor: values[3], marker: values[4], total };
}

/**
 * 计算所有玩家的收益，供 Max-n 为当前行动方选择走法。
 *
 * @param state 待评估局面，包括已结算但尚未补盘的轮末局面
 * @returns 按玩家序号排列的独立评分数组
 */
export function evaluateAll(state: GameState): number[] {
  return valuesWith(state, createWorkspace());
}

/**
 * 计算指定玩家视角的分项解释。
 *
 * @param state 待评估局面
 * @param root 视角玩家序号
 * @returns 分项与总分；终局按 winner 座位给出胜负分
 */
export function breakdownOf(state: GameState, root: number): EvaluationBreakdown {
  return breakdownWith(state, root, createWorkspace());
}

/**
 * 创建一次搜索专用的估值器，复用投影墙与分项缓冲区。
 *
 * @returns 独立的评估器；每次返回的评分和解释均不引用内部缓冲区
 */
export function createEvaluator(): {
  evaluateAll: (state: GameState) => number[];
  breakdownOf: (state: GameState, root: number) => EvaluationBreakdown;
} {
  const workspace = createWorkspace();
  return {
    evaluateAll: (state) => valuesWith(state, workspace),
    breakdownOf: (state, root) => breakdownWith(state, root, workspace),
  };
}
