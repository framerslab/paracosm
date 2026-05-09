/**
 * Pure-logic tests for useLocalHistory's ring helpers. Helpers live in
 * a sibling file so they can run under node:test without a DOM shim,
 * matching the useLoadPreview.helpers + LoadMenu.helpers pattern.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readHistory,
  writeHistory,
  pushHistoryEntry,
  deleteHistoryEntry,
  summarizeEvents,
  migrateLegacySlot,
  makeHistoryId,
  type LocalHistoryEntry,
  type StorageLike,
} from './useLocalHistory.helpers.js';

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function mkEntry(id: number, scenario = 'mars'): LocalHistoryEntry {
  return {
    id,
    createdAt: new Date(id).toISOString(),
    events: [],
    results: [],
    verdict: null,
    scenarioShortName: scenario,
    summary: { actorNames: [], turnCount: 0, eventCount: 0 },
  };
}

// -- pushHistoryEntry -----------------------------------------------------

test('pushHistoryEntry: empty ring -> single entry', () => {
  const out = pushHistoryEntry([], mkEntry(1), 5);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
});

test('pushHistoryEntry: newest-first ordering', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(1)];
  const out = pushHistoryEntry(ring, mkEntry(2), 5);
  assert.equal(out[0].id, 2);
  assert.equal(out[1].id, 1);
});

test('pushHistoryEntry: cap evicts oldest when full', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(3), mkEntry(2), mkEntry(1)];
  const out = pushHistoryEntry(ring, mkEntry(4), 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(e => e.id), [4, 3, 2]);
});

test('pushHistoryEntry: does not mutate input array', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(1)];
  const out = pushHistoryEntry(ring, mkEntry(2), 5);
  assert.equal(ring.length, 1);
  assert.notEqual(out, ring);
});

test('pushHistoryEntry: cap of 1 replaces the only entry on push', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(1)];
  const out = pushHistoryEntry(ring, mkEntry(2), 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 2);
});

// -- deleteHistoryEntry ---------------------------------------------------

test('deleteHistoryEntry: removes matching id', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(3), mkEntry(2), mkEntry(1)];
  const out = deleteHistoryEntry(ring, 2);
  assert.deepEqual(out.map(e => e.id), [3, 1]);
});

test('deleteHistoryEntry: missing id is no-op', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(3), mkEntry(2)];
  const out = deleteHistoryEntry(ring, 99);
  assert.deepEqual(out.map(e => e.id), [3, 2]);
});

test('deleteHistoryEntry: does not mutate input array', () => {
  const ring: LocalHistoryEntry[] = [mkEntry(1)];
  const out = deleteHistoryEntry(ring, 1);
  assert.equal(ring.length, 1);
  assert.notEqual(out, ring);
});

// -- summarizeEvents ------------------------------------------------------

test('summarizeEvents: collects unique leader names', () => {
  const events = [
    { type: 'turn_start', leader: 'Alice', data: { turn: 1 } },
    { type: 'turn_start', leader: 'Bob', data: { turn: 1 } },
    { type: 'turn_start', leader: 'Alice', data: { turn: 2 } },
  ] as never;
  const s = summarizeEvents(events, []);
  assert.deepEqual(s.actorNames, ['Alice', 'Bob']);
});

test('summarizeEvents: turnCount is max turn across events', () => {
  const events = [
    { type: 'turn_start', leader: 'A', data: { turn: 1 } },
    { type: 'turn_done', leader: 'A', data: { turn: 4 } },
    { type: 'turn_start', leader: 'A', data: { turn: 2 } },
  ] as never;
  const s = summarizeEvents(events, []);
  assert.equal(s.turnCount, 4);
});

test('summarizeEvents: eventCount matches events.length', () => {
  const events = [{}, {}, {}, {}] as never;
  const s = summarizeEvents(events, []);
  assert.equal(s.eventCount, 4);
});

test('summarizeEvents: cost from _cost.totalCostUSD on last event', () => {
  const events = [
    { type: 'turn_start', data: { turn: 1, _cost: { totalCostUSD: 0.05 } } },
    { type: 'turn_done', data: { turn: 1, _cost: { totalCostUSD: 0.12 } } },
  ] as never;
  const s = summarizeEvents(events, []);
  assert.equal(s.totalCostUSD, 0.12);
});

test('summarizeEvents: cost absent when no _cost payload', () => {
  const events = [{ type: 'turn_start', data: { turn: 1 } }] as never;
  const s = summarizeEvents(events, []);
  assert.equal(s.totalCostUSD, undefined);
});

// -- readHistory / writeHistory ------------------------------------------

test('readHistory: empty storage returns []', () => {
  assert.deepEqual(readHistory(fakeStorage()), []);
});

test('readHistory: round-trips a write', () => {
  const storage = fakeStorage();
  const ring: LocalHistoryEntry[] = [mkEntry(2), mkEntry(1)];
  writeHistory(storage, ring);
  assert.deepEqual(readHistory(storage).map(e => e.id), [2, 1]);
});

test('readHistory: malformed JSON returns []', () => {
  const storage = fakeStorage({ 'paracosm-local-history-v1': 'not json' });
  assert.deepEqual(readHistory(storage), []);
});

test('readHistory: non-array payload returns []', () => {
  const storage = fakeStorage({ 'paracosm-local-history-v1': '{"not": "array"}' });
  assert.deepEqual(readHistory(storage), []);
});

// -- migrateLegacySlot ---------------------------------------------------

test('migrateLegacySlot: valid legacy payload -> ring entry', () => {
  const legacy = {
    events: [
      { type: 'turn_start', leader: 'Alice', data: { turn: 1 } },
    ],
    results: [],
    startedAt: '2026-04-20T12:00:00.000Z',
  };
  const entry = migrateLegacySlot(legacy, 'mars');
  assert.ok(entry);
  assert.equal(entry!.scenarioShortName, 'mars');
  assert.deepEqual(entry!.summary.actorNames, ['Alice']);
  assert.equal(entry!.createdAt, '2026-04-20T12:00:00.000Z');
});

test('migrateLegacySlot: empty events -> null', () => {
  const legacy = { events: [], startedAt: '2026-04-20T12:00:00.000Z' };
  assert.equal(migrateLegacySlot(legacy, 'mars'), null);
});

test('migrateLegacySlot: missing events -> null', () => {
  assert.equal(migrateLegacySlot({}, 'mars'), null);
});

test('migrateLegacySlot: non-object input -> null', () => {
  assert.equal(migrateLegacySlot(null, 'mars'), null);
  assert.equal(migrateLegacySlot('string', 'mars'), null);
});

// -- makeHistoryId --------------------------------------------------------

test('makeHistoryId: returns a positive number', () => {
  const id = makeHistoryId();
  assert.equal(typeof id, 'number');
  assert.ok(id > 0);
});

test('makeHistoryId: produces monotonically increasing ids across rapid calls', async () => {
  const a = makeHistoryId();
  await new Promise(r => setTimeout(r, 2));
  const b = makeHistoryId();
  assert.ok(b >= a);
});
