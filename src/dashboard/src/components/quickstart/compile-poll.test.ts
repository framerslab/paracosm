import test from 'node:test';
import assert from 'node:assert/strict';

import { compileScenarioWithPolling } from './compile-poll.js';
import type { ScenarioPackage } from '../../../../engine/types.js';

/**
 * Minimal scenario fixture — the helper never inspects scenario shape
 * beyond `.id`, so a structurally-typed stub is enough.
 */
const FIXTURE_SCENARIO = {
  id: 'scenario-test',
  setup: { defaultTurns: 6, defaultSeed: 42 },
  labels: {},
} as unknown as ScenarioPackage;

interface ScriptedResponse {
  status: number;
  body: unknown;
}

/**
 * Builds a fetch stub that returns scripted responses in order. Each
 * call consumes the next scripted entry; running off the end throws a
 * descriptive error so the test surface a misconfigured script.
 */
function scriptedFetch(responses: ScriptedResponse[]): {
  fetch: typeof fetch;
  callCount: () => number;
  calls: () => Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const stub = (async (url: string, init?: RequestInit) => {
    if (i >= responses.length) {
      throw new Error(`Unexpected fetch call #${i + 1} to ${url}`);
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const response = responses[i++];
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: stub, callCount: () => i, calls: () => calls };
}

const FAST_WAIT = async (_ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

test('compileScenarioWithPolling: cache hit returns scenario inline without polling', async () => {
  const { fetch, callCount } = scriptedFetch([
    {
      status: 200,
      body: { jobId: 'job-1', status: 'done', scenario: FIXTURE_SCENARIO, scenarioId: 'scenario-test' },
    },
  ]);
  const result = await compileScenarioWithPolling(
    { seedText: 'a'.repeat(220) },
    { fetchImpl: fetch, waitImpl: FAST_WAIT },
  );
  assert.equal(result.scenarioId, 'scenario-test');
  assert.equal(result.jobId, 'job-1');
  assert.equal(callCount(), 1, 'inline scenario response should skip status polls');
});

test('compileScenarioWithPolling: pending start polls until done', async () => {
  const { fetch, callCount, calls } = scriptedFetch([
    { status: 202, body: { jobId: 'job-2', status: 'pending' } },
    { status: 200, body: { jobId: 'job-2', status: 'pending' } },
    { status: 200, body: { jobId: 'job-2', status: 'pending' } },
    { status: 200, body: { jobId: 'job-2', status: 'done', scenario: FIXTURE_SCENARIO } },
  ]);
  const result = await compileScenarioWithPolling(
    { seedText: 'b'.repeat(220) },
    { fetchImpl: fetch, waitImpl: FAST_WAIT, pollIntervalMs: 1, timeoutMs: 60_000 },
  );
  assert.equal(result.scenarioId, 'scenario-test');
  assert.equal(callCount(), 4, 'should poll until status is done');
  assert.equal(calls()[0].url, '/api/quickstart/compile-from-seed');
  assert.equal(calls()[1].url, '/api/quickstart/compile-from-seed/status');
  assert.deepEqual(calls()[1].body, { jobId: 'job-2' });
});

test('compileScenarioWithPolling: error status surfaces server error message', async () => {
  const { fetch } = scriptedFetch([
    { status: 202, body: { jobId: 'job-3', status: 'pending' } },
    { status: 200, body: { jobId: 'job-3', status: 'error', error: 'compile blew up' } },
  ]);
  await assert.rejects(
    compileScenarioWithPolling(
      { seedText: 'c'.repeat(220) },
      { fetchImpl: fetch, waitImpl: FAST_WAIT, pollIntervalMs: 1 },
    ),
    /compile blew up/,
  );
});

test('compileScenarioWithPolling: 404 on status surfaces expired-job error', async () => {
  const { fetch } = scriptedFetch([
    { status: 202, body: { jobId: 'job-4', status: 'pending' } },
    { status: 404, body: { error: 'Compile job not found' } },
  ]);
  await assert.rejects(
    compileScenarioWithPolling(
      { seedText: 'd'.repeat(220) },
      { fetchImpl: fetch, waitImpl: FAST_WAIT, pollIntervalMs: 1 },
    ),
    /expired or not found/,
  );
});

test('compileScenarioWithPolling: timeout throws when compile is too slow', async () => {
  // Script 100 pending responses; the timeout should trip before we
  // exhaust the script.
  const responses: ScriptedResponse[] = [
    { status: 202, body: { jobId: 'job-5', status: 'pending' } },
  ];
  for (let i = 0; i < 100; i++) {
    responses.push({ status: 200, body: { jobId: 'job-5', status: 'pending' } });
  }
  const { fetch } = scriptedFetch(responses);
  // Wait stub advances Date.now by pollIntervalMs each time so the
  // timeoutMs threshold is reached deterministically.
  let virtualTime = 0;
  const realNow = Date.now;
  Date.now = () => realNow.call(Date) + virtualTime;
  try {
    const advancingWait = async (ms: number) => { virtualTime += ms; };
    await assert.rejects(
      compileScenarioWithPolling(
        { seedText: 'e'.repeat(220) },
        {
          fetchImpl: fetch,
          waitImpl: advancingWait,
          pollIntervalMs: 1000,
          timeoutMs: 5000,
        },
      ),
      /taking longer than/,
    );
  } finally {
    Date.now = realNow;
  }
});

test('compileScenarioWithPolling: start error short-circuits before polling', async () => {
  const { fetch, callCount } = scriptedFetch([
    { status: 400, body: { error: 'Invalid compile-from-seed payload' } },
  ]);
  await assert.rejects(
    compileScenarioWithPolling(
      { seedText: 'f'.repeat(220) },
      { fetchImpl: fetch, waitImpl: FAST_WAIT },
    ),
    /Invalid compile-from-seed payload/,
  );
  assert.equal(callCount(), 1, 'start failure should not trigger any polls');
});

test('compileScenarioWithPolling: abort signal cancels polling', async () => {
  const responses: ScriptedResponse[] = [
    { status: 202, body: { jobId: 'job-6', status: 'pending' } },
  ];
  for (let i = 0; i < 5; i++) {
    responses.push({ status: 200, body: { jobId: 'job-6', status: 'pending' } });
  }
  const { fetch } = scriptedFetch(responses);
  const controller = new AbortController();
  // Abort before the second poll lands by failing the wait.
  let waitCount = 0;
  const abortingWait = async (_ms: number, signal?: AbortSignal): Promise<void> => {
    waitCount++;
    if (waitCount === 2) controller.abort();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  await assert.rejects(
    compileScenarioWithPolling(
      { seedText: 'g'.repeat(220) },
      {
        fetchImpl: fetch,
        waitImpl: abortingWait,
        pollIntervalMs: 1,
        timeoutMs: 60_000,
        signal: controller.signal,
      },
    ),
    /Aborted/,
  );
});
