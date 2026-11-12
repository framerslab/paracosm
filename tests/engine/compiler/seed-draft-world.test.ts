/**
 * From a seed draft to a scenario JSON with a world: every default and
 * every repair `seedDraftToScenarioJson` applies, the rules a supply marked
 * as sustaining the people must pass (`sustainsVeto`), and the one death
 * die for a life every compile keeps.
 *
 * Each case is a small draft through the real draft schema
 * (`DraftScenarioSchema.parse`) and the normalizer. It reads what the
 * scenario JSON holds, the note the default or repair left, and that
 * `validateSeedWorld` reports nothing for the result. Where a case is about
 * what a run holds, the JSON goes through the real `compileScenario` (with
 * a model that returns no hook, so no model is called) into a real
 * `SimulationKernel` and `EffectRegistry`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftScenarioSchema } from '../../../src/engine/compiler/compile-from-seed.js';
import {
  DEFAULT_CATEGORIES,
  MAX_MAGNITUDE,
  SUSTAINS_MAX_MARKS,
  SUSTAINS_MIN_YEARS,
  scoreScale,
  seedDraftToScenarioJson,
  sustainsVeto,
  type DraftNote,
} from '../../../src/engine/compiler/seed-draft-world.js';
import { lintSustainsMarks, validateSeedWorld } from '../../../src/engine/compiler/validate.js';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import { EffectRegistry } from '../../../src/engine/registries/effects.js';
import { scenarioKeyPersonnel } from '../../../src/cli/sim-config.js';
import { loadCompilerFixture } from './helpers/stub-model-compile.js';

type Json = Record<string, any>;

/** A draft with two departments and whatever the case adds. */
const draftWith = (over: Json): Json => ({
  id: 'test-world',
  labels: { name: 'Test world', populationNoun: 'people', settlementNoun: 'site', timeUnitNoun: 'year' },
  setup: { defaultTurns: 4, defaultPopulation: 20, defaultStartTime: 1 },
  departments: [
    { id: 'ops', label: 'Operations', role: 'Operations Lead', instructions: 'Keep the site running.' },
    { id: 'care', label: 'Care', role: 'Care Lead', instructions: 'Look after the people.' },
  ],
  ...over,
});

interface Normalized {
  scenario: Json;
  notes: DraftNote[];
  /** `world.metrics`, by id. */
  world: Json;
  /** The category tables, in the object form. */
  effects: Record<string, Record<string, number>>;
  rules: string[];
}

/** Parse with the real draft schema, normalize, and require that the check reports nothing. */
function normalize(over: Json): Normalized {
  const { scenario, notes } = seedDraftToScenarioJson(DraftScenarioSchema.parse(draftWith(over)));
  const check = validateSeedWorld(scenario);
  assert.deepEqual(check.errors, [], `validateSeedWorld reports nothing for the normalized draft (notes: ${JSON.stringify(notes.map(n => n.message))})`);
  assert.equal(check.ok, true, 'validateSeedWorld says ok');
  const s = scenario as Json;
  return { scenario: s, notes, world: s.world.metrics, effects: s.effects, rules: notes.map(n => n.rule) };
}

/** The scenario JSON compiled with a model that returns no hook, in a kernel of 20 people. */
async function kernelOf(scenario: Json) {
  const pkg = await compileScenario(scenario, { cache: false, generateText: async () => 'not a hook' });
  const kernel = new SimulationKernel(950, 'Leader', scenarioKeyPersonnel(pkg), { startTime: 1, initialPopulation: 20, scenario: pkg });
  const state = kernel.getState();
  return { pkg, metrics: state.metrics as unknown as Record<string, number>, metadata: state.metadata, registry: EffectRegistry.forScenario(pkg) };
}

const noteOf = (n: Normalized, rule: string) => n.notes.find(note => note.rule === rule);
const requireNote = (n: Normalized, rule: string, words?: string) => {
  const found = n.notes.filter(note => note.rule === rule);
  assert.ok(found.length > 0, `a "${rule}" note is left (read rules ${JSON.stringify(n.rules)})`);
  if (words) assert.ok(found.some(note => note.message.includes(words)), `a "${rule}" note says "${words}" (read ${JSON.stringify(found.map(note => note.message))})`);
};

// ---- One for each default -------------------------------------------------------

test('no start: a number starts at 100, a percent at 50 points, a currency at 1,000,000, and a run holds them', async () => {
  const n = normalize({ metrics: [{ id: 'stock', format: 'number' }, { id: 'uptime', format: 'percent' }, { id: 'cash', format: 'currency' }] });
  assert.deepEqual(n.world.stock, { id: 'stock', label: 'Stock', unit: '', type: 'number', initial: 100, min: 0, category: 'metric' });
  assert.deepEqual(n.world.uptime, { id: 'uptime', label: 'Uptime', unit: '%', type: 'number', initial: 50, min: 0, max: 100, category: 'metric' });
  assert.deepEqual(n.world.cash, { id: 'cash', label: 'Cash', unit: '', type: 'number', initial: 1_000_000, min: 0, category: 'metric' });
  assert.deepEqual(n.notes.filter(note => note.rule === 'default-start').map(note => note.path), ['metrics[0].initial', 'metrics[1].initial', 'metrics[2].initial']);
  assert.deepEqual(n.scenario.metrics, [
    { id: 'stock', label: 'Stock', source: 'metrics.stock', format: 'number' },
    { id: 'uptime', label: 'Uptime', source: 'metrics.uptime', format: 'percent' },
    { id: 'cash', label: 'Cash', source: 'metrics.cash', format: 'currency' },
  ]);
  assert.deepEqual(n.scenario.world, { metrics: n.world, capacities: {}, statuses: {}, politics: {}, environment: {} });
  assert.deepEqual(n.scenario.ui, { headerMetrics: [{ id: 'stock', format: 'number' }, { id: 'uptime', format: 'percent' }, { id: 'cash', format: 'currency' }] });
  const { metrics } = await kernelOf(n.scenario);
  assert.deepEqual([metrics.stock, metrics.uptime, metrics.cash], [100, 50, 1_000_000], `a kernel holds the default starts (read ${JSON.stringify(metrics)})`);
});

test('no start with a ceiling: the midpoint of the floor and the ceiling, the floor being 0 when none is given', () => {
  const n = normalize({ metrics: [{ id: 'index', format: 'number', min: 20, max: 100 }, { id: 'gauge', format: 'number', max: 80 }] });
  assert.deepEqual([n.world.index.initial, n.world.index.min, n.world.index.max], [60, 20, 100]);
  assert.deepEqual([n.world.gauge.initial, n.world.gauge.min, n.world.gauge.max], [40, 0, 80]);
  requireNote(n, 'default-start', 'index: no start given; it starts at 60');
});

test('no start with a floor above the default: the start is raised to the floor', () => {
  const n = normalize({ metrics: [{ id: 'depth', format: 'number', min: 250 }, { id: 'cash', format: 'currency', min: 5_000_000 }] });
  assert.deepEqual([n.world.depth.initial, n.world.cash.initial], [250, 5_000_000]);
});

test('no label: built from the id, hyphens to spaces and a capital first letter; a given label is trimmed', () => {
  const n = normalize({ metrics: [{ id: 'soil-health', format: 'percent' }, { id: 'harvest', format: 'number', label: '  Harvest  ' }, { id: 'yield', format: 'number', label: 'Y' }] });
  assert.deepEqual([n.world['soil-health'].label, n.world.harvest.label, n.world.yield.label], ['Soil health', 'Harvest', 'Yield']);
  assert.deepEqual(n.notes.filter(note => note.rule === 'default-label').map(note => note.path), ['metrics[0].label', 'metrics[2].label']);
  assert.deepEqual(n.scenario.metrics.map((m: Json) => m.label), ['Soil health', 'Harvest', 'Yield']);
});

test('no unit on a currency: the scenario\'s currency; a percent always reads %; a given unit is trimmed and cut to 16', () => {
  const n = normalize({
    labels: { name: 'Test world', populationNoun: 'people', settlementNoun: 'site', timeUnitNoun: 'year', currency: 'USD' },
    metrics: [
      { id: 'cash', format: 'currency' },
      { id: 'uptime', format: 'percent', unit: 'points' },
      { id: 'stock', format: 'number', unit: '  tonnes of apples in store  ' },
      { id: 'debt', format: 'currency', unit: 'EUR' },
    ],
  });
  assert.deepEqual([n.world.cash.unit, n.world.uptime.unit, n.world.stock.unit, n.world.debt.unit], ['USD', '%', 'tonnes of apples', 'EUR']);
});

