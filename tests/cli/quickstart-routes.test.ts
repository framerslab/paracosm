import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleFetchSeed, handleCompileFromSeed, handleCompileFromSeedStatus,
  handleGenerateActors,
  _resetCompileJobsForTest,
  type QuickstartDeps,
} from '../../src/server/routes/quickstart.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

function fakeRes() {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const res = {
    writeHead: (s: number, h?: Record<string, string>) => { status = s; if (h) headers = h; },
    end: (b?: string) => { if (b) body = b; },
  } as unknown as ServerResponse;
  return {
    res,
    get: () => ({
      status,
      headers,
      body: body ? JSON.parse(body) : null,
    }),
  };
}

function fakeDeps(overrides: Partial<QuickstartDeps> = {}): QuickstartDeps {
  return {
    setActiveScenario: () => {},
    getScenarioById: (id) => id === marsScenario.id ? marsScenario : undefined,
    fetchSeedFromUrl: async () => ({ text: 'test content', title: 'T', sourceUrl: 'https://x.test' }),
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    ...overrides,
  };
}

test('fetch-seed: valid URL returns fetched content', async () => {
  const { res, get } = fakeRes();
  await handleFetchSeed({} as IncomingMessage, res, { url: 'https://example.com/article' }, fakeDeps());
  const r = get();
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'test content');
  assert.equal(r.body.truncated, false);
});

test('fetch-seed: invalid URL rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleFetchSeed({} as IncomingMessage, res, { url: 'not a url' }, fakeDeps());
  assert.equal(get().status, 400);
});

test('fetch-seed: non-http scheme rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleFetchSeed({} as IncomingMessage, res, { url: 'ftp://example.com/file' }, fakeDeps());
  assert.equal(get().status, 400);
});

test('fetch-seed: fetch failure surfaces as 502', async () => {
  const { res, get } = fakeRes();
  const deps = fakeDeps({
    fetchSeedFromUrl: async () => { throw new Error('network fail'); },
  });
  await handleFetchSeed({} as IncomingMessage, res, { url: 'https://example.com' }, deps);
  assert.equal(get().status, 502);
});

test('fetch-seed: oversized content is truncated with flag', async () => {
  const { res, get } = fakeRes();
  const deps = fakeDeps({
    fetchSeedFromUrl: async () => ({ text: 'x'.repeat(60_000), title: 'T', sourceUrl: 'https://x.test' }),
  });
  await handleFetchSeed({} as IncomingMessage, res, { url: 'https://example.com' }, deps);
  const r = get();
  assert.equal(r.status, 200);
  assert.equal(r.body.text.length, 50_000);
  assert.equal(r.body.truncated, true);
});

test('compile-from-seed: too-short seed rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, res, { seedText: 'short' }, fakeDeps());
  assert.equal(get().status, 400);
});

test('compile-from-seed: too-long seed rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, res, { seedText: 'x'.repeat(60_000) }, fakeDeps());
  assert.equal(get().status, 400);
});

test('generate-leaders: unknown scenarioId returns 404', async () => {
  const { res, get } = fakeRes();
  await handleGenerateActors({} as IncomingMessage, res, { scenarioId: 'unknown-xyz-scenario', count: 3 }, fakeDeps());
  assert.equal(get().status, 404);
});

test('generate-leaders: count < 2 rejected', async () => {
  const { res, get } = fakeRes();
  await handleGenerateActors({} as IncomingMessage, res, { scenarioId: marsScenario.id, count: 1 }, fakeDeps());
  assert.equal(get().status, 400);
});

test('generate-leaders: count > 300 rejected (cohort batch cap)', async () => {
  const { res, get } = fakeRes();
  await handleGenerateActors({} as IncomingMessage, res, { scenarioId: marsScenario.id, count: 301 }, fakeDeps());
  assert.equal(get().status, 400);
});

test('generate-leaders: count up to 300 accepted', async () => {
  const { res, get } = fakeRes();
  // 300 is the cohort cap, raised from 50 once the batch runner gained
  // a real concurrency limiter (economics.batch.maxConcurrency). Schema
  // validation must accept 300; downstream 404/500 paths still depend
  // on the test deps and are not a schema concern.
  await handleGenerateActors({} as IncomingMessage, res, { scenarioId: marsScenario.id, count: 300 }, fakeDeps());
  assert.notEqual(get().status, 400);
});

// ---------------------------------------------------------------------
// Async-job pattern for compile-from-seed
// ---------------------------------------------------------------------
// These tests exercise the start + status state machine without the
// real compile pipeline. `deps.compileFn` injects a fast deterministic
// stub so we can verify dedupe, status transitions, and TTL behavior.

const ASYNC_TEST_SCENARIO = {
  ...marsScenario,
  id: 'async-test-scenario',
} as ScenarioPackage;

const VALID_SEED = 'a'.repeat(220);

/** Returns a deferred promise + its resolve/reject so a test can step
 *  the compile state machine deterministically. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('compile-from-seed: start returns 202 + jobId for new compile', async () => {
  _resetCompileJobsForTest();
  const compileFn = (() => new Promise(() => { /* never resolves */ })) as unknown as QuickstartDeps['compileFn'];
  const { res, get } = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, res, { seedText: VALID_SEED }, fakeDeps({ compileFn }));
  const r = get();
  assert.equal(r.status, 202);
  assert.equal(r.body.status, 'pending');
  assert.ok(typeof r.body.jobId === 'string' && r.body.jobId.length > 0);
});

