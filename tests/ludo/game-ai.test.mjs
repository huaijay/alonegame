import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chooseMove } from '../../src/games/ludo/engine/ai/expectimax.ts';
import { breakdownOf, createEvaluator, evaluate, evaluateAll } from '../../src/games/ludo/engine/ai/evaluate.ts';
import { applyMove, getLegalMoves, landingPosition, passTurn } from '../../src/games/ludo/engine/rules.ts';
import { createRng, rollDice } from '../../src/games/ludo/engine/rng.ts';
import { FINISH } from '../../src/games/ludo/engine/types.ts';
import { fixtures, makeState } from './ai-fixtures.mjs';

// 修改前正式规则的穷举落点快照，防止新版搜索与正式规则共用 helper 后彼此自证。
const originalLandings = JSON.parse(readFileSync(new URL('./landing-positions.json', import.meta.url), 'utf8'));
const unlimited = { depth: 2, budgetMs: 1e9, nodeBudget: 1e9 };
const close = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);

function freezeState(state) {
  Object.freeze(state.seats);
  state.planes.forEach(Object.freeze);
  Object.freeze(state.planes);
  Object.freeze(state.finishedOrder);
  return Object.freeze(state);
}

// 不使用缓存、快照复用或搜索内部函数，直接用正式规则枚举完整博弈树。
function exactValues(state, depth) {
  if (depth === 0 || state.winner !== null) {
    return state.seats.map((_, player) => evaluate(state, player));
  }
  const total = state.seats.map(() => 0);
  for (let dice = 1; dice <= 6; dice += 1) {
    const moves = getLegalMoves(state, dice).sort((a, b) =>
      state.planes[state.current][a.plane] - state.planes[state.current][b.plane] || a.plane - b.plane);
    let best;
    if (moves.length === 0) best = exactValues(passTurn(state), depth - 1);
    else {
      for (const move of moves) {
        const next = exactValues(applyMove(state, move, dice).state, depth - 1);
        if (!best || next[state.current] > best[state.current] + 1e-9) best = next;
      }
    }
    for (let player = 0; player < total.length; player += 1) total[player] += best[player];
  }
  return total.map((value) => value / 6);
}

function checkAgainstOracle(state, dice, depth) {
  const decision = chooseMove(state, dice, { ...unlimited, depth });
  const moves = getLegalMoves(state, dice);
  if (moves.length === 0 || state.winner !== null) {
    assert.equal(decision, null);
    return;
  }
  assert.equal(decision.depth, depth);
  assert.equal(decision.requestedDepth, depth);
  assert.equal(decision.interrupted, false);
  assert.equal(decision.candidates.length, moves.length);
  for (const move of moves) {
    const candidate = decision.candidates.find((item) => item.move.kind === move.kind && item.move.plane === move.plane);
    assert.ok(candidate, `missing candidate ${JSON.stringify(move)}`);
    const expected = exactValues(applyMove(state, move, dice).state, depth)[state.current];
    close(candidate.value, expected, `depth ${depth}, dice ${dice}, move ${move.plane}`);
  }
  const sorted = [...decision.candidates].sort((a, b) =>
    Math.abs(b.value - a.value) <= 1e-9 ? a.move.plane - b.move.plane : b.value - a.value);
  assert.deepEqual(decision.move, sorted[0].move);
  close(decision.value, sorted[0].value);
}

test('完整浅层搜索与独立 Max-n 枚举一致（2、3、4 人）', () => {
  for (const { state, dice } of fixtures) checkAgainstOracle(state, dice, 2);
});

test('对手选择自己的最大收益，不能假设对手帮助根玩家', () => {
  const state = makeState([0, 2], [[40, 42, 57, 57], [51, 56, 57, 57]]);
  checkAgainstOracle(state, 1, 1);
});

test('可复现实际对局中的不同骰子与连续六点状态符合枚举', () => {
  const rng = createRng(0x1346ac);
  for (const seats of [[0, 3], [0, 1, 3], [0, 1, 2, 3]]) {
    let state = makeState(seats, seats.map(() => [-1, -1, -1, -1]));
    for (let roll = 0; roll < 180 && state.winner === null; roll += 1) {
      const dice = rollDice(rng);
      const moves = getLegalMoves(state, dice);
      if (roll > 30 && roll % 19 === 0) checkAgainstOracle(state, dice, 1);
      state = moves.length
        ? applyMove(state, moves[Math.floor(rng() * moves.length)], dice).state
        : passTurn(state);
    }
  }
});

