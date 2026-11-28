import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { isUnservedTarball, npmWithRetry } from '../../scripts/npm-install-retry.mjs';

/**
 * npm's error output in release run 46031084476: its package check installed resend 6.41.0
 * 84 seconds after it was published, and the registry listed the version but did not serve its
 * tarball yet.
 */
const UNSERVED = [
  'npm error code E404',
  'npm error 404 Not Found - GET https://registry.npmjs.org/resend/-/resend-6.41.0.tgz - Not found',
  'npm error 404',
  "npm error 404  The requested resource 'resend@https://registry.npmjs.org/resend/-/resend-6.41.0.tgz' could not be found or you do not have permission to access it.",
].join('\n');

/** A package the registry does not list at all: waiting does not help. */
const UNLISTED = [
  'npm error code E404',
  'npm error 404 Not Found - GET https://registry.npmjs.org/no-such-package-for-paracosm - Not found',
].join('\n');

function answer(status: number, stderr = ''): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout: '', stderr, status, signal: null };
}

/** npmWithRetry with a scripted npm: each call takes the next answer; waits and calls are recorded. */
function scripted(answers: SpawnSyncReturns<string>[], tries?: number) {
  const calls: string[][] = [];
  const waits: number[] = [];
  const run = () => npmWithRetry(['install', 'paracosm-0.9.1181.tgz', '--no-audit', '--no-fund'], {
    cwd: '/tmp/paracosm-package-smoke',
    tries,
    waitMs: 30_000,
    run: (command, args) => {
      calls.push([command, ...args]);
      const next = answers.shift();
      assert.ok(next, 'npm was run more times than the test scripted');
      return next;
    },
    sleep: (ms) => {
      waits.push(ms);
    },
    log: () => {},
    writeStderr: () => {},
  });
  return { run, calls, waits };
}

test('an unserved tarball, the 404 of a version published moments ago, is the one failure run again', () => {
  assert.equal(isUnservedTarball(UNSERVED), true);
  assert.equal(isUnservedTarball(UNSERVED.replaceAll('npm error', 'npm ERR!')), true);
  const scoped = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@framers/agentos/-/agentos-0.21.2.tgz - Not found';
  assert.equal(isUnservedTarball(scoped), true);
  assert.equal(isUnservedTarball(scoped.replace('@framers/', '@framers%2f')), true);
  assert.equal(isUnservedTarball(scoped.replace('registry.npmjs.org', 'npm.example.com')), false);
  assert.equal(isUnservedTarball(UNLISTED), false);
  assert.equal(isUnservedTarball('npm error code E401\nnpm error 401 Unauthorized - GET https://registry.npmjs.org/resend'), false);
  assert.equal(isUnservedTarball('npm error code E403\nnpm error 403 Forbidden - GET https://registry.npmjs.org/resend/-/resend-6.41.0.tgz'), false);
  assert.equal(isUnservedTarball(''), false);
  assert.equal(isUnservedTarball(undefined), false);
});

test('an install that meets an unserved tarball waits and runs again until npm succeeds', () => {
  const { run, calls, waits } = scripted([answer(1, UNSERVED), answer(1, UNSERVED), answer(0)]);
  assert.equal(run(), 3);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.deepEqual(call, ['npm', 'install', 'paracosm-0.9.1181.tgz', '--no-audit', '--no-fund']);
  assert.deepEqual(waits, [30_000, 30_000]);
});

test('an install that succeeds at once runs npm once and never waits', () => {
  const { run, calls, waits } = scripted([answer(0)]);
  assert.equal(run(), 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('any other failure is thrown at once, without a wait', () => {
  const { run, calls, waits } = scripted([answer(1, UNLISTED)]);
  assert.throws(run, /Command failed: npm install paracosm-0\.9\.1181\.tgz --no-audit --no-fund \(exit 1\)/);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test('a tarball still unserved at the last try fails the install', () => {
  const { run, calls, waits } = scripted([answer(1, UNSERVED), answer(1, UNSERVED), answer(1, UNSERVED)], 3);
  assert.throws(run, /Command failed: npm install .* \(exit 1\)/);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [30_000, 30_000]);
});

test('npm that cannot start is thrown as its own error', () => {
  const missing = Object.assign(new Error('spawnSync npm ENOENT'), { code: 'ENOENT' });
  const { run } = scripted([{ ...answer(0), status: null, error: missing }]);
  assert.throws(run, /spawnSync npm ENOENT/);
});

/** Put a controlled npm executable on PATH for a test of the real child-process path. */
function npmFixture(t: TestContext, source: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'paracosm-npm-retry-'));
  const path = process.env.PATH;
  t.after(() => {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    rmSync(cwd, { force: true, recursive: true });
  });
  writeFileSync(join(cwd, 'npm'), `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
  process.env.PATH = [cwd, path].filter(Boolean).join(delimiter);
  return cwd;
}

test('a lifecycle command failure that prints a tarball 404 is thrown without retrying', async (t) => {
  const lifecycle = [
    'npm error code 1',
    'npm error path /tmp/paracosm-package-smoke/node_modules/fixture',
    'npm error command failed',
    'npm error command sh -c node postinstall.cjs',
    UNSERVED.split('\n')[1],
  ].join('\n');
  const cwd = npmFixture(t, `process.stderr.write(${JSON.stringify(lifecycle)}); process.exitCode = 1;`);
  const waits: number[] = [];
  await assert.rejects(async () => npmWithRetry(['ci', '--no-audit', '--no-fund'], {
    cwd,
    sleep: (ms) => { waits.push(ms); },
    log: () => {},
    writeStderr: () => {},
  }), /Command failed: npm ci --no-audit --no-fund/);
  assert.deepEqual(waits, []);
});

test('npm stderr reaches the caller while the child is still running', async (t) => {
  const warning = 'npm warn lifecycle waiting for acknowledgment\n';
  const cwd = npmFixture(t, `
    const fs = require('node:fs');
    process.stderr.write(${JSON.stringify(warning)});
    const interval = setInterval(() => {
      if (!fs.existsSync('ack')) return;
      clearInterval(interval);
      clearTimeout(deadline);
    }, 10);
    const deadline = setTimeout(() => {
      clearInterval(interval);
      process.exitCode = 88;
    }, 2000);
  `);
  let stderr = '';
  assert.equal(await npmWithRetry(['install'], {
    cwd,
    writeStderr: (text) => {
      stderr += text;
      if (stderr === warning) writeFileSync(join(cwd, 'ack'), '');
    },
  }), 1);
  assert.equal(stderr, warning);
});

test('npm killed by a signal after printing a tarball 404 is reported without retrying', async (t) => {
  const cwd = npmFixture(t, `
    process.stderr.write(${JSON.stringify(UNSERVED)}, () => process.kill(process.pid, 'SIGTERM'));
  `);
  const waits: number[] = [];
  await assert.rejects(async () => npmWithRetry(['install'], {
    cwd,
    sleep: (ms) => { waits.push(ms); },
    log: () => {},
    writeStderr: () => {},
  }), /Command failed: npm install \(signal SIGTERM\)/);
  assert.deepEqual(waits, []);
});
