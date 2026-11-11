/**
 * Two Mars leaders' chances reach the record of who dies, and when (#243).
 *
 * The live Mars Genesis pair of 10 November 2026 (14:06 UTC, seed 950, 30
 * people, six turns of eight years) lost the same 16 people under both
 * leaders, each in the same year of the same cause, after #225, #240 and
 * #242. With a die of its own for each person, cause and year, two colonies
 * on one seed record a different death only where one of those yearly dice
 * falls between the two colonies' chances for that person in that year. The
 * chances of that pair were apart (2.58 expected dice over the years both
 * sides share) and no die fell between them.
 *
 * Mars Genesis declares one die for a life (`setup.mortalityDice: 'life'`):
 * one die for each person and cause for as long as they live, and the person
 * dies in the year their chance of having survived that cause falls to it.
 * Every year's chance then moves the year a person's death comes due, so two
 * colonies that give a person different chances record that person's death
 * in different years, and a person whose die lies between the two colonies'
 * chances of dying by the last turn dies in one and lives in the other.
 *
 * These tests run each recorded side the way a hosted run does (the
 * scenario's preset roster, `new SimulationKernel` with the scenario,
 * `advanceTurn` with its progression hook), hold its metrics after every
 * turn at the `turn_done` values the live run reported (`applySystemDeltas`,
 * where outcomes and adopted effects land), and compare the deaths in the
 * final event log as `agentId|time|cause`. No model call. The six recorded
 * sides are the three live pairs of Aria Chen against Dietrich Voss: 8
 * November 2026, 10 November 2026 at 02:31 UTC and 10 November 2026 at
 * 14:06 UTC.
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
import type { ScenarioPackage } from '../../src/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const hook = marsScenario.hooks.progressionHook;
/** Mars turns: the landing in 2035, then a turn every eight years. */
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
/** The demo's seed, then sixty more. */
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';

/** A department head the commander names before the first turn: id, department, role. */
type Promotion = [id: string, department: string, role: string];

interface Side {
  name: string;
  leader: string;
  /** Each metric's value after each of the six turns. */
  held: Record<string, number[]>;
  heads: Promotion[];
}

const MEDICAL = 'Chief Medical Officer';
const ENGINEER: Promotion = ['col-bruno-morales', 'engineering', 'Chief Engineer'];
const FARMER: Promotion = ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'];

// The `turn_done` metrics of each recorded side, as the live runs reported
// them.

const A1: Side = {
  name: 'Aria Chen, 8 November 2026',
  leader: ARIA,
  held: {
    infrastructureModules: [4, 2.21, 3.21, 6.42, 8.42, 9.42],
    foodMonthsReserve: [19.22, 24.819999999999993, 30.483999999999995, 34.188, 46.786000000000016, 62.993999999999986],
    morale: [1, 1, 1, 1, 1, 1],
    lifeSupportCapacity: [125, 125, 130, 130, 130, 135],
    powerKw: [458.65999999999997, 403.9, 403.9, 470.05999999999995, 528.43, 586.42],
    pressurizedVolumeM3: [3200, 3021.47, 3021.47, 3242, 3292, 3492],
    waterLitersPerDay: [900, 900, 1008.89, 1008.89, 1008.89, 1008.89],
    scienceOutput: [0, 8, 16, 25, 33, 44.529999999999994],
  },
  heads: [['col-carlos-fernandez', 'medical', MEDICAL], ENGINEER, FARMER],
};

const D1: Side = {
  name: 'Dietrich Voss, 8 November 2026',
  leader: DIETRICH,
  held: {
    infrastructureModules: [5, 7, 8, 11.22, 11.22, 11.22],
    foodMonthsReserve: [19.22, 23.9, 37.83000000000001, 53.03, 80.648, 103.576],
    morale: [1, 1, 1, 0.9730467210000001, 1, 1],
    lifeSupportCapacity: [125, 130.65, 130.65, 132.65, 132.65, 132.65],
    powerKw: [448.48, 429.08000000000004, 476.31000000000006, 536.32, 527.12, 579.91],
    pressurizedVolumeM3: [3200, 3320, 3320, 3542.36, 3542.36, 3542.36],
    waterLitersPerDay: [900, 809.49, 809.49, 809.49, 921.77, 921.77],
    scienceOutput: [1, 10, 19, 28, 38, 50.17],
  },
  heads: [['col-sven-kim', 'medical', MEDICAL], ENGINEER, FARMER],
};

