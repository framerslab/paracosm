/**
 * Every habitat module a Mars leader builds reaches who lives (#221).
 *
 * The live Mars Genesis pair of 8 November 2026 (seed 950, 30 people, six
 * turns of eight years) lost the same 17 people under both leaders, though
 * their colonies held different habitats from the first turn. Each person
 * rolls the same dice under both leaders (#184). A habitat module reaches
 * two rates: radiation, through the dose it shields, and the age and
 * accident rates, through the colony's supply level, of which the modules
 * are one of five supplies (#234). These tests run a pair the way a hosted run
 * does (the scenario's preset roster, `new SimulationKernel` with the
 * scenario, `advanceTurn` with its progression hook), hold each side's
 * metrics after every turn where the live run's outcomes and adopted
 * effects left them (`applySystemDeltas`, the call both land in), and
 * compare who died. A morale gain eases above 0.9, so where the live
 * value is 1 the side lands a little under it; nothing these tests read
 * depends on morale above 0.5. No model call. The Moon keeps its own
 * shielding curve, which the last test pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';

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

/** A colony that holds `modules` habitat modules from the first turn on. */
function modulesHeld(modules: number): Held {
  return byTurn({ infrastructureModules: TURNS.map(() => modules) });
}

/** The live pair's `turn_done` values, Aria Chen's side. */
const LIVE_ARIA = byTurn({
  infrastructureModules: [4, 2.21, 3.21, 6.42, 8.42, 9.42],
  foodMonthsReserve: [19.22, 24.82, 30.48, 34.19, 46.79, 62.99],
  morale: [1, 1, 1, 1, 1, 1],
  lifeSupportCapacity: [125, 125, 130, 130, 130, 135],
  powerKw: [458.66, 403.9, 403.9, 470.06, 528.43, 586.42],
  pressurizedVolumeM3: [3200, 3021.47, 3021.47, 3242, 3292, 3492],
});

/** The live pair's `turn_done` values, Dietrich Voss's side. */
const LIVE_DIETRICH = byTurn({
  infrastructureModules: [5, 7, 8, 11.22, 11.22, 11.22],
  foodMonthsReserve: [19.22, 23.9, 37.83, 53.03, 80.65, 103.58],
  morale: [1, 1, 1, 0.973, 1, 1],
  lifeSupportCapacity: [125, 130.65, 130.65, 132.65, 132.65, 132.65],
  powerKw: [448.48, 429.08, 476.31, 536.32, 527.12, 579.91],
  pressurizedVolumeM3: [3200, 3320, 3320, 3542.36, 3542.36, 3542.36],
});

