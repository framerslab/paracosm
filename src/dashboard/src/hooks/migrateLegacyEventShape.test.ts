import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyEventShape } from './migrateLegacyEventShape.js';

test('event with data.colony only aliases to data.metrics (same value)', () => {
  const input = [
    { type: 'turn_start', leader: 'A', data: { colony: { population: 100 } } },
  ];
  const out = migrateLegacyEventShape(input);
  assert.deepEqual(out.events[0].data?.metrics, { population: 100 });
  assert.deepEqual(out.events[0].data?.colony, { population: 100 }, 'old key preserved');
});

test('event with both data.colony and data.metrics keeps new key untouched', () => {
  const input = [
    { type: 'turn_start', leader: 'A', data: { colony: { population: 99 }, metrics: { population: 100 } } },
  ];
  const out = migrateLegacyEventShape(input);
  assert.deepEqual(out.events[0].data?.metrics, { population: 100 }, 'new key wins');
});

test('event with data.colonyDeltas only aliases to data.systemDeltas', () => {
  const input = [
    { type: 'outcome', leader: 'A', data: { colonyDeltas: { morale: 0.09 } } },
  ];
  const out = migrateLegacyEventShape(input);
  assert.deepEqual(out.events[0].data?.systemDeltas, { morale: 0.09 });
});

test('event type colony_snapshot rewrites to systems_snapshot', () => {
  const input = [
    { type: 'colony_snapshot', leader: 'A', data: { population: 50 } },
  ];
  const out = migrateLegacyEventShape(input);
  assert.equal(out.events[0].type, 'systems_snapshot');
});

test('results[].leader.colony aliases to .unit', () => {
  const input = [
    { type: 'turn_start', leader: 'A', data: {} },
  ];
  const results = [
    { leader: { name: 'Reyes', archetype: 'X', colony: 'Station A' }, summary: {}, fingerprint: {} },
  ];
  const out = migrateLegacyEventShape(input, results);
  assert.equal(out.results?.[0]?.leader?.unit, 'Station A');
  assert.equal(out.results?.[0]?.leader?.colony, 'Station A', 'old key preserved');
});

test('events with no legacy keys pass through unchanged', () => {
  const input = [
    { type: 'systems_snapshot', leader: 'A', data: { population: 100, metrics: { morale: 0.8 } } },
  ];
  const out = migrateLegacyEventShape(input);
  assert.equal(out.events[0].type, 'systems_snapshot');
  assert.deepEqual(out.events[0].data?.metrics, { morale: 0.8 });
});

test('empty events array returns empty events array', () => {
  const out = migrateLegacyEventShape([]);
  assert.equal(out.events.length, 0);
});

test('single-event migration (replay path) via [ev][0] works', () => {
  const input = [{ type: 'colony_snapshot', leader: 'A', data: { colony: { population: 10 } } }];
  const out = migrateLegacyEventShape(input).events[0];
  assert.equal(out.type, 'systems_snapshot');
  assert.deepEqual(out.data?.metrics, { population: 10 });
});

test('loads the full legacy-0.4-run fixture and migrates all events', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = JSON.parse(
    readFileSync(
      resolve(here, '../../../../tests/fixtures/legacy-0.4-run.json'),
      'utf-8',
    ),
  );
  const out = migrateLegacyEventShape(fixture.events, fixture.results);
  // Fixture has turn_start (data.colony), colony_snapshot, outcome
  // (colonyDeltas), turn_done (data.colony). All four should pick up
  // the new keys.
  assert.ok(out.events.length === 4, 'fixture has 4 events');
  assert.equal(out.events[0].type, 'turn_start');
  assert.ok(out.events[0].data?.metrics, 'turn_start now has metrics');
  assert.equal(out.events[1].type, 'systems_snapshot', 'colony_snapshot was rewritten');
  assert.equal(out.events[2].type, 'outcome');
  assert.ok(out.events[2].data?.systemDeltas, 'outcome now has systemDeltas');
  assert.ok(out.events[3].data?.metrics, 'turn_done now has metrics');
  assert.equal(out.results?.[0]?.leader?.unit, 'Station Alpha');
});