const A2: Side = {
  name: 'Aria Chen, 10 November 2026, 02:31 UTC',
  leader: ARIA,
  held: {
    infrastructureModules: [4, 4, 4, 4, 4, 5],
    foodMonthsReserve: [19.22, 22.939999999999994, 29.33999999999999, 39.58, 47.590000000000025, 53.19000000000005],
    morale: [0.975, 0.89228504075, 1, 1, 1, 1],
    lifeSupportCapacity: [125, 120, 122.71, 118.71, 116.71, 121.71],
    powerKw: [498.65999999999997, 496.26, 478.06, 431.86, 466.94, 490.63],
    pressurizedVolumeM3: [3200, 3200, 3200, 3200, 3200, 3200],
    waterLitersPerDay: [900, 715.4, 625.4, 641.3399999999999, 571.3399999999999, 671.3399999999999],
    scienceOutput: [0, 8, 18, 29, 40, 51.52],
  },
  heads: [['col-sven-kim', 'medical', MEDICAL], ENGINEER, FARMER],
};

const D2: Side = {
  name: 'Dietrich Voss, 10 November 2026, 02:31 UTC',
  leader: DIETRICH,
  held: {
    infrastructureModules: [4, 4, 4, 7.38, 9.79, 10.79],
    foodMonthsReserve: [19.19, 24.789999999999996, 35.48999999999999, 41.09000000000001, 54.802, 74.29799999999999],
    morale: [1, 0.8730467210000001, 1, 1, 1, 1],
    lifeSupportCapacity: [125, 125.67, 125.67, 139.15, 144.15, 149.15],
    powerKw: [518.07, 500.6700000000001, 438.2700000000001, 457.9400000000001, 467.8000000000001, 510.67000000000013],
    pressurizedVolumeM3: [3200, 3320, 3320, 3557.57, 3798.44, 3998.44],
    waterLitersPerDay: [900, 900, 960.06, 960.06, 960.06, 960.06],
    scienceOutput: [0, 8, 17, 25, 32, 46.29],
  },
  heads: [['col-sven-kim', 'medical', MEDICAL], ENGINEER, FARMER],
};

const A3: Side = {
  name: 'Aria Chen, 10 November 2026, 14:06 UTC',
  leader: ARIA,
  held: {
    infrastructureModules: [4, 5, 6, 8.2, 12.7, 14.7],
    foodMonthsReserve: [19.22, 22.219999999999995, 30.219999999999995, 40.619999999999976, 56.29999999999998, 82.78],
    morale: [0.9871265096412196, 0.8957020747141666, 0.9862137551503258, 0.9914890610499063, 0.9983437190327416, 0.9857796769287752],
    lifeSupportCapacity: [125, 130, 140.51, 145.51, 150.51, 155.51],
    powerKw: [443.65999999999997, 432.05999999999995, 432.05999999999995, 424.65999999999997, 484.2, 536.3],
    pressurizedVolumeM3: [3000, 3000, 3000, 3000, 3250.46, 3450.46],
    waterLitersPerDay: [800, 759.95, 729.95, 749.95, 729.95, 729.95],
    scienceOutput: [0, 8, 16, 24, 32, 46.68],
  },
  heads: [['col-carlos-fernandez', 'medical', MEDICAL], ENGINEER, FARMER],
};

const D3: Side = {
  name: 'Dietrich Voss, 10 November 2026, 14:06 UTC',
  leader: DIETRICH,
  held: {
    infrastructureModules: [4, 6, 10.57, 14.57, 14.57, 16.57],
    foodMonthsReserve: [19.22, 24.819999999999993, 40.03999999999999, 62.50799999999999, 98.31599999999996, 129.28399999999993],
    morale: [0.971349520313981, 0.8845109685352679, 0.9983970504713229, 0.9985748544402803, 0.980837691068314, 0.9822303753091499],
    lifeSupportCapacity: [125, 123.71, 131.70999999999998, 145.70999999999998, 145.70999999999998, 150.70999999999998],
    powerKw: [498.48, 470.08000000000004, 388.4800000000001, 382.5100000000001, 362.3100000000001, 408.3800000000001],
    pressurizedVolumeM3: [3200, 3200, 3200, 3380, 3380, 3380],
    waterLitersPerDay: [900, 900, 1220.52, 1320.52, 1511.47, 1511.47],
    scienceOutput: [2, 10, 20, 30, 40, 54.56],
  },
  heads: [['col-chen-osei', 'medical', MEDICAL], ENGINEER, FARMER],
};

