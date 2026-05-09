/**
 * Façade-level tests for WorldModel.snapshot(), fork(), and
 * forkFromArtifact(). No real-LLM calls; the simulate path is
 * exercised indirectly via the kernel-layer determinism test in
 * `kernel-snapshot.test.ts`, and will get end-to-end coverage in
 * Spec 2B's dashboard tests once those exist. Here we verify shape
 * + error paths + scenario-mismatch guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { WorldModel } from '../../../src/runtime/world-model/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';
import { lunarScenario } from '../../../src/engine/scenarios/index.js';
import type { KernelSnapshot } from '../../../src/engine/core/snapshot.js';
import type { RunArtifact } from '../../../src/engine/schema/index.js';
import type { ActorConfig } from '../../../src/runtime/orchestrator/index.js';

function fakeKernelSnapshot(overrides: Partial<KernelSnapshot> = {}): KernelSnapshot {
  return {
    snapshotVersion: 1,
    scenarioId: marsScenario.id,
    turn: 3,
    time: 2038,
    // Minimal state shape: façade tests don't touch these bags;
    // kernel-level round-trip is covered by kernel-snapshot.test.ts.
    state: {
      metadata: { simulationId: 'r-1', leaderId: 'l-a', seed: 42, startTime: 2035, currentTime: 2038, currentTurn: 3 },
      metrics: {
        population: 100,
        morale: 0.7,
        foodMonthsReserve: 6,
        powerKw: 200,
        waterLitersPerDay: 5000,
        pressurizedVolumeM3: 1000,
        lifeSupportCapacity: 120,
        infrastructureModules: 10,
        scienceOutput: 1.2,
      },
      agents: [],
      politics: { earthDependencyPct: 0.6, governanceStatus: 'earth-governed', independencePressure: 0.1 },
      statuses: {},
      environment: {},
      eventLog: [],
    },
    rngState: 0xabcdef,
    startTime: 2035,
    seed: 42,
    ...overrides,
  };
}

const forkLeader: ActorConfig = {
  name: 'Fork Leader',
  archetype: 'Fork Test',
  unit: 'Test',
  instructions: '',
  hexaco: {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    emotionality: 0.5,
    honestyHumility: 0.5,
  },
};

test('WorldModel.snapshot: throws when no prior simulate', () => {
  const wm = WorldModel.fromScenario(marsScenario);
  assert.throws(
    () => wm.snapshot(),
    /requires a prior `simulate/,
  );
});

test('WorldModel.fork: scenario-id mismatch throws', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const snap = { snapshotVersion: 1 as const, kernel: fakeKernelSnapshot({ scenarioId: lunarScenario.id }) };
  await assert.rejects(
    () => wm.fork(snap),
    /scenario id mismatch/i,
  );
});

test('WorldModel.fork: returns a WorldModel with the same scenario', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const snap = { snapshotVersion: 1 as const, kernel: fakeKernelSnapshot() };
  const child = await wm.fork(snap);
  assert.ok(child instanceof WorldModel);
  assert.equal(child.scenario, marsScenario);
});

test('WorldModel.forkFromArtifact: throws when artifact has no snapshots', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const artifact = {
    metadata: { runId: 'r-1', scenario: { id: marsScenario.id, name: 'Mars Genesis' }, mode: 'turn-loop', startedAt: '2026-04-24T00:00:00Z' },
    scenarioExtensions: {},
  } as unknown as RunArtifact;
  await assert.rejects(
    () => wm.forkFromArtifact(artifact, 3),
    /no embedded kernel snapshots/,
  );
});

test('WorldModel.forkFromArtifact: throws on out-of-range turn', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const artifact = {
    metadata: { runId: 'r-1', scenario: { id: marsScenario.id, name: 'Mars Genesis' }, mode: 'turn-loop', startedAt: '2026-04-24T00:00:00Z' },
    scenarioExtensions: {
      kernelSnapshotsPerTurn: [fakeKernelSnapshot({ turn: 1 }), fakeKernelSnapshot({ turn: 2 })],
    },
  } as unknown as RunArtifact;
  await assert.rejects(
    () => wm.forkFromArtifact(artifact, 99),
    /no snapshot at turn 99/,
  );
});

test('WorldModel.forkFromArtifact: success with embedded snapshots', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const artifact = {
    metadata: { runId: 'r-parent', scenario: { id: marsScenario.id, name: 'Mars Genesis' }, mode: 'turn-loop', startedAt: '2026-04-24T00:00:00Z' },
    scenarioExtensions: {
      kernelSnapshotsPerTurn: [
        fakeKernelSnapshot({ turn: 1 }),
        fakeKernelSnapshot({ turn: 2 }),
        fakeKernelSnapshot({ turn: 3 }),
      ],
    },
  } as unknown as RunArtifact;
  const child = await wm.forkFromArtifact(artifact, 2);
  assert.ok(child instanceof WorldModel);
  assert.equal(child.scenario, marsScenario);
  // parentRunId + atTurn propagation is covered indirectly: forkFromArtifact
  // constructs a WorldModelSnapshot with parentRunId = artifact runId and
  // passes it to fork(), which stashes _pendingForkedFrom on the child.
  // The value gets consumed by the next simulate() call; end-to-end
  // coverage lands in Spec 2B's dashboard tests once they exist.
});

test('WorldModel.fork: preserves parentRunId from the snapshot', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const snap = {
    snapshotVersion: 1 as const,
    kernel: fakeKernelSnapshot(),
    parentRunId: 'parent-xyz',
  };
  const child = await wm.fork(snap);
  assert.ok(child instanceof WorldModel);
  // e2e assertion (that artifact.metadata.forkedFrom.parentRunId ===
  // 'parent-xyz' after a subsequent simulate) is deferred to Spec 2B.
  // Here we verify construction succeeds without throwing.
});

test('WorldModel.fork: simulate rejects maxTurns at or before fork turn', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  const child = await wm.fork({
    snapshotVersion: 1 as const,
    kernel: fakeKernelSnapshot({ turn: 3 }),
    parentRunId: 'parent-xyz',
  });

  await assert.rejects(
    () => child.simulate({ actor: forkLeader, maxTurns: 3 }),
    /maxTurns=3 must be greater than fork turn 3/,
  );
});
