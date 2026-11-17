import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMove,
  applyMoveState,
  cloneState,
  createInitialState,
  desertTargetsOf,
  drawRollOutcome,
  getLegalMoves,
  legTicketGain,
  raceBetPayouts,
  rankOf,
  rollOutcomes,
} from '../../src/games/camel-up/engine/rules.ts';
import { FINISH_INDEX } from '../../src/games/camel-up/engine/board.ts';
import { createRng } from '../../src/games/camel-up/engine/rng.ts';
import { makeState } from './ai-fixtures.mjs';

test('确定性开局：五峰骆驼按固定骰点堆上 1-3 格，完全可复现', () => {
  const state = createInitialState([0, 1]);
  assert.deepEqual(state.stacks[0], [0, 4]);
  assert.deepEqual(state.stacks[1], [1, 3]);
  assert.deepEqual(state.stacks[2], [2]);
  assert.equal(state.leg, 1);
  assert.equal(state.phase, 'racing');
  assert.equal(state.current, 0);
  assert.equal(state.winner, null);
  for (const player of state.players) {
    assert.equal(player.coins, 3);
    assert.equal(player.hand.length, 5);
    assert.equal(player.desert.pos, null);
  }
  assert.deepEqual(createInitialState([0, 1]), state);
});

test('开局资金可配置：每位玩家按传入资金起手，缺省仍为 3 EP', () => {
  const state = createInitialState([0, 2, 5], undefined, 7);
  assert.deepEqual(state.players.map((player) => player.coins), [7, 7, 7]);
  assert.equal(createInitialState([0, 2, 5]).players[0].coins, 3);
});

test('同种子开局与整局随机推进完全一致', () => {
  const runOnce = () => {
    const rng = createRng(1234);
    let state = createInitialState([0, 1, 2], rng);
    let guard = 0;
    while (state.phase !== 'gameEnd' && guard < 2000) {
      guard += 1;
      const moves = getLegalMoves(state);
      const move = moves[Math.floor(rng() * moves.length)];
      const outcome = move.kind === 'roll' ? drawRollOutcome(state, rng) : undefined;
      state = applyMoveState(state, move, outcome);
    }
    return { state, guard };
  };
  const first = runOnce();
  const second = runOnce();
  assert.ok(first.guard < 2000, '对局应当收敛');
  assert.deepEqual(second.state, first.state);
});

test('堆叠搬运：移动驼背上骆驼随行，身下骆驼留在原地', () => {
  const state = makeState({ camels: { 2: [0, 1, 2], 5: [3], 6: [4] } });
  const { state: next, steps } = applyMove(state, { kind: 'roll' }, { color: 1, value: 2 });
  // 骆驼 1 驮着背上的 2 前进两格，身下的 0 不动
  assert.deepEqual(next.stacks[2], [0]);
  assert.deepEqual(next.stacks[4], [1, 2]);
  const move = steps.find((step) => step.kind === 'camelMove');
  assert.deepEqual(move.carried, [2]);
  assert.equal(move.from, 2);
  assert.equal(move.to, 4);
});

test('落点跳顶：骆驼单位落到有驼之格时置于堆叠顶部', () => {
  const state = makeState({ camels: { 0: [0], 2: [1], 5: [2], 6: [3], 7: [4] } });
  const next = applyMoveState(state, { kind: 'roll' }, { color: 0, value: 2 });
  assert.deepEqual(next.stacks[2], [1, 0]);
  // 名次先按格号，再按堆叠高度：0 在 1 之上，名次靠前
  const rank = rankOf(next);
  assert.ok(rank.indexOf(0) < rank.indexOf(1));
});

test('绿洲触发：骆驼单位前进一格并给块主 +1 EP', () => {
  const state = makeState({
    camels: { 2: [0], 5: [1], 6: [2], 7: [3], 8: [4] },
    players: [{ desert: { pos: 3, face: 'oasis' } }],
  });
  const { state: next, steps } = applyMove(state, { kind: 'roll' }, { color: 0, value: 1 });
  assert.equal(next.players[0].coins, 4);
  assert.deepEqual(next.stacks[3], []);
  assert.deepEqual(next.stacks[4], [0]);
  const trigger = steps.find((step) => step.kind === 'desertTrigger');
  assert.equal(trigger.owner, 0);
  assert.equal(trigger.face, 'oasis');
  assert.equal(trigger.gained, 1);
});

test('海市蜃楼触发：骆驼单位后退一格并插入下方堆叠底部', () => {
  const state = makeState({
    camels: { 2: [3, 0], 5: [1], 6: [2], 7: [4] },
    players: [{ desert: { pos: 3, face: 'mirage' } }],
  });
  const next = applyMoveState(state, { kind: 'roll' }, { color: 0, value: 1 });
  assert.equal(next.players[0].coins, 4);
  // 0 从 3 格退回 2 格，插到驻留的 3 下方 → 3 在顶
  assert.deepEqual(next.stacks[2], [0, 3]);
  assert.equal(rankOf(next).indexOf(3) < rankOf(next).indexOf(0), true);
});