/** The three live pairs, Aria Chen's side first. */
const LIVE_PAIRS: Array<[Side, Side]> = [[A1, D1], [A2, D2], [A3, D3]];
/** The six other pairings of an Aria Chen side with a Dietrich Voss side. */
const CROSS_PAIRS: Array<[Side, Side]> = [[A1, D2], [A1, D3], [A2, D1], [A3, D1], [A2, D3], [A3, D2]];

/** The five supplies Mars Genesis marks as sustaining its people. */
const SUPPLIES = ['lifeSupportCapacity', 'waterLitersPerDay', 'powerKw', 'pressurizedVolumeM3', 'infrastructureModules'];

/** `side` with each of the five supplies `factor` times its value at every turn end, and everything else as it was. */
function scaled(side: Side, factor: number): Side {
  return {
    ...side,
    name: `${side.name}, every supply times ${factor}`,
    held: Object.fromEntries(Object.entries(side.held).map(([k, values]) => [k, SUPPLIES.includes(k) ? values.map(x => x * factor) : values])),
  };
}

interface Death { id: string; name: string; time: number; cause: string }

interface Run {
  /** Everyone not alive at the end, children included. */
  dead: Set<string>;
  /** The people the run began with. */
  founders: Set<string>;
  /** The `death` entries of the final event log, in order. */
  deaths: Death[];
  /** The same as `agentId|time|cause`. */
  records: Set<string>;
}

const runs = new Map<string, Run>();

