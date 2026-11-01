import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeCohort, judgePair, type JudgedRun } from '../../src/cli/pair-runner.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { compileScenario } from '../../src/engine/compiler/index.js';
import { DraftScenarioSchema } from '../../src/engine/compiler/compile-from-seed.js';
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

/** A bundled scenario JSON as it sits on disk. */
function scenarioFile(name: string): ScenarioPackage {
  return JSON.parse(readFileSync(resolve(repoRoot, 'scenarios', `${name}.json`), 'utf-8')) as ScenarioPackage;
}

function initialMetrics(scenario: ScenarioPackage): Record<string, number> {
  return Object.fromEntries(
    Object.entries(scenario.world.metrics).map(([id, def]) => [id, (def as { initial: number }).initial]),
  ) as Record<string, number>;
}

const LEADER_A = { name: 'Lee', archetype: 'The Planner', unit: 'Alpha' } as any;
const LEADER_B = { name: 'Noor', archetype: 'The Gambler', unit: 'Beta' } as any;

async function judgeStates(scenario: ScenarioPackage, stateA: unknown, stateB: unknown) {
  const model = stubModel(PAIR_RESPONSE);
  const { events, broadcast } = captureBroadcast();
  await judgePair({
    credentials, verdictModel: 'stub', turns: 6, scenario, broadcast,
    a: run(LEADER_A, 0, stateA), b: run(LEADER_B, 1, stateB), generateObjectImpl: model.impl,
  });
  const verdict = events.find(e => e.event === 'verdict');
  return { prompt: model.requests[0]?.prompt ?? '', events, verdict, rows: (verdict?.data.finalStats.metrics ?? []) as any[] };
}

/**
 * A Quickstart scenario: the draft shape the seed compiler's schema
 * accepts, through the real compiler, with hook generation failing
 * over to its fallbacks. Its metrics carry only id and format, its
 * world and its header list are empty.
 */
async function quickstartScenario(): Promise<ScenarioPackage> {
  const draft = DraftScenarioSchema.parse({
    id: 'indie-studio',
    labels: { name: 'Indie Studio', populationNoun: 'staff', settlementNoun: 'studio', timeUnitNoun: 'quarter', currency: 'USD' },
    setup: { defaultTurns: 4, defaultPopulation: 40, defaultStartTime: 1 },
    departments: [
      { id: 'design', label: 'Design', role: 'Lead Designer', instructions: 'Weigh the roadmap against player feedback.' },
      { id: 'finance', label: 'Finance', role: 'Finance Lead', instructions: 'Weigh spend against the revenue plan.' },
    ],
    metrics: [
      { id: 'annual-revenue', format: 'currency' },
      { id: 'churn', format: 'percent', better: 'lower' },
    ],
  });
  return compileScenario(draft as unknown as Record<string, unknown>, {
    cache: false,
    generateText: async () => 'not a hook',
  });
}

const KERNEL_METRICS = { population: 40, morale: 0.7, powerKw: 400, foodMonthsReserve: 18 };

test('a Quickstart pair gets a verdict though its metrics name no source or label', async () => {
  const scenario = await quickstartScenario();
  const { prompt, verdict, rows } = await judgeStates(
    scenario,
    { metrics: { ...KERNEL_METRICS, 'annual-revenue': 1200, churn: 0.05 } },
    { metrics: { ...KERNEL_METRICS, 'annual-revenue': 1500, churn: 0.03 } },
  );
  assert.ok(verdict, 'verdict broadcast');
  assert.match(prompt, /annual-revenue[^\n]*1200 USD[^\n]*1500 USD/);
  assert.match(prompt, /churn[^\n]*5%[^\n]*3%[^\n]*lower is better/);
  assert.equal(rows.find(r => r.id === 'annual-revenue').currency, 'USD');
  assert.equal(rows.find(r => r.id === 'churn').better, 'lower');
});

