/**
 * Two leaders' adopted effects decide who lives on Mars, within the bound
 * one decision has (#214), while each person rolls the same dice under
 * both leaders (#184).
 *
 * The live Mars Genesis pair of 6 November 2026 (seed 950, 30 people, six
 * turns) lost the same 18 people under both leaders: every effect the
 * departments recommended moved morale only, and morale sat at its ceiling.
 * The death a leader can reach within six turns is radiation cancer, through
 * the habitat modules that shield the dose. These tests run a pair the way
 * the orchestrator does (`advanceTurn` with the scenario's progression hook
 * at the top of each turn, then the policy step, `applyCommanderPolicy`,
 * with the scenario's outcome tables), on the real Mars Genesis scenario,
 * with fixed reports and selections in place of the model calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { EffectRegistry } from '../../src/engine/registries/effects.js';
import { applyCommanderPolicy } from '../../src/runtime/orchestrator/commander-policy.js';
import { emptyReport } from '../../src/runtime/util/parsers.js';
import { CommanderDecisionSchema } from '../../src/runtime/validators/commander.js';
import type { CommanderDecision, DepartmentReport } from '../../src/runtime/contracts.js';

const hook = marsScenario.hooks.progressionHook;
/** Mars turns: the landing in 2035, then a turn every eight years. */
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const tables = {
  registry: EffectRegistry.forScenario(marsScenario),
  politicsHook: marsScenario.hooks.politicsHook,
  categories: Object.keys(marsScenario.knowledge?.categoryMapping ?? {}),
};

/** A department report recommending one effect, and the decision that adopts it. */
function adopt(department: string, description: string, systemDelta: Record<string, number>) {
  const reports = [{
    ...emptyReport(department),
    recommendedEffects: [{ id: 'effect_1', type: 'capacity_expansion', description, systemDelta }],
  } as unknown as DepartmentReport];
  const decision = CommanderDecisionSchema.parse({
    selectedOptionId: 'option_a',
    decision: description,
    rationale: '',
    reasoning: '1) ...',
    selectedPolicies: [`${department}/effect_1`],
    rejectedPolicies: [],
    expectedTradeoffs: [],
    watchMetricsNextTurn: [],
  }) as unknown as CommanderDecision;
  return { reports, decision };
}

