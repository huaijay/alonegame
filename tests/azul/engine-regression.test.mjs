import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chooseMove } from '../../src/games/azul/engine/ai/search.ts';
import { WIN_VALUE, breakdownOf, createEvaluator, evaluateAll } from '../../src/games/azul/engine/ai/evaluate.ts';
import { advanceState, applyMove, applyMoveState, getLegalMoves, startNextRound } from '../../src/games/azul/engine/rules.ts';
import { createRng } from '../../src/games/azul/engine/rng.ts';
import { GameSession } from '../../src/games/azul/engine/session.ts';
import { makeState } from './ai-fixtures.mjs';
import { wallColOf } from '../../src/games/azul/engine/board.ts';
import { repeatsPosition } from './reference-policy.mjs';

const reachable = JSON.parse(readFileSync(new URL('./reachable-positions.json', import.meta.url), 'utf8'));
const exact = { depth: 1, budgetMs: 1e9, nodeBudget: 1e9 };
const close = (a, b, label = '') => assert.ok(Math.abs(a - b) < 1e-7, label + ': ' + a + ' != ' + b);
const sameMove = (a, b) => a.source === b.source && a.color === b.color && a.row === b.row;

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('终局仅规则指定的胜者获胜，非连续座位的同分不会被误判成多人获胜', () => {
  const state = makeState({
    seats: [1, 3], phase: 'gameEnd', winner: 1,
    players: [{ score: 48 }, { score: 48 }],
  });
  assert.deepEqual(evaluateAll(state), [WIN_VALUE, -WIN_VALUE]);
  close(breakdownOf(state, 0).total, WIN_VALUE);
  close(breakdownOf(state, 1).total, -WIN_VALUE);
  assert.equal(chooseMove(state, exact), null);
});

