import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectActorRow,
  projectActorRows,
  compareRows,
  sortRows,
  defaultSortDir,
  type ActorRow,
  type SortKey,
} from './actor-table.helpers.js';
import type { ActorSideState, GameState } from '../../hooks/useGameState';

function fakeActor(overrides: Partial<ActorSideState> = {}): ActorSideState {
  return {
    leader: { name: 'Default', archetype: 'Engineer', unit: 'Test', hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 } },
    event: null,
    events: [],
    popHistory: [],
    moraleHistory: [],
    deaths: 0,
    deathCauses: {},
    tools: 0,
    toolNames: new Set<string>(),
    citations: 0,
    decisions: 0,
    pendingDecision: '',
    pendingRationale: '',
    ...overrides,
  } as ActorSideState;
}

function fakeRow(overrides: Partial<ActorRow> = {}): ActorRow {
  return {
    id: 'a',
    name: 'A',
    archetype: 'Engineer',
    population: 0,
    morale: 0,
    deaths: 0,
    tools: 0,
    turn: 0,
    pending: false,
    ...overrides,
  };
}

test('projectActorRow: pulls most-recent values from history series', () => {
  const row = projectActorRow('alice-id', fakeActor({
    leader: { name: 'Alice', archetype: 'Visionary', unit: 'Mars-Council', hexaco: {} as any },
    popHistory: [30, 28, 24, 21],
    moraleHistory: [80, 75, 60, 45],
    deaths: 9,
    toolNames: new Set(['scrubber', 'shield']),
  }));
  assert.equal(row.id, 'alice-id');
  assert.equal(row.name, 'Alice');
  assert.equal(row.archetype, 'Visionary');
  assert.equal(row.population, 21, 'population should be the last popHistory value');
  assert.equal(row.morale, 45, 'morale should be the last moraleHistory value');
  assert.equal(row.deaths, 9);
  assert.equal(row.tools, 2, 'tools should count unique tool names');
  assert.equal(row.turn, 4, 'turn should equal popHistory.length');
});

test('projectActorRow: empty history series read as 0', () => {
  const row = projectActorRow('id', fakeActor({}));
  assert.equal(row.population, 0);
  assert.equal(row.morale, 0);
  assert.equal(row.turn, 0);
});

test('projectActorRow: pending flag reflects pendingDecision', () => {
  const r1 = projectActorRow('id', fakeActor({ pendingDecision: 'Choose A' }));
  const r2 = projectActorRow('id', fakeActor({ pendingDecision: '' }));
  assert.equal(r1.pending, true);
  assert.equal(r2.pending, false);
});

test('projectActorRows: skips actors with missing state entries', () => {
  const state = {
    actorIds: ['a', 'b', 'c'],
    actors: {
      a: fakeActor({ leader: { name: 'Alice', archetype: 'X', unit: 'U', hexaco: {} as any } }),
      // 'b' is missing — projection should drop it without throwing
      c: fakeActor({ leader: { name: 'Carol', archetype: 'Y', unit: 'U', hexaco: {} as any } }),
    },
  } as unknown as GameState;
  const rows = projectActorRows(state);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Alice');
  assert.equal(rows[1].name, 'Carol');
});

test('defaultSortDir: numeric "more-is-better" columns start desc', () => {
  assert.equal(defaultSortDir('population'), 'desc');
  assert.equal(defaultSortDir('morale'), 'desc');
  assert.equal(defaultSortDir('tools'), 'desc');
  assert.equal(defaultSortDir('turn'), 'desc');
});

test('defaultSortDir: deaths starts asc (fewer is better)', () => {
  assert.equal(defaultSortDir('deaths'), 'asc');
});

test('defaultSortDir: string columns start asc', () => {
  assert.equal(defaultSortDir('name'), 'asc');
  assert.equal(defaultSortDir('archetype'), 'asc');
});

test('sortRows: morale desc puts highest first', () => {
  const rows = [
    fakeRow({ name: 'A', morale: 30 }),
    fakeRow({ name: 'B', morale: 90 }),
    fakeRow({ name: 'C', morale: 60 }),
  ];
  const sorted = sortRows(rows, 'morale', 'desc');
  assert.deepEqual(sorted.map(r => r.name), ['B', 'C', 'A']);
});

test('sortRows: deaths asc puts fewest first', () => {
  const rows = [
    fakeRow({ name: 'A', deaths: 5 }),
    fakeRow({ name: 'B', deaths: 0 }),
    fakeRow({ name: 'C', deaths: 12 }),
  ];
  const sorted = sortRows(rows, 'deaths', 'asc');
  assert.deepEqual(sorted.map(r => r.name), ['B', 'A', 'C']);
});

test('sortRows: ties break alphabetically by name regardless of direction', () => {
  // Two actors with identical morale; tiebreak should always be by
  // name asc so live SSE re-renders don't flip rows around.
  const rows = [
    fakeRow({ name: 'Charlie', morale: 50 }),
    fakeRow({ name: 'Alice', morale: 50 }),
    fakeRow({ name: 'Bob', morale: 50 }),
  ];
  const sortedDesc = sortRows(rows, 'morale', 'desc');
  assert.deepEqual(sortedDesc.map(r => r.name), ['Alice', 'Bob', 'Charlie']);
  const sortedAsc = sortRows(rows, 'morale', 'asc');
  assert.deepEqual(sortedAsc.map(r => r.name), ['Alice', 'Bob', 'Charlie']);
});

test('sortRows: does not mutate the input array', () => {
  const rows = [
    fakeRow({ name: 'B' }),
    fakeRow({ name: 'A' }),
  ];
  const orig = rows.map(r => r.name);
  sortRows(rows, 'name', 'asc');
  assert.deepEqual(rows.map(r => r.name), orig);
});

test('compareRows: name asc is alphabetical', () => {
  const a = fakeRow({ name: 'Alice' });
  const b = fakeRow({ name: 'Bob' });
  assert.ok(compareRows(a, b, 'name' as SortKey, 'asc') < 0);
  assert.ok(compareRows(b, a, 'name' as SortKey, 'asc') > 0);
});
