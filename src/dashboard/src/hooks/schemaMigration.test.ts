/**
 * Migration-chain unit tests. Pure-function scope so the chain can be
 * exercised without FileReader / DOM. Lives under hooks/ because the
 * chain is called by useGamePersistence.parseFile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_SCHEMA_VERSION,
  runMigrationChain,
  SchemaVersionTooNewError,
  SchemaVersionGapError,
  migrations,
} from './schemaMigration.js';

const canonical = {
  schemaVersion: 3,
  events: [
    { type: 'turn_start', leader: 'A', turn: 1, data: { turn: 1 } },
  ],
  results: [],
  startedAt: '2026-04-21T14:32:00.000Z',
  completedAt: '2026-04-21T14:55:00.000Z',
};

test('CURRENT_SCHEMA_VERSION is 3 today', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 3);
});

test('runMigrationChain: current-version data passes through as identity', () => {
  const out = runMigrationChain(canonical as never);
  assert.equal(out.schemaVersion, 3);
  assert.equal(out.events.length, 1);
});

test('runMigrationChain: missing schemaVersion treated as v1, migrated to 3', () => {
  const legacy = {
    events: [
      {
        type: 'colony_snapshot',
        leader: 'A',
        data: { colony: { population: 30 }, colonyDeltas: { morale: 0.1 }, year: 2035 },
      },
    ],
    results: [{ leader: { colony: 'Alpha' } }],
  };
  const out = runMigrationChain(legacy as never);
  assert.equal(out.schemaVersion, 3);
  // v1 -> v2 legacy migration should have rewritten the event type.
  assert.equal(out.events[0].type, 'systems_snapshot');
  // v2 -> v3 F23 migration should have aliased year -> time.
  const data0 = out.events[0].data as Record<string, unknown>;
  assert.equal(data0.time, 2035, 'v2->v3 migration should alias data.year onto data.time');
  assert.equal(data0.year, 2035, 'v2->v3 migration should leave the legacy key in place');
});

test('runMigrationChain v2 -> v3: aliases year-family fields onto time-family equivalents', () => {
  const v2Save = {
    schemaVersion: 2,
    events: [
      {
        type: 'turn_start',
        leader: 'A',
        turn: 1,
        data: {
          turn: 1,
          year: 2043,
          yearDelta: 8,
          metadata: { startYear: 2035, currentYear: 2043 },
          agent: { core: { birthYear: 2010 } },
        },
      },
    ],
    results: [{ leader: { name: 'A' }, metadata: { startYear: 2035, currentYear: 2043 } }],
  };
  const out = runMigrationChain(v2Save as never);
  assert.equal(out.schemaVersion, 3);
  const data0 = out.events[0].data as Record<string, any>;
  assert.equal(data0.time, 2043);
  assert.equal(data0.timeDelta, 8);
  assert.equal(data0.metadata.startTime, 2035);
  assert.equal(data0.metadata.currentTime, 2043);
  assert.equal(data0.agent.core.birthTime, 2010);
  // Legacy keys retained so older consumers still resolve.
  assert.equal(data0.year, 2043);
  assert.equal(data0.agent.core.birthYear, 2010);
  const res0 = (out.results as any[])[0];
  assert.equal(res0.metadata.startTime, 2035);
  assert.equal(res0.metadata.currentTime, 2043);
});

test('v2 -> v3 migration never clobbers an explicit time key set to falsy', () => {
  const v2Save = {
    schemaVersion: 2,
    events: [
      { type: 'turn_start', leader: 'A', data: { year: 2043, time: 0 } },
    ],
  };
  const out = runMigrationChain(v2Save as never);
  const data0 = out.events[0].data as Record<string, unknown>;
  assert.equal(data0.time, 0, 'explicit falsy time must not be overwritten by year');
});

test('runMigrationChain: schemaVersion > current throws SchemaVersionTooNewError', () => {
  const future = {
    schemaVersion: 99,
    events: [{ type: 'turn_start', leader: 'A', data: { turn: 1 } }],
  };
  assert.throws(
    () => runMigrationChain(future as never),
    (err: unknown) => {
      if (!(err instanceof SchemaVersionTooNewError)) return false;
      return err.fileVersion === 99 && err.dashboardVersion === CURRENT_SCHEMA_VERSION;
    },
  );
});

test('runMigrationChain: idempotent — running twice returns equivalent shape', () => {
  const once = runMigrationChain(canonical as never);
  const twice = runMigrationChain(once as never);
  assert.equal(twice.schemaVersion, once.schemaVersion);
  assert.equal(twice.events.length, once.events.length);
});

test('migrations table exposes the v1 -> v2 and v2 -> v3 steps', () => {
  assert.equal(typeof migrations[1], 'function');
  assert.equal(typeof migrations[2], 'function');
});

test('SchemaVersionGapError is exported but should never fire on a valid chain', () => {
  // Construct directly to assert shape. Real chain won't throw it on
  // current inputs; this test is a shape guard so future migrations
  // can rely on the exception type existing.
  const err = new SchemaVersionGapError(5);
  assert.equal(err.missingFromVersion, 5);
  assert.ok(err instanceof Error);
});
