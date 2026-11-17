import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chooseMove } from '../../src/games/azul/engine/ai/search.ts';
import { WIN_VALUE, breakdownOf, evaluateAll } from '../../src/games/azul/engine/ai/evaluate.ts';
import { advanceState, applyMove, createInitialState, getLegalMoves, startNextRound } from '../../src/games/azul/engine/rules.ts';
import { createRng } from '../../src/games/azul/engine/rng.ts';
import { fixtures, makeState } from './ai-fixtures.mjs';
import { repeatsPosition } from './reference-policy.mjs';

const unlimited = { depth: 2, budgetMs: 1e9, nodeBudget: 1e9 };
// 4 人夹具分支因子大，枚举对拍用深度 1 控制规模
const FIXTURE_DEPTH = [2, 2, 1];
const close = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const sameMove = (a, b) => a.source === b.source && a.color === b.color && a.row === b.row;

function freezeState(state) {
  const deep = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deep);
      Object.freeze(value);
    }
    return value;
  };
  return deep(structuredClone(state));
}

// 独立使用带完整动画的正式规则，未知下一轮供应是搜索边界。
function afterMove(state, move) {
  const next = applyMove(state, move).state;
  return next.phase === 'roundEnd' && next.bag.every((count) => count === 0)
    && next.discard.every((count) => count === 0) ? startNextRound(next) : next;
}

function canonicalMoves(state) {
  return getLegalMoves(state).sort((a, b) => {
    if (a.source !== b.source) {
      if (a.source === state.factoryCount) return 1;
      if (b.source === state.factoryCount) return -1;
      for (let color = 0; color < 5; color += 1) {
        const difference = state.factories[a.source][color] - state.factories[b.source][color];
        if (difference) return difference;
      }
    }
    return a.color - b.color || (a.row < 0 ? 5 : a.row) - (b.row < 0 ? 5 : b.row);
  });
}

function oracle(state, depth) {
  if (state.phase === 'gameEnd') {
    return state.seats.map((seat) => seat === state.winner ? WIN_VALUE : -WIN_VALUE);
  }
  if (depth === 0 || state.phase === 'roundEnd') return evaluateAll(state);
  const player = state.current;
  let best = null;
  for (const move of canonicalMoves(state)) {
    const after = afterMove(state, move);
    if (repeatsPosition(state, move, after)) continue;
    const child = oracle(after, depth - 1);
    if (!best || child[player] > best[player] + 1e-9) best = child;
  }
  return best ?? evaluateAll(state);
}

function checkAgainstOracle(state, depth) {
  const decision = chooseMove(state, { ...unlimited, depth });
  const moves = getLegalMoves(state);
  if (state.phase !== 'placing' || moves.length === 0) {
    assert.equal(decision, null);
    return;
  }
  assert.equal(decision.depth, depth);
  assert.equal(decision.requestedDepth, depth);
  assert.equal(decision.interrupted, false);
  assert.equal(decision.candidates.length, moves.length);
  const hasProgress = moves.some((move) => !repeatsPosition(state, move, afterMove(state, move)));
  for (const move of moves) {
    const candidate = decision.candidates.find((item) => sameMove(item.move, move));
    assert.ok(candidate, `缺少候选 ${JSON.stringify(move)}`);
    const after = afterMove(state, move);
    const expected = hasProgress && repeatsPosition(state, move, after)
      ? -WIN_VALUE - 1 : oracle(after, depth)[state.current];
    close(candidate.value, expected, `深度 ${depth} 行动 ${JSON.stringify(move)}`);
  }
  // 决策必须等于稳定排序（同分保持枚举顺序）后的首个候选
  const sorted = moves.map((move) => decision.candidates.find((item) => sameMove(item.move, move)))
    .sort((a, b) => Math.abs(b.value - a.value) > 1e-9 ? b.value - a.value : 0);
  assert.deepEqual(decision.move, sorted[0].move);
  close(decision.value, sorted[0].value);
}

test('完整浅层搜索与独立 Max-n 枚举一致（2、4 人夹具）', () => {
  fixtures.forEach(({ state }, index) => checkAgainstOracle(state, FIXTURE_DEPTH[index]));
});

test('可复现的末砖循环按完整正式状态判断，与独立枚举保持一致', () => {
  const state = JSON.parse(readFileSync(new URL('./stalled-round.json', import.meta.url), 'utf8'));
  for (const depth of [0, 1, 2]) checkAgainstOracle(state, depth);
});

test('可复现实际对局中的真实局面符合枚举', () => {
  const rng = createRng(0x77aa33);
  for (const seats of [[0, 2], [0, 1, 2, 3]]) {
    let state = createInitialState(seats, rng);
    for (let turn = 0; turn < 120 && state.phase !== 'gameEnd'; turn += 1) {
      if (state.phase === 'roundEnd') {
        state = startNextRound(state, rng);
        continue;
      }
      if (turn > 40 && turn % 17 === 0) checkAgainstOracle(state, 1);
      const moves = getLegalMoves(state);
      state = advanceState(state, moves[Math.floor(rng() * moves.length)], rng);
    }
  }
});

