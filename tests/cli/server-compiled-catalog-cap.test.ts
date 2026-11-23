/** The shared compiled catalog, its saved drafts, and requests that finish after an entry leaves. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mars, settingsBody, startServer, waitFor, type RunServer } from './helpers/run-server.js';
import { _resetCompileJobsForTest, handleGroundScenario } from '../../src/server/routes/quickstart.js';

const oceanStation = {
  id: 'stored-ocean-station',
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

/** The ocean station under another id and name. */
function station(id: string, name = `Station ${id}`) {
  return { ...oceanStation, id, labels: { ...oceanStation.labels, name } };
}

type Visitor = ReturnType<RunServer['cookied']>;
type ServerOptions = NonNullable<Parameters<typeof startServer>[0]>;
const TOKEN = 'compiled-catalog-test-token';
const ADMIN_ENV = { ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN };
const numbered = (prefix: string, i: number, width = 2) => `${prefix}-${String(i).padStart(width, '0')}`;
const seed = (id: string) => `${id}: A station with crew, resources and a plan for its next season. `.repeat(6);

interface Box { api: RunServer; scenarioDir: string; compiles: string[] }
async function withCatalog(
  body: (box: Box) => Promise<void>,
  options: ServerOptions & { drafts?: boolean; bootGate?: Promise<void> } = {},
): Promise<void> {
  _resetCompileJobsForTest();
  const root = mkdtempSync(join(tmpdir(), 'paracosm-compiled-cap-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  if (options.drafts) {
    for (let i = 0; i < 50; i++) {
      const id = numbered('a', i);
      const time = Date.now() - (60 - i) * 60_000;
      const { hooks: _hooks, ...draft } = station(id);
      const file = join(scenarioDir, 'compiled', `${id}.json`);
      writeFileSync(file, JSON.stringify({ ...draft, _persistMeta: { compiledAt: new Date(time).toISOString(), seedText: null } }));
      utimesSync(file, time / 1000, time / 1000);
    }
  }
  const compiles: string[] = [];
  const { drafts: _drafts, bootGate, ...serverOptions } = options;
  const api = await startServer({
    ...serverOptions, scenarioDir,
    compileScenario: async scenario => {
      compiles.push(String(scenario.id));
      if (String(scenario.id).startsWith('a-')) await bootGate;
      return { ...scenario, hooks: {} } as never;
    },
  });
  try { await body({ api, scenarioDir, compiles }); }
  finally {
    await api.close();
    _resetCompileJobsForTest();
    rmSync(api.appDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

async function catalog(v: Visitor): Promise<Array<{ id: string; source: string }>> {
  return (await v.json<{ scenarios: Array<{ id: string; source: string }> }>('/scenarios')).scenarios;
}
async function compiledIds(v: Visitor): Promise<string[]> {
  return (await catalog(v)).filter(e => e.source === 'compiled').map(e => e.id).sort();
}
function savedIds(dir: string): string[] {
  return readdirSync(join(dir, 'compiled')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}
async function compile(v: Visitor, id: string): Promise<void> {
  const res = await v.post('/compile', { scenario: station(id), webSearch: false });
  assert.equal(res.status, 200, `compile ${id}: ${res.status}`);
  const stream = await res.text();
  assert.match(stream, /event: complete/);
  assert.doesNotMatch(stream, /event: error/);
}
async function compileRange(v: Visitor, start: number, end: number, width = 2): Promise<void> {
  for (let i = start; i <= end; i++) await compile(v, numbered('c', i, width));
}
async function quickstart(v: Visitor, seedText: string) {
  const start = await v.post('/api/quickstart/compile-from-seed', { seedText });
  assert.equal(start.status, 202);
  const { jobId } = await start.json() as { jobId: string };
  const done = await waitFor(async () => {
    const res = await v.post('/api/quickstart/compile-from-seed/status', { jobId });
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; scenarioId?: string; error?: string };
    assert.notEqual(body.status, 'error', body.error);
    return body.status === 'done' ? { res, body } : null;
  }, 'the compile to finish', 5000);
  return { jobId, ...done };
}
async function hydrated(v: Visitor): Promise<void> {
  await waitFor(async () => (await compiledIds(v)).length === 50, '50 saved drafts to load', 5000);
}

test('fifty-one compiles leave fifty, and the first id stays taken after a thousand more leave', async () => {
  await withCatalog(async ({ api, compiles }) => {
    const v = api.cookied();
    const check = async () => {
      const entries = await catalog(v);
      assert.equal(entries.filter(e => e.source === 'compiled').length, 50);
      assert.ok(!entries.some(e => e.id === 'c-0000'));
      for (const id of ['mars-genesis', 'lunar-outpost']) assert.ok(entries.some(e => e.id === id));
      const pick = api.visitor({ paracosm_scenario: 'c-0000' });
      assert.equal((await pick.json('/scenario')).id, 'mars-genesis');
      const before = compiles.length;
      const res = await v.post('/compile', { scenario: station('c-0000') });
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: '"c-0000" is taken on this server. Give your scenario an id of its own.' });
      assert.equal(compiles.length, before);
    };
    await compileRange(v, 0, 50, 4);
    await check();
    await compileRange(v, 51, 1075, 4);
    await check();
  });
});

test('a retired id is free again after thirty-one days', async t => {
  await withCatalog(async ({ api }) => {
    const v = api.cookied();
    await compileRange(v, 0, 50);
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      t.mock.timers.tick(30 * 86_400_000);
      const taken = await v.post('/compile', { scenario: station('c-00') });
      assert.equal(taken.status, 409);
      await taken.text();
      t.mock.timers.tick(86_400_000 + 1);
      await compile(v, 'c-00');
      assert.ok((await compiledIds(v)).includes('c-00'));
    } finally { t.mock.timers.reset(); }
  });
});

test("one address's Quickstart compiles on the hosted demo leave the other saved scenarios", async () => {
  let calls = 0;
  await withCatalog(async ({ api, scenarioDir }) => {
    const v = api.cookied();
    await hydrated(v);
    for (let i = 1; i <= 5; i++) assert.equal((await quickstart(v, seed(`hosted-${i}`))).body.scenarioId, `q-${i}`);
    const expected = [...Array.from({ length: 49 }, (_, i) => numbered('a', i + 1)), 'q-5'];
    assert.equal((await compiledIds(v)).length, 50);
    assert.deepEqual(await compiledIds(v), expected);
    assert.deepEqual(savedIds(scenarioDir), expected);
    await api.close();
    const restarted = await startServer({ scenarioDir, env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test' }, compileScenario: async sc => ({ ...sc, hooks: {} }) as never });
    try {
      await hydrated(restarted.cookied());
      assert.deepEqual(await compiledIds(restarted.cookied()), expected);
    } finally {
      await restarted.close();
      rmSync(restarted.appDir, { recursive: true, force: true });
    }
  }, { drafts: true, env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test' }, extra: { compileFromSeed: async () => station(`q-${++calls}`) } });
});

test('a scenario a held run is in stays', async () => {
  await withCatalog(async ({ api }) => {
    const v = api.cookied();
    await compile(v, 'x-held');
    const setup = await v.post('/setup', { ...settingsBody(mars), scenarioId: 'x-held' });
    assert.equal(setup.status, 200);
    await setup.text();
    await compileRange(v, 0, 49);
    const ids = await compiledIds(v);
    assert.equal(ids.length, 50);
    assert.ok(ids.includes('x-held'));
    assert.ok(!ids.includes('c-00'));
  });
});

test("nothing leaves when the server's runs hold every other compiled scenario, and eviction resumes once they let go", async () => {
  await withCatalog(async ({ api }) => {
    const v = api.cookied();
    await compileRange(v, 0, 49);
    const visitors = Array.from({ length: 50 }, () => api.cookied());
    for (const [i, owner] of visitors.entries()) {
      const res = await owner.post('/setup', { ...settingsBody(mars), scenarioId: numbered('c', i) });
      assert.equal(res.status, 200);
      await res.text();
    }
    await compile(v, 'c-50');
    assert.equal((await compiledIds(v)).length, 51);
    assert.ok((await compiledIds(v)).includes('c-00'));
    for (const owner of visitors.slice(0, 2)) {
      const res = await owner.post('/clear', {});
      assert.equal(res.status, 200);
      await res.text();
    }
    await compile(v, 'c-51');
    const ids = await compiledIds(v);
    assert.equal(ids.length, 50);
    for (const id of ['c-00', 'c-01']) assert.ok(!ids.includes(id));
    for (const id of ['c-50', 'c-51']) assert.ok(ids.includes(id));
  }, { maxRuns: 60, maxHeldRuns: 60 });
});

test('/compile refuses a scenario over 256 KiB and takes one of exactly 256 KiB', async () => {
  await withCatalog(async ({ api, compiles }) => {
    const v = api.cookied();
    const sized = (id: string, bytes: number) => {
      const sc = { ...station(id), padding: '' };
      sc.padding = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(sc)));
      assert.equal(Buffer.byteLength(JSON.stringify(sc)), bytes);
      return sc;
    };
    const over = await v.post('/compile', { scenario: sized('over', 262_145) });
    const overBody = await over.text();
    const callsAfterOver = [...compiles];
    const exact = await v.post('/compile', { scenario: sized('exact', 262_144) });
    assert.equal(exact.status, 200);
    assert.match(await exact.text(), /event: complete/);
    assert.equal(compiles.filter(id => id === 'exact').length, 1);
    assert.equal(over.status, 413);
    assert.deepEqual(JSON.parse(overBody), { error: 'A scenario sent to /compile is at most 256 KiB of JSON.' });
    assert.deepEqual(callsAfterOver, []);
    assert.deepEqual(compiles, ['exact']);
  });
});

test('a finished job does not put back a scenario that left', async () => {
  let calls = 0;
  await withCatalog(async ({ api }) => {
    const v = api.cookied();
    const text = seed('finished');
    const done = await quickstart(v, text);
    assert.equal(done.body.scenarioId, 'q-0');
    assert.match(done.res.headers.get('set-cookie') ?? '', /paracosm_scenario=q-0/);
    await compileRange(v, 0, 49);
    const res = await v.post('/api/quickstart/compile-from-seed/status', { jobId: done.jobId });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { jobId: done.jobId, status: 'error', error: 'This scenario left the catalog to make room. Compile it again.' });
    assert.equal(res.headers.get('set-cookie'), null);
    const again = await v.post('/api/quickstart/compile-from-seed', { seedText: text });
    assert.equal(again.status, 202);
    assert.notEqual((await again.json() as { jobId: string }).jobId, done.jobId);
    assert.equal(calls, 2);
    const ids = await compiledIds(v);
    assert.ok(!ids.includes('q-0') && !ids.includes('q-0-2'));
  }, { extra: { compileFromSeed: () => ++calls === 1 ? Promise.resolve(station('q-0')) : new Promise(() => {}) } });
});

test("an admin's disk save of a compiled scenario takes its saved draft", async () => {
  await withCatalog(async ({ api, scenarioDir }) => {
    const v = api.cookied({ 'X-Admin-Token': TOKEN });
    await hydrated(v);
    const res = await v.post('/scenario/store', { scenario: station('a-49'), saveToDisk: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { savedToDisk: boolean }).savedToDisk, true);
    await quickstart(v, seed('disk-save'));
    const ids = savedIds(scenarioDir);
    assert.equal(ids.length, 50);
    assert.ok(!ids.includes('a-49'), 'the disk save removed compiled/a-49.json');
    assert.ok(ids.includes('a-00') && ids.includes('q-0'));
    assert.equal((await catalog(v)).find(e => e.id === 'a-49')?.source, 'disk');
    assert.equal((await compiledIds(v)).length, 50);
  }, { drafts: true, env: ADMIN_ENV, extra: { compileFromSeed: async () => station('q-0') } });
});

test("a compile during boot's re-compile keeps the folder and the catalog at 50", async () => {
  let release!: () => void;
  const bootGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await withCatalog(async ({ api, scenarioDir }) => {
      const v = api.cookied();
      await quickstart(v, seed('during-boot'));
      const expected = [...Array.from({ length: 49 }, (_, i) => numbered('a', i + 1)), 'q-0'];
      assert.deepEqual(savedIds(scenarioDir), expected);
      release();
      await waitFor(async () => (await compiledIds(v)).includes('a-01'), 'boot to reach a-01', 5000);
      await delay(300);
      assert.equal((await compiledIds(v)).length, 50);
      assert.deepEqual(await compiledIds(v), expected);
    }, { drafts: true, bootGate, extra: { compileFromSeed: async () => station('q-0') } });
  } finally { release(); }
});

test('a rename whose scenario leaves while its body is read writes nothing', async () => {
  await withCatalog(async ({ api, scenarioDir }) => {
    const v = api.cookied();
    await compile(v, 'x');
    const body = JSON.stringify({ name: 'New name' });
    const req = request(`${api.base}/scenarios/x/rename`, { method: 'POST', headers: {
      'X-Admin-Token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    } });
    const response = new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
      req.on('error', reject);
      req.on('response', res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        res.on('error', reject);
      });
    });
    try {
      req.write(body.slice(0, 1));
      await delay(50);
      await compileRange(v, 0, 49);
      req.end(body.slice(1));
      const res = await response;
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'scenario_not_found', id: 'x' });
      assert.equal(existsSync(join(scenarioDir, 'compiled', 'x.json')), false);
      assert.ok(!(await compiledIds(v)).includes('x'));
    } finally { req.destroy(); }
  }, { env: ADMIN_ENV });
});

