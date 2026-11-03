/**
 * A long turn rolls each year it spans (#194).
 *
 * Mars Genesis turns are eight years apart. A yearly rate has to mean the
 * same thing whatever the turn's length, so one eight-year turn has to give
 * the chances eight one-year turns give: the deaths read the age and the
 * dose as they rise through the turn, and a couple can have more than one
 * child in it. These tests run the kernel the orchestrator runs (`new
 * SimulationKernel` with the scenario, then `advanceTurn` with its
 * progression hook) over the same forty years in eight-year turns and in
 * one-year turns, on forty seeds, and compare what happened. No model call.
 *
 * Morale is set to 0.7 before every turn on both sides, so the end-of-turn
 * morale drift, which runs once a turn by design, is the same for both and
 * the only difference left is how the kernel steps through the years.
 *
 * The two sides roll different dice (an eight-year turn's later years are
 * steps of one turn, the one-year side's are turns of their own), so their
 * counts agree in distribution, not draw for draw. The tolerance is four
 * standard deviations of the counting noise: two counts `a` and `b` agree
 * when `|a - b| <= 4 * sqrt(a + b)`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { progressBetweenTurns, yearSteps } from '../../src/engine/core/progression.js';
import { SeededRng } from '../../src/engine/core/rng.js';
import type { TurnEvent } from '../../src/engine/core/state.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';

const hook = marsScenario.hooks.progressionHook;
const START = 2035;
const END = 2075;
const LONG = 8;
const MORALE = 0.7;
const SEEDS = Array.from({ length: 40 }, (_, i) => 101 + i);
const KINDS = ['deaths', 'natural', 'radiation', 'promotions', 'births'] as const;
type Kind = typeof KINDS[number];
type Tally = Record<Kind, number>;

function tally(log: readonly TurnEvent[]): Tally {
  const deaths = log.filter(e => e.type === 'death');
  return {
    deaths: deaths.length,
    natural: deaths.filter(e => e.cause === 'natural causes' || e.cause === 'age-related complications').length,
    radiation: deaths.filter(e => e.cause === 'radiation cancer').length,
    promotions: log.filter(e => e.type === 'promotion').length,
    births: log.filter(e => e.type === 'birth').length,
  };
}

/** Cumulative counts at every eighth year, for one seed and one turn length. */
function run(seed: number, turnYears: number): Map<number, Tally> {
  const kernel = new SimulationKernel(seed, 'Aria Chen', [], { startTime: START, initialPopulation: 100, scenario: marsScenario });
  const hold = () => kernel.applySystemDeltas({ morale: MORALE - kernel.getState().metrics.morale });
  const out = new Map<number, Tally>();
  hold();
  kernel.advanceTurn(1, START, hook);
  let turn = 1;
  for (let time = START + turnYears; time <= END; time += turnYears) {
    hold();
    kernel.advanceTurn(++turn, time, hook);
    if ((time - START) % LONG === 0) out.set(time, tally(kernel.getState().eventLog));
  }
  return out;
}

function summed(turnYears: number): Map<number, Tally> {
  const total = new Map<number, Tally>();
  for (const seed of SEEDS) {
    for (const [time, t] of run(seed, turnYears)) {
      const sum = total.get(time) ?? { deaths: 0, natural: 0, radiation: 0, promotions: 0, births: 0 };
      for (const k of KINDS) sum[k] += t[k];
      total.set(time, sum);
    }
  }
  return total;
}

test('one eight-year turn gives the deaths, promotions and births eight one-year turns give', (t) => {
  const long = summed(LONG);
  const yearly = summed(1);
  const rows: string[] = [];
  const off: string[] = [];
  for (let time = START + LONG; time <= END; time += LONG) {
    for (const k of KINDS) {
      const a = long.get(time)![k];
      const b = yearly.get(time)![k];
      const bound = 4 * Math.sqrt(a + b);
      const row = `${time} ${k}: eight-year turns ${a}, one-year turns ${b}, bound ${bound.toFixed(1)}`;
      rows.push(row);
      if (Math.abs(a - b) > bound) off.push(row);
    }
  }
  t.diagnostic(rows.join('\n'));
  assert.deepEqual(off, [], `\n${rows.join('\n')}`);
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
