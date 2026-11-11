/**
 * The output-retention sweep and the admin wipe of output files reach
 * the copies the library import writes. Both read the runs directory
 * the import writes to (`PARACOSM_OUTPUT_DIR`, else `<cwd>/output`),
 * not a directory of their own under APP_DIR.
 *
 * Runs the real server: the import through POST /api/v1/library/import,
 * the wipe through POST /admin/data/wipe, the sweep at boot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarsServer, type MarsServer } from '../../src/server/server-app.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const turnLoopArtifact = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/runArtifact-v0.8-turn-loop.json'), 'utf-8'),
);

const ADMIN_TOKEN = 'cleanup-test-admin-token';

/**
 * APP_DIR and the runs directory are separate trees, so a sweep or a
 * wipe that looks under APP_DIR/output finds nothing there.
 */
function dirs(): { appDir: string; runsDir: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'paracosm-import-cleanup-'));
  const appDir = join(base, 'app');
  const runsDir = join(base, 'runs');
  mkdirSync(join(appDir, 'output'), { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  return { appDir, runsDir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function serverFor(appDir: string, runsDir: string): MarsServer {
  // The run writer and the import read the process environment; the
  // server reads the env it is given. Both name the same directory.
  process.env.PARACOSM_OUTPUT_DIR = runsDir;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DIR: appDir,
    PARACOSM_OUTPUT_DIR: runsDir,
    PARACOSM_ENABLE_RUN_HISTORY_ROUTES: 'true',
    OUTPUT_RETENTION_DAYS: '30',
    ADMIN_WRITE: 'true',
    ADMIN_TOKEN,
  };
  return createMarsServer({
    env,
    runPairSimulations: async () => {},
    runHistoryStore: createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } }),
  });
}

async function listen(server: MarsServer): Promise<number> {
  server.listen(0);
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

async function close(server: MarsServer): Promise<void> {
  server.close();
  await once(server, 'close');
}

async function importFixture(port: number): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/library/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifact: turnLoopArtifact }),
  });
  assert.equal(res.status, 201, await res.text());
}

function importedCopies(runsDir: string): string[] {
  return readdirSync(runsDir).filter((name) => name.startsWith('v3-imported-') && name.endsWith('.json'));
}

test('the admin wipe of output files removes an imported copy from the runs directory', async () => {
  const { appDir, runsDir, cleanup } = dirs();
  const server = serverFor(appDir, runsDir);
  const port = await listen(server);
  try {
    await importFixture(port);
    assert.equal(importedCopies(runsDir).length, 1, 'the import wrote its copy under the runs directory');

    const res = await fetch(`http://127.0.0.1:${port}/admin/data/wipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
      body: JSON.stringify({ wipeOutput: true }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const { wiped } = (await res.json()) as { wiped: { outputFiles: number } };
    assert.equal(wiped.outputFiles, 1);
    assert.deepEqual(importedCopies(runsDir), []);
  } finally {
    await close(server);
    cleanup();
  }
});

test('the retention sweep at boot removes an imported copy older than OUTPUT_RETENTION_DAYS', async () => {
  const { appDir, runsDir, cleanup } = dirs();
  const first = serverFor(appDir, runsDir);
  const port = await listen(first);
  try {
    await importFixture(port);
  } finally {
    await close(first);
  }
  const [copy] = importedCopies(runsDir);
  assert.ok(copy, 'the import wrote its copy under the runs directory');
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  utimesSync(join(runsDir, copy), fortyDaysAgo, fortyDaysAgo);

  const second = serverFor(appDir, runsDir);
  try {
    assert.deepEqual(importedCopies(runsDir), [], 'the boot sweep removed the 40-day-old copy');
  } finally {
    second.close();
    cleanup();
  }
});
