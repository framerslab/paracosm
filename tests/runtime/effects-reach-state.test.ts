/**
 * A selected policy effect and an event's outcome move the state they name.
 *
 * The cases come from the run of the live Atlas Lab pair of 2 November 2026
 * and from reading the kernel's write paths: a selected effect was written
 * as the metric's new value; a talent failure left a population of 19.96
 * beside a roster of 33; a category table's politics keys moved nothing and
 * the politics that did move went unreported. These tests run the kernel,
 * the policy translation and the outcome step the orchestrator runs, with
 * the scenarios as the server loads them from scenarios/, and no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { EffectRegistry, type OutcomeModifiers, type TurnOutcome } from '../../src/engine/registries/effects.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import { StreamEventSchema } from '../../src/engine/schema/stream.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { applyOutcomeEffects, systemsSnapshotTotals } from '../../src/runtime/orchestrator/outcome-effects.js';
import { decisionToPolicy, emptyDecision, emptyReport } from '../../src/runtime/util/parsers.js';
import type { CommanderDecision, DepartmentReport } from '../../src/runtime/contracts.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = loadDiskCustomScenarios(resolve(here, '../../scenarios'));
const scenario = (id: string) => {
  const sc = catalog.get(id)?.scenario as ScenarioPackage | undefined;
  assert.ok(sc, `scenarios/ holds ${id}`);
  return sc;
};
const atlasLab = scenario('atlas-lab');
const submarine = scenario('deep-ocean-station');
const corporate = scenario('corporate-quarterly');
const council = scenario('dual-superintelligence-council');

const OUTCOMES: TurnOutcome[] = ['risky_success', 'risky_failure', 'conservative_success', 'conservative_failure'];
const PLAIN: OutcomeModifiers = { personalityBonus: 0, noise: 0 };

function kernelFor(sc: ScenarioPackage, population = 30, extra: Record<string, unknown> = {}): SimulationKernel {
  return new SimulationKernel(sc.setup.defaultSeed ?? 11, 'Marcus Reinhardt', [], {
    startTime: sc.setup.defaultStartTime ?? 1,
    initialPopulation: population,
    scenario: sc,
    ...extra,
  });
}

function registryFor(sc: ScenarioPackage): EffectRegistry {
  return new EffectRegistry(sc.effects[0]?.categoryDefaults ?? {});
}

function near(actual: number, expected: number, label = ''): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} expected ${expected}, got ${actual}`);
}

function aliveCount(kernel: SimulationKernel): number {
  return kernel.getState().agents.filter(a => a.health.alive).length;
}

/** The commander picks effects by id out of one department's report. */
function policyFrom(
  effects: Array<Partial<NonNullable<DepartmentReport['recommendedEffects']>[number]> & { id: string }>,
  selectedEffectIds: string[],
  proposedPatches: unknown = {},
) {
  const report = {
    ...emptyReport('engineering'),
    proposedPatches,
    recommendedEffects: effects.map(e => ({ type: 'risk_mitigation', description: e.id, ...e })),
  } as unknown as DepartmentReport;
  const decision: CommanderDecision = {
    ...emptyDecision(['engineering']),
    decision: 'Hold the release',
    selectedEffectIds,
  } as CommanderDecision;
  return decisionToPolicy(decision, [report], 1, 2035);
}

// ---------------------------------------------------------------- policy

test('a selected effect moves a metric by its delta and leaves the rest of the run alone', () => {
  const kernel = kernelFor(marsScenario, 50);
  assert.equal(kernel.getState().metrics.morale, 0.85);
  assert.equal(kernel.getState().metrics.powerKw, 400);

  kernel.applyPolicy(policyFrom([
    { id: 'effect_1', systemDelta: { morale: -0.02 } },
    { id: 'effect_2', systemDelta: { powerKw: 20 } },
    { id: 'not_picked', systemDelta: { foodMonthsReserve: -5 } },
  ], ['effect_1', 'effect_2']));

  const metrics = kernel.getState().metrics;
  near(metrics.morale, 0.83, 'morale');
  assert.equal(metrics.powerKw, 420);
  assert.equal(metrics.foodMonthsReserve, 18, 'an effect the commander did not pick moves nothing');
  assert.match(kernel.getState().eventLog.map(e => e.description).join('\n'), /morale -0\.02/);
});

