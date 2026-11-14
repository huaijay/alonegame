import { toTrackIndex } from '../board';
import type { Seat } from '../board';
import { landingPosition } from '../rules';
import { FINISH, HOME_FIRST, PLANES_PER_PLAYER, TRACK_LAST } from '../types';
import type { GameState } from '../types';

/** 局面评估的分项得分，用于 AI 决策解释面板 */
export interface EvaluationBreakdown {
  /** 推进度：按剩余掷骰成本计算 */
  progress: number;
  /** 安全性：下次行动可能被踩回的进度损失 */
  safety: number;
  /** 进攻性：下次行动可造成的对手进度损失 */
  attack: number;
  /** 归位、安全跑道与终点骰面配合 */
  home: number;
  /** 捷径节省的预期掷骰次数 */
  boost: number;
  total: number;
}

const WIN_VALUE = 1_000_000;
const POINTS_PER_ROLL = 8;
const RIVAL_WEIGHT = 0.92;
const PRESSURE_WEIGHT = 0.8;
const POSITIONS = FINISH + 2;
const HOME_RADIX = FINISH - TRACK_LAST + 1;
const HOME_PLACE_VALUES = Array.from(
  { length: PLANES_PER_PLAYER },
  (_, plane) => HOME_RADIX ** plane,
);

/**
 * 单架飞机不断行动时到终点的期望掷骰次数。
 * 超点/未掷出起飞点数是自环；额外回合由搜索处理，此处不等同于整局胜率。
 */
function expectedRolls(landings: Int8Array | null): Float64Array {
  const costs = new Float64Array(POSITIONS);
  for (let pos = FINISH - 1; pos >= -1; pos -= 1) {
    let total = 6;
    let legalDice = 0;
    for (let dice = 1; dice <= 6; dice += 1) {
      const next = landings
        ? landings[(pos + 1) * 6 + dice - 1]
        : pos === -1 ? (dice === 6 ? 0 : -2) : pos + dice;
      if (next < 0 || next > FINISH) continue;
      total += costs[next + 1];
      legalDice += 1;
    }
    costs[pos + 1] = total / legalDice;
  }
  return costs;
}

/** 终点内多架飞机共享骰面，不能简单把每架的 6 次相加。 */
function homeRolls(): Float64Array {
  const costs = new Float64Array(HOME_RADIX ** PLANES_PER_PLAYER);
  const positions = new Int8Array(PLANES_PER_PLAYER);
  for (let key = costs.length - 2; key >= 0; key -= 1) {
    for (let plane = 0; plane < PLANES_PER_PLAYER; plane += 1) {
      positions[plane] = Math.floor(key / HOME_PLACE_VALUES[plane]) % HOME_RADIX;
    }
    let total = 6;
    let legalDice = 0;
    for (let dice = 1; dice <= 6; dice += 1) {
      let best = Number.POSITIVE_INFINITY;
      for (let plane = 0; plane < PLANES_PER_PLAYER; plane += 1) {
        if (positions[plane] + dice >= HOME_RADIX) continue;
        best = Math.min(best, costs[key + dice * HOME_PLACE_VALUES[plane]]);
      }
      if (best === Number.POSITIVE_INFINITY) continue;
      total += best;
      legalDice += 1;
    }
    costs[key] = total / legalDice;
  }
  return costs;
}

const PLAIN_COSTS = expectedRolls(null);
const HOME_COSTS = homeRolls();

/** 规则相关计算只在模块加载时执行，搜索叶子直接查表。 */
const POSITION_VALUES = Array.from({ length: 4 }, (_, seatIndex) => {
  const seat = seatIndex as Seat;
  const landings = new Int8Array(POSITIONS * 6);
  const targets = new Int8Array(POSITIONS * 6).fill(-1);
  const trackIndices = new Int8Array(POSITIONS).fill(-1);

  for (let pos = -1; pos <= FINISH; pos += 1) {
    if (pos >= 0 && pos <= TRACK_LAST) trackIndices[pos + 1] = toTrackIndex(seat, pos);
    for (let dice = 1; dice <= 6; dice += 1) {
      const offset = (pos + 1) * 6 + dice - 1;
      const next = landingPosition(seat, pos, dice);
      landings[offset] = next;
      if (next >= 0 && next <= TRACK_LAST) targets[offset] = toTrackIndex(seat, next);
    }
  }

  const costs = expectedRolls(landings);
  const progress = new Float64Array(POSITIONS);
  const boost = new Float64Array(POSITIONS);
  const captureLoss = new Float64Array(POSITIONS);
  for (let pos = -1; pos <= FINISH; pos += 1) {
    const index = pos + 1;
    progress[index] = (PLAIN_COSTS[0] - PLAIN_COSTS[index]) * POINTS_PER_ROLL;
    boost[index] = (PLAIN_COSTS[index] - costs[index]) * POINTS_PER_ROLL;
    if (pos >= 0 && pos <= TRACK_LAST) {
      captureLoss[index] = (costs[0] - costs[index]) * POINTS_PER_ROLL;
    }
  }

  return { progress, boost, captureLoss, targets, trackIndices };
});