test('ground-scenario records nothing for a scenario that left while it searched', async t => {
  const keys = ['SERPER_API_KEY', 'TAVILY_API_KEY', 'FIRECRAWL_API_KEY'] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.SERPER_API_KEY = 'test-serper-key';
  delete process.env.TAVILY_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let searchStarted!: () => void;
  const started = new Promise<void>(resolve => { searchStarted = resolve; });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    searchStarted();
    await gate;
    return new Response(JSON.stringify({ organic: [{ title: 't', link: 'https://example.org/a', snippet: 's' }] }), { status: 200 });
  });
  let present = true;
  const sc = station('x-ground');
  const record = t.mock.fn();
  let status = 0;
  let body = '';
  const res = { writeHead: (code: number) => { status = code; }, end: (text: string) => { body = text; } };
  try {
    const pending = handleGroundScenario({} as IncomingMessage, res as unknown as ServerResponse, { scenarioId: sc.id }, {
      installCompiledScenario: () => {},
      getScenarioById: () => present ? sc as never : undefined,
      fetchSeedFromUrl: async () => ({ text: '', title: '', sourceUrl: '' }),
      defaultProvider: 'openai', defaultModel: 'test', recordGroundingCitations: record,
    });
    await started;
    present = false;
    release();
    await pending;
    assert.equal(status, 200);
    assert.ok(Array.isArray(JSON.parse(body).citations));
    assert.equal(record.mock.callCount(), 0);
  } finally {
    release();
    fetchMock.mock.restore();
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test("an admin's disk save during boot removes the waiting compiled draft", async () => {
  let release!: () => void;
  const bootGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await withCatalog(async ({ api, scenarioDir, compiles }) => {
      const v = api.cookied({ 'X-Admin-Token': TOKEN });
      await waitFor(() => compiles.includes('a-49'), 'boot to start its newest draft');
      const res = await v.post('/scenario/store', {
        scenario: station('a-49', 'Saved during boot'), saveToDisk: true,
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json() as { savedToDisk: boolean }).savedToDisk, true);
      const draftRemains = existsSync(join(scenarioDir, 'compiled', 'a-49.json'));
      release();
      await waitFor(async () => (await compiledIds(v)).includes('a-00'), 'boot to finish its remaining drafts', 5000);
      assert.equal((await catalog(v)).find(e => e.id === 'a-49')?.source, 'disk');
      const scenario = await v.json<{ labels: { name: string } }>('/scenario?id=a-49');
      assert.equal(scenario.labels.name, 'Saved during boot');
      assert.equal(draftRemains, false, 'the disk save removes the waiting compiled draft');
      assert.equal((await compiledIds(v)).length, 49);
      assert.ok(!savedIds(scenarioDir).includes('a-49'));
    }, { drafts: true, bootGate, env: ADMIN_ENV });
  } finally { release(); }
});

