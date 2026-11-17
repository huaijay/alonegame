import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMove, positionKey } from '../../src/games/camel-up/engine/ai/search.ts';
import {
  breakdownOf,
  breakdownsOf,
  evaluateAll,
  WIN_VALUE,
} from '../../src/games/camel-up/engine/ai/evaluate.ts';
import {
  applyMoveState,
  getLegalMoves,
  rollOutcomes,
} from '../../src/games/camel-up/engine/rules.ts';
import { makeState } from './ai-fixtures.mjs';

/** 深冻结对象，任何写入都会在严格模式下抛错，用于只读输入检测 */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** 独立的手写深度 1 枚举（oracle）：掷骰取期望，其余行动确定结算 */
function oracleValues(state) {
  const me = state.current;
  return getLegalMoves(state).map((move) => {
    let value;
    if (move.kind === 'roll') {
      value = 0;
      for (const { outcome, prob } of rollOutcomes(state)) {
        value += prob * evaluateAll(applyMoveState(state, move, outcome))[me];
      }
    } else {
      value = evaluateAll(applyMoveState(state, move))[me];
    }
    return { move, value };
  });
}

test('非法参数被拒绝', () => {
  const state = makeState({});
  assert.throws(() => chooseMove(state, { depth: -1, budgetMs: 100, nodeBudget: 1000 }), RangeError);
  assert.throws(() => chooseMove(state, { depth: 1.5, budgetMs: 100, nodeBudget: 1000 }), RangeError);
  assert.throws(() => chooseMove(state, { depth: 1, budgetMs: NaN, nodeBudget: 1000 }), RangeError);
  assert.throws(() => chooseMove(state, { depth: 1, budgetMs: -1, nodeBudget: 1000 }), RangeError);
  assert.throws(() => chooseMove(state, { depth: 1, budgetMs: 100, nodeBudget: -1 }), RangeError);
});

test('终局局面返回 null', () => {
  const state = makeState({ phase: 'gameEnd', winner: 0 });
  assert.equal(chooseMove(state, { depth: 1, budgetMs: 100, nodeBudget: 1000 }), null);
});

test('搜索不修改输入：冻结局面可正常决策', () => {
  const state = deepFreeze(makeState({ camels: { 2: [0], 5: [1], 6: [2], 7: [3], 8: [4] } }));
  const decision = chooseMove(state, { depth: 1, budgetMs: 200, nodeBudget: 10_000 });
  assert.ok(decision !== null);
  assert.equal(decision.candidates.length, getLegalMoves(state).length);
});

test('零预算仍给出全部根候选的静态估值，且排序确定', () => {
  const state = makeState({ camels: { 2: [0], 5: [1], 6: [2], 7: [3], 8: [4] } });
  const options = { depth: 3, budgetMs: 0, nodeBudget: 0 };
  const first = chooseMove(state, options);
  const second = chooseMove(state, options);
  assert.equal(first.depth, 0);
  assert.equal(first.interrupted, true);
  assert.equal(first.candidates.length, getLegalMoves(state).length);
  for (const candidate of first.candidates) {
    // 掷骰候选必须按机会节点的期望估值，其余行动直接结算
    const expected =
      candidate.move.kind === 'roll'
        ? rollOutcomes(state).reduce(
            (sum, { outcome, prob }) =>
              sum +
              prob * breakdownOf(applyMoveState(state, candidate.move, outcome), state.current).total,
            0,
          )
        : breakdownOf(applyMoveState(state, candidate.move), state.current).total;
    assert.ok(Math.abs(candidate.value - expected) < 1e-9);
    assert.ok(Math.abs(candidate.breakdown.total - expected) < 1e-9);
  }
  assert.equal(second.move.kind, first.move.kind);
  assert.deepEqual(
    second.candidates.map((c) => c.value),
    first.candidates.map((c) => c.value),
  );
});

test('节点预算硬生效', () => {
  const state = makeState({ camels: { 2: [0], 5: [1], 6: [2], 7: [3], 8: [4] } });
  const decision = chooseMove(state, { depth: 3, budgetMs: 5_000, nodeBudget: 50 });
  assert.ok(decision.nodes <= 50);
  assert.equal(decision.interrupted, true);
});

test('深度 1 与手写 oracle 期望值对拍', () => {
  const state = makeState({
    camels: { 6: [0], 4: [1], 3: [2], 8: [3], 9: [4] },
    pyramidRemaining: 2,
    diceRemaining: [0, 2],
    players: [{ coins: 4 }, { coins: 5 }, { coins: 6 }],
  });
  const decision = chooseMove(state, { depth: 1, budgetMs: 2_000, nodeBudget: 100_000 });
  const oracle = oracleValues(state);
  const best = Math.max(...oracle.map((item) => item.value));
  assert.ok(Math.abs(decision.value - best) < 1e-6, `决策值 ${decision.value} 应等于 oracle 最大值 ${best}`);
  const chosen = oracle.find((item) => JSON.stringify(item.move) === JSON.stringify(decision.move));
  assert.ok(chosen, '所选行动应在合法行动列表内');
  assert.ok(Math.abs(chosen.value - decision.value) < 1e-6);
});