interface EvaluationFeatures {
  players: number;
  progress: Float64Array;
  home: Float64Array;
  boost: Float64Array;
  incoming: Float64Array;
  outgoing: Float64Array;
}

interface EvaluationWorkspace extends EvaluationFeatures {
  components: Float64Array;
  capturable: Float64Array;
  trackLoss: Float64Array;
  occupants: Uint16Array;
  tracks: Int8Array;
  losses: Float64Array;
  targetOffsets: Uint16Array;
  bestTargets: Int8Array;
}

function createWorkspace(): EvaluationWorkspace {
  const players = POSITION_VALUES.length;
  const planes = players * PLANES_PER_PLAYER;
  const components = new Float64Array(players * 6);
  return {
    players: 0,
    components,
    progress: components.subarray(0, players),
    home: components.subarray(players, players * 2),
    boost: components.subarray(players * 2, players * 3),
    incoming: components.subarray(players * 3, players * 4),
    outgoing: components.subarray(players * 4, players * 5),
    capturable: components.subarray(players * 5),
    trackLoss: new Float64Array(TRACK_LAST + 1),
    occupants: new Uint16Array(TRACK_LAST + 1),
    tracks: new Int8Array(planes),
    losses: new Float64Array(planes),
    targetOffsets: new Uint16Array(planes),
    bestTargets: new Int8Array(PLANES_PER_PLAYER),
  };
}

/** 缓冲区归一次搜索所有，每个叶子只清空/覆写，返回的评分不会引用这些缓冲区。 */
function featuresOf(state: GameState, workspace: EvaluationWorkspace): EvaluationFeatures {
  const players = state.seats.length;
  const {
    components, progress, home, boost, incoming, outgoing, capturable,
    trackLoss, occupants, tracks, losses, targetOffsets, bestTargets,
  } = workspace;
  workspace.players = players;
  components.fill(0);
  trackLoss.fill(0);
  occupants.fill(0);

  for (let player = 0; player < players; player += 1) {
    const table = POSITION_VALUES[state.seats[player]];
    let homeKey = 0;
    let homePlanes = 0;
    for (let plane = 0; plane < PLANES_PER_PLAYER; plane += 1) {
      const pos = state.planes[player][plane];
      const index = pos + 1;
      const flat = player * PLANES_PER_PLAYER + plane;
      progress[player] += table.progress[index];
      boost[player] += table.boost[index];
      if (pos === FINISH) home[player] += 24;
      else if (pos >= HOME_FIRST) home[player] += 4;

      const homePos = pos >= TRACK_LAST ? pos : FINISH;
      homeKey += (homePos - TRACK_LAST) * HOME_PLACE_VALUES[plane];
      if (homePos < FINISH) homePlanes += 1;

      const track = table.trackIndices[index];
      tracks[flat] = track;
      losses[flat] = table.captureLoss[index];
      targetOffsets[flat] = index * 6;
      if (track >= 0) {
        trackLoss[track] += losses[flat];
        capturable[player] += losses[flat];
        occupants[track] |= 1 << flat;
      }
    }
    // 混合局面只修正终点子集的骰面配合，场外飞机仍按单架成本估算。
    home[player] += (homePlanes * 6 - HOME_COSTS[homeKey]) * POINTS_PER_ROLL;
  }

  for (let attacker = 0; attacker < players; attacker += 1) {
    const table = POSITION_VALUES[state.seats[attacker]];
    const first = attacker * PLANES_PER_PLAYER;
    const last = first + PLANES_PER_PLAYER;
    const ownMask = ((1 << PLANES_PER_PLAYER) - 1) << first;
    // 临时移除本方损失，使同格友机不会被算成可踩目标。
    for (let plane = first; plane < last; plane += 1) {
      if (tracks[plane] >= 0) trackLoss[tracks[plane]] -= losses[plane];
    }

    for (let dice = 0; dice < 6; dice += 1) {
      let bestLoss = 0;
      let bestCount = 0;
      for (let plane = first; plane < last; plane += 1) {
        const target = table.targets[targetOffsets[plane] + dice];
        if (target < 0) continue;
        const loss = trackLoss[target];
        if (loss <= 1e-9 || loss < bestLoss - 1e-9) continue;
        if (loss > bestLoss + 1e-9) {
          bestLoss = loss;
          bestCount = 0;
        }
        let duplicate = false;
        for (let i = 0; i < bestCount; i += 1) {
          if (bestTargets[i] === target) duplicate = true;
        }
        if (!duplicate) bestTargets[bestCount++] = target;
      }
      if (bestCount === 0) continue;

      // 一次掷骰只能选择一个落点；等值目标均分，避免飞机编号影响估值。
      outgoing[attacker] += bestLoss / 6;
      let victims = 0;
      for (let i = 0; i < bestCount; i += 1) victims |= occupants[bestTargets[i]];
      victims &= ~ownMask;
      while (victims !== 0) {
        const bit = victims & -victims;
        const plane = 31 - Math.clz32(bit);
        const defender = Math.floor(plane / PLANES_PER_PLAYER);
        // 按玩家/飞机原顺序累加，保持与逐个检查落点的评分完全一致。
        incoming[defender] += losses[plane] / (6 * bestCount);
        victims ^= bit;
      }
    }

    for (let plane = first; plane < last; plane += 1) {
      if (tracks[plane] >= 0) trackLoss[tracks[plane]] += losses[plane];
    }
  }

  for (let player = 0; player < players; player += 1) {
    incoming[player] = Math.min(incoming[player], capturable[player]);
  }
  return workspace;
}

