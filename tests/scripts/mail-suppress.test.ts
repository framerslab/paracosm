import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..', '..');

/** Starts a command and resolves with its exit status and output; a command that cannot start resolves with its error. */
function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => done({ status: null, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (status) => done({ status, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin ?? '');
  });
}

function envWithout(...names: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of names) delete env[name];
  return env;
}

test('the documented command ./scripts/mail-suppress.ts runs as written', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-suppress-direct-'));
  try {
    const result = await run('./scripts/mail-suppress.ts', [], {
      cwd: root,
      env: { ...envWithout('STORAGE_ADAPTER'), APP_DIR: appDir },
      stdin: 'person@example.com\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 address suppressed/);
    assert.ok(existsSync(join(appDir, 'data', 'mail.db')));
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('mail-suppress reads APP_DIR from .env in the working directory, as the broadcast script does', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'paracosm-suppress-cwd-'));
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-suppress-app-'));
  try {
    writeFileSync(join(workDir, '.env'), `APP_DIR=${appDir}\n`);
    const result = await run(process.execPath, ['--import', import.meta.resolve('tsx'), resolve(root, 'scripts/mail-suppress.ts')], {
      cwd: workDir,
      env: envWithout('APP_DIR', 'STORAGE_ADAPTER'),
      stdin: 'person@example.com\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(appDir, 'data', 'mail.db')), 'the suppression must land in the APP_DIR that .env names');
    assert.equal(existsSync(join(workDir, 'data', 'mail.db')), false, 'nothing may be written under the working directory');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('the documented command ./scripts/send-waitlist-broadcast.ts --dry-run runs as written', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-broadcast-direct-'));
  try {
    const result = await run('./scripts/send-waitlist-broadcast.ts', ['--dry-run'], {
      cwd: root,
      env: { ...envWithout('STORAGE_ADAPTER'), APP_DIR: appDir, RESEND_API_KEY: '' },
    });
    // No signups exist, so the script stops at once; what matters is that the command starts.
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /waitlist\.db not found/);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});
