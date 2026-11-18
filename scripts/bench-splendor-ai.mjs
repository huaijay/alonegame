import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { applyMove, createInitialState, getLegalMoves, moveKey, tokenCount } from '../src/games/splendor/engine/rules.ts';
import { GEM_COLORS } from '../src/games/splendor/engine/types.ts';

function argument(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const rounds = Number(argument('rounds', 5));
const warmup = Number(argument('warmup', 2));
const seedGroups = Number(argument('match-groups', 0));
const players = Number(argument('players', 2));
const strength = argument('strength', 'hard');
const opponent = argument('opponent', 'original');
const names = argument('names', '').split(',').filter(Boolean);
const strengths = argument('strengths', 'easy,normal,hard,expert').split(',');
const maxTurns = Number(argument('max-turns', 500));
const matchTimeProfile = process.argv.includes('--match-time-profile');
const matchNodeText = argument('match-nodes', null);
const matchNodes = matchNodeText === null ? null : Number(matchNodeText);
if (matchNodes !== null && (!Number.isSafeInteger(matchNodes) || matchNodes < 0)) throw new RangeError('match-nodes out of range');
const output = argument('out', null);
const skipBenchmark = process.argv.includes('--skip-benchmark');
const baselineOnly = process.argv.includes('--baseline-only');
const baselinePath = resolve(argument('baseline', '.ai-work/splendor-20261118/original/splendor/engine/ai/search.ts'));
const currentPath = resolve(argument('current', 'src/games/splendor/engine/ai/search.ts'));
const baseline = existsSync(baselinePath) ? (await import(pathToFileURL(baselinePath).href)).analyzeMoves : null;
const current = baselineOnly ? null : (await import(pathToFileURL(currentPath).href)).analyzeMoves;
for (const [name, value, min, max] of [['rounds', rounds, 1, 100], ['warmup', warmup, 0, 100],
  ['match-groups', seedGroups, 0, 1000], ['players', players, 2, 4], ['max-turns', maxTurns, 1, 5000]]) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(name + ' out of range');
}
const levels = ['easy', 'normal', 'hard', 'expert'];
for (const value of [...strengths, strength, opponent]) {
  if (value !== 'original' && !levels.includes(value)) throw new RangeError('Unknown strength: ' + value);
}
if (baselineOnly && !baseline) throw new Error('Original snapshot missing');
const fixtures = [
  ...JSON.parse(readFileSync(new URL('../tests/splendor/reachable-positions.json', import.meta.url), 'utf8')),
  JSON.parse(readFileSync(new URL('../tests/splendor/token-limit-position.json', import.meta.url), 'utf8')),
].filter((fixture) => names.length === 0 || names.includes(fixture.name));
if (!skipBenchmark && fixtures.length === 0) throw new Error('No matching fixtures');

function legalDecision(state, analysis) {
  assert.ok(getLegalMoves(state).some((move) => moveKey(move) === moveKey(analysis.chosen)), 'illegal decision');
  const next = applyMove(state, analysis.chosen).state;
  for (const player of next.players) assert.ok(tokenCount(player.tokens) <= next.rules.tokenLimit);
  for (const color of [...GEM_COLORS, 'gold']) {
    assert.equal(next.bank[color] + next.players.reduce((sum, player) => sum + player.tokens[color], 0),
      color === 'gold' ? next.rules.goldSupply : next.rules.gemSupply);
  }
  return next;
}

function sample(engine, state, options) {
  for (let i = 0; i < warmup; i++) engine(state, options);
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const startedAt = performance.now();
    const analysis = engine(state, options);
    const ms = performance.now() - startedAt;
    legalDecision(state, analysis);
    samples.push({ ms, nodes: analysis.nodes ?? null, depth: analysis.depth ?? 0,
      requestedDepth: analysis.requestedDepth ?? 0, interrupted: analysis.interrupted ?? false,
      candidates: analysis.totalCandidates ?? analysis.candidates.length, chosen: analysis.chosen });
  }
  const times = samples.map((item) => item.ms).sort((a, b) => a - b);
  return { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    maxMs: times.at(-1), samples };
}

const results = [];
for (const fixture of skipBenchmark ? [] : fixtures) {
  if (baseline) results.push({ name: fixture.name, strength: 'original', ...sample(baseline, fixture.state) });
  if (current) for (const level of strengths) {
    results.push({ name: fixture.name, strength: level, ...sample(current, fixture.state, { strength: level }) });
  }
}
if (results.length) console.table(results.map((row) => ({
  position: row.name, strength: row.strength, medianMs: row.medianMs.toFixed(3), p95Ms: row.p95Ms.toFixed(3),
  depths: row.samples.map((sample) => sample.depth).join(','), maxNodes: Math.max(...row.samples.map((sample) => sample.nodes ?? 0)),
})));

