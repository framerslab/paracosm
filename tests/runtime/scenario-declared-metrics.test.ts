/**
 * A run carries, changes and reports only the metrics its scenario
 * declares, plus population and morale, which every run has.
 *
 * The live Atlas Lab pair of 2 November 2026 carried the kernel's Mars
 * defaults (power, food, water, volume, life support, modules, science,
 * Earth dependency, governance, independence) in its state, in every turn
 * event and in its saved run, and every outcome reported a power cost
 * ("powerKw":-1.2) that a lab does not have. These tests run the kernel,
 * the outcome step and the roster snapshot the orchestrator runs, with the
 * scenarios as the server loads them from scenarios/, and no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { KernelSnapshot } from '../../src/engine/core/snapshot.js';
import { EffectRegistry, type OutcomeModifiers, type TurnOutcome } from '../../src/engine/registries/effects.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import { StreamEventSchema } from '../../src/engine/schema/stream.js';
import { RunArtifactSchema } from '../../src/engine/schema/artifact.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { applyOutcomeEffects, systemsSnapshotTotals } from '../../src/runtime/orchestrator/outcome-effects.js';
import { replaySimulation } from '../../src/runtime/orchestrator/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = loadDiskCustomScenarios(resolve(here, '../../scenarios'));
const scenario = (id: string) => {
  const sc = catalog.get(id)?.scenario as ScenarioPackage | undefined;
  assert.ok(sc, `scenarios/ holds ${id}`);
  return sc;
};
const atlasLab = scenario('atlas-lab');
const submarine = scenario('deep-ocean-station');

/** Every run has people and morale, declared or not. */
const EVERY_RUN = ['population', 'morale'];

function declaredMetricKeys(sc: ScenarioPackage): Set<string> {
  const world = sc.world as { metrics?: Record<string, unknown>; capacities?: Record<string, unknown> };
  return new Set([...EVERY_RUN, ...Object.keys(world.metrics ?? {}), ...Object.keys(world.capacities ?? {})]);
}

function declaredPoliticsKeys(sc: ScenarioPackage): Set<string> {
  const world = sc.world as { politics?: Record<string, unknown>; statuses?: Record<string, unknown> };
  return new Set([...Object.keys(world.politics ?? {}), ...Object.keys(world.statuses ?? {})]);
}

function undeclared(values: Record<string, unknown>, declared: Set<string>): string[] {
  return Object.keys(values).filter(k => !declared.has(k)).sort();
}

function notFinite(values: Record<string, unknown>): string[] {
  return Object.entries(values).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k);
}

function kernelFor(sc: ScenarioPackage, population = 30): SimulationKernel {
  return new SimulationKernel(sc.setup.defaultSeed ?? 11, 'Marcus Reinhardt', [], {
    startTime: sc.setup.defaultStartTime ?? 1,
    initialPopulation: population,
    scenario: sc,
  });
}

/** A turn that forged two tools and lost three to the judge: the forge costs apply. */
const FORGING: OutcomeModifiers = {
  personalityBonus: 0.1,
  noise: 0,
  toolModifiers: { newToolsThisEvent: 2, reuseCountThisEvent: 1, forgeFailures: 3, totalToolsForRun: 4 },
};

const OUTCOMES: TurnOutcome[] = ['risky_success', 'risky_failure', 'conservative_success', 'conservative_failure'];

function registryFor(sc: ScenarioPackage): EffectRegistry {
  return new EffectRegistry(sc.effects[0]?.categoryDefaults ?? {});
}

test('an Atlas Lab run starts and stays on the metrics and politics atlas-lab.json declares', () => {
  const kernel = kernelFor(atlasLab, 480);
  const metrics = declaredMetricKeys(atlasLab);
  const politics = declaredPoliticsKeys(atlasLab);

  let state = kernel.getState();
  assert.deepEqual(undeclared(state.metrics, metrics), [], 'starting metrics');
  assert.deepEqual(undeclared(state.politics, politics), [], 'starting politics');
  assert.equal(state.metrics.population, 480);

  for (let turn = 2; turn <= 4; turn++) {
    state = kernel.advanceTurn(turn, turn, atlasLab.hooks.progressionHook);
    assert.deepEqual(undeclared(state.metrics, metrics), [], `metrics after turn ${turn}`);
    assert.deepEqual(undeclared(state.politics, politics), [], `politics after turn ${turn}`);
    assert.deepEqual(notFinite(state.metrics), [], `finite metrics after turn ${turn}`);
    assert.deepEqual(notFinite(state.politics), [], `finite politics after turn ${turn}`);
  }
});

