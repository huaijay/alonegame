import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { emptyGems, emptyTokens } from '../../src/games/splendor/engine/board.ts';
import { GEM_COLORS } from '../../src/games/splendor/engine/types.ts';
import { applyMove, applyMoveState, createInitialState, getLegalMoves, tokenCount } from '../../src/games/splendor/engine/rules.ts';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

test('无事件快路径与正式规则在真实固定局面全部合法行动上相同，输入深冻结不变', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./reachable-positions.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) {
    const state = freeze(fixture.state);
    const before = JSON.stringify(state);
    for (const move of getLegalMoves(state)) {
      const animated = applyMove(state, move);
      const next = applyMoveState(state, move);
      assert.deepEqual(next, animated.state, fixture.name + ' ' + JSON.stringify(move));
      assert.ok(animated.events.length > 0);
      for (const color of [...GEM_COLORS, 'gold']) {
        assert.equal(next.bank[color] + next.players.reduce((sum, player) => sum + player.tokens[color], 0),
          color === 'gold' ? next.rules.goldSupply : next.rules.gemSupply);
      }
      for (const player of next.players) assert.ok(tokenCount(player.tokens) <= next.rules.tokenLimit);
    }
    assert.equal(JSON.stringify(state), before);
  }
});

test('连续自动退筹使用更新后的剩余持仓，不重复丢掉已不足的目标颜色', () => {
  const state = createInitialState(2, 12, { tokenLimit: 6, nobleCount: 0 });
  state.current = 0;
  state.market = [[{ id: 'return-target', tier: 1, bonus: 'white', points: 1,
    cost: { ...emptyGems(), blue: 2, green: 1 } }], [], []];
  state.decks = [[], [], []];
  state.players[0].tokens = { ...emptyTokens(), blue: 3, green: 1, gold: 2 };
  for (const color of [...GEM_COLORS, 'gold']) state.bank[color] -= state.players[0].tokens[color];
  const move = { kind: 'take', colors: ['blue', 'green', 'red'] };
  const result = applyMove(freeze(state), move);
  assert.deepEqual(result.state.players[0].tokens, { ...emptyTokens(), blue: 3, green: 1, gold: 2 });
  assert.deepEqual(result.state, applyMoveState(state, move));
  assert.equal(result.events.filter((event) => event.kind === 'discard').length, 1);
});

test('显式退筹和指定贵族仍通过相同规则核心执行', () => {
  const state = createInitialState(2, 9, { tokenLimit: 6, nobleCount: 0 });
  state.players[0].tokens = { ...emptyTokens(), white: 2, blue: 2, green: 2 };
  for (const color of GEM_COLORS) state.bank[color] -= state.players[0].tokens[color];
  const move = { kind: 'take', colors: ['white', 'blue', 'red'], returns: ['green', 'green', 'red'] };
  assert.deepEqual(applyMoveState(freeze(state), move), applyMove(state, move).state);
  assert.equal(applyMove(state, move).state.players[0].tokens.green, 0);

  const nobleState = createInitialState(2, 9, { nobleCount: 0 });
  nobleState.market[0][0] = { id: 'noble-trigger', tier: 1, bonus: 'white', points: 0, cost: emptyGems() };
  nobleState.nobles = [
    { id: 'first-eligible', points: 3, requirement: { ...emptyGems(), white: 1 } },
    { id: 'chosen-eligible', points: 3, requirement: { ...emptyGems(), white: 1 } },
  ];
  const purchase = { kind: 'buy', source: 'market', tier: 1, slot: 0, nobleId: 'chosen-eligible' };
  const next = applyMoveState(freeze(nobleState), purchase);
  assert.deepEqual(next, applyMove(nobleState, purchase).state);
  assert.equal(next.players[0].nobles[0].id, 'chosen-eligible');
  assert.equal(next.nobles[0].id, 'first-eligible');
});

test('从共享快路径结果继续推进不会回写旧局面或回放帧', () => {
  let state = createInitialState(3, 825);
  const history = [state];
  const serializations = [JSON.stringify(state)];
  for (let turn = 0; turn < 18; turn++) {
    state = applyMoveState(state, getLegalMoves(state)[turn % getLegalMoves(state).length]);
    history.push(state);
    serializations.push(JSON.stringify(state));
  }
  history.forEach((position, index) => assert.equal(JSON.stringify(position), serializations[index]));
});