test('two selected effects on one metric add up, and the floor and ceiling still hold', () => {
  const both = kernelFor(marsScenario, 50);
  both.applyPolicy(policyFrom([
    { id: 'a', systemDelta: { morale: -0.02 } },
    { id: 'b', systemDelta: { morale: -0.03 } },
  ], ['a', 'b']));
  near(both.getState().metrics.morale, 0.8, 'two effects');

  const floored = kernelFor(marsScenario, 50);
  floored.applyPolicy(policyFrom([{ id: 'a', systemDelta: { morale: -2, powerKw: -5000 } }], ['a']));
  assert.equal(floored.getState().metrics.morale, 0);
  assert.equal(floored.getState().metrics.powerKw, 0);

  const ceiling = kernelFor(marsScenario, 50);
  ceiling.applyPolicy(policyFrom([{ id: 'a', systemDelta: { morale: 2 } }], ['a']));
  assert.equal(ceiling.getState().metrics.morale, 1);
});

test('a selected politics effect moves a politics value by its delta', () => {
  const kernel = kernelFor(marsScenario, 50);
  kernel.applyPolicy(policyFrom([{ id: 'a', politicsDelta: { earthDependencyPct: -3, independencePressure: 2 } }], ['a']));
  const politics = kernel.getState().politics;
  assert.equal(politics.earthDependencyPct, 92);
  assert.equal(politics.independencePressure, 1, 'the scenario keeps it at or under 1');
});

test('a selected effect moves only what the run carries, wherever the run holds it', () => {
  const kernel = kernelFor(atlasLab);
  kernel.applyPolicy(policyFrom([{ id: 'a', systemDelta: { powerKw: 20, morale: 0.02, boardConfidence: -5 } }], ['a']));
  const state = kernel.getState();
  assert.ok(!('powerKw' in state.metrics), 'a lab has no power plant');
  near(state.metrics.morale, 0.87, 'morale');
  assert.equal(state.politics.boardConfidence, 70);
  assert.ok(!('boardConfidence' in state.metrics));
});

test('a legacy patch still sets a value outright, and a selected effect adds to what it set', () => {
  const kernel = kernelFor(marsScenario, 50);
  kernel.applyPolicy(policyFrom(
    [{ id: 'a', systemDelta: { morale: -0.02 } }],
    ['a'],
    { metrics: { morale: 0.5, powerKw: 'plenty' }, politics: { governanceStatus: 'commonwealth' } },
  ));
  const state = kernel.getState();
  near(state.metrics.morale, 0.48, 'morale');
  assert.equal(state.metrics.powerKw, 400, 'a patch that is not a number moves nothing');
  assert.equal(state.politics.governanceStatus, 'commonwealth');
});

test('no patch writes a head count over the roster', () => {
  const kernel = kernelFor(marsScenario, 50);
  kernel.applyPolicy(policyFrom([], [], { metrics: { population: 999 } }));
  assert.equal(kernel.getState().metrics.population, 50);

  const roster = kernel.getState().agents;
  kernel.applyPolicy({
    description: 'x',
    patches: { agentUpdates: [{ agentId: roster[0].core.id, health: { alive: false } }] },
    events: [],
  });
  assert.equal(kernel.getState().metrics.population, 49);
  assert.equal(aliveCount(kernel), 49);
});

// ------------------------------------------------------------ population

test('a run starts with the head count of its roster, whatever the scenario declares', () => {
  // A demo run caps the roster at 30; atlas-lab.json declares 480. The first
  // turn_start of the live pair reported 480 with 30 people on the roster.
  for (const [sc, roster] of [[atlasLab, 30], [marsScenario, 50], [corporate, 12]] as Array<[ScenarioPackage, number]>) {
    const start = kernelFor(sc, roster).getState();
    assert.equal(start.metrics.population, roster, sc.id);
    assert.equal(start.agents.length, roster, sc.id);
  }
});