/** Six Mars turns on the preset roster with `side`'s metrics set after each turn, its heads named first where `heads` is set. */
function run(seed: number, side: Side, heads = false): Run {
  const key = JSON.stringify([seed, side.leader, side.held, heads ? side.heads : []]);
  const cached = runs.get(key);
  if (cached) return cached;
  const kernel = new SimulationKernel(seed, side.leader, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const founders = new Set(kernel.getState().agents.map(a => a.core.id));
  if (heads) for (const [id, department, role] of side.heads) kernel.promoteAgent(id, department, role, side.leader);
  TURNS.forEach(([turn, time], i) => {
    const metrics = kernel.advanceTurn(turn, time, hook).metrics as Record<string, number>;
    kernel.applySystemDeltas(Object.fromEntries(
      Object.entries(side.held).map(([k, values]) => [k, values[i] - metrics[k]]),
    ));
  });
  const state = kernel.getState();
  const names = new Map(state.agents.map(a => [a.core.id, a.core.name]));
  const deaths = state.eventLog
    .filter(e => e.type === 'death' && e.agentId)
    .map(e => ({ id: e.agentId!, name: names.get(e.agentId!) ?? e.agentId!, time: e.time, cause: String(e.cause) }));
  const result: Run = {
    dead: new Set(state.agents.filter(a => !a.health.alive).map(a => a.core.id)),
    founders,
    deaths,
    records: new Set(deaths.map(d => `${d.id}|${d.time}|${d.cause}`)),
  };
  runs.set(key, result);
  return result;
}

/** Someone dies under one side only, or in a different year, or of a different cause. */
function recordsDiffer(a: Run, b: Run): boolean {
  return a.records.size !== b.records.size || [...a.records].some(r => !b.records.has(r));
}

/** Someone dies under one side only. */
function deadDiffer(a: Set<string>, b: Set<string>): boolean {
  return a.size !== b.size || [...a].some(id => !b.has(id));
}

/** The founders who die under `x` and not under `y`, or under both and earlier under `x`. */
function earlierOrOnly(x: Run, y: Run): string[] {
  const underY = new Map(y.deaths.map(d => [d.id, d.time]));
  return x.deaths
    .filter(d => x.founders.has(d.id) && (!underY.has(d.id) || d.time < underY.get(d.id)!))
    .map(d => `${d.name} ${d.time}`);
}

function describe(r: Run): string {
  return `${r.deaths.length}: ${r.deaths.map(d => `${d.name} ${d.time} (${d.cause})`).join(', ')}`;
}

interface Sweep {
  label: string;
  /** Seeds of 61 whose death records differ. */
  records: number;
  /** Seeds of 61 whose dead sets differ. */
  dead: number;
  /** Seeds where a founder died earlier, or only, on the side that held more, with who. */
  earlierUnderMore: string[];
}

/** A pairing over the 61 seeds, no promotions; `more` is the side that held at least the other's modules and supply level at every turn end. */
function sweep(label: string, less: Side, more: Side): Sweep {
  let records = 0;
  let dead = 0;
  const earlierUnderMore: string[] = [];
  for (const seed of SEEDS) {
    const a = run(seed, less);
    const b = run(seed, more);
    if (recordsDiffer(a, b)) records++;
    if (deadDiffer(a.dead, b.dead)) dead++;
    const early = earlierOrOnly(b, a);
    if (early.length > 0) earlierUnderMore.push(`seed ${seed}: ${early.join(', ')}`);
  }
  return { label, records, dead, earlierUnderMore };
}

function report(sweeps: Sweep[]): string {
  return sweeps.map(s => `${s.label}: death records differ on ${s.records} of ${SEEDS.length}, dead sets on ${s.dead}`).join('; ');
}

const pairLabel = ([a, b]: [Side, Side]) => `${a.name} against ${b.name}`;

test('the live Mars pair of 10 November 2026 (14:06 UTC) shows its two leaders in who dies when', (t) => {
  const a = run(950, A3, true);
  const b = run(950, D3, true);
  const seen = `${ARIA} lost ${describe(a)}; ${DIETRICH} lost ${describe(b)}`;
  t.diagnostic(seen);
  assert.ok(recordsDiffer(a, b), `the same deaths in the same years of the same causes under both leaders: ${seen}`);
  // Dietrich Voss's colony held at least Aria Chen's modules and supply
  // level at every turn end, so no founder's chances were higher under him.
  assert.deepEqual(earlierOrOnly(b, a), [], 'died earlier, or only, under the leader whose colony held more');
});

test('the recorded pairs\' death records differ on every seed', (t) => {
  const live = LIVE_PAIRS.map(p => sweep(pairLabel(p), p[0], p[1]));
  const cross = CROSS_PAIRS.map(p => sweep(pairLabel(p), p[0], p[1]));
  t.diagnostic(`live pairs: ${report(live)}`);
  t.diagnostic(`other pairings: ${report(cross)}`);
  assert.deepEqual([...live, ...cross].filter(s => s.records < 60).map(s => `${s.label}: ${s.records}`), [], 'death records differ on fewer than 60 of 61 seeds');
  // In each live pair Dietrich Voss's colony held at least Aria Chen's
  // modules and supply level at every turn end.
  assert.deepEqual(live.flatMap(s => s.earlierUnderMore.map(n => `${s.label}, ${n}`)), [], 'died earlier, or only, under the leader whose colony held more');
});

test('two colonies that build alike show in the death records at a fiftieth and a hundredth apart', (t) => {
  const sweeps = [A3, D3].flatMap(side => [
    { ...sweep(`${side.name} against every supply times 1.02`, side, scaled(side, 1.02)), floor: 55 },
    { ...sweep(`${side.name} against every supply times 1.01`, side, scaled(side, 1.01)), floor: 45 },
  ]);
  t.diagnostic(report(sweeps));
  assert.deepEqual(sweeps.filter(s => s.records < s.floor).map(s => `${s.label}: ${s.records} (floor ${s.floor})`), [], report(sweeps));
  assert.deepEqual(sweeps.flatMap(s => s.earlierUnderMore.map(n => `${s.label}, ${n}`)), [], 'died earlier, or only, in the colony that holds more');
});

/** Mars Genesis with a die a year declared outright. */
const yearly = { ...marsScenario, setup: { ...marsScenario.setup, mortalityDice: 'year' } } as ScenarioPackage;

/** Six Mars turns nobody leads: who died, and of which causes. */
function idle(seed: number, sc: ScenarioPackage): { dead: Set<string>; causes: string[] } {
  const kernel = new SimulationKernel(seed, ARIA, scenarioKeyPersonnel(sc), { startTime: 2035, initialPopulation: 30, scenario: sc });
  for (const [turn, time] of TURNS) kernel.advanceTurn(turn, time, sc.hooks.progressionHook);
  const state = kernel.getState();
  return {
    dead: new Set(state.agents.filter(a => !a.health.alive).map(a => a.core.id)),
    causes: state.eventLog.filter(e => e.type === 'death').map(e => String(e.cause)),
  };
}

test('one die for a life keeps a Mars run\'s chances of death', (t) => {
  const MANY = Array.from({ length: 600 }, (_, i) => i + 1);
  const tally = { life: { deaths: 0, age: 0, radiation: 0, accident: 0 }, year: { deaths: 0, age: 0, radiation: 0, accident: 0 } };
  let differ = 0;
  for (const seed of MANY) {
    const life = idle(seed, marsScenario);
    const year = idle(seed, yearly);
    if (deadDiffer(life.dead, year.dead)) differ++;
    for (const [side, r] of [['life', life], ['year', year]] as const) {
      tally[side].deaths += r.dead.size;
      tally[side].age += r.causes.filter(c => c === 'natural causes' || c === 'age-related complications').length;
      tally[side].radiation += r.causes.filter(c => c === 'radiation cancer').length;
      tally[side].accident += r.causes.filter(c => c.startsWith('accident')).length;
    }
  }
  const perRun = (n: number) => Math.round((n / MANY.length) * 100) / 100;
  const line = (s: keyof typeof tally) => `deaths a run ${perRun(tally[s].deaths)} (age ${perRun(tally[s].age)}, radiation ${perRun(tally[s].radiation)}, accident ${perRun(tally[s].accident)})`;
  const seen = `a die for life: ${line('life')}; a die a year: ${line('year')}; who dies differs on ${differ} of ${MANY.length} seeds`;
  t.diagnostic(seen);
  assert.ok(differ > 0, `the declaration changed nobody's fate: ${seen}`);
  assert.ok(Math.abs(perRun(tally.life.deaths) - perRun(tally.year.deaths)) <= 0.5, seen);
});

const disk = loadDiskCustomScenarios(resolve(here, '../../scenarios'));
const station = disk.get('deep-ocean-station')!.scenario as ScenarioPackage;
const atlasLab = disk.get('atlas-lab')!.scenario as ScenarioPackage;
const twin = JSON.parse(readFileSync(resolve(here, '../../scenarios/t2d-glp1-protocol.json'), 'utf-8')) as ScenarioPackage;

/** What a kernel records of how its death dice are kept. */
const diceOf = (kernel: SimulationKernel) => (kernel.getState().metadata as { mortalityDice?: string }).mortalityDice;

test('Mars Genesis declares one die for a life, and no other scenario does', () => {
  const kept = (sc: ScenarioPackage | undefined, population: number) => diceOf(new SimulationKernel(950, ARIA, sc ? scenarioKeyPersonnel(sc) : [], {
    startTime: sc?.setup?.defaultStartTime ?? 1, initialPopulation: population, ...(sc ? { scenario: sc } : {}),
  }));
  assert.equal(kept(marsScenario, 30), 'life', 'Mars Genesis');
  assert.equal(kept(yearly, 30), undefined, 'Mars Genesis with a die a year declared');
  assert.equal(kept(lunarScenario, 30), undefined, 'Lunar Outpost');
  assert.equal(kept(station, 30), undefined, 'the deep-ocean station');
  assert.equal(kept(atlasLab, 100), undefined, 'Atlas Lab');
  assert.equal(kept(twin, 1), undefined, 'the Digital Twin');
  assert.equal(kept(undefined, 30), undefined, 'a kernel with no scenario');
});

/** The death records of six Mars turns nobody leads, the last four from a kernel restored from the snapshot taken after turn 2 where `restore` is set. */
function restored(sc: ScenarioPackage, restore: boolean): string[] {
  let kernel = new SimulationKernel(950, ARIA, scenarioKeyPersonnel(sc), { startTime: 2035, initialPopulation: 30, scenario: sc });
  for (const [turn, time] of TURNS) {
    if (turn === 3 && restore) {
      const snap = JSON.parse(JSON.stringify(kernel.toSnapshot(marsScenario.id)));
      kernel = SimulationKernel.fromSnapshot(snap, marsScenario.id, marsScenario);
    }
    kernel.advanceTurn(turn, time, hook);
  }
  return kernel.getState().eventLog.filter(e => e.type === 'death').map(e => `${e.agentId}|${e.time}|${e.cause}`);
}

test('a saved run keeps the death dice it was saved with', () => {
  // A state saved with a die a year holds no declaration, so a kernel
  // restored from it and handed Mars Genesis keeps a die a year.
  assert.deepEqual(restored(yearly, true), restored(yearly, false), 'a run saved with a die a year');
  // A Mars Genesis state carries its declaration and each person's chances
  // of having survived so far, so its restored kernel runs on as it would
  // have.
  assert.deepEqual(restored(marsScenario, true), restored(marsScenario, false), 'a Mars Genesis run');
});

test('the recorded live pairs still lose different people on most seeds, and two equal colonies record the same deaths', (t) => {
  const live = LIVE_PAIRS.map(p => sweep(pairLabel(p), p[0], p[1]));
  t.diagnostic(report(live));
  assert.deepEqual(live.filter(s => s.dead < 48).map(s => `${s.label}: ${s.dead}`), [], 'dead sets differ on fewer than 48 of 61 seeds');
  const equal = sweep('the 14:06 Aria Chen trajectory on both sides', A3, { ...A3, leader: DIETRICH });
  t.diagnostic(report([equal]));
  assert.equal(equal.records, 0, 'two equal colonies recorded different deaths');
});
