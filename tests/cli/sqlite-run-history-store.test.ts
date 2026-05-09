import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import type { RunRecord } from '../../src/server/services/run-record.js';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `run_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    scenarioId: 'mars-genesis',
    scenarioVersion: '0.4.88',
    actorConfigHash: 'leaders:abc',
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
    ...overrides,
  };
}

test('insertRun then getRun returns the same record', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = makeRun({ runId: 'run_known' });
  await store.insertRun(run);
  const loaded = await store.getRun('run_known');
  assert.deepEqual(loaded, run);
});

test('getRun unknown id returns null', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const loaded = await store.getRun('run_missing');
  assert.equal(loaded, null);
});

test('listRuns no filter returns all rows sorted by createdAt DESC', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'run_a', createdAt: '2026-04-24T10:00:00Z' }));
  await store.insertRun(makeRun({ runId: 'run_b', createdAt: '2026-04-24T12:00:00Z' }));
  await store.insertRun(makeRun({ runId: 'run_c', createdAt: '2026-04-24T11:00:00Z' }));
  const rows = await store.listRuns();
  assert.deepEqual(rows.map(r => r.runId), ['run_b', 'run_c', 'run_a']);
});

test('listRuns filters by scenarioId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r1', scenarioId: 'mars-genesis' }));
  await store.insertRun(makeRun({ runId: 'r2', scenarioId: 'lunar-outpost' }));
  await store.insertRun(makeRun({ runId: 'r3', scenarioId: 'mars-genesis' }));
  const rows = await store.listRuns({ scenarioId: 'mars-genesis' });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.scenarioId === 'mars-genesis'));
});

test('listRuns filters by sourceMode', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r1', sourceMode: 'local_demo' }));
  await store.insertRun(makeRun({ runId: 'r2', sourceMode: 'platform_api' }));
  const rows = await store.listRuns({ sourceMode: 'platform_api' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, 'r2');
});

test('listRuns filters by actorConfigHash', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r1', actorConfigHash: 'leaders:abc' }));
  await store.insertRun(makeRun({ runId: 'r2', actorConfigHash: 'leaders:def' }));
  const rows = await store.listRuns({ actorConfigHash: 'leaders:def' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, 'r2');
});

test('listRuns combines all three filters with AND semantics', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'match', scenarioId: 'mars-genesis', sourceMode: 'platform_api', actorConfigHash: 'leaders:abc' }));
  await store.insertRun(makeRun({ runId: 'wrong-scenario', scenarioId: 'lunar-outpost', sourceMode: 'platform_api', actorConfigHash: 'leaders:abc' }));
  await store.insertRun(makeRun({ runId: 'wrong-mode', scenarioId: 'mars-genesis', sourceMode: 'local_demo', actorConfigHash: 'leaders:abc' }));
  const rows = await store.listRuns({ scenarioId: 'mars-genesis', sourceMode: 'platform_api', actorConfigHash: 'leaders:abc' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, 'match');
});

test('listRuns paginates with limit + offset', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  for (let i = 0; i < 12; i++) {
    await store.insertRun(makeRun({ runId: `r${i.toString().padStart(2, '0')}`, createdAt: `2026-04-24T${i.toString().padStart(2, '0')}:00:00Z` }));
  }
  const page1 = await store.listRuns({ limit: 5, offset: 0 });
  const page2 = await store.listRuns({ limit: 5, offset: 5 });
  const page3 = await store.listRuns({ limit: 5, offset: 10 });
  assert.equal(page1.length, 5);
  assert.equal(page2.length, 5);
  assert.equal(page3.length, 2);
  assert.equal(page1[0].runId, 'r11');
  assert.equal(page2[0].runId, 'r06');
  assert.equal(page3[0].runId, 'r01');
});

test('listRuns clamps oversize limit to 500', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  for (let i = 0; i < 3; i++) {
    await store.insertRun(makeRun({ runId: `r${i}` }));
  }
  const rows = await store.listRuns({ limit: 9999 });
  assert.equal(rows.length, 3);
});

test('listRuns clamps invalid limit/offset to defaults', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  for (let i = 0; i < 3; i++) {
    await store.insertRun(makeRun({ runId: `r${i}` }));
  }
  const rows = await store.listRuns({ limit: -5, offset: -3 });
  assert.equal(rows.length, 3);
});

test('countRuns matches list length under no filter', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  for (let i = 0; i < 7; i++) {
    await store.insertRun(makeRun({ runId: `r${i}` }));
  }
  const count = await store.countRuns!();
  assert.equal(count, 7);
});

test('countRuns matches filtered list length', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r1', scenarioId: 'mars-genesis' }));
  await store.insertRun(makeRun({ runId: 'r2', scenarioId: 'lunar-outpost' }));
  await store.insertRun(makeRun({ runId: 'r3', scenarioId: 'mars-genesis' }));
  const count = await store.countRuns!({ scenarioId: 'mars-genesis' });
  assert.equal(count, 2);
});

test('inserting duplicate runId is silently ignored (INSERT OR IGNORE)', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const run = makeRun({ runId: 'run_dup', createdAt: '2026-04-24T10:00:00Z' });
  await store.insertRun(run);
  await store.insertRun({ ...run, createdAt: '2026-04-24T11:00:00Z' });
  const loaded = await store.getRun('run_dup');
  assert.equal(loaded?.createdAt, '2026-04-24T10:00:00Z');
  const count = await store.countRuns!();
  assert.equal(count, 1);
});

test(':memory: path provides isolation between instances', async () => {
  const store1 = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const store2 = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store1.insertRun(makeRun({ runId: 'in-store-1' }));
  const fromStore2 = await store2.listRuns();
  assert.equal(fromStore2.length, 0);
});

test('SqliteRunHistoryStore round-trips Library-tab denormalized fields', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const record: RunRecord = {
    runId: 'run_lib_1',
    createdAt: new Date().toISOString(),
    scenarioId: 'mars-genesis',
    scenarioVersion: '0.7.0',
    actorConfigHash: 'leaders:abc123',
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
    artifactPath: '/tmp/run_lib_1.json',
    costUSD: 0.42,
    durationMs: 12345,
    mode: 'batch-trajectory',
    actorName: 'Marcus Reinhardt',
    actorArchetype: 'pragmatist',
  };
  await store.insertRun(record);
  const fetched = await store.getRun(record.runId);
  assert.deepEqual(fetched, record);
});

test('listRuns filters by simulation mode (turn-loop vs batch-trajectory)', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'sim-turn', mode: 'turn-loop' }));
  await store.insertRun(makeRun({ runId: 'sim-batch', mode: 'batch-trajectory' }));
  await store.insertRun(makeRun({ runId: 'sim-point', mode: 'batch-point' }));
  const turn = await store.listRuns({ mode: 'turn-loop' });
  assert.equal(turn.length, 1);
  assert.equal(turn[0].runId, 'sim-turn');
  const batch = await store.listRuns({ mode: 'batch-trajectory' });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].runId, 'sim-batch');
});

test('listRuns filters by free-text q across scenario, leader, archetype', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'mars-1', scenarioId: 'mars-genesis', actorName: 'Ada', actorArchetype: 'visionary' }));
  await store.insertRun(makeRun({ runId: 'lunar-1', scenarioId: 'lunar-outpost', actorName: 'Marcus', actorArchetype: 'pragmatist' }));
  const lunar = await store.listRuns({ q: 'lunar' });
  assert.equal(lunar.length, 1);
  assert.equal(lunar[0].runId, 'lunar-1');
  const ada = await store.listRuns({ q: 'Ada' });
  assert.equal(ada.length, 1);
  assert.equal(ada[0].runId, 'mars-1');
  const visionary = await store.listRuns({ q: 'visionary' });
  assert.equal(visionary.length, 1);
  assert.equal(visionary[0].runId, 'mars-1');
});

test('aggregateStats returns sums of cost + duration + replay counters across all runs', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'a1', costUSD: 0.10, durationMs: 1000, mode: 'turn-loop' }));
  await store.insertRun(makeRun({ runId: 'a2', costUSD: 0.20, durationMs: 2000, mode: 'batch-trajectory' }));
  await store.insertRun(makeRun({ runId: 'a3', costUSD: 0.30, durationMs: 3000, mode: 'batch-trajectory' }));
  const agg = await store.aggregateStats!();
  assert.equal(agg.totalRuns, 3);
  assert.ok(Math.abs(agg.totalCostUSD - 0.60) < 1e-9, `expected 0.60, got ${agg.totalCostUSD}`);
  assert.equal(agg.totalDurationMs, 6000);
  assert.equal(agg.replaysAttempted, 0);
  assert.equal(agg.replaysMatched, 0);
});

test('aggregateStats filtered by mode returns subset sums', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'b1', costUSD: 0.10, mode: 'turn-loop' }));
  await store.insertRun(makeRun({ runId: 'b2', costUSD: 0.20, mode: 'batch-trajectory' }));
  const agg = await store.aggregateStats!({ mode: 'batch-trajectory' });
  assert.equal(agg.totalRuns, 1);
  assert.ok(Math.abs(agg.totalCostUSD - 0.20) < 1e-9);
});

test('recordReplayResult increments replay_attempts always and replay_matches conditionally', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-replay' }));
  await store.recordReplayResult!('r-replay', true);
  await store.recordReplayResult!('r-replay', false);
  await store.recordReplayResult!('r-replay', true);
  const agg = await store.aggregateStats!();
  assert.equal(agg.replaysAttempted, 3);
  assert.equal(agg.replaysMatched, 2);
});

test('migrates a v0.7 schema (leader_config_hash) to v0.8 (actor_config_hash) on boot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-sqlite-migrate-'));
  const dbPath = join(dir, 'runs.db');
  // Build a legacy-shaped table the way v0.7 wrote it.
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE runs (
      run_id              TEXT PRIMARY KEY NOT NULL,
      created_at          TEXT NOT NULL,
      scenario_id         TEXT NOT NULL,
      scenario_version    TEXT NOT NULL,
      leader_config_hash  TEXT NOT NULL,
      economics_profile   TEXT NOT NULL,
      source_mode         TEXT NOT NULL,
      created_by          TEXT NOT NULL
    );
    CREATE INDEX idx_runs_leader_created ON runs (leader_config_hash, created_at DESC);
  `);
  seed.prepare(`
    INSERT INTO runs
      (run_id, created_at, scenario_id, scenario_version, leader_config_hash, economics_profile, source_mode, created_by)
    VALUES
      ('legacy-1', '2026-04-20T00:00:00Z', 'mars-genesis', '0.4.88', 'leaders:legacy-hash', 'balanced', 'local_demo', 'anonymous')
  `).run();
  seed.close();

  // Boot the store against the legacy DB. Without the migration, this
  // throws on db.prepare() because the prepared INSERT references
  // actor_config_hash, which doesn't exist in the legacy schema.
  const store = createSqliteRunHistoryStore({ dbPath });
  const loaded = await store.getRun('legacy-1');
  assert.ok(loaded, 'legacy row preserved through column rename');
  assert.equal(loaded!.actorConfigHash, 'leaders:legacy-hash');

  // Subsequent inserts work on the migrated schema.
  await store.insertRun(makeRun({ runId: 'modern-1' }));
  const fresh = await store.getRun('modern-1');
  assert.ok(fresh);

  rmSync(dir, { recursive: true, force: true });
});