test('只读输入在正常搜索、超预算、终局和重复调用后均不改变', () => {
  for (const { state: input, dice } of fixtures) {
    const state = freezeState(structuredClone(input));
    const before = JSON.stringify(state);
    for (const nodeBudget of [0, 1, 17, 100000]) {
      chooseMove(state, dice, { depth: 3, budgetMs: 1e9, nodeBudget });
      assert.equal(JSON.stringify(state), before);
    }
    const one = chooseMove(state, dice, unlimited);
    const two = chooseMove(state, dice, unlimited);
    assert.deepEqual(one.candidates, two.candidates);
  }
});

test('节点预算严格生效，返回的全部候选来自同一完整搜索深度', () => {
  const { state, dice } = fixtures[3];
  for (const nodeBudget of [0, 1, 2, 7, 23, 97, 301, 1000, 4000]) {
    const actual = chooseMove(state, dice, { depth: 5, budgetMs: 1e9, nodeBudget });
    assert.ok(actual.nodes <= nodeBudget, `${actual.nodes} exceeded ${nodeBudget}`);
    assert.ok(actual.depth >= 0 && actual.depth <= 5);
    assert.equal(actual.requestedDepth, 5);
    assert.equal(actual.interrupted, actual.depth < 5);
    const complete = chooseMove(state, dice, { ...unlimited, depth: actual.depth });
    assert.deepEqual(actual.candidates, complete.candidates);
    assert.deepEqual(actual.move, complete.move);
  }
});

test('零节点和零时间保留完整、稳定的静态候选排序', () => {
  const { state, dice } = fixtures[3];
  const baseline = chooseMove(state, dice, { ...unlimited, depth: 0 });
  for (const options of [
    { depth: 10, budgetMs: 0, nodeBudget: 100000 },
    { depth: 10, budgetMs: 1000, nodeBudget: 0 },
  ]) {
    const decision = chooseMove(state, dice, options);
    assert.equal(decision.depth, 0);
    assert.equal(decision.nodes, 0);
    assert.equal(decision.interrupted, true);
    assert.deepEqual(decision.candidates, baseline.candidates);
  }
});

test('极小时间预算及时返回合法决定且不发布未完成层', () => {
  const { state, dice } = fixtures[3];
  const decision = chooseMove(state, dice, { depth: 50, budgetMs: 0.01, nodeBudget: 1e9 });
  assert.ok(getLegalMoves(state, dice).some((move) => move.plane === decision.move.plane && move.kind === decision.move.kind));
  assert.equal(decision.interrupted, true);
  const complete = chooseMove(state, dice, { ...unlimited, depth: decision.depth });
  assert.deepEqual(decision.candidates, complete.candidates);
  assert.ok(decision.ms < 250, `unexpected overrun: ${decision.ms} ms`);
});

test('非法骰子与搜索参数在入口被拒绝', () => {
  const { state } = fixtures[3];
  for (const dice of [0, 7, 1.5, NaN, Infinity]) {
    assert.throws(() => chooseMove(state, dice, unlimited), RangeError);
  }
  for (const field of ['depth', 'budgetMs', 'nodeBudget']) {
    for (const value of [-1, NaN, Infinity]) {
      assert.throws(() => chooseMove(state, 4, { ...unlimited, [field]: value }), RangeError);
    }
  }
  for (const field of ['depth', 'nodeBudget']) {
    assert.throws(() => chooseMove(state, 4, { ...unlimited, [field]: 1.5 }), RangeError);
  }
});

test('无合法行动和已经结束的对局不再产生决策', () => {
  const blocked = makeState([0, 2], [[-1, -1, -1, -1], [0, 1, 2, 3]]);
  assert.equal(chooseMove(blocked, 5, unlimited), null);
  const finished = makeState([1, 3], [[0, 1, 2, 3], [57, 57, 57, 57]]);
  finished.winner = 3;
  finished.finishedOrder = [3];
  assert.equal(chooseMove(finished, 6, unlimited), null);
});

test('立即获胜优先，终局分数按座位号而非玩家下标判断', () => {
  const state = makeState([1, 3], [[57, 57, 57, 56], [55, 56, 57, 57]]);
  const result = chooseMove(state, 1, { ...unlimited, depth: 0 });
  assert.deepEqual(result.move, { kind: 'advance', plane: 3 });
  assert.equal(result.value, 1000000);
  const after = applyMove(state, result.move, 1).state;
  assert.equal(after.winner, 1);
  assert.equal(evaluate(after, 0), 1000000);
  assert.equal(evaluate(after, 1), -1000000);
});

