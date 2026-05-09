import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteRunHistoryStore } from './sqlite-run-history.js';
import { createRunRecord } from '../services/run-record.js';

test('listRunsByBundleId returns only members of the requested bundle', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const bundleA = '11111111-1111-4111-8111-111111111111';
  const bundleB = '22222222-2222-4222-8222-222222222222';
  await store.insertRun(createRunRecord({
    scenarioId: 'mars-genesis', scenarioVersion: '1.0.0', actorConfigHash: 'h1',
    economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
    bundleId: bundleA, actorName: 'Voss',
  }));
  await store.insertRun(createRunRecord({
    scenarioId: 'mars-genesis', scenarioVersion: '1.0.0', actorConfigHash: 'h2',
    economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
    bundleId: bundleA, actorName: 'Chen',
  }));
  await store.insertRun(createRunRecord({
    scenarioId: 'mars-genesis', scenarioVersion: '1.0.0', actorConfigHash: 'h3',
    economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
    bundleId: bundleB, actorName: 'Park',
  }));
  const a = await store.listRunsByBundleId!(bundleA);
  assert.equal(a.length, 2);
  assert.deepEqual(a.map(r => r.actorName).sort(), ['Chen', 'Voss']);
  const b = await store.listRunsByBundleId!(bundleB);
  assert.equal(b.length, 1);
  assert.equal(b[0].actorName, 'Park');
});

test('listRunsByBundleId returns [] for unknown bundleId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const out = await store.listRunsByBundleId!('00000000-0000-4000-8000-000000000000');
  assert.equal(out.length, 0);
});

test('insert + listRunsByBundleId round-trips summaryTrajectory', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const bundleId = '33333333-3333-4333-8333-333333333333';
  await store.insertRun(createRunRecord({
    scenarioId: 's', scenarioVersion: '1', actorConfigHash: 'h',
    economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
    bundleId, summaryTrajectory: [1, 2, 3, 4, 5, 6, 7, 8],
  }));
  const out = await store.listRunsByBundleId!(bundleId);
  assert.deepEqual(out[0].summaryTrajectory, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('listRuns honors bundleId filter (parity with the dedicated method)', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const bundleId = '44444444-4444-4444-8444-444444444444';
  await store.insertRun(createRunRecord({
    scenarioId: 's', scenarioVersion: '1', actorConfigHash: 'h1',
    economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
    bundleId, actorName: 'A',
  }));
  await store.insertRun(createRunRecord({
    scenarioId: 's', scenarioVersion: '1', actorConfigHash: 'h2',
    economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
    actorName: 'B', // no bundleId
  }));
  const filtered = await store.listRuns({ bundleId });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].actorName, 'A');
});
