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
import { SimulationKernel } from '../../src/engine/core/kernel.js';
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
  maxSimsPerDay = 0,
  env: Record<string, string> = {},
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-scenario-setup-'));
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '', ...env },
    maxSimsPerDay,
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

test('POST /setup does not count a body refused for another scenario against the daily run limit', async () => {
  // The hosted demo allows one run per visitor a day. A page left on another
  // scenario is told to reload and run again; that run has to go through.
  const launches: NormalizedSimulationConfig[] = [];
  await withServer(
    async config => { launches.push(config); },
    async post => {
      assert.equal((await post('/scenario/switch', { id: atlasLab.id })).status, 200);
      const stale = await post('/setup', quickstartBody(mars));
      assert.equal(stale.status, 409);
      const reloaded = await post('/setup', quickstartBody(atlasLab));
      assert.equal(reloaded.status, 200);
      await waitFor(() => launches[0] ?? null);
    },
    1,
  );
});

/** The parent a saved run hands to a fork: per-turn kernel snapshots. */
function parentArtifact(startTime: number, times: number[], firstTurn = 1) {
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
        turn: index + firstTurn,
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

test('a fork reads no timeline from a parent snapshot at a turn no run reaches or a turn that is not whole', () => {
  // The parent is read before the fork validator runs, and the step check
  // builds one schedule entry per turn up to the last snapshot's turn, so a
  // snapshot at turn 1e9 in a /setup body would allocate a billion numbers.
  // Such a snapshot gives no start time; the scenario's own (month 1) stands.
  const farTurn = normalizeSimulationConfig(forkBody(parentArtifact(2035, [2035], 20_000), 1), labPackage);
  assert.equal(farTurn.startTime, 1);
  const halfTurn = normalizeSimulationConfig(forkBody(parentArtifact(2035, [2035], 1.5), 1), labPackage);
  assert.equal(halfTurn.startTime, 1);
  // The input the review named, which before the cap ran out of memory.
  const billionth = normalizeSimulationConfig(forkBody(parentArtifact(0, [0], 1e9), 1), labPackage);
  assert.equal(billionth.startTime, 1);
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

test('a fork reads its parent\'s schedule from the times the parent ran at', () => {
  // A parent launched with time per turn 0.1. The gaps between 2035, 2035.1
  // and 2035.2 differ in the last bits of a double, which is no accelerating
  // schedule: that one would put the turn after the snapshot at 2043.
  const fractional = normalizeSimulationConfig(forkBody(parentArtifact(2035, [2035, 2035.1, 2035.2]), 3), labPackage);
  assert.ok(Math.abs((fractional.timePerTurn ?? 0) - 0.1) < 1e-6, `time per turn ${fractional.timePerTurn}`);

  // The fork of a fork holds only the turns after its own fork turn. On the
  // accelerating schedule turns 4, 5 and 6 are 8, 11 and 14: equal gaps of 3
  // at times a fixed step of 3 would have put at 9, 12 and 15.
  const segment = normalizeSimulationConfig(forkBody(parentArtifact(0, [8, 11, 14], 4), 6, 8), labPackage);
  assert.equal(segment.timePerTurn, 0);

  // Two snapshots fit a fixed step and the accelerating schedule alike; the
  // scenario's own declaration settles which one the parent ran on.
  const acceleratingScenario = {
    ...labPackage,
    setup: { ...labPackage.setup, defaultTimePerTurn: 0 },
  } as ScenarioPackage;
  const declared = normalizeSimulationConfig(forkBody(parentArtifact(2035, [2035, 2037]), 2, 4), acceleratingScenario);
  assert.equal(buildTimeSchedule(declared.startTime, declared.turns, declared.timePerTurn)[2], 2040);
});

test('a run that omits its population has someone to head each department', () => {
  // t2d-glp1-protocol.json declares one person and five departments, and each
  // person heads one department, so a run of one person would give the other
  // four empty reports. The commander-setup fallback is the loop below.
  const t2d = readScenario('t2d-glp1-protocol.json');
  const t2dPackage = t2d as unknown as ScenarioPackage;
  const body = quickstartBody(t2d) as unknown as SimulationSetupPayload;
  const config = normalizeSimulationConfig(body, t2dPackage);
  assert.equal(config.initialPopulation, t2d.departments.length);

  const kernel = new SimulationKernel(config.seed, 'Leader', config.keyPersonnel, {
    startTime: config.startTime,
    initialPopulation: config.initialPopulation,
    scenario: t2dPackage,
  });
  for (const { id } of t2dPackage.departments) {
    const top = kernel.getCandidates(id, 1)[0];
    if (top) kernel.promoteAgent(top.core.id, id, `Head of ${id}`, 'Leader');
  }
  const heads = kernel.getState().agents.filter(a => a.promotion).map(a => a.promotion?.department);
  assert.deepEqual(heads.sort(), t2d.departments.map(d => d.id).sort());

  // A population the body names stays the person's own choice.
  assert.equal(normalizeSimulationConfig({ ...body, population: 2 }, t2dPackage).initialPopulation, 2);
});

test('POST /setup refuses a fork with no turn left to run instead of answering 200 and failing behind it', async () => {
  // The Reports tab offers a fork at a run's last turn and posts the parent's
  // turn count, which equals the fork turn. WorldModel.simulate refuses that
  // after /setup has answered, and the optimistic branch stays running.
  const launches: NormalizedSimulationConfig[] = [];
  await withServer(
    async config => { launches.push(config); },
    async post => {
      assert.equal((await post('/scenario/switch', { id: atlasLab.id })).status, 200);
      const setup = await post('/setup', forkBody(parentArtifact(1, [1, 2, 3, 4, 5, 6]), 6, 6));
      assert.equal(setup.status, 400);
      const { error } = (await setup.json()) as { error: string };
      assert.match(error, /fork at turn 6 has no turn left/i);
      assert.equal(launches.length, 0);
    },
  );
});

test('POST /setup on the hosted demo refuses a fork past its turn cap instead of answering 200', async () => {
  // A 12-turn parent forked at turn 8 on the hosted demo: the demo cap
  // trims the run to 6 turns, which ends before the fork turn.
  const launches: NormalizedSimulationConfig[] = [];
  const twelve = Array.from({ length: 12 }, (_, i) => i + 1);
  await withServer(
    async config => { launches.push(config); },
    async post => {
      assert.equal((await post('/scenario/switch', { id: atlasLab.id })).status, 200);
      const setup = await post('/setup', forkBody(parentArtifact(1, twelve), 8, 12));
      assert.equal(setup.status, 400);
      assert.match(((await setup.json()) as { error: string }).error, /fork at turn 8 has no turn left/i);
      assert.equal(launches.length, 0);
    },
    0,
    { PARACOSM_HOSTED_DEMO: 'true' },
  );
});

test('POST /setup refuses a body written for another scenario than the active one', async () => {
  // The active scenario is the server's, so another page can move it while
  // this page still holds the old one. Its leaders and setup values would
  // then run in the other scenario's world.
  const launches: NormalizedSimulationConfig[] = [];
  await withServer(
    async config => { launches.push(config); },
    async post => {
      assert.equal((await post('/scenario/switch', { id: atlasLab.id })).status, 200);

      // Settings and the re-run button name it at the top level.
      const rerun = await post('/setup', { actors: mars.presets[0].leaders, turns: 6, seed: 951, scenarioId: mars.id });
      assert.equal(rerun.status, 409);
      assert.match(((await rerun.json()) as { error: string }).error, /reload/i);

      // The Quickstart tab names it under quickstart.
      const quickstart = await post('/setup', quickstartBody(mars));
      assert.equal(quickstart.status, 409);
      assert.equal(launches.length, 0);

      // A body for the active scenario launches.
      const own = await post('/setup', { ...quickstartBody(atlasLab), scenarioId: atlasLab.id });
      assert.equal(own.status, 200);
      await waitFor(() => launches[0] ?? null);
    },
  );
});

