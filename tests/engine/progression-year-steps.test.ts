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

test('one eight-year turn gives the deaths, promotions and births eight one-year turns give', () => {
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
  assert.deepEqual(off, [], `\n${rows.join('\n')}`);
});
