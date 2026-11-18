import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { emptyGems, emptyTokens } from '../../src/games/splendor/engine/board.ts';
import { applyMove, createInitialState, getLegalMoves, moveKey } from '../../src/games/splendor/engine/rules.ts';
import { analyzeMoves } from '../../src/games/splendor/engine/ai/search.ts';
import { AI_LEVELS, aiLevelFor, DEFAULT_AI_STRENGTH, resolveAiStrength } from '../../src/games/splendor/engine/ai/levels.ts';
import { createEvaluator, evaluateAll, breakdownOf, WIN_VALUE } from '../../src/games/splendor/engine/ai/evaluate.ts';
import { GameSession } from '../../src/games/splendor/engine/session.ts';

const exact = { samples: 1, returnChoices: 1, beamWidth: 64, opponentWidth: 64, nodeBudget: 1e7, budgetMs: 1e9 };
const fixtures = JSON.parse(readFileSync(new URL('./reachable-positions.json', import.meta.url), 'utf8'));

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function card(id, points, bonus = 'red', cost = emptyGems()) {
  return { id, tier: 1, points, bonus, cost };
}
function closedPosition(players = 2) {
  const state = createInitialState(players, 31, { nobleCount: 0 });
  state.decks = [[], [], []];
  state.market = [[
    card('small-white', 1, 'white', { ...emptyGems(), blue: 1 }),
    card('small-blue', 0, 'blue'),
    card('small-green', 2, 'green', { ...emptyGems(), white: 1, red: 1 }),
  ], [], []];
  state.bank = { ...emptyTokens(), white: 2, blue: 2, red: 2 };
  for (let player = 0; player < players; player++) {
    state.players[player].tokens = { ...emptyTokens(), blue: player % 2, white: 1, red: 1 };
  }
  return state;
}
function stableScore(a, b) {
  return Math.abs(b.score - a.score) <= 1e-9 ? 0 : b.score - a.score;
}
// 使用事件版正式规则完整枚举；同分先按即时自身估值排序，再保留正式枚举顺序。
function referenceValues(state, depth) {
  if (depth === 0 || state.phase === 'finished') return evaluateAll(state);
  const actor = state.current;
  const candidates = getLegalMoves(state).map((move) => {
    const after = applyMove(state, move).state;
    return { after, score: evaluateAll(after)[actor] };
  }).sort(stableScore);
  let best;
  for (const { after } of candidates) {
    const values = referenceValues(after, depth - 1);
    if (!best || values[actor] > best[actor] + 1e-9) best = values;
  }
  return best ?? evaluateAll(state);
}
function referenceCandidates(state, depth) {
  return getLegalMoves(state).map((move) => ({
    move, score: referenceValues(applyMove(state, move).state, depth)[state.current],
  })).sort(stableScore);
}
function comparable(analysis) {
  const { ms, ...result } = analysis;
  return result;
}

test('无未知补牌的小型局面与独立完整Max-n的全部根候选一致', () => {
  for (const players of [2, 3, 4]) for (const depth of [0, 1, 2]) {
    const state = freeze(closedPosition(players));
    const actual = analyzeMoves(state, { ...exact, depth });
    const expected = referenceCandidates(state, depth);
    assert.equal(actual.depth, depth);
    assert.equal(actual.interrupted, false);
    assert.equal(actual.candidates.length, expected.length);
    const expectedScores = new Map(expected.map((candidate) => [moveKey(candidate.move), candidate.score]));
    for (const candidate of actual.candidates) {
      assert.ok(Math.abs(candidate.score - expectedScores.get(moveKey(candidate.move))) < 1e-7,
        JSON.stringify({ players, depth, move: candidate.move, score: candidate.score, expected: expectedScores.get(moveKey(candidate.move)) }));
    }
    assert.deepEqual(actual.chosen, expected[0].move);
  }
});