test('no tables at all: three default tables under the director\'s canned categories, every score a twentieth of its scale in its better direction', async () => {
  const n = normalize({ metrics: [{ id: 'stock', format: 'number' }, { id: 'defects', format: 'number', initial: 40, better: 'lower' }, { id: 'uptime', format: 'percent', initial: 97 }] });
  const table = { stock: 5, defects: -2, uptime: 0.15 };
  assert.deepEqual(n.effects, { infrastructure: table, resource: table, psychological: table });
  assert.deepEqual(Object.keys(n.effects), [...DEFAULT_CATEGORIES]);
  assert.deepEqual(n.scenario.knowledge, { topics: {}, categoryMapping: { infrastructure: [], resource: [], psychological: [] } });
  requireNote(n, 'default-tables', 'infrastructure, resource, psychological');
  const { registry, pkg } = await kernelOf(n.scenario);
  assert.deepEqual(registry.categories(), [...DEFAULT_CATEGORIES], 'a run\'s registry has the three tables');
  assert.equal(registry.isHarmful('defects', -2), false, 'a fall on a score that is better lower is a gain');
  assert.deepEqual(Object.keys(pkg.knowledge.categoryMapping), [...DEFAULT_CATEGORIES]);
});

test('a draft that declares only population and morale: the roster and the kernel\'s own morale, and tables that move morale', async () => {
  const n = normalize({ metrics: [{ id: 'population', format: 'percent', initial: 5000, max: 9000 }, { id: 'morale', format: 'number' }] });
  assert.deepEqual(n.world.population, { id: 'population', label: 'Population', unit: '', type: 'number', initial: 20, min: 0, category: 'metric' });
  assert.deepEqual(n.world.morale, { id: 'morale', label: 'Morale', unit: '%', type: 'number', initial: 0.85, min: 0, max: 1, category: 'metric' });
  assert.deepEqual(n.scenario.metrics.map((m: Json) => [m.id, m.format]), [['population', 'number'], ['morale', 'percent']]);
  assert.deepEqual(n.effects, { infrastructure: { morale: 0.05 }, resource: { morale: 0.05 }, psychological: { morale: 0.05 } });
  assert.deepEqual(n.scenario.ui.headerMetrics, [], 'the header shows neither: the stats bar drops both');
  requireNote(n, 'population-own');
  const { metrics } = await kernelOf(n.scenario);
  assert.deepEqual([metrics.population, metrics.morale], [20, 0.85]);
});

test('a draft whose only metric is the head count, twice: one table entry on morale', () => {
  const n = normalize({ metrics: [{ id: 'population' }, { id: 'population' }] });
  assert.deepEqual(Object.keys(n.world), ['population']);
  assert.deepEqual(n.effects, { infrastructure: { morale: 0.05 }, resource: { morale: 0.05 }, psychological: { morale: 0.05 } });
  requireNote(n, 'id-duplicate');
});

test('a declared morale: a start between 0 and 1 is kept, one in points is divided by 100, any other is the kernel\'s 0.85', () => {
  const start = (initial: unknown) => normalize({ metrics: [{ id: 'morale', initial }, { id: 'stock' }] });
  assert.equal(start(0.6).world.morale.initial, 0.6);
  const points = start(70);
  assert.equal(points.world.morale.initial, 0.7);
  requireNote(points, 'morale-in-points');
  const outside = start(250);
  assert.equal(outside.world.morale.initial, 0.85);
  requireNote(outside, 'start-outside-bounds');
});

// ---- One for each repair ----------------------------------------------------------

test('a start outside its bounds is moved to the bound it passed', () => {
  const n = normalize({ metrics: [{ id: 'tank', format: 'number', initial: 500, min: 0, max: 200 }, { id: 'store', format: 'number', initial: -5, min: 0 }] });
  assert.deepEqual([n.world.tank.initial, n.world.store.initial], [200, 0]);
  requireNote(n, 'start-outside-bounds', 'tank: a start of 500 is over its ceiling and is moved to 200');
  requireNote(n, 'start-outside-bounds', 'store: a start of -5 is under its floor and is moved to 0');
});

test('a percent is held from 0 to 100: a start above 100 is moved to 100, and the draft\'s own range is not kept', () => {
  const n = normalize({ metrics: [{ id: 'uptime', format: 'percent', initial: 140 }, { id: 'yield', format: 'percent', initial: 30, min: 10, max: 90 }] });
  assert.deepEqual([n.world.uptime.initial, n.world.uptime.min, n.world.uptime.max], [100, 0, 100]);
  assert.deepEqual([n.world.yield.initial, n.world.yield.min, n.world.yield.max], [30, 0, 100]);
  requireNote(n, 'start-outside-bounds', 'uptime');
  requireNote(n, 'percent-bounds', 'yield');
});

test('a draft written in fractions: every percent start and every entry on a percent metric is multiplied by 100', () => {
  const n = normalize({
    metrics: [{ id: 'retention', format: 'percent', initial: 0.62 }, { id: 'churn', format: 'percent', initial: 0.04, better: 'lower' }, { id: 'stock', format: 'number', initial: 200 }],
    effects: [
      { category: 'market', entries: [{ metric: 'retention', change: 0.02 }, { metric: 'stock', change: 10 }] },
      { category: 'service', entries: [{ metric: 'churn', change: -0.002 }, { metric: 'retention', change: 0.01 }] },
      { category: 'supply', entries: [{ metric: 'stock', change: -12 }, { metric: 'churn', change: 0.001 }] },
    ],
  });
  assert.deepEqual([n.world.retention.initial, n.world.churn.initial, n.world.stock.initial], [62, 4, 200]);
  assert.deepEqual(n.effects, { market: { retention: 2, stock: 10 }, service: { churn: -0.2, retention: 1 }, supply: { stock: -12, churn: 0.1 } });
  requireNote(n, 'fractions');
});

test('one percent metric under 1 is not read as a fraction: it stays as written', () => {
  const n = normalize({ metrics: [{ id: 'defect-rate', format: 'percent', initial: 0.5, better: 'lower' }, { id: 'stock', format: 'number' }] });
  assert.equal(n.world['defect-rate'].initial, 0.5);
  assert.equal(noteOf(n, 'fractions'), undefined);
});

test('a floor above its ceiling: the two are swapped; a floor equal to its ceiling: the ceiling is dropped', () => {
  const n = normalize({ metrics: [{ id: 'level', format: 'number', initial: 50, min: 100, max: 10 }, { id: 'fixed', format: 'number', min: 5, max: 5 }] });
  assert.deepEqual([n.world.level.min, n.world.level.max, n.world.level.initial], [10, 100, 50]);
  assert.deepEqual([n.world.fixed.min, n.world.fixed.max, n.world.fixed.initial], [5, undefined, 100]);
  assert.equal('max' in n.world.fixed, false, 'the dropped ceiling leaves no key');
  requireNote(n, 'bounds-swapped', 'level');
  requireNote(n, 'ceiling-dropped', 'fixed');
});

test('a % unit on a number is dropped: the format is what the verdict and the header read', () => {
  const n = normalize({ metrics: [{ id: 'share', format: 'number', unit: '%', initial: 40 }, { id: 'ratio', format: 'currency', unit: 'frac' }] });
  assert.deepEqual([n.world.share.unit, n.world.ratio.unit], ['', '']);
  requireNote(n, 'unit-dropped', 'share');
});

test('a second metric under one id is dropped', () => {
  const n = normalize({ metrics: [{ id: 'stock', format: 'number', initial: 30 }, { id: 'stock', format: 'percent', initial: 80 }, { id: 'cash', format: 'currency' }] });
  assert.deepEqual(Object.keys(n.world), ['stock', 'cash']);
  assert.equal(n.world.stock.initial, 30, 'the first stays');
  assert.deepEqual(n.scenario.metrics.map((m: Json) => m.id), ['stock', 'cash']);
  requireNote(n, 'id-duplicate', 'stock');
});

test('a second department under one id is renamed to the first free id, so the count stays: ops, ops, ops-2 gives ops, ops-3, ops-2', () => {
  const department = (id: string) => ({ id, label: 'Operations', role: 'Operations Lead', instructions: 'Keep the site running.' });
  const n = normalize({ departments: [department('ops'), department('ops'), department('ops-2')], metrics: [{ id: 'stock' }, { id: 'cash' }] });
  assert.deepEqual(n.scenario.departments.map((d: Json) => d.id), ['ops', 'ops-3', 'ops-2']);
  requireNote(n, 'id-renamed', 'ops-3');
});

