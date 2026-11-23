/**
 * Two opposite leaders can end a run differently, in every scenario the
 * repository bundles and in a scenario the compiler emits.
 *
 * Both runs of a pair share one seed, so every person rolls the same dice
 * under both leaders, and the two runs end differently only where the
 * leaders' decisions reach the state. Each time a path between a decision
 * and the state closed, a live pair tied: effects that moved morale alone
 * against a ceiling, supplies no death rate read, yearly dice no chance
 * fell between. Those were found one scenario at a time, on Mars Genesis.
 * These tests hold the property for every scenario, so a tie of that kind
 * cannot return unseen.
 *
 * Each test drives a scenario's kernel the way the orchestrator's turn loop
 * does, with two decision streams and no model call:
 *
 * - one event a turn: the scenario's own milestone where it has one for the
 *   turn, under the category the orchestrator gives it; otherwise a stand-in
 *   for the director's event, whose category is drawn from the scenario's
 *   own category tables on a stream of the seed (the same for both streams),
 *   with two options, one of them risky, and a declared chance of 0.5;
 * - the bold stream always takes the risky option, the safe stream always a
 *   safe one;
 * - each outcome is drawn as the orchestrator draws it
 *   (`new SeededRng(seed).turnSeed(turn * 100 + eventIndex)` against the
 *   chosen option's own chance) and applied with `applyOutcomeEffects`, the
 *   scenario's category tables and its politics hook, with the
 *   orchestrator's noise draw, the personality bonus of a leader with every
 *   trait at one half (none), no tool modifiers and no adopted department
 *   effects.
 *
 * So the two streams differ in the option alone, on every turn. The counts
 * measure these two streams and bound no live pair: a live pair differs in
 * its events, its adopted effects and its department heads as well, and may
 * choose alike on some turns. A pair that chooses differently on its last
 * turn alone records the same deaths, since a turn's deaths fall in
 * `advanceTurn`, before its outcome is applied, and no turn follows the
 * last. Over 61 seeds each test counts the seeds on which
 * the streams end with different final values of a score the scenario
 * declares, and, in the scenarios that mark the supplies that sustain their
 * people and keep one death die for a life, the seeds on which the death
 * records differ: Mars Genesis at the hosted shape, with the dead as well,
 * and Lunar Outpost and the deep-ocean station at their own population and
 * turns. A scenario compiled from a seed draft holds the scores its draft
 * declares, with category tables over them (#257), so its rows count a
 * declared score like the rest. Their scenarios come from the real seed
 * compile, `compileFromSeed`, on a stub model that answers with the draft,
 * an extraction naming two crisis categories and no hook
 * (tests/engine/compiler/helpers/stub-model-compile.ts): a draft that
 * declares two scores and nothing else, the same draft with each score's
 * start and three tables of its own, and a draft a model returned to the
 * cookbook. Each floor sits a margin under the count read in CI, which
 * stands beside it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { SeededRng } from '../../src/engine/core/rng.js';
import { classifyOutcomeById } from '../../src/engine/core/progression.js';
import type { SimulationState } from '../../src/engine/core/state.js';
import { EffectRegistry } from '../../src/engine/registries/effects.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { compileScenario } from '../../src/engine/compiler/index.js';
import { applyOutcomeEffects } from '../../src/runtime/orchestrator/outcome-effects.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import { differingStateRows, formatScoreValue, scenarioScoreRows } from '../../src/cli/verdict-scores.js';
import { compileSeedOnStub, loadCompilerFixture } from '../engine/compiler/helpers/stub-model-compile.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = resolve(here, '../../scenarios');
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];

type Stream = 'bold' | 'safe';
interface Shape { population: number; turns: number }
interface StreamEvent {
  category: string;
  options: Array<{ id: string; isRisky: boolean }>;
  riskyOptionId: string;
  riskSuccessProbability: number;
}

/** The event of one turn: the scenario's milestone, or a stand-in for the director's. */
function eventFor(sc: ScenarioPackage, registry: EffectRegistry, seed: number, turn: number, maxTurns: number): StreamEvent {
  const milestone = sc.hooks?.getMilestoneEvent?.(turn, maxTurns) as StreamEvent | null | undefined;
  if (milestone) {
    // As the orchestrator: a milestone takes the first or the last category the knowledge bundle maps.
    const keys = Object.keys(sc.knowledge?.categoryMapping ?? {});
    const category = keys.length > 0 ? (turn === 1 ? keys[0] : keys[keys.length - 1]) : milestone.category;
    return { category, options: milestone.options, riskyOptionId: milestone.riskyOptionId, riskSuccessProbability: milestone.riskSuccessProbability };
  }
  const tables = registry.categories();
  const pool = tables.length > 0 ? tables : ['general'];
  return {
    category: pool[new SeededRng(seed).turnSeed(turn * 100 + 77).int(0, pool.length - 1)],
    options: [{ id: 'option_a', isRisky: false }, { id: 'option_b', isRisky: true }],
    riskyOptionId: 'option_b',
    riskSuccessProbability: 0.5,
  };
}

