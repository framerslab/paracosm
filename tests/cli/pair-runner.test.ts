import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeCohort, judgePair, type JudgedRun } from '../../src/cli/pair-runner.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

// Atlas Lab loads the way the server loads it at boot: lifted from
// scenarios/atlas-lab.json by the disk loader.
const atlasLab = loadDiskCustomScenarios(resolve(repoRoot, 'scenarios')).get('atlas-lab')?.scenario as ScenarioPackage;

// The 30 Oct 2026 20:24 UTC hosted pair that the judge called a tie.
const atlasPair = JSON.parse(
  readFileSync(resolve(here, '../fixtures/verdict/atlas-lab-pair-2026-10-30.json'), 'utf-8'),
) as { runs: Array<{ leaderName: string; finalState: Record<string, unknown>; fingerprint: Record<string, string> }> };

const PAIR_RESPONSE = {
  winner: 'B',
  winnerName: 'Priya Kapoor',
  headline: 'Priya ships a cleaner model',
  summary: 'Stub verdict.',
  keyDivergence: 'Stub divergence.',
  scores: {
    a: { survival: 6, prosperity: 5, morale: 6, innovation: 6 },
    b: { survival: 7, prosperity: 7, morale: 6, innovation: 6 },
  },
  reasoning: '',
};

const COHORT_RESPONSE = {
  winner: 'Priya Kapoor',
  winnerIndex: 1,
  headline: 'Priya leads the cohort',
  summary: 'Stub verdict.',
  keyDivergence: 'Stub divergence.',
  rankings: [
    { actorName: 'Priya Kapoor', actorIndex: 1, rank: 1, scores: { survival: 7, prosperity: 7, morale: 6, innovation: 6 }, rationale: 'Stub.' },
    { actorName: 'Marcus Reinhardt', actorIndex: 0, rank: 2, scores: { survival: 6, prosperity: 5, morale: 6, innovation: 6 }, rationale: 'Stub.' },
  ],
  reasoning: '',
};

/** Stands in for the provider call and keeps every request it gets. */
function stubModel(response: unknown) {
  const requests: Array<{ prompt: string }> = [];
  const impl = (async (req: { prompt: string }) => {
    requests.push(req);
    return { object: response, text: JSON.stringify(response), usage: {} };
  }) as any;
  return { requests, impl };
}

function captureBroadcast() {
  const events: Array<{ event: string; data: any }> = [];
  return { events, broadcast: (event: string, data: unknown) => { events.push({ event, data }); } };
}

function run(leader: any, index: number, finalState: unknown, fingerprint: unknown = {}): JudgedRun {
  return {
    leader,
    index,
    result: {
      finalState,
      fingerprint,
      forgedToolbox: [],
      totalCitations: 0,
      totalToolsForged: 0,
      cost: { totalCostUSD: 0.1, llmCalls: 40 },
    },
  };
}

function atlasRuns(): JudgedRun[] {
  const leaders = (atlasLab.presets[0] as any).leaders as any[];
  return atlasPair.runs.map((r, i) => {
    const leader = leaders.find(l => l.name === r.leaderName);
    assert.ok(leader, `preset leader ${r.leaderName}`);
    return run(leader, i, r.finalState, r.fingerprint);
  });
}

const credentials = { provider: 'openai' as const, apiKey: 'test-key' };

