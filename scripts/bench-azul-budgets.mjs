import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chooseMove } from '../src/games/azul/engine/ai/search.ts';
import { getLegalMoves } from '../src/games/azul/engine/rules.ts';

const fixtures = JSON.parse(readFileSync(new URL('../tests/azul/reachable-positions.json', import.meta.url), 'utf8'));
const rounds = 9;
const budgets = [
  { name: 'ui', depth: 2, budgetMs: 200, nodeBudget: 120000 },
  { name: 'batch', depth: 2, budgetMs: 8, nodeBudget: 3000 },
];
const baseline = resolve('.ai-work/azul-20261117/original/engine/ai/search.ts');
const engines = [['current', chooseMove]];
if (existsSync(baseline)) engines.push(['original', (await import(pathToFileURL(baseline).href)).chooseMove]);
const results = [];
for (const [engine, choose] of engines) {
  for (const budget of budgets) {
    for (const fixture of fixtures) {
      const legal = getLegalMoves(fixture.state);
      for (let warmup = 0; warmup < 3; warmup += 1) choose(fixture.state, budget);
      const samples = [];
      const depths = {};
      for (let iteration = 0; iteration < rounds; iteration += 1) {
        const startedAt = performance.now();
        const decision = choose(fixture.state, budget);
        const ms = performance.now() - startedAt;
        assert.ok(decision && legal.some((move) =>
          move.source === decision.move.source && move.color === decision.move.color && move.row === decision.move.row));
        assert.ok(decision.nodes <= budget.nodeBudget);
        assert.ok(decision.depth <= budget.depth);
        assert.equal(decision.interrupted, decision.depth < budget.depth);
        depths[decision.depth] = (depths[decision.depth] ?? 0) + 1;
        samples.push({ ms, nodes: decision.nodes, depth: decision.depth });
      }
      const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
      results.push({
        engine, budget: budget.name, name: fixture.name, options: budget,
        medianMs: times[Math.floor(times.length / 2)],
        p95Ms: times[Math.ceil(times.length * 0.95) - 1],
        maxMs: times.at(-1),
        maxNodes: Math.max(...samples.map((sample) => sample.nodes)),
        completedDepths: depths, allMovesLegal: true, nodeCapRespected: true,
        samples,
      });
    }
  }
}
console.table(results.map(({ engine, budget, name, medianMs, maxMs, maxNodes, completedDepths }) => ({
  engine, budget, name, medianMs: medianMs.toFixed(3), maxMs: maxMs.toFixed(3),
  maxNodes, completedDepths: JSON.stringify(completedDepths),
})));
const outputIndex = process.argv.indexOf('--out');
const output = resolve(outputIndex < 0 ? '.ai-work/azul-20261117/budgets.json' : process.argv[outputIndex + 1]);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  protocol: '8个真实可达局面，UI200ms/120000节点、batch8ms/3000节点，各预热3次记录9次；全部请求2层。时间含入口候选估值，JS调度与GC可能产生少量超时。',
  rounds, nodeVersion: process.version, results,
}, null, 2) + '\n');
console.log('Report: ' + output);