test('a metric and a category named constructor are renamed, and constructor beside constructor-score keeps both', () => {
  const n = normalize({
    metrics: [{ id: 'constructor', format: 'number', initial: 10 }, { id: 'constructor-score', format: 'number', initial: 200 }],
    effects: [
      { category: 'constructor', entries: [{ metric: 'constructor', change: 0.5 }, { metric: 'constructor-score', change: 10 }] },
      { category: 'market', entries: [{ metric: 'constructor-score', change: -10 }] },
      { category: 'supply', entries: [{ metric: 'constructor', change: 0.5 }] },
    ],
  });
  assert.deepEqual(Object.keys(n.world), ['constructor-score-2', 'constructor-score']);
  assert.deepEqual([n.world['constructor-score-2'].initial, n.world['constructor-score'].initial], [10, 200]);
  assert.deepEqual(Object.keys(n.effects), ['constructor-events', 'market', 'supply']);
  assert.deepEqual(n.effects['constructor-events'], { 'constructor-score-2': 0.5, 'constructor-score': 10 }, 'an entry on the renamed metric follows it');
  const largest = new EffectRegistry(n.effects).largestEntries();
  assert.deepEqual(largest, { 'constructor-score-2': 0.5, 'constructor-score': 10 }, 'every key\'s largest entry is a number');
  requireNote(n, 'id-renamed', 'constructor-score-2');
  requireNote(n, 'category-renamed', 'constructor-events');
});

test('a start of 1e308 is moved to 1e15 and a ceiling of -1e308 to -1e15, so an outcome\'s changes stay finite', () => {
  const n = normalize({ metrics: [{ id: 'vast', format: 'number', initial: 1e308 }, { id: 'deep', format: 'number', max: -1e308 }] });
  assert.equal(n.world.vast.initial, MAX_MAGNITUDE);
  assert.deepEqual([n.world.deep.initial, n.world.deep.max, n.world.deep.min], [-MAX_MAGNITUDE, -MAX_MAGNITUDE, undefined]);
  assert.equal(n.notes.filter(note => note.rule === 'size-over-limit').length, 2);
  const deltas = new EffectRegistry(n.effects).applyOutcome('infrastructure', 'risky_failure', { personalityBonus: -0.21, noise: -0.1 });
  assert.deepEqual(Object.values(deltas).filter(v => !Number.isFinite(v)), [], `every change at the worst outcome is finite (read ${JSON.stringify(deltas)})`);
});

test('a number with a ceiling of -18, no floor and no start starts at its ceiling', () => {
  const n = normalize({ metrics: [{ id: 'freezer', format: 'number', max: -18 }, { id: 'stock' }] });
  assert.deepEqual([n.world.freezer.initial, n.world.freezer.max, 'min' in n.world.freezer], [-18, -18, false]);
});

test('an entry on an undeclared metric, on population, or of 0 is dropped; a second entry for a metric in one table is dropped', () => {
  const n = normalize({
    metrics: [{ id: 'stock', initial: 120 }, { id: 'cash', format: 'currency', initial: 1200 }, { id: 'population' }],
    effects: [
      { category: 'supply', entries: [{ metric: 'ghost', change: 5 }, { metric: 'stock', change: 6 }, { metric: 'population', change: 3 }, { metric: 'cash', change: 60 }] },
      { category: 'market', entries: [{ metric: 'cash', change: 0 }, { metric: 'cash', change: -60 }, { metric: 'cash', change: 90 }, { metric: 'stock', change: 6 }] },
      { category: 'weather', entries: [{ metric: 'stock', change: -6 }, { metric: 'cash', change: 60 }] },
    ],
  });
  assert.deepEqual(n.effects, { supply: { stock: 6, cash: 60 }, market: { cash: -60, stock: 6 }, weather: { stock: -6, cash: 60 } });
  assert.deepEqual(n.notes.filter(note => note.rule === 'entry-dropped').map(note => note.path), [
    'effects[0].entries[0]', 'effects[0].entries[2]', 'effects[1].entries[0]', 'effects[1].entries[2]',
  ]);
});

test('an entry above a twelfth of its score\'s scale is cut to it, and one under a hundredth is raised to it, sign kept', () => {
  const n = normalize({
    metrics: [{ id: 'stock', initial: 120 }, { id: 'reserve', initial: 120 }, { id: 'soil-health', format: 'percent', initial: 62 }],
    effects: [
      { category: 'supply', entries: [{ metric: 'stock', change: 50 }, { metric: 'reserve', change: -0.5 }, { metric: 'soil-health', change: -30 }, { metric: 'morale', change: 0.5 }] },
      { category: 'market', entries: [{ metric: 'stock', change: 5 }, { metric: 'reserve', change: 5 }] },
      { category: 'weather', entries: [{ metric: 'soil-health', change: 0.1 }, { metric: 'morale', change: -0.001 }, { metric: 'stock', change: 5 }, { metric: 'reserve', change: 5 }] },
    ],
  });
  assert.deepEqual(n.effects.supply, { stock: 10, reserve: -1.2, 'soil-health': -3.166667, morale: 0.083333 });
  assert.deepEqual(n.effects.weather, { 'soil-health': 0.38, morale: -0.01, stock: 5, reserve: 5 });
  assert.equal(n.notes.filter(note => note.rule === 'entry-above-most').length, 3);
  assert.equal(n.notes.filter(note => note.rule === 'entry-under-least').length, 3);
});

test('a count that starts empty has no scale: it keeps the entry the draft wrote, and its default entry is 1', () => {
  const n = normalize({
    metrics: [{ id: 'patents', format: 'number', initial: 0 }, { id: 'stock', initial: 120 }],
    effects: [
      { category: 'research', entries: [{ metric: 'patents', change: 40 }, { metric: 'stock', change: -6 }] },
      { category: 'market', entries: [{ metric: 'stock', change: 6 }] },
      { category: 'supply', entries: [{ metric: 'stock', change: 6 }, { metric: 'patents', change: 0.001 }] },
    ],
  });
  assert.equal(scoreScale('patents', n.world.patents), undefined);
  assert.deepEqual([n.effects.research.patents, n.effects.supply.patents], [40, 0.01]);
  const defaults = normalize({ metrics: [{ id: 'patents', format: 'number', initial: 0 }, { id: 'stock', initial: 120 }] });
  assert.equal(defaults.effects.infrastructure.patents, 1);
});

test('a fifth entry of a table and a ninth table are dropped', () => {
  const five = ['aa', 'bb', 'cc', 'dd', 'ee'];
  const n = normalize({
    metrics: five.map(id => ({ id, initial: 100 })),
    effects: [{ category: 'supply', entries: five.map(metric => ({ metric, change: 5 })) }],
  });
  assert.deepEqual(Object.keys(n.effects.supply), ['aa', 'bb', 'cc', 'dd']);
  requireNote(n, 'entry-dropped', 'more than 4 entries');

  const nine = normalize({
    metrics: [{ id: 'aa', initial: 100 }, { id: 'bb', initial: 100 }],
    effects: Array.from({ length: 9 }, (_, i) => ({ category: `kind-${i + 1}`, entries: [{ metric: 'aa', change: 5 }, { metric: 'bb', change: 5 }] })),
  });
  assert.deepEqual(Object.keys(nine.effects), ['kind-1', 'kind-2', 'kind-3', 'kind-4', 'kind-5', 'kind-6', 'kind-7', 'kind-8']);
  requireNote(nine, 'table-dropped', 'kind-9');
});

test('two tables under one key merge, the first entry for a metric staying; a category with capitals and spaces is keyed in kebab-case', () => {
  const n = normalize({
    metrics: [{ id: 'aa', initial: 100 }, { id: 'bb', initial: 100 }],
    effects: [
      { category: 'Late Frost!', entries: [{ metric: 'aa', change: 5 }] },
      { category: 'late-frost', entries: [{ metric: 'aa', change: 8 }, { metric: 'bb', change: 4 }] },
      { category: '  ', entries: [{ metric: 'bb', change: 5 }, { metric: 'aa', change: 5 }] },
      { category: 'Buyer shortfall', entries: [{ metric: 'aa', change: -5 }, { metric: 'bb', change: 5 }] },
    ],
  });
  assert.deepEqual(n.effects, { 'late-frost': { aa: 5, bb: 4 }, 'category-3': { bb: 5, aa: 5 }, 'buyer-shortfall': { aa: -5, bb: 5 } });
  assert.deepEqual(Object.keys(n.scenario.knowledge.categoryMapping), ['late-frost', 'category-3', 'buyer-shortfall']);
  requireNote(n, 'tables-merged', 'late-frost');
  requireNote(n, 'category-renamed', 'Late Frost!');
});

test('one table: two are added with the default table, so a turn\'s two events can differ', () => {
  const n = normalize({ metrics: [{ id: 'aa', initial: 100 }, { id: 'bb', initial: 100, better: 'lower' }], effects: [{ category: 'resource', entries: [{ metric: 'aa', change: 5 }, { metric: 'bb', change: 5 }] }] });
  assert.deepEqual(n.effects, { resource: { aa: 5, bb: 5 }, infrastructure: { aa: 5, bb: -5 }, psychological: { aa: 5, bb: -5 } });
  requireNote(n, 'tables-added', 'infrastructure, psychological');
});