test('地形块放置：每腿仅一次，第 1 格、占用格、相邻格与他块所在格均非法', () => {
  const state = makeState({
    camels: { 5: [0], 14: [1], 15: [2], 13: [3], 12: [4] },
    players: [{ desert: { pos: null, face: 'oasis' } }, { desert: { pos: 10, face: 'mirage' } }],
    current: 0,
  });
  const targets = desertTargetsOf(state, 0);
  assert.equal(targets.includes(0), false, '第 1 格永不放置');
  assert.equal(targets.includes(4), true, '空且不相邻他块的格可放置');
  assert.equal(targets.includes(5), false, '骆驼占用格不可放置');
  assert.equal(targets.includes(10), false, '他块所在格不可放置');
  assert.equal(targets.includes(9), false, '相邻他块的格不可放置');
  assert.equal(targets.includes(11), false, '相邻他块的格不可放置');

  // 上板后一直留到腿末；同一腿内不再给出放置选项，避免「反复搬块」拖延对局
  const placed = applyMoveState(state, { kind: 'desert', pos: 4, face: 'oasis' });
  assert.equal(placed.players[0].desert.pos, 4);
  assert.deepEqual(desertTargetsOf(placed, 0), []);

  // 腿末复位后重新回到手中，下一腿可再次放置
  const legEnd = makeState({
    camels: { 5: [0], 14: [1], 15: [2], 13: [3], 12: [4] },
    pyramidRemaining: 1,
    diceRemaining: [0],
    players: [{ desert: { pos: 4, face: 'oasis' } }, { desert: { pos: 10, face: 'mirage' } }],
    current: 0,
  });
  const next = applyMoveState(legEnd, { kind: 'roll' });
  assert.equal(next.players[0].desert.pos, null);
  assert.ok(desertTargetsOf(next, 0).length > 0, '新腿应重新获得放置机会');
});

test('腿末结算：领先按票面、第二 +1、其余 -1，金币片 +1，随后复位开新腿', () => {
  const state = makeState({
    camels: { 14: [1], 11: [0], 9: [2], 8: [3], 7: [4] },
    pyramidRemaining: 1,
    diceRemaining: [0],
    players: [
      {
        coins: 10,
        legTickets: [{ color: 1, value: 5 }, { color: 2, value: 2 }],
        pyramidTickets: 1,
        desert: { pos: 12, face: 'oasis' },
      },
      { coins: 10, legTickets: [{ color: 0, value: 3 }] },
      { coins: 10, legTickets: [{ color: 4, value: 3 }] },
    ],
  });
  const { state: next, steps } = applyMove(state, { kind: 'roll' }, { color: 0, value: 1 });
  // 0 号驼 11 格掷 1 点落到 12 格绿洲块上，触发前进到 13 格
  assert.deepEqual(next.stacks[13], [0]);
  // 玩家 0：触发绿洲 +1、领先票 +5、尾名票 -1、金币片 1+1 → 10+1+6
  assert.equal(next.players[0].coins, 17);
  // 玩家 1：第二名票 +1
  assert.equal(next.players[1].coins, 11);
  // 玩家 2：尾名票 -1
  assert.equal(next.players[2].coins, 9);
  // 新腿复位
  assert.equal(next.leg, 2);
  assert.deepEqual(next.legStacks, [[5, 3, 2], [5, 3, 2], [5, 3, 2], [5, 3, 2], [5, 3, 2]]);
  assert.equal(next.pyramidRemaining, 5);
  assert.equal(next.diceRemaining.length, 5);
  for (const player of next.players) {
    assert.deepEqual(player.legTickets, []);
    assert.equal(player.pyramidTickets, 0);
    assert.equal(player.desert.pos, null);
  }
  assert.ok(steps.some((step) => step.kind === 'legScore'));
  assert.ok(steps.some((step) => step.kind === 'legReset'));
});

test('金币不为负：错注罚金在 0 金币时豁免', () => {
  const state = makeState({
    camels: { 14: [1], 11: [0], 9: [2], 8: [3], 7: [4] },
    pyramidRemaining: 1,
    diceRemaining: [0],
    players: [{}, { coins: 0, legTickets: [{ color: 3, value: 5 }] }, {}],
  });
  const next = applyMoveState(state, { kind: 'roll' }, { color: 0, value: 1 });
  assert.equal(next.players[1].coins, 0);
});