test('a Quickstart cohort is judged on the final numbers when no run holds a declared score', async () => {
  const scenario = await quickstartScenario();
  const model = stubModel(COHORT_RESPONSE);
  const { events, broadcast } = captureBroadcast();
  await judgeCohort({
    credentials, verdictModel: 'stub', turns: 4, scenario, broadcast, generateObjectImpl: model.impl,
    runs: [
      run(LEADER_A, 0, { metrics: { ...KERNEL_METRICS, population: 38 } }),
      run(LEADER_B, 1, { metrics: KERNEL_METRICS }),
    ],
  });
  assert.ok(events.find(e => e.event === 'cohort_verdict'), 'cohort verdict broadcast');
  const prompt = model.requests[0].prompt;
  assert.match(prompt, /population[^\n]*#1 38[^\n]*#2 40/);
  assert.doesNotMatch(prompt, /#1 n\/a/);
});

test('a verdict prompt that cannot be built reports a skipped verdict and leaves the run to finish', async () => {
  const broken = { metrics: KERNEL_METRICS, eventLog: {} };
  const cohort = captureBroadcast();
  await judgeCohort({
    credentials, verdictModel: 'stub', turns: 6, scenario: atlasLab, broadcast: cohort.broadcast,
    generateObjectImpl: stubModel(COHORT_RESPONSE).impl,
    runs: [run(LEADER_A, 0, broken), run(LEADER_B, 1, broken)],
  });
  assert.equal(cohort.events.find(e => e.event === 'verdict_skipped')?.data.reason, 'generation_failed');

  const { events } = await judgeStates(atlasLab, broken, broken);
  const skipped = events.find(e => e.event === 'verdict_skipped');
  assert.equal(skipped?.data.mode, 'pair');
  assert.equal(skipped?.data.reason, 'generation_failed');
});

test('a percent score on a 0 to 100 scale reads as itself, not a hundred times over', async () => {
  const submarine = scenarioFile('submarine');
  const metrics = initialMetrics(submarine);
  const { prompt, rows } = await judgeStates(
    submarine,
    { metrics: { ...metrics, hullIntegrity: 100 } },
    { metrics: { ...metrics, hullIntegrity: 82, morale: 0.5 } },
  );
  assert.match(prompt, /Hull[^\n]*100%[^\n]*82%/);
  assert.doesNotMatch(prompt, /10000%/);
  assert.match(prompt, /Morale[^\n]*75%[^\n]*50%/);
  const hull = rows.find(r => r.id === 'hullIntegrity');
  assert.deepEqual([hull.format, hull.a, hull.b], ['percent', 1, 0.82]);

  const council = scenarioFile('dual-superintelligence-council');
  const councilMetrics = initialMetrics(council);
  const judged = await judgeStates(council, { metrics: councilMetrics }, { metrics: { ...councilMetrics, councilCohesion: 64 } });
  assert.match(judged.prompt, /Council Cohesion[^\n]*80%[^\n]*64%/);
});

test('every bundled score that improves as it falls says so', async () => {
  const lowerIsBetter: Record<string, string[]> = {
    'atlas-lab': ['specGamingRate', 'burnRate'],
    'corporate-quarterly': ['burnRate'],
    'dual-superintelligence-council': ['deceptionIndex', 'deploymentRisk'],
    't2d-glp1-protocol': ['hba1c', 'fastingGlucose', 'weight', 'bmi', 'mortalityRisk', 'sideEffectBurden'],
  };
  for (const file of readdirSync(resolve(repoRoot, 'scenarios')).filter(f => f.endsWith('.json'))) {
    const name = file.replace(/\.json$/, '');
    const metrics = (scenarioFile(name).metrics ?? []) as Array<{ id: string; better?: string }>;
    assert.deepEqual(metrics.filter(m => m.better === 'lower').map(m => m.id), lowerIsBetter[name] ?? [], name);
  }

  const t2d = scenarioFile('t2d-glp1-protocol');
  const metrics = initialMetrics(t2d);
  const { prompt, rows } = await judgeStates(t2d, { metrics }, { metrics: { ...metrics, hba1c: 6.9 } });
  assert.match(prompt, /HbA1c[^\n]*7\.80[^\n]*6\.90[^\n]*lower is better/);
  assert.equal(rows.find(r => r.id === 'mortalityRisk').better, 'lower');
});

test('scores keep their units for the judge and the card', async () => {
  const mars = initialMetrics(marsScenario);
  const judged = await judgeStates(marsScenario, { metrics: mars }, { metrics: { ...mars, powerKw: 380 } });
  assert.match(judged.prompt, /Food \(months\)[^\n]*18/);
  assert.match(judged.prompt, /Power \(kW\)[^\n]*400[^\n]*380/);
  assert.equal(judged.rows.find(r => r.id === 'powerKw').unit, 'kW');

  const [a, b] = atlasRuns();
  const atlas = await judgeStates(atlasLab, a.result.finalState, b.result.finalState);
  assert.match(atlas.prompt, /Monthly Burn \(USD\/mo\)[^\n]*lower is better/);
  assert.match(atlas.prompt, /Runway \(months\)/);
  assert.doesNotMatch(atlas.prompt, /\((score|frac|people|%)\):/);
});

test('the prompt reads right before a settlement word that starts with a vowel', async () => {
  const lunar = scenarioFile('lunar');
  const metrics = initialMetrics(lunar);
  const { prompt } = await judgeStates(lunar, { metrics }, { metrics });
  assert.match(prompt, /a simulation of an outpost/);
  assert.doesNotMatch(prompt, /\ba outpost\b/);
});
