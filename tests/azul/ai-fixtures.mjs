/**
 * 花砖物语 AI 测试夹具：手工构造可控的完整局面，
 * 避免依赖随机开局导致搜索测试口径漂移。
 *
 * 玩家板简写：
 * - rows[i] = [color, count]，缺省为空行
 * - wall = 5×5 的 0/1 矩阵，缺省全空
 * - floor = 砖色数组，marker 表示是否持有首玩家标记
 */

/** 构造单个玩家板 */
function player({ score = 0, rows = [], wall = [], floor = [], marker = false } = {}) {
  return {
    score,
    rows: Array.from({ length: 5 }, (_, i) => {
      const row = rows[i];
      return { color: row ? row[0] : null, count: row ? row[1] : 0 };
    }),
    wall: Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => Boolean(wall[r]?.[c])),
    ),
    floor: [...floor],
    hasFirstMarker: marker,
  };
}

/**
 * 构造完整对局状态
 *
 * @param options factories 为五色计数数组列表（长度 = factoryCount），
 *                其余字段与 GameState 一一对应，缺省取合法默认值
 */
export function makeState({
  seats = [0, 2],
  factoryCount = 5,
  factories = [],
  center = [0, 0, 0, 0, 0],
  centerMarker = false,
  players = [],
  current = 0,
  round = 3,
  bag = [6, 6, 6, 6, 6],
  discard = [4, 4, 4, 4, 4],
  phase = 'placing',
  firstPlayer = null,
  winner = null,
} = {}) {
  return {
    seats: [...seats],
    factoryCount,
    factories: Array.from({ length: factoryCount }, (_, i) => {
      const plate = factories[i] ?? [0, 0, 0, 0, 0];
      return [...plate];
    }),
    center: [...center],
    centerMarker,
    players: Array.from({ length: seats.length }, (_, i) => player(players[i])),
    current,
    round,
    bag: [...bag],
    discard: [...discard],
    phase,
    winner,
    firstPlayer,
  };
}

/** 夹具 1：2 人局，当前玩家有一步满行可上墙，中央区含首标记 */
export const fixtureRow = makeState({
  factories: [
    [2, 1, 1, 0, 0],
    [0, 2, 0, 2, 0],
    [1, 0, 2, 1, 0],
    [0, 1, 0, 2, 1],
    [0, 0, 1, 0, 3],
  ],
  center: [1, 0, 0, 1, 0],
  centerMarker: true,
  players: [
    {
      score: 2,
      rows: [[1, 2], [0, 3]],
      wall: [[true, false, false, false, false]],
    },
    {},
  ],
  current: 0,
  round: 4,
});

/** 夹具 2：2 人局，当前玩家持首标记且地板已有 3 块砖，图例试探弃置取舍 */
export const fixtureFloor = makeState({
  factories: [
    [0, 3, 1, 0, 0],
    [1, 0, 0, 3, 0],
    [0, 0, 2, 0, 2],
    [2, 0, 0, 0, 2],
    [1, 1, 1, 1, 0],
  ],
  center: [0, 2, 1, 0, 1],
  centerMarker: true,
  players: [
    {
      score: 10,
      rows: [[null, 0], [3, 1]],
      floor: [0, 0, 2],
      marker: true,
    },
    {
      score: 6,
      rows: [[0, 1]],
      wall: [[false, true, false, false, false]],
    },
  ],
  current: 1,
  round: 6,
});

/** 夹具 3：4 人局，供应充足，用于多人 Max-n 分量验证 */
export const fixtureFour = makeState({
  seats: [0, 1, 2, 3],
  factoryCount: 9,
  factories: [
    [1, 1, 1, 1, 0], [0, 2, 1, 0, 1], [1, 0, 0, 2, 1], [0, 1, 2, 0, 1],
    [2, 0, 1, 1, 0], [0, 1, 0, 2, 1], [1, 2, 0, 0, 1], [1, 0, 1, 1, 1],
    [0, 1, 1, 1, 1],
  ],
  center: [2, 0, 1, 0, 0],
  centerMarker: false,
  players: [
    { score: 5, rows: [[0, 2]] },
    { score: 3, rows: [[2, 1]] },
    { score: 7, rows: [[1, 3]] },
    { score: 1, rows: [[4, 1]] },
  ],
  current: 2,
  round: 5,
});

/** 夹具 4：轮末已结算局面，用于 startNextRound 与耗尽终局测试 */
export const fixtureRoundEnd = makeState({
  factories: [],
  center: [0, 0, 0, 0, 0],
  centerMarker: false,
  players: [
    { score: 8, wall: [[true, false, false, false, false]] },
    { score: 4 },
  ],
  current: 1,
  round: 7,
  bag: [2, 2, 2, 2, 2],
  discard: [1, 1, 1, 1, 1],
  phase: 'roundEnd',
  firstPlayer: 1,
});

export const fixtures = [
  { state: fixtureRow, name: 'row' },
  { state: fixtureFloor, name: 'floor' },
  { state: fixtureFour, name: 'four' },
];