test('连续六点和第三次六点结束回合均被搜索正确处理', () => {
  for (const streak of [0, 1, 2]) {
    const state = makeState([0, 2], [[-1, 8, 25, 51], [6, 19, 38, 55]], 0, streak);
    checkAgainstOracle(state, 6, 2);
    const next = applyMove(state, { kind: 'advance', plane: 1 }, 6).state;
    assert.equal(next.current, streak < 2 ? 0 : 1);
    assert.equal(next.sixStreak, streak < 2 ? streak + 1 : 0);
  }
});

test('无法行棋的六点不能获得额外回合', () => {
  const state = makeState([1, 3], [[56, 57, 57, 57], [0, 1, 2, 3]], 0, 1);
  assert.equal(getLegalMoves(state, 6).length, 0);
  const after = passTurn(state);
  assert.equal(after.current, 1);
  assert.equal(after.sixStreak, 0);
});

test('同位置飞机置换不影响局面分数或根候选价值', () => {
  const original = makeState([0, 2, 3], [[8, 8, 29, 43], [12, 12, 26, 48], [4, 19, 19, 52]]);
  const permutation = [2, 0, 3, 1];
  const permuted = { ...original, planes: original.planes.map((row) => permutation.map((index) => row[index])) };
  const first = chooseMove(original, 3, unlimited);
  const second = chooseMove(permuted, 3, unlimited);
  close(first.value, second.value);
  for (const candidate of first.candidates) {
    const plane = permutation.indexOf(candidate.move.plane);
    close(candidate.value, second.candidates.find((other) => other.move.plane === plane).value);
  }
});

test('根层仍列出等价飞机，内部等价分支可被复用', () => {
  const state = makeState([0, 2], [[0, 0, 0, 0], [13, 13, 13, 13]]);
  const decision = chooseMove(state, 3, unlimited);
  assert.equal(decision.candidates.length, 4);
  assert.deepEqual(decision.move, { kind: 'advance', plane: 0 });
  for (const candidate of decision.candidates) close(candidate.value, decision.value);
  assert.ok(decision.cacheHits > 0);
});

test('落点查表与四座位所有位置、六种骰子的正式规则逐一相符', () => {
  for (const seat of [0, 1, 2, 3]) {
    for (let pos = -1; pos <= FINISH; pos += 1) {
      const state = makeState([seat, (seat + 2) % 4], [[pos, 57, 57, 57], [57, 57, 57, 0]]);
      for (let dice = 1; dice <= 6; dice += 1) {
        const move = getLegalMoves(state, dice).find((candidate) => candidate.plane === 0);
        const expected = move ? applyMove(state, move, dice).state.planes[0][0] : -2;
        assert.equal(expected, originalLandings[pos + 1][dice - 1]);
        assert.equal(landingPosition(seat, pos, dice), expected, `seat=${seat}, pos=${pos}, dice=${dice}`);
      }
    }
  }
});

test('踩子只发生在最终落点，飞行优先于普通同色跳跃', () => {
  const jump = makeState([0, 2], [[0, 57, 57, 57], [30, 57, 57, 57]]);
  const jumped = applyMove(jump, { kind: 'advance', plane: 0 }, 4);
  assert.equal(jumped.state.planes[0][0], 8);
  assert.equal(jumped.state.planes[1][0], 30);
  assert.ok(jumped.steps.every((step) => step.captures.length === 0));
  const fly = makeState([0, 2], [[8, 57, 57, 57], [42, 50, 57, 57]]);
  const flown = applyMove(fly, { kind: 'advance', plane: 0 }, 4);
  assert.equal(flown.state.planes[0][0], 24);
  assert.equal(flown.state.planes[1][0], 42);
  assert.equal(flown.state.planes[1][1], -1);
});

test('起飞可以捕获，叠在最终落点的对手飞机一次全部被踩', () => {
  const state = makeState([0, 2], [[-1, -1, -1, -1], [26, 26, 52, 57]]);
  const result = applyMove(state, { kind: 'launch', plane: 0 }, 6);
  assert.deepEqual(result.state.planes[1], [-1, -1, 52, 57]);
  assert.equal(result.steps[0].captures.length, 2);
});

