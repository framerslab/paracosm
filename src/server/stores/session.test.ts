/**
 * @fileoverview Tests for the session-store SQL wrapper. Uses
 * `:memory:` so the suite stays filesystem-free and runs fast.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '@framers/sql-storage-adapter';
import { openSessionStore, type TimestampedEvent } from './session.js';

function makeEvent(eventName: string, data: Record<string, unknown>, ts: number): TimestampedEvent {
  return { ts, sse: `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n` };
}

const baseEvents: TimestampedEvent[] = [
  makeEvent('active_scenario', { id: 'mars', name: 'Mars Genesis' }, 1000),
  makeEvent('setup', { leaderA: { name: 'Alice' }, leaderB: { name: 'Bob' } }, 1100),
  makeEvent('turn_done', { turn: 1 }, 5000),
  makeEvent('turn_done', { turn: 2 }, 9000),
  makeEvent('complete', { cost: { totalCostUSD: 0.42 } }, 12000),
];

test('saveSession persists events + derived metadata', async () => {
  const store = openSessionStore(':memory:');
  const { id } = await store.saveSession(baseEvents);
  const stored = await store.getSession(id);
  assert.ok(stored);
  assert.equal(stored.events.length, 5);
  assert.equal(stored.meta.scenarioId, 'mars');
  assert.equal(stored.meta.scenarioName, 'Mars Genesis');
  assert.equal(stored.meta.leaderA, 'Alice');
  assert.equal(stored.meta.leaderB, 'Bob');
  assert.equal(stored.meta.turnCount, 2);
  assert.equal(stored.meta.totalCostUSD, 0.42);
  assert.equal(stored.meta.eventCount, 5);
  assert.equal(stored.meta.durationMs, 11000);
  await store.close();
});

test('listSessions returns newest-first metadata without events blob', async () => {
  const store = openSessionStore(':memory:');
  await store.saveSession(baseEvents);
  await store.saveSession(baseEvents);
  const list = await store.listSessions();
  assert.equal(list.length, 2);
  assert.equal((list[0] as unknown as { events?: unknown }).events, undefined);
  assert.ok(list[0].createdAt >= list[1].createdAt);
  await store.close();
});

test('saveSession evicts the oldest row when over capacity', async () => {
  const store = openSessionStore(':memory:', 3);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push((await store.saveSession(baseEvents)).id);
  }
  assert.equal(await store.count(), 3);
  const remaining = (await store.listSessions()).map(s => s.id);
  assert.deepEqual(remaining.sort(), ids.slice(2).sort());
});

test('saveSession returns evictedId only when capacity is exceeded', async () => {
  const store = openSessionStore(':memory:', 2);
  const a = await store.saveSession(baseEvents);
  const b = await store.saveSession(baseEvents);
  const c = await store.saveSession(baseEvents);
  assert.equal(c.evictedId, a.id);
  assert.equal(b.evictedId, undefined);
});

test('past the bound on every owner\'s rows, the owner holding the most gives up their oldest row', async () => {
  const store = openSessionStore(':memory:', 2, { maxTotalSessions: 3 });
  // A visitor's single row is the oldest in the store, so a policy that
  // evicted the oldest row of all would take it.
  const first = await store.saveSession(baseEvents, undefined, { owner: 'first' });
  const heavy1 = await store.saveSession(baseEvents, undefined, { owner: 'heavy' });
  const heavy2 = await store.saveSession(baseEvents, undefined, { owner: 'heavy' });
  const last = await store.saveSession(baseEvents, undefined, { owner: 'last' });
  assert.equal(last.evictedId, heavy1.id, "the heavy owner's oldest row goes");
  assert.deepEqual((await store.listSessions()).map(s => s.id), [last.id, heavy2.id, first.id]);
  await store.close();
});

test('at the bound with every owner holding one row, the save evicts the oldest row in the store, another owner\'s', async () => {
  const store = openSessionStore(':memory:', 2, { maxTotalSessions: 3 });
  const a = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  const b = await store.saveSession(baseEvents, undefined, { owner: 'b' });
  const c = await store.saveSession(baseEvents, undefined, { owner: 'c' });
  const d = await store.saveSession(baseEvents, undefined, { owner: 'd' });
  assert.equal(d.evictedId, a.id);
  assert.deepEqual((await store.listSessions()).map(s => s.id), [d.id, c.id, b.id]);
  assert.deepEqual(await store.listSessions({ owner: 'a' }), [], "owner a's only row went");
  await store.close();
});

test('saves that finish together keep each owner to their ring and the store to its bound', async () => {
  const store = openSessionStore(':memory:', 2, { maxTotalSessions: 4 });
  const ones = await Promise.all(Array.from({ length: 6 }, () => store.saveSession(baseEvents, undefined, { owner: 'one' })));
  assert.deepEqual(
    (await store.listSessions({ owner: 'one' })).map(s => s.id),
    [ones[5].id, ones[4].id],
    "one owner's ring keeps the last two saves",
  );
  const others = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(owner => store.saveSession(baseEvents, undefined, { owner })));
  // c's save takes one's older row (one holds the most), d's takes one's
  // last row and e's takes a's, each then the oldest row of all.
  assert.equal(others[2].evictedId, ones[4].id);
  assert.equal(others[3].evictedId, ones[5].id);
  assert.equal(others[4].evictedId, others[0].id);
  assert.deepEqual(
    (await store.listSessions()).map(s => s.id),
    [others[4].id, others[3].id, others[2].id, others[1].id],
  );
  await store.close();
});

test('eviction and newest-first order follow the order rows were saved in, whatever the clock says', async (t) => {
  const store = openSessionStore(':memory:', 2);
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const first = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  const second = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  // The clock moves back, as it can after a restart.
  now = 5_000;
  const third = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  assert.equal(third.evictedId, first.id, 'the first save goes, not the one just made');
  assert.deepEqual((await store.listSessions({ owner: 'a' })).map(s => s.id), [third.id, second.id]);
  assert.equal((await store.getSession(third.id))?.meta.createdAt, 5_000, 'createdAt keeps the clock time for display');
  // Saves in the same millisecond keep the order they were made in.
  const fourth = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  assert.equal(fourth.evictedId, second.id);
  assert.deepEqual((await store.listSessions({ owner: 'a' })).map(s => s.id), [fourth.id, third.id]);
  await store.close();
});

test('a save whose eviction fails leaves no row behind and both bounds kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-session-tx-'));
  const file = join(dir, 'sessions.db');
  try {
    const store = openSessionStore(file, 2);
    const a = await store.saveSession(baseEvents, undefined, { owner: 'a' });
    const b = await store.saveSession(baseEvents, undefined, { owner: 'a' });
    // Another connection makes every delete fail, as a disk error between
    // the insert and the eviction would.
    const raw = await createDatabase({ file });
    await raw.exec("CREATE TRIGGER refuse_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'delete refused'); END;");
    await raw.close();
    await assert.rejects(store.saveSession(baseEvents, undefined, { owner: 'a' }), /delete refused/);
    assert.equal(await store.count(), 2, 'the insert rolled back with the failed eviction');
    assert.deepEqual((await store.listSessions({ owner: 'a' })).map(s => s.id), [b.id, a.id]);
    await store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('opening a store brings every owner\'s rows back within the bounds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-session-boot-'));
  const file = join(dir, 'sessions.db');
  try {
    const wide = openSessionStore(file, 20);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await wide.saveSession(baseEvents, undefined, { owner: 'a' })).id);
    await wide.close();
    const store = openSessionStore(file, 10);
    assert.equal(await store.count(), 10, 'the bucket over its bound is trimmed at open, before any save');
    assert.deepEqual((await store.listSessions({ owner: 'a' })).map(s => s.id), ids.slice(2).reverse());
    await store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a save under a run key already saved returns the saved row and adds none', async () => {
  const store = openSessionStore(':memory:');
  const first = await store.saveSession(baseEvents, undefined, { owner: 'a', runKey: 'run-1' });
  const again = await store.saveSession(baseEvents, undefined, { owner: 'a', runKey: 'run-1' });
  assert.equal(again.id, first.id);
  assert.equal(await store.count(), 1);
  const other = await store.saveSession(baseEvents, undefined, { owner: 'a', runKey: 'run-2' });
  assert.notEqual(other.id, first.id);
  assert.equal(await store.count(), 2);
  await store.close();
});

test('a store with one ring for every owner keeps the newest maxSessions rows of all', async () => {
  const store = openSessionStore(':memory:', 10, { ownerRings: false });
  const cli = await store.saveSession(baseEvents);
  const browser: string[] = [];
  for (let i = 0; i < 10; i++) browser.push((await store.saveSession(baseEvents, undefined, { owner: 'browser' })).id);
  assert.equal(await store.count(), 10);
  assert.equal(await store.getSession(cli.id), null, 'the oldest row goes, whoever saved it');
  assert.deepEqual((await store.listSessions()).map(s => s.id), [...browser].reverse());
  await store.close();
});

test('existingIds names the ids the store still holds', async () => {
  const store = openSessionStore(':memory:', 1);
  const a = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  const b = await store.saveSession(baseEvents, undefined, { owner: 'a' });
  assert.deepEqual([...await store.existingIds([a.id, b.id, 'unknown'])], [b.id]);
  assert.deepEqual([...await store.existingIds([])], []);
  await store.close();
});

test('the saved cost sums each actor\'s last cumulative cost, read from inside the sim frame', async () => {
  const store = openSessionStore(':memory:');
  const pair: TimestampedEvent[] = [
    makeEvent('active_scenario', { id: 'mars', name: 'Mars Genesis' }, 1000),
    makeEvent('sim', { type: 'turn_done', leader: 'Aria', data: { turn: 1, _cost: { totalCostUSD: 0.1 } } }, 2000),
    makeEvent('sim', { type: 'turn_done', leader: 'Voss', data: { turn: 1, _cost: { totalCostUSD: 0.15 } } }, 2100),
    makeEvent('sim', { type: 'turn_done', leader: 'Aria', data: { turn: 2, _cost: { totalCostUSD: 0.2 } } }, 3000),
    makeEvent('sim', { type: 'turn_done', leader: 'Voss', data: { turn: 2, _cost: { totalCostUSD: 0.3 } } }, 3100),
    makeEvent('complete', {}, 4000),
  ];
  const { id } = await store.saveSession(pair);
  const cost = (await store.getSession(id))?.meta.totalCostUSD;
  assert.ok(cost !== undefined && Math.abs(cost - 0.5) < 1e-9, `0.2 + 0.3, got ${cost}`);
  await store.close();
});

test('getSession returns null for unknown id', async () => {
  const store = openSessionStore(':memory:');
  assert.equal(await store.getSession('does-not-exist'), null);
});

test('saveSession respects an explicit metadata override', async () => {
  const store = openSessionStore(':memory:');
  const { id } = await store.saveSession(baseEvents, {
    scenarioName: 'Custom Override',
    leaderA: 'Override A',
    totalCostUSD: 9.99,
  });
  const stored = await store.getSession(id);
  assert.ok(stored);
  assert.equal(stored.meta.scenarioName, 'Custom Override');
  assert.equal(stored.meta.leaderA, 'Override A');
  assert.equal(stored.meta.totalCostUSD, 9.99);
  assert.equal(stored.meta.leaderB, 'Bob');
});

test('saveSession tolerates events with no derivable metadata', async () => {
  const store = openSessionStore(':memory:');
  const noisy: TimestampedEvent[] = [
    makeEvent('something', { unrelated: true }, 100),
    makeEvent('other', { foo: 'bar' }, 200),
  ];
  const { id } = await store.saveSession(noisy);
  const stored = await store.getSession(id);
  assert.ok(stored);
  assert.equal(stored.meta.scenarioName, undefined);
  assert.equal(stored.meta.leaderA, undefined);
  assert.equal(stored.meta.eventCount, 2);
  assert.equal(stored.meta.durationMs, 100);
});

test('saveSession with a single event yields zero duration', async () => {
  const store = openSessionStore(':memory:');
  const single: TimestampedEvent[] = [makeEvent('complete', {}, 5000)];
  const { id } = await store.saveSession(single);
  assert.equal((await store.getSession(id))?.meta.durationMs, 0);
});

test('saveSession survives malformed JSON in event data', async () => {
  const store = openSessionStore(':memory:');
  const bogus: TimestampedEvent[] = [
    { ts: 1, sse: 'event: garbage\ndata: not-actually-json{}\n\n' },
    makeEvent('active_scenario', { id: 'mars', name: 'Mars' }, 2),
  ];
  const { id } = await store.saveSession(bogus);
  assert.equal((await store.getSession(id))?.meta.scenarioName, 'Mars');
});

// Regression test for the real production SSE shape: the orchestrator
// wraps every engine event in `broadcast('sim', {type: <realType>, ...})`
// and pair-runner fires `event: status` (not `event: setup`) for the
// actor roster. An earlier deriveMetadata matched on the unwrapped
// shape only, so turnCount + actor names stayed null on every real
// save. This test pins the wrapped-shape behaviour so the bug can't
// silently come back.
test('saveSession derives metadata from wrapped sim + status events', async () => {
  const store = openSessionStore(':memory:');
  const wrapped: TimestampedEvent[] = [
    makeEvent('active_scenario', { id: 'mars', name: 'Mars Genesis' }, 1000),
    makeEvent('status', {
      phase: 'parallel',
      actors: [{ name: 'Aria Chen' }, { name: 'Dietrich Voss' }],
    }, 1200),
    makeEvent('sim', { type: 'turn_done', turn: 1, _cost: { totalCostUSD: 0.05 } }, 3000),
    makeEvent('sim', { type: 'turn_done', turn: 2, _cost: { totalCostUSD: 0.11 } }, 5000),
    makeEvent('sim', { type: 'turn_done', turn: 3, _cost: { totalCostUSD: 0.18 } }, 7000),
    makeEvent('complete', {}, 9000),
  ];
  const { id } = await store.saveSession(wrapped);
  const stored = await store.getSession(id);
  assert.ok(stored);
  assert.equal(stored.meta.scenarioName, 'Mars Genesis');
  assert.equal(stored.meta.leaderA, 'Aria Chen');
  assert.equal(stored.meta.leaderB, 'Dietrich Voss');
  assert.equal(stored.meta.turnCount, 3);
  // Highest _cost.totalCostUSD seen wins — complete itself has no cost,
  // but the cumulative value in the last turn_done is authoritative.
  assert.equal(stored.meta.totalCostUSD, 0.18);
});

// 3+ actor runs: deriveMetadata must persist the FULL roster array, not
// just the first two leaders. The replay UI uses meta.leaders to render
// "Aria, Maria, Atlas, +5 more" instead of "Aria vs Maria" on a 9-actor
// run. Pair runs (n=2) intentionally leave meta.leaders absent — the
// legacy leaderA / leaderB columns already cover them.
test('saveSession persists full leaders array for 3+ actor runs', async () => {
  const store = openSessionStore(':memory:');
  const fiveActor: TimestampedEvent[] = [
    makeEvent('active_scenario', { id: 'mars', name: 'Mars Genesis' }, 1000),
    makeEvent('status', {
      phase: 'parallel',
      actors: [
        { name: 'Aria' },
        { name: 'Maria' },
        { name: 'Atlas' },
        { name: 'Reyes' },
        { name: 'Sato' },
      ],
    }, 1200),
    makeEvent('complete', {}, 9000),
  ];
  const { id } = await store.saveSession(fiveActor);
  const stored = await store.getSession(id);
  assert.ok(stored);
  // Legacy fields keep working for the first two slots.
  assert.equal(stored.meta.leaderA, 'Aria');
  assert.equal(stored.meta.leaderB, 'Maria');
  // Full roster preserved for the multi-actor UI surface.
  assert.deepEqual(stored.meta.leaders, ['Aria', 'Maria', 'Atlas', 'Reyes', 'Sato']);
  // Round-trips through listSessions too (separate SELECT projection).
  const list = await store.listSessions();
  assert.deepEqual(list[0].leaders, ['Aria', 'Maria', 'Atlas', 'Reyes', 'Sato']);
  await store.close();
});

test('saveSession leaves leaders unset on pair runs (n=2)', async () => {
  const store = openSessionStore(':memory:');
  const pair: TimestampedEvent[] = [
    makeEvent('active_scenario', { id: 'mars', name: 'Mars Genesis' }, 1000),
    makeEvent('status', {
      phase: 'parallel',
      actors: [{ name: 'Aria' }, { name: 'Maria' }],
    }, 1200),
    makeEvent('complete', {}, 9000),
  ];
  const { id } = await store.saveSession(pair);
  const stored = await store.getSession(id);
  assert.ok(stored);
  assert.equal(stored.meta.leaderA, 'Aria');
  assert.equal(stored.meta.leaderB, 'Maria');
  // No leaders array — pair runs rely on the legacy columns.
  assert.equal(stored.meta.leaders, undefined);
  await store.close();
});

test('saveSession explicit leaders override wins over derived', async () => {
  const store = openSessionStore(':memory:');
  const { id } = await store.saveSession(baseEvents, {
    leaders: ['Custom1', 'Custom2', 'Custom3'],
  });
  const stored = await store.getSession(id);
  assert.ok(stored);
  assert.deepEqual(stored.meta.leaders, ['Custom1', 'Custom2', 'Custom3']);
  await store.close();
});