test('a table left with no entry takes the default table', () => {
  const n = normalize({
    metrics: [{ id: 'aa', initial: 100 }, { id: 'bb', initial: 100 }],
    effects: [
      { category: 'supply', entries: [{ metric: 'ghost', change: 5 }] },
      { category: 'market', entries: [{ metric: 'aa', change: 5 }, { metric: 'bb', change: -5 }] },
      { category: 'weather', entries: [{ metric: 'aa', change: -5 }, { metric: 'bb', change: 5 }] },
    ],
  });
  assert.deepEqual(n.effects.supply, { aa: 5, bb: 5 });
  requireNote(n, 'table-defaulted', 'supply');
});

test('a declared score no table names is added to every table at its default entry', () => {
  const n = normalize({
    metrics: [{ id: 'aa', initial: 100 }, { id: 'bb', format: 'percent', initial: 50 }],
    effects: ['supply', 'market', 'weather'].map(category => ({ category, entries: [{ metric: 'aa', change: 5 }] })),
  });
  assert.deepEqual(n.effects, { supply: { aa: 5, bb: 2.5 }, market: { aa: 5, bb: 2.5 }, weather: { aa: 5, bb: 2.5 } });
  requireNote(n, 'score-added-to-every-table', 'bb');
});

test('a declared score that neither the first nor the last table names is added to the last: a run of two turns applies only those two', () => {
  const n = normalize({
    setup: { defaultTurns: 2, defaultPopulation: 20, defaultStartTime: 1 },
    metrics: [{ id: 'harvest', initial: 100 }, { id: 'soil-health', format: 'percent', initial: 50 }],
    effects: [
      { category: 'opening', entries: [{ metric: 'morale', change: 0.05 }] },
      { category: 'operations', entries: [{ metric: 'harvest', change: 5 }, { metric: 'soil-health', change: 2.5 }] },
      { category: 'closing', entries: [{ metric: 'morale', change: 0.05 }] },
    ],
  });
  assert.deepEqual(n.effects, {
    opening: { morale: 0.05 },
    operations: { harvest: 5, 'soil-health': 2.5 },
    closing: { morale: 0.05, harvest: 5, 'soil-health': 2.5 },
  });
  assert.equal(n.notes.filter(note => note.rule === 'score-added-to-last-table').length, 2);
});

// ---- Leniency ----------------------------------------------------------------------

test('a new field of the wrong type reads as absent and never fails the draft', () => {
  const metrics = (initial: unknown) => [{ id: 'stock', format: 'number', initial }, { id: 'cash', format: 'currency' }];
  const text = DraftScenarioSchema.parse(draftWith({ metrics: metrics('high') }));
  assert.equal(text.metrics[0].initial, undefined, 'a string where initial goes reads as absent');
  const nothing = DraftScenarioSchema.parse(draftWith({ metrics: metrics(null) }));
  assert.equal(nothing.metrics[0].initial, undefined, 'a null where initial goes reads as absent');
  const record = DraftScenarioSchema.parse(draftWith({ metrics: metrics(100), effects: { weather: { stock: 5 } } }));
  assert.equal(record.effects, undefined, 'an object where effects goes reads as absent');
  assert.equal(normalize({ metrics: metrics('high') }).world.stock.initial, 100, 'and the start is the default');
});

test('one malformed entry among three tables reads as undefined in its place; the other entries and tables stay, and the normalizer drops it with a note', () => {
  const over = {
    metrics: [{ id: 'stock', initial: 120 }, { id: 'cash', format: 'currency', initial: 1200 }],
    effects: [
      { category: 'supply', entries: [{ metric: 'stock', change: 6 }, { metric: 'cash', change: 60 }] },
      { category: 'market', entries: [{ metric: 'stock', change: '5' }, { metric: 'cash', change: -60 }] },
      'not a table',
      { category: 'weather', entries: [{ metric: 'stock', change: -6 }, { metric: 'cash', change: 60 }] },
    ],
  };
  const parsed = DraftScenarioSchema.parse(draftWith(over));
  assert.deepEqual(parsed.effects, [
    { category: 'supply', entries: [{ metric: 'stock', change: 6 }, { metric: 'cash', change: 60 }] },
    { category: 'market', entries: [undefined, { metric: 'cash', change: -60 }] },
    undefined,
    { category: 'weather', entries: [{ metric: 'stock', change: -6 }, { metric: 'cash', change: 60 }] },
  ]);
  const n = normalize(over);
  assert.deepEqual(n.effects, { supply: { stock: 6, cash: 60 }, market: { cash: -60 }, weather: { stock: -6, cash: 60 } });
  assert.deepEqual(noteOf(n, 'entry-dropped')?.path, 'effects[1].entries[0]');
  assert.deepEqual(noteOf(n, 'table-dropped')?.path, 'effects[2]');
});

// ---- Numbers at the edges ------------------------------------------------------------

test('an entry of 1e308 on a count that starts empty is held to 1e15, so its outcome stays finite and reaches the score', async () => {
  const n = normalize({
    metrics: [{ id: 'patents', format: 'number', initial: 0 }, { id: 'stock', initial: 120 }],
    effects: [
      { category: 'research', entries: [{ metric: 'patents', change: 1e308 }, { metric: 'stock', change: -6 }] },
      { category: 'market', entries: [{ metric: 'stock', change: 6 }, { metric: 'patents', change: -1e308 }] },
      { category: 'supply', entries: [{ metric: 'stock', change: 6 }, { metric: 'patents', change: 40 }] },
    ],
  });
  assert.equal(n.effects.research.patents, MAX_MAGNITUDE, `the entry is held to 1e15 (read ${n.effects.research.patents})`);
  assert.equal(n.effects.market.patents, -MAX_MAGNITUDE, `the sign is kept (read ${n.effects.market.patents})`);
  assert.equal(n.effects.supply.patents, 40, 'an entry under the limit stays as written');
  assert.deepEqual(
    n.notes.filter(note => note.rule === 'size-over-limit').map(note => note.path),
    ['effects[0].entries[0]', 'effects[1].entries[1]'],
    `each held entry leaves a note (read rules ${JSON.stringify(n.rules)})`,
  );

  // A bold response that works multiplies the entry by 2.5: the change is finite, and the kernel applies it.
  const pkg = await compileScenario(n.scenario, { cache: false, generateText: async () => 'not a hook' });
  const kernel = new SimulationKernel(950, 'Leader', scenarioKeyPersonnel(pkg), { startTime: 1, initialPopulation: 20, scenario: pkg });
  const deltas = EffectRegistry.forScenario(pkg).applyOutcome('research', 'risky_success', { personalityBonus: 0, noise: 0 });
  assert.ok(Number.isFinite(deltas.patents), `the outcome's change to patents is finite (read ${deltas.patents})`);
  kernel.applySystemDeltas(deltas);
  const held = (kernel.getState().metrics as unknown as Record<string, number>).patents;
  assert.equal(held, 2.5 * MAX_MAGNITUDE, `the kernel holds the count after the outcome (read ${held})`);

  // The check names an entry over the limit, where a package carries one.
  const broken = JSON.parse(JSON.stringify(n.scenario));
  broken.effects.research.patents = 1e300;
  const { errors } = validateSeedWorld(broken);
  assert.ok(
    errors.some(e => e.includes('table "research" changes patents by 1e+300, larger than 1000000000000000 in size')),
    `validateSeedWorld names an entry larger than 1e15 (read ${JSON.stringify(errors)})`,
  );
});

test('no start between a floor and a ceiling less than a millionth apart: the start stays inside them', async () => {
  // The midpoint, 0.00000045, rounds to 0 at six decimals, under the floor.
  const n = normalize({ metrics: [{ id: 'trace', format: 'number', min: 0.0000004, max: 0.0000005 }, { id: 'stock' }] });
  const { initial, min, max } = n.world.trace;
  assert.deepEqual([min, max], [0.0000004, 0.0000005]);
  assert.ok(initial >= min && initial <= max, `the start lies within its floor and its ceiling (read ${initial})`);
  requireNote(n, 'default-start', 'trace');
  const { metrics } = await kernelOf(n.scenario);
  assert.equal(metrics.trace, initial, `a kernel holds that start (read ${metrics.trace})`);
});

test('in a draft written in fractions, an entry that rounds to nothing keeps its sign and is raised to a hundredth of its score\'s scale', () => {
  const n = normalize({
    metrics: [{ id: 'retention', format: 'percent', initial: 0.62 }, { id: 'churn', format: 'percent', initial: 0.04, better: 'lower' }, { id: 'stock', format: 'number', initial: 200 }],
    effects: [
      { category: 'market', entries: [{ metric: 'retention', change: -0.000000001 }, { metric: 'stock', change: 10 }] },
      { category: 'service', entries: [{ metric: 'churn', change: 0.000000001 }, { metric: 'retention', change: 0.01 }] },
      { category: 'supply', entries: [{ metric: 'stock', change: -12 }, { metric: 'churn', change: 0.001 }] },
    ],
  });
  // retention starts at 62 points, 38 from its ceiling: a hundredth of that scale is 0.38. churn starts at 4: 0.04.
  assert.deepEqual(n.effects, { market: { retention: -0.38, stock: 10 }, service: { churn: 0.04, retention: 1 }, supply: { stock: -12, churn: 0.1 } });
  assert.equal(n.notes.filter(note => note.rule === 'entry-under-least').length, 2, `both entries leave a note (read rules ${JSON.stringify(n.rules)})`);
});

