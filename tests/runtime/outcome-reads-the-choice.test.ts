/**
 * An event's outcome reads the option the leader chose.
 *
 * Both leaders of a pair run on one seed, and the orchestrator draws one
 * number per event, `new SeededRng(seed).turnSeed(turn * 100 + ei)`, so
 * both face the same luck. That draw was compared with one success chance
 * whatever the leader picked, so an event at the same index succeeded or
 * failed the same way on both sides (issue 188). The draw now meets the
 * chosen option's own chance: the risky option's is the event's
 * `riskSuccessProbability` with the run's modifiers, and a safe option's
 * halves the risky option's chance of failure.
 *
 * These tests run the classification the orchestrator runs, on the Mars
 * Genesis founding event from scenarios/mars.json and kernels built from
 * the Mars scenario, with the orchestrator's own draw and no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { SeededRng } from '../../src/engine/core/rng.js';
import { classifyOutcome, classifyOutcomeById } from '../../src/engine/core/progression.js';
import * as progression from '../../src/engine/core/progression.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { WorldMetrics } from '../../src/engine/core/state.js';

const here = dirname(fileURLToPath(import.meta.url));
const marsJson = JSON.parse(readFileSync(resolve(here, '../../scenarios/mars.json'), 'utf8'));
const founding = marsJson.dataDrivenHooks.milestones[0].event as {
  options: Array<{ id: string; label: string; isRisky: boolean }>;
  riskyOptionId: string;
  riskSuccessProbability: number;
};
const safe = founding.options.find(o => !o.isRisky)!;
const risky = founding.options.find(o => o.isRisky)!;

const TURN = 1;
const EVENT_INDEX = 0;

/** The orchestrator's outcome draw for this event in a run on `seed`. */
function outcomeDraw(seed: number): SeededRng {
  return new SeededRng(seed).turnSeed(TURN * 100 + EVENT_INDEX);
}

/** The number that draw compares with a chance. */
function drawValue(seed: number): number {
  return outcomeDraw(seed).next();
}

/** The risky option's chance: the event's probability and the run's modifiers, within 0.1 and 0.9. */
function riskyChance(metrics: WorldMetrics): number {
  let p = founding.riskSuccessProbability;
  if (metrics.morale > 0.7) p += 0.1;
  if (typeof metrics.foodMonthsReserve === 'number' && metrics.foodMonthsReserve > 12) p += 0.05;
  if (metrics.population > 150) p -= 0.05;
  return Math.max(0.1, Math.min(0.9, p));
}

/** A safe option halves the risky option's chance of failure. */
function safeChance(metrics: WorldMetrics): number {
  return (1 + riskyChance(metrics)) / 2;
}

function leaderKernel(seed: number, leader: string): SimulationKernel {
  return new SimulationKernel(seed, leader, [], {
    startTime: marsScenario.setup.defaultStartTime ?? 2035,
    initialPopulation: 30,
    scenario: marsScenario,
  });
}

/** The first run seed whose draw for this event falls in [lo, hi). */
function seedWithDraw(lo: number, hi: number): number {
  for (let seed = 1; seed < 200_000; seed++) {
    const u = drawValue(seed);
    if (u >= lo && u < hi) return seed;
  }
  throw new Error(`no seed draws in [${lo}, ${hi})`);
}

/** Leader A picks the safe option and leader B the risky one, on one seed. */
function pair(seed: number) {
  const a = leaderKernel(seed, 'Aria Chen').getState().metrics;
  const b = leaderKernel(seed, 'Dietrich Voss').getState().metrics;
  return {
    a: classifyOutcomeById(safe.id, founding.options, founding.riskSuccessProbability, a, outcomeDraw(seed)),
    b: classifyOutcomeById(risky.id, founding.options, founding.riskSuccessProbability, b, outcomeDraw(seed)),
    aText: classifyOutcome(`Settle at ${safe.label}.`, risky.label, founding.riskSuccessProbability, a, outcomeDraw(seed)),
    bText: classifyOutcome(`Settle at ${risky.label}.`, risky.label, founding.riskSuccessProbability, b, outcomeDraw(seed)),
    metrics: a,
  };
}