test('批量估值与每个玩家单独估值及解释分项保持一致', () => {
  for (const { state } of fixtures) {
    const values = evaluateAll(state);
    assert.equal(values.length, state.seats.length);
    for (let player = 0; player < state.seats.length; player += 1) {
      const breakdown = breakdownOf(state, player);
      close(values[player], evaluate(state, player));
      close(breakdown.total, breakdown.progress + breakdown.safety + breakdown.attack + breakdown.home + breakdown.boost);
      close(breakdown.total, evaluate(state, player));
      assert.ok(Object.values(breakdown).every(Number.isFinite));
    }
  }
});

test('整张棋盘转动后，估值和决策保持一致', () => {
  const state = makeState([0, 1, 2, 3], [[8, 19, 34, 47], [4, 16, 31, 51], [6, 21, 38, 53], [11, 23, 41, 54]]);
  const rotated = { ...state, seats: state.seats.map((seat) => (seat + 1) % 4) };
  const a = chooseMove(state, 4, unlimited);
  const b = chooseMove(rotated, 4, unlimited);
  close(a.value, b.value);
  assert.deepEqual(a.move, b.move);
  for (let player = 0; player < 4; player += 1) close(evaluate(state, player), evaluate(rotated, player));
});

test('搜索正确撤销同一步踩掉全部十二架敌机的局面', () => {
  const state = freezeState(makeState([0, 1, 2, 3], [[27, 27, 27, 27], [14, 14, 14, 14], [1, 1, 1, 1], [27, 57, 57, 57]], 3));
  const afterRoot = applyMove(state, { kind: 'advance', plane: 0 }, 6).state;
  const captured = applyMove(afterRoot, { kind: 'advance', plane: 0 }, 3);
  assert.equal(captured.steps.at(-1).captures.length, 12);
  checkAgainstOracle(state, 6, 2);
  const before = JSON.stringify(state);
  for (const nodeBudget of [11, 89, 350, 1000]) {
    const result = chooseMove(state, 6, { depth: 5, budgetMs: 1e9, nodeBudget });
    assert.equal(JSON.stringify(state), before);
    const reference = chooseMove(state, 6, { ...unlimited, depth: result.depth });
    assert.deepEqual(result.candidates, reference.candidates);
  }
});

const soloRolls = new Array(59).fill(0);
for (let pos = 56; pos >= -1; pos -= 1) {
  const destinations = originalLandings[pos + 1].filter((target) => target >= 0);
  soloRolls[pos + 1] = (6 + destinations.reduce((sum, target) => sum + soloRolls[target + 1], 0)) / destinations.length;
}
const captureLoss = (pos) => 8 * (soloRolls[0] - soloRolls[pos + 1]);

function captureOracle(state) {
  const incoming = state.seats.map(() => 0);
  const outgoing = state.seats.map(() => 0);
  for (let attacker = 0; attacker < state.seats.length; attacker += 1) {
    const turn = { ...state, current: attacker, sixStreak: 0 };
    for (let dice = 1; dice <= 6; dice += 1) {
      const outcomes = new Map();
      for (const move of getLegalMoves(turn, dice)) {
        const result = applyMove(turn, move, dice);
        const losses = state.seats.map(() => 0);
        for (const step of result.steps) for (const victim of step.captures) {
          losses[victim.player] += captureLoss(state.planes[victim.player][victim.plane]);
        }
        const total = losses.reduce((sum, loss) => sum + loss, 0);
        outcomes.set(result.state.planes[attacker][move.plane], { losses, total });
      }
      const best = Math.max(0, ...[...outcomes.values()].map((outcome) => outcome.total));
      if (best === 0) continue;
      const choices = [...outcomes.values()].filter((outcome) => Math.abs(outcome.total - best) < 1e-9);
      for (const choice of choices) {
        outgoing[attacker] += choice.total / (6 * choices.length);
        for (let victim = 0; victim < state.seats.length; victim += 1) {
          incoming[victim] += choice.losses[victim] / (6 * choices.length);
        }
      }
    }
  }
  for (let player = 0; player < state.seats.length; player += 1) {
    const maximum = state.planes[player].reduce((sum, pos) => sum + (pos >= 0 && pos <= 51 ? captureLoss(pos) : 0), 0);
    incoming[player] = Math.min(incoming[player], maximum);
  }
  return { incoming, outgoing };
}

