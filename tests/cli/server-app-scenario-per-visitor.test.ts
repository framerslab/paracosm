/**
 * Each visitor keeps the scenario they picked.
 *
 * The server held one scenario for everyone. Visitor A opened /sim on Mars
 * Genesis, visitor B switched to Atlas Lab, and A's Run was refused with
 * 409; A reloaded and came up on Atlas Lab, which A never picked. B's
 * switch also emptied the event buffer, so A's finished run vanished from
 * /results. The pick is now the visitor's own paracosm_scenario cookie,
 * a scenario the request names wins over it, and with neither the run is
 * the server's default, Mars Genesis.
 *
 * Every test goes through createMarsServer over HTTP with the scenario JSON
 * under scenarios/, one cookie jar per visitor, and a stub simulation
 * runner that records what the server hands it, so no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer, type CreateMarsServerOptions } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import type { BroadcastFn } from '../../src/cli/pair-runner.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { visitor, type Visitor } from './helpers/visitor.js';

interface ScenarioJson {
  id: string;
  labels: { name: string };
  setup: { defaultTurns: number; defaultSeed: number };
  presets: Array<{
    leaders: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }>;
  }>;
}

function readScenario(file: string): ScenarioJson {
  return JSON.parse(readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8')) as ScenarioJson;
}

const atlasLab = readScenario('atlas-lab.json');
const mars = readScenario('mars.json');

/** The body QuickstartView posts: the preset's leaders, turns and seed, the scenario under quickstart. */
function quickstartBody(scenario: ScenarioJson) {
  return {
    actors: scenario.presets[0].leaders,
    turns: scenario.setup.defaultTurns,
    seed: scenario.setup.defaultSeed,
    captureSnapshots: true,
    quickstart: { scenarioId: scenario.id },
  };
}

/** The body Settings and the re-run button post: the scenario at the top level. */
function settingsBody(scenario: ScenarioJson) {
  return { actors: scenario.presets[0].leaders, turns: 6, seed: 951, scenarioId: scenario.id };
}

/** A runnable scenario stored through /scenario/store (tests/cli/server-app.test.ts uses the same one). */
const oceanStation = {
  id: 'deep-ocean-station',
  version: '1.0.0',
  engineArchetype: 'closed_turn_based_settlement',
  labels: { name: 'Deep Ocean Station', shortName: 'ocean', populationNoun: 'crew members', settlementNoun: 'station', currency: 'credits' },
  theme: { primaryColor: '#2563eb', accentColor: '#38bdf8', cssVariables: {} },
  setup: { defaultTurns: 6, defaultSeed: 321, defaultStartTime: 2048, defaultPopulation: 40, configurableSections: ['leaders'] },
  world: {
    metrics: { pressure: { id: 'pressure', label: 'Hull Pressure', unit: 'bar', type: 'number', initial: 1, min: 0, max: 5, category: 'metric' } },
    capacities: {}, statuses: {}, politics: {}, environment: {},
  },
  departments: [
    { id: 'operations', label: 'Operations', role: 'Operations Lead', icon: 'O', defaultModel: 'gpt-5.4-mini', instructions: 'Coordinate station operations.' },
    { id: 'research', label: 'Research', role: 'Research Lead', icon: 'R', defaultModel: 'gpt-5.4-mini', instructions: 'Run scientific analysis.' },
  ],
  metrics: [{ id: 'pressure', label: 'Hull Pressure', source: 'metrics.pressure', format: 'number' }],
  events: [{ id: 'breach', label: 'Hull Breach', icon: '!', color: '#2563eb' }],
  effects: [{ id: 'ocean-category-effects', type: 'category_outcome', label: 'Ocean Category Effects', categoryDefaults: {} }],
  presets: [],
  ui: { headerMetrics: [{ id: 'population', format: 'number' }], tooltipFields: [], reportSections: ['crisis'], departmentIcons: {}, eventRenderers: {}, setupSections: ['leaders'] },
  knowledge: { topics: {}, categoryMapping: {} },
  policies: {
    toolForging: { enabled: true },
    liveSearch: { enabled: false, mode: 'off' },
    bulletin: { enabled: true },
    characterChat: { enabled: true },
    sandbox: { timeoutMs: 10000, memoryMB: 128 },
  },
  hooks: {},
};

/** Stored but not runnable: no hooks, world or policies. */
const draftStation = { id: 'draft-ocean-station', labels: { name: 'Draft Ocean Station' }, departments: [{ id: 'operations', label: 'Operations' }] };

