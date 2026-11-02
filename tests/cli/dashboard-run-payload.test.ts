/**
 * What the dashboard reads from GET /scenario and posts back to /setup.
 *
 * Each test switches the real server to a scenario under scenarios/, reads
 * its /scenario answer, and hands that to the dashboard's own helpers. The
 * run is a stub that records the config the server hands the runner, so no
 * model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import { defaultRunSetup } from '../../src/dashboard/src/run-payload.js';
import { formatHeaderMetric, headerMetricValue } from '../../src/dashboard/src/components/layout/StatsBar.helpers.js';
import type { ScenarioClientPayload } from '../../src/dashboard/src/hooks/useScenario.js';

async function withServer(
  body: (api: {
    scenario: (id: string) => Promise<ScenarioClientPayload>;
    post: (path: string, payload: unknown) => Promise<Response>;
    launches: NormalizedSimulationConfig[];
  }) => Promise<void>,
  scenarioDir?: string,
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-dashboard-run-'));
  const launches: NormalizedSimulationConfig[] = [];
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '' },
    maxSimsPerDay: 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async config => { launches.push(config); },
    ...(scenarioDir ? { scenarioDir } : {}),
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  const post = (path: string, payload: unknown) => fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const scenario = async (id: string) => {
    assert.equal((await post('/scenario/switch', { id })).status, 200);
    const res = await fetch(url('/scenario'));
    assert.equal(res.status, 200);
    return await res.json() as ScenarioClientPayload;
  };
  try {
    await body({ scenario, post, launches });
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
}

async function launched(launches: NormalizedSimulationConfig[]): Promise<NormalizedSimulationConfig> {
  const deadline = Date.now() + 2000;
  while (launches.length === 0) {
    if (Date.now() > deadline) throw new Error('the simulation runner was not called');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return launches[launches.length - 1];
}

test("the Run button's body runs Atlas Lab with its own leaders, in units named for a lab", async () => {
  await withServer(async ({ scenario, post, launches }) => {
    const setup = await post('/setup', defaultRunSetup(await scenario('atlas-lab')));
    assert.equal(setup.status, 200);

    const config = await launched(launches);
    assert.deepEqual(config.actors.map(a => a.name), ['Marcus Reinhardt', 'Priya Kapoor']);
    assert.deepEqual(config.actors.map(a => a.unit), ['Lab Alpha', 'Lab Beta']);
    assert.equal(config.startTime, 1);
  });
});

test("the Run button's body names each scenario's own place: a station under the ocean, a colony on Mars", async () => {
  await withServer(async ({ scenario, post, launches }) => {
    assert.equal((await post('/setup', defaultRunSetup(await scenario('deep-ocean-station')))).status, 200);
    const station = await launched(launches);
    assert.deepEqual(station.actors.map(a => a.name), ['Captain Ingrid Halvorsen', 'Commander Takeshi Morimoto']);
    assert.deepEqual(station.actors.map(a => a.unit), ['Station Alpha', 'Station Beta']);

    launches.length = 0;
    assert.equal((await post('/setup', defaultRunSetup(await scenario('mars-genesis')))).status, 200);
    const colony = await launched(launches);
    assert.deepEqual(colony.actors.map(a => a.name), ['Aria Chen', 'Dietrich Voss']);
    assert.deepEqual(colony.actors.map(a => a.unit), ['Colony Alpha', 'Colony Beta']);
  });
});

test('a percent header metric is scaled once: by the ceiling /scenario sends with it', async () => {
  await withServer(async ({ scenario }) => {
    const metric = (payload: ScenarioClientPayload, id: string) => {
      const found = payload.ui.headerMetrics.find(m => m.id === id);
      assert.ok(found, `${payload.id} declares the header metric ${id}`);
      return found;
    };

    // Each world declares hullIntegrity max 100 and the others max 1.
    const submarine = await scenario('deep-ocean-station');
    assert.equal(formatHeaderMetric(100, metric(submarine, 'hullIntegrity')), '100%');
    assert.equal(formatHeaderMetric(0.75, metric(submarine, 'morale')), '75%');
    assert.equal(formatHeaderMetric(1, metric(await scenario('atlas-lab'), 'releaseReadiness')), '100%');
    assert.equal(formatHeaderMetric(0.65, metric(await scenario('atlas-lab'), 'releaseReadiness')), '65%');
    assert.equal(formatHeaderMetric(0.85, metric(await scenario('mars-genesis'), 'morale')), '85%');
  });
});

test('a percent header metric with no declared ceiling is scaled by its starting value, the same on every turn', async () => {
  // Submarine with the ceilings taken off: Hull Integrity starts at 100, morale at 0.75.
  const scenarioDir = mkdtempSync(join(tmpdir(), 'paracosm-no-ceiling-'));
  const submarine = JSON.parse(readFileSync(new URL('../../scenarios/submarine.json', import.meta.url), 'utf-8')) as {
    world: { metrics: Record<string, { max?: number }> };
  };
  delete submarine.world.metrics.hullIntegrity.max;
  delete submarine.world.metrics.morale.max;
  writeFileSync(join(scenarioDir, 'submarine.json'), JSON.stringify(submarine));

  try {
    await withServer(async ({ scenario }) => {
      const metrics = (await scenario('deep-ocean-station')).ui.headerMetrics;
      const hull = metrics.find(m => m.id === 'hullIntegrity');
      const morale = metrics.find(m => m.id === 'morale');
      assert.ok(hull && morale);

      // A hull down to 0.8 reads 0.8 of 100, and 2 falling to 1 is a change of one point.
      assert.equal(formatHeaderMetric(0.8, hull), '1%');
      assert.equal(headerMetricValue(1, hull) - headerMetricValue(2, hull), -1);
      assert.equal(formatHeaderMetric(100, hull), '100%');
      assert.equal(formatHeaderMetric(0.75, morale), '75%');
      assert.equal(formatHeaderMetric(1.2, morale), '120%');
    }, scenarioDir);
  } finally {
    rmSync(scenarioDir, { recursive: true, force: true });
  }
});

test("the Run button keeps a one-leader preset's leader and fills only the empty slot", async () => {
  const scenarioDir = mkdtempSync(join(tmpdir(), 'paracosm-one-leader-'));
  const atlasLab = JSON.parse(readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8')) as {
    presets: Array<{ leaders: unknown[] }>;
  };
  atlasLab.presets[0].leaders = atlasLab.presets[0].leaders.slice(0, 1);
  writeFileSync(join(scenarioDir, 'atlas-lab.json'), JSON.stringify(atlasLab));

  try {
    await withServer(async ({ scenario, post, launches }) => {
      assert.equal((await post('/setup', defaultRunSetup(await scenario('atlas-lab')))).status, 200);
      const config = await launched(launches);
      assert.deepEqual(config.actors.map(a => a.name), ['Marcus Reinhardt', 'Actor B']);
      assert.deepEqual(config.actors.map(a => a.unit), ['Lab Alpha', 'Lab Beta']);
    }, scenarioDir);
  } finally {
    rmSync(scenarioDir, { recursive: true, force: true });
  }
});
