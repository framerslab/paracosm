/**
 * A run takes its scenario's own start values and people.
 *
 * The dashboard's Quickstart tab posts /setup with the leaders and the
 * scenario's turns and seed, and nothing else about the setup; the
 * server fills the omitted fields. They must come from the active
 * scenario, not from Mars Genesis. Four hosted Atlas Lab runs on 29 and
 * 30 October 2026 started at "Month 2035" with the five Mars colonists
 * as key personnel because normalizeSimulationConfig filled startTime,
 * population and keyPersonnel with Mars constants without seeing the
 * active scenario.
 *
 * Both halves go through the server's own /scenario/switch and /setup
 * handlers with the scenario JSON under scenarios/, and read the config
 * the server hands to the simulation runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

interface ScenarioJson {
  id: string;
  setup: {
    defaultTurns: number;
    defaultSeed: number;
    defaultStartTime: number;
    defaultTimePerTurn?: number;
    defaultPopulation: number;
  };
  departments: Array<{ id: string }>;
  presets: Array<{
    id: string;
    leaders: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }>;
    personnel?: Array<{ name: string }>;
  }>;
}

function readScenario(file: string): ScenarioJson {
  return JSON.parse(readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8')) as ScenarioJson;
}

const atlasLab = readScenario('atlas-lab.json');
const mars = readScenario('mars.json');
const marsColonists = (mars.presets[0].personnel ?? []).map(p => p.name);

/**
 * The body QuickstartView posts on its preset fast path: the preset's
 * leaders, the scenario's turns and seed, and nothing else about the
 * setup (no startTime, timePerTurn, population or keyPersonnel).
 */
function quickstartBody(scenario: ScenarioJson) {
  return {
    actors: scenario.presets[0].leaders.map(p => ({
      name: p.name,
      archetype: p.archetype,
      hexaco: p.hexaco,
      instructions: p.instructions,
    })),
    turns: scenario.setup.defaultTurns,
    seed: scenario.setup.defaultSeed,
    captureSnapshots: true,
    quickstart: { scenarioId: scenario.id },
  };
}

async function waitFor<T>(read: () => T | null, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('the simulation runner was not called');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('POST /setup fills the omitted setup from the active scenario: Atlas Lab starts at month 1 with no Mars colonist, Mars at 2035 with its five', async () => {
  const launches: Array<{ config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined }> = [];
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-scenario-setup-'));
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '' },
    maxSimsPerDay: 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async (config, _broadcast, _signal, scenario) => {
      launches.push({ config, scenario });
    },
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    const switched = await post('/scenario/switch', { id: atlasLab.id });
    assert.equal(switched.status, 200);
    const setup = await post('/setup', quickstartBody(atlasLab));
    assert.equal(setup.status, 200);
    assert.equal(((await setup.json()) as { scenarioId: string }).scenarioId, 'atlas-lab');

    const lab = await waitFor(() => launches[0] ?? null);
    assert.equal(lab.scenario?.id, 'atlas-lab');
    assert.equal(lab.config.turns, 6);
    assert.equal(lab.config.seed, 11);
    assert.equal(lab.config.startTime, 1, 'startTime is atlas-lab.json setup.defaultStartTime');
    assert.equal(lab.config.timePerTurn, 1, 'timePerTurn is atlas-lab.json setup.defaultTimePerTurn');
    assert.equal(lab.config.initialPopulation, 480, 'population is atlas-lab.json setup.defaultPopulation');
    assert.deepEqual(lab.config.keyPersonnel, [], 'atlas-lab.json declares no personnel, so the engine builds the whole roster');
    for (const name of marsColonists) {
      assert.ok(!lab.config.keyPersonnel.some(p => p.name === name), `${name} is a Mars colonist`);
    }
    assert.deepEqual(lab.config.startingResources, {}, 'omitted resources are left to the engine and the scenario');
    assert.deepEqual(lab.config.startingPolitics, {}, 'omitted politics are left to the engine and the scenario');
    // The orchestrator runs only the event's departments that are active;
    // with Mars's list here a lab run never matched one and fell back to
    // its first two departments on every event.
    assert.deepEqual(
      lab.config.activeDepartments,
      atlasLab.departments.map(d => d.id),
      'omitted activeDepartments are all of atlas-lab.json departments',
    );
    assert.ok(!lab.config.activeDepartments.includes('medical'));

    const back = await post('/scenario/switch', { id: mars.id });
    assert.equal(back.status, 200);
    const marsSetup = await post('/setup', quickstartBody(mars));
    assert.equal(marsSetup.status, 200);

    const marsRun = await waitFor(() => launches[1] ?? null);
    assert.equal(marsRun.scenario?.id, 'mars-genesis');
    assert.equal(marsRun.config.startTime, 2035);
    assert.equal(marsRun.config.timePerTurn, 8);
    assert.equal(marsRun.config.initialPopulation, 100);
    assert.deepEqual(marsRun.config.keyPersonnel.map(p => p.name), marsColonists);
    assert.deepEqual(marsRun.config.activeDepartments, mars.departments.map(d => d.id));
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
});