interface Launch { config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined }
type Runner = (config: NormalizedSimulationConfig, broadcast: BroadcastFn, scenario: ScenarioPackage | undefined) => Promise<void>;

async function withVisitors(
  body: (api: { visitor: (cookies?: Record<string, string>) => Visitor; launches: Launch[]; base: string }) => Promise<void>,
  options: {
    runner?: Runner;
    env?: Record<string, string>;
    maxSimsPerDay?: number;
    scenarioDir?: string;
    compileScenario?: CreateMarsServerOptions['compileScenario'];
  } = {},
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-scenario-per-visitor-'));
  const launches: Launch[] = [];
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '', ...options.env },
    maxSimsPerDay: options.maxSimsPerDay ?? 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async (config, broadcast, _signal, scenario) => {
      launches.push({ config, scenario });
      await options.runner?.(config, broadcast, scenario);
    },
    ...(options.scenarioDir ? { scenarioDir: options.scenarioDir } : {}),
    ...(options.compileScenario ? { compileScenario: options.compileScenario } : {}),
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  try {
    await body({ visitor: cookies => visitor(base, cookies), launches, base });
  } finally {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
}

async function waitFor<T>(read: () => T | null | undefined | Promise<T | null | undefined>, what: string, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Connects to /events and returns the frames it replays before replay_done. */
async function readReplay(base: string): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const ac = new AbortController();
  const res = await fetch(`${base}/events`, { signal: ac.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes('event: replay_done')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    ac.abort();
  }
  assert.ok(text.includes('event: replay_done'), `no replay_done: ${text}`);
  const frames = text.split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const [eventLine, dataLine = 'data: {}'] = frame.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown> };
  });
  const done = frames.findIndex(f => f.event === 'replay_done');
  return frames.slice(1, done);
}

test("another visitor's switch neither refuses this visitor's run nor moves their scenario", async () => {
  await withVisitors(async ({ visitor, launches }) => {
    const a = visitor();
    const b = visitor();
    assert.equal((await a.json<{ id: string }>('/scenario')).id, 'mars-genesis');

    const switched = await b.post('/scenario/switch', { id: atlasLab.id });
    assert.equal(switched.status, 200);
    assert.deepEqual(await switched.json(), { active: 'atlas-lab', name: 'Atlas Lab' });

    // A presses Run with the page it loaded.
    const aRun = await a.post('/setup', settingsBody(mars));
    assert.equal(aRun.status, 200, `A's run: ${aRun.status}`);
    assert.equal(((await aRun.json()) as { scenarioId: string }).scenarioId, 'mars-genesis');
    const aLaunch = await waitFor(() => launches[0], "A's run");
    assert.equal(aLaunch.scenario?.id, 'mars-genesis');
    assert.equal(aLaunch.config.startTime, 2035);

    // A reloads: still the scenario A has.
    assert.equal((await a.json<{ id: string }>('/scenario')).id, 'mars-genesis');
    assert.equal((await a.json<{ active: string }>('/scenarios')).active, 'mars-genesis');
    assert.equal((await b.json<{ id: string }>('/scenario')).id, 'atlas-lab');
    assert.equal((await b.json<{ active: string }>('/scenarios')).active, 'atlas-lab');

    const bRun = await b.post('/setup', quickstartBody(atlasLab));
    assert.equal(bRun.status, 200);
    const bLaunch = await waitFor(() => launches[1], "B's run");
    assert.equal(bLaunch.scenario?.id, 'atlas-lab');
    assert.equal(bLaunch.config.startTime, 1);

    // The pick is a first-party cookie the browser keeps for 30 days.
    const setCookie = switched.headers.getSetCookie();
    assert.equal(setCookie.length, 1);
    const [pair, ...attributes] = setCookie[0].split(';').map(part => part.trim());
    assert.equal(pair, 'paracosm_scenario=atlas-lab');
    assert.deepEqual(attributes.sort(), ['HttpOnly', 'Max-Age=2592000', 'Path=/', 'SameSite=Lax']);
    assert.equal(a.cookies.size, 0, 'A never picked, so A holds no cookie');
  });
});

test('a caller that names no scenario and holds no pick gets the server default', async () => {
  await withVisitors(async ({ visitor, launches }) => {
    const caller = visitor();
    assert.equal((await caller.json<{ id: string }>('/scenario')).id, 'mars-genesis');
    const setup = await caller.post('/setup', { actors: mars.presets[0].leaders, turns: 2, seed: 7 });
    assert.equal(setup.status, 200);
    assert.equal(((await setup.json()) as { scenarioId: string }).scenarioId, 'mars-genesis');
    assert.equal((await waitFor(() => launches[0], 'the run')).scenario?.id, 'mars-genesis');
  });
});

