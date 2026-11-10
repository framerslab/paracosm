/**
 * What a Mars colony holds of the supplies that keep its people alive
 * reaches who lives (#234).
 *
 * The live Mars Genesis pair of 10 November 2026 (seed 950, 30 people, six
 * turns of eight years) lost the same 18 people under both leaders. Their
 * habitats differed only from the end of the fourth turn, so the dose the
 * modules shield differed in the last 16 years, by less than any roll, and
 * the water, life support, power and pressurized volume the leaders moved
 * fed no death rate. The yearly age and accident rates divide by the
 * colony's supply level: the geometric mean of the supplies the scenario
 * marks as sustaining its people, each against its amount on landing day,
 * held within a half and double. Each person rolls the same dice under
 * both leaders (#184), so nobody dies only on the side that holds more.
 *
 * These tests run a pair the way a hosted run does (the scenario's preset
 * roster, `new SimulationKernel` with the scenario, `advanceTurn` with its
 * progression hook), hold each side's metrics after every turn where the
 * live run's outcomes and adopted effects left them (`applySystemDeltas`,
 * the call both land in), and compare who died. No model call. The last
 * tests pin what must not move: the scenarios that mark no supply, and a
 * Mars colony whose supplies never move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import type { ProgressionHookContext, ScenarioPackage } from '../../src/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const hook = marsScenario.hooks.progressionHook;
/** Mars turns: the landing in 2035, then a turn every eight years. */
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
/** The live pair's seed, then sixty more. */
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';

/** What a side holds after each of the six turns, key by key. */
type Held = Array<Record<string, number>>;
/** A department head the commander names before the first turn: id, department, role. */
type Promotion = [id: string, department: string, role: string];

/** The six turn ends of each metric, as one `Held`. */
function byTurn(columns: Record<string, number[]>): Held {
  return TURNS.map((_, i) => Object.fromEntries(Object.entries(columns).map(([key, values]) => [key, values[i]])));
}

/** A colony that holds `value` of `key` from the first turn on, and nothing else. */
function flat(key: string, value: number): Held {
  return byTurn({ [key]: TURNS.map(() => value) });
}

/** Mars Genesis on landing day, as a hosted run starts it: what its five supplies hold. */
const LANDING = {
  lifeSupportCapacity: 120,
  waterLitersPerDay: 800,
  powerKw: 400,
  pressurizedVolumeM3: 3000,
  infrastructureModules: 3,
};

/** The live pair of 10 November 2026: its `turn_done` metrics, Aria Chen's side. */
const LIVE_ARIA = {
  infrastructureModules: [4, 4, 4, 4, 4, 5],
  foodMonthsReserve: [19.22, 22.94, 29.34, 39.58, 47.59, 53.19],
  morale: [0.975, 0.892285, 1, 1, 1, 1],
  lifeSupportCapacity: [125, 120, 122.71, 118.71, 116.71, 121.71],
  powerKw: [498.66, 496.26, 478.06, 431.86, 466.94, 490.63],
  pressurizedVolumeM3: [3200, 3200, 3200, 3200, 3200, 3200],
  waterLitersPerDay: [900, 715.4, 625.4, 641.34, 571.34, 671.34],
  scienceOutput: [0, 8, 18, 29, 40, 51.52],
};

/** The same pair, Dietrich Voss's side. */
const LIVE_DIETRICH = {
  infrastructureModules: [4, 4, 4, 7.38, 9.79, 10.79],
  foodMonthsReserve: [19.19, 24.79, 35.49, 41.09, 54.802, 74.298],
  morale: [1, 0.873047, 1, 1, 1, 1],
  lifeSupportCapacity: [125, 125.67, 125.67, 139.15, 144.15, 149.15],
  powerKw: [518.07, 500.67, 438.27, 457.94, 467.8, 510.67],
  pressurizedVolumeM3: [3200, 3320, 3320, 3557.57, 3798.44, 3998.44],
  waterLitersPerDay: [900, 900, 960.06, 960.06, 960.06, 960.06],
  scienceOutput: [0, 8, 17, 25, 32, 46.29],
};

/** The department heads both live leaders named. */
const HEADS: Promotion[] = [
  ['col-sven-kim', 'medical', 'Chief Medical Officer'],
  ['col-bruno-morales', 'engineering', 'Chief Engineer'],
  ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'],
];

