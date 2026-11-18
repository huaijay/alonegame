import assert from 'node:assert/strict';
import test from 'node:test';
import { classicRulesFor, resolveGameRules, RULE_LIMITS } from '../../src/games/splendor/engine/config.ts';
import { createInitialState, applyMove, getLegalMoves, tokenCount } from '../../src/games/splendor/engine/rules.ts';
import { GameSession } from '../../src/games/splendor/engine/session.ts';
import { analyzeMoves } from '../../src/games/splendor/engine/ai/search.ts';
import { GEM_COLORS } from '../../src/games/splendor/engine/types.ts';

function pointsCard(points) {
  return {
    id: 'custom-score-' + points,
    tier: 1,
    bonus: 'white',
    points,
    cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 },
  };
}

test('经典规则随人数变化，未填写高级规则时和原版完全相同', () => {
  for (const players of [2, 3, 4]) {
    const base = classicRulesFor(players);
    assert.deepEqual(
      [base.victoryPoints, base.tokenLimit, base.reserveLimit, base.marketSize, base.nobleCount,
        base.gemSupply, base.goldSupply, base.doubleTakeMinimum],
      [15, 10, 3, 4, players + 1, players === 2 ? 4 : players === 3 ? 5 : 7, 5, 4],
    );
    assert.deepEqual(createInitialState(players, 123), createInitialState(players, 123, {}));
  }
});

test('全部高级参数写入不可变对局规则快照，并影响初始牌堆和供应量', () => {
  const overrides = {
    victoryPoints: 23, tokenLimit: 8, reserveLimit: 4, marketSize: 5, nobleCount: 6,
    gemSupply: 9, goldSupply: 8, doubleTakeMinimum: 6,
  };
  const state = createInitialState(3, 847, overrides);
  assert.deepEqual(state.rules, overrides);
  assert.deepEqual(state.market.map((row) => row.length), [5, 5, 5]);
  assert.deepEqual(state.decks.map((deck) => deck.length), [35, 25, 15]);
  assert.equal(state.nobles.length, 6);
  assert.deepEqual(GEM_COLORS.map((color) => state.bank[color]), Array(5).fill(9));
  assert.equal(state.bank.gold, 8);
  assert.notEqual(state.rules, overrides);
  assert.equal(createInitialState(3, 847, overrides).market[1][0].id, state.market[1][0].id);
  assert.equal(resolveGameRules(2, { victoryPoints: 10 }).gemSupply, 4);
  assert.equal(resolveGameRules(4, { victoryPoints: 10 }).gemSupply, 7);
});

test('游戏规则输入范围校验：非整数、越界或非数值不能进入对局', () => {
  for (const [key, [min, max]] of Object.entries(RULE_LIMITS)) {
    assert.throws(() => resolveGameRules(2, { [key]: min - 1 }), RangeError);
    assert.throws(() => resolveGameRules(2, { [key]: max + 1 }), RangeError);
    assert.throws(() => resolveGameRules(2, { [key]: min + 0.2 }), RangeError);
    assert.throws(() => resolveGameRules(2, { [key]: Number.NaN }), RangeError);
    assert.equal(resolveGameRules(2, { [key]: max })[key], max);
  }
});

test('自定义 8 分与 20 分阈值驱动终局、事件和并列判定，不再写死 15 分', () => {
  for (const points of [8, 20]) {
    const state = createInitialState(3, 2, { victoryPoints: points, nobleCount: 0 });
    state.current = 0;
    state.firstPlayer = 0;
    state.players[0].points = points - 2;
    state.market[0][0] = pointsCard(1);
    let result = applyMove(state, { kind: 'buy', source: 'market', tier: 1, slot: 0 });
    assert.equal(result.state.finalRound, false);
    assert.equal(result.state.players[0].points, points - 1);
    result.state.current = 0;
    result.state.market[0][1] = pointsCard(1);
    result = applyMove(result.state, { kind: 'buy', source: 'market', tier: 1, slot: 1 });
    assert.equal(result.state.finalRound, true);
    assert.ok(result.events.some((event) => event.text.includes('达到 ' + points + ' 声望')));
    let next = result.state;
    next = applyMove(next, getLegalMoves(next)[0]).state;
    assert.equal(next.phase, 'playing');
    next = applyMove(next, getLegalMoves(next)[0]).state;
    assert.equal(next.phase, 'finished');
    assert.deepEqual(next.winners, [0]);
  }
});

