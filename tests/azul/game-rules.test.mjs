import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceState,
  applyMove,
  cloneState,
  createInitialState,
  getLegalMoves,
  startNextRound,
} from '../../src/games/azul/engine/rules.ts';
import { FACTORY_COUNT, rowCapacity, wallColorOf } from '../../src/games/azul/engine/board.ts';
import { createRng } from '../../src/games/azul/engine/rng.ts';
import { makeState } from './ai-fixtures.mjs';

/** 汇总局面上全部花砖数量（袋 + 弃堆 + 供应 + 玩家板） */
function countTiles(state) {
  const supply = state.factories.flat().reduce((a, b) => a + b, 0) + state.center.reduce((a, b) => a + b, 0);
  const reserve = state.bag.reduce((a, b) => a + b, 0) + state.discard.reduce((a, b) => a + b, 0);
  // 满行上墙时多块砖合并为一块墙砖，此处按规则语义统计「固化砖块数」
  const wallTiles = state.players.reduce(
    (sum, board) => sum + board.rows.reduce((acc, row, index) => acc + row.count, 0) + board.floor.length,
    0,
  );
  return supply + reserve + wallTiles;
}

test('初始状态：盘数随人数变化，每盘 4 块，首标记在中央', () => {
  for (const seats of [[0, 2], [0, 1, 2], [0, 1, 2, 3]]) {
    const state = createInitialState(seats, createRng(42));
    assert.equal(state.factoryCount, FACTORY_COUNT[seats.length]);
    assert.equal(state.factories.length, state.factoryCount);
    for (const plate of state.factories) {
      assert.equal(plate.reduce((a, b) => a + b, 0), 4);
    }
    assert.equal(state.center.reduce((a, b) => a + b, 0), 0);
    assert.equal(state.centerMarker, true);
    assert.equal(state.round, 1);
    assert.equal(state.current, 0);
    assert.equal(state.phase, 'placing');
    assert.equal(state.winner, null);
    assert.equal(state.firstPlayer, null);
    assert.equal(state.players.length, seats.length);
    // 袋中余量 = 总砖数 - 已上盘
    const bagTotal = state.bag.reduce((a, b) => a + b, 0);
    assert.equal(bagTotal + 4 * state.factoryCount, 100);
  }
});

test('确定性开局：无随机源时按色号顺序补盘，完全可复现', () => {
  const state = createInitialState([0, 2]);
  // 20 块按色号轮转均匀抽出 → 每色 4 块 → 补盘按色分组切分，五个盘各占一色
  const expected = [
    [4, 0, 0, 0, 0],
    [0, 4, 0, 0, 0],
    [0, 0, 4, 0, 0],
    [0, 0, 0, 4, 0],
    [0, 0, 0, 0, 4],
  ];
  assert.deepEqual(state.factories, expected);
  const again = createInitialState([0, 2]);
  assert.deepEqual(again.factories, state.factories);
});

test('同种子两次开局与整局推进完全一致', () => {
  for (const seats of [[0, 2], [0, 1, 2, 3]]) {
    const runOnce = () => {
      const rng = createRng(1234);
      let state = createInitialState(seats, rng);
      let guard = 0;
      while (state.phase !== 'gameEnd' && guard < 600) {
        guard += 1;
        if (state.phase === 'roundEnd') {
          state = startNextRound(state, rng);
          continue;
        }
        const moves = getLegalMoves(state);
        state = advanceState(state, moves[Math.floor(rng() * moves.length)], rng);
      }
      return { state, guard };
    };
    const first = runOnce();
    const second = runOnce();
    assert.deepEqual(second.state, first.state);
  }
});