let matches = null;
if (seedGroups > 0) {
  if (!current || (opponent === 'original' && !baseline)) throw new Error('Match engines unavailable');
  const games = [];
  const startedAt = performance.now();
  for (let group = 0; group < seedGroups; group++) {
    const seed = (0x5a1811 + group * 2654435761) >>> 0;
    for (let leftSeat = 0; leftSeat < players; leftSeat++) {
      let state = createInitialState(players, seed);
      const decisions = { left: { nodes: 0, ms: 0, moves: 0, depths: {} }, right: { nodes: 0, ms: 0, moves: 0, depths: {} } };
      while (state.phase === 'playing' && state.turn < maxTurns) {
        const side = state.current === leftSeat ? 'left' : 'right';
        const level = side === 'left' ? strength : opponent;
        const engine = level === 'original' ? baseline : current;
        // 缺省沿用档位节点预算，也可显式限制预算作快速对照；时间放宽后不受机器忙闲影响。
        const begin = performance.now();
        const analysis = engine(state, level === 'original' ? undefined
          : { strength: level, ...(matchTimeProfile ? {} : { budgetMs: 1e9 }),
            ...(matchNodes === null ? {} : { nodeBudget: matchNodes }) });
        const elapsed = performance.now() - begin;
        const stats = decisions[side];
        stats.nodes += analysis.nodes ?? 0;
        stats.ms += elapsed;
        stats.moves += 1;
        stats.depths[analysis.depth ?? 0] = (stats.depths[analysis.depth ?? 0] ?? 0) + 1;
        state = legalDecision(state, analysis);
      }
      const finished = state.phase === 'finished';
      const record = { seed, leftSeat, phase: state.phase, turns: state.turn, winners: state.winners,
        points: state.players.map((player) => player.points), cards: state.players.map((player) => player.cards.length),
        leftShare: finished && state.winners.includes(leftSeat) ? 1 / state.winners.length : 0,
        outcome: !finished ? 'unfinished' : state.winners.includes(leftSeat) ? (state.winners.length === 1 ? 'win' : 'shared') : 'loss',
        decisions };
      games.push(record);
      console.error('game ' + games.length + '/' + seedGroups * players + ': ' + record.outcome + ', ' + record.turns + ' turns');
      if (output) {
        const checkpoint = resolve(output + '.partial.json');
        mkdirSync(dirname(checkpoint), { recursive: true });
        writeFileSync(checkpoint, JSON.stringify({ partial: true, strength, opponent, players,
          seedGroups, matchNodes, matchTimeProfile, finishedGames: games.length, records: games }, null, 2) + '\n');
      }
    }
    if ((group + 1) % 5 === 0) console.error('completed ' + (group + 1) + '/' + seedGroups + ' seed groups');
  }
  matches = {
    protocol: '固定种子，每组轮换左侧算法所有座位，其余席位为右侧；真实规则推进。' +
      (matchTimeProfile ? '使用真实界面时间预算，完成深度会受运行时调度影响。' : '时间放宽以固定节点复现。') +
      (matchNodes === null ? '新版沿用各自档位节点预算。' : '新版统一使用显式诊断节点上限，不代表完整档位预算。') +
      '原版为单步启发且可能读取真实牌堆；新版只按公开信息抽样。',
    strength, opponent, players, seedGroups, maxTurns, matchNodes, matchTimeProfile, games: games.length,
    wins: games.filter((game) => game.outcome === 'win').length,
    shared: games.filter((game) => game.outcome === 'shared').length,
    losses: games.filter((game) => game.outcome === 'loss').length,
    unfinished: games.filter((game) => game.outcome === 'unfinished').length,
    winShares: games.reduce((sum, game) => sum + game.leftShare, 0),
    elapsedMs: performance.now() - startedAt, records: games,
  };
  const { records, ...summary } = matches;
  console.log(JSON.stringify(summary, null, 2));
}
const report = { nodeVersion: process.version, rounds, warmup, baselinePath, currentPath,
  protocol: '原版为单步启发，新版按档位多步搜索；时间为端到端工作量，不宣称同树提速。固定夹具来自原版真实有种子对局。',
  results, matches };
if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log('Report: ' + path);
}
