import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chooseMove } from '../src/games/ludo/engine/ai/expectimax.ts';
import { getLegalMoves } from '../src/games/ludo/engine/rules.ts';
import { fixtures } from '../tests/ludo/ai-fixtures.mjs';

const outputIndex = process.argv.indexOf('--out');
const output = resolve(outputIndex < 0 ? '.ai-work/budget-behavior.json' : process.argv[outputIndex + 1]);
const rounds = 15;
const budgets = [
  { name: 'ui', depth: 3, budgetMs: 90, nodeBudget: 80000 },
  { name: 'batch', depth: 3, budgetMs: 12, nodeBudget: 4000 },
];
const results = [];
for (const budget of budgets) {
  for (const fixture of fixtures) {
    const legal = getLegalMoves(fixture.state, fixture.dice);
    for (let warmup = 0; warmup < 3; warmup += 1) chooseMove(fixture.state, fixture.dice, budget);
    const samples = [];
    const completedDepths = {};
    for (let iteration = 0; iteration < rounds; iteration += 1) {
      const startedAt = performance.now();
      const decision = chooseMove(fixture.state, fixture.dice, budget);
      const ms = performance.now() - startedAt;
      assert.ok(decision && legal.some((move) => move.plane === decision.move.plane && move.kind === decision.move.kind));
      assert.ok(decision.nodes <= budget.nodeBudget);
      assert.ok(decision.depth <= budget.depth);
      assert.equal(decision.interrupted, decision.depth < budget.depth);
      completedDepths[decision.depth] = (completedDepths[decision.depth] ?? 0) + 1;
      samples.push({ ms, nodes: decision.nodes, depth: decision.depth, interrupted: decision.interrupted });
    }
    const timings = samples.map((sample) => sample.ms).sort((a, b) => a - b);
    results.push({
      budget: budget.name,
      position: fixture.name,
      budgetMs: budget.budgetMs,
      nodeBudget: budget.nodeBudget,
      requestedDepth: budget.depth,
      p50Ms: timings[Math.floor(timings.length / 2)],
      p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
      maxMs: timings.at(-1),
      minNodes: Math.min(...samples.map((sample) => sample.nodes)),
      maxNodes: Math.max(...samples.map((sample) => sample.nodes)),
      completedDepths,
      allMovesLegal: true,
      nodeCapRespected: true,
      samples,
    });
  }
}
const report = {
  protocol: '6 个固定局面，每个预算/局面预热 3 次后记录 15 次；UI 90ms/80000 节点、批量 12ms/4000 节点，均请求深度 3；延迟为调用前后真实墙钟耗时。JavaScript 的垃圾回收和系统调度可能造成时间预算轻微超出。',
  nodeVersion: process.version, rounds, results,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.table(results.map(({ budget, position, p50Ms, p95Ms, maxMs, maxNodes, completedDepths }) => ({
  budget, position,
  p50Ms: p50Ms.toFixed(3), p95Ms: p95Ms.toFixed(3), maxMs: maxMs.toFixed(3),
  maxNodes, completedDepths: JSON.stringify(completedDepths),
})));
console.log('Report: ' + output);