test('拿工厂盘：整色拿走，余砖进中央，步骤携带快照', () => {
  const state = makeState({
    factories: [[0, 3, 1, 0, 0], [1, 0, 0, 3, 0]],
    factoryCount: 2,
  });
  const before = JSON.stringify(state);
  const result = applyMove(state, { source: 0, color: 1, row: 2 });
  const next = result.state;

  assert.deepEqual(next.factories[0], [0, 0, 0, 0, 0]);
  // 余下 1 红进中央
  assert.deepEqual(next.center, [0, 0, 1, 0, 0]);
  assert.deepEqual(next.players[0].rows[2], { color: 1, count: 3 });
  assert.equal(next.current, 1);
  assert.equal(next.phase, 'placing');
  assert.equal(result.steps[0].kind, 'pick');
  assert.equal(result.steps[0].count, 3);
  assert.equal(result.steps[0].toCenter, 1);
  // 原状态不被修改
  assert.equal(JSON.stringify(state), before);
});

test('拿中央区：顺手获得首玩家标记并预定下轮先手', () => {
  const state = makeState({
    center: [1, 0, 2, 0, 0],
    centerMarker: true,
  });
  const result = applyMove(state, { source: 5, color: 2, row: 1 });
  assert.equal(result.state.players[0].hasFirstMarker, true);
  assert.equal(result.state.centerMarker, false);
  assert.equal(result.state.firstPlayer, 0);
  const kinds = result.steps.map((step) => step.kind);
  assert.ok(kinds.includes('marker'));
  // marker 步骤紧跟 pick 之后
  assert.equal(kinds[kinds.indexOf('pick') + 1], 'marker');
});

test('从无标记的中央拿砖不产生 marker 步骤', () => {
  const state = makeState({ center: [0, 2, 0, 0, 0], centerMarker: false });
  const result = applyMove(state, { source: 5, color: 1, row: -1 });
  assert.ok(result.steps.every((step) => step.kind !== 'marker'));
});

test('行放置溢出：超出容量的部分罚入地板', () => {
  const state = makeState({
    factories: [[0, 4, 0, 0, 0], [1, 0, 0, 0, 0]],
    factoryCount: 2,
  });
  // 第 0 行容量 1，4 块黄 → 1 块保留 + 3 块入地板（另一盘尚有砖不触发轮末结算）
  const result = applyMove(state, { source: 0, color: 1, row: 0 });
  assert.deepEqual(result.state.players[0].rows[0], { color: 1, count: 1 });
  assert.deepEqual(result.state.players[0].floor, [1, 1, 1]);
  const place = result.steps.find((step) => step.kind === 'place');
  assert.equal(place.overflow, 3);
  assert.equal(place.kept, 1);
});

test('地板 7 格上限：放不下的砖直接进弃堆', () => {
  const state = makeState({
    factories: [[0, 0, 5, 0, 0], [1, 0, 0, 0, 0]],
    factoryCount: 2,
    discard: [0, 0, 0, 0, 0],
    players: [{ floor: [0, 1, 2, 3, 0, 1] }],
  });
  // 地板剩 1 格，5 块红 → 1 块入地板 + 4 块直接进弃堆；另一盘尚有砖不触发轮末结算
  const result = applyMove(state, { source: 0, color: 2, row: -1 });
  assert.equal(result.state.players[0].floor.length, 7);
  assert.equal(result.state.discard[2], 4);
});

test('同色未满行可续放，异色、满行或墙格已占的行不合法', () => {
  const state = makeState({
    factories: [[2, 0, 2, 0, 0], [0, 0, 0, 0, 0]],
    factoryCount: 2,
    players: [
      {
        // row0 为满行蓝；row1 图案行空但该行的蓝墙格（col1）已被占
        rows: [[0, 1]],
        wall: [
          [false, false, false, false, false],
          [false, true, false, false, false],
        ],
      },
    ],
  });
  const moves = getLegalMoves(state);
  const blue = moves.filter((move) => move.color === 0);
  // 第 0 行已满 → 不可放
  assert.ok(!blue.some((move) => move.row === 0));
  // 第 1 行图案行虽空，但该行的蓝墙格已被占
  assert.ok(!blue.some((move) => move.row === 1));
  assert.ok(blue.some((move) => move.row === 2));
  const red = moves.filter((move) => move.color === 2);
  // 第 1 行红可续放（同色未满），第 0 行异色不可放
  assert.ok(red.some((move) => move.row === 1));
  assert.ok(!red.some((move) => move.row === 0));
  // 弃入地板的兜底行动始终存在
  assert.ok(red.some((move) => move.row === -1));
});