test('compile-from-seed: dedupes pending compile by signature', async () => {
  _resetCompileJobsForTest();
  let callCount = 0;
  const compileFn = ((async () => {
    callCount++;
    return await new Promise(() => { /* never resolves */ });
  }) as unknown) as QuickstartDeps['compileFn'];
  const deps = fakeDeps({ compileFn });
  const r1 = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, r1.res, { seedText: VALID_SEED }, deps);
  const r2 = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, r2.res, { seedText: VALID_SEED }, deps);
  assert.equal(r1.get().body.jobId, r2.get().body.jobId, 'same signature should dedupe to same jobId');
  assert.equal(callCount, 1, 'compile should run only once across duplicate submissions');
});

test('compile-from-seed: status returns done with scenario after compile resolves', async () => {
  _resetCompileJobsForTest();
  const d = deferred<ScenarioPackage>();
  const installed: ScenarioPackage[] = [];
  const deps = fakeDeps({
    compileFn: (() => d.promise) as unknown as QuickstartDeps['compileFn'],
    setActiveScenario: (sc) => { installed.push(sc); },
  });
  const start = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, start.res, { seedText: VALID_SEED }, deps);
  const jobId = start.get().body.jobId;
  // Resolve the compile and let microtasks flush so the .then handler
  // installs the scenario on the job before we poll status.
  d.resolve(ASYNC_TEST_SCENARIO);
  await new Promise((r) => setTimeout(r, 0));
  const status = fakeRes();
  await handleCompileFromSeedStatus({} as IncomingMessage, status.res, { jobId }, deps);
  const sr = status.get();
  assert.equal(sr.status, 200);
  assert.equal(sr.body.status, 'done');
  assert.equal(sr.body.scenarioId, ASYNC_TEST_SCENARIO.id);
  assert.equal(installed[0]?.id, ASYNC_TEST_SCENARIO.id, 'setActiveScenario should fire when compile resolves');
});

test('compile-from-seed: status returns error when compile rejects', async () => {
  _resetCompileJobsForTest();
  const d = deferred<ScenarioPackage>();
  const deps = fakeDeps({
    compileFn: (() => d.promise) as unknown as QuickstartDeps['compileFn'],
  });
  const start = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, start.res, { seedText: VALID_SEED }, deps);
  const jobId = start.get().body.jobId;
  d.reject(new Error('simulated compile failure'));
  await new Promise((r) => setTimeout(r, 0));
  const status = fakeRes();
  await handleCompileFromSeedStatus({} as IncomingMessage, status.res, { jobId }, deps);
  const sr = status.get();
  assert.equal(sr.status, 200);
  assert.equal(sr.body.status, 'error');
  assert.match(sr.body.error, /simulated compile failure/);
});

test('compile-from-seed: second start after error reuses path with new jobId', async () => {
  _resetCompileJobsForTest();
  const failOnce = deferred<ScenarioPackage>();
  let attempt = 0;
  const compileFn = ((async () => {
    attempt++;
    if (attempt === 1) return await failOnce.promise;
    return await new Promise(() => { /* second attempt hangs */ });
  }) as unknown) as QuickstartDeps['compileFn'];
  const deps = fakeDeps({ compileFn });
  const r1 = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, r1.res, { seedText: VALID_SEED }, deps);
  const firstJobId = r1.get().body.jobId;
  failOnce.reject(new Error('boom'));
  await new Promise((r) => setTimeout(r, 0));
  const r2 = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, r2.res, { seedText: VALID_SEED }, deps);
  const secondJobId = r2.get().body.jobId;
  assert.notEqual(firstJobId, secondJobId, 'errored jobs must not block retries');
  assert.equal(attempt, 2, 'retry should kick off a fresh compile');
});

test('compile-from-seed: cache-hit start returns scenario inline (200, not 202)', async () => {
  _resetCompileJobsForTest();
  const d = deferred<ScenarioPackage>();
  const deps = fakeDeps({
    compileFn: (() => d.promise) as unknown as QuickstartDeps['compileFn'],
  });
  const r1 = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, r1.res, { seedText: VALID_SEED }, deps);
  d.resolve(ASYNC_TEST_SCENARIO);
  await new Promise((r) => setTimeout(r, 0));
  const r2 = fakeRes();
  await handleCompileFromSeed({} as IncomingMessage, r2.res, { seedText: VALID_SEED }, deps);
  const r2body = r2.get();
  assert.equal(r2body.status, 200, 'resolved cache should respond 200, not 202');
  assert.equal(r2body.body.status, 'done');
  assert.equal(r2body.body.scenarioId, ASYNC_TEST_SCENARIO.id);
});

test('compile-from-seed/status: unknown jobId returns 404', async () => {
  _resetCompileJobsForTest();
  const { res, get } = fakeRes();
  await handleCompileFromSeedStatus({} as IncomingMessage, res, { jobId: 'nonexistent' }, fakeDeps());
  assert.equal(get().status, 404);
});

test('compile-from-seed/status: missing jobId returns 400', async () => {
  _resetCompileJobsForTest();
  const { res, get } = fakeRes();
  await handleCompileFromSeedStatus({} as IncomingMessage, res, {}, fakeDeps());
  assert.equal(get().status, 400);
});
