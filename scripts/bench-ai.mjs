import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chooseMove } from '../src/games/ludo/engine/ai/expectimax.ts';
import { createEvaluator } from '../src/games/ludo/engine/ai/evaluate.ts';
import { applyMove, createInitialState, getLegalMoves, passTurn } from '../src/games/ludo/engine/rules.ts';
import { createRng, rollDice } from '../src/games/ludo/engine/rng.ts';
import { fixtures } from '../tests/ludo/ai-fixtures.mjs';

function argument(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const depth = Number(argument('depth', 2));
const rounds = Number(argument('rounds', 9));
// 保留原有参数名；多人模式下它表示种子组数，每组轮换所有座位。
const seedGroups = Number(argument('match-pairs', 0));
const matchPlayers = Number(argument('match-players', 2));
const skipBenchmark = process.argv.includes('--skip-benchmark');
for (const [name, value, minimum, maximum] of [['depth', depth, 0, 4], ['rounds', rounds, 1, 100], ['match-pairs', seedGroups, 0, 1000], ['match-players', matchPlayers, 2, 4]]) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(name + ' out of range');
}
const options = { depth, budgetMs: 1e9, nodeBudget: 1e9 };
const baselinePath = resolve(argument('baseline', '.ai-work/original/game/ai/expectimax.ts'));
const original = existsSync(baselinePath) ? (await import(pathToFileURL(baselinePath).href)).chooseMove : null;

// 同一新版估值与 Max-n 决策模型，使用正式不可变规则，无缓存、无等价分支合并。
function naiveChoose(state, dice) {
  const evaluator = createEvaluator();
  let nodes = 0;
  function search(position, remaining) {
    nodes += 1;
    if (remaining === 0 || position.winner !== null) return evaluator.evaluateAll(position);
    const total = position.seats.map(() => 0);
    for (let roll = 1; roll <= 6; roll += 1) {
      const moves = getLegalMoves(position, roll).sort((a, b) =>
        position.planes[position.current][a.plane] - position.planes[position.current][b.plane] || a.plane - b.plane);
      let best;
      if (moves.length === 0) best = search(passTurn(position), remaining - 1);
      else for (const move of moves) {
        const candidate = search(applyMove(position, move, roll).state, remaining - 1);
        if (!best || candidate[position.current] > best[position.current] + 1e-9) best = candidate;
      }
      for (let player = 0; player < total.length; player += 1) total[player] += best[player];
    }
    return total.map((value) => value / 6);
  }
  const candidates = getLegalMoves(state, dice).map((move) => ({
    move, value: search(applyMove(state, move, dice).state, depth)[state.current],
  })).sort((a, b) => Math.abs(b.value - a.value) <= 1e-9 ? a.move.plane - b.move.plane : b.value - a.value);
  return { ...candidates[0], candidates, nodes, depth };
}

function sample(engine, fixture) {
  for (let i = 0; i < 3; i += 1) engine(fixture.state, fixture.dice, options);
  const timings = [];
  let result;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    result = engine(fixture.state, fixture.dice, options);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return {
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)],
    nodes: result.nodes,
    depth: result.depth,
    cacheHits: result.cacheHits ?? null,
    move: result.move,
    value: result.value,
  };
}

const results = [];
for (const fixture of skipBenchmark ? [] : fixtures) {
  const naive = sample(naiveChoose, fixture);
  const current = sample(chooseMove, fixture);
  if (Math.abs(current.value - naive.value) > 1e-7) throw new Error('Oracle mismatch: ' + fixture.name);
  results.push({
    name: fixture.name,
    current,
    naive,
    original: original ? sample(original, fixture) : null,
    speedupVsNaive: naive.medianMs / current.medianMs,
  });
}
if (results.length > 0) console.table(results.map((result) => ({
  position: result.name,
  currentMs: result.current.medianMs.toFixed(3),
  naiveMs: result.naive.medianMs.toFixed(3),
  originalMs: result.original?.medianMs.toFixed(3) ?? 'unavailable',
  speedupVsNaive: result.speedupVsNaive.toFixed(2),
  nodes: result.current.nodes,
  cacheHits: result.current.cacheHits,
})));

let matches = null;
if (seedGroups > 0) {
  if (!original) throw new Error('Match comparison requires --baseline <original expectimax.ts>');
  const games = [];
  const matchStarted = performance.now();
  const seats = matchPlayers === 2 ? [0, 2] : matchPlayers === 3 ? [0, 1, 3] : [0, 1, 2, 3];
  for (let group = 0; group < seedGroups; group += 1) {
    const seed = (0xace120 + group * 2654435761) >>> 0;
    for (let currentPlayer = 0; currentPlayer < matchPlayers; currentPlayer += 1) {
      const rng = createRng(seed);
      let state = createInitialState(seats);
      while (state.winner === null && state.rolls < 1500) {
        const dice = rollDice(rng);
        if (getLegalMoves(state, dice).length === 0) state = passTurn(state);
        else {
          const engine = state.current === currentPlayer ? chooseMove : original;
          const decision = engine(state, dice, options);
          if (!decision) throw new Error('Missing legal decision');
          state = applyMove(state, decision.move, dice).state;
        }
      }
      games.push({
        seed, currentPlayer, currentSeat: seats[currentPlayer], winnerSeat: state.winner, rolls: state.rolls,
        winner: state.winner === null ? 'draw' : state.winner === state.seats[currentPlayer] ? 'current' : 'original',
      });
    }
    if ((group + 1) % 5 === 0) console.error(`completed ${group + 1}/${seedGroups} seed groups (${matchPlayers} players)`);
  }
  matches = {
    protocol: `${matchPlayers} 人，各种子轮换新版所在座位 ${matchPlayers} 次，其余玩家均为旧版；所有玩家相同完整搜索深度，固定骰子种子；originalWins 是所有旧版玩家胜场合计，不是 Elo 评级`,
    seedGroups, players: matchPlayers, seats, gameCount: games.length,
    pairs: matchPlayers === 2 ? seedGroups : undefined,
    equalSeatChance: 1 / matchPlayers,
    currentWinRate: games.filter((game) => game.winner === 'current').length / games.length,
    elapsedMs: performance.now() - matchStarted,
    currentWins: games.filter((game) => game.winner === 'current').length,
    originalWins: games.filter((game) => game.winner === 'original').length,
    draws: games.filter((game) => game.winner === 'draw').length,
    games,
  };
  const { games: _, ...summary } = matches;
  console.log(JSON.stringify({ matches: summary }, null, 2));
}
const report = {
  nodeVersion: process.version,
  platform: process.platform,
  depth, rounds, benchmarkSkipped: skipBenchmark,
  protocol: '固定局面、3 次预热；新版与无缓存 Max-n 共享新版估值；原算法采用旧估值且所有玩家替根玩家最大化，旧 nodes 口径不同，不应直接比较节点效率。',
  results, matches,
};
const output = argument('out', null);
if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log('Report: ' + path);
}
