import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVELOPMENT_CARDS, NOBLES } from '../../src/games/splendor/engine/cards.ts';
import { GEM_COLORS } from '../../src/games/splendor/engine/types.ts';
import { emptyGems } from '../../src/games/splendor/engine/board.ts';
import { analyzeMoves } from '../../src/games/splendor/engine/ai/search.ts';
import { GameSession } from '../../src/games/splendor/engine/session.ts';
import {
  applyMove, bonusesOf, createInitialState, determineWinners, getLegalMoves,
  moveKey, paymentFor, takeColorChoices, tokenCount,
} from '../../src/games/splendor/engine/rules.ts';

function zeroCostCard(points = 0, bonus = 'red') {
  return { id: 'test-' + points + '-' + bonus, tier: 1, bonus, points, cost: emptyGems() };
}

function totalSupply(state, color) {
  return state.bank[color] + state.players.reduce((sum, player) => sum + player.tokens[color], 0);
}

test('90 张基础牌、10 位贵族，人数对应供应量与可重复洗牌', () => {
  assert.equal(DEVELOPMENT_CARDS.length, 90);
  assert.equal(new Set(DEVELOPMENT_CARDS.map((card) => card.id)).size, 90);
  assert.deepEqual([1, 2, 3].map((tier) => DEVELOPMENT_CARDS.filter((card) => card.tier === tier).length), [40, 30, 20]);
  assert.equal(NOBLES.length, 10);
  for (const count of [2, 3, 4]) {
    const state = createInitialState(count, 998);
    assert.equal(state.players.length, count);
    assert.equal(state.bank.gold, 5);
    assert.equal(state.nobles.length, count + 1);
    assert.deepEqual(GEM_COLORS.map((c) => state.bank[c]), Array(5).fill(count === 2 ? 4 : count === 3 ? 5 : 7));
    assert.deepEqual(state.decks.map((tier) => tier.length), [36, 26, 16]);
    assert.deepEqual(state.market.map((tier) => tier.length), [4, 4, 4]);
    assert.deepEqual(createInitialState(count, 998), state);
    assert.notDeepEqual(createInitialState(count, 999).market, state.market);
  }
});

test('标准采集动作：三异色、同色至少 4 枚、不足三色时只可取剩余可用色', () => {
  let state = createInitialState(2);
  assert.equal(takeColorChoices(state.bank).length, 10);
  assert.equal(getLegalMoves(state).filter((m) => m.kind === 'double').length, 5);
  state.bank.white = 3;
  assert.equal(getLegalMoves(state).some((m) => m.kind === 'double' && m.color === 'white'), false);
  state.bank.blue = 0;
  state.bank.green = 0;
  state.bank.red = 0;
  assert.deepEqual(takeColorChoices(state.bank), [['white', 'black']]);
  assert.throws(() => applyMove(state, { kind: 'take', colors: ['white'] }), /不允许/);
  assert.throws(() => applyMove(state, { kind: 'double', color: 'white' }), /不允许/);
});

test('采集并自动归还超额筹码，或显式指定退还颜色', () => {
  const state = createInitialState(4);
  state.current = 0;
  state.players[0].tokens = { white: 2, blue: 2, green: 2, red: 2, black: 1, gold: 0 };
  const result = applyMove(state, { kind: 'take', colors: ['white', 'blue', 'green'], returns: ['red', 'black'] });
  assert.equal(tokenCount(result.state.players[0].tokens), 10);
  assert.equal(result.state.players[0].tokens.red, 1);
  assert.equal(result.state.players[0].tokens.black, 0);
  assert.equal(result.state.bank.red, state.bank.red + 1);
  assert.deepEqual(state.players[0].tokens, { white: 2, blue: 2, green: 2, red: 2, black: 1, gold: 0 });
  assert.throws(() => applyMove(state, { kind: 'take', colors: ['white', 'blue', 'green'], returns: ['gold', 'gold'] }), /未持有/);
  const automatic = applyMove(state, { kind: 'take', colors: ['white', 'blue', 'green'] });
  assert.equal(tokenCount(automatic.state.players[0].tokens), 10);
});

