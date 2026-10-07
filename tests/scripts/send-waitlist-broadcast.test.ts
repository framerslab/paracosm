import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');

/** Runs Node with tsx from the repository root, the way the script is run by hand. */
function runNode(args: string[], env: NodeJS.ProcessEnv) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.STORAGE_ADAPTER;
  return spawnSync(process.execPath, ['--import', 'tsx', ...args], { cwd: root, env: childEnv, encoding: 'utf8' });
}

test('the waitlist broadcast script lists its recipients in a dry run', () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-broadcast-'));
  try {
    // Seed the database in a child process that exits, so this process holds no open handle.
    const seed = runNode(
      [
        '--input-type=module',
        '-e',
        `const { createWaitlistStore } = await import(${JSON.stringify(pathToFileURL(resolve(root, 'src/server/stores/waitlist.ts')).href)});
         const store = createWaitlistStore({ dbPath: process.env.SEED_DB });
         await store.insertOrGetExisting({ email: 'reader@example.com', name: 'Reader' });
         process.exit(0);`,
      ],
      { SEED_DB: join(appDir, 'data', 'waitlist.db') },
    );
    assert.equal(seed.status, 0, seed.stderr);

    const result = runNode(['scripts/send-waitlist-broadcast.ts', '--dry-run'], { APP_DIR: appDir, RESEND_API_KEY: '' });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[broadcast\] 1\/1 recipients selected/);
    assert.match(result.stdout, /\[dry-run\] would send to reader@example\.com/);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});