test('an Atlas Lab outcome reports and applies only metrics the run carries, forge costs included', () => {
  const registry = registryFor(atlasLab);
  const categories = [...Object.keys(atlasLab.effects[0]?.categoryDefaults ?? {}), 'an_unmapped_category'];
  assert.ok(categories.includes('press') && categories.includes('alignment'), `categories: ${categories.join(', ')}`);

  for (const category of categories) {
    for (const outcome of OUTCOMES) {
      const kernel = kernelFor(atlasLab);
      const carried = Object.keys(kernel.getState().metrics);
      const { systemDeltas: reported } = applyOutcomeEffects(kernel, registry, { category, outcome, modifiers: FORGING, turn: 1, time: 1 });
      const after = kernel.getState();

      assert.deepEqual(undeclared(reported, declaredMetricKeys(atlasLab)), [], `${category} ${outcome} reported ${JSON.stringify(reported)}`);
      // What the run reports is what it applied: a politics key in the
      // category table (boardConfidence) is not a metric.
      assert.deepEqual(Object.keys(reported).filter(k => !carried.includes(k)), [], `${category} ${outcome} reported ${JSON.stringify(reported)}`);
      assert.deepEqual(undeclared(after.metrics, declaredMetricKeys(atlasLab)), [], `${category} ${outcome} state`);
      assert.deepEqual(notFinite(after.metrics), [], `${category} ${outcome} finite`);
      const logged = after.eventLog.at(-1)?.description ?? '';
      assert.doesNotMatch(logged, /powerKw/, `${category} ${outcome} event log: ${logged}`);
    }
  }
});

test('the Atlas Lab roster snapshot the stream sends carries no food reserve and passes the stream schema', () => {
  const kernel = kernelFor(atlasLab);
  const state = kernel.advanceTurn(2, 2, atlasLab.hooks.progressionHook);
  const event = StreamEventSchema.parse({
    type: 'systems_snapshot',
    leader: 'Marcus Reinhardt',
    turn: 2,
    time: 2,
    data: { turn: 2, time: 2, agents: [], ...systemsSnapshotTotals(state.metrics), births: 0, deaths: 0 },
  });
  assert.equal(event.type, 'systems_snapshot');
  assert.ok(!('foodReserve' in event.data), `snapshot data ${JSON.stringify(event.data)}`);
  assert.equal(event.data.population, state.metrics.population);
});

test('Mars, the Moon and the deep-ocean station keep every metric they declare, power and food included', () => {
  for (const sc of [marsScenario, lunarScenario, submarine]) {
    const kernel = kernelFor(sc, 50);
    const declared = [...declaredMetricKeys(sc)];
    const start = kernel.getState();
    assert.deepEqual(declared.filter(k => typeof start.metrics[k] !== 'number').sort(), [], `${sc.id} starting metrics`);
    assert.deepEqual(undeclared(start.metrics, declaredMetricKeys(sc)), [], `${sc.id} carries nothing it does not declare`);
    assert.ok(typeof start.metrics.powerKw === 'number' && typeof start.metrics.foodMonthsReserve === 'number', sc.id);

    const before = start.metrics.powerKw;
    const { systemDeltas: reported } = applyOutcomeEffects(kernel, registryFor(sc), {
      category: 'psychological', outcome: 'conservative_success', modifiers: FORGING, turn: 1, time: start.metadata.currentTime,
    });
    // Two new tools and three failures: 5 forges at 1.2 kW each.
    assert.equal(reported.powerKw, -6, `${sc.id} reported ${JSON.stringify(reported)}`);
    assert.equal(Math.round((kernel.getState().metrics.powerKw - before) * 100) / 100, -6, `${sc.id} power applied`);

    const state = kernel.advanceTurn(2, start.metadata.currentTime + 1, sc.hooks.progressionHook);
    assert.equal(systemsSnapshotTotals(state.metrics).foodReserve, state.metrics.foodMonthsReserve, `${sc.id} snapshot food`);
    assert.deepEqual(notFinite(state.metrics), [], `${sc.id} finite`);
  }
  // Mars keeps its Earth politics and its governance status.
  const mars = kernelFor(marsScenario, 50).getState();
  assert.equal(mars.politics.earthDependencyPct, 95);
  assert.equal(mars.politics.governanceStatus, 'earth-governed');
  assert.equal(typeof mars.politics.independencePressure, 'number');
});