test('an entry on morale written in points is divided by 100, as a morale start is', () => {
  const n = normalize({
    metrics: [{ id: 'stock', initial: 120 }, { id: 'cash', format: 'currency', initial: 1200 }],
    effects: [
      { category: 'supply', entries: [{ metric: 'morale', change: -2 }, { metric: 'stock', change: 6 }, { metric: 'cash', change: 60 }] },
      { category: 'market', entries: [{ metric: 'morale', change: 4 }, { metric: 'cash', change: -60 }] },
      { category: 'unrest', entries: [{ metric: 'morale', change: -30 }, { metric: 'stock', change: -6 }] },
      { category: 'weather', entries: [{ metric: 'stock', change: -6 }, { metric: 'cash', change: 60 }, { metric: 'morale', change: 0.04 }] },
    ],
  });
  assert.deepEqual(
    [n.effects.supply.morale, n.effects.market.morale, n.effects.unrest.morale, n.effects.weather.morale],
    [-0.02, 0.04, -0.083333, 0.04],
    `two points are 0.02, four are 0.04, thirty are cut to a twelfth of morale's range, and a fraction stays (read ${JSON.stringify(n.effects)})`,
  );
  assert.deepEqual(
    n.notes.filter(note => note.rule === 'morale-in-points').map(note => note.path),
    ['effects[0].entries[0]', 'effects[1].entries[0]', 'effects[2].entries[0]'],
    `each entry in points leaves a note (read rules ${JSON.stringify(n.rules)})`,
  );
});

/** Every draft of tests/fixtures/compiler/. */
const FIXTURES = [
  'draft-orchard-bare.json',
  'draft-orchard-with-tables.json',
  'draft-reservoir-with-mark.json',
  'recorded-draft-ai-lab.json',
  'recorded-draft-generation-ship.json',
  'recorded-draft-pandemic-governor.json',
  'recorded-draft-game-studio.json',
];

// ---- A supply that sustains the people -------------------------------------------------

/** Twelve one-year turns: a default run of 11 years. */
const TWELVE_YEARS = { setup: { defaultTurns: 12, defaultPopulation: 20, defaultStartTime: 1 } };
/** A number in megalitres that starts at 200, with whatever the case adds. */
const reserve = (over: Json = {}): Json => ({ id: 'reserve', format: 'number', unit: 'megalitres', initial: 200, ...over });
/** Three tables that each name `reserve` and `stock`, every entry inside its score's bounds. */
const RESERVE_TABLES = [
  { category: 'drought', entries: [{ metric: 'reserve', change: -10 }, { metric: 'stock', change: 5 }] },
  { category: 'works', entries: [{ metric: 'reserve', change: 10 }, { metric: 'stock', change: -5 }] },
  { category: 'demand', entries: [{ metric: 'stock', change: 5 }, { metric: 'reserve', change: -5 }] },
];
/** The marks a draft lost, each as `<key> rule <n>`, read from the notes. */
const refusedMarks = (n: Normalized): string[] => n.notes
  .filter(note => note.rule === 'mark-refused')
  .map(note => `${note.message.split(':')[0]} rule ${/\(rule (\d)\)/.exec(note.message)?.[1]}`);
/** The world fields that carry a `sustains` key. */
const markedFields = (n: Normalized): string[] => Object.keys(n.world).filter(id => 'sustains' in n.world[id]);

test('a mark that passes: a number in megalitres, moved by the draft\'s own tables, in a run of twelve one-year turns keeps sustains: true, and no other field is marked', async () => {
  const n = normalize({ ...TWELVE_YEARS, metrics: [reserve({ sustains: true }), { id: 'stock', initial: 100 }], effects: RESERVE_TABLES });
  assert.deepEqual(n.world.reserve, { id: 'reserve', label: 'Reserve', unit: 'megalitres', type: 'number', initial: 200, min: 0, category: 'metric', sustains: true });
  assert.deepEqual(Object.keys(n.world.reserve), ['id', 'label', 'unit', 'type', 'initial', 'min', 'category', 'sustains'], 'the mark is the field\'s last key');
  assert.deepEqual(markedFields(n), ['reserve']);
  assert.deepEqual(refusedMarks(n), [], `no mark is dropped (read ${JSON.stringify(n.notes.map(note => note.message))})`);
  const { metadata, pkg } = await kernelOf(n.scenario);
  assert.deepEqual(metadata.landingSupplies, { reserve: 200 }, `a kernel keeps the reserve's amount on day one (read ${JSON.stringify(metadata.landingSupplies)})`);
  assert.deepEqual(lintSustainsMarks(n.scenario), [], 'the lint reports nothing for the scenario JSON');
  assert.deepEqual(lintSustainsMarks(pkg as unknown as Json), [], 'nor for the compiled package, whose tables are in the array form');
});

test('the reservoir draft keeps its mark: a kernel keeps the water reserve\'s 500 megalitres as its landing supply, with one death die for a life', async () => {
  const { scenario, notes } = seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture('draft-reservoir-with-mark.json')));
  assert.deepEqual(notes, [], `the draft needs no default and no repair (read ${JSON.stringify(notes.map(note => note.message))})`);
  assert.deepEqual(validateSeedWorld(scenario).errors, [], 'validateSeedWorld reports nothing');
  const s = scenario as Json;
  assert.equal(s.world.metrics['water-reserve'].sustains, true);
  assert.equal('sustains' in s.world.metrics['service-coverage'], false);
  assert.deepEqual(sustainsVeto(scenario), [], 'the veto refuses nothing');
  const { metadata } = await kernelOf(s);
  assert.deepEqual(metadata.landingSupplies, { 'water-reserve': 500 }, `read ${JSON.stringify(metadata.landingSupplies)}`);
  assert.equal(metadata.mortalityDice, 'life', `read ${JSON.stringify(metadata.mortalityDice)}`);
});

test('no metric is marked unless its draft marks it; only exactly true is a mark', () => {
  const unmarked = normalize({ ...TWELVE_YEARS, metrics: [reserve(), { id: 'stock', initial: 100 }], effects: RESERVE_TABLES });
  assert.deepEqual(markedFields(unmarked), [], 'a draft that marks nothing compiles to a world that marks nothing');
  const no = normalize({ ...TWELVE_YEARS, metrics: [reserve({ sustains: false }), { id: 'stock', initial: 100 }], effects: RESERVE_TABLES });
  assert.deepEqual([markedFields(no), refusedMarks(no)], [[], []], 'sustains: false leaves no key and no note');

  const metrics = (sustains: unknown) => [reserve({ sustains }), { id: 'stock', format: 'number', initial: 100 }];
  const parsed = (sustains: unknown) => DraftScenarioSchema.parse(draftWith({ ...TWELVE_YEARS, metrics: metrics(sustains), effects: RESERVE_TABLES })).metrics[0].sustains;
  assert.equal(parsed('yes'), undefined, 'a string where sustains goes reads as absent');
  assert.equal(parsed(1), undefined, 'a number there reads as absent');
  assert.equal(parsed(null), undefined, 'a null there reads as absent');
  assert.equal(parsed(true), true);
  assert.equal(parsed(false), false);
  assert.deepEqual(markedFields(normalize({ ...TWELVE_YEARS, metrics: metrics('yes'), effects: RESERVE_TABLES })), [], 'and the field is not marked');
});

test('veto rule 1: a mark on population or on morale is dropped', () => {
  const n = normalize({ ...TWELVE_YEARS, metrics: [{ id: 'population', sustains: true }, { id: 'morale', sustains: true }, reserve(), { id: 'stock', initial: 100 }], effects: RESERVE_TABLES });
  assert.deepEqual(refusedMarks(n), ['population rule 1', 'morale rule 1']);
  assert.deepEqual(markedFields(n), []);
  assert.deepEqual(n.notes.filter(note => note.rule === 'mark-refused').map(note => note.path), ['metrics[0].sustains', 'metrics[1].sustains']);
  requireNote(n, 'mark-refused', 'population: its mark as a supply that sustains the people is dropped (rule 1): the head count is the roster');
  requireNote(n, 'mark-refused', 'morale is a mood');
});