test('a scenario the body names wins over the pick, and the run makes it the pick', async () => {
  // Two tabs of one browser share the cookie. Tab A loaded Mars Genesis,
  // tab B then picked Atlas Lab, and tab A presses Run. The run is Mars
  // Genesis, as tab A's body names it. The dashboard then opens /sim, and
  // a page shows a run only in its own scenario, so that page must load on
  // Mars Genesis, or tab A comes up without the run it started.
  await withVisitors(async ({ visitor, launches }) => {
    const browser = visitor();
    assert.equal((await browser.post('/scenario/switch', { id: atlasLab.id })).status, 200);
    const setup = await browser.post('/setup', settingsBody(mars));
    assert.equal(setup.status, 200);
    assert.equal((await waitFor(() => launches[0], 'the run')).scenario?.id, 'mars-genesis');
    const [pair] = (setup.headers.getSetCookie()[0] ?? '').split(';');
    assert.equal(pair, 'paracosm_scenario=mars-genesis');
    assert.equal((await browser.json<{ id: string }>('/scenario')).id, 'mars-genesis');

    // A run in the scenario the visitor already holds sets nothing new.
    const again = await browser.post('/setup', settingsBody(mars));
    assert.equal(again.status, 200);
    assert.deepEqual(again.headers.getSetCookie(), []);
  });
});

test('an id the server does not hold: a stale pick reads as none, a named one is refused', async () => {
  await withVisitors(async ({ visitor, launches }) => {
    const stale = visitor({ paracosm_scenario: 'no-such' });
    assert.equal((await stale.json<{ id: string }>('/scenario')).id, 'mars-genesis');

    const unknown = await visitor().post('/setup', { ...settingsBody(mars), scenarioId: 'no-such' });
    assert.equal(unknown.status, 400);
    assert.match(((await unknown.json()) as { error: string }).error, /Unknown scenario/);

    const author = visitor();
    assert.equal((await author.post('/scenario/store', { scenario: draftStation, saveToDisk: false })).status, 200);
    const draft = await author.post('/setup', { ...settingsBody(mars), scenarioId: draftStation.id });
    assert.equal(draft.status, 400);
    assert.match(((await draft.json()) as { error: string }).error, /not runnable/);
    assert.equal(launches.length, 0);

    // A runnable scenario stored under an id too long for a cookie can be
    // named in a body, never held as a pick.
    const longId = 'a'.repeat(2000);
    assert.equal((await author.post('/scenario/store', { scenario: { ...oceanStation, id: longId }, saveToDisk: false })).status, 200);
    const tooLong = await author.post('/scenario/switch', { id: longId });
    assert.equal(tooLong.status, 400);
    assert.match(((await tooLong.json()) as { error: string }).error, /too long/);
    assert.deepEqual(tooLong.headers.getSetCookie(), []);

    const named = await visitor().get('/scenario?id=atlas-lab');
    assert.equal(named.status, 200);
    assert.equal(((await named.json()) as { id: string }).id, 'atlas-lab');
    const missing = await visitor().get('/scenario?id=no-such');
    assert.equal(missing.status, 404);
    assert.match(((await missing.json()) as { error: string }).error, /Unknown scenario: no-such/);
  });
});

test("a switch leaves the run another visitor finished in /results", async () => {
  await withVisitors(async ({ visitor, launches }) => {
    const a = visitor();
    assert.equal((await a.post('/setup', settingsBody(mars))).status, 200);
    await waitFor(() => launches[0], "A's run");
    const before = await a.json<{ actors: Array<{ name: string }> }>('/results');
    assert.deepEqual(before.actors.map(x => x.name), ['Aria Chen']);

    assert.equal((await visitor().post('/scenario/switch', { id: atlasLab.id })).status, 200);
    const after = await a.json<{ actors: Array<{ name: string }>; isComplete: boolean }>('/results');
    assert.deepEqual(after.actors.map(x => x.name), ['Aria Chen']);
    assert.equal(after.isComplete, true);
    assert.equal((await a.json<{ id: string }>('/scenario')).id, 'mars-genesis');
  }, {
    runner: async (_config, broadcast) => {
      broadcast('sim', { type: 'turn_start', leader: 'Aria Chen', data: { turn: 1, time: 2035, title: 'Dust storm' } });
      broadcast('complete', {});
    },
  });
});

