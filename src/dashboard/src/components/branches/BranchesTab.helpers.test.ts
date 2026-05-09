/**
 * Unit tests for BranchesTab.helpers (Tier 2 Spec 2B).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeBranchDeltas, formatDelta, type BranchDelta } from './BranchesTab.helpers.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

function artifact(finalState: RunArtifact['finalState']): RunArtifact {
  return {
    metadata: {
      runId: 'r',
      scenario: { id: 's', name: 'S' },
      mode: 'turn-loop',
      startedAt: '2026-04-24T00:00:00.000Z',
    },
    finalState,
  } as unknown as RunArtifact;
}

test('computeBranchDeltas: numeric metric divergence yields up/down with magnitude sort', () => {
  const parent = artifact({ metrics: { population: 100, morale: 0.7 } } as never);
  const branch = artifact({ metrics: { population: 112, morale: 0.62 } } as never);
  const deltas = computeBranchDeltas(parent, branch);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[0].key, 'population');
  assert.equal(deltas[0].direction, 'up');
  assert.equal(deltas[0].delta, 12);
  assert.equal(deltas[1].key, 'morale');
  assert.equal(deltas[1].direction, 'down');
  assert.ok(deltas[1].delta !== undefined && deltas[1].delta < 0);
});

test('computeBranchDeltas: string status change produces direction=changed, delta undefined', () => {
  const parent = artifact({ statuses: { fundingRound: 'seed' } } as never);
  const branch = artifact({ statuses: { fundingRound: 'series-a' } } as never);
  const deltas = computeBranchDeltas(parent, branch);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].bag, 'statuses');
  assert.equal(deltas[0].direction, 'changed');
  assert.equal(deltas[0].delta, undefined);
});

test('computeBranchDeltas: capacity divergence is included', () => {
  const parent = artifact({ capacities: { housing: 100 } } as never);
  const branch = artifact({ capacities: { housing: 125 } } as never);
  const deltas = computeBranchDeltas(parent, branch);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].bag, 'capacities');
  assert.equal(deltas[0].key, 'housing');
  assert.equal(deltas[0].delta, 25);
});

test('computeBranchDeltas: identical keys omitted', () => {
  const parent = artifact({ metrics: { population: 100, morale: 0.7 } } as never);
  const branch = artifact({ metrics: { population: 100, morale: 0.7 } } as never);
  const deltas = computeBranchDeltas(parent, branch);
  assert.deepEqual(deltas, []);
});

test('computeBranchDeltas: keys present in only one side are skipped', () => {
  const parent = artifact({ metrics: { onlyInParent: 5, shared: 10 } } as never);
  const branch = artifact({ metrics: { shared: 12 } } as never);
  const deltas = computeBranchDeltas(parent, branch);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].key, 'shared');
});

test('computeBranchDeltas: numerics sorted before non-numerics regardless of bag order', () => {
  const parent = artifact({
    metrics: { population: 100 },
    statuses: { phase: 'alpha' },
  } as never);
  const branch = artifact({
    metrics: { population: 102 },
    statuses: { phase: 'beta' },
  } as never);
  const deltas = computeBranchDeltas(parent, branch);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[0].delta, 2);
  assert.equal(deltas[1].direction, 'changed');
});

test('computeBranchDeltas: missing finalState on either side returns empty', () => {
  const parent = { metadata: { runId: 'r', scenario: { id: 's', name: 'S' }, mode: 'turn-loop', startedAt: '' } } as unknown as RunArtifact;
  const branch = artifact({ metrics: { population: 100 } } as never);
  assert.deepEqual(computeBranchDeltas(parent, branch), []);
});

test('formatDelta: numeric value renders with sign', () => {
  const d: BranchDelta = {
    bag: 'metrics',
    key: 'population',
    parentValue: 100,
    branchValue: 112,
    delta: 12,
    direction: 'up',
  };
  assert.equal(formatDelta(d), 'population +12');
});

test('formatDelta: non-numeric value renders key: parent → branch', () => {
  const d: BranchDelta = {
    bag: 'statuses',
    key: 'fundingRound',
    parentValue: 'seed',
    branchValue: 'series-a',
    direction: 'changed',
  };
  assert.equal(formatDelta(d), 'fundingRound: seed → series-a');
});