/** Six Mars turns with one leader adopting the same effect each turn; the policy step's log lines. */
function run(choice: ReturnType<typeof adopt>) {
  const kernel = new SimulationKernel(950, 'Leader', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
  const roster = kernel.getState().agents.map(a => a.core.id);
  const lines: string[] = [];
  for (const [turn, time] of TURNS) {
    kernel.advanceTurn(turn, time, hook);
    applyCommanderPolicy(kernel, choice.decision, choice.reports, turn, time, l => lines.push(l), tables);
  }
  const state = kernel.getState();
  /** When each person the run began with died, by id. */
  const died = new Map(state.agents
    .filter(a => roster.includes(a.core.id) && !a.health.alive)
    .map(a => [a.core.id, a.health.deathTime as number]));
  return { state, died, lines };
}

/** A leader whose engineers build two shielded habitat modules each turn, the most one decision builds on Mars. */
const builder = () => adopt('engineering', 'Build two shielded habitat modules.', { infrastructureModules: 2 });
/** A leader who adopts a crew rest rotation each turn. */
const rester = () => adopt('psychology', 'Rest rotation for the crew.', { morale: 0.05 });

test('two leaders whose adopted effects differ lose different people over six Mars turns, on the same dice', () => {
  const shielded = run(builder());
  const rested = run(rester());
  assert.ok(shielded.state.metrics.infrastructureModules > rested.state.metrics.infrastructureModules);

  const only = (a: Map<string, number>, b: Map<string, number>) => [...a.keys()].filter(id => !b.has(id)).sort();
  const savedByShielding = only(rested.died, shielded.died);
  assert.ok(savedByShielding.length > 0, `the same people died under both leaders: ${[...rested.died.keys()].sort().join(', ')}`);

  // Each person rolls the same dice under both leaders, and the habitat
  // only lowers a hazard: nobody dies only where the colony is better
  // shielded, and nobody dies there sooner.
  assert.deepEqual(only(shielded.died, rested.died), [], 'died only under the builder');
  for (const [id, time] of shielded.died) {
    assert.ok(time >= rested.died.get(id)!, `${id} died in ${time} under the builder and in ${rested.died.get(id)} under the other leader`);
  }
});

test('a leader who asks for more than the bound moves the run as the bound does', () => {
  // Ten modules a decision, where the outcome tables bring two at most:
  // without the bound, six decisions build 63 modules and grow 0.3 of a
  // month of food a year for each.
  const greedy = run(adopt('engineering', 'Build ten habitat modules.', { infrastructureModules: 10 }));
  const bounded = run(builder());
  assert.equal(greedy.state.metrics.infrastructureModules, bounded.state.metrics.infrastructureModules);
  assert.equal(greedy.state.metrics.foodMonthsReserve, bounded.state.metrics.foodMonthsReserve);
  assert.deepEqual([...greedy.died].sort(), [...bounded.died].sort());
  assert.equal(greedy.lines.filter(l => /\[policy\] effects: \{"infrastructureModules":2\} asked: \{"infrastructureModules":10\}/.test(l)).length, 6, greedy.lines.join('\n'));
});

/** A leader whose engineers run the water, life support, power and pressurized volume down each turn, as far as one decision moves each. */
const runDown = () => adopt('engineering', 'Run the systems down.', { waterLitersPerDay: -100, lifeSupportCapacity: -5, powerKw: -60, pressurizedVolumeM3: -200 });
/** A leader whose engineers build the same four up each turn, by the same amounts. */
const buildUp = () => adopt('engineering', 'Build the systems up.', { waterLitersPerDay: 100, lifeSupportCapacity: 5, powerKw: 60, pressurizedVolumeM3: 200 });

test('a leader who runs the colony\'s supplies down loses people one who builds them up keeps, on the same dice', (t) => {
  // Neither leader touches the habitat modules, so both colonies take the
  // same dose; only the supply level differs (#234).
  const down = run(runDown());
  const up = run(buildUp());
  // Each amount is the bound of its key, so the policy step applies it as asked.
  assert.deepEqual(down.lines.filter(l => l.includes('asked:')), [], down.lines.join('\n'));
  assert.deepEqual(up.lines.filter(l => l.includes('asked:')), [], up.lines.join('\n'));
  assert.equal(down.state.metrics.infrastructureModules, up.state.metrics.infrastructureModules);

  const dead = (s: ReturnType<typeof run>) => new Set(s.state.agents.filter(a => !a.health.alive).map(a => a.core.id));
  const deadDown = dead(down);
  const deadUp = dead(up);
  const name = (s: ReturnType<typeof run>, ids: string[]) => ids.map(id => s.state.agents.find(a => a.core.id === id)?.core.name ?? id).sort();
  const onlyDown = [...deadDown].filter(id => !deadUp.has(id));
  const onlyUp = [...deadUp].filter(id => !deadDown.has(id));
  t.diagnostic(`run down: ${deadDown.size} died; built up: ${deadUp.size} died; only under the leader who ran them down: ${name(down, onlyDown).join(', ')}; only under the one who built them up: ${name(up, onlyUp).join(', ')}`);
  assert.ok(onlyDown.length > 0, `the same people died under both leaders: ${name(down, [...deadDown]).join(', ')}`);

  // The same dice, and the colony that holds more only lowers the age and
  // accident chances: no one the run began with dies only under the
  // builder, or sooner there.
  const only = (a: Map<string, number>, b: Map<string, number>) => [...a.keys()].filter(id => !b.has(id)).sort();
  assert.deepEqual(only(up.died, down.died), [], 'died only under the builder');
  for (const [id, time] of up.died) {
    assert.ok(time >= down.died.get(id)!, `${id} died in ${time} under the builder and in ${down.died.get(id)} under the other leader`);
  }
});
