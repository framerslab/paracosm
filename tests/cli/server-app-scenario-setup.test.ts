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
import { normalizeSimulationConfig, type NormalizedSimulationConfig, type SimulationSetupPayload } from '../../src/cli/sim-config.js';
import { buildTimeSchedule } from '../../src/runtime/util/runtime-helpers.js';
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

/** A server whose run is a stub that records what it was handed. */
async function withServer(
  runPairSimulations: (config: NormalizedSimulationConfig, signal: AbortSignal | undefined, scenario: ScenarioPackage | undefined) => Promise<void>,
  body: (post: (path: string, payload: unknown) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-scenario-setup-'));
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '' },
    maxSimsPerDay: 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: (config, _broadcast, signal, scenario) => runPairSimulations(config, signal, scenario),
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  try {
    await body((path, payload) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
}

test('POST /setup keeps one scenario for the whole launch when another request switches it during the wait for the previous run', async () => {
  const launches: Array<{ config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined }> = [];
  let markAborted!: () => void;
  const aborted = new Promise<void>(resolve => { markAborted = resolve; });
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });

  await withServer(
    async (config, signal, scenario) => {
      launches.push({ config, scenario });
      if (launches.length > 1) return;
      // The first run outlives its abort until the test has switched the
      // scenario, so the second /setup is inside its wait when that happens.
      await new Promise<void>(resolve => {
        signal?.addEventListener('abort', () => {
          markAborted();
          void released.then(resolve);
        });
      });
    },
    async post => {
      assert.equal((await post('/scenario/switch', { id: atlasLab.id })).status, 200);
      assert.equal((await post('/setup', quickstartBody(atlasLab))).status, 200);
      await waitFor(() => launches[0] ?? null);

      const second = post('/setup', quickstartBody(atlasLab));
      await aborted;
      assert.equal((await post('/scenario/switch', { id: mars.id })).status, 200);
      release();

      const response = await second;
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { scenarioId: string }).scenarioId, 'atlas-lab');
      const run = await waitFor(() => launches[1] ?? null);
      assert.equal(run.scenario?.id, 'atlas-lab', 'the run was normalized for Atlas Lab, so it runs Atlas Lab');
      assert.equal(run.config.startTime, 1);
    },
  );
});

test('POST /setup with departments the active scenario does not declare keeps all of its own', async () => {
  // A form launched on the Mars fallback before GET /scenario resolved, or
  // an API caller holding another scenario's list. An empty active set
  // would send every event to the scenario's first two departments.
  const launches: NormalizedSimulationConfig[] = [];
  await withServer(
    async config => { launches.push(config); },
    async post => {
      assert.equal((await post('/scenario/switch', { id: atlasLab.id })).status, 200);
      const setup = await post('/setup', { ...quickstartBody(atlasLab), activeDepartments: ['medical', 'engineering'] });
      assert.equal(setup.status, 200);
      const config = await waitFor(() => launches[0] ?? null);
      assert.deepEqual(config.activeDepartments, atlasLab.departments.map(d => d.id));
    },
  );
});

/** The parent a saved run hands to a fork: per-turn kernel snapshots. */
function parentArtifact(startTime: number, times: number[]) {
  return {
    metadata: {
      runId: 'parent-1',
      scenario: { id: atlasLab.id, name: 'Atlas Lab' },
      mode: 'turn-loop',
      startedAt: '2026-10-30T20:24:31.000Z',
    },
    scenarioExtensions: {
      kernelSnapshotsPerTurn: times.map((time, index) => ({
        snapshotVersion: 1,
        scenarioId: atlasLab.id,
        turn: index + 1,
        time,
        state: {},
        rngState: 0,
        startTime,
        seed: 11,
      })),
    },
  };
}

/** The body ReportView posts for a fork: no start time, time per turn or population. */
function forkBody(parent: ReturnType<typeof parentArtifact>, atTurn: number, turns: number | null = 6) {
  return {
    actors: [atlasLab.presets[0].leaders[0]],
    turns,
    seed: 11,
    captureSnapshots: true,
    forkFrom: { parentArtifact: parent, atTurn },
  } as unknown as SimulationSetupPayload;
}

const labPackage = atlasLab as unknown as ScenarioPackage;

test('a fork continues its parent\'s timeline, whatever the scenario declares', () => {
  // The Atlas Lab runs saved before the scenario's start time reached the
  // server ran at 2035, 2036, 2037. A fork on the lab's own month 1 would
  // step the restored kernel from 2036 to 3, a time delta of -2033, and
  // every agent's age would go negative.
  const saved = normalizeSimulationConfig(forkBody(parentArtifact(2035, [2035, 2036, 2037]), 2), labPackage);
  assert.equal(saved.startTime, 2035);
  assert.equal(saved.timePerTurn, 1);
  assert.equal(buildTimeSchedule(saved.startTime, saved.turns, saved.timePerTurn)[2], 2037, 'turn 3 of the fork is the time after the snapshot');

  // A parent launched from Settings with its own start time and step.
  const custom = normalizeSimulationConfig(forkBody(parentArtifact(50, [50, 53, 56]), 3), labPackage);
  assert.equal(custom.startTime, 50);
  assert.equal(custom.timePerTurn, 3);
  assert.equal(buildTimeSchedule(custom.startTime, custom.turns, custom.timePerTurn)[3], 59);

  // An explicit value in the body still wins.
  const explicit = normalizeSimulationConfig(
    { ...forkBody(parentArtifact(2035, [2035, 2036]), 1), startTime: 7, timePerTurn: 2 },
    labPackage,
  );
  assert.equal(explicit.startTime, 7);
  assert.equal(explicit.timePerTurn, 2);

  // A parent on the accelerating schedule (time per turn 0 in its body)
  // has no one step; a step read from its first two snapshots would put
  // turn 7 at 12, before the snapshot's 14.
  const accelerating = normalizeSimulationConfig(forkBody(parentArtifact(0, [0, 2, 5, 8, 11, 14]), 6, 8), labPackage);
  assert.equal(accelerating.timePerTurn, 0);
  assert.equal(buildTimeSchedule(accelerating.startTime, accelerating.turns, accelerating.timePerTurn)[6], 18);

  // A malformed parent is the fork validator's to refuse, after this runs.
  const malformed = normalizeSimulationConfig(
    { ...forkBody(parentArtifact(1, [1]), 1), forkFrom: { parentArtifact: {}, atTurn: 1 } } as unknown as SimulationSetupPayload,
    labPackage,
  );
  assert.equal(malformed.startTime, 1);
});

test('a fork that omits turns runs past its fork turn', () => {
  // WorldModel.simulate rejects a final turn at or before the fork turn;
  // Atlas Lab declares 6 turns, so a fork at turn 6 needs more than that.
  const config = normalizeSimulationConfig(
    forkBody(parentArtifact(1, [1, 2, 3, 4, 5, 6]), 6, null),
    labPackage,
  );
  assert.equal(config.turns, 12, 'the fork turn plus the scenario\'s own turn count');
});