interface Run {
  /** Everyone not alive at the end, children included. */
  dead: Set<string>;
  /** The people the run began with. */
  founders: Set<string>;
  names: Map<string, string>;
}

const runs = new Map<string, Run>();

/** Six Mars turns on the preset roster with `held` set after each turn. */
function run(seed: number, leader: string, held: Held, heads: Promotion[] = []): Run {
  const key = JSON.stringify([seed, leader, held, heads]);
  const cached = runs.get(key);
  if (cached) return cached;
  const kernel = new SimulationKernel(seed, leader, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const founders = new Set(kernel.getState().agents.map(a => a.core.id));
  for (const [id, department, role] of heads) kernel.promoteAgent(id, department, role, leader);
  TURNS.forEach(([turn, time], i) => {
    const metrics = kernel.advanceTurn(turn, time, hook).metrics as Record<string, number>;
    kernel.applySystemDeltas(Object.fromEntries(
      Object.entries(held[i]).map(([k, target]) => [k, target - metrics[k]]),
    ));
  });
  const agents = kernel.getState().agents;
  const result: Run = {
    dead: new Set(agents.filter(a => !a.health.alive).map(a => a.core.id)),
    founders,
    names: new Map(agents.map(a => [a.core.id, a.core.name])),
  };
  runs.set(key, result);
  return result;
}

function names(r: Run, ids: Iterable<string>): string[] {
  return [...ids].map(id => r.names.get(id) ?? id).sort();
}

function differ(a: Run, b: Run): boolean {
  return a.dead.size !== b.dead.size || [...a.dead].some(id => !b.dead.has(id));
}

/** The founders who died under `more` (the side that holds more) and lived under `less`. */
function onlyUnderMore(more: Run, less: Run): string[] {
  return names(more, [...more.dead].filter(id => more.founders.has(id) && !less.dead.has(id)));
}

interface Sweep {
  label: string;
  /** Seeds of 61 whose two dead sets differ. */
  differ: number;
  /** Deaths a run on each side, children included. */
  deaths: [less: number, more: number];
  /** Seeds where a founder died only on the side that holds more, with who. */
  notNested: string[];
}

/** A pair over the 61 seeds, no promotions: one side holds `less`, the other `more`. */
function sweep(label: string, less: Held, more: Held): Sweep {
  let count = 0;
  let deathsLess = 0;
  let deathsMore = 0;
  const notNested: string[] = [];
  for (const seed of SEEDS) {
    const a = run(seed, ARIA, less);
    const b = run(seed, DIETRICH, more);
    if (differ(a, b)) count++;
    deathsLess += a.dead.size;
    deathsMore += b.dead.size;
    const extra = onlyUnderMore(b, a);
    if (extra.length > 0) notNested.push(`seed ${seed}: ${extra.join(', ')}`);
  }
  const perRun = (n: number) => Math.round((n / SEEDS.length) * 100) / 100;
  return { label, differ: count, deaths: [perRun(deathsLess), perRun(deathsMore)], notNested };
}

function report(sweeps: Sweep[]): string {
  return sweeps.map(s => `${s.label}: ${s.differ} of ${SEEDS.length} differ, deaths a run ${s.deaths[0]} against ${s.deaths[1]}`).join('; ');
}

/** Sweeps that must reach at least `floor` of the 61 seeds, with nobody dying only on the side that holds more. */
function assertFloors(t: { diagnostic(message: string): void }, sweeps: Array<Sweep & { floor: number }>): void {
  t.diagnostic(report(sweeps));
  assert.deepEqual(sweeps.filter(s => s.differ < s.floor).map(s => `${s.label} (floor ${s.floor})`), [], report(sweeps));
  assert.deepEqual(sweeps.flatMap(s => s.notNested.map(n => `${s.label}, ${n}`)), [], 'died only on the side that holds more');
}

test('the live Mars pair of 10 November 2026 loses different people under its two leaders', (t) => {
  const a = run(950, ARIA, byTurn(LIVE_ARIA), HEADS);
  const b = run(950, DIETRICH, byTurn(LIVE_DIETRICH), HEADS);
  const seen = `${ARIA} lost ${a.dead.size} (${names(a, a.dead).join(', ')}); ${DIETRICH} lost ${b.dead.size} (${names(b, b.dead).join(', ')})`;
  t.diagnostic(seen);
  assert.ok(differ(a, b), `the same people died under both leaders: ${seen}`);
  // Dietrich Voss's colony held at least Aria Chen's modules and supply
  // level at every turn end, so each founder's chances were no higher
  // under him, on the same dice.
  assert.deepEqual(onlyUnderMore(b, a), [], 'died only under the leader whose colony held more');
});

test('the live trajectories of 10 November 2026 lose different people on most seeds', (t) => {
  assertFloors(t, [{ ...sweep('the live trajectories, no promotions', byTurn(LIVE_ARIA), byTurn(LIVE_DIETRICH)), floor: 48 }]);
});

test('with the same habitat on both sides, the other supplies the leaders moved still change who lives', (t) => {
  const sameModules = byTurn({ ...LIVE_DIETRICH, infrastructureModules: LIVE_ARIA.infrastructureModules });
  assertFloors(t, [{ ...sweep('the live trajectories with equal modules', byTurn(LIVE_ARIA), sameModules), floor: 30 }]);
});

test('a supply held a fifth under its landing amount against a fifth over changes who lives', (t) => {
  // Landing day holds 120 of life support, 800 L of water a day, 400 kW
  // and 3000 m3.
  const pairs: Array<[key: string, under: number, over: number]> = [
    ['lifeSupportCapacity', 96, 144],
    ['waterLitersPerDay', 640, 960],
    ['powerKw', 320, 480],
    ['pressurizedVolumeM3', 2400, 3600],
  ];
  const allFour = (side: 1 | 2) => byTurn(Object.fromEntries(pairs.map(p => [p[0], TURNS.map(() => p[side])])));
  assertFloors(t, [
    ...pairs.map(([key, under, over]) => ({ ...sweep(`${key} ${under} against ${over}`, flat(key, under), flat(key, over)), floor: 15 })),
    { ...sweep('all four a fifth under against a fifth over', allFour(1), allFour(2)), floor: 45 },
  ]);
});

test('habitat modules built late reach who lives in the years left', (t) => {
  // The live pair's modules alone: equal for three turns, then Dietrich
  // Voss's rose.
  const late = sweep(
    'the live modules alone',
    byTurn({ infrastructureModules: LIVE_ARIA.infrastructureModules }),
    byTurn({ infrastructureModules: LIVE_DIETRICH.infrastructureModules }),
  );
  assertFloors(t, [{ ...late, floor: 38 }]);
});

test('food, morale and science feed no death rate at the states the live pairs reached, and two equal colonies lose the same people', (t) => {
  // Food reaches starvation only under a month, and morale reaches despair
  // only through psych under 0.2 (#226); science reads into nothing.
  const sweeps = [
    sweep('food 19.19 against 103.576 months', flat('foodMonthsReserve', 19.19), flat('foodMonthsReserve', 103.576)),
    sweep('morale 0.873047 against 1', flat('morale', 0.873047), flat('morale', 1)),
    sweep('science 0 against 51.52', flat('scienceOutput', 0), flat('scienceOutput', 51.52)),
    sweep('5 against 5 modules', flat('infrastructureModules', 5), flat('infrastructureModules', 5)),
  ];
  t.diagnostic(report(sweeps));
  assert.deepEqual(sweeps.filter(s => s.differ !== 0).map(s => s.label), [], report(sweeps));
});

test('Mars Genesis keeps the five supplies it marks as they stood on landing day, after the caller\'s starting resources', () => {
  const plain = new SimulationKernel(950, ARIA, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  assert.deepEqual(plain.getState().metadata.landingSupplies, LANDING);
  // A supply that starts at nothing has no landing amount to read against.
  const given = new SimulationKernel(950, ARIA, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
    startingResources: { powerKw: 520, infrastructureModules: 0 },
  });
  const { infrastructureModules: _none, ...rest } = LANDING;
  assert.deepEqual(given.getState().metadata.landingSupplies, { ...rest, powerKw: 520 });
});

// What must not move.

const disk = loadDiskCustomScenarios(resolve(here, '../../scenarios'));
const station = disk.get('deep-ocean-station')!.scenario as ScenarioPackage;
const atlasLab = disk.get('atlas-lab')!.scenario as ScenarioPackage;
const twin = JSON.parse(readFileSync(resolve(here, '../../scenarios/t2d-glp1-protocol.json'), 'utf-8')) as ScenarioPackage;

test('Lunar Outpost, the deep-ocean station, Atlas Lab, the Digital Twin and a kernel with no scenario keep no landing amounts', () => {
  const kept = (sc: ScenarioPackage | undefined, population: number) => new SimulationKernel(950, ARIA, sc ? scenarioKeyPersonnel(sc) : [], {
    startTime: sc?.setup?.defaultStartTime ?? 1, initialPopulation: population, ...(sc ? { scenario: sc } : {}),
  }).getState().metadata.landingSupplies;
  assert.equal(kept(lunarScenario, 30), undefined, 'Lunar Outpost');
  assert.equal(kept(station, 30), undefined, 'the deep-ocean station');
  assert.equal(kept(atlasLab, 100), undefined, 'Atlas Lab');
  assert.equal(kept(twin, 1), undefined, 'the Digital Twin');
  assert.equal(kept(undefined, 30), undefined, 'a kernel with no scenario');
});

/** Each turn's morale, living, deaths and births. */
type TurnRow = [morale: number, alive: number, deaths: number, births: number];

/** A scenario's kernel with no decisions, on its preset roster: each turn's row. */
function rows(sc: ScenarioPackage, seed: number, population: number, turns: number, unitsPerTurn: number, watch?: (ctx: ProgressionHookContext) => void): TurnRow[] {
  const start = sc.setup.defaultStartTime ?? 1;
  const kernel = new SimulationKernel(seed, ARIA, scenarioKeyPersonnel(sc), { startTime: start, initialPopulation: population, scenario: sc });
  const progression = sc.hooks?.progressionHook;
  const each = watch
    ? (ctx: ProgressionHookContext) => {
      watch(ctx);
      progression?.(ctx);
    }
    : progression;
  const out: TurnRow[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const state = kernel.advanceTurn(turn, start + (turn - 1) * unitsPerTurn, each);
    const mine = state.eventLog.filter(e => e.turn === turn);
    out.push([
      state.metrics.morale,
      state.agents.filter(a => a.health.alive).length,
      mine.filter(e => e.type === 'death').length,
      mine.filter(e => e.type === 'birth').length,
    ]);
  }
  return out;
}

const ROW_SEEDS = [950, 1, 2, 3];
/** The rows these runs gave before any death rate read a supply. */
const PINNED = JSON.parse(readFileSync(resolve(here, '../fixtures/supplies-unmarked-and-untouched.json'), 'utf-8')).runs as Record<string, TurnRow[]>;
const pinned = (keys: string[]) => Object.fromEntries(keys.map(k => [k, PINNED[k]]));

test('a Mars colony nobody leads holds its landing supplies in every year of six turns and loses the people it lost before', (t) => {
  const seen: Record<string, TurnRow[]> = {};
  const moved: string[] = [];
  for (const seed of ROW_SEEDS) {
    seen[`mars-genesis, seed ${seed}, 30 people, 6 eight-year turns`] = rows(marsScenario, seed, 30, 6, 8, ctx => {
      for (const [key, landing] of Object.entries(LANDING)) {
        if (ctx.metrics?.[key] !== landing) moved.push(`seed ${seed}, ${ctx.time}: ${key} ${String(ctx.metrics?.[key])}`);
      }
    });
  }
  t.diagnostic(`mars rows: ${JSON.stringify(seen)}`);
  assert.deepEqual(moved, [], 'a supply moved with nobody leading');
  assert.deepEqual(seen, pinned(Object.keys(seen)));
});

test('Lunar Outpost and the deep-ocean station run as they did before supplies reached the rates', (t) => {
  const seen: Record<string, TurnRow[]> = {};
  for (const seed of ROW_SEEDS) {
    seen[`lunar-outpost, seed ${seed}, 30 people, 8 one-year turns`] = rows(lunarScenario, seed, 30, 8, 1);
    seen[`deep-ocean-station, seed ${seed}, 30 people, 8 one-year turns`] = rows(station, seed, 30, 8, 1);
  }
  t.diagnostic(`unmarked rows: ${JSON.stringify(seen)}`);
  assert.deepEqual(seen, pinned(Object.keys(seen)));
});