test('veto rule 2: a mark on a percent, on a currency, or on a number whose unit is a score\'s or names money is dropped', () => {
  const four = ['coverage', 'fund', 'rating', 'cash-pile'];
  const changes: Record<string, number> = { coverage: 2, fund: 60, rating: 5, 'cash-pile': 5 };
  const n = normalize({
    ...TWELVE_YEARS,
    metrics: [
      { id: 'coverage', format: 'percent', initial: 70, sustains: true },
      { id: 'fund', format: 'currency', initial: 1200, sustains: true },
      { id: 'rating', format: 'number', unit: 'score', initial: 100, sustains: true },
      { id: 'cash-pile', format: 'number', unit: 'USD', initial: 100, sustains: true },
    ],
    effects: ['drought', 'works', 'demand'].map(category => ({ category, entries: four.map(metric => ({ metric, change: changes[metric] })) })),
  });
  assert.deepEqual(refusedMarks(n), ['coverage rule 2', 'fund rule 2', 'rating rule 2', 'cash-pile rule 2']);
  assert.deepEqual(markedFields(n), []);
  requireNote(n, 'mark-refused', 'coverage: its mark as a supply that sustains the people is dropped (rule 2): it is not a plain quantity: its score is a percent');
  requireNote(n, 'mark-refused', 'its score is a currency');
  requireNote(n, 'mark-refused', 'its unit, "score", is a share\'s or a score\'s');
  requireNote(n, 'mark-refused', 'its unit, "USD", names money');
  assert.deepEqual(n.effects.drought, changes, 'every table names all four, so no other rule is in play');
});

test('veto rule 3: a mark on a number that is better lower is dropped', () => {
  const n = normalize({ ...TWELVE_YEARS, metrics: [reserve({ better: 'lower', sustains: true }), { id: 'stock', initial: 100 }], effects: RESERVE_TABLES });
  assert.deepEqual(refusedMarks(n), ['reserve rule 3']);
  assert.deepEqual(markedFields(n), []);
  requireNote(n, 'mark-refused', 'its score is better lower');
});

test('veto rule 4: a mark on a number that starts at 0 is dropped', () => {
  const n = normalize({ ...TWELVE_YEARS, metrics: [reserve({ initial: 0, sustains: true }), { id: 'stock', initial: 100 }], effects: RESERVE_TABLES });
  assert.deepEqual(refusedMarks(n), ['reserve rule 4']);
  assert.deepEqual(markedFields(n), []);
  requireNote(n, 'mark-refused', 'it does not start above 0 (it starts at 0)');
});

test('veto rule 5: a mark on a number none of the draft\'s own tables names is dropped, though the finished tables name every score', () => {
  const stockOnly = ['drought', 'works', 'demand'].map(category => ({ category, entries: [{ metric: 'stock', change: 5 }] }));
  const n = normalize({ ...TWELVE_YEARS, metrics: [reserve({ sustains: true }), { id: 'stock', initial: 100 }], effects: stockOnly });
  assert.deepEqual(refusedMarks(n), ['reserve rule 5']);
  assert.deepEqual(markedFields(n), []);
  requireNote(n, 'mark-refused', 'no category table names it');
  assert.equal(n.effects.drought.reserve, 10, 'the finished tables give the score its default entry all the same');

  // A table whose one entry is dropped takes the default table, which names
  // every score. The veto reads the tables before that, so the mark still goes.
  const emptied = normalize({
    ...TWELVE_YEARS,
    metrics: [reserve({ sustains: true }), { id: 'stock', initial: 100 }],
    effects: [{ category: 'drought', entries: [{ metric: 'reserve', change: 0 }] }, ...stockOnly.slice(1)],
  });
  assert.deepEqual(refusedMarks(emptied), ['reserve rule 5']);
  assert.deepEqual(emptied.effects.drought, { reserve: 10, stock: 5 }, 'the emptied table took the default table');
  requireNote(emptied, 'table-defaulted', 'drought');

  // A draft that lists no table keeps no mark.
  const none = normalize({ ...TWELVE_YEARS, metrics: [reserve({ sustains: true }), { id: 'stock', initial: 100 }] });
  assert.deepEqual([refusedMarks(none), markedFields(none)], [['reserve rule 5'], []]);
});

test('veto rule 6: a mark in a scenario whose default run spans under five years is dropped: the orchard draft spans 0.75', () => {
  const orchard = loadCompilerFixture('draft-orchard-with-tables.json') as Json;
  orchard.metrics[0].sustains = true;
  const { scenario, notes } = seedDraftToScenarioJson(DraftScenarioSchema.parse(orchard));
  assert.deepEqual(validateSeedWorld(scenario).errors, []);
  const refused = notes.filter(note => note.rule === 'mark-refused').map(note => note.message);
  assert.deepEqual(refused, [
    'harvest: its mark as a supply that sustains the people is dropped (rule 6): the default run spans 0.75 years, under 5: too short for a supply to show in who lives',
  ]);
  assert.equal('sustains' in (scenario as Json).world.metrics.harvest, false);

  // Six one-year turns span five years, which is enough; five span four.
  const turns = (defaultTurns: number, labels?: Json, more: Json = {}) => normalize({
    setup: { defaultTurns, defaultPopulation: 20, defaultStartTime: 1, ...more },
    ...(labels ? { labels } : {}),
    metrics: [reserve({ sustains: true }), { id: 'stock', initial: 100 }],
    effects: RESERVE_TABLES,
  });
  assert.deepEqual(markedFields(turns(6)), ['reserve'], `a run of ${SUSTAINS_MIN_YEARS} years keeps the mark`);
  assert.deepEqual(refusedMarks(turns(5)), ['reserve rule 6']);
  const quarters = { name: 'Test world', populationNoun: 'people', settlementNoun: 'site', timeUnitNoun: 'quarter' };
  const inQuarters = turns(12, quarters);
  assert.deepEqual(refusedMarks(inQuarters), ['reserve rule 6']);
  requireNote(inQuarters, 'mark-refused', 'the default run spans 2.75 years');
  const decades = { name: 'Test world', populationNoun: 'people', settlementNoun: 'site', timeUnitNoun: 'decade' };
  assert.deepEqual(markedFields(turns(2, decades, { yearsPerTimeUnit: 10 })), ['reserve'], 'two turns of a declared ten years each span ten years');
});

test('veto rule 7: of six marks that pass every other rule, the sixth is dropped', async () => {
  const six = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'];
  const table = (category: string, ids: string[]) => ({ category, entries: ids.map(metric => ({ metric, change: 5 })) });
  const n = normalize({
    ...TWELVE_YEARS,
    metrics: six.map(id => ({ id, format: 'number', unit: 'tonnes', initial: 100, sustains: true })),
    effects: [table('drought', ['aa', 'bb', 'cc', 'dd']), table('works', ['ee', 'ff', 'aa', 'bb']), table('demand', ['cc', 'dd', 'ee', 'ff'])],
  });
  assert.deepEqual(refusedMarks(n), ['ff rule 7']);
  assert.deepEqual(markedFields(n), six.slice(0, SUSTAINS_MAX_MARKS));
  requireNote(n, 'mark-refused', '5 supplies are marked before it');
  const { metadata } = await kernelOf(n.scenario);
  assert.deepEqual(metadata.landingSupplies, { aa: 100, bb: 100, cc: 100, dd: 100, ee: 100 }, `a kernel keeps five landing supplies (read ${JSON.stringify(metadata.landingSupplies)})`);
});

test('veto rule 5 reads the tables a compile keeps: a mark that only a ninth table names is dropped with that table', async () => {
  // A compile keeps a draft's first eight tables. Here eight tables name
  // the stock alone, and the one table that names the reserve is the ninth.
  const stockTable = (i: number) => ({ category: `kind-${i + 1}`, entries: [{ metric: 'stock', change: 5 }] });
  const reserveTable = (i: number) => ({ category: `kind-${i + 1}`, entries: [{ metric: 'stock', change: 5 }, { metric: 'reserve', change: 10 }] });
  const metrics = [reserve({ sustains: true }), { id: 'stock', initial: 100 }];
  const eight = ['kind-1', 'kind-2', 'kind-3', 'kind-4', 'kind-5', 'kind-6', 'kind-7', 'kind-8'];

  const n = normalize({ ...TWELVE_YEARS, metrics, effects: [...Array.from({ length: 8 }, (_, i) => stockTable(i)), reserveTable(8)] });
  requireNote(n, 'table-dropped', 'kind-9');
  assert.deepEqual(Object.keys(n.effects), eight);
  assert.deepEqual(refusedMarks(n), ['reserve rule 5'], `the mark goes with the one table that named it (read marked fields ${JSON.stringify(markedFields(n))})`);
  assert.deepEqual(markedFields(n), []);
  assert.equal(n.effects['kind-1'].reserve, 10, 'the kept tables give the score its default entry all the same');
  const { metadata } = await kernelOf(n.scenario);
  assert.equal(metadata.landingSupplies, undefined, `a kernel keeps no landing supply (read ${JSON.stringify(metadata.landingSupplies)})`);

  // Named by the eighth table, which is kept, the mark stays.
  const kept = normalize({ ...TWELVE_YEARS, metrics, effects: [...Array.from({ length: 7 }, (_, i) => stockTable(i)), reserveTable(7), stockTable(8)] });
  requireNote(kept, 'table-dropped', 'kind-9');
  assert.deepEqual(Object.keys(kept.effects), eight);
  assert.deepEqual([refusedMarks(kept), markedFields(kept)], [[], ['reserve']], 'a mark the eighth table names stays');
});