test('Atlas Lab\'s talent failure sends whole people out and the burn stays reduced', () => {
  const kernel = kernelFor(atlasLab, 33);
  const heads = kernel.getState().agents.slice(0, 3).map(a => a.core.id);
  for (const id of heads) kernel.promoteAgent(id, 'governance', 'Director', 'Priya Kapoor');
  const burnBefore = kernel.getState().metrics.burnRate;

  // The multiplier of the live outcome: -2 plus a personality bonus of 0.37
  // gives 8 * -1.63 = -13.04 people.
  const { systemDeltas } = applyOutcomeEffects(kernel, registryFor(atlasLab), {
    category: 'talent', outcome: 'risky_failure', modifiers: { personalityBonus: 0.37, noise: 0 }, turn: 5, time: 5,
  });

  assert.equal(systemDeltas.population, -13);
  const after = kernel.getState();
  assert.equal(after.metrics.population, 20);
  assert.equal(aliveCount(kernel), 20);
  assert.equal(after.agents.length, 20, 'a person who left is off the roster');
  assert.equal(after.metrics.burnRate, burnBefore - 326000);
  for (const id of heads) assert.ok(after.agents.some(a => a.core.id === id), `${id} leads a department and stays`);

  // A departure is its own event and never a death, which is what the verdict's mortality reads.
  assert.equal(after.eventLog.filter(e => e.type === 'departure').length, 13);
  assert.equal(after.eventLog.filter(e => e.type === 'death').length, 0);
  assert.equal(after.agents.filter(a => !a.health.alive).length, 0);

  // Nobody keeps a partner, friend or child who has gone.
  const onRoster = new Set(after.agents.map(a => a.core.id));
  for (const a of after.agents) {
    if (a.social.partnerId) assert.ok(onRoster.has(a.social.partnerId), `${a.core.id} partner`);
    for (const id of [...a.social.friendIds, ...a.social.childrenIds]) assert.ok(onRoster.has(id), `${a.core.id} tie ${id}`);
  }

  // The next turn's snapshot: a whole head count equal to the living roster.
  const next = kernel.advanceTurn(6, 6, atlasLab.hooks.progressionHook);
  const alive = next.agents.filter(a => a.health.alive).length;
  assert.equal(next.metrics.population, alive);
  assert.ok(Number.isInteger(next.metrics.population));
  assert.equal(next.metrics.burnRate, burnBefore - 326000, 'the people did not come back and neither did the burn');
  const event = StreamEventSchema.parse({
    type: 'systems_snapshot',
    leader: 'Priya Kapoor',
    turn: 6,
    time: 6,
    data: { turn: 6, time: 6, agents: [], ...systemsSnapshotTotals(next.metrics), births: 0, deaths: 0 },
  });
  assert.equal(event.data.population, alive);
});

test('a departure stops at the people who can leave and reports how many did', () => {
  const kernel = kernelFor(atlasLab, 6);
  for (const a of kernel.getState().agents.slice(0, 5)) kernel.promoteAgent(a.core.id, 'governance', 'Director', 'Priya Kapoor');
  const { systemDeltas } = applyOutcomeEffects(kernel, registryFor(atlasLab), {
    category: 'talent', outcome: 'risky_failure', modifiers: { personalityBonus: 0.37, noise: 0 }, turn: 5, time: 5,
  });
  assert.equal(systemDeltas.population, -1);
  assert.equal(kernel.getState().metrics.population, 5);
  assert.equal(aliveCount(kernel), 5);
});