test('pair verdict on Atlas Lab judges the lab on its own scores, not colony numbers', async () => {
  assert.ok(atlasLab, 'atlas-lab loads from scenarios/');
  const [a, b] = atlasRuns();
  const model = stubModel(PAIR_RESPONSE);
  const { events, broadcast } = captureBroadcast();

  await judgePair({ credentials, verdictModel: 'stub', turns: 6, scenario: atlasLab, broadcast, a, b, generateObjectImpl: model.impl });

  assert.equal(model.requests.length, 1);
  const prompt = model.requests[0].prompt;
  assert.match(prompt, /AlignmentBench[^\n]*0\.80[^\n]*0\.87/);
  assert.match(prompt, /Release Readiness[^\n]*62%[^\n]*76%/);
  assert.match(prompt, /Spec Gaming Rate[^\n]*4\.2%[^\n]*2\.2%[^\n]*lower is better/);
  assert.match(prompt, /Board Confidence[^\n]*45[^\n]*55/);
  assert.match(prompt, /moderate · competitive · held/);
  assert.match(prompt, /high · competitive · held/);
  assert.match(prompt, /release director/);
  assert.doesNotMatch(prompt, /colon(y|ies)/i);

  const verdict = events.find(e => e.event === 'verdict');
  assert.ok(verdict, 'verdict broadcast');
  const rows = verdict.data.finalStats.metrics as Array<{ id: string; label: string; format: string; better?: string; a: number; b: number }>;
  assert.deepEqual(rows.map(r => r.id), atlasLab.ui.headerMetrics.map(h => h.id));
  const gaming = rows.find(r => r.id === 'specGamingRate')!;
  assert.equal(gaming.label, 'Spec Gaming Rate');
  assert.equal(gaming.format, 'percent');
  assert.equal(gaming.better, 'lower');
  assert.equal(gaming.a, 0.042);
  assert.equal(gaming.b, 0.022);
  // The colony fields stay in place for the existing card.
  assert.equal(verdict.data.finalStats.a.population, 34);
});

test('pair verdict on Mars still weighs population, morale, food and power', async () => {
  const initial = Object.fromEntries(
    Object.entries(marsScenario.world.metrics).map(([id, def]) => [id, (def as { initial: number }).initial]),
  ) as Record<string, number>;
  const stateA = { metrics: { ...initial } };
  const stateB = { metrics: { ...initial, population: initial.population - 3, morale: initial.morale - 0.1, foodMonthsReserve: initial.foodMonthsReserve - 2, powerKw: initial.powerKw - 20 } };
  const [leaderA, leaderB] = (marsScenario.presets[0] as any).leaders as any[];
  const model = stubModel({ ...PAIR_RESPONSE, winner: 'A', winnerName: leaderA.name });
  const { broadcast } = captureBroadcast();

  await judgePair({
    credentials, verdictModel: 'stub', turns: 6, scenario: marsScenario, broadcast,
    a: run(leaderA, 0, stateA), b: run(leaderB, 1, stateB), generateObjectImpl: model.impl,
  });

  const prompt = model.requests[0].prompt;
  assert.match(prompt, new RegExp(`Population[^\\n]*${initial.population}[^\\n]*${initial.population - 3}`));
  assert.match(prompt, /Morale[^\n]*%/);
  assert.match(prompt, /Food/);
  assert.match(prompt, /Power/);
  assert.match(prompt, /colony/);
});

test('cohort verdict on Atlas Lab gets the same scenario scores', async () => {
  const runs = atlasRuns();
  const model = stubModel(COHORT_RESPONSE);
  const { events, broadcast } = captureBroadcast();

  await judgeCohort({ credentials, verdictModel: 'stub', turns: 6, scenario: atlasLab, broadcast, runs, generateObjectImpl: model.impl });

  const prompt = model.requests[0].prompt;
  assert.match(prompt, /AlignmentBench[^\n]*0\.80[^\n]*0\.87/);
  assert.match(prompt, /Spec Gaming Rate[^\n]*4\.2%[^\n]*2\.2%/);
  assert.doesNotMatch(prompt, /colon(y|ies)/i);
  const cohort = events.find(e => e.event === 'cohort_verdict');
  assert.ok(cohort, 'cohort verdict broadcast');
  const priya = cohort.data.finalStats.find((s: any) => s.actorName === 'Priya Kapoor');
  assert.equal(priya.metrics.find((m: any) => m.id === 'alignmentBench').value, 0.87);
});