/** The department heads each live leader named. */
const ARIA_HEADS: Promotion[] = [
  ['col-carlos-fernandez', 'medical', 'Chief Medical Officer'],
  ['col-bruno-morales', 'engineering', 'Chief Engineer'],
  ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'],
];
const DIETRICH_HEADS: Promotion[] = [
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

/** The founders who died under `better` (the better-shielded side) and lived under `other`. */
function onlyUnderBetter(better: Run, other: Run): string[] {
  return names(better, [...better.dead].filter(id => better.founders.has(id) && !other.dead.has(id)));
}

interface Sweep {
  label: string;
  /** Seeds of 61 whose two dead sets differ. */
  differ: number;
  /** Seeds where a founder died only on the better-shielded side, with who. */
  notNested: string[];
}

/** A pair over the 61 seeds: Aria Chen holds `aria`, Dietrich Voss holds `dietrich`, which shields no less. */
function sweep(label: string, aria: Held, dietrich: Held): Sweep {
  let count = 0;
  const notNested: string[] = [];
  for (const seed of SEEDS) {
    const a = run(seed, ARIA, aria);
    const b = run(seed, DIETRICH, dietrich);
    if (differ(a, b)) count++;
    const extra = onlyUnderBetter(b, a);
    if (extra.length > 0) notNested.push(`seed ${seed}: ${extra.join(', ')}`);
  }
  return { label, differ: count, notNested };
}

function report(sweeps: Sweep[]): string {
  return sweeps.map(s => `${s.label}: ${s.differ} of ${SEEDS.length} differ`).join('; ');
}

test('the live Mars pair of 8 November 2026 loses different people under its two leaders', (t) => {
  const a = run(950, ARIA, LIVE_ARIA, ARIA_HEADS);
  const b = run(950, DIETRICH, LIVE_DIETRICH, DIETRICH_HEADS);
  const seen = `${ARIA} lost ${a.dead.size} (${names(a, a.dead).join(', ')}); ${DIETRICH} lost ${b.dead.size} (${names(b, b.dead).join(', ')})`;
  t.diagnostic(seen);
  assert.ok(differ(a, b), `the same people died under both leaders: ${seen}`);
  // Aria Chen's colony held no more modules than Dietrich Voss's in any
  // turn, so each founder's radiation hazard was no lower under her, on
  // the same dice. The accident hazard is not nested for the two people
  // the leaders promoted differently, since it follows the department:
  // Carlos Fernandez heads medical under Aria Chen (weight 1.2) and stays
  // in engineering under Dietrich Voss (1.5), and Sven Kim is the reverse.
  // Carlos Fernandez could die in an accident under Dietrich Voss alone;
  // at this seed he does not.
  assert.deepEqual(onlyUnderBetter(b, a), [], 'died only under the better-shielded leader');
});

test('every habitat module a Mars leader builds from the fifth to the twelfth changes who lives', (t) => {
  const sweeps: Sweep[] = [];
  for (let m = 5; m <= 11; m++) sweeps.push(sweep(`${m} against ${m + 1} modules`, modulesHeld(m), modulesHeld(m + 1)));
  t.diagnostic(report(sweeps));
  assert.deepEqual(sweeps.filter(s => s.differ < 5).map(s => s.label), [], `fewer than 5 of 61 seeds differ: ${report(sweeps)}`);
  assert.deepEqual(sweeps.flatMap(s => s.notNested), [], 'died only on the better-shielded side');
});

test('five habitat modules against eleven change who lives on most seeds', (t) => {
  const s = sweep('5 against 11 modules', modulesHeld(5), modulesHeld(11));
  t.diagnostic(report([s]));
  assert.ok(s.differ >= 45, report([s]));
  assert.deepEqual(s.notNested, [], 'died only on the better-shielded side');
});

test('two leaders who hold the same habitat lose the same people', () => {
  const s = sweep('5 against 5 modules', modulesHeld(5), modulesHeld(5));
  assert.equal(s.differ, 0, report([s]));
});

test('a module below 4.5 and the live trajectories still change who lives', (t) => {
  // Guards that hold before and after the shielding curve changed, so
  // the reach a habitat has below 4.5 modules stays.
  const sweeps = [
    { ...sweep('3 against 4 modules', modulesHeld(3), modulesHeld(4)), floor: 35 },
    { ...sweep('4 against 5 modules', modulesHeld(4), modulesHeld(5)), floor: 30 },
    { ...sweep('the live trajectories, no promotions', LIVE_ARIA, LIVE_DIETRICH), floor: 52 },
  ];
  t.diagnostic(report(sweeps));
  assert.deepEqual(sweeps.filter(s => s.differ < s.floor).map(s => s.label), [], report(sweeps));
  assert.deepEqual(sweeps.flatMap(s => s.notNested), [], 'died only on the better-shielded side');
});

test('the Moon keeps its own shielding: two modules let through 0.6 of the regolith exposure', () => {
  // Eight one-year Lunar turns from 2030 are seven years of exposure, so a
  // crew member there the whole run holds 45 x 0.6 x 7 = 189 on every
  // seed, and nobody holds more.
  const lunarHook = lunarScenario.hooks.progressionHook;
  for (const seed of SEEDS) {
    const kernel = new SimulationKernel(seed, ARIA, [], { startTime: 2030, initialPopulation: 30, scenario: lunarScenario });
    const founders = new Set(kernel.getState().agents.map(a => a.core.id));
    for (let turn = 1; turn <= 8; turn++) kernel.advanceTurn(turn, 2029 + turn, lunarHook);
    const state = kernel.getState();
    assert.equal(state.metrics.infrastructureModules, 2, `seed ${seed}'s modules`);
    for (const a of state.agents) {
      const exposure = a.health.cumulativeRadiationMsv ?? 0;
      assert.ok(exposure <= 189 + 1e-9, `seed ${seed}: ${a.core.name} holds ${exposure}`);
      if (founders.has(a.core.id) && a.health.alive) {
        assert.ok(Math.abs(exposure - 189) < 1e-9, `seed ${seed}: ${a.core.name} holds ${exposure}`);
      }
    }
  }
});