test('自定义筹码上限、双取门槛、黄金储备和预留容量均由规则执行', () => {
  let state = createInitialState(2, 4, {
    tokenLimit: 6, reserveLimit: 1, goldSupply: 0, doubleTakeMinimum: 5,
  });
  assert.equal(getLegalMoves(state).some((move) => move.kind === 'double'), false);
  state.players[0].tokens = { white: 2, blue: 1, green: 1, red: 1, black: 0, gold: 0 };
  let result = applyMove(state, { kind: 'take', colors: ['white', 'blue', 'green'] });
  assert.equal(tokenCount(result.state.players[0].tokens), 6);
  assert.ok(result.events.some((event) => event.text.includes('超过 6 枚上限')));
  result.state.current = 0;
  // 只差 1 枚白筹码的卡允许预留；黄金储备为 0 时不发放黄金
  result.state.market[0][0] = {
    id: 'custom-lock', tier: 1, bonus: 'white', points: 0,
    cost: { white: 3, blue: 0, green: 0, red: 0, black: 0 },
  };
  result.state.players[0].tokens = { white: 2, blue: 1, green: 1, red: 1, black: 0, gold: 0 };
  result = applyMove(result.state, { kind: 'reserve', tier: 1, slot: 0 });
  assert.equal(result.state.players[0].reserved.length, 1);
  assert.equal(result.state.players[0].tokens.gold, 0);
  result.state.current = 0;
  assert.equal(getLegalMoves(result.state).some((move) => move.kind === 'reserve'), false);
  assert.deepEqual(getLegalMoves(createInitialState(2, 1, { doubleTakeMinimum: 2 }))
    .filter((move) => move.kind === 'double').map((move) => move.color), [...GEM_COLORS]);
});

test('动态预留上限与牌场尺寸影响后续卡位，贵族为零时不会拜访', () => {
  const initial = createInitialState(4, 4, {
    marketSize: 3, nobleCount: 0, reserveLimit: 4,
  });
  assert.equal(initial.nobles.length, 0);
  assert.deepEqual(initial.market.map((row) => row.length), [3, 3, 3]);
  // 白筹码固定 1 枚：费用 2/3/4/5 的卡在黄金递增后始终只差 1 枚，可连续预留至满
  const near = (cost) => ({ id: 'near-' + cost, tier: 1, bonus: 'white', points: 0,
    cost: { white: cost, blue: 0, green: 0, red: 0, black: 0 } });
  let next = initial;
  next.players[0].tokens = { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
  for (let i = 0; i < 4; i++) {
    next.current = 0;
    next.market[0][0] = near(i + 2);
    next = applyMove(next, { kind: 'reserve', tier: 1, slot: 0 }).state;
  }
  assert.equal(next.players[0].reserved.length, 4);
  next.current = 0;
  assert.equal(getLegalMoves(next).some((move) => move.kind === 'reserve'), false);
  assert.equal(next.market[0].length, 3);
});

test('自定义配置贯穿 AI 对局、会话回放与重开，且筹码始终守恒', () => {
  const config = {
    playerCount: 3, seed: 45, humanSeat: null, turnDelayMs: 600,
    rules: {
      victoryPoints: 10, tokenLimit: 8, reserveLimit: 4, marketSize: 5,
      nobleCount: 2, gemSupply: 6, goldSupply: 6, doubleTakeMinimum: 3,
    },
  };
  const session = new GameSession(config);
  const start = session.getSnapshot().state;
  assert.deepEqual(start.rules, config.rules);
  session.stepOnce();
  session.openReplay();
  session.setReplayIndex(0);
  assert.deepEqual(session.getSnapshot().frames[0].state.rules, config.rules);
  session.closeReplay();
  session.restart();
  assert.deepEqual(session.getSnapshot().state, start);
  session.dispose();

  let state = start;
  for (let turn = 0; turn < 600 && state.phase === 'playing'; turn++) {
    const move = analyzeMoves(state).chosen;
    state = applyMove(state, move).state;
    for (const player of state.players) assert.ok(tokenCount(player.tokens) <= state.rules.tokenLimit);
    for (const color of [...GEM_COLORS, 'gold']) {
      assert.equal(state.bank[color] + state.players.reduce((n, p) => n + p.tokens[color], 0),
        color === 'gold' ? 6 : 6);
    }
  }
  assert.equal(state.phase, 'finished');
  assert.ok(state.players.some((player) => player.points >= 10));
});

test('真人席位可以选择非首席，其余席位仍正常执行 AI 回合', () => {
  const session = new GameSession({
    playerCount: 4, seed: 124, humanSeat: 2, turnDelayMs: 1000, rules: { victoryPoints: 12 },
  });
  const original = session.getSnapshot().state;
  session.humanMove(getLegalMoves(original)[0]);
  assert.equal(session.getSnapshot().state.turn, 0, '未到真人席位时不接受点击');
  session.stepOnce();
  session.stepOnce();
  assert.equal(session.getSnapshot().state.current, 2);
  assert.equal(session.getSnapshot().state.turn, 2);
  session.humanMove(getLegalMoves(session.getSnapshot().state)[0]);
  assert.equal(session.getSnapshot().state.turn, 3);
  session.dispose();
});
