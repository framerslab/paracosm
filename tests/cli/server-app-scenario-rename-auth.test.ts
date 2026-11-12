/**
 * POST /scenarios/:id/rename takes the admin credential the /admin/* routes
 * take (ADMIN_WRITE=true and an X-Admin-Token header matching ADMIN_TOKEN).
 * The rename changes the name every visitor sees and writes the scenario's
 * file under `<scenarioDir>/compiled/`, so a refused rename changes neither.
 *
 * Each test boots createMarsServer on a scenarios folder of its own holding
 * one persisted compiled draft; a stub compiler puts it in the catalog as a
 * compiled scenario, so no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { startServer, waitFor, type RunServer } from './helpers/run-server.js';

const TOKEN = 'rename-auth-test-token';
const ADMIN_ENV = { ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN };
const ID = 'visitor-compiled-scenario';
const NAME = 'A Visitor Scenario';

function draft(): string {
  const raw = JSON.parse(readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8')) as Record<string, unknown>;
  const { hooks: _hooks, ...rest } = raw;
  return JSON.stringify({
    ...rest,
    id: ID,
    labels: { ...(raw.labels as Record<string, unknown>), name: NAME },
    _persistMeta: { compiledAt: '2026-11-01T00:00:00.000Z', seedText: null },
  });
}

interface Box { api: RunServer; file: string }

async function withCompiledScenario(env: Record<string, string>, body: (box: Box) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-rename-auth-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  const file = join(scenarioDir, 'compiled', `${ID}.json`);
  writeFileSync(file, draft());
  const api = await startServer({
    env,
    scenarioDir,
    compileScenario: async (json) => ({ ...(json as object), hooks: {} }) as unknown as ScenarioPackage,
  });
  try {
    await waitFor(async () => (await names(api.base)).has(ID), 'the draft to enter the catalog', 5000);
    await body({ api, file });
  } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

async function names(base: string): Promise<Map<string, string>> {
  const res = await fetch(`${base}/scenarios`);
  const body = await res.json() as { scenarios: Array<{ id: string; name: string }> };
  return new Map(body.scenarios.map(s => [s.id, s.name]));
}

function rename(base: string, name: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/scenarios/${ID}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ name }),
  });
}

test('a rename with no admin credential is refused and changes neither the name nor the file', async () => {
  for (const env of [{}, ADMIN_ENV]) {
    await withCompiledScenario(env, async ({ api, file }) => {
      const before = readFileSync(file, 'utf-8');
      const res = await rename(api.base, 'x');
      assert.ok(res.status === 401 || res.status === 403, `status ${res.status} with ${JSON.stringify(env)}`);
      assert.equal((await names(api.base)).get(ID), NAME, 'every visitor still sees the old name');
      assert.equal(readFileSync(file, 'utf-8'), before, 'the file is unchanged');
    });
  }
});

test('a rename with a wrong admin credential is refused', async () => {
  await withCompiledScenario(ADMIN_ENV, async ({ api, file }) => {
    const before = readFileSync(file, 'utf-8');
    const res = await rename(api.base, 'x', { 'X-Admin-Token': `${TOKEN}x` });
    assert.equal(res.status, 401);
    assert.equal((await names(api.base)).get(ID), NAME);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });
});

test('the admin renames a compiled scenario', async () => {
  await withCompiledScenario(ADMIN_ENV, async ({ api, file }) => {
    const res = await rename(api.base, 'Pandemic Sim', { 'X-Admin-Token': TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: ID, name: 'Pandemic Sim' });
    assert.equal((await names(api.base)).get(ID), 'Pandemic Sim');
    assert.equal((JSON.parse(readFileSync(file, 'utf-8')) as { labels: { name: string } }).labels.name, 'Pandemic Sim');
  });
});