test('未兑现腿注按剩余骰的真实位移折算，不做固定可信度插值（防拖延僵局）', () => {
  // 骆驼 1 在 9 号格，但骆驼 2 守在 10 号格、骆驼 0 还握着骰子：两条路都会把它挤到第三
  const opponentDie = makeState({
    camels: { 10: [2], 9: [1], 8: [0], 3: [3], 2: [4] },
    diceRemaining: [0],
    diceValues: [2, 2, 2, 2, 1],
    players: [{ legTickets: [{ color: 1, value: 5 }] }],
  });
  assert.equal(
    breakdownOf(opponentDie, 0).legTickets,
    -1,
    '名次已无望时 5 票应折为错注 -1，而不是继续按票面 5 计入',
  );

  // 同一幅面若领跑驼自己也还有骰，领先概率回升，期望回到正值但低于票面
  const bothDice = makeState({
    camels: { 9: [1], 8: [0], 4: [2], 3: [3], 2: [4] },
    diceRemaining: [0, 1],
    diceValues: [2, 2, 2, 2, 1],
    players: [{ legTickets: [{ color: 1, value: 5 }] }],
  });
  const both = breakdownOf(bothDice, 0).legTickets;
  assert.ok(both > 0 && both < 5, `双方都能行动时期望 ${both} 应在 (0,5) 内`);
});

test('摇骰前后的腿注期望基本一致：出手顺序分层抽样消除「拖延套利」', () => {
  // 五峰骆驼全挤在 4 号格、五颗骰都在塔中：若模型固定按下层→上层摇骰，
  // 叠驼永不拆开，会误判「白驼必第一」，把未兑现腿注估高约 3 EP，AI 便拒绝摇骰。
  const state = makeState({
    camels: { 4: [0, 1, 2, 3, 4] },
    diceRemaining: [0, 1, 2, 3, 4],
    players: [
      { legTickets: [{ color: 4, value: 5 }, { color: 3, value: 5 }] },
      { legTickets: [{ color: 0, value: 5 }] },
      { legTickets: [{ color: 2, value: 3 }] },
    ],
  });
  const before = breakdownOf(state, 0).legTickets;
  let after = 0;
  for (const { outcome, prob } of rollOutcomes(state)) {
    after += prob * breakdownOf(applyMoveState(state, { kind: 'roll' }, outcome), 0).legTickets;
  }
  assert.ok(
    Math.abs(before - after) < 0.2,
    `摇骰前 ${before.toFixed(3)} 与摇骰后平均 ${after.toFixed(3)} 应基本一致，不允许系统性高估未兑现腿注`,
  );
});

test('终局收益向量：胜者拿决胜分，其余按金币', () => {
  const state = makeState({
    seats: [0, 1, 2],
    phase: 'gameEnd',
    winner: 1,
    players: [{ coins: 5 }, { coins: 19 }, { coins: 8 }],
    winnerPile: [{ player: 1, color: 0 }],
  });
  const values = evaluateAll(state);
  assert.equal(values[1], WIN_VALUE + 19);
  assert.equal(values[0], 5);
  assert.equal(values[2], 8);
});

test('置换表键区分同总量的不同腿注分配与不同剩余骰', () => {
  const full = [5, 3, 2];
  const empty = [];
  const a = makeState({ legStacks: [empty, full, full, full, full] });
  const b = makeState({ legStacks: [full, empty, full, full, full] });
  assert.notEqual(positionKey(a), positionKey(b));

  // 无长度前缀时「两颗骰 + 塔余 2」与「一颗骰 + 塔余 1」会拼出同一串
  const longerDice = makeState({ diceRemaining: [0, 1], pyramidRemaining: 2 });
  const shorterDice = makeState({ diceRemaining: [0], pyramidRemaining: 1 });
  assert.notEqual(positionKey(longerDice), positionKey(shorterDice));
});

test('地形块期望收益按剩余骰可及距离折算，驼群身后恒为 0', () => {
  const camels = { 2: [0], 3: [1], 4: [2], 5: [3], 6: [4] };
  const tileAt = (pos, extra = {}) =>
    breakdownOf(
      makeState({ camels, players: [{ desert: { pos, face: 'oasis' } }], ...extra }),
      0,
    ).desert;
  assert.equal(tileAt(1), 0, '驼群身后的地形块永远等不到踩中');
  // 8 号格可被 6 号与 5 号骆驼踩到（各 1/3）；同腿两头骆驼各能触发一次、各付 1 EP，故期望相加
  assert.ok(Math.abs(tileAt(8) - 2 / 3) < 1e-9);
  // 9 号格只有 6 号骆驼够得到：只剩它的骰子时 1/3，换成别的骰子则归零
  assert.ok(Math.abs(tileAt(9, { diceRemaining: [4], diceValues: [1, 1, 1, 1, 1] }) - 1 / 3) < 1e-9);
  assert.equal(tileAt(9, { diceRemaining: [0], diceValues: [1, 1, 1, 1, 1] }), 0);
});

test('批量评估与逐玩家评估口径一致', () => {
  const state = makeState({
    camels: { 3: [0, 1], 7: [2], 9: [3, 4] },
    diceRemaining: [0, 2, 3],
    pyramidRemaining: 3,
    players: [
      { legTickets: [{ color: 0, value: 5 }], desert: { pos: 6, face: 'oasis' } },
      { legTickets: [{ color: 2, value: 3 }], coins: 7 },
    ],
    winnerPile: [
      { player: 0, color: 0 },
      { player: 2, color: 0 },
    ],
    loserPile: [{ player: 1, color: 4 }],
  });
  const all = breakdownsOf(state);
  for (let player = 0; player < state.players.length; player += 1) {
    assert.deepEqual(all[player], breakdownOf(state, player));
  }
  assert.deepEqual(evaluateAll(state), all.map((item) => item.total));
});
