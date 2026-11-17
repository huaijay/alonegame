import { FINISH_INDEX } from '../../src/games/camel-up/engine/board.ts';
import { CAMEL_COUNT, LEG_TICKET_VALUES } from '../../src/games/camel-up/engine/types.ts';

/** 默认玩家状态：开局资金、五色手牌、地形块在手 */
function defaultPlayer() {
  return {
    coins: 3,
    legTickets: [],
    pyramidTickets: 0,
    hand: [0, 1, 2, 3, 4],
    desert: { pos: null, face: 'oasis' },
  };
}

/**
 * 手工构造完整局面的夹具工厂，避免随机开局漂移。
 *
 * @param overrides 覆盖字段：
 *   camels: { 格号: [自底向顶的骆驼色] }（含 FINISH_INDEX 终点线桶）
 *   players: 按玩家序号的部分字段覆盖
 *   其余 GameState 字段可直接覆盖
 * @returns 完整 GameState
 */
export function makeState(overrides = {}) {
  const { camels, players: playerOverrides, ...rest } = overrides;
  const seats = rest.seats ?? [0, 1, 2];
  const stacks = Array.from({ length: FINISH_INDEX + 1 }, () => []);
  if (camels) {
    for (const [pos, stack] of Object.entries(camels)) stacks[Number(pos)] = [...stack];
  }
  const players = seats.map((_, index) => ({
    ...defaultPlayer(),
    ...(playerOverrides?.[index] ?? {}),
  }));
  return {
    seats,
    players,
    stacks,
    legStacks: Array.from({ length: CAMEL_COUNT }, () => [...LEG_TICKET_VALUES]),
    diceRemaining: [0, 1, 2, 3, 4],
    diceValues: [null, null, null, null, null],
    pyramidRemaining: 5,
    winnerPile: [],
    loserPile: [],
    current: 0,
    leg: 1,
    phase: 'racing',
    winner: null,
    ...rest,
  };
}
