/**
 * The dashboard and the mail scripts read `.env` from the working
 * directory and must agree on APP_DIR, since the scripts write the stores
 * under it that the dashboard reads (data/waitlist.db, data/mail.db). A
 * value in quotes is taken without them by both.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

test('the dashboard takes a quoted APP_DIR from .env without its quotes', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'paracosm-dotenv-cwd-'));
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-dotenv-app-'));
  writeFileSync(join(workDir, '.env'), `APP_DIR="${appDir}"\nPORT=0\n`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['APP_DIR', 'PORT', 'STORAGE_ADAPTER', 'DATABASE_URL']) delete env[name];
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), resolve(root, 'src/cli/serve.ts')], {
    cwd: workDir,
    env,
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  try {
    // The dashboard opens its saved-session store under APP_DIR when it starts.
    const sessions = join(appDir, 'data', 'sessions.db');
    const deadline = Date.now() + 20_000;
    while (!existsSync(sessions) && Date.now() < deadline && child.exitCode === null) {
      await new Promise((settle) => setTimeout(settle, 100));
    }
    assert.ok(existsSync(sessions), `the dashboard must use ${appDir} for APP_DIR; its output:\n${output.slice(-3000)}`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    rmSync(workDir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
  }
});
