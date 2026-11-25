import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** The command a script's Usage block gives, as the words an operator types: the first line naming the script and `flag`. */
function documentedCommand(script: string, flag = ''): [string, ...string[]] {
  const header = readFileSync(join(root, 'scripts', script), 'utf8');
  const line = header.split('\n').find((text) => text.startsWith(' *   ') && text.includes(`scripts/${script}`) && text.includes(flag));
  assert.ok(line, `${script} documents no command`);
  const [command, ...args] = line.slice(5).split(/\s+[<#]/)[0].trim().split(/\s+/);
  return [command, ...args];
}

/**
 * A tree laid out as a deploy leaves it on the server. The build artifact is a
 * zip, so every file comes out 0644 and no script keeps its execute bit.
 */
function deployedTree(): string {
  const tree = mkdtempSync(join(tmpdir(), 'paracosm-deployed-'));
  mkdirSync(join(tree, 'scripts'));
  for (const script of ['mail-suppress.ts', 'send-waitlist-broadcast.ts']) {
    copyFileSync(join(root, 'scripts', script), join(tree, 'scripts', script));
    chmodSync(join(tree, 'scripts', script), 0o644);
  }
  copyFileSync(join(root, 'package.json'), join(tree, 'package.json'));
  symlinkSync(join(root, 'src'), join(tree, 'src'));
  symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'));
  return tree;
}

test('the documented mail-suppress command runs on a deployed tree', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-suppress-direct-'));
  const tree = deployedTree();
  try {
    const [command, ...args] = documentedCommand('mail-suppress.ts');
    const result = await run(command, args, {
      cwd: tree,
      env: { ...envWithout('STORAGE_ADAPTER'), APP_DIR: appDir },
      stdin: 'person@example.com\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 address suppressed/);
    assert.ok(existsSync(join(appDir, 'data', 'mail.db')));
  } finally {
    rmSync(appDir, { recursive: true, force: true });
    rmSync(tree, { recursive: true, force: true });
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

test('the documented broadcast dry run runs on a deployed tree', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-broadcast-direct-'));
  const tree = deployedTree();
  try {
    const [command, ...args] = documentedCommand('send-waitlist-broadcast.ts', '--dry-run');
    const result = await run(command, args, {
      cwd: tree,
      env: { ...envWithout('STORAGE_ADAPTER'), APP_DIR: appDir, RESEND_API_KEY: '' },
    });
    // No signups exist, so the script stops at once; what matters is that the command starts.
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /waitlist\.db not found/);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
    rmSync(tree, { recursive: true, force: true });
  }
});
