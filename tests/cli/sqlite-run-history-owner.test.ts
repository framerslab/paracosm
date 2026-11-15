/**
 * The run-history store's owner column: a run is recorded under the key
 * of the visitor it belongs to, and a read with a scope reaches the runs
 * under that key alone. A runs table made before the column gets it when
 * the store opens, and the rows it held have no owner.
 */
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
    sourceMode: 'hosted_demo',
    createdBy: 'anonymous',
    ...overrides,
  };
}

const A = { owner: 'owner-key-a' };
const B = { owner: 'owner-key-b' };
const NO_VISITOR = { owner: null };

test('a scope reaches the runs recorded under its owner key alone', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'a-1', bundleId: 'shared-bundle', costUSD: 1, createdAt: '2026-11-01T10:00:00Z' }), A);
  await store.insertRun(makeRun({ runId: 'a-2', bundleId: 'shared-bundle', costUSD: 2, createdAt: '2026-11-01T11:00:00Z' }), A);
  await store.insertRun(makeRun({ runId: 'b-1', bundleId: 'shared-bundle', costUSD: 4, createdAt: '2026-11-01T12:00:00Z' }), B);
  await store.insertRun(makeRun({ runId: 'none-1', bundleId: 'shared-bundle', costUSD: 8, createdAt: '2026-11-01T13:00:00Z' }));
  await store.insertRun(makeRun({ runId: 'none-2', costUSD: 16, createdAt: '2026-11-01T14:00:00Z' }), { owner: null });

  const ids = (runs: RunRecord[]) => runs.map(run => run.runId);

  assert.deepEqual(ids(await store.listRuns({ scope: A })), ['a-2', 'a-1']);
  assert.deepEqual(ids(await store.listRuns({ scope: B })), ['b-1']);
  assert.deepEqual(ids(await store.listRuns({ scope: NO_VISITOR })), [], 'a caller with no visitor lists no run, the runs with no owner included');
  assert.deepEqual(ids(await store.listRuns()), ['none-2', 'none-1', 'b-1', 'a-2', 'a-1'], 'no scope lists every run');
  assert.deepEqual(ids(await store.listRuns({ scope: A, scenarioId: 'mars-genesis', bundleId: 'shared-bundle', q: 'mars' })), ['a-2', 'a-1'], 'the other filters work inside the scope');

  assert.equal(await store.countRuns!({ scope: A }), 2);
  assert.equal(await store.countRuns!({ scope: NO_VISITOR }), 0);
  assert.equal(await store.countRuns!(), 5);

  assert.deepEqual(await store.aggregateStats!({ scope: A }), { totalRuns: 2, totalCostUSD: 3, totalDurationMs: 0, replaysAttempted: 0, replaysMatched: 0 });
  assert.equal((await store.aggregateStats!({ scope: B })).totalCostUSD, 4);
  assert.equal((await store.aggregateStats!({ scope: NO_VISITOR })).totalRuns, 0);
  assert.equal((await store.aggregateStats!()).totalCostUSD, 31);

  assert.equal((await store.getRun('a-1', A))?.runId, 'a-1');
  assert.equal(await store.getRun('a-1', B), null, 'a run under another key is not found');
  assert.equal(await store.getRun('a-1', NO_VISITOR), null);
  assert.equal(await store.getRun('none-1', A), null, 'a run with no owner is not found by a scope');
  assert.equal(await store.getRun('none-1', NO_VISITOR), null);
  assert.equal((await store.getRun('none-1'))?.runId, 'none-1', 'no scope finds every run');
  assert.equal((await store.getRun('a-1'))?.runId, 'a-1');

  assert.deepEqual(ids(await store.listRunsByBundleId!('shared-bundle', A)), ['a-1', 'a-2']);
  assert.deepEqual(ids(await store.listRunsByBundleId!('shared-bundle', B)), ['b-1']);
  assert.deepEqual(ids(await store.listRunsByBundleId!('shared-bundle', NO_VISITOR)), []);
  assert.deepEqual(ids(await store.listRunsByBundleId!('shared-bundle')), ['a-1', 'a-2', 'b-1', 'none-1']);

  assert.ok(!('owner' in (await store.getRun('a-1'))!), 'a record read back holds no owner field');
});

test('a runs table made before the owner column gets it on boot, and its rows have no owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-sqlite-owner-'));
  const dbPath = join(dir, 'runs.db');
  // The table as the store made it before runs had owners.
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE runs (
      run_id              TEXT PRIMARY KEY NOT NULL,
      created_at          TEXT NOT NULL,
      scenario_id         TEXT NOT NULL,
      scenario_version    TEXT NOT NULL,
      actor_config_hash   TEXT NOT NULL,
      economics_profile   TEXT NOT NULL,
      source_mode         TEXT NOT NULL,
      created_by          TEXT NOT NULL,
      artifact_path       TEXT,
      cost_usd            REAL,
      duration_ms         INTEGER,
      mode                TEXT,
      actor_name          TEXT,
      actor_archetype     TEXT,
      replay_attempts     INTEGER DEFAULT 0,
      replay_matches      INTEGER DEFAULT 0,
      bundle_id           TEXT,
      summary_trajectory  TEXT,
      session_id          TEXT
    );
  `);
  seed.prepare(`
    INSERT INTO runs
      (run_id, created_at, scenario_id, scenario_version, actor_config_hash, economics_profile, source_mode, created_by)
    VALUES
      ('before-owners', '2026-11-01T00:00:00Z', 'mars-genesis', '0.4.88', 'leaders:before', 'balanced', 'hosted_demo', 'anonymous')
  `).run();
  seed.close();

  try {
    const store = createSqliteRunHistoryStore({ dbPath });
    assert.equal((await store.getRun('before-owners'))?.runId, 'before-owners', 'the row is kept and found with no scope');
    assert.equal(await store.getRun('before-owners', A), null, 'no visitor\'s scope finds it');
    assert.deepEqual(await store.listRuns({ scope: A }), []);

    await store.insertRun(makeRun({ runId: 'after-owners' }), A);
    assert.deepEqual((await store.listRuns({ scope: A })).map(run => run.runId), ['after-owners'], 'a run recorded after the boot is its visitor\'s');
    assert.equal(await store.getRun('after-owners', B), null);

    // A second boot of the same file adds nothing and loses nothing.
    const again = createSqliteRunHistoryStore({ dbPath });
    assert.deepEqual((await again.listRuns({ scope: A })).map(run => run.runId), ['after-owners']);
    assert.equal((await again.listRuns()).length, 2);

    const check = new Database(dbPath, { readonly: true });
    const columns = (check.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>).map(c => c.name);
    const indexes = (check.prepare('PRAGMA index_list(runs)').all() as Array<{ name: string }>).map(i => i.name);
    check.close();
    assert.ok(columns.includes('owner'), 'the table has the owner column');
    assert.ok(indexes.includes('idx_runs_owner_created'), 'and the index the list filters by');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
