import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';

test('noop run history store is queryable without affecting replay storage', async () => {
  const store = createNoopRunHistoryStore();
  await store.insertRun({
    runId: 'run_test',
    createdAt: new Date().toISOString(),
    scenarioId: 'mars-genesis',
    scenarioVersion: '0.4.88',
    actorConfigHash: 'leaders:test',
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
  });

  const runs = await store.listRuns();
  assert.deepEqual(runs, []);
});
