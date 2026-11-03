/**
 * Both leaders roll the same dice for the same person, and a leader's
 * world decides who lives (#184).
 *
 * The live Mars pair of 3 November 2026 (seed 950, 30 people) lost the same
 * people on the same turns under both leaders, 27 of 30 by 2075, because
 * every death roll came from one stream per turn consumed in roster order
 * and no Mars death roll read anything a decision moves. These tests run
 * two kernels the way a pair run does (`new SimulationKernel` with the
 * scenario, then `advanceTurn` with its progression hook, the calls the
 * orchestrator makes), change one thing on one side, and compare who died.
 * No model call: a decision's effect is applied through the kernel calls a
 * decision lands in (`promoteAgent`, `applySystemDeltas`,
 * `applyAgentUpdates`, `applyPolicy`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { Agent } from '../../src/engine/core/state.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';

const hook = marsScenario.hooks.progressionHook;
/** Mars turns: the landing in 2035, then a turn every eight years. */
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];

function mars(): SimulationKernel {
  return new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
}

function deadIds(kernel: SimulationKernel): Set<string> {
  return new Set(kernel.getState().agents.filter(a => !a.health.alive).map(a => a.core.id));
}

function symmetricDifference(a: Set<string>, b: Set<string>): string[] {
  return [...[...a].filter(id => !b.has(id)), ...[...b].filter(id => !a.has(id))].sort();
}

function adults(kernel: SimulationKernel): Agent[] {
  const { currentTime } = kernel.getState().metadata;
  return kernel.getState().agents.filter(a => a.health.alive && currentTime - a.core.birthTime >= 25);
}

test('a promotion changes the fate of the person promoted and no one else', () => {
  const a = mars();
  const b = mars();
  const engineer = b.getState().agents.find(p => p.core.department === 'engineering');
  assert.ok(engineer, 'the roster has an engineer');
  b.promoteAgent(engineer.core.id, 'psychology', 'Chief Psychologist', 'Dietrich Voss');
  for (const [turn, time] of TURNS) {
    a.advanceTurn(turn, time, hook);
    b.advanceTurn(turn, time, hook);
  }
  const differ = symmetricDifference(deadIds(a), deadIds(b));
  assert.deepEqual(differ.filter(id => id !== engineer.core.id), [], `deaths differ beyond ${engineer.core.id}: ${differ.join(', ')}`);
});

test('a report on one person changes that person\'s fate and no one else\'s, within the bound', () => {
  const a = mars();
  const b = mars();
  a.advanceTurn(1, 2035, hook);
  b.advanceTurn(1, 2035, hook);
  const target = adults(b)[0];
  const before = target.health.psychScore;
  b.applyAgentUpdates([{ agentId: target.core.id, health: { psychScore: 0.1 } }]);
  const after = b.getState().agents.find(p => p.core.id === target.core.id)!.health.psychScore;
  assert.ok(Math.abs(after - Math.max(0.1, before - 0.15)) < 1e-9, `psych ${before} moved to ${after}`);
  for (const [turn, time] of TURNS.slice(1)) {
    a.advanceTurn(turn, time, hook);
    b.advanceTurn(turn, time, hook);
  }
  const differ = symmetricDifference(deadIds(a), deadIds(b));
  assert.deepEqual(differ.filter(id => id !== target.core.id), [], `deaths differ beyond ${target.core.id}: ${differ.join(', ')}`);
});

test('a better-shielded colony loses fewer people, and none it would not have lost', () => {
  const a = mars();
  const b = mars();
  const roster = a.getState().agents.map(p => p.core.id);
  b.applySystemDeltas({ infrastructureModules: 2 });
  for (const [turn, time] of TURNS) {
    a.advanceTurn(turn, time, hook);
    b.advanceTurn(turn, time, hook);
  }
  const alive = (k: SimulationKernel) => k.getState().agents.filter(p => p.health.alive).length;
  assert.ok(alive(b) > alive(a), `alive with two more modules ${alive(b)}, without ${alive(a)}`);
  // The people the run began with: on the better-shielded side each one's
  // hazards are no higher, on the same dice.
  const deadA = deadIds(a);
  const extra = roster.filter(id => deadIds(b).has(id) && !deadA.has(id));
  assert.deepEqual(extra, [], 'died only on the better-shielded side');
});