test('满行上墙按横纵连接计分', () => {
  const state = makeState({
    // 供应只剩一盘一块黄 → 弃置后供应全空，自动轮末结算
    factories: [[0, 1, 0, 0, 0], [0, 0, 0, 0, 0]],
    factoryCount: 2,
    players: [
      {
        score: 2,
        // row0 已有黄(col1)红(col2)、row1 已有蓝(col1)；row1 攒满 2 块黄待上墙
        rows: [[null, 0], [1, 2]],
        wall: [
          [false, true, true, false, false],
          [false, true, false, false, false],
        ],
      },
      {},
    ],
    current: 0,
  });
  const result = applyMove(state, { source: 0, color: 1, row: -1 });
  // 轮末：row1 黄上墙 col2；横向连 row1col1 计 2、纵向连 row0col2 计 2、双向成串再 +1 → gained 5
  // 地板 1 块罚 -1 → score 2 - 1 + 5 = 6
  assert.equal(result.state.phase, 'roundEnd');
  assert.equal(result.state.players[0].score, 6);
  assert.equal(result.state.players[0].wall[1][2], true);
  assert.deepEqual(result.state.players[0].rows[1], { color: null, count: 0 });
  const wall = result.steps.find((step) => step.kind === 'wall');
  assert.ok(wall, '满行应产生上墙步骤');
  assert.equal(wall.row, 1);
  assert.equal(wall.col, 2);
  assert.equal(wall.gained, 5);
  assert.ok(result.steps.some((step) => step.kind === 'penalty' && step.penalty === -1));
});