test('a talent success hires real people into the scenario\'s own departments', () => {
  const kernel = kernelFor(atlasLab, 30);
  kernel.advanceTurn(3, 3, atlasLab.hooks.progressionHook);
  const start = kernel.getState();
  const alive = aliveCount(kernel);
  const before = new Set(start.agents.map(a => a.core.id));
  const births = start.eventLog.filter(e => e.type === 'birth').length;

  const { systemDeltas } = applyOutcomeEffects(kernel, registryFor(atlasLab), {
    category: 'talent', outcome: 'conservative_success', modifiers: PLAIN, turn: 3, time: 3,
  });
  assert.equal(systemDeltas.population, 8);
  applyOutcomeEffects(kernel, registryFor(atlasLab), {
    category: 'talent', outcome: 'risky_success', modifiers: { personalityBonus: 0.37, noise: 0 }, turn: 3, time: 3,
  });

  const state = kernel.getState();
  const added = 8 + 23; // 8 * (2.5 + 0.37) = 22.96 people, 23 of them whole.
  assert.equal(state.metrics.population, alive + added);
  assert.equal(aliveCount(kernel), alive + added);
  assert.equal(new Set(state.agents.map(a => a.core.id)).size, state.agents.length, 'every id is its own');
  assert.equal(new Set(state.agents.map(a => a.core.name)).size, state.agents.length, 'every name is its own');
  assert.equal(state.eventLog.filter(e => e.type === 'arrival').length, added);
  assert.equal(state.eventLog.filter(e => e.type === 'birth').length, births, 'a hire is not a birth');

  const departments = new Set(atlasLab.departments.map(d => d.id));
  const hires = state.agents.filter(a => !before.has(a.core.id));
  assert.equal(hires.length, added);
  for (const hire of hires) {
    assert.ok(departments.has(hire.core.department), `${hire.core.name} works in ${hire.core.department}`);
    assert.ok(3 - hire.core.birthTime >= 25, `${hire.core.name} is grown`);
    assert.equal(hire.core.marsborn, false);
    assert.equal(hire.hexacoHistory[0].turn, 3);
  }
});

test('the same run moves the same people, through a saved snapshot too', () => {
  const move = (kernel: SimulationKernel) => applyOutcomeEffects(kernel, registryFor(atlasLab), {
    category: 'talent', outcome: 'risky_failure', modifiers: PLAIN, turn: 2, time: 2,
  });
  const ids = (kernel: SimulationKernel) => kernel.getState().agents.map(a => a.core.id);

  const first = kernelFor(atlasLab, 40);
  const second = kernelFor(atlasLab, 40);
  const saved = first.toSnapshot(atlasLab.id);
  const restored = SimulationKernel.fromSnapshot(JSON.parse(JSON.stringify(saved)), atlasLab.id, atlasLab);
  move(first);
  move(second);
  move(restored);
  assert.deepEqual(ids(first), ids(second));
  assert.deepEqual(ids(first), ids(restored));
  assert.deepEqual(first.toSnapshot(atlasLab.id).rngState, saved.rngState, 'moving people leaves the turn rolls where they were');
});

