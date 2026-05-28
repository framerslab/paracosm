/**
 * Tests for the `session_id` column on the runs table and the
 * `linkSessionId` backfill method. The server-app save pipeline calls
 * `linkSessionId` after autoSaveOnComplete returns a fresh sessionId
 * for the broadcast; these tests verify the store layer's contract in
 * isolation from that pipeline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteRunHistoryStore } from './sqlite-run-history.js';
import { createRunRecord } from '../services/run-record.js';

function baseRun(overrides: Record<string, unknown> = {}): ReturnType<typeof createRunRecord> {
  return createRunRecord({
    scenarioId: 'mars-genesis',
    scenarioVersion: '1.0.0',
    actorConfigHash: 'h',
    economicsProfile: 'demo',
    sourceMode: 'hosted_demo',
    createdBy: 'anonymous',
    ...overrides,
  });
}

test('insert + getRun round-trips sessionId when set on insert', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = baseRun({ sessionId: 'sess_abc123' });
  await store.insertRun(run);
  const out = await store.getRun(run.runId);
  assert.equal(out?.sessionId, 'sess_abc123');
});

test('insert without sessionId leaves the field undefined on read', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = baseRun();
  await store.insertRun(run);
  const out = await store.getRun(run.runId);
  assert.equal(out?.sessionId, undefined);
});

test('linkSessionId backfills sessionId on a previously-inserted row', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = baseRun();
  await store.insertRun(run);
  await store.linkSessionId!([run.runId], 'sess_backfilled');
  const out = await store.getRun(run.runId);
  assert.equal(out?.sessionId, 'sess_backfilled');
});

test('linkSessionId updates every runId in the input list with the same sessionId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const a = baseRun({ actorName: 'Voss' });
  const b = baseRun({ actorName: 'Chen' });
  const c = baseRun({ actorName: 'Park' });
  await store.insertRun(a);
  await store.insertRun(b);
  await store.insertRun(c);
  await store.linkSessionId!([a.runId, b.runId, c.runId], 'sess_shared');
  const got = await Promise.all([store.getRun(a.runId), store.getRun(b.runId), store.getRun(c.runId)]);
  assert.deepEqual(got.map(r => r?.sessionId), ['sess_shared', 'sess_shared', 'sess_shared']);
});

test('linkSessionId is a no-op for empty input — does not throw, does not touch other rows', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = baseRun({ sessionId: 'sess_preexisting' });
  await store.insertRun(run);
  await store.linkSessionId!([], 'sess_should_not_apply');
  const out = await store.getRun(run.runId);
  assert.equal(out?.sessionId, 'sess_preexisting');
});

test('linkSessionId for unknown runIds is silently dropped — no exception, no side effects', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = baseRun();
  await store.insertRun(run);
  await store.linkSessionId!(['run_does_not_exist'], 'sess_x');
  const out = await store.getRun(run.runId);
  assert.equal(out?.sessionId, undefined);
});

test('linkSessionId overwrites an existing sessionId — idempotent for the broadcast retry case', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = baseRun({ sessionId: 'sess_first_attempt' });
  await store.insertRun(run);
  await store.linkSessionId!([run.runId], 'sess_second_attempt');
  const out = await store.getRun(run.runId);
  assert.equal(out?.sessionId, 'sess_second_attempt');
});

test('listRuns surfaces sessionId on every row after linkSessionId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const a = baseRun({ actorName: 'A' });
  const b = baseRun({ actorName: 'B' });
  await store.insertRun(a);
  await store.insertRun(b);
  await store.linkSessionId!([a.runId, b.runId], 'sess_listed');
  const out = await store.listRuns();
  // Newest-first ordering; both rows carry the same sessionId.
  assert.equal(out.length, 2);
  assert.ok(out.every(r => r.sessionId === 'sess_listed'));
});