test('真实未翻开牌的顺序不影响任何候选分数，分析不读取牌堆身份', () => {
  for (const fixture of [fixtures[0], fixtures[4], fixtures[8]]) {
    const state = freeze(structuredClone(fixture.state));
    const changed = { ...state, decks: state.decks.map((deck) => [...deck].reverse()) };
    const options = { ...exact, samples: 2, depth: 1, nodeBudget: 2000 };
    assert.deepEqual(comparable(analyzeMoves(state, options)), comparable(analyzeMoves(changed, options)));
    const guarded = { ...state, decks: state.decks.map((deck) => new Proxy(deck, {
      get(target, property) {
        if (property === 'length') return target.length;
        throw new Error('读取了隐藏牌堆字段 ' + String(property));
      },
    })) };
    assert.deepEqual(comparable(analyzeMoves(guarded, options)), comparable(analyzeMoves(state, options)));
  }
});

test('零预算保留全部合法基础动作、冻结输入不变且只提交完整搜索层', () => {
  const state = freeze(closedPosition(3));
  const before = JSON.stringify(state);
  const zero = analyzeMoves(state, { ...exact, depth: 3, nodeBudget: 0, budgetMs: 0 });
  assert.equal(zero.depth, 0);
  assert.equal(zero.nodes, 0);
  assert.equal(zero.interrupted, true);
  const basic = getLegalMoves(state).map(moveKey);
  assert.deepEqual(new Set(zero.candidates.map((candidate) => moveKey(candidate.move))), new Set(basic));
  for (const nodeBudget of [1, 10, 100, 500]) {
    const partial = analyzeMoves(state, { ...exact, depth: 3, nodeBudget });
    assert.ok(partial.nodes <= nodeBudget);
    const complete = analyzeMoves(state, { ...exact, depth: partial.depth });
    assert.deepEqual(partial.candidates, complete.candidates, '不能发布部分根候选完成的新深度');
    assert.deepEqual(partial.chosen, complete.chosen);
  }
  assert.equal(JSON.stringify(state), before);
});

test('非法算法选项被入口拒绝，终局返回空候选而不伪造行动', () => {
  const state = closedPosition();
  for (const options of [{ depth: -1 }, { depth: 13 }, { depth: Number.MAX_SAFE_INTEGER }, { nodeBudget: -1 }, { budgetMs: NaN }, { budgetMs: Infinity },
    { samples: 0 }, { samples: 33 }, { beamWidth: 0 }, { opponentWidth: 0 }, { returnChoices: 0 },
    { strength: 'not-a-level' }]) assert.throws(() => analyzeMoves(state, options), RangeError);
  const done = { ...state, phase: 'finished', winners: [1] };
  const analysis = analyzeMoves(freeze(done));
  assert.deepEqual(analysis.candidates, []);
  assert.deepEqual(analysis.chosen, { kind: 'pass' });
  assert.equal(analysis.nodes, 0);
});

test('根行动全都立即终局时零预算直接解析，不进行无意义的反复加深', () => {
  const state = closedPosition();
  state.current = 1;
  state.finalRound = true;
  state.players[0].points = 16;
  state.players[1].points = 15;
  state.market = [[card('finish-now', 2, 'white')], [], []];
  const result = analyzeMoves(freeze(state), { ...exact, depth: 12, nodeBudget: 0, budgetMs: 0 });
  assert.equal(result.depth, 12);
  assert.equal(result.requestedDepth, 12);
  assert.equal(result.nodes, 0);
  assert.equal(result.interrupted, false);
  assert.equal(result.chosen.kind, 'buy');
  assert.deepEqual(applyMove(state, result.chosen).state.winners, [1]);
});

test('终局按正式赢家与少卡规则处理，独胜优于并列获胜', () => {
  const state = closedPosition();
  state.phase = 'finished';
  state.winners = [1];
  assert.deepEqual(evaluateAll(state), [-WIN_VALUE, WIN_VALUE]);
  state.winners = [0, 1];
  assert.deepEqual(evaluateAll(state), [WIN_VALUE / 2, WIN_VALUE / 2]);
  assert.equal(breakdownOf(state, 0).total, WIN_VALUE / 2);

  const last = closedPosition();
  last.current = 1;
  last.finalRound = true;
  last.players[0].points = 15;
  last.players[1].points = 15;
  last.players[0].cards = Array.from({ length: 5 }, (_, index) => card('rival-' + index, 3, 'red'));
  last.players[1].cards = Array.from({ length: 4 }, (_, index) => card('own-' + index, 0, 'red'));
  last.market = [[card('zero-trap', 0, 'white')], [], []];
  const decision = analyzeMoves(freeze(last), { ...exact, depth: 0 });
  assert.notEqual(decision.chosen.kind, 'buy', '购买零分卡会丢失少卡独胜优势');
  assert.deepEqual(applyMove(last, decision.chosen).state.winners, [1]);
});