/** The station as a draft that is not a runnable package: no hooks. */
function draftStation(id: string, name = `Draft ${id}`) {
  const { hooks: _hooks, ...draft } = station(id, name);
  return draft;
}

test("an admin's disk save of a draft that is not runnable takes the compiled scenario and its saved draft", async () => {
  await withCatalog(async ({ api, scenarioDir }) => {
    const v = api.cookied({ 'X-Admin-Token': TOKEN });
    await hydrated(v);
    const res = await v.post('/scenario/store', { scenario: draftStation('a-49'), saveToDisk: true });
    assert.equal(res.status, 200);
    const body = await res.json() as { savedToDisk: boolean; switchable: boolean };
    assert.equal(body.savedToDisk, true);
    assert.equal(body.switchable, false);
    assert.ok(existsSync(join(scenarioDir, 'a-49.json')), 'the disk save wrote scenarios/a-49.json');
    assert.ok(!savedIds(scenarioDir).includes('a-49'), 'the disk save removed compiled/a-49.json');
    assert.equal((await catalog(v)).find(e => e.id === 'a-49'), undefined);
    assert.equal((await compiledIds(v)).length, 49);
  }, { drafts: true, env: ADMIN_ENV });
});

test("an admin's disk save of a draft that is not runnable during boot ends the waiting compiled draft", async () => {
  let release!: () => void;
  const bootGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await withCatalog(async ({ api, scenarioDir, compiles }) => {
      const v = api.cookied({ 'X-Admin-Token': TOKEN });
      await waitFor(() => compiles.includes('a-49'), 'boot to start its newest draft');
      const res = await v.post('/scenario/store', { scenario: draftStation('a-49'), saveToDisk: true });
      assert.equal(res.status, 200);
      assert.equal((await res.json() as { switchable: boolean }).switchable, false);
      const draftRemains = existsSync(join(scenarioDir, 'compiled', 'a-49.json'));
      release();
      await waitFor(async () => (await compiledIds(v)).includes('a-00'), 'boot to finish its remaining drafts', 5000);
      await delay(100);
      assert.equal(draftRemains, false, 'the disk save removes the waiting compiled draft');
      assert.equal((await catalog(v)).find(e => e.id === 'a-49'), undefined, 'boot does not put the old draft in the catalog');
      assert.equal((await compiledIds(v)).length, 49);
      assert.ok(!savedIds(scenarioDir).includes('a-49'));
    }, { drafts: true, bootGate, env: ADMIN_ENV });
  } finally { release(); }
});
