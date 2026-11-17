import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createInitialState, applyMove, advanceState, getLegalMoves, startNextRound } from '../src/games/azul/engine/rules.ts';
import { createRng } from '../src/games/azul/engine/rng.ts';
import { WIN_VALUE } from '../src/games/azul/engine/ai/evaluate.ts';
import { repeatsPosition } from '../tests/azul/reference-policy.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const depth = Number(argument('depth', 1));
const rounds = Number(argument('rounds', 7));
const warmup = Number(argument('warmup', 3));
const selectedNames = argument('names', '').split(',').filter(Boolean);
const seedGroups = Number(argument('match-groups', 0));
const matchPlayers = Number(argument('players', 2));
const matchNodes = Number(argument('match-nodes', 3000));
const baselineOnly = process.argv.includes('--baseline-only');
const skipBenchmark = process.argv.includes('--skip-benchmark');
const skipNaive = process.argv.includes('--skip-naive');
const baselinePath = resolve(argument('baseline', '.ai-work/azul-20261117/original/engine/ai/search.ts'));
const currentPath = resolve(argument('current', 'src/games/azul/engine/ai/search.ts'));
for (const [name, value, min, max] of [['depth', depth, 0, 3], ['rounds', rounds, 1, 100], ['warmup', warmup, 0, 100],
  ['match-groups', seedGroups, 0, 1000], ['players', matchPlayers, 2, 4], ['match-nodes', matchNodes, 0, 1e9]]) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(name + ' out of range');
}
const original = existsSync(baselinePath) ? (await import(pathToFileURL(baselinePath).href)).chooseMove : null;
if (baselineOnly && !original) throw new Error('Baseline source missing: ' + baselinePath);
const current = baselineOnly ? null : (await import(pathToFileURL(currentPath).href)).chooseMove;
const evaluatorFactory = baselineOnly ? null : (await import(pathToFileURL(resolve(dirname(currentPath), 'evaluate.ts')).href)).createEvaluator;
const fixtures = JSON.parse(readFileSync(new URL('../tests/azul/reachable-positions.json', import.meta.url), 'utf8'))
  .filter((fixture) => selectedNames.length === 0 || selectedNames.includes(fixture.name));
if (!skipBenchmark && fixtures.length === 0) throw new Error('No matching fixtures');
const options = { depth, budgetMs: 1e9, nodeBudget: 1e9 };

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

function afterMove(state, move) {
  const next = applyMove(state, move).state;
  return next.phase === 'roundEnd' && next.bag.every((count) => count === 0)
    && next.discard.every((count) => count === 0) ? startNextRound(next) : next;
}

// 同新版估值、同轮末边界、同Max-n契约，独立使用带动画规则完整枚举。
function naiveChoose(state) {
  const evaluator = evaluatorFactory();
  let nodes = 0;
  function search(position, remaining) {
    nodes += 1;
    if (remaining === 0 || position.phase !== 'placing') return evaluator.evaluateAll(position);
    const player = position.current;
    let best;
    for (const move of canonicalMoves(position)) {
      const after = afterMove(position, move);
      if (repeatsPosition(position, move, after)) continue;
      const values = search(after, remaining - 1);
      if (!best || values[player] > best[player] + 1e-9) best = values;
    }
    return best ?? evaluator.evaluateAll(position);
  }
  const branches = getLegalMoves(state).map((move) => {
    const after = afterMove(state, move);
    return { move, after, repeated: repeatsPosition(state, move, after) };
  });
  const hasProgress = branches.some((branch) => !branch.repeated);
  const candidates = branches.map(({ move, after, repeated }) => ({
    move, value: hasProgress && repeated ? -WIN_VALUE - 1 : search(after, depth)[state.current],
  })).sort((a, b) => Math.abs(b.value - a.value) > 1e-9 ? b.value - a.value : 0);
  return { ...candidates[0], candidates, nodes, depth };
}

function sample(engine, state, searchOptions) {
  for (let i = 0; i < warmup; i += 1) engine(state, searchOptions);
  const elapsed = [];
  let decision;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    decision = engine(state, searchOptions);
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  return {
    decision,
    summary: {
      medianMs: elapsed[Math.floor(elapsed.length / 2)],
      p95Ms: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
      nodes: decision.nodes, depth: decision.depth,
      candidates: decision.candidates.length, cacheHits: decision.cacheHits ?? null,
      move: decision.move, value: decision.value,
    },
  };
}

