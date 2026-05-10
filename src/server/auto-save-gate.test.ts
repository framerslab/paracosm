/**
 * Cache-invariant regression tests.
 *
 * The contract: `paracosm.agentos.sh/sessions` (and its replay surface)
 * must only ever expose runs that played to completion. The gating
 * itself lives in `server-app.ts` (`autoSaveOnComplete`, lines ~790-872):
 * `currentRunAborted`, `currentRunErrored`, `eventBuffer.length === 0`,
 * `turnDoneCount < AUTO_SAVE_MIN_TURNS`, and `turnDoneCount <
 * expectedTurnDone` all short-circuit before `saveSession` is called.
 *
 * The store itself does NOT re-validate the gate — performance + design
 * separation. These tests pin the store contract (eviction, save +
 * reload symmetry) AND document the gating responsibility so a future
 * refactor that moves the gate elsewhere either updates this file or
 * surfaces in code review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSessionStore, type TimestampedEvent } from './stores/session.js';

const completeRun = (scenarioId: string, turnCount: number = 2): TimestampedEvent[] => {
  // `deriveMetadata` reads scenarioId/scenarioName from `event: active_scenario`,
  // and turn counts from `event: sim` frames carrying `{type: "turn_done"}`.
  const out: TimestampedEvent[] = [
    { ts: 1, sse: `event: active_scenario\ndata: {"id":"${scenarioId}","name":"Test"}\n\n` },
  ];
  for (let i = 1; i <= turnCount; i++) {
    out.push({ ts: 1 + i, sse: `event: sim\ndata: {"type":"turn_done","actor":"a","turn":${i}}\n\n` });
  }
  out.push({ ts: 100, sse: 'event: complete\ndata: {}\n\n' });
  return out;
};

test('saveSession persists a complete run and getSession round-trips it', async () => {
  const store = openSessionStore(':memory:', 5, { databaseOptions: { type: 'memory' } });
  const events = completeRun('mars-genesis', 3);
  const { id } = await store.saveSession(events);
  assert.ok(id, 'saveSession returns an id');
  const reloaded = await store.getSession(id);
  assert.equal(reloaded?.events.length, events.length);
  assert.equal(reloaded?.meta.scenarioId, 'mars-genesis');
  await store.close();
});

test('store does not re-validate the auto-save gate — that responsibility lives in server-app.ts', async () => {
  // If a future refactor moves the gate INTO the store, this test
  // should be flipped to assert that an errored event stream cannot
  // reach the persistence layer at all. Until then, the store accepts
  // whatever it's handed and we depend on the upstream gate.
  const store = openSessionStore(':memory:', 5, { databaseOptions: { type: 'memory' } });
  const erroredEvents: TimestampedEvent[] = [
    { ts: 1, sse: 'event: setup\ndata: {"scenarioId":"s1"}\n\n' },
    { ts: 2, sse: 'event: sim_error\ndata: {"message":"bad api key"}\n\n' },
  ];
  await store.saveSession(erroredEvents);
  const list = await store.listSessions();
  assert.equal(list.length, 1, 'store accepts the row; gating is server-app.ts responsibility');
  await store.close();
});

test('openSessionStore evicts the oldest row when capacity is exceeded', async () => {
  const store = openSessionStore(':memory:', 2, { databaseOptions: { type: 'memory' } });
  const a = await store.saveSession(completeRun('s1'));
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.saveSession(completeRun('s2'));
  await new Promise((r) => setTimeout(r, 5));
  const c = await store.saveSession(completeRun('s3'));
  assert.equal(c.evictedId, a.id, 'oldest must be evicted to keep cardinality at maxSessions');
  const list = await store.listSessions();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((s) => s.id).sort(), [b.id, c.id].sort());
  await store.close();
});

test('listSessions surfaces newest-first ordering', async () => {
  const store = openSessionStore(':memory:', 5, { databaseOptions: { type: 'memory' } });
  const first = await store.saveSession(completeRun('s1'));
  await new Promise((r) => setTimeout(r, 5));
  const second = await store.saveSession(completeRun('s2'));
  await new Promise((r) => setTimeout(r, 5));
  const third = await store.saveSession(completeRun('s3'));
  const list = await store.listSessions();
  assert.deepEqual(list.map((s) => s.id), [third.id, second.id, first.id]);
  await store.close();
});

test('updateTitle replaces an existing title and is a no-op for unknown ids', async () => {
  const store = openSessionStore(':memory:', 5, { databaseOptions: { type: 'memory' } });
  const { id } = await store.saveSession(completeRun('s1'));
  await store.updateTitle(id, 'A Cautious Descent');
  const reloaded = await store.getSession(id);
  assert.equal(reloaded?.meta.title, 'A Cautious Descent');
  // No-op for unknown ids — must not throw.
  await store.updateTitle('definitely-not-a-real-id', 'ignored');
  await store.close();
});