test('购卡：永久折扣抵扣花费，黄金补充，费用归还供应区并翻补新卡', () => {
  const state = createInitialState(2);
  state.current = 0;
  const card = { id: 'buy-me', tier: 2, bonus: 'green', points: 2,
    cost: { white: 3, blue: 2, green: 0, red: 1, black: 0 } };
  const discountCard = zeroCostCard(0, 'white');
  state.players[0].cards = [discountCard];
  state.players[0].tokens = { white: 1, blue: 1, green: 0, red: 1, black: 0, gold: 2 };
  state.market[1][0] = card;
  const payment = paymentFor(card, state.players[0]);
  assert.deepEqual(payment, { white: 1, blue: 1, green: 0, red: 1, black: 0, gold: 2 });
  const originalTop = state.decks[1][0];
  const next = applyMove(state, { kind: 'buy', source: 'market', tier: 2, slot: 0 }).state;
  assert.equal(next.players[0].points, 2);
  assert.equal(next.players[0].cards.length, 2);
  assert.equal(bonusesOf(next.players[0]).green, 1);
  assert.equal(next.players[0].tokens.gold, 0);
  assert.equal(next.bank.gold, state.bank.gold + 2);
  assert.equal(next.market[1][0].id, originalTop.id);
  assert.equal(next.decks[1].length, state.decks[1].length - 1);
  assert.equal(state.players[0].cards.length, 1);
});

test('预留变体：仅差 1 枚筹码可锁定公开牌并获黄金；盲抽下线，买得起或差得多都禁止', () => {
  const state = createInitialState(2);
  state.current = 0;
  const near = { id: 'lock-me', tier: 2, bonus: 'green', points: 1,
    cost: { white: 3, blue: 2, green: 0, red: 1, black: 0 } };
  const cheap = { id: 'buy-now', tier: 1, bonus: 'blue', points: 0,
    cost: { white: 1, blue: 1, green: 0, red: 1, black: 0 } };
  const filler = { id: 'too-far', tier: 3, bonus: 'black', points: 5,
    cost: { white: 7, blue: 7, green: 7, red: 7, black: 7 } };
  state.market = [[cheap, filler, filler, filler], [near, filler, filler, filler],
    [filler, filler, filler, filler]];
  state.players[0].tokens = { white: 2, blue: 1, green: 0, red: 1, black: 0, gold: 1 };
  // 缺口 2 枚由 1 枚黄金补足后仍差 1：只有近卡可预留；买得起与差得多都不出现
  assert.deepEqual(getLegalMoves(state).filter((m) => m.kind === 'reserve')
    .map((m) => m.tier + ':' + m.slot), ['2:0']);
  const replacement = state.decks[1][0];
  const next = applyMove(state, { kind: 'reserve', tier: 2, slot: 0 }).state;
  assert.equal(next.players[0].reserved[0].id, 'lock-me');
  assert.equal(next.players[0].tokens.gold, 2);
  assert.equal(next.bank.gold, 4);
  assert.equal(next.market[1][0].id, replacement.id);
  // 盲抽已整体移除，构造该动作也会被合法性校验拒绝
  assert.throws(() => applyMove(state, { kind: 'reserve', tier: 1, slot: null }), /不允许/);
  // 预留容量仍受 reserveLimit 限制
  const limited = createInitialState(2, 42, { reserveLimit: 1 });
  limited.current = 0;
  limited.market[1][0] = near;
  limited.players[0].tokens = { white: 2, blue: 1, green: 0, red: 1, black: 0, gold: 1 };
  const after = applyMove(limited, { kind: 'reserve', tier: 2, slot: 0 }).state;
  assert.equal(getLegalMoves(after).some((m) => m.kind === 'reserve'), false);
});

