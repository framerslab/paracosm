import test from 'node:test';
import assert from 'node:assert/strict';

import { branchesReducer, type BranchesState } from './BranchesContext';
import type { RunArtifact } from '../../../../engine/schema/index.js';

function forkArtifact(atTurn: number, branchTurns: number): RunArtifact {
  return {
    metadata: {
      runId: 'branch-1',
      scenario: { id: 'mars-genesis', name: 'Mars Genesis' },
      mode: 'turn-loop',
      startedAt: '2026-04-24T00:00:00.000Z',
      forkedFrom: { parentRunId: 'parent-1', atTurn },
    },
    trajectory: {
      timeUnit: { singular: 'turn', plural: 'turns' },
      timepoints: Array.from({ length: branchTurns }, (_, i) => ({
        time: atTurn + i + 1,
        label: `Turn ${atTurn + i + 1}`,
      })),
    },
  } as RunArtifact;
}

test('branchesReducer: branch completion reports absolute final turn after fork point', () => {
  const state: BranchesState = {
    branches: [{
      localId: 'local-1',
      forkedAtTurn: 3,
      actorName: 'Branch Leader',
      actorArchetype: 'Test',
      status: 'running',
      currentTurn: 3,
    }],
  };

  const next = branchesReducer(state, {
    type: 'BRANCH_COMPLETE',
    localId: 'local-1',
    artifact: forkArtifact(3, 3),
  });

  assert.equal(next.branches[0].status, 'complete');
  assert.equal(next.branches[0].currentTurn, 6);
});

test('reducer: SET_PARENT replaces current parent and clears branches', () => {
  const firstArtifact = { metadata: { runId: 'r1', scenario: { id: 's', name: 'S' }, mode: 'turn-loop', startedAt: '' }, finalState: {} } as unknown as Parameters<typeof branchesReducer>[1] extends { artifact: infer A } ? A : never;
  const secondArtifact = { metadata: { runId: 'r2', scenario: { id: 's', name: 'S' }, mode: 'turn-loop', startedAt: '' }, finalState: {} } as unknown as typeof firstArtifact;
  const starting = {
    parent: firstArtifact,
    branches: [{ localId: 'b1', forkedAtTurn: 3, actorName: 'X', actorArchetype: 'A', status: 'complete' as const, currentTurn: 6 }],
  };
  const next = branchesReducer(starting, { type: 'SET_PARENT', artifact: secondArtifact });
  assert.equal(next.parent, secondArtifact);
  assert.deepEqual(next.branches, []);
});
