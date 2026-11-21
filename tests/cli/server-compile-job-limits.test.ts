import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { _resetCompileJobsForTest } from '../../src/server/routes/quickstart.js';
import { mars, withVisitors, type RunServerOptions } from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

const route = '/api/quickstart/compile-from-seed';
const deadlineError = 'The compile did not finish in 10 minutes. Try again.';
const notFound = { error: 'Compile job not found. It may have expired (10-minute TTL) or never existed.' };

function start(visitor: Visitor, variant: number) {
  const seedText = `Station ${variant} plans the crew, supplies and repairs for its next season. `.repeat(5);
  return visitor.post(route, { seedText });
}

async function startJob(visitor: Visitor, variant: number): Promise<string> {
  const response = await start(visitor, variant);
  assert.equal(response.status, 202);
  const { jobId } = await response.json();
  assert.equal(typeof jobId, 'string');
  return jobId;
}

async function status(visitor: Visitor, jobId: string) {
  const response = await visitor.post(`${route}/status`, { jobId });
  assert.equal(response.status, 200);
  const { status, error, scenarioId } = await response.json();
  return { status, error, scenarioId };
}

async function withJobs(t: TestContext, body: (
  visitor: Visitor,
  scenarioDir: string,
  finishFirst: (id: string) => Promise<void>,
  failFirst: (message: string) => Promise<void>,
  finishAll: () => Promise<void>,
) => Promise<void>, options: RunServerOptions = {}) {
  _resetCompileJobsForTest();
  const scenarioDir = mkdtempSync(join(tmpdir(), 'paracosm-compile-jobs-'));
  const pending: Array<{ finish: (id: string) => void; fail: (message: string) => void }> = [];
  const compileFromSeed = () => new Promise((resolve, reject) => {
    pending.push({
      finish: id => resolve({ ...mars, id, hooks: {} }),
      fail: message => reject(new Error(message)),
    });
  });
  try {
    await withVisitors(async api => {
      await body(api.cookied(), scenarioDir, async id => {
        pending[0].finish(id);
        await setImmediate();
      }, async message => {
        pending[0].fail(message);
        await setImmediate();
      }, async () => {
        pending.splice(0).forEach((job, index) => job.finish(`settled-${index}`));
        await setImmediate();
      });
    }, { ...options, scenarioDir, extra: { compileFromSeed } });
  } finally {
    t.mock.timers.reset();
    _resetCompileJobsForTest();
    rmSync(scenarioDir, { recursive: true, force: true });
  }
}

function passDeadline(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(10 * 60_000 + 1);
}

async function installation(visitor: Visitor, scenarioDir: string, id: string) {
  const { scenarios } = await visitor.json<{ scenarios: Array<{ id: string }> }>('/scenarios');
  return {
    listed: scenarios.some(scenario => scenario.id === id),
    saved: existsSync(join(scenarioDir, 'compiled', `${id}.json`)),
  };
}

test('at most four compiles from a brief are pending in local mode, and a pending one ends after ten minutes', async t => {
  await withJobs(t, async (visitor, scenarioDir, finishFirst) => {
    const first = await startJob(visitor, 1);
    for (let variant = 2; variant <= 4; variant++) await startJob(visitor, variant);
    const fifth = await start(visitor, 5);
    assert.equal(fifth.status, 503);
    assert.equal(fifth.headers.get('Retry-After'), '60');
    assert.deepEqual(await fifth.json(), {
      error: 'The server is compiling 4 scenarios right now, the most it compiles at once. Try again in a minute.',
    });

    passDeadline(t);
    assert.deepEqual(await status(visitor, first), { status: 'error', error: deadlineError, scenarioId: undefined });
    await startJob(visitor, 6);
    await finishFirst('late-1');
    assert.deepEqual(await installation(visitor, scenarioDir, 'late-1'), { listed: false, saved: false });
  });
});

test('a compile that settles after ten minutes with no request between installs nothing', async t => {
  await withJobs(t, async (visitor, scenarioDir, finishFirst) => {
    const first = await startJob(visitor, 1);
    passDeadline(t);
    await finishFirst('late-0');
    assert.deepEqual({
      ...await installation(visitor, scenarioDir, 'late-0'),
      ...await status(visitor, first),
    }, { listed: false, saved: false, status: 'error', error: deadlineError, scenarioId: undefined });

    t.mock.timers.tick(10 * 60_000 + 1);
    const swept = await visitor.post(`${route}/status`, { jobId: first });
    assert.equal(swept.status, 404);
    assert.deepEqual(await swept.json(), notFound);
  });
});

test('a compile that fails after ten minutes with no request between answers the deadline error', async t => {
  await withJobs(t, async (visitor, _scenarioDir, _finishFirst, failFirst) => {
    const first = await startJob(visitor, 1);
    passDeadline(t);
    await failFirst('model down');
    assert.deepEqual(await status(visitor, first), { status: 'error', error: deadlineError, scenarioId: undefined });
  });
});

test('on the hosted demo a start refused for four pending compiles does not use the daily compile allowance', async t => {
  await withJobs(t, async (visitor, _scenarioDir, _finishFirst, _failFirst, finishAll) => {
    const statuses: number[] = [];
    const startAndRead = async (variant: number) => {
      const response = await start(visitor, variant);
      await response.text();
      statuses.push(response.status);
    };
    for (let variant = 1; variant <= 6; variant++) await startAndRead(variant);
    // The hosted demo allows five compiles from a brief a day. Four are charged so far, so once the
    // pending ones finish, one more start is admitted and the next is refused for the day.
    await finishAll();
    for (let variant = 7; variant <= 8; variant++) await startAndRead(variant);
    assert.deepEqual(statuses, [202, 202, 202, 202, 503, 503, 202, 429]);
    // maxSimsPerDay above 0 makes the server create its rate limiter, which holds the daily
    // compile allowance; with the test helper's default of 0 there is no limiter at all.
  }, { maxSimsPerDay: 1, env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test' } });
});