test('the dose a colonist takes reads the habitat', () => {
  const doseOver8Years = (modules: number) => {
    const k = mars();
    k.applySystemDeltas({ infrastructureModules: modules - (k.getState().metrics.infrastructureModules as number) });
    k.advanceTurn(1, 2035, hook);
    const before = new Map(k.getState().agents.map(p => [p.core.id, p.health.cumulativeRadiationMsv ?? 0]));
    k.advanceTurn(2, 2043, hook);
    const p = k.getState().agents.find(x => x.health.alive)!;
    return (p.health.cumulativeRadiationMsv ?? 0) - before.get(p.core.id)!;
  };
  const surface = 0.67 * 365 * 8;
  assert.ok(Math.abs(doseOver8Years(0) - surface) < 0.01, `no shielding: ${doseOver8Years(0)}`);
  assert.ok(Math.abs(doseOver8Years(3) - surface * 0.4) < 0.01, `three modules: ${doseOver8Years(3)}`);
  assert.ok(Math.abs(doseOver8Years(5) - surface * 0.1) < 0.01, `five modules: ${doseOver8Years(5)}`);
});

test('the colony\'s morale reaches its people', () => {
  // Morale pulls each person's psych by (morale - 0.5) * 0.1 a year, so a
  // colony held at 0.2 for forty years wears its people down to where the
  // despair roll reads them, and one held at 0.8 never does.
  const run = (morale: number) => {
    const k = mars();
    for (const [turn, time] of TURNS) {
      k.applySystemDeltas({ morale: morale - k.getState().metrics.morale });
      k.advanceTurn(turn, time, hook);
    }
    const living = adults(k);
    return {
      despair: k.getState().eventLog.filter(e => e.type === 'death' && e.cause === 'despair').length,
      low: living.filter(a => a.health.psychScore < 0.2).length,
      mean: living.reduce((s, a) => s + a.health.psychScore, 0) / Math.max(1, living.length),
      min: Math.min(...living.map(a => a.health.psychScore)),
    };
  };
  const low = run(0.2);
  const high = run(0.8);
  const seen = `at 0.2 ${JSON.stringify(low)}, at 0.8 ${JSON.stringify(high)}`;
  assert.ok(low.low + low.despair > 0, `morale held at 0.2 brings someone under 0.2 psych: ${seen}`);
  assert.ok(low.mean < high.mean, seen);
  assert.equal(high.low + high.despair, 0, `morale held at 0.8: ${seen}`);
});

test('a report moves a person\'s psych at most 0.15 a turn, and a patch never writes what physics owns', () => {
  const k = mars();
  const [first, second] = adults(k);
  const psych = first.health.psychScore;
  k.applyAgentUpdates([{ agentId: first.core.id, health: { psychScore: 0.05 } }]);
  const moved = k.getState().agents.find(p => p.core.id === first.core.id)!.health.psychScore;
  assert.ok(Math.abs(moved - (psych + Math.max(-0.15, Math.min(0.15, 0.05 - psych)))) < 1e-9, `psych ${psych} moved to ${moved}`);

  k.advanceTurn(1, 2035, hook);
  k.advanceTurn(2, 2043, hook);
  const dose = k.getState().agents.find(p => p.core.id === second.core.id)!.health.cumulativeRadiationMsv;
  assert.ok((dose ?? 0) > 0);
  k.applyPolicy({
    description: 'a department patch',
    patches: { agentUpdates: [{ agentId: second.core.id, health: { cumulativeRadiationMsv: 0, boneDensityPct: 100, conditions: ['tired'] } }] },
    events: [],
  });
  const after = k.getState().agents.find(p => p.core.id === second.core.id)!;
  assert.equal(after.health.cumulativeRadiationMsv, dose, 'the dose');
  assert.equal(after.health.alive, true);
  assert.deepEqual(after.health.conditions, ['tired'], 'conditions are written');
  const note = k.getState().eventLog.at(-1);
  assert.equal(note?.type, 'system');
  assert.match(note?.description ?? '', /cumulativeRadiationMsv/);
  assert.match(note?.description ?? '', /boneDensityPct/);
});