test('先达到目标不等于获胜，搜索考虑同轮后手的反超', () => {
  const state = closedPosition();
  state.players[0].points = 14;
  state.players[1].points = 14;
  state.players[0].tokens = emptyTokens();
  state.players[1].tokens = { ...emptyTokens(), blue: 1 };
  state.market = [[card('premature-trigger', 1, 'white'),
    card('rival-winning-card', 4, 'green', { ...emptyGems(), blue: 1 })], [], []];
  const trigger = { kind: 'buy', source: 'market', tier: 1, slot: 0 };
  const after = applyMove(state, trigger).state;
  assert.equal(after.finalRound, true);
  assert.equal(after.phase, 'playing');
  const lost = applyMove(after, { kind: 'buy', source: 'market', tier: 1, slot: 1 }).state;
  assert.deepEqual(lost.winners, [1]);
  const decision = analyzeMoves(freeze(state), { ...exact, depth: 1 });
  assert.notEqual(moveKey(decision.chosen), moveKey(trigger));
});

test('四人最后一轮不会因声望单位变化而误把确定反超当成优势', () => {
  const state = createInitialState(4, 70, { nobleCount: 0, reserveLimit: 1 });
  state.decks = [[], [], []];
  state.market = [[
    card('white-one-point', 1, 'white', { ...emptyGems(), white: 3 }),
    card('black-three-points', 3, 'black', { ...emptyGems(), black: 3 }),
  ], [], []];
  state.players[0].points = 14;
  state.players[0].cards = Array.from({ length: 3 }, (_, index) => card('white-engine-' + index, 0, 'white'));
  state.players[3].points = 14;
  state.players[3].tokens = { ...emptyTokens(), black: 3 };
  state.bank.black -= 3;
  // 中间两席已满预留，且无筹码和折扣，一手内既无法抢走黑卡也无法购入它。
  for (const seat of [1, 2]) state.players[seat].reserved = [
    card('unaffordable-' + seat, 1, 'red', { white: 7, blue: 7, green: 7, red: 7, black: 7 }),
  ];
  const buy = { kind: 'buy', source: 'market', tier: 1, slot: 0 };
  const reserve = { kind: 'reserve', tier: 1, slot: 1 };
  const triggered = applyMove(state, buy).state;
  assert.ok(evaluateAll(triggered)[0] < 0);
  assert.ok(evaluateAll(triggered)[0] < evaluateAll(applyMove(state, reserve).state)[0]);
  const analysis = analyzeMoves(freeze(state), { strength: 'normal', samples: 1, budgetMs: 1e9 });
  assert.notEqual(moveKey(analysis.chosen), moveKey(buy));
});

test('候选扩展允许选择贵族，避免默认数组顺序把胜局交给后手', () => {
  const state = closedPosition();
  state.players[0].points = 12;
  state.players[1].points = 13;
  state.players[0].cards = [card('blue-discount', 0, 'blue')];
  state.players[1].cards = [card('white-discount', 0, 'white')];
  state.players[0].tokens = emptyTokens();
  state.players[1].tokens = emptyTokens();
  state.market = [[card('white-trigger', 0, 'white')], [], []];
  state.nobles = [
    { id: 'only-me', points: 3, requirement: { ...emptyGems(), white: 1, blue: 1 } },
    { id: 'contested', points: 3, requirement: { ...emptyGems(), white: 1 } },
  ];
  const decision = analyzeMoves(freeze(state), { ...exact, depth: 1 });
  assert.equal(decision.chosen.kind, 'buy');
  assert.equal(decision.chosen.nobleId, 'contested');
  assert.ok(decision.candidates.some((candidate) => candidate.move.kind === 'buy' && candidate.move.nobleId === undefined));
});

