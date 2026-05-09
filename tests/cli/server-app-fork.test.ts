/**
 * Tests for the `/setup` POST fork-dispatch path (Spec 2B).
 *
 * Full HTTP-handler integration tests (multi-leader reject,
 * cross-scenario reject, missing-snapshots reject, active-run 409)
 * require spinning up the Node server + its AgentOS / runSimulation
 * imports. This unit-test layer covers the two pieces that sit
 * BELOW the handler:
 *
 * 1. `normalizeSimulationConfig` passes forkFrom + captureSnapshots
 *    through verbatim into the NormalizedSimulationConfig that
 *    `/setup` hands to `startWithConfig`.
 * 2. The fakeParentArtifact harness mirrors the structural
 *    preconditions the server checks: scenario id in metadata + an
 *    embedded kernelSnapshotsPerTurn array in scenarioExtensions.
 *
 * Spec 2A's existing `WorldModel.forkFromArtifact` tests cover the
 * same validation paths at the façade layer, so redundant
 * guardrails catch errors at two levels without duplicating the
 * runtime-heavy spin-up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSimulationConfig } from '../../src/cli/sim-config.js';
import { validateForkSetupPreconditions } from '../../src/server/fork-preconditions.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { lunarScenario } from '../../src/engine/scenarios/index.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';

function fakeParentArtifact(overrides: {
  scenarioId?: string;
  snapshotTurn?: number;
  withSnapshots?: boolean;
} = {}): RunArtifact {
  const { scenarioId = marsScenario.id, snapshotTurn = 1, withSnapshots = true } = overrides;
  return {
    metadata: {
      runId: 'parent-1',
      scenario: { id: scenarioId, name: 'Parent Run' },
      mode: 'turn-loop',
      startedAt: '2026-04-24T00:00:00.000Z',
    },
    scenarioExtensions: withSnapshots
      ? {
          kernelSnapshotsPerTurn: [
            {
              snapshotVersion: 1,
              scenarioId,
              turn: snapshotTurn,
              time: 1,
              state: {} as never,
              rngState: 0,
              startTime: 0,
              seed: 42,
            },
          ],
        }
      : {},
  } as unknown as RunArtifact;
}

function fakeLeader(name = 'Forked Leader') {
  return {
    name,
    archetype: 'Fork Test',
    unit: 'Test',
    hexaco: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      emotionality: 0.5,
      honestyHumility: 0.5,
    },
    instructions: '',
  };
}

test('normalizeSimulationConfig: passes forkFrom through verbatim', () => {
  const parent = fakeParentArtifact();
  const normalized = normalizeSimulationConfig({
    actors: [fakeLeader()],
    turns: 3,
    seed: 42,
    forkFrom: { parentArtifact: parent, atTurn: 1 },
    captureSnapshots: true,
  } as never);
  assert.deepEqual(normalized.forkFrom, { parentArtifact: parent, atTurn: 1 });
  assert.equal(normalized.captureSnapshots, true);
});

test('normalizeSimulationConfig: captureSnapshots defaults to false when absent', () => {
  const normalized = normalizeSimulationConfig({
    actors: [fakeLeader(), fakeLeader('B')],
    turns: 3,
    seed: 42,
  } as never);
  assert.equal(normalized.captureSnapshots, false);
  assert.equal(normalized.forkFrom, undefined);
});

test('normalizeSimulationConfig: forkFrom omitted when not supplied', () => {
  const normalized = normalizeSimulationConfig({
    actors: [fakeLeader(), fakeLeader('B')],
    turns: 3,
    seed: 42,
  } as never);
  assert.equal(normalized.forkFrom, undefined);
});

test('fakeParentArtifact harness: withSnapshots=true produces embedded kernelSnapshotsPerTurn', () => {
  const a = fakeParentArtifact({ withSnapshots: true });
  const snaps = (a.scenarioExtensions as { kernelSnapshotsPerTurn?: unknown[] } | undefined)
    ?.kernelSnapshotsPerTurn;
  assert.ok(Array.isArray(snaps));
  assert.equal(snaps!.length, 1);
});

test('fakeParentArtifact harness: withSnapshots=false produces empty scenarioExtensions', () => {
  const a = fakeParentArtifact({ withSnapshots: false });
  assert.deepEqual(a.scenarioExtensions, {});
});

test('fakeParentArtifact harness: scenarioId override flows through metadata + snapshot', () => {
  const a = fakeParentArtifact({ scenarioId: lunarScenario.id });
  assert.equal(a.metadata.scenario.id, lunarScenario.id);
  const snap = (a.scenarioExtensions as { kernelSnapshotsPerTurn?: Array<{ scenarioId: string }> } | undefined)
    ?.kernelSnapshotsPerTurn?.[0];
  assert.equal(snap?.scenarioId, lunarScenario.id);
});

test('validateForkSetupPreconditions: accepts valid parent artifact and requested snapshot', () => {
  const parent = fakeParentArtifact({ snapshotTurn: 3 });
  const result = validateForkSetupPreconditions({
    parentArtifact: parent,
    atTurn: 3,
    activeScenarioId: marsScenario.id,
    activeRunInProgress: false,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.parentArtifact.metadata : undefined, parent.metadata);
});

test('validateForkSetupPreconditions: rejects invalid parent artifact schema', () => {
  const result = validateForkSetupPreconditions({
    parentArtifact: { scenarioExtensions: {} },
    atTurn: 1,
    activeScenarioId: marsScenario.id,
    activeRunInProgress: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.statusCode, 400);
  assert.match(result.ok ? '' : result.error, /valid RunArtifact/);
});

test('validateForkSetupPreconditions: rejects cross-scenario parent artifact', () => {
  const result = validateForkSetupPreconditions({
    parentArtifact: fakeParentArtifact({ scenarioId: lunarScenario.id }),
    atTurn: 1,
    activeScenarioId: marsScenario.id,
    activeRunInProgress: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.statusCode, 400);
  assert.match(result.ok ? '' : result.error, /Cross-scenario forks/);
});

test('validateForkSetupPreconditions: rejects parent artifact without snapshots', () => {
  const result = validateForkSetupPreconditions({
    parentArtifact: fakeParentArtifact({ withSnapshots: false }),
    atTurn: 1,
    activeScenarioId: marsScenario.id,
    activeRunInProgress: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.statusCode, 400);
  assert.match(result.ok ? '' : result.error, /no embedded kernel snapshots/);
});

test('validateForkSetupPreconditions: rejects parent without requested snapshot turn', () => {
  const result = validateForkSetupPreconditions({
    parentArtifact: fakeParentArtifact({ snapshotTurn: 2 }),
    atTurn: 3,
    activeScenarioId: marsScenario.id,
    activeRunInProgress: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.statusCode, 400);
  assert.match(result.ok ? '' : result.error, /no kernel snapshot for turn 3/);
});

test('validateForkSetupPreconditions: rejects fork while active run is in progress', () => {
  const result = validateForkSetupPreconditions({
    parentArtifact: fakeParentArtifact({ snapshotTurn: 1 }),
    atTurn: 1,
    activeScenarioId: marsScenario.id,
    activeRunInProgress: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.statusCode, 409);
});