/** One run of a scenario under one decision stream: its final state. */
function run(sc: ScenarioPackage, seed: number, shape: Shape, stream: Stream): SimulationState {
  const start = sc.setup?.defaultStartTime ?? 1;
  const unitsPerTurn = sc.setup?.defaultTimePerTurn ?? 1;
  const kernel = new SimulationKernel(seed, 'Leader', scenarioKeyPersonnel(sc), { startTime: start, initialPopulation: shape.population, scenario: sc });
  const registry = EffectRegistry.forScenario(sc);
  for (let turn = 1; turn <= shape.turns; turn++) {
    const time = start + (turn - 1) * unitsPerTurn;
    kernel.advanceTurn(turn, time, sc.hooks?.progressionHook);
    const event = eventFor(sc, registry, seed, turn, shape.turns);
    const optionId = stream === 'bold' ? event.riskyOptionId : (event.options.find(o => !o.isRisky) ?? event.options[0]).id;
    const outcome = classifyOutcomeById(optionId, event.options, event.riskSuccessProbability, kernel.getState().metrics, new SeededRng(seed).turnSeed(turn * 100));
    applyOutcomeEffects(kernel, registry, {
      category: event.category,
      outcome,
      modifiers: { personalityBonus: 0, noise: new SeededRng(seed).turnSeed(turn * 100 + 50).next() * 0.2 - 0.1 },
      turn,
      time,
      politicsHook: sc.hooks?.politicsHook,
    });
  }
  return kernel.getState();
}

const deathRecords = (s: SimulationState) => s.eventLog.filter(e => e.type === 'death').map(e => `${e.agentId}|${e.time}|${e.cause}`).sort();
const deadSet = (s: SimulationState) => s.eventLog.filter(e => e.type === 'death').map(e => String(e.agentId)).sort();

interface Counts {
  /** Seeds on which a score the scenario declares ends at a different value. */
  declared: number;
  /** Seeds on which a row of the verdict's score block differs, declared or not. */
  scores: number;
  /** Seeds on which who died, when or of what differs. */
  records: number;
  /** Seeds on which who died differs. */
  dead: number;
  deathsBold: number;
  deathsSafe: number;
}

/** The two streams over the seeds; `streams` can run one stream twice. */
function pair(sc: ScenarioPackage, shape: Shape, streams: [Stream, Stream] = ['bold', 'safe']): Counts {
  const declaredIds = new Set((Array.isArray(sc.metrics) ? sc.metrics : []).map(m => m.id));
  const counts: Counts = { declared: 0, scores: 0, records: 0, dead: 0, deathsBold: 0, deathsSafe: 0 };
  for (const seed of SEEDS) {
    const a = run(sc, seed, shape, streams[0]);
    const b = run(sc, seed, shape, streams[1]);
    const differing = scenarioScoreRows(sc, [a, b]).filter(r => formatScoreValue(r.values[0], r.format) !== formatScoreValue(r.values[1], r.format));
    if (differing.some(r => declaredIds.has(r.id))) counts.declared++;
    if (differing.length > 0 || differingStateRows(sc, [a, b]).length > 0) counts.scores++;
    if (deathRecords(a).join('\n') !== deathRecords(b).join('\n')) counts.records++;
    if (deadSet(a).join('\n') !== deadSet(b).join('\n')) counts.dead++;
    counts.deathsBold += deadSet(a).length;
    counts.deathsSafe += deadSet(b).length;
  }
  return counts;
}