test('威胁估值与真实规则枚举一致，正确处理起飞、跳飞、叠子及互斥走法', () => {
  const cases = [
    ...fixtures.map((fixture) => fixture.state),
    makeState([0, 2], [[0, 57, 57, 57], [30, 57, 57, 57]]),
    makeState([0, 2], [[8, 57, 57, 57], [42, 50, 57, 57]]),
    makeState([0, 2], [[-1, -1, -1, -1], [26, 26, 52, 57]]),
    makeState([0, 1, 2, 3], [[26, 27, 27, 27], [8, 57, 57, 57], [1, 1, 1, 1], [40, 40, 40, 40]]),
  ];
  for (const state of cases) {
    const expected = captureOracle(state);
    for (let player = 0; player < state.seats.length; player += 1) {
      const actual = breakdownOf(state, player);
      close(actual.safety, -0.8 * expected.incoming[player], 'incoming capture loss');
      close(actual.attack, 0.8 * 0.92 / (state.seats.length - 1) * expected.outgoing[player], 'outgoing capture loss');
    }
  }
});

test('同一骰子同一落点的多架攻击机不重复累加威胁', () => {
  const one = makeState([0, 2], [[0, 57, 57, 57], [29, 57, 57, 57]]);
  const many = makeState([0, 2], [[0, 0, 0, 0], [29, 57, 57, 57]]);
  close(breakdownOf(one, 0).attack, breakdownOf(many, 0).attack);
  close(breakdownOf(one, 1).safety, breakdownOf(many, 1).safety);
  assert.ok(breakdownOf(one, 0).attack > 0);
});

test('终点精确点数按多机排程成本计分，不能把每架56都当作即将结束', () => {
  const cache = new Map();
  function remaining(planes) {
    const key = [...planes].sort((a, b) => a - b).join(',');
    if (cache.has(key)) return cache.get(key);
    if (planes.every((pos) => pos === 57)) return 0;
    let total = 6;
    let usefulDice = 0;
    for (let dice = 1; dice <= 6; dice += 1) {
      let best = Infinity;
      for (let plane = 0; plane < planes.length; plane += 1) {
        if (planes[plane] === 57 || planes[plane] + dice > 57) continue;
        const next = [...planes];
        next[plane] += dice;
        best = Math.min(best, remaining(next));
      }
      if (best < Infinity) { total += best; usefulDice += 1; }
    }
    const result = total / usefulDice;
    cache.set(key, result);
    return result;
  }
  close(remaining([56, 56, 56, 56]), 24);
  close(remaining([51, 57, 57, 57]), 6);
  close(remaining([51, 51, 51, 51]), 15.321775312492463);
  const broad = makeState([0, 2], [[51, 51, 51, 51], [0, 57, 57, 57]]);
  const narrow = makeState([0, 2], [[56, 56, 56, 56], [0, 57, 57, 57]]);
  const benefit = 8 * (remaining([56, 56, 56, 56]) - remaining([51, 51, 51, 51])) - 4 * 4;
  close(breakdownOf(broad, 0).home - breakdownOf(narrow, 0).home, benefit);
});

test('终局解释分项与胜负估值统一', () => {
  const state = makeState([1, 3], [[57, 57, 57, 57], [0, 1, 2, 3]]);
  state.winner = 1;
  state.finishedOrder = [1];
  for (let player = 0; player < 2; player += 1) {
    const value = player === 0 ? 1000000 : -1000000;
    const breakdown = breakdownOf(state, player);
    assert.equal(evaluate(state, player), value);
    assert.equal(evaluateAll(state)[player], value);
    assert.equal(breakdown.total, value);
    assert.equal(breakdown.progress + breakdown.safety + breakdown.attack + breakdown.home + breakdown.boost, value);
  }
});

test('局部估值工作区跨局面、人数、终局复用时没有残留或输出别名', () => {
  const first = createEvaluator();
  const second = createEvaluator();
  const terminal = makeState([1, 3], [[57, 57, 57, 57], [1, 3, 5, 7]]);
  terminal.winner = 1;
  const states = [...fixtures.map((fixture) => fixture.state), terminal, fixtures[3].state, fixtures[0].state];
  const retained = [];
  for (const state of states) {
    const frozen = freezeState(structuredClone(state));
    const before = JSON.stringify(frozen);
    const expected = evaluateAll(frozen);
    const a = first.evaluateAll(frozen);
    const b = second.evaluateAll(frozen);
    assert.deepEqual(a, expected);
    assert.deepEqual(b, expected);
    assert.notEqual(a, b);
    retained.push({ values: a, expected: [...a] });
    for (let player = 0; player < state.seats.length; player += 1) {
      assert.deepEqual(first.breakdownOf(frozen, player), breakdownOf(frozen, player));
    }
    assert.equal(JSON.stringify(frozen), before);
    for (const previous of retained) assert.deepEqual(previous.values, previous.expected);
  }
});