test('a run with no scenario keeps the Mars defaults it has always had', () => {
  const state = new SimulationKernel(950, 'x', [], { startTime: 2035, initialPopulation: 100 }).getState();
  assert.deepEqual(Object.keys(state.metrics), [
    'population', 'powerKw', 'foodMonthsReserve', 'waterLitersPerDay', 'pressurizedVolumeM3',
    'lifeSupportCapacity', 'infrastructureModules', 'scienceOutput', 'morale',
  ]);
  assert.deepEqual(Object.keys(state.politics), ['earthDependencyPct', 'governanceStatus', 'independencePressure']);
});

test('an Atlas Lab run saved with the Mars defaults still loads, forks and replays', async () => {
  // Trimmed from run_11b08c71 on paracosm.agentos.sh, 2 Nov 2026 05:50 UTC:
  // its first decision, its final state and its first two kernel snapshots.
  const saved = JSON.parse(readFileSync(resolve(here, '../fixtures/atlas-lab-run-2026-11-02.json'), 'utf-8'));
  const artifact = RunArtifactSchema.parse(saved);
  assert.equal(artifact.finalState?.metrics.powerKw, 392.8);

  const snaps = (artifact.scenarioExtensions as { kernelSnapshotsPerTurn: KernelSnapshot[] }).kernelSnapshotsPerTurn;
  const savedPower = snaps[0].state.metrics.powerKw;
  assert.equal(savedPower, 396.4, 'turn 1 charged the forge cost to power');

  const fork = SimulationKernel.fromSnapshot(snaps[0], atlasLab.id);
  const state = fork.advanceTurn(2, 2, atlasLab.hooks.progressionHook);
  assert.equal(state.metrics.powerKw, savedPower, 'the saved run keeps the power it carried');
  assert.equal(typeof state.metrics.foodMonthsReserve, 'number');
  assert.deepEqual(notFinite(state.metrics), []);

  const replayed = await replaySimulation(atlasLab, artifact);
  const fresh = (replayed.scenarioExtensions as { kernelSnapshotsPerTurn: KernelSnapshot[] }).kernelSnapshotsPerTurn;
  assert.equal(fresh.length, 2);
  assert.equal(fresh[1].state.metrics.powerKw, savedPower);
  assert.deepEqual(notFinite(fresh[1].state.metrics), []);
});

test('an outcome reports the change the floor and the ceiling let through', () => {
  // Morale 0.95 and a lift of 0.1 at the risky-success multiplier (2.5)
  // asks for +0.25; morale stops at 1, so the run moved it by 0.05.
  const lab = new SimulationKernel(11, 'Marcus Reinhardt', [], {
    startTime: 1, initialPopulation: 30, scenario: atlasLab, startingResources: { morale: 0.95 },
  });
  const { systemDeltas: lift } = applyOutcomeEffects(lab, new EffectRegistry({ lift: { morale: 0.1 } }), {
    category: 'lift', outcome: 'risky_success', modifiers: { personalityBonus: 0, noise: 0 }, turn: 1, time: 1,
  });
  assert.equal(lab.getState().metrics.morale, 1);
  assert.deepEqual(lift, { morale: 0.05 });
  assert.match(lab.getState().eventLog.at(-1)?.description ?? '', /morale \+0\.05$/);

  // 3 kW left and five forges at 1.2 kW each: power stops at 0, a change of -3.
  const mars = new SimulationKernel(950, 'x', [], {
    startTime: 2035, initialPopulation: 50, scenario: marsScenario, startingResources: { powerKw: 3 },
  });
  const { systemDeltas: forged } = applyOutcomeEffects(mars, registryFor(marsScenario), {
    category: 'psychological', outcome: 'conservative_success', modifiers: FORGING, turn: 1, time: 2035,
  });
  assert.equal(mars.getState().metrics.powerKw, 0);
  assert.equal(forged.powerKw, -3, JSON.stringify(forged));
});
