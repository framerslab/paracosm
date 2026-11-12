/**
 * From a seed draft to a scenario JSON with a world: every default and
 * every repair `seedDraftToScenarioJson` applies.
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
  scoreScale,
  seedDraftToScenarioJson,
  type DraftNote,
} from '../../../src/engine/compiler/seed-draft-world.js';
import { validateSeedWorld } from '../../../src/engine/compiler/validate.js';
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
  return { pkg, metrics: kernel.getState().metrics as unknown as Record<string, number>, registry: EffectRegistry.forScenario(pkg) };
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

// ---- The bound, the schema's limits, determinism ---------------------------------

const FIXTURES = [
  'draft-orchard-bare.json',
  'draft-orchard-with-tables.json',
  'recorded-draft-ai-lab.json',
  'recorded-draft-generation-ship.json',
  'recorded-draft-pandemic-governor.json',
  'recorded-draft-game-studio.json',
];

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

test('the draft schema holds no record and 14 optional properties, inside the 16 a strict reply allows', () => {
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
    'actorNoun', 'actorNounPlural', 'better', 'currency', 'defaultSeed', 'effects', 'format', 'initial', 'label', 'max', 'min', 'theme', 'unit', 'yearsPerTimeUnit',
  ]);
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