test('高档位显式退筹变体均合法，基础行动完整保留', () => {
  const state = createInitialState(3, 299, { tokenLimit: 6 });
  state.players[0].tokens = { white: 2, blue: 2, green: 2, red: 0, black: 0, gold: 0 };
  for (const color of ['white', 'blue', 'green']) state.bank[color] -= 2;
  const crowded = JSON.parse(readFileSync(new URL('./token-limit-position.json', import.meta.url), 'utf8')).state;
  for (const position of [state, crowded]) {
    const analysis = analyzeMoves(freeze(position), { ...exact, depth: 0, returnChoices: 4 });
    assert.ok(analysis.candidates.some((candidate) => 'returns' in candidate.move && candidate.move.returns.length > 0));
    for (const legal of getLegalMoves(position)) assert.ok(analysis.candidates.some((candidate) => moveKey(candidate.move) === moveKey(legal)));
    for (const candidate of analysis.candidates) assert.doesNotThrow(() => applyMove(position, candidate.move));
  }
});

test('局部估值工作区与公共API一致，同玩家引用更换公开环境时不会复用过期分数', () => {
  const evaluator = createEvaluator();
  const base = freeze(structuredClone(fixtures[4].state));
  const situations = [
    base,
    { ...base, bank: emptyTokens() },
    { ...base, market: [[], [], []] },
    { ...base, nobles: [] },
    { ...base, rules: { ...base.rules, victoryPoints: 30, tokenLimit: 6 } },
    { ...base, finalRound: true, current: base.players.length - 1 },
    freeze(closedPosition(2)), freeze(closedPosition(4)), base,
  ];
  for (const state of situations) {
    freeze(state);
    const before = JSON.stringify(state);
    const vector = evaluator.evaluateAll(state);
    assert.deepEqual(vector, evaluateAll(state));
    for (let seat = 0; seat < state.players.length; seat++) {
      const parts = evaluator.breakdownOf(state, seat);
      assert.deepEqual(parts, breakdownOf(state, seat));
      assert.equal(parts.total, vector[seat]);
      assert.ok(Object.values(parts).every(Number.isFinite));
      parts.total = -123456;
    }
    vector[0] = -123456;
    assert.deepEqual(evaluator.evaluateAll(state), evaluateAll(state));
    assert.equal(JSON.stringify(state), before);
  }
});

test('最终轮只给尚未行动的席位保留当前可兑现机会', () => {
  const state = closedPosition(3);
  state.current = 2;
  state.finalRound = true;
  for (let seat = 0; seat < 3; seat++) {
    const parts = breakdownOf(state, seat);
    assert.equal(parts.engine, 0);
    assert.equal(parts.resources, 0);
    assert.equal(parts.nobles, 0);
    assert.equal(parts.reservations, 0);
    if (seat < state.current) assert.equal(parts.targets, 0);
    else assert.ok(parts.targets > 0);
  }
});

test('四档预算具有真实差异，默认标准，外部改配置不改变本局强度与重开', () => {
  assert.equal(DEFAULT_AI_STRENGTH, 'normal');
  assert.equal(resolveAiStrength(), 'normal');
  assert.deepEqual(AI_LEVELS.map((level) => level.id), ['easy', 'normal', 'hard', 'expert']);
  assert.ok(AI_LEVELS.every((level, index) => index === 0 || level.nodeBudget > AI_LEVELS[index - 1].nodeBudget));
  for (const { id } of AI_LEVELS) {
    const profile = aiLevelFor(id, 3);
    const config = { playerCount: 3, humanSeat: null, seed: 537, turnDelayMs: 600, aiStrength: id,
      rules: { victoryPoints: 10 } };
    const session = new GameSession(config);
    try {
      const start = session.getSnapshot();
      assert.equal(start.ai.strength, id);
      assert.equal(start.ai.requestedDepth, profile.depth);
      assert.ok(start.ai.nodes <= profile.nodeBudget);
      const expected = applyMove(start.state, start.ai.chosen).state;
      session.stepOnce();
      assert.deepEqual(session.getSnapshot().state, expected);
      assert.equal(session.getSnapshot().ai.strength, id);
      config.aiStrength = id === 'expert' ? 'easy' : 'expert';
      config.rules.victoryPoints = 30;
      session.restart();
      assert.equal(session.getSnapshot().ai.strength, id);
      assert.deepEqual(session.getSnapshot().state, start.state);
    } finally {
      session.dispose();
    }
  }
  const legacy = new GameSession({ playerCount: 2, humanSeat: null, seed: 1, turnDelayMs: 600 });
  assert.equal(legacy.getSnapshot().ai.strength, 'normal');
  legacy.dispose();
});