test('贵族在回合结束自动到访且每回合最多一位', () => {
  const state = createInitialState(2);
  state.current = 0;
  state.nobles = NOBLES.slice(0, 2);
  state.players[0].cards = Array.from({ length: 5 }, (_, color) =>
    Array.from({ length: 4 }, (_, i) => ({ ...zeroCostCard(0, GEM_COLORS[color]), id: color + '-' + i }))).flat();
  const next = applyMove(state, { kind: 'take', colors: ['white', 'blue', 'green'] }).state;
  assert.equal(next.players[0].nobles.length, 1);
  assert.equal(next.players[0].points, 3);
  assert.equal(next.nobles.length, 1);
  next.current = 0;
  const second = applyMove(next, { kind: 'take', colors: ['white', 'blue', 'green'] }).state;
  assert.equal(second.players[0].nobles.length, 2);
  assert.equal(second.players[0].points, 6);
});

test('15 分触发最后一整轮，完赛后最多分且同分购卡少者获胜', () => {
  const state = createInitialState(3);
  state.current = 0;
  state.firstPlayer = 0;
  state.players[0].points = 14;
  state.market[0][0] = zeroCostCard(1);
  let next = applyMove(state, { kind: 'buy', source: 'market', tier: 1, slot: 0 }).state;
  assert.equal(next.finalRound, true);
  assert.equal(next.phase, 'playing');
  assert.equal(next.current, 1);
  next = applyMove(next, getLegalMoves(next)[0]).state;
  assert.equal(next.phase, 'playing');
  next = applyMove(next, getLegalMoves(next)[0]).state;
  assert.equal(next.phase, 'finished');
  assert.deepEqual(next.winners, [0]);
  assert.equal(next.turn, 3);
  assert.deepEqual(getLegalMoves(next), []);

  const tie = createInitialState(2);
  tie.players[0].points = 15;
  tie.players[1].points = 15;
  tie.players[0].cards = [zeroCostCard(), zeroCostCard(), zeroCostCard()];
  tie.players[1].cards = [zeroCostCard(), zeroCostCard()];
  assert.deepEqual(determineWinners(tie.players), [1]);
  tie.players[0].cards.pop();
  assert.deepEqual(determineWinners(tie.players), [0, 1]);
});

test('每位 AI 可以使用同一合法动作引擎完成整局，所有筹码守恒', () => {
  for (const players of [2, 3, 4]) {
    for (const seed of [10, 321]) {
      let state = createInitialState(players, seed);
      let turns = 0;
      while (state.phase !== 'finished' && turns < 450) {
        const analysis = analyzeMoves(state);
        assert.ok(getLegalMoves(state).some((m) => moveKey(m) === moveKey(analysis.chosen)));
        const prev = state;
        state = applyMove(state, analysis.chosen).state;
        assert.notEqual(state, prev);
        for (const player of state.players) {
          assert.ok(tokenCount(player.tokens) <= 10);
          for (const color of [...GEM_COLORS, 'gold']) assert.ok(player.tokens[color] >= 0);
        }
        for (const color of [...GEM_COLORS, 'gold']) {
          assert.equal(totalSupply(state, color), color === 'gold' ? 5 : players === 2 ? 4 : players === 3 ? 5 : 7);
        }
        turns += 1;
      }
      assert.equal(state.phase, 'finished', 'AI 须在 450 回合内结束，人数=' + players + ', seed=' + seed);
      assert.ok(state.winners.length > 0);
    }
  }
});

test('会话：单步、回放、重新开局和相同种子均稳定', () => {
  const config = { playerCount: 2, humanSeat: null, seed: 17, turnDelayMs: 600 };
  const session = new GameSession(config);
  const start = session.getSnapshot().state;
  let notifications = 0;
  const unsubscribe = session.subscribe(() => { notifications += 1; });
  session.stepOnce();
  assert.equal(session.getSnapshot().state.turn, 1);
  assert.equal(session.getSnapshot().status, 'paused');
  session.openReplay();
  session.setReplayIndex(0);
  assert.equal(session.getSnapshot().replayIndex, 0);
  assert.equal(session.getSnapshot().frames[0].state, start);
  session.closeReplay();
  session.restart();
  assert.deepEqual(session.getSnapshot().state, start);
  assert.ok(notifications > 1);
  session.dispose();
  unsubscribe();
});