test('a client that connects after /setup replays which scenario the run is', async () => {
  await withVisitors(async ({ visitor, launches, base }) => {
    assert.equal((await visitor().post('/setup', quickstartBody(atlasLab))).status, 200);
    await waitFor(() => launches[0], 'the run');
    const replay = await readReplay(base);
    assert.equal(replay[0]?.event, 'active_scenario', `first replayed frame: ${replay[0]?.event}`);
    assert.equal(replay[0].data.id, 'atlas-lab');
    assert.equal(replay[0].data.name, 'Atlas Lab');
  });
});

test("each run's opening event carries a key of its own, so a page can tell a new run from a reconnect to the same one", async () => {
  await withVisitors(async ({ visitor, launches, base }) => {
    const v = visitor();
    assert.equal((await v.post('/setup', settingsBody(mars))).status, 200);
    await waitFor(() => launches[0], 'the first run');
    const first = (await readReplay(base))[0];
    const again = (await readReplay(base))[0];
    assert.equal(first?.event, 'active_scenario');
    assert.equal(typeof first.data.runKey, 'string');
    assert.ok((first.data.runKey as string).length > 0);
    assert.equal(again.data.runKey, first.data.runKey, 'a reconnect replays the same run');

    assert.equal((await v.post('/setup', settingsBody(mars))).status, 200);
    await waitFor(() => launches[1], 'the second run');
    const second = (await readReplay(base))[0];
    assert.equal(second?.event, 'active_scenario');
    assert.equal(second.data.id, 'mars-genesis');
    assert.notEqual(second.data.runKey, first.data.runKey);
  });
});

test('GET /scenario and GET /scenarios answer per visitor, so no cache in front of the server keeps them', async () => {
  await withVisitors(async ({ visitor }) => {
    for (const path of ['/scenario', '/scenarios']) {
      const res = await visitor().get(path);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
      assert.equal(res.headers.get('vary'), 'Cookie', path);
    }
  });
});

