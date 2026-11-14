import { FLIGHT_OFFSET, START_INDEX, colorOfTrackIndex, flightIndex, toTrackIndex } from './board';
import type { Seat } from './board';
import { FINISH, PLANES_PER_PLAYER, TRACK_LAST } from './types';
import type {
  CaptureRef,
  GameState,
  Move,
  MoveResult,
  MoveStep,
  PlanePos,
} from './types';

/** 创建一局初始状态：所有飞机停在机库，红方先手 */
export function createInitialState(seats: Seat[]): GameState {
  return {
    seats: [...seats],
    planes: seats.map(() => Array.from({ length: PLANES_PER_PLAYER }, () => -1)),
    current: 0,
    sixStreak: 0,
    rolls: 0,
    finishedOrder: [],
    winner: null,
  };
}

/**
 * 计算当前玩家在给定骰子下的全部合法行动
 *
 * @param state 当前对局状态
 * @param dice 本次掷出的点数
 * @returns 合法行动列表；空数组表示本方无法行动
 */
export function getLegalMoves(state: GameState, dice: number): Move[] {
  const planes = state.planes[state.current];
  const moves: Move[] = [];

  // 机库内飞机等价，只需要一个起飞候选，避免 AI 分支无意义膨胀
  if (dice === 6) {
    const baseIndex = planes.findIndex((pos) => pos === -1);
    if (baseIndex >= 0) moves.push({ kind: 'launch', plane: baseIndex });
  }

  planes.forEach((pos, plane) => {
    // 归位后不再移动；进入终点跑道后必须精确点数，超出视为不可走
    if (pos >= 0 && pos < FINISH && pos + dice <= FINISH) {
      moves.push({ kind: 'advance', plane });
    }
  });

  return moves;
}

/** 只返回最终落点；-2 表示该位置和骰子不能行动。搜索和动画共用同一条路线规则。 */
export function landingPosition(seat: Seat, pos: PlanePos, dice: number): PlanePos {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) return -2;
  if (pos === -1) return dice === 6 ? 0 : -2;
  if (!Number.isInteger(pos) || pos < 0 || pos >= FINISH || pos + dice > FINISH) return -2;

  const target = pos + dice;
  if (target > TRACK_LAST) return target;
  const absolute = toTrackIndex(seat, target);
  if (absolute === flightIndex(seat) && target + FLIGHT_OFFSET <= TRACK_LAST) {
    return target + FLIGHT_OFFSET;
  }
  if (colorOfTrackIndex(absolute) === seat && target + 4 <= TRACK_LAST) return target + 4;
  return target;
}

/**
 * 结算一次行动：移动、跳跃/飞行、踩子、归位与回合流转
 *
 * @param state 行动前的对局状态
 * @param move 选定的行动
 * @param dice 本次掷出的点数
 * @returns 结算后的新状态与逐段动画步骤
 */
export function applyMove(state: GameState, move: Move, dice: number): MoveResult {
  const player = state.current;
  const seat = state.seats[player];
  const planes = state.planes.map((row) => [...row]);
  const steps: MoveStep[] = [];
  const index = move.plane;

  // 1. 基础移动：起飞 / 前进 / 进入终点跑道
  if (move.kind === 'launch') {
    planes[player][index] = 0;
    steps.push({
      plane: index,
      from: -1,
      to: 0,
      kind: 'launch',
      captures: [],
      trackIndex: toTrackIndex(seat, 0),
    });
  } else {
    const from = planes[player][index];
    const target = from + dice;
    if (target > TRACK_LAST) {
      // 先走到跑道末格，再进入终点跑道，保证动画沿格子路径推进
      if (from < TRACK_LAST) {
        steps.push({
          plane: index,
          from,
          to: TRACK_LAST,
          kind: 'walk',
          captures: [],
          trackIndex: toTrackIndex(seat, TRACK_LAST),
        });
      }
      steps.push({
        plane: index,
        from: Math.max(from, TRACK_LAST),
        to: target,
        kind: target === FINISH ? 'finish' : 'home',
        captures: [],
        trackIndex: null,
      });
    } else {
      steps.push({
        plane: index,
        from,
        to: target,
        kind: 'walk',
        captures: [],
        trackIndex: toTrackIndex(seat, target),
      });
    }
    planes[player][index] = target;
  }

  // 2. 同色格奖励：每次只结算一次，落点计算同时供 AI 搜索使用
  let resting: PlanePos = planes[player][index];
  const destination = landingPosition(seat, state.planes[player][index], dice);
  if (move.kind === 'advance' && destination > resting) {
    const from = resting;
    resting = destination;
    planes[player][index] = resting;
    steps.push({
      plane: index,
      from,
      to: resting,
      kind: resting - from === FLIGHT_OFFSET ? 'fly' : 'jump',
      captures: [],
      trackIndex: toTrackIndex(seat, resting),
    });
  }

  // 3. 落点踩子：只结算最终停留格，跳跃/飞行后的落点同样生效
  if (resting <= TRACK_LAST) {
    const absolute = toTrackIndex(seat, resting);
    const victims: CaptureRef[] = [];
    for (let p = 0; p < state.seats.length; p += 1) {
      if (p === player) continue;
      const rivalSeat = state.seats[p];
      state.planes[p].forEach((pos, rivalPlane) => {
        if (pos >= 0 && pos <= TRACK_LAST && toTrackIndex(rivalSeat, pos) === absolute) {
          planes[p][rivalPlane] = -1;
          victims.push({ player: p, plane: rivalPlane });
        }
      });
    }
    if (victims.length > 0) {
      steps[steps.length - 1].captures.push(...victims);
    }
  }

  // 4. 回合流转：掷 6 追加一次（最多三次），否则交给下一位
  const finishedAll = planes[player].every((pos) => pos === FINISH);
  let winner = state.winner;
  const finishedOrder = [...state.finishedOrder];
  if (winner === null && finishedAll) {
    winner = seat;
    finishedOrder.push(seat);
  }

  let current = player;
  let sixStreak = 0;
  let sixLimit = false;
  if (winner !== null) {
    current = player;
  } else if (dice === 6 && state.sixStreak < 2) {
    current = player;
    sixStreak = state.sixStreak + 1;
  } else {
    if (dice === 6) sixLimit = true;
    current = (player + 1) % state.planes.length;
  }

  return {
    state: {
      ...state,
      planes,
      current,
      sixStreak,
      rolls: state.rolls + 1,
      finishedOrder,
      winner,
    },
    steps,
    sixLimit,
  };
}

/**
 * 无法行动时跳过回合（不享受掷 6 追加）
 *
 * @param state 当前对局状态
 * @returns 流转到下一位玩家的新状态
 */
export function passTurn(state: GameState): GameState {
  return {
    ...state,
    current: (state.current + 1) % state.planes.length,
    sixStreak: 0,
    rolls: state.rolls + 1,
  };
}

/** 当前玩家已归位的飞机数量 */
export function finishedCount(state: GameState, player: number): number {
  return state.planes[player].filter((pos) => pos === FINISH).length;
}

/** 当前玩家的总体推进度（0-1），用于面板进度条 */
export function progressOf(state: GameState, player: number): number {
  const total = state.planes[player].reduce((sum, pos) => {
    if (pos < 0) return sum;
    return sum + Math.min(pos, FINISH) / FINISH;
  }, 0);
  return total / PLANES_PER_PLAYER;
}

/** 某座位起点格在跑道上的索引 */
export function startIndexOf(seat: Seat): number {
  return START_INDEX[seat];
}