test('只读输入在正常搜索、超预算、终局和重复调用后均不改变', () => {
  fixtures.forEach(({ state: input }, index) => {
    const state = freezeState(input);
    const before = JSON.stringify(state);
    for (const nodeBudget of [0, 1, 17, 100000]) {
      chooseMove(state, { depth: 3, budgetMs: 1e9, nodeBudget });
      assert.equal(JSON.stringify(state), before);
    }
    const one = chooseMove(state, { ...unlimited, depth: FIXTURE_DEPTH[index] });
    const two = chooseMove(state, { ...unlimited, depth: FIXTURE_DEPTH[index] });
    assert.deepEqual(one.candidates, two.candidates);
  });
});

test('节点预算严格生效，返回的全部候选来自同一完整搜索深度', () => {
  const state = fixtures[0].state;
  for (const nodeBudget of [0, 1, 2, 7, 23, 97, 301, 1000, 4000]) {
    const actual = chooseMove(state, { depth: 5, budgetMs: 1e9, nodeBudget });
    assert.ok(actual.nodes <= nodeBudget, `${actual.nodes} 超出预算 ${nodeBudget}`);
    assert.ok(actual.depth >= 0 && actual.depth <= 5);
    assert.equal(actual.requestedDepth, 5);
    assert.equal(actual.interrupted, actual.depth < 5);
    const complete = chooseMove(state, { ...unlimited, depth: actual.depth });
    assert.deepEqual(actual.candidates, complete.candidates);
    assert.deepEqual(actual.move, complete.move);
  }
});

test('零节点和零时间保留完整、稳定的静态候选排序', () => {
  const state = fixtures[0].state;
  const baseline = chooseMove(state, { ...unlimited, depth: 0 });
  assert.equal(baseline.nodes, 0);
  assert.equal(baseline.depth, 0);
  assert.equal(baseline.interrupted, false);
  for (const options of [
    { depth: 10, budgetMs: 0, nodeBudget: 100000 },
    { depth: 10, budgetMs: 1000, nodeBudget: 0 },
  ]) {
    const decision = chooseMove(state, options);
    assert.equal(decision.depth, 0);
    assert.equal(decision.nodes, 0);
    assert.equal(decision.interrupted, true);
    assert.deepEqual(decision.candidates, baseline.candidates);
  }
  // 静态候选值与逐项 breakdown 完全一致
  const root = state.current;
  for (const move of getLegalMoves(state)) {
    const expected = breakdownOf(afterMove(state, move), root).total;
    const candidate = baseline.candidates.find((item) => sameMove(item.move, move));
    close(candidate.value, expected, `静态候选 ${JSON.stringify(move)}`);
  }
});

test('极小时间预算及时返回合法决定且不发布未完成层', () => {
  const state = fixtures[0].state;
  const decision = chooseMove(state, { depth: 50, budgetMs: 0.01, nodeBudget: 1e9 });
  assert.ok(
    getLegalMoves(state).some((move) => sameMove(move, decision.move)),
    '决策必须是合法行动',
  );
  assert.equal(decision.interrupted, true);
  const complete = chooseMove(state, { ...unlimited, depth: decision.depth });
  assert.deepEqual(decision.candidates, complete.candidates);
  assert.ok(decision.ms < 250, `超时过多: ${decision.ms} ms`);
});

test('非法搜索参数在入口被拒绝', () => {
  const state = fixtures[0].state;
  for (const field of ['depth', 'nodeBudget']) {
    for (const value of [-1, 1.5, NaN, Infinity]) {
      assert.throws(() => chooseMove(state, { ...unlimited, [field]: value }), RangeError);
    }
  }
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => chooseMove(state, { ...unlimited, budgetMs: value }), RangeError);
  }
});

test('非 placing 阶段、终局与供应耗尽的死局不再产生决策', () => {
  assert.equal(chooseMove(makeState({ phase: 'roundEnd' }), unlimited), null);
  assert.equal(chooseMove(makeState({ phase: 'gameEnd', winner: 0 }), unlimited), null);
  assert.equal(chooseMove(makeState({ phase: 'placing' }), unlimited), null);
});

test('终局向量：胜者得 WIN_VALUE，其余 -WIN_VALUE，且与 breakdown 口径一致', () => {
  const state = makeState({
    seats: [0, 1, 2],
    phase: 'gameEnd',
    winner: 1,
    players: [{ score: 30 }, { score: 45 }, { score: 12 }],
  });
  assert.deepEqual(evaluateAll(state), [-WIN_VALUE, WIN_VALUE, -WIN_VALUE]);
  close(breakdownOf(state, 1).total, WIN_VALUE);
  close(breakdownOf(state, 0).total, -WIN_VALUE);
});

test('evaluateAll 与 breakdownOf 各玩家视角逐一相符', () => {
  for (const { state } of fixtures) {
    const values = evaluateAll(state);
    state.players.forEach((_, player) =>
      close(values[player], breakdownOf(state, player).total, `玩家 ${player}`));
  }
});