const report = (label: string, shape: Shape, c: Counts) => `${label}, ${shape.population} people, ${shape.turns} turns: of ${SEEDS.length} seeds, a declared score differs on ${c.declared}, the score block on ${c.scores}, the death records on ${c.records}, the dead on ${c.dead}; deaths a run ${(c.deathsBold / SEEDS.length).toFixed(2)} bold, ${(c.deathsSafe / SEEDS.length).toFixed(2)} safe`;

const disk = loadDiskCustomScenarios(scenariosDir);
const fromDisk = (id: string) => {
  const sc = disk.get(id)?.scenario as ScenarioPackage | undefined;
  assert.ok(sc, `scenarios/ holds ${id}`);
  return sc;
};
/** A model that returns no hook, so every compiled hook is the compiler's own fallback. No model is called. */
const noHook = async () => 'not a hook';
/** The Digital Twin, compiled as the server compiles it before a run. */
const twin = await compileScenario(JSON.parse(readFileSync(resolve(scenariosDir, 't2d-glp1-protocol.json'), 'utf-8')), { cache: false, generateText: noHook });
/**
 * A seed draft, compiled by the real `compileFromSeed` on a stub model that returns the draft, the
 * extraction and no hook. No network is reached; the real `fetch` is back before the rows run.
 */
const seedCompiledFrom = async (fixture: string) => (await compileSeedOnStub({ draft: loadCompilerFixture(fixture), hooks: 'none' })).scenario;
/** The draft of tests/engine/progression-time-scale.test.ts: two scores, no start, no table. */
const seedCompiled = await seedCompiledFrom('draft-orchard-bare.json');
/** The same draft with a start for each score and three category tables. */
const seedCompiledWithTables = await seedCompiledFrom('draft-orchard-with-tables.json');
/** The AI lab draft a model returned to the cookbook: seven scores, no start, no table. */
const seedCompiledAiLab = await seedCompiledFrom('recorded-draft-ai-lab.json');

/** The shape a hosted run has: at most 30 people and six turns. */
const hosted = (sc: ScenarioPackage): Shape => ({ population: Math.min(sc.setup?.defaultPopulation ?? 30, 30), turns: Math.min(sc.setup?.defaultTurns ?? 6, 6) });
/** The scenario's own population and turns. */
const own = (sc: ScenarioPackage): Shape => ({ population: sc.setup?.defaultPopulation ?? 30, turns: sc.setup?.defaultTurns ?? 6 });

interface Row {
  /** The scenario's id; a row for a file in scenarios/ carries that file's id. */
  id: string;
  label: string;
  scenario: ScenarioPackage;
  shape: Shape;
  /** The least each count may be, of 61 seeds. */
  floors: Partial<Pick<Counts, 'declared' | 'scores' | 'records' | 'dead'>>;
}

const station = fromDisk('deep-ocean-station');
const atlasLab = fromDisk('atlas-lab');
const corporate = fromDisk('corporate-quarterly');
const council = fromDisk('dual-superintelligence-council');