test('veto rule 2 reads the unit a draft wrote: a mark on a number the draft gives in % or in frac is dropped, though the field does not keep that unit', async () => {
  const n = normalize({
    ...TWELVE_YEARS,
    metrics: [
      { id: 'air', format: 'number', unit: '%', initial: 80, sustains: true },
      { id: 'ratio', format: 'number', unit: 'frac', initial: 100, sustains: true },
    ],
    effects: ['drought', 'works', 'demand'].map(category => ({ category, entries: [{ metric: 'air', change: 4 }, { metric: 'ratio', change: 5 }] })),
  });
  assert.deepEqual([n.world.air.unit, n.world.ratio.unit], ['', ''], 'neither field keeps the unit, as before');
  requireNote(n, 'unit-dropped', 'air');
  requireNote(n, 'unit-dropped', 'ratio');
  assert.deepEqual(refusedMarks(n), ['air rule 2', 'ratio rule 2'], `a value its own draft calls a share is not a supply (read marked fields ${JSON.stringify(markedFields(n))})`);
  assert.deepEqual(markedFields(n), []);
  requireNote(n, 'mark-refused', 'its unit, "%", is a share\'s or a score\'s');
  requireNote(n, 'mark-refused', 'its unit, "frac", is a share\'s or a score\'s');
  assert.deepEqual(n.effects.drought, { air: 4, ratio: 5 }, 'every table names both, so no other rule is in play');
  const { metadata } = await kernelOf(n.scenario);
  assert.equal(metadata.landingSupplies, undefined, `a kernel keeps no landing supply (read ${JSON.stringify(metadata.landingSupplies)})`);
});

/** A scenario JSON whose one mark passes all seven rules. Each case below changes one thing in it. */
const passingWorld = (): Json => ({
  labels: { timeUnitNoun: 'year' },
  setup: { defaultTurns: 12 },
  world: {
    metrics: { reserve: { id: 'reserve', label: 'Reserve', unit: 'megalitres', type: 'number', initial: 500, min: 0, category: 'metric', sustains: true } },
    capacities: {},
  },
  metrics: [{ id: 'reserve', label: 'Reserve', source: 'metrics.reserve', format: 'number' }],
  effects: { drought: { reserve: -30 }, works: { reserve: 25 }, demand: { morale: 0.03 } },
});
/** The passing world with its one field, its score and its tables under another key. */
const passingWorldKeyed = (key: string): Json => {
  const json = passingWorld();
  json.world.metrics = { [key]: { ...json.world.metrics.reserve, id: key } };
  json.metrics = [{ id: key, label: 'Reserve', source: `metrics.${key}`, format: 'number' }];
  json.effects = { drought: { [key]: -30 }, works: { [key]: 25 }, demand: { stock: 5 } };
  return json;
};

test('the veto passes a plain stock that starts above 0, is moved by a table and has a run of five years or more, in either form of effects', () => {
  assert.deepEqual(sustainsVeto(passingWorld()), []);
  const cases: Array<[what: string, edit: (json: Json) => void]> = [
    ['the tables in the array form of a compiled package', (j) => { j.effects = [{ id: 'category_effects', type: 'category_outcome', label: 'Category Outcome Effects', categoryDefaults: j.effects }]; }],
    ['no declared score reads the field', (j) => { j.metrics = []; }],
    ['the field is a capacity', (j) => { j.world.capacities = j.world.metrics; j.world.metrics = {}; j.metrics[0].source = 'capacities.reserve'; }],
    ['an empty unit', (j) => { j.world.metrics.reserve.unit = ''; }],
    ['a unit that only holds the letters of a currency code ("heures")', (j) => { j.world.metrics.reserve.unit = 'heures'; }],
    ['a run of exactly five years: six one-year turns', (j) => { j.setup.defaultTurns = 6; }],
    ['two turns of eight years each', (j) => { j.setup = { defaultTurns: 2, defaultTimePerTurn: 8 }; }],
    ['twelve turns of half a year each', (j) => { j.setup.yearsPerTimeUnit = 0.5; }],
    ['sixty-one monthly turns, five years', (j) => { j.labels.timeUnitNoun = 'month'; j.setup.defaultTurns = 61; }],
  ];
  for (const [what, edit] of cases) {
    const json = passingWorld();
    edit(json);
    assert.deepEqual(sustainsVeto(json), [], `${what}: the mark passes`);
    assert.deepEqual(lintSustainsMarks(json), [], `${what}: the lint agrees`);
  }
});

test('each rule of the veto refuses a mark that differs from a passing one in the one thing the rule reads', () => {
  const cases: Array<[rule: number, what: string, build: () => Json, key: string, words: string]> = [
    [1, 'the key is population', () => passingWorldKeyed('population'), 'population', 'the head count is the roster'],
    [1, 'the key is morale', () => passingWorldKeyed('morale'), 'morale', 'morale is a mood'],
    [2, 'the field\'s type is a string', () => { const j = passingWorld(); j.world.metrics.reserve.type = 'string'; return j; }, 'reserve', 'its type is "string", not a number'],
    [2, 'its score is a percent', () => { const j = passingWorld(); j.metrics[0].format = 'percent'; return j; }, 'reserve', 'its score is a percent'],
    [2, 'its score is a currency', () => { const j = passingWorld(); j.metrics[0].format = 'currency'; return j; }, 'reserve', 'its score is a currency'],
    [2, 'its unit is %', () => { const j = passingWorld(); j.world.metrics.reserve.unit = '%'; return j; }, 'reserve', 'its unit, "%", is a share\'s or a score\'s'],
    [2, 'its unit is frac', () => { const j = passingWorld(); j.world.metrics.reserve.unit = 'frac'; return j; }, 'reserve', 'its unit, "frac"'],
    [2, 'its unit is Score', () => { const j = passingWorld(); j.world.metrics.reserve.unit = 'Score'; return j; }, 'reserve', 'its unit, "Score"'],
    [2, 'its unit is USD/mo', () => { const j = passingWorld(); j.world.metrics.reserve.unit = 'USD/mo'; return j; }, 'reserve', 'its unit, "USD/mo", names money'],
    [2, 'its unit is k eur', () => { const j = passingWorld(); j.world.metrics.reserve.unit = 'k eur'; return j; }, 'reserve', 'names money'],
    [2, 'its unit is $M', () => { const j = passingWorld(); j.world.metrics.reserve.unit = '$M'; return j; }, 'reserve', 'names money'],
    [3, 'its score is better lower', () => { const j = passingWorld(); j.metrics[0].better = 'lower'; return j; }, 'reserve', 'its score is better lower'],
    [4, 'it starts at 0', () => { const j = passingWorld(); j.world.metrics.reserve.initial = 0; return j; }, 'reserve', 'it starts at 0'],
    [4, 'it starts under 0', () => { const j = passingWorld(); j.world.metrics.reserve.initial = -5; delete j.world.metrics.reserve.min; return j; }, 'reserve', 'it starts at -5'],
    [4, 'it has no start', () => { const j = passingWorld(); delete j.world.metrics.reserve.initial; return j; }, 'reserve', 'it starts at nothing'],
    [5, 'no table names it', () => { const j = passingWorld(); j.effects = { drought: { morale: -0.03 }, works: { stock: 25 } }; return j; }, 'reserve', 'no category table names it'],
    [5, 'no table names it, in the array form', () => { const j = passingWorld(); j.effects = [{ categoryDefaults: { drought: { morale: -0.03 } } }]; return j; }, 'reserve', 'no category table names it'],
    [5, 'the scenario has no table', () => { const j = passingWorld(); delete j.effects; return j; }, 'reserve', 'no category table names it'],
    [6, 'five one-year turns span four years', () => { const j = passingWorld(); j.setup.defaultTurns = 5; return j; }, 'reserve', 'the default run spans 4 years, under 5'],
    [6, 'twelve monthly turns', () => { const j = passingWorld(); j.labels.timeUnitNoun = 'month'; return j; }, 'reserve', 'the default run spans 0.916667 years'],
    [6, 'twelve turns of a quarter of a year each', () => { const j = passingWorld(); j.setup.defaultTimePerTurn = 0.25; return j; }, 'reserve', 'the default run spans 2.75 years'],
    [6, 'no setup to read the run\'s length from', () => { const j = passingWorld(); delete j.setup; return j; }, 'reserve', 'the length of the default run cannot be read'],
  ];
  for (const [rule, what, build, key, words] of cases) {
    const found = sustainsVeto(build());
    assert.deepEqual(found.map(f => [f.key, f.rule]), [[key, rule]], `${what}: rule ${rule} refuses the mark (read ${JSON.stringify(found)})`);
    assert.ok(found[0].reason.includes(words), `${what}: the reason says "${words}" (read "${found[0].reason}")`);
    assert.deepEqual(lintSustainsMarks(build()), found, `${what}: the lint returns the veto's finding`);
  }
});