test('every category of every scenario leaves a whole head count equal to the living roster', () => {
  const scenarios = [atlasLab, corporate, council, submarine, marsScenario, lunarScenario];
  const seen = new Set<string>();
  for (const sc of scenarios) {
    const categories = Object.keys(sc.effects[0]?.categoryDefaults ?? {});
    for (const category of categories) {
      if ('population' in (sc.effects[0].categoryDefaults[category] ?? {})) seen.add(sc.id);
      for (const outcome of OUTCOMES) {
        const kernel = kernelFor(sc, 40);
        const { systemDeltas } = applyOutcomeEffects(kernel, registryFor(sc), {
          category, outcome, modifiers: { personalityBonus: 0.13, noise: 0.07 }, turn: 1, time: sc.setup.defaultStartTime ?? 1,
        });
        const label = `${sc.id} ${category} ${outcome}`;
        const population = kernel.getState().metrics.population;
        assert.ok(Number.isInteger(population), `${label}: ${population}`);
        assert.equal(population, aliveCount(kernel), label);
        if ('population' in systemDeltas) assert.ok(Number.isInteger(systemDeltas.population), `${label}: ${systemDeltas.population}`);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['atlas-lab', 'corporate-quarterly', 'dual-superintelligence-council']);
});

// -------------------------------------------------------------- politics

test('an Atlas Lab press outcome moves its politics once, by its per-outcome table, and reports it', () => {
  const press = (outcome: TurnOutcome) => {
    const kernel = kernelFor(atlasLab);
    const reported = applyOutcomeEffects(kernel, registryFor(atlasLab), {
      category: 'press', outcome, modifiers: PLAIN, turn: 1, time: 1, politicsHook: atlasLab.hooks.politicsHook,
    });
    return { reported, politics: kernel.getState().politics, log: kernel.getState().eventLog.at(-1)?.description ?? '' };
  };

  const success = press('conservative_success');
  assert.equal(success.politics.boardConfidence, 80);
  assert.equal(success.politics.investorPressure, 43);
  assert.deepEqual(success.reported.politicsDeltas, { boardConfidence: 5, investorPressure: -2 });
  assert.ok(!('boardConfidence' in success.reported.systemDeltas), 'it is not a metric');
  assert.match(success.log, /boardConfidence \+5/);

  // The category table's own entry (+4 times -2) would raise it on a failure.
  const failure = press('risky_failure');
  assert.equal(failure.politics.boardConfidence, 71);
  assert.equal(failure.politics.investorPressure, 50);
  assert.deepEqual(failure.reported.politicsDeltas, { boardConfidence: -4, investorPressure: 5 });
});

test('a category table\'s politics key moves politics when no hook names it', () => {
  const registry = new EffectRegistry(atlasLab.effects[0].categoryDefaults);
  const kernel = kernelFor(atlasLab);
  const { systemDeltas, politicsDeltas } = applyOutcomeEffects(kernel, registry, {
    category: 'press', outcome: 'conservative_success', modifiers: PLAIN, turn: 1, time: 1,
  });
  assert.deepEqual(politicsDeltas, { boardConfidence: 4, investorPressure: 6 });
  assert.equal(kernel.getState().politics.boardConfidence, 79);
  assert.equal(kernel.getState().politics.investorPressure, 51);
  assert.deepEqual(systemDeltas, { releaseReadiness: 0.02 });

  // A hook that names one key leaves the table the other.
  const partial = kernelFor(atlasLab);
  const both = applyOutcomeEffects(partial, registry, {
    category: 'press', outcome: 'conservative_success', modifiers: PLAIN, turn: 1, time: 1,
    politicsHook: () => ({ boardConfidence: 1 }),
  });
  assert.deepEqual(both.politicsDeltas, { boardConfidence: 1, investorPressure: 6 });
});

test('politics stays in the range the scenario declares, in a fork too', () => {
  const asked = {
    category: 'safety_breach', outcome: 'conservative_success' as TurnOutcome, modifiers: PLAIN, turn: 1, time: 1,
    politicsHook: atlasLab.hooks.politicsHook,
  };
  const low = kernelFor(atlasLab, 30, { startingPolitics: { boardConfidence: 3, investorPressure: 98 } });
  const { politicsDeltas } = applyOutcomeEffects(low, registryFor(atlasLab), asked);
  assert.equal(low.getState().politics.boardConfidence, 0);
  assert.equal(low.getState().politics.investorPressure, 100);
  assert.deepEqual(politicsDeltas, { boardConfidence: -3, investorPressure: 2 });

  const high = kernelFor(atlasLab, 30, { startingPolitics: { boardConfidence: 98 } });
  const snapshot = JSON.parse(JSON.stringify(high.toSnapshot(atlasLab.id)));
  const fork = SimulationKernel.fromSnapshot(snapshot, atlasLab.id, atlasLab);
  applyOutcomeEffects(fork, registryFor(atlasLab), { ...asked, category: 'press', politicsHook: () => ({ boardConfidence: 50 }) });
  assert.equal(fork.getState().politics.boardConfidence, 100);
});

test('a metric stays in the range the scenario declares', () => {
  const station = kernelFor(submarine, 50);
  assert.equal(station.getState().metrics.hullIntegrity, 100);
  const hull = applyOutcomeEffects(station, registryFor(submarine), {
    category: 'infrastructure', outcome: 'risky_success', modifiers: PLAIN, turn: 1, time: 2038,
  });
  assert.equal(station.getState().metrics.hullIntegrity, 100);
  assert.equal(hull.systemDeltas.hullIntegrity, 0);

  const lab = kernelFor(atlasLab, 30, { startingResources: { releaseReadiness: 0.03 } });
  const readiness = applyOutcomeEffects(lab, registryFor(atlasLab), {
    category: 'safety_breach', outcome: 'conservative_success', modifiers: PLAIN, turn: 1, time: 1,
  });
  assert.equal(lab.getState().metrics.releaseReadiness, 0);
  assert.equal(readiness.systemDeltas.releaseReadiness, -0.03);
});

test('a run with no such key keeps its metrics and its politics as they were', () => {
  for (const sc of [marsScenario, lunarScenario, submarine]) {
    const kernel = kernelFor(sc, 50);
    const before = kernel.getState();
    const { systemDeltas, politicsDeltas } = applyOutcomeEffects(kernel, registryFor(sc), {
      category: 'psychological', outcome: 'conservative_success', modifiers: PLAIN, turn: 1, time: before.metadata.currentTime,
    });
    const after = kernel.getState();
    assert.deepEqual(politicsDeltas, {}, sc.id);
    assert.deepEqual(after.politics, before.politics, sc.id);
    assert.deepEqual(Object.keys(after.metrics).sort(), Object.keys(before.metrics).sort(), sc.id);
    assert.deepEqual(Object.keys(systemDeltas), ['morale'], sc.id);
  }

  // Mars's political crises move its politics through its hook, once, as they always have.
  const mars = kernelFor(marsScenario, 50);
  const { politicsDeltas } = applyOutcomeEffects(mars, registryFor(marsScenario), {
    category: 'political', outcome: 'risky_success', modifiers: PLAIN, turn: 1, time: 2035, politicsHook: marsScenario.hooks.politicsHook,
  });
  assert.deepEqual(politicsDeltas, { independencePressure: 0.05, earthDependencyPct: -3 });
  assert.equal(mars.getState().politics.earthDependencyPct, 92);
  near(mars.getState().politics.independencePressure as number, 0.1, 'independence');
});

// ----------------------------------------------------------------- words

test('nothing on a lab\'s roster or in its log speaks of a settlement on Mars', () => {
  const kernel = kernelFor(atlasLab, 480);
  let state = kernel.getState();
  for (let turn = 2; turn <= 30; turn++) state = kernel.advanceTurn(turn, turn, atlasLab.hooks.progressionHook);

  assert.ok(state.eventLog.some(e => e.type === 'birth'), 'someone was born');
  assert.ok(state.eventLog.some(e => e.type === 'death' && e.cause?.startsWith('accident:')), 'someone had an accident');
  const words = JSON.stringify({
    log: state.eventLog,
    roster: state.agents.map(a => ({ id: a.core.id, achievements: a.career.achievements, life: a.narrative.lifeEvents, cause: a.health.deathCause })),
  });
  assert.doesNotMatch(words, /settlement|colony|colonist|col-mars|Mars|airlock|EVA accident|pressure-suit/);

  const departments = new Set(atlasLab.departments.map(d => d.id));
  for (const a of state.agents) assert.ok(departments.has(a.core.department), `${a.core.name} works in ${a.core.department}`);
  const child = state.agents.find(a => a.core.marsborn);
  assert.ok(child);
  assert.deepEqual(child.career.achievements, ['Born here']);
  assert.match(child.core.id, /^col-born-/);
});

test('a station short of food loses people to hunger in its own words; Mars keeps its habitat hazards', () => {
  const station = kernelFor(submarine, 50, { startingResources: { foodMonthsReserve: 0.1 } });
  let time = station.getState().metadata.currentTime;
  let state = station.getState();
  for (let turn = 2; turn <= 5; turn++) state = station.advanceTurn(turn, ++time, submarine.hooks.progressionHook);
  const hunger = state.eventLog.filter(e => e.cause === 'starvation');
  assert.ok(hunger.length > 0, 'someone starved');
  for (const e of hunger) assert.doesNotMatch(e.description, /settlement/);

  const mars = kernelFor(marsScenario, 480);
  let marsTime = mars.getState().metadata.currentTime;
  let marsState = mars.getState();
  for (let turn = 2; turn <= 8; turn++) marsState = mars.advanceTurn(turn, marsTime += 4, marsScenario.hooks.progressionHook);
  const accidents = marsState.eventLog.filter(e => e.cause?.startsWith('accident:'));
  assert.ok(accidents.length > 0, 'someone had an accident');
  for (const e of accidents) {
    assert.match(e.cause ?? '', /airlock failure|EVA accident|falling debris|pressure-suit tear|vehicle rollover/);
    assert.doesNotMatch(e.description, / a [aeiouAEIOU]/, e.description);
  }
});