const results = [];
for (const fixture of skipBenchmark ? [] : fixtures) {
  const naive = current && !skipNaive ? sample(naiveChoose, fixture.state, options) : null;
  const optimized = current ? sample(current, fixture.state, options) : null;
  if (naive && optimized) {
    assert.deepEqual(optimized.decision.move, naive.decision.move, fixture.name + ' selected move');
    assert.equal(optimized.decision.candidates.length, naive.decision.candidates.length);
    for (const expected of naive.decision.candidates) {
      const candidate = optimized.decision.candidates.find(({ move }) =>
        move.source === expected.move.source && move.color === expected.move.color && move.row === expected.move.row);
      assert.ok(candidate && Math.abs(candidate.value - expected.value) < 1e-7, fixture.name + ' candidate oracle mismatch');
    }
  }
  results.push({
    name: fixture.name,
    original: original ? sample(original, fixture.state, options).summary : null,
    current: optimized?.summary ?? null,
    naive: naive?.summary ?? null,
  });
}
if (results.length > 0) console.table(results.map((row) => ({
  position: row.name,
  originalMs: row.original?.medianMs.toFixed(3),
  currentMs: row.current?.medianMs.toFixed(3),
  naiveMs: row.naive?.medianMs.toFixed(3),
  originalNodes: row.original?.nodes,
  currentNodes: row.current?.nodes,
  candidates: row.current?.candidates ?? row.original?.candidates,
})));

let matches = null;
if (seedGroups > 0) {
  if (!original || !current) throw new Error('Matches require both engines');
  const seats = matchPlayers === 2 ? [0, 2] : matchPlayers === 3 ? [0, 1, 3] : [0, 1, 2, 3];
  const matchOptions = { depth, nodeBudget: matchNodes, budgetMs: 1e9 };
  const games = [];
  const startedAt = performance.now();
  for (let group = 0; group < seedGroups; group += 1) {
    const seed = (0xa20117 + group * 2654435761) >>> 0;
    for (let newPlayer = 0; newPlayer < matchPlayers; newPlayer += 1) {
      const rng = createRng(seed);
      let state = createInitialState(seats, rng);
      let moves = 0;
      const depths = { current: {}, original: {} };
      while (state.phase !== 'gameEnd' && moves < 1000) {
        if (state.phase === 'roundEnd') { state = startNextRound(state, rng); continue; }
        const engineName = state.current === newPlayer ? 'current' : 'original';
        const engine = engineName === 'current' ? current : original;
        const decision = engine(state, matchOptions);
        assert.ok(decision && getLegalMoves(state).some((move) =>
          move.source === decision.move.source && move.color === decision.move.color && move.row === decision.move.row));
        depths[engineName][decision.depth] = (depths[engineName][decision.depth] ?? 0) + 1;
        state = advanceState(state, decision.move, rng);
        moves += 1;
      }
      games.push({
        seed, newPlayer, winnerSeat: state.winner, scores: state.players.map((board) => board.score),
        rounds: state.round, moves, depths,
        winner: state.phase !== 'gameEnd' ? 'unfinished' : state.winner === seats[newPlayer] ? 'current' : 'original',
      });
    }
    if ((group + 1) % 5 === 0) console.error('completed ' + (group + 1) + '/' + seedGroups + ' seed groups');
  }
  matches = {
    protocol: '每种子轮换新版所有座位，其余玩家均旧版；双方同节点预算和请求深度、同种子补盘，使用正式当前规则；时间上限放宽以保证复现，非Elo。',
    seedGroups, players: matchPlayers, options: matchOptions, gameCount: games.length,
    currentWins: games.filter((game) => game.winner === 'current').length,
    originalWins: games.filter((game) => game.winner === 'original').length,
    unfinished: games.filter((game) => game.winner === 'unfinished').length,
    elapsedMs: performance.now() - startedAt,
    games,
  };
  const { games: recordedGames, ...summary } = matches;
  console.log(JSON.stringify({ matches: summary, recordedGames: recordedGames.length }, null, 2));
}
const report = {
  nodeVersion: process.version, depth, rounds, warmup, baselinePath, currentPath, benchmarkSkipped: skipBenchmark,
  protocol: '真实可达固定局面；naive与新版共享估值和轮末边界。原版会跨入虚构的确定性补盘且估值不同，时间数据是端到端对照，不表示搜索目标完全相同。',
  results, matches,
};
const output = argument('out', null);
if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log('Report: ' + path);
}
