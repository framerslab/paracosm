/**
 * A long turn rolls each year it spans (#194) and settles the colony's
 * morale each year it spans.
 *
 * Mars Genesis turns are eight years apart. A yearly rate has to mean the
 * same thing whatever the turn's length, so one eight-year turn has to give
 * what eight one-year turns give: the deaths read the age and the dose as
 * they rise through the turn, a couple can have more than one child in it,
 * and morale settles toward 0.6 and takes the pressures of a low food
 * store, a roster over its life support and a low average psych once a
 * year, as it does between one-year turns. These tests run the kernel the
 * orchestrator runs (`new SimulationKernel` with the scenario, then
 * `advanceTurn` with its progression hook) over the same forty years in
 * eight-year turns and in one-year turns, on forty seeds, and compare what
 * happened. No model call: a leader's decision lands through
 * `applySystemDeltas`, the call an event's outcome lands in.
 *
 * Morale is left to move: no event touches it, so only the kernel moves it.
 * The two sides roll different dice (an eight-year turn's later years are
 * steps of one turn, the one-year side's are turns of their own), so they
 * agree in distribution, not draw for draw. The tolerances are four
 * standard deviations of the noise: two counts `a` and `b` agree when
 * `|a - b| <= 4 * sqrt(a + b)`; the living, which move with births and
 * deaths, when the gap is within four times the root of the births and
 * deaths on both sides; the mean morale over the seeds, when the gap is
 * within four standard errors of the difference of the two means (from the
 * spread across seeds), and never under 0.005.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { progressBetweenTurns, yearSteps } from '../../src/engine/core/progression.js';
import { SeededRng } from '../../src/engine/core/rng.js';
import type { SimulationState } from '../../src/engine/core/state.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { ProgressionHookContext, ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';

const here = dirname(fileURLToPath(import.meta.url));
const hook = marsScenario.hooks.progressionHook!;
const START = 2035;
const END = 2075;
const LONG = 8;
const SEEDS = Array.from({ length: 40 }, (_, i) => 101 + i);
const COUNTS = ['deaths', 'natural', 'radiation', 'despair', 'promotions', 'births'] as const;
type Count = typeof COUNTS[number];
type Tally = Record<Count | 'alive' | 'morale', number>;
/** The tallies of every seed at one year, summed, with each seed's morale. */
type Summed = Record<Count | 'alive', number> & { morale: number[] };

function tally(state: SimulationState): Tally {
  const deaths = state.eventLog.filter(e => e.type === 'death');
  return {
    deaths: deaths.length,
    natural: deaths.filter(e => e.cause === 'natural causes' || e.cause === 'age-related complications').length,
    radiation: deaths.filter(e => e.cause === 'radiation cancer').length,
    despair: deaths.filter(e => e.cause === 'despair').length,
    promotions: state.eventLog.filter(e => e.type === 'promotion').length,
    births: state.eventLog.filter(e => e.type === 'birth').length,
    alive: state.agents.filter(a => a.health.alive).length,
    morale: state.metrics.morale,
  };
}

/**
 * What every eighth year left, for one seed and one turn length. `leader`
 * is a decision's morale change, landing after each turn's progression and
 * before the next one's, as an event's outcome does in a run.
 */
function run(seed: number, turnYears: number, leader = 0): Map<number, Tally> {
  const kernel = new SimulationKernel(seed, 'Aria Chen', [], { startTime: START, initialPopulation: 100, scenario: marsScenario });
  const out = new Map<number, Tally>();
  kernel.advanceTurn(1, START, hook);
  let turn = 1;
  for (let time = START + turnYears; time <= END; time += turnYears) {
    if (leader !== 0) kernel.applySystemDeltas({ morale: leader });
    const state = kernel.advanceTurn(++turn, time, hook);
    if ((time - START) % LONG === 0) out.set(time, tally(state));
  }
  return out;
}