const metrics = leaderKernel(marsScenario.setup.defaultSeed ?? 950, 'Aria Chen').getState().metrics;

test('the Mars founding event declares one safe and one risky option', () => {
  assert.equal(risky.id, founding.riskyOptionId);
  assert.ok(safe, 'a safe option');
  assert.ok(safeChance(metrics) > riskyChance(metrics), 'a safe option has the better chance');
});

test('on a draw between the two chances the safe option succeeds and the risky option fails', () => {
  const seed = seedWithDraw(riskyChance(metrics), safeChance(metrics));
  const { a, b, aText, bText, metrics: m } = pair(seed);
  const u = drawValue(seed);
  assert.ok(u >= riskyChance(m) && u < safeChance(m), `draw ${u} sits between ${riskyChance(m)} and ${safeChance(m)}`);
  assert.equal(a, 'conservative_success', 'leader A, safe option');
  assert.equal(b, 'risky_failure', 'leader B, risky option');
  assert.equal(aText, 'conservative_success', 'leader A, decision text only');
  assert.equal(bText, 'risky_failure', 'leader B, decision text only');
});

test('on a draw below both chances both leaders succeed', () => {
  const seed = seedWithDraw(0, riskyChance(metrics));
  const { a, b, aText, bText } = pair(seed);
  assert.equal(a, 'conservative_success');
  assert.equal(b, 'risky_success');
  assert.equal(aText, 'conservative_success');
  assert.equal(bText, 'risky_success');
});

test('on a draw above both chances both leaders fail', () => {
  const seed = seedWithDraw(safeChance(metrics), 1);
  const { a, b, aText, bText } = pair(seed);
  assert.equal(a, 'conservative_failure');
  assert.equal(b, 'risky_failure');
  assert.equal(aText, 'conservative_failure');
  assert.equal(bText, 'risky_failure');
});

test('a decision on an event with no risky option reads as safe', () => {
  // The orchestrator passes the label of the event's risky option, or ''
  // when no option is risky (a compiled milestone can carry only safe
  // options). Every text contains '', so every such decision read as the
  // risky one and took the risky option's chance.
  const seed = seedWithDraw(riskyChance(metrics), safeChance(metrics));
  const outcome = classifyOutcome(`Settle at ${safe.label}.`, '', founding.riskSuccessProbability, metrics, outcomeDraw(seed));
  assert.equal(outcome, 'conservative_success');
  assert.equal(classifyOutcome('Hold position.', '   ', founding.riskSuccessProbability, metrics, outcomeDraw(seed)), 'conservative_success', 'a blank label names no option either');
});

test('a choice the event does not offer reads from the decision text', () => {
  // The decision schema takes any string as selectedOptionId, and the
  // orchestrator passed one the event does not offer straight to
  // classifyOutcomeById, which found no option and read the safe one,
  // whatever the decision said. The orchestrator now resolves the choice
  // with resolveChosenOption before it classifies.
  const resolve = (progression as Record<string, unknown>).resolveChosenOption as
    ((id: string | undefined, text: string, options: typeof founding.options) => string | undefined) | undefined;
  assert.equal(typeof resolve, 'function', 'progression exports resolveChosenOption');
  assert.equal(resolve!('option_c', `Settle at ${risky.label}.`, founding.options), risky.id, 'an id the event does not offer');
  assert.equal(resolve!(risky.label, 'We go.', founding.options), risky.id, 'the label written where the id goes');
  assert.equal(resolve!(safe.id.toUpperCase(), 'We go.', founding.options), safe.id, 'an offered id in another case');
  assert.equal(resolve!(safe.id, `Settle at ${risky.label}.`, founding.options), safe.id, 'an offered id wins over the text');
  assert.equal(resolve!(undefined, 'Defer to department consensus.', founding.options), undefined, 'a decision that names no option');

  const seed = seedWithDraw(riskyChance(metrics), safeChance(metrics));
  const chosen = resolve!('option_c', `Settle at ${risky.label}.`, founding.options)!;
  assert.equal(classifyOutcomeById(chosen, founding.options, founding.riskSuccessProbability, metrics, outcomeDraw(seed)), 'risky_failure');
});