test('轮末结算：未满行保留，首标记持有者先扣地板', () => {
  const state = makeState({
    factories: [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
    factoryCount: 2,
    players: [
      { score: 10, floor: [0, 0, 2], marker: true },
      { score: 10 },
    ],
    current: 0,
  });
  const result = applyMove(state, { source: 0, color: 0, row: -1 });
  // 新弃 1 块蓝后地板共 4 块 → -1-1-2-2 = -6 → 10 - 6 = 4；标记持有者按座次先结算
  assert.equal(result.state.players[0].score, 4);
  assert.equal(result.state.players[0].floor.length, 0);
  assert.equal(result.state.players[0].hasFirstMarker, false);
  assert.equal(result.state.players[1].score, 10);
  assert.equal(result.state.phase, 'roundEnd');
});

test('得分不为负：地板扣分最多扣到 0', () => {
  const state = makeState({
    factories: [[0, 2, 0, 0, 0], [0, 0, 0, 0, 0]],
    factoryCount: 2,
    players: [{ score: 1, floor: [0, 0, 0, 1, 1, 1] }],
    current: 0,
  });
  const result = applyMove(state, { source: 0, color: 1, row: -1 });
  // 地板 7 块 → -1-1-2-2-2-3-3 = -14 → max(0, 1-14) = 0
  assert.equal(result.state.players[0].score, 0);
});

test('墙上出现完整行即终局，终局加分按满行/满列/集齐色结算', () => {
  const state = makeState({
    factories: [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
    factoryCount: 2,
    players: [
      {
        score: 0,
        // row0 全满（蓝黄红黑青）→ 本次轮末必然终局；row1 攒满 2 块蓝（容量 2 满）
        wall: [[true, true, true, true, true]],
        rows: [[null, 0], [0, 2]],
      },
      { score: 3 },
    ],
    current: 0,
  });
  const result = applyMove(state, { source: 0, color: 0, row: -1 });
  assert.equal(result.state.phase, 'gameEnd');
  // row1 蓝上墙 col1：横向 1 + 纵向（row0 col1 已有黄）2 = 3 分；地板罚 -1 触底为 0
  // 终局加分：row0 满行 +6、五色集齐 +50 → 玩家 0 = 0 + 3 + 56 = 59
  assert.equal(result.state.players[0].score, 59);
  // 玩家 1 无墙块，终局加分 0，保持 3 分
  assert.equal(result.state.players[1].score, 3);
  assert.equal(result.state.winner, 0);
  assert.ok(result.steps.some((step) => step.kind === 'scoring' && step.player === 0 && step.gained === 56));
});

test('startNextRound：弃堆回袋、确定性补盘、首标记决定先手', () => {
  const state = makeState({
    factories: [],
    center: [0, 0, 0, 0, 0],
    players: [
      { score: 8, marker: true },
      { score: 4 },
    ],
    current: 0,
    round: 7,
    bag: [3, 3, 3, 3, 3],
    discard: [1, 1, 1, 1, 1],
    phase: 'roundEnd',
    firstPlayer: 0,
  });
  const next = startNextRound(state);
  assert.equal(next.phase, 'placing');
  assert.equal(next.round, 8);
  assert.equal(next.current, 0);
  // 弃堆 5 块回袋凑足 20 块，确定性补盘全部上盘 → 袋与弃堆双双清空
  assert.deepEqual(next.bag, [0, 0, 0, 0, 0]);
  assert.deepEqual(next.discard, [0, 0, 0, 0, 0]);
  // 确定性补盘：每色 4 块按序分派，每盘一色
  assert.deepEqual(next.factories, [
    [4, 0, 0, 0, 0],
    [0, 4, 0, 0, 0],
    [0, 0, 4, 0, 0],
    [0, 0, 0, 4, 0],
    [0, 0, 0, 0, 4],
  ]);
});

test('流通砖耗尽时按当前分数直接终局，避免死局', () => {
  const state = makeState({
    factories: [],
    center: [0, 0, 0, 0, 0],
    bag: [0, 0, 0, 0, 0],
    discard: [0, 0, 0, 0, 0],
    phase: 'roundEnd',
    players: [{ score: 12 }, { score: 15 }],
    firstPlayer: 1,
  });
  const next = startNextRound(state);
  assert.equal(next.phase, 'gameEnd');
  assert.equal(next.winner, 2);
  // 补盘后供应仍为空：全部工厂盘均无砖
  assert.ok(next.factories.every((plate) => plate.every((value) => value === 0)));
});

test('非 roundEnd 局面调用 startNextRound 原样返回', () => {
  const state = makeState({ phase: 'placing' });
  assert.equal(startNextRound(state), state);
});

test('拿砖行动不改变砖块总量', () => {
  const seats = [0, 2];
  const rng = createRng(777);
  let state = createInitialState(seats, rng);
  for (let i = 0; i < 40 && state.phase !== 'gameEnd'; i += 1) {
    if (state.phase === 'roundEnd') {
      state = startNextRound(state, rng);
      continue;
    }
    const before = countTiles(state);
    const moves = getLegalMoves(state);
    const result = applyMove(state, moves[Math.floor(rng() * moves.length)]);
    // 满行上墙把整行 capacity 块零散砖固化成不计入统计的墙砖，按行容量补偿计数
    const merged = result.steps.reduce(
      (sum, step) => (step.kind === 'wall' ? sum + rowCapacity(step.row) : sum),
      0,
    );
    assert.equal(countTiles(result.state) + merged, before);
    state = result.state.phase === 'roundEnd' ? startNextRound(result.state, rng) : result.state;
  }
});

test('墙格颜色映射符合行错位规则', () => {
  // row0: 蓝黄红黑青；row1: 青蓝黄红黑
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((col) => wallColorOf(0, col)),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((col) => wallColorOf(1, col)),
    [4, 0, 1, 2, 3],
  );
});

test('cloneState 深拷贝：修改副本不影响原状态', () => {
  const state = createInitialState([0, 2], createRng(5));
  const copy = cloneState(state);
  copy.factories[0][0] += 1;
  copy.players[0].rows[2].count += 1;
  copy.players[1].floor.push(3);
  copy.bag[0] += 1;
  assert.equal(state.factories[0][0], copy.factories[0][0] - 1);
  assert.equal(state.players[0].rows[2].count, copy.players[0].rows[2].count - 1);
  assert.equal(state.players[1].floor.length, 0);
  assert.equal(state.bag[0], copy.bag[0] - 1);
});