test('veto rule 7 counts the marks that pass the first six, in the order the world declares them, metrics before capacities', () => {
  const field = (id: string, over: Json = {}) => ({ id, label: id, unit: 'tonnes', type: 'number', initial: 100, min: 0, category: 'metric', sustains: true, ...over });
  const json: Json = {
    labels: { timeUnitNoun: 'year' },
    setup: { defaultTurns: 12 },
    world: {
      // `zero` starts at nothing, so rule 4 refuses it and it does not count toward the five.
      metrics: { aa: field('aa'), zero: field('zero', { initial: 0 }), bb: field('bb'), cc: field('cc'), dd: field('dd'), ee: field('ee') },
      capacities: { ff: field('ff', { category: 'capacity' }), gg: field('gg', { category: 'capacity' }) },
    },
    metrics: [],
    effects: { supply: { aa: 5, zero: 5, bb: 5, cc: 5, dd: 5, ee: 5, ff: 5, gg: 5 } },
  };
  assert.deepEqual(sustainsVeto(json).map(f => [f.key, f.rule]), [['zero', 4], ['ff', 7], ['gg', 7]]);
});

test('a mark that several rules refuse is reported under the first', () => {
  const both = passingWorld();
  both.metrics[0].format = 'percent';
  both.metrics[0].better = 'lower';
  both.world.metrics.reserve.initial = 0;
  both.setup.defaultTurns = 2;
  assert.deepEqual(sustainsVeto(both).map(f => f.rule), [2]);
  assert.deepEqual(sustainsVeto({}), [], 'a JSON with no world has no mark to refuse');
  assert.deepEqual(sustainsVeto({ world: { metrics: { reserve: { sustains: false }, tank: { sustains: 'yes' } } } }), [], 'only exactly true is a mark');
});

test('validateSeedWorld names a mark the veto refuses and death dice other than one for a life', () => {
  const { scenario } = seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture('draft-reservoir-with-mark.json')));
  const marked = JSON.parse(JSON.stringify(scenario));
  marked.world.metrics['service-coverage'].sustains = true;
  assert.ok(
    validateSeedWorld(marked).errors.some(e => e.includes('service-coverage: its mark as a supply that sustains the people breaks rule 2 of the veto')),
    `the check names the mark on a percent (read ${JSON.stringify(validateSeedWorld(marked).errors)})`,
  );
  for (const [dice, words] of [[undefined, 'setup.mortalityDice is absent, not "life"'], ['year', 'setup.mortalityDice is "year", not "life"']] as const) {
    const diced = JSON.parse(JSON.stringify(scenario));
    if (dice === undefined) delete diced.setup.mortalityDice;
    else diced.setup.mortalityDice = dice;
    assert.deepEqual(validateSeedWorld(diced).errors, [words]);
  }
});

test('every compile keeps one death die for a life: setup is the draft\'s own with mortalityDice life, and a kernel records it', async () => {
  for (const file of FIXTURES) {
    const draft = DraftScenarioSchema.parse(loadCompilerFixture(file));
    const { scenario } = seedDraftToScenarioJson(draft);
    assert.deepEqual((scenario as Json).setup, { ...draft.setup, mortalityDice: 'life' }, `${file}: setup`);
    assert.deepEqual(Object.keys((scenario as Json).setup).pop(), 'mortalityDice', `${file}: the die is setup's last key`);
  }
  const bare = seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture('draft-orchard-bare.json'))).scenario as Json;
  const { metadata } = await kernelOf(bare);
  assert.equal(metadata.mortalityDice, 'life', `read ${JSON.stringify(metadata.mortalityDice)}`);
  assert.equal(metadata.landingSupplies, undefined, 'a draft that marks no supply keeps no landing amount');
});

// ---- The bound, the schema's limits, determinism ---------------------------------

test('for every fixture draft, 5.81 times a score\'s largest entry is under its scale: no one decision takes a score from its start to a bound', () => {
  let checked = 0;
  for (const file of FIXTURES) {
    const { scenario } = seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture(file)));
    const s = scenario as Json;
    assert.deepEqual(validateSeedWorld(scenario).errors, [], `${file}: validateSeedWorld reports nothing`);
    const largest = new EffectRegistry(s.effects).largestEntries();
    for (const [id, entry] of Object.entries(largest)) {
      const scale = scoreScale(id, s.world.metrics[id] ?? { initial: 0.85, min: 0, max: 1 });
      if (scale === undefined || scale < 0.12) continue;
      assert.ok(5.81 * entry < scale, `${file}: ${id} has a largest entry of ${entry} and a scale of ${scale}; 5.81 times the entry is ${5.81 * entry}`);
      checked++;
    }
  }
  assert.ok(checked >= 26, `the fixtures' scores were checked (read ${checked})`);
});

/** Every object shape the schema holds, through its optional, default, catch and array wrappers. */
function walk(schema: any, visit: (def: any, schema: any) => void): void {
  const def = schema?._zod?.def ?? schema?.def;
  if (!def) return;
  visit(def, schema);
  if (def.type === 'object') for (const field of Object.values(def.shape)) walk(field, visit);
  if (def.innerType) walk(def.innerType, visit);
  if (def.element) walk(def.element, visit);
  if (def.valueType) walk(def.valueType, visit);
}

test('the draft schema holds no record and 15 optional properties, inside the 16 a strict reply allows', () => {
  const types: string[] = [];
  const optional: string[] = [];
  walk(DraftScenarioSchema, (def) => {
    types.push(def.type);
    if (def.type !== 'object') return;
    for (const [key, field] of Object.entries(def.shape) as Array<[string, any]>) {
      if (field.isOptional()) optional.push(key);
    }
  });
  assert.ok(types.includes('object') && types.includes('array') && types.includes('catch'), `the walk reached the schema's wrappers (read ${JSON.stringify([...new Set(types)])})`);
  assert.equal(types.includes('record'), false, 'no record: one takes the whole schema out of strict mode');
  assert.deepEqual(optional.sort(), [
    'actorNoun', 'actorNounPlural', 'better', 'currency', 'defaultSeed', 'effects', 'format', 'initial', 'label', 'max', 'min', 'sustains', 'theme', 'unit', 'yearsPerTimeUnit',
  ]);
  assert.equal(optional.length, 15, `${optional.length} optional properties`);
  assert.ok(optional.length <= 16, `${optional.length} optional properties`);
});

test('the same draft gives the same JSON text, and its keys come in one order', () => {
  for (const file of FIXTURES) {
    const text = () => JSON.stringify(seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture(file))).scenario);
    assert.equal(text(), text(), `${file}: two passes give the same text`);
  }
  const { scenario } = seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture('recorded-draft-ai-lab.json')));
  assert.deepEqual(Object.keys(scenario), ['id', 'labels', 'theme', 'setup', 'world', 'departments', 'metrics', 'effects', 'ui', 'knowledge']);
});

test('validateSeedWorld names what breaks the seed path\'s rules', () => {
  const { scenario } = seedDraftToScenarioJson(DraftScenarioSchema.parse(loadCompilerFixture('draft-orchard-with-tables.json')));
  const broken = JSON.parse(JSON.stringify(scenario));
  broken.world.metrics.harvest.initial = -5;
  delete broken.world.metrics['soil-health'];
  broken.effects.weather.harvest = 400;
  broken.effects.market.population = 3;
  broken.effects.market.ghost = 1;
  delete broken.effects.labour;
  broken.ui.headerMetrics.push({ id: 'ghost', format: 'number' });
  const { ok, errors } = validateSeedWorld(broken);
  assert.equal(ok, false);
  for (const words of [
    'harvest: the start -5 lies outside its bounds',
    'soil-health: the declared score has no world field',
    'the scenario has 2 category tables, fewer than 3',
    'knowledge.categoryMapping maps "labour", which has no table',
    'table "market" names population',
    'table "market" names "ghost", which is neither a declared score nor morale',
    'ui.headerMetrics names "ghost", which is not a declared score',
  ]) {
    assert.ok(errors.some(e => e.includes(words)), `an error says "${words}" (read ${JSON.stringify(errors)})`);
  }
});