test('终局：越过终点线先做腿部结算，再按放置顺序结算总冠/末名押注', () => {
  const state = makeState({
    camels: { 14: [0], 10: [1], 9: [2], 8: [3], 7: [4] },
    pyramidRemaining: 1,
    diceRemaining: [0],
    winnerPile: [
      { player: 1, color: 0 },
      { player: 0, color: 1 },
      { player: 2, color: 0 },
      { player: 0, color: 0 },
    ],
    loserPile: [
      { player: 0, color: 3 },
      { player: 1, color: 4 },
    ],
  });
  const { state: next, steps } = applyMove(state, { kind: 'roll' }, { color: 0, value: 3 });
  // 14 格掷 3 点越过终点线，停在终点线桶
  assert.deepEqual(next.stacks[FINISH_INDEX], [0]);
  assert.equal(next.phase, 'gameEnd');
  assert.deepEqual(rankOf(next), [0, 1, 2, 3, 4]);
  // 腿部结算在押注结算之前
  const firstScore = steps.findIndex((step) => step.kind === 'legScore');
  const firstRace = steps.findIndex((step) => step.kind === 'raceScore');
  assert.ok(firstScore >= 0 && firstScore < firstRace);
  // 总冠堆：玩家 1 命中 +8、玩家 0 错注 -1、玩家 2 命中 +5、玩家 0 命中 +3
  // 总末名堆：玩家 0 错注 -1、玩家 1 命中 +8
  // 玩家 0 另有掷骰金币片 +1
  assert.equal(next.players[0].coins, 5);
  assert.equal(next.players[1].coins, 19);
  assert.equal(next.players[2].coins, 8);
  assert.equal(next.winner, 1);
});

test('押注牌堆结算明细：按放置先后分配 8/5/3/2/1，错注罚 1', () => {
  const state = makeState({
    camels: { 14: [0], 10: [1], 9: [2], 8: [3], 7: [4] },
    winnerPile: [
      { player: 1, color: 2 },
      { player: 0, color: 0 },
      { player: 2, color: 0 },
    ],
    loserPile: [{ player: 0, color: 4 }],
  });
  const payouts = raceBetPayouts(state);
  assert.deepEqual(
    payouts,
    [
      { player: 1, target: 'winner', color: 2, correct: false, gained: -1 },
      { player: 0, target: 'winner', color: 0, correct: true, gained: 8 },
      { player: 2, target: 'winner', color: 0, correct: true, gained: 5 },
      { player: 0, target: 'loser', color: 4, correct: true, gained: 8 },
    ],
  );
  // 腿注收益口径
  const rank = rankOf(state);
  assert.equal(legTicketGain({ color: 0, value: 5 }, rank), 5);
  assert.equal(legTicketGain({ color: 1, value: 2 }, rank), 1);
  assert.equal(legTicketGain({ color: 4, value: 3 }, rank), -1);
});

test('合法行动：腿注拿票、地形块、掷骰、押注牌齐备且稳定排序', () => {
  const state = makeState({
    camels: { 5: [0], 14: [1], 15: [2], 13: [3], 12: [4] },
    players: [{ hand: [0, 2] }],
  });
  const moves = getLegalMoves(state);
  const kinds = moves.map((move) => move.kind);
  assert.equal(kinds[0], 'legBet');
  assert.equal(kinds.filter((kind) => kind === 'legBet').length, 5);
  assert.equal(kinds.includes('roll'), true);
  // 手牌 2 张 × 总冠/总末名 2 个方向
  assert.equal(kinds.filter((kind) => kind === 'raceBet').length, 4);
  assert.equal(kinds[kinds.length - 1], 'raceBet');
  // 掷骰步骤记录骰色点数并消耗塔中骰子
  const { state: next, steps } = applyMove(state, { kind: 'roll' }, { color: 3, value: 2 });
  assert.equal(next.diceRemaining.includes(3), false);
  assert.equal(next.pyramidRemaining, 4);
  assert.equal(next.players[0].pyramidTickets, 1);
  assert.ok(steps.some((step) => step.kind === 'dieRoll' && step.color === 3 && step.value === 2));
  // 回合轮转
  assert.equal(next.current, 1);
});

test('掷骰结果枚举：色与点数等概率，概率和为 1', () => {
  const state = makeState({ diceRemaining: [1, 3] });
  const list = rollOutcomes(state);
  assert.equal(list.length, 6);
  for (const { prob } of list) assert.ok(Math.abs(prob - 1 / 6) < 1e-12);
  assert.ok(Math.abs(list.reduce((sum, item) => sum + item.prob, 0) - 1) < 1e-12);
});

test('cloneState 深拷贝：修改副本不影响原局面', () => {
  const state = makeState({ camels: { 2: [0], 5: [1], 6: [2], 7: [3], 8: [4] } });
  const copy = cloneState(state);
  copy.players[0].coins = 99;
  copy.stacks[2].push(4);
  copy.legStacks[0].pop();
  copy.winnerPile.push({ player: 0, color: 0 });
  assert.equal(state.players[0].coins, 3);
  assert.deepEqual(state.stacks[2], [0]);
  assert.deepEqual(state.legStacks[0], [5, 3, 2]);
  assert.deepEqual(state.winnerPile, []);
});

test('呈现步骤的快照逐级推进且互相独立', () => {
  const state = makeState({ camels: { 2: [0], 5: [1], 6: [2], 7: [3], 8: [4] } });
  const { steps } = applyMove(state, { kind: 'roll' }, { color: 0, value: 3 });
  assert.ok(steps.length >= 3);
  for (const step of steps) {
    assert.notEqual(step.after, state);
  }
  const die = steps.find((step) => step.kind === 'dieRoll');
  const move = steps.find((step) => step.kind === 'camelMove');
  assert.equal(die.after.diceRemaining.length, 4);
  assert.deepEqual(move.after.stacks[5], [1, 0]);
});
