/**
 * The dashboard server keeps run history and saved sessions in SQLite
 * files under APP_DIR. Its stores call `createDatabase({ file })` from
 * `@framers/sql-storage-adapter`, which in Node tries better-sqlite3 and
 * then sql.js and ignores STORAGE_ADAPTER and DATABASE_URL. The README and
 * the stores' headers say so; this test fails if a version of the library
 * starts to honour those variables, so the text can be corrected with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';

test('STORAGE_ADAPTER and DATABASE_URL leave run history and saved sessions in SQLite files under APP_DIR', async () => {
  const saved = { STORAGE_ADAPTER: process.env.STORAGE_ADAPTER, DATABASE_URL: process.env.DATABASE_URL };
  // The storage library reads these from process.env, not from the env the server is given.
  // Nothing listens on port 9, so a Postgres connection attempt fails at once.
  process.env.STORAGE_ADAPTER = 'postgres';
  process.env.DATABASE_URL = 'postgres://paracosm:unused@127.0.0.1:9/unused';

  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-storage-'));
  const env: NodeJS.ProcessEnv = { ...process.env, APP_DIR: appDir, PARACOSM_ENABLE_RUN_HISTORY_ROUTES: 'true' };
  delete env.PARACOSM_DISABLE_RUN_HISTORY;
  delete env.PARACOSM_RUN_HISTORY_DB_PATH;
  const server = createMarsServer({ env, runPairSimulations: async () => {} });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  try {
    const sessions = await fetch(`http://127.0.0.1:${port}/sessions`);
    const sessionsBody = await sessions.text();
    assert.equal(sessions.status, 200, `GET /sessions answered ${sessions.status}: ${sessionsBody}`);

    const runs = await fetch(`http://127.0.0.1:${port}/api/v1/runs`);
    const runsBody = await runs.text();
    assert.equal(runs.status, 200, `GET /api/v1/runs answered ${runs.status}: ${runsBody}`);

    assert.ok(existsSync(join(appDir, 'data', 'sessions.db')), 'saved sessions belong in data/sessions.db');
    assert.ok(existsSync(join(appDir, 'data', 'runs.db')), 'run history belongs in data/runs.db');
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