// The counts beside the rows at the hosted shape were read in CI run
// 43060543910 (job 130661614497), on the scenarios and kernel of master
// e70e4f88.
const ROWS: Row[] = [
  // A declared score 61 of 61, the death records 61, the dead 35.
  { id: 'mars-genesis', label: 'Mars Genesis', scenario: marsScenario, shape: hosted(marsScenario), floors: { declared: 58, records: 58, dead: 28 } },
  // A declared score 61 of 61 in each of these six.
  { id: 'lunar-outpost', label: 'Lunar Outpost', scenario: lunarScenario, shape: hosted(lunarScenario), floors: { declared: 58 } },
  { id: 'deep-ocean-station', label: 'the deep-ocean station', scenario: station, shape: hosted(station), floors: { declared: 58 } },
  { id: 'atlas-lab', label: 'Atlas Lab', scenario: atlasLab, shape: hosted(atlasLab), floors: { declared: 58 } },
  { id: 'corporate-quarterly', label: 'Q-Scope Corp', scenario: corporate, shape: hosted(corporate), floors: { declared: 58 } },
  { id: 'dual-superintelligence-council', label: 'the Dual Superintelligence Council', scenario: council, shape: hosted(council), floors: { declared: 58 } },
  { id: 't2d-glp1-protocol', label: 'the Digital Twin', scenario: twin, shape: hosted(twin), floors: { declared: 58 } },
  // Lunar Outpost and the deep-ocean station mark the supplies that sustain
  // their crews and keep one death die for a life. At their own population
  // and turns (50 people, 8 one-year turns) the death records differ on 23
  // and 26 of 61 seeds with both settings, against 1 and 13 with neither
  // (CI run 43061258861, job 130664143877, and run 43060543910).
  { id: 'lunar-outpost', label: 'Lunar Outpost at its own size', scenario: lunarScenario, shape: own(lunarScenario), floors: { records: 15 } },
  { id: 'deep-ocean-station', label: 'the deep-ocean station at its own size', scenario: station, shape: own(station), floors: { records: 18 } },
  // A scenario compiled from a seed draft holds every score its draft
  // declares. A draft that gives no start and no table gets the compiler's
  // default starts and three default tables; one that writes its own keeps
  // them. A declared score differs on 61 of 61 seeds for the bare orchard
  // draft, on 61 for the same draft with its own starts and tables, and on
  // 59 for the AI lab draft (CI run 43148058211, job 130950466431, on
  // commit 302c3381). The floor of 55 is the bar issue #257 sets for a
  // compiled scenario.
  { id: 'orchard-seasons', label: 'a scenario compiled from a seed draft', scenario: seedCompiled, shape: hosted(seedCompiled), floors: { declared: 55 } },
  { id: 'orchard-seasons', label: 'a scenario compiled from a seed draft with its own starts and tables', scenario: seedCompiledWithTables, shape: hosted(seedCompiledWithTables), floors: { declared: 55 } },
  { id: seedCompiledAiLab.id, label: 'a scenario compiled from the AI lab draft a model returned', scenario: seedCompiledAiLab, shape: hosted(seedCompiledAiLab), floors: { declared: 55 } },
];

for (const row of ROWS) {
  test(`${row.label}: a leader who always takes the bold option and one who always takes the safe one end differently`, (t) => {
    const counts = pair(row.scenario, row.shape);
    t.diagnostic(report(row.label, row.shape, counts));
    for (const [key, floor] of Object.entries(row.floors) as Array<[keyof Row['floors'], number]>) {
      assert.ok(counts[key] >= floor, `${key}: ${counts[key]} of ${SEEDS.length} seeds, under the floor of ${floor}. ${report(row.label, row.shape, counts)}`);
    }
  });
}

test('one decision stream run twice ends the same on every seed', (t) => {
  // The counts above measure the choice: the harness adds no randomness of its own.
  const shape = hosted(marsScenario);
  const counts = pair(marsScenario, shape, ['safe', 'safe']);
  t.diagnostic(report('Mars Genesis, the safe stream twice', shape, counts));
  assert.deepEqual([counts.scores, counts.records, counts.dead], [0, 0, 0]);
});

test('every scenario in scenarios/ has a row here', () => {
  // A scenario added to scenarios/ is measured before it ships: the count
  // is read in CI and written beside its floor. A file that takes an id
  // another file holds would pass on that file's row, and the disk loader
  // keeps one of the two under the id (src/cli/custom-scenarios.ts), so
  // each id is held by one file.
  const ids = readdirSync(scenariosDir)
    .filter(name => name.endsWith('.json') && !name.endsWith('-knowledge.json'))
    .map(name => JSON.parse(readFileSync(resolve(scenariosDir, name), 'utf-8')).id as string);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'ids held by more than one file in scenarios/');
  const covered = new Set(ROWS.map(r => r.id));
  assert.deepEqual(ids.filter(id => !covered.has(id)), [], 'scenarios with no row');
  assert.ok(ids.length >= 7, `scenarios/ holds ${ids.length} scenarios`);
});