test('搜索在随机补盘前停止，轮末候选不虚构确定性下一轮', () => {
  const state = makeState({
    factoryCount: 2,
    factories: [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
    center: [0, 0, 0, 0, 0],
    players: [{ score: 12 }, { score: 9 }],
  });
  const zero = chooseMove(state, { ...exact, depth: 0 });
  const deep = chooseMove(state, { ...exact, depth: 4 });
  for (const candidate of zero.candidates) {
    const result = applyMove(state, candidate.move).state;
    assert.equal(result.phase, 'roundEnd');
    close(candidate.value, breakdownOf(result, state.current).total);
    close(deep.candidates.find((other) => sameMove(other.move, candidate.move)).value, candidate.value);
  }
});

test('流通砖耗尽时搜索识别真实终局，不停留在轮末启发分数', () => {
  const state = makeState({
    factoryCount: 1, factories: [[1, 0, 0, 0, 0]],
    bag: [0, 0, 0, 0, 0], discard: [0, 0, 0, 0, 0],
    seats: [1, 3], players: [{ score: 20 }, { score: 20 }],
  });
  const decision = chooseMove(state, { ...exact, depth: 0 });
  const kept = decision.candidates.find((candidate) => candidate.move.row === 0);
  assert.ok(kept);
  const after = applyMove(state, kept.move).state;
  assert.equal(after.phase, 'roundEnd');
  assert.equal(startNextRound(after).winner, 1);
  close(kept.value, WIN_VALUE);
});

test('重复工厂的根候选仍完整展示，同一行动价值一致', () => {
  const state = makeState({
    factoryCount: 3,
    factories: [[1, 1, 0, 0, 0], [1, 1, 0, 0, 0], [0, 0, 1, 1, 0]],
    center: [0, 0, 0, 0, 1], centerMarker: true,
  });
  const decision = chooseMove(state, exact);
  assert.equal(decision.candidates.length, getLegalMoves(state).length);
  for (const first of decision.candidates.filter((candidate) => candidate.move.source === 0)) {
    const second = decision.candidates.find((candidate) =>
      candidate.move.source === 1 && candidate.move.color === first.move.color && candidate.move.row === first.move.row);
    close(first.value, second.value);
  }
});

test('交换工厂编号不改变对应候选价值，平局使用一致的内容顺序', () => {
  const state = makeState({
    factoryCount: 3,
    factories: [[1, 1, 0, 0, 0], [0, 0, 1, 1, 0], [0, 0, 0, 0, 2]],
    center: [1, 0, 0, 0, 0], centerMarker: true,
    players: [{ score: 5 }, { score: 4, rows: [[null, 0], [2, 1]] }],
  });
  const permutation = [2, 0, 1];
  const swapped = { ...state, factories: permutation.map((source) => state.factories[source]) };
  const a = chooseMove(state, exact);
  const b = chooseMove(swapped, exact);
  for (const candidate of a.candidates) {
    const source = candidate.move.source === state.factoryCount ? state.factoryCount : permutation.indexOf(candidate.move.source);
    const other = b.candidates.find((item) => item.move.source === source && item.move.color === candidate.move.color && item.move.row === candidate.move.row);
    assert.ok(other);
    close(candidate.value, other.value);
  }
});

test('快速规则与完整动画结算在真实可达局面逐候选相同，冻结输入不被修改', () => {
  for (const fixture of reachable) {
    const state = freeze(structuredClone(fixture.state));
    const before = JSON.stringify(state);
    for (const move of getLegalMoves(state)) {
      assert.deepEqual(applyMoveState(state, move), applyMove(state, move).state, fixture.name);
      assert.equal(JSON.stringify(state), before);
    }
  }
});

test('新轮次恢复首玩家标记，第一位拿中央的玩家可重新获得它', () => {
  const ended = makeState({
    phase: 'roundEnd', centerMarker: false, firstPlayer: 1,
    factories: [], center: [0, 0, 0, 0, 0],
  });
  let state = startNextRound(ended, createRng(8221));
  assert.equal(state.centerMarker, true);
  const first = getLegalMoves(state).find((move) => move.source < state.factoryCount
    && state.factories[move.source].filter((count) => count > 0).length > 1);
  assert.ok(first, '固定种子应至少有一个混色工厂');
  state = applyMoveState(state, first);
  const current = state.current;
  const centerMove = getLegalMoves(state).find((move) => move.source === state.factoryCount);
  assert.ok(centerMove);
  state = applyMoveState(state, centerMove);
  assert.equal(state.centerMarker, false);
  assert.equal(state.players[current].hasFirstMarker, true);
  assert.equal(state.firstPlayer, current);
});

test('满图案行使用真实顺序上墙得分，地板预扣尊重零分下限', () => {
  const state = makeState({
    factoryCount: 2, factories: [[0, 0, 0, 0, 1], [0, 0, 0, 0, 0]],
    current: 1,
    players: [{
      score: 2, floor: [0, 1, 2, 3],
      rows: [[0, 1], [1, 2], [2, 3]],
      wall: [[false, true, false, false, false], [false, true, false, false, false]],
    }, {}],
  });
  const explained = breakdownOf(state, 0);
  close(explained.floor, -2);
  const settled = applyMove(state, { source: 0, color: 4, row: -1 });
  const gained = settled.steps.filter((step) => step.kind === 'wall' && step.player === 0)
    .reduce((sum, step) => sum + step.gained, 0);
  close(explained.rows, gained * 10);
});

test('估值工作区交替人数、终局与双实例时保持独立输出和一致分项', () => {
  const one = createEvaluator();
  const two = createEvaluator();
  const terminal = makeState({ seats: [1, 3], phase: 'gameEnd', winner: 1, players: [{ score: 12 }, { score: 12 }] });
  const previous = [];
  for (const state of [...reachable.map((fixture) => fixture.state), terminal, reachable[0].state]) {
    const frozen = freeze(structuredClone(state));
    const values = one.evaluateAll(frozen);
    assert.deepEqual(values, evaluateAll(frozen));
    assert.deepEqual(values, two.evaluateAll(frozen));
    previous.push([values, [...values]]);
    for (let player = 0; player < state.players.length; player += 1) {
      assert.deepEqual(one.breakdownOf(frozen, player), breakdownOf(frozen, player));
      close(values[player], one.breakdownOf(frozen, player).total);
    }
    for (const [stored, expected] of previous) assert.deepEqual(stored, expected);
  }
});

test('相同棋盘引用遇到供应和最终轮变化时重新计算未满行价值', () => {
  const base = freeze(makeState({
    factoryCount: 1, factories: [[0, 0, 0, 0, 0]],
    center: [0, 2, 0, 0, 0], bag: [0, 0, 0, 0, 0], discard: [0, 0, 0, 0, 0],
    players: [{ rows: [[null, 0], [1, 1]] }, {}],
  }));
  const empty = freeze({ ...base, center: [0, 0, 0, 0, 0] });
  const reserve = freeze({ ...empty, bag: [0, 8, 0, 0, 0] });
  const final = freeze({
    ...reserve,
    players: [reserve.players[0], {
      ...reserve.players[1],
      wall: reserve.players[1].wall.map((row, index) => index === 0 ? row.map(() => true) : row),
    }],
  });
  const evaluator = createEvaluator();
  const values = [];
  for (const state of [base, empty, reserve, final, empty, base]) {
    assert.equal(state.players[0], base.players[0]);
    const explained = evaluator.breakdownOf(state, 0);
    assert.deepEqual(explained, breakdownOf(state, 0));
    assert.deepEqual(evaluator.evaluateAll(state), evaluateAll(state));
    values.push(explained.rows);
  }
  assert.ok(values[0] > values[2] && values[2] > values[1], '确定供应、保留潜力、无供应价值应不同');
  assert.equal(values[3], values[1], '最终轮不再预支下一轮供应');
  const nextRound = freeze({ ...reserve, phase: 'roundEnd' });
  const nextStarter = freeze({ ...base, firstPlayer: 1 });
  for (const state of [nextRound, nextStarter, base]) {
    assert.deepEqual(evaluator.breakdownOf(state, 0), breakdownOf(state, 0));
    assert.deepEqual(evaluator.evaluateAll(state), evaluateAll(state));
  }
  assert.ok(evaluator.breakdownOf(nextRound, 0).rows > values[2]);
  assert.notEqual(evaluator.breakdownOf(nextStarter, 0).marker, evaluator.breakdownOf(base, 0).marker);
});

test('真实末砖自循环仍展示全部合法候选，但选择能结束重复的行动', () => {
  const original = JSON.parse(readFileSync(new URL('./stalled-round.json', import.meta.url), 'utf8'));
  const swapped = { ...original, factories: [...original.factories].reverse() };
  for (const input of [original, swapped]) {
    const state = freeze(structuredClone(input));
    const before = JSON.stringify(state);
    for (const options of [{ depth: 0, budgetMs: 0, nodeBudget: 0 }, { ...exact, depth: 2 }]) {
      const decision = chooseMove(state, options);
      assert.equal(decision.candidates.length, getLegalMoves(state).length);
      assert.ok(decision.move.row >= 0, '不得通过永远弃掉最后一砖来拖延败局');
      const discarded = decision.candidates.find((candidate) => candidate.move.row === -1);
      assert.equal(discarded.repeatsPosition, true);
      assert.equal(discarded.value, -WIN_VALUE - 1);
      assert.ok(Number.isFinite(discarded.breakdown.total));
      assert.equal(repeatsPosition(state, discarded.move, applyMove(state, discarded.move).state), true);
      assert.equal(advanceState(state, decision.move, createRng(3)).phase, 'gameEnd');
    }
    assert.equal(JSON.stringify(state), before);
  }
});

test('弃砖会改变分数、下轮玩家或含未知混色供应时不标为原地循环', () => {
  const base = JSON.parse(readFileSync(new URL('./stalled-round.json', import.meta.url), 'utf8'));
  const scoreChanges = structuredClone(base);
  scoreChanges.players[0].score = 5;
  const turnChanges = structuredClone(base);
  turnChanges.current = 1;
  turnChanges.players[1].score = 0;
  const unknownSupply = { ...base, bag: [20, 20, 0, 0, 0] };
  for (const state of [scoreChanges, turnChanges, unknownSupply]) {
    const decision = chooseMove(freeze(state), { ...exact, depth: 0 });
    const discarded = decision.candidates.find((candidate) => candidate.move.row === -1);
    assert.equal(discarded.repeatsPosition, undefined);
    assert.equal(repeatsPosition(state, discarded.move, applyMove(state, discarded.move).state), false);
    assert.equal(discarded.value, discarded.breakdown.total);
  }
});

test('只有循环行动可选时仍返回合法动作，不伪造规则终局', () => {
  const state = JSON.parse(readFileSync(new URL('./stalled-round.json', import.meta.url), 'utf8'));
  for (let row = 0; row < 5; row += 1) state.players[0].wall[row][wallColOf(row, 0)] = true;
  freeze(state);
  const legal = getLegalMoves(state);
  assert.equal(legal.length, 1);
  assert.equal(legal[0].row, -1);
  const decision = chooseMove(state, { ...exact, depth: 2 });
  assert.deepEqual(decision.move, legal[0]);
  assert.equal(decision.candidates[0].repeatsPosition, true);
  assert.ok(decision.value > -WIN_VALUE && decision.value < WIN_VALUE);
  assert.equal(advanceState(state, decision.move, createRng(4)).phase, 'placing');
  assert.equal(state.phase, 'placing');
});

test('Node 会话提交最终轮转状态，单步走完整局、回放和重开均可完成', () => {
  const completions = [];
  const session = new GameSession({ seats: [0, 2], turnDelayMs: 0, aiDepth: 0, seed: 92821 },
    (seats, winner) => completions.push({ seats, winner }));
  try {
    for (let game = 0; game < 2; game += 1) {
      if (game > 0) { session.restart(); session.pause(); }
      let operations = 0;
      while (session.getSnapshot().status !== 'finished' && operations < 2500) {
        session.stepOnce();
        operations += 1;
      }
      const snapshot = session.getSnapshot();
      assert.equal(snapshot.status, 'finished', '会话必须可在单步模式完成');
      assert.equal(snapshot.state.phase, 'gameEnd');
      assert.equal(completions.length, game + 1);
      assert.equal(completions[game].winner, snapshot.state.winner);
      assert.ok(snapshot.frames.some((frame) => frame.state.current === 1), '完整行动后必须轮到另一位玩家');
      assert.equal(snapshot.frames.at(-1).state.phase, 'gameEnd');
      assert.deepEqual(snapshot.frames.at(-1).state, snapshot.state);
      session.openReplay();
      assert.equal(session.getSnapshot().replayIndex, 0);
      session.setReplayIndex(snapshot.frames.length - 1);
      assert.equal(session.getSnapshot().replayIndex, snapshot.frames.length - 1);
      session.closeReplay();
      assert.equal(session.getSnapshot().replayIndex, null);
    }
  } finally {
    session.dispose();
  }
});