function summed(turnYears: number, leader = 0): Map<number, Summed> {
  const total = new Map<number, Summed>();
  for (const seed of SEEDS) {
    for (const [time, t] of run(seed, turnYears, leader)) {
      const sum = total.get(time) ?? { deaths: 0, natural: 0, radiation: 0, despair: 0, promotions: 0, births: 0, alive: 0, morale: [] };
      for (const k of COUNTS) sum[k] += t[k];
      sum.alive += t.alive;
      sum.morale.push(t.morale);
      total.set(time, sum);
    }
  }
  return total;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

test('with morale left to move, one eight-year turn gives the morale, the living, the deaths, promotions and births eight one-year turns give', (t) => {
  const long = summed(LONG);
  const yearly = summed(1);
  const rows: string[] = [];
  const off: string[] = [];
  const check = (row: string, gap: number, bound: number) => {
    rows.push(`${row}, bound ${bound.toFixed(3)}`);
    if (gap > bound) off.push(row);
  };
  for (let time = START + LONG; time <= END; time += LONG) {
    const a = long.get(time)!;
    const b = yearly.get(time)!;
    for (const k of COUNTS) {
      check(`${time} ${k}: eight-year turns ${a[k]}, one-year turns ${b[k]}`, Math.abs(a[k] - b[k]), 4 * Math.sqrt(a[k] + b[k]));
    }
    check(`${time} alive: eight-year turns ${a.alive}, one-year turns ${b.alive}`, Math.abs(a.alive - b.alive),
      4 * Math.sqrt(a.births + a.deaths + b.births + b.deaths));
    const n = SEEDS.length;
    check(`${time} mean morale: eight-year turns ${mean(a.morale).toFixed(3)}, one-year turns ${mean(b.morale).toFixed(3)}`,
      Math.abs(mean(a.morale) - mean(b.morale)),
      Math.max(0.005, 4 * Math.sqrt(variance(a.morale) / n + variance(b.morale) / n)));
  }
  t.diagnostic(rows.join('\n'));
  assert.deepEqual(off, [], `\n${rows.join('\n')}`);
});

test('a leader who lifts morale a turn keeps more people alive on eight-year turns than one who lowers it', (t) => {
  // A decision lands once a turn, as it does in a run. On eight-year turns
  // the colony settles back toward 0.6 each year between decisions, and a
  // leader's morale still decides who lives.
  const lifted = summed(LONG, 0.15).get(END)!;
  const lowered = summed(LONG, -0.15).get(END)!;
  const seen = `by ${END} over ${SEEDS.length} seeds: +0.15 a turn ${lifted.alive} alive, ${lifted.despair} despair deaths, mean morale ${mean(lifted.morale).toFixed(3)}; `
    + `-0.15 a turn ${lowered.alive} alive, ${lowered.despair} despair deaths, mean morale ${mean(lowered.morale).toFixed(3)}`;
  t.diagnostic(seen);
  assert.ok(lifted.alive - lowered.alive > 4 * Math.sqrt(lifted.births + lifted.deaths + lowered.births + lowered.deaths), seen);
  assert.ok(lowered.despair - lifted.despair > 4 * Math.sqrt(lowered.despair + lifted.despair), seen);
});

test('nobody takes two promotions in one step', () => {
  // A junior with twenty years' experience meets both checks. Over one
  // eight-year turn on forty seeds, nobody rises two ranks in one year.
  const doubled: string[] = [];
  for (const seed of SEEDS) {
    const state = new SimulationKernel(seed, 'Aria Chen', [], { startTime: START, initialPopulation: 100, scenario: marsScenario }).getState();
    for (const a of state.agents) {
      a.career.rank = 'junior';
      a.career.yearsExperience = 20;
    }
    const next = { ...state, metadata: { ...state.metadata, currentTime: START + LONG, currentTurn: 2 } };
    const { events } = progressBetweenTurns(next, LONG, new SeededRng(seed), hook);
    const seen = new Set<string>();
    for (const e of events.filter(ev => ev.type === 'promotion')) {
      const key = `${e.agentId} in ${e.time}`;
      if (seen.has(key)) doubled.push(`seed ${seed}: ${key}`);
      seen.add(key);
    }
  }
  assert.deepEqual(doubled, []);
});

test('a long turn settles morale each year it spans, with the death shock of that year', () => {
  // Each year of an eight-year turn moves morale a tenth of the way to 0.6
  // and adds the year's pressures and its death shock (0.04 a death when
  // more than two die in it), as a one-year turn does. A hook runs as each
  // year begins, after the year before it settled: it reads the morale,
  // the food store, the life support and who is alive and how they feel as
  // that year left them. The turn's end state holds what its last year
  // left. Three deaths spread over three years shock nobody; a year that
  // loses three or more still does.
  type Seen = { time: number; morale: number; food: number; lifeSupport: number; alive: number; psych: number };
  const look = (time: number, metrics: Readonly<Record<string, unknown>>, agents: SimulationState['agents']): Seen => {
    const alive = agents.filter(a => a.health.alive);
    return {
      time,
      morale: metrics.morale as number,
      food: metrics.foodMonthsReserve as number,
      lifeSupport: metrics.lifeSupportCapacity as number,
      alive: alive.length,
      psych: alive.reduce((sum, a) => sum + a.health.psychScore, 0) / alive.length,
    };
  };
  const settle = (morale: number, after: Seen, shock: number) => Math.max(0, Math.min(1, morale + (0.6 - morale) * 0.1
    + (after.food < 6 ? -0.05 : 0)
    + (after.alive > after.lifeSupport ? -0.08 : 0)
    + (after.psych < 0.4 ? -0.06 : after.psych > 0.7 ? 0.03 : 0)
    + shock));
  let spread = 0;
  let shaken = 0;
  for (const seed of SEEDS) {
    const kernel = new SimulationKernel(seed, 'Aria Chen', [], { startTime: START, initialPopulation: 100, scenario: marsScenario });
    kernel.advanceTurn(1, START, hook);
    for (let turn = 2; turn <= 3; turn++) {
      const seen: Seen[] = [];
      const watch = (ctx: ProgressionHookContext) => {
        seen.push(look(ctx.time, ctx.metrics!, ctx.agents));
        hook(ctx);
      };
      const state = kernel.advanceTurn(turn, START + (turn - 1) * LONG, watch);
      assert.equal(seen.length, LONG, 'one call a year');
      const end = look(state.metadata.currentTime, state.metrics, state.agents);
      for (let year = 0; year < LONG; year++) {
        const after = year + 1 < LONG ? seen[year + 1] : end;
        const deaths = state.eventLog.filter(e => e.turn === turn && e.type === 'death' && e.time === seen[year].time).length;
        const shock = deaths > 2 ? -0.04 * deaths : 0;
        if (shock < 0) shaken++;
        const expected = settle(seen[year].morale, after, shock);
        assert.ok(Math.abs(after.morale - expected) < 1e-9,
          `seed ${seed} turn ${turn}, the year to ${seen[year].time}: ${deaths} deaths, morale ${seen[year].morale} went to ${after.morale}, expected ${expected}`);
      }
      const perYear = new Map<number, number>();
      for (const e of state.eventLog) {
        if (e.turn === turn && e.type === 'death') perYear.set(e.time, (perYear.get(e.time) ?? 0) + 1);
      }
      const total = [...perYear.values()].reduce((sum, n) => sum + n, 0);
      if (total > 2 && [...perYear.values()].every(n => n <= 2)) spread++;
    }
  }
  assert.ok(spread > 0, 'some turn spreads three or more deaths over its years');
  assert.ok(shaken > 0, 'some year loses three or more');
});

/** Each turn's morale, living, deaths and births. */
type TurnRow = [morale: number, alive: number, deaths: number, births: number];

function shortTurns(sc: ScenarioPackage, seed: number, population: number, turns: number, unitsPerTurn: number): TurnRow[] {
  const start = sc.setup.defaultStartTime ?? 1;
  const kernel = new SimulationKernel(seed, 'Aria Chen', [], { startTime: start, initialPopulation: population, scenario: sc });
  const rows: TurnRow[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const state = kernel.advanceTurn(turn, start + (turn - 1) * unitsPerTurn, sc.hooks?.progressionHook);
    const mine = state.eventLog.filter(e => e.turn === turn);
    rows.push([
      state.metrics.morale,
      state.agents.filter(a => a.health.alive).length,
      mine.filter(e => e.type === 'death').length,
      mine.filter(e => e.type === 'birth').length,
    ]);
  }
  return rows;
}

test('a turn of a year or less runs as it did before long turns settled morale each year', () => {
  // Atlas Lab's monthly turns, the Digital Twin's two-week turns (its JSON,
  // with no compiled hook: compiling one calls a model) and Mars on
  // one-year turns, on fixed seeds. The pinned rows were read from CI on
  // the kernel of b43ee952, before long turns settled morale each year.
  const scenarios = loadDiskCustomScenarios(resolve(here, '../../scenarios'));
  const atlasLab = scenarios.get('atlas-lab')!.scenario as ScenarioPackage;
  const twin = JSON.parse(readFileSync(resolve(here, '../../scenarios/t2d-glp1-protocol.json'), 'utf-8')) as ScenarioPackage;
  const actual: Record<string, TurnRow[]> = {
    'atlas-lab, seed 11, 480 people, 12 monthly turns': shortTurns(atlasLab, 11, 480, 12, 1),
    'digital twin, seed 11, 1 person, 26 two-week turns': shortTurns(twin, 11, 1, 26, 2),
    'mars-genesis, seed 101, 100 people, 17 one-year turns': shortTurns(marsScenario, 101, 100, 17, 1),
    'mars-genesis, seed 950, 30 people, 17 one-year turns': shortTurns(marsScenario, 950, 30, 17, 1),
  };
  const pinned = JSON.parse(readFileSync(resolve(here, '../fixtures/short-turns-before-yearly-morale.json'), 'utf-8')).runs as Record<string, TurnRow[]>;
  assert.deepEqual(actual, pinned);
});

test('a hook in a long turn reads the head count as its step begins', () => {
  const kernel = new SimulationKernel(101, 'Aria Chen', [], { startTime: START, initialPopulation: 100, scenario: marsScenario });
  const read: Array<{ time: number; population: unknown; alive: number }> = [];
  kernel.advanceTurn(1, START, hook);
  kernel.advanceTurn(2, START + LONG, ctx => {
    read.push({ time: ctx.time, population: ctx.metrics?.population, alive: ctx.agents.filter(a => a.health.alive).length });
  });
  assert.equal(read.length, LONG, 'one call a year');
  assert.ok(read.at(-1)!.alive !== read[0].alive, `the head count moves in the turn: ${JSON.stringify(read)}`);
  for (const r of read) assert.equal(r.population, r.alive, `in ${r.time}`);
});

test('a turn of billions of years ends, in at most a hundred steps', () => {
  // A /setup request can ask for any time per turn. Past the hundredth
  // step the years fold into the last one, which compounds its rates.
  const years = 2 ** 33;
  const steps = yearSteps(years);
  assert.ok(steps.length <= 100, `${steps.length} steps`);
  assert.equal(steps.reduce((sum, y) => sum + y, 0), years);
  assert.equal(yearSteps(100).length, 100);
  assert.deepEqual(yearSteps(100).filter(y => y !== 1), []);
  const justOver = yearSteps(100.5);
  assert.equal(justOver.length, 100);
  assert.equal(justOver.reduce((sum, y) => sum + y, 0), 100.5);

  const kernel = new SimulationKernel(101, 'Aria Chen', [], { startTime: START, initialPopulation: 30, scenario: marsScenario });
  kernel.advanceTurn(1, START, hook);
  const state = kernel.advanceTurn(2, START + years, hook);
  assert.equal(state.metadata.currentTime, START + years);
  assert.equal(state.agents.filter(a => a.health.alive).length, 0, 'nobody outlives it');
});
