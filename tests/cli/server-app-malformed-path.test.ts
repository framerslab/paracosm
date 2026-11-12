/**
 * A request path the server cannot read gets an answer, and the server
 * goes on answering. A percent escape that decodes to no text answers 400
 * on the routes that read an id from the path; a path the URL parser
 * refuses falls through to 404; and an error inside any route answers 500
 * instead of leaving the request unanswered.
 *
 * Every test sends its requests over HTTP to createMarsServer and then asks
 * GET /health, which must still answer 200.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { startServer, waitFor, type RunServer } from './helpers/run-server.js';

const TOKEN = 'malformed-path-test-token';

/** One request with a deadline, so a request the server never answers fails the test instead of hanging it. */
function send(base: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
}

async function assertHealthy(api: RunServer): Promise<void> {
  const res = await send(api.base, '/health');
  assert.equal(res.status, 200, 'GET /health still answers');
}

async function withServer(body: (api: RunServer) => Promise<void>, options: Parameters<typeof startServer>[0] = {}): Promise<void> {
  const api = await startServer(options);
  try {
    await body(api);
  } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
  }
}

test('GET // falls through to 404 and the server keeps answering', async () => {
  await withServer(async (api) => {
    const res = await send(api.base, '//');
    assert.equal(res.status, 404);
    await assertHealthy(api);
  });
});

for (const escape of ['%E0', '%ZZ', '%']) {
  test(`GET /scenarios/${escape} answers 400 and the server keeps answering`, async () => {
    await withServer(async (api) => {
      const res = await send(api.base, `/scenarios/${escape}`);
      assert.equal(res.status, 400);
      await assertHealthy(api);
    });
  });
}

test('POST /scenarios/%E0/rename from the admin answers 400 and the server keeps answering', async () => {
  await withServer(async (api) => {
    const res = await send(api.base, '/scenarios/%E0/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
      body: JSON.stringify({ name: 'x' }),
    });
    assert.equal(res.status, 400);
    await assertHealthy(api);
  }, { env: { ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN } });
});

test('GET /api/v1/bundles/%E0 answers 400 and the server keeps answering', async () => {
  await withServer(async (api) => {
    const res = await send(api.base, '/api/v1/bundles/%E0');
    assert.equal(res.status, 400);
    await assertHealthy(api);
  }, { env: { PARACOSM_ENABLE_RUN_HISTORY_ROUTES: 'true' } });
});

test('a route that throws answers 500 and the server keeps answering', async () => {
  // A compiled scenario whose presets is an object, not a list: the detail
  // route reads it as a list.
  const root = mkdtempSync(join(tmpdir(), 'paracosm-malformed-path-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  const raw = JSON.parse(readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8')) as Record<string, unknown>;
  const { hooks: _hooks, ...rest } = raw;
  writeFileSync(join(scenarioDir, 'compiled', 'odd-presets.json'), JSON.stringify({
    ...rest,
    id: 'odd-presets',
    presets: {},
    _persistMeta: { compiledAt: '2026-11-01T00:00:00.000Z', seedText: null },
  }));
  try {
    await withServer(async (api) => {
      await waitFor(async () => {
        const list = await (await send(api.base, '/scenarios')).json() as { scenarios: Array<{ id: string }> };
        return list.scenarios.some(s => s.id === 'odd-presets');
      }, 'the draft to enter the catalog', 5000);
      const res = await send(api.base, '/scenarios/odd-presets');
      assert.equal(res.status, 500);
      await assertHealthy(api);
    }, {
      scenarioDir,
      compileScenario: async (json) => ({ ...(json as object), hooks: {} }) as unknown as ScenarioPackage,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