function breakdownFrom(features: EvaluationFeatures, root: number): EvaluationBreakdown {
  const rivals = features.players - 1;
  const rivalWeight = rivals > 0 ? RIVAL_WEIGHT / rivals : 0;
  let progress = features.progress[root];
  let home = features.home[root];
  let boost = features.boost[root];
  for (let player = 0; player < features.players; player += 1) {
    if (player === root) continue;
    progress -= features.progress[player] * rivalWeight;
    home -= features.home[player] * rivalWeight;
    boost -= features.boost[player] * rivalWeight;
  }

  const safety = -PRESSURE_WEIGHT * features.incoming[root];
  const attack = PRESSURE_WEIGHT * rivalWeight * features.outgoing[root];
  return { progress, safety, attack, home, boost, total: progress + safety + attack + home + boost };
}

function valuesOf(state: GameState, workspace?: EvaluationWorkspace): number[] {
  if (state.winner !== null) {
    return state.seats.map((seat) => seat === state.winner ? WIN_VALUE : -WIN_VALUE);
  }
  const features = featuresOf(state, workspace ?? createWorkspace());
  return state.seats.map((_, player) => breakdownFrom(features, player).total);
}

function breakdownWith(
  state: GameState,
  root: number,
  workspace?: EvaluationWorkspace,
): EvaluationBreakdown {
  if (state.winner !== null) {
    const value = state.winner === state.seats[root] ? WIN_VALUE : -WIN_VALUE;
    return { progress: 0, safety: 0, attack: 0, home: value, boost: 0, total: value };
  }
  return breakdownFrom(featuresOf(state, workspace ?? createWorkspace()), root);
}

/** 一次搜索复用一个评估器，避免每个叶子重新分配棋盘缓冲区。 */
export function createEvaluator(): {
  evaluateAll: (state: GameState) => number[];
  breakdownOf: (state: GameState, root: number) => EvaluationBreakdown;
} {
  const workspace = createWorkspace();
  return {
    evaluateAll: (state) => valuesOf(state, workspace),
    breakdownOf: (state, root) => breakdownWith(state, root, workspace),
  };
}

/** 所有玩家的收益向量；对手在自己的回合最大化自己的分量。 */
export function evaluateAll(state: GameState): number[] {
  return valuesOf(state);
}

/** 当前局面的分项解释，终局总分与搜索使用的分值保持一致。 */
export function breakdownOf(state: GameState, root: number): EvaluationBreakdown {
  return breakdownWith(state, root);
}

/** 从 root 玩家视角评估局面。 */
export function evaluate(state: GameState, root: number): number {
  return breakdownWith(state, root).total;
}
