import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpawnSyncReturns } from 'node:child_process';

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
  assert.equal(
    isUnservedTarball('npm error 404 Not Found - GET https://registry.npmjs.org/@framers/agentos/-/agentos-0.21.2.tgz - Not found'),
    true,
  );
  assert.equal(isUnservedTarball(UNLISTED), false);
  assert.equal(isUnservedTarball('npm error code E401\nnpm error 401 Unauthorized - GET https://registry.npmjs.org/resend'), false);
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