test('an admin delete of the picked scenario leaves its visitor on the default', async () => {
  await withVisitors(async ({ visitor, base }) => {
    const v = visitor();
    assert.equal((await v.post('/scenario/store', { scenario: oceanStation, saveToDisk: false })).status, 200);
    assert.equal((await v.post('/scenario/switch', { id: oceanStation.id })).status, 200);
    assert.equal((await v.json<{ id: string }>('/scenario')).id, 'deep-ocean-station');

    const deleted = await fetch(`${base}/admin/scenarios/${oceanStation.id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': 'admin-test-token' },
    });
    assert.equal(deleted.status, 200);
    assert.equal(v.cookies.get('paracosm_scenario'), 'deep-ocean-station', 'the stale cookie stays');
    assert.equal((await v.json<{ id: string }>('/scenario')).id, 'mars-genesis');
    assert.equal((await v.json<{ active: string }>('/scenarios')).active, 'mars-genesis');
  }, { env: { ADMIN_WRITE: 'true', ADMIN_TOKEN: 'admin-test-token' } });
});

/** A saved Atlas Lab run with kernel snapshots at turns 1 and 2. */
function atlasParent(scenarioId = atlasLab.id) {
  return {
    metadata: {
      runId: 'parent-1',
      scenario: { id: scenarioId, name: 'Atlas Lab' },
      mode: 'turn-loop',
      startedAt: '2026-10-30T20:24:31.000Z',
    },
    scenarioExtensions: {
      kernelSnapshotsPerTurn: [1, 2].map(turn => ({
        snapshotVersion: 1, scenarioId, turn, time: turn, state: {}, rngState: 0, startTime: 1, seed: 11,
      })),
    },
  };
}

test("a fork that names no scenario runs in its parent's", async () => {
  // The fork asks for turn 3, which the parent never saved, so the fork
  // validator refuses it after its scenario check and no fork is started.
  // A fork resolved to the default would stop at that scenario check.
  await withVisitors(async ({ visitor, launches }) => {
    const fork = (extra: Record<string, unknown> = {}, parent = atlasParent()) => visitor().post('/setup', {
      actors: [atlasLab.presets[0].leaders[0]],
      turns: 6,
      seed: 11,
      forkFrom: { parentArtifact: parent, atTurn: 3 },
      ...extra,
    });

    const own = await fork();
    assert.equal(own.status, 400);
    assert.match(((await own.json()) as { error: string }).error, /no kernel snapshot for turn 3/);

    const crossed = await fork({ scenarioId: mars.id });
    assert.equal(crossed.status, 400);
    assert.match(((await crossed.json()) as { error: string }).error, /does not match/);

    const orphan = await fork({}, atlasParent('no-such'));
    assert.equal(orphan.status, 400);
    assert.match(((await orphan.json()) as { error: string }).error, /Unknown scenario/);
    assert.equal(launches.length, 0);
  });
});

test('a pick still compiling after a restart waits instead of falling to Mars', async () => {
  // Boot re-compiles the persisted compiled drafts in the background. Until
  // one lands, a visitor whose cookie names it is told to wait; a run is
  // neither started nor counted against the daily limit.
  const scenarioDir = mkdtempSync(join(tmpdir(), 'paracosm-hydrating-'));
  mkdirSync(join(scenarioDir, 'compiled'));
  const { hooks: _hooks, ...draft } = oceanStation;
  for (const id of ['held-station', 'broken-station']) {
    writeFileSync(join(scenarioDir, 'compiled', `${id}.json`), JSON.stringify({
      ...draft,
      id,
      _persistMeta: { compiledAt: '2026-11-02T00:00:00.000Z', seedText: `a brief about ${id}` },
    }));
  }
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  try {
    await withVisitors(async ({ visitor, launches }) => {
      const held = visitor({ paracosm_scenario: 'held-station' });

      const waiting = await held.get('/scenario');
      assert.equal(waiting.status, 503);
      assert.equal(waiting.headers.get('retry-after'), '5');
      assert.match(((await waiting.json()) as { error: string }).error, /held-station is still loading/);
      assert.equal((await held.json<{ active: string }>('/scenarios')).active, 'held-station');

      const named = await held.post('/setup', { ...settingsBody(mars), scenarioId: 'held-station' });
      assert.equal(named.status, 503);
      assert.equal(named.headers.get('retry-after'), '5');
      const picked = await held.post('/setup', { actors: mars.presets[0].leaders, turns: 2, seed: 7 });
      assert.equal(picked.status, 503);
      const switching = await visitor().post('/scenario/switch', { id: 'held-station' });
      assert.equal(switching.status, 503);
      assert.equal(launches.length, 0);

      release();
      const ready = await waitFor(async () => {
        const res = await held.get('/scenario');
        return res.status === 200 ? await res.json() as { id: string } : null;
      }, 'the held draft to compile');
      assert.equal(ready.id, 'held-station');

      // The day's one run was not spent on the refused requests.
      const run = await held.post('/setup', { ...settingsBody(mars), scenarioId: 'held-station' });
      assert.equal(run.status, 200);
      assert.equal((await waitFor(() => launches[0], 'the run')).scenario?.id, 'held-station');

      const broken = visitor({ paracosm_scenario: 'broken-station' });
      const fallen = await waitFor(async () => {
        const res = await broken.get('/scenario');
        return res.status === 200 ? await res.json() as { id: string } : null;
      }, 'the broken draft to fail');
      assert.equal(fallen.id, 'mars-genesis');
    }, {
      scenarioDir,
      maxSimsPerDay: 1,
      compileScenario: async scenarioJson => {
        await released;
        if (scenarioJson.id === 'broken-station') throw new Error('the hook cache is cold');
        return { ...oceanStation, id: String(scenarioJson.id), labels: { ...oceanStation.labels, name: 'Held Station' } } as unknown as ScenarioPackage;
      },
    });
  } finally {
    release();
    rmSync(scenarioDir, { recursive: true, force: true });
  }
});

test("a long run's replay still opens with its scenario after the buffer trims", async () => {
  await withVisitors(async ({ visitor, launches, base }) => {
    assert.equal((await visitor().post('/setup', quickstartBody(atlasLab))).status, 200);
    await waitFor(() => launches[0], 'the run');
    const replay = await readReplay(base);
    assert.equal(replay[0]?.event, 'active_scenario', `first replayed frame: ${replay[0]?.event}`);
    assert.equal(replay[0].data.id, 'atlas-lab');
    assert.deepEqual(
      replay.slice(1).map(frame => (frame.data.data as { turn: number }).turn),
      [8, 9, 10, 11, 12],
      'the newest five frames follow it',
    );
    assert.equal(replay.length, 6, 'the cap plus the run\'s scenario frame');
  }, {
    env: { PARACOSM_EVENT_BUFFER_MAX: '5' },
    runner: async (_config, broadcast) => {
      for (let turn = 1; turn <= 12; turn++) {
        broadcast('sim', { type: 'turn_start', leader: 'Marcus Reinhardt', data: { turn, time: turn } });
      }
    },
  });
});
