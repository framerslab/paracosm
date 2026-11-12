/**
 * What may enter the catalog every visitor reads, and what stays a visitor's own.
 *
 * The catalog holds the built-in scenarios, the curated ones from the
 * scenarios folder and the compiled ones. A compile (POST /compile), a
 * Quickstart compile (POST /api/quickstart/compile-from-seed) and the boot
 * re-compile of saved drafts each wrote the catalog under the id the scenario
 * carried, so any of them could put another scenario in the place of one the
 * catalog already held, for every visitor.
 *
 * Now none of them replaces a catalog entry:
 * - POST /compile answers 409, before its stream starts and before the
 *   compiler is called, for an id the catalog holds, an id boot is still
 *   re-compiling, or an id another visitor holds in memory. Under a new id,
 *   or an id the caller alone stored in memory, it lands in the catalog.
 * - A Quickstart compile whose id is taken lands under the next free id
 *   (`<id>-2`, `<id>-3`).
 * - Boot leaves out a saved draft whose id the catalog already holds.
 *
 * The memory store (POST /scenario/store) keeps a visitor's own scenarios:
 * - GET /scenarios/:id answers for a visitor's own stored scenario.
 * - A stored id that enters the catalog leaves the memory store, so it no
 *   longer counts toward its visitor's 10 or the store's 100.
 * - One address holds at most 20 stored scenarios, whatever visitor ids it
 *   sends, and a stored scenario left unused for the idle time (24 hours by
 *   default) is dropped, so a full store does not stay full until a restart.
 *
 * Every test goes through createMarsServer over HTTP with a scenarios folder
 * of its own that holds scenarios/atlas-lab.json, one cookie jar per visitor,
 * a stub compiler that returns the JSON it is given and a stub simulation
 * runner, so no model or network is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasLab, mars, settingsBody, startServer, waitFor, type RunServer } from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

/** The limits the server holds the memory store to. */
const PER_VISITOR = 10;
const PER_ADDRESS = 20;

/** A runnable scenario (the one tests/cli/server-app-scenario-store-memory.test.ts stores). */
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

const TOKEN = 'catalog-scope-test-token';
const ADMIN_ENV = { ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN };

interface Sandbox {
  api: RunServer;
  /** The server's scenarios folder: scenarios/atlas-lab.json and whatever the test saved. */
  scenarioDir: string;
  /** The id of every scenario the stub compiler was handed, in order. */
  compiles: string[];
}

interface SandboxOptions {
  env?: Record<string, string>;
  /** Saved compiled drafts put in `<scenarioDir>/compiled/` before the server starts; a greater age is an older file. */
  drafts?: Array<{ id: string; name: string; ageSeconds: number }>;
  /** Further createMarsServer options. */
  extra?: Record<string, unknown>;
}

/** A server whose scenarios folder is a temporary folder holding scenarios/atlas-lab.json. */
async function withCatalog(body: (box: Sandbox) => Promise<void>, options: SandboxOptions = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-catalog-scope-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('../../scenarios/atlas-lab.json', import.meta.url)), join(scenarioDir, 'atlas-lab.json'));
  const now = Math.floor(Date.now() / 1000);
  for (const { id, name, ageSeconds } of options.drafts ?? []) {
    const { hooks: _hooks, ...draft } = station(id, name);
    const file = join(scenarioDir, 'compiled', `${id}.json`);
    writeFileSync(file, JSON.stringify({ ...draft, _persistMeta: { compiledAt: '2026-11-02T00:00:00.000Z', seedText: null } }));
    utimesSync(file, now - ageSeconds, now - ageSeconds);
  }
  const compiles: string[] = [];
  const api = await startServer({
    env: options.env,
    scenarioDir,
    // The compiler's answer is the JSON it was given, which every test sends runnable.
    compileScenario: async scenarioJson => {
      compiles.push(String(scenarioJson.id));
      return { ...scenarioJson, hooks: {} } as unknown as ScenarioPackage;
    },
    extra: options.extra,
  });
  try {
    await body({ api, scenarioDir, compiles });
  } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

interface CatalogEntry { id: string; name: string; source: string }

async function catalog(v: Visitor): Promise<CatalogEntry[]> {
  return (await v.json<{ scenarios: CatalogEntry[] }>('/scenarios')).scenarios;
}

async function entry(v: Visitor, id: string): Promise<CatalogEntry | undefined> {
  return (await catalog(v)).find(e => e.id === id);
}

async function storedIds(v: Visitor): Promise<string[]> {
  return (await v.json<{ memoryScenarios: string[] }>('/admin-config')).memoryScenarios;
}

function store(v: Visitor, scenario: unknown): Promise<Response> {
  return v.post('/scenario/store', { scenario, saveToDisk: false });
}

/** POST /compile, as the editor sends it. */
function compile(v: Visitor, scenario: unknown): Promise<Response> {
  return v.post('/compile', { scenario, webSearch: false });
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

/** A seed long enough for the Quickstart compile (200 characters at least) that carries `marker`. */
function seed(marker: string): string {
  return `${marker}: a settlement brief written for the catalog scope tests. `.repeat(5);
}

/** Starts a Quickstart compile and polls it to the end, as the page does. */
async function quickstartCompile(v: Visitor, seedText: string): Promise<string> {
  const started = await v.post('/api/quickstart/compile-from-seed', { seedText });
  assert.ok(started.status === 202 || started.status === 200, `compile-from-seed: ${started.status}`);
  const { jobId } = await started.json() as { jobId: string };
  return waitFor(async () => {
    const res = await v.post('/api/quickstart/compile-from-seed/status', { jobId });
    const body = await res.json() as { status: string; scenarioId?: string; error?: string };
    assert.notEqual(body.status, 'error', `the compile failed: ${body.error}`);
    return body.status === 'done' ? body.scenarioId : null;
  }, 'the Quickstart compile to finish', 5000);
}

test('a compile under the id of a built-in or a curated scenario is refused before it starts and changes nothing anyone sees or runs', async () => {
  await withCatalog(async ({ api, scenarioDir, compiles }) => {
    const a = api.cookied();
    const b = api.cookied();
    const cookieless = api.visitor();
    for (const [who, author] of [['a visitor', a], ['a caller with no cookie', cookieless]] as const) {
      for (const id of [mars.id, atlasLab.id]) {
        const res = await compile(author, station(id, 'Replaced'));
        assert.equal(res.status, 409, `${who} compiling ${id}: ${res.status}`);
        assert.match(res.headers.get('content-type') ?? '', /application\/json/, 'the refusal is JSON, not a stream');
        assert.match(await errorOf(res), new RegExp(`"${id}" is taken on this server`));
      }
    }
    assert.deepEqual(compiles, [], 'no refused compile reached the compiler');

    for (const [who, reader] of [['A', a], ['B', b], ['a caller with no cookie', cookieless]] as const) {
      const entries = await catalog(reader);
      assert.equal(entries.find(e => e.id === mars.id)?.name, 'Mars Genesis', `${who}'s catalog`);
      assert.equal(entries.find(e => e.id === mars.id)?.source, 'builtin', `${who}'s catalog`);
      assert.equal(entries.find(e => e.id === atlasLab.id)?.name, 'Atlas Lab', `${who}'s catalog`);
      assert.equal(entries.find(e => e.id === atlasLab.id)?.source, 'disk', `${who}'s catalog`);
      assert.equal(entries.filter(e => e.name === 'Replaced').length, 0, `${who}'s catalog`);
    }

    // A built-in stays a built-in: it takes no rename and nothing is saved under its id.
    const rename = await a.post(`/scenarios/${mars.id}/rename`, { name: 'Renamed' });
    assert.equal(rename.status, 400);
    assert.equal(existsSync(join(scenarioDir, 'compiled', `${mars.id}.json`)), false, 'no compiled draft saved under the built-in id');

    // B runs the built-in by its id and gets the built-in.
    const run = await b.post('/setup', settingsBody(mars));
    assert.equal(run.status, 200);
    assert.equal((await waitFor(() => api.launches[0], "B's run")).scenario?.labels.name, 'Mars Genesis');
  });
});

test('at boot a saved compiled draft under the id of a built-in or a curated scenario is left out, and that scenario stays', async () => {
  await withCatalog(async ({ api, compiles }) => {
    const reader = api.cookied();
    // Boot compiles newest first, so the kept draft, the oldest, lands last.
    await waitFor(async () => (await entry(reader, 'kept-station')) ?? null, 'the kept draft to load', 5000);
    const entries = await catalog(reader);
    assert.equal(entries.find(e => e.id === mars.id)?.name, 'Mars Genesis');
    assert.equal(entries.find(e => e.id === mars.id)?.source, 'builtin');
    assert.equal(entries.find(e => e.id === atlasLab.id)?.name, 'Atlas Lab');
    assert.equal(entries.find(e => e.id === atlasLab.id)?.source, 'disk');
    assert.equal(entries.find(e => e.id === 'kept-station')?.name, 'Kept Station');
    assert.equal(entries.find(e => e.id === 'kept-station')?.source, 'compiled');
    assert.deepEqual(compiles, ['kept-station'], 'the drafts left out were not compiled');
  }, {
    drafts: [
      { id: mars.id, name: 'Replaced Mars', ageSeconds: 10 },
      { id: atlasLab.id, name: 'Replaced Atlas', ageSeconds: 20 },
      { id: 'kept-station', name: 'Kept Station', ageSeconds: 30 },
    ],
  });
});

test('a Quickstart compile whose id is taken lands under an id of its own and replaces nothing', async () => {
  const compiled: Record<string, { id: string; name: string }> = {
    'scope-marker-mars': { id: mars.id, name: 'Seeded Mars' },
    'scope-marker-tide-one': { id: 'tidal-station', name: 'Tidal One' },
    'scope-marker-tide-two': { id: 'tidal-station', name: 'Tidal Two' },
  };
  await withCatalog(async ({ api, scenarioDir }) => {
    const a = api.cookied();
    const b = api.cookied();

    // The compiled scenario carries a built-in's id.
    const seeded = await quickstartCompile(a, seed('scope-marker-mars'));
    assert.equal(seeded, `${mars.id}-2`);
    assert.equal((await entry(b, mars.id))?.name, 'Mars Genesis');
    assert.equal((await entry(b, mars.id))?.source, 'builtin');
    assert.equal((await entry(b, seeded))?.name, 'Seeded Mars');
    assert.equal((await entry(b, seeded))?.source, 'compiled');
    assert.equal((await a.json<{ id: string }>('/scenario')).id, seeded, 'the compiled scenario is its visitor\'s pick');
    assert.equal(existsSync(join(scenarioDir, 'compiled', `${mars.id}.json`)), false, 'nothing saved under the built-in id');
    assert.equal(existsSync(join(scenarioDir, 'compiled', `${seeded}.json`)), true, 'the compiled draft is saved under its own id');

    // Two visitors' compiles carry one id: the second takes the next free id.
    assert.equal(await quickstartCompile(a, seed('scope-marker-tide-one')), 'tidal-station');
    assert.equal(await quickstartCompile(b, seed('scope-marker-tide-two')), 'tidal-station-2');
    assert.equal((await entry(a, 'tidal-station'))?.name, 'Tidal One');
    assert.equal((await entry(a, 'tidal-station-2'))?.name, 'Tidal Two');
    const run = await a.post('/setup', { ...settingsBody(mars), scenarioId: 'tidal-station' });
    assert.equal(run.status, 200);
    assert.equal((await waitFor(() => api.launches[0], "A's run")).scenario?.labels.name, 'Tidal One');

    // The same brief again is the same scenario, under the id it already has.
    assert.equal(await quickstartCompile(b, seed('scope-marker-tide-one')), 'tidal-station');
    assert.equal((await catalog(b)).filter(e => e.id.startsWith('tidal-station')).length, 2);
  }, {
    extra: {
      compileFromSeed: async (input: { seedText: string }) => {
        const marker = Object.keys(compiled).find(key => input.seedText.includes(key));
        assert.ok(marker, 'a seed of this test');
        return station(compiled[marker].id, compiled[marker].name) as unknown as ScenarioPackage;
      },
    },
  });
});

test("a compile under an id another visitor's compile or stored scenario already uses is refused, and what that visitor runs stays", async () => {
  await withCatalog(async ({ api, compiles }) => {
    const a = api.cookied();
    const b = api.cookied();

    // A new id lands in the catalog for every visitor.
    const first = await compile(a, station('tide-station', 'Compiled by A'));
    assert.equal(first.status, 200);
    assert.match(await first.text(), /event: complete/);
    assert.equal((await entry(b, 'tide-station'))?.name, 'Compiled by A');
    assert.equal((await entry(b, 'tide-station'))?.source, 'compiled');

    // Another visitor's compile under that id is refused; so is its author's second one.
    for (const [who, author] of [['B', b], ['A', a]] as const) {
      const again = await compile(author, station('tide-station', `Recompiled by ${who}`));
      assert.equal(again.status, 409, `${who} compiling tide-station again: ${again.status}`);
      assert.match(await errorOf(again), /"tide-station" is taken on this server/);
    }
    assert.equal((await entry(a, 'tide-station'))?.name, 'Compiled by A');
    const aRun = await a.post('/setup', { ...settingsBody(mars), scenarioId: 'tide-station' });
    assert.equal(aRun.status, 200);
    assert.equal((await waitFor(() => api.launches[0], "A's run")).scenario?.labels.name, 'Compiled by A');

    // An id another visitor holds in memory is taken too.
    assert.equal((await store(b, station('reef-station', "B's Reef"))).status, 200);
    const overStored = await compile(a, station('reef-station', "A's Reef"));
    assert.equal(overStored.status, 409);
    assert.match(await errorOf(overStored), /"reef-station" is taken on this server/);
    assert.equal(await entry(a, 'reef-station'), undefined, "A's catalog");
    const bRun = await b.post('/setup', { ...settingsBody(mars), scenarioId: 'reef-station' });
    assert.equal(bRun.status, 200);
    assert.equal((await waitFor(() => api.launches[1], "B's run")).scenario?.labels.name, "B's Reef");

    // The visitor who stored it can compile it: it leaves their memory store for the catalog.
    const own = await compile(b, station('reef-station', "B's Compiled Reef"));
    assert.equal(own.status, 200);
    assert.match(await own.text(), /event: complete/);
    assert.equal((await entry(a, 'reef-station'))?.name, "B's Compiled Reef");
    assert.equal((await entry(a, 'reef-station'))?.source, 'compiled');
    assert.deepEqual(await storedIds(b), []);
    assert.deepEqual(compiles, ['tide-station', 'reef-station'], 'no refused compile reached the compiler');
  });
});

test('a visitor reads the detail of a scenario they stored, and no one else does', async () => {
  await withCatalog(async ({ api }) => {
    const a = api.cookied();
    const b = api.cookied();
    assert.equal((await store(a, oceanStation)).status, 200);
    assert.equal((await entry(a, oceanStation.id))?.source, 'memory');

    const own = await a.get(`/scenarios/${oceanStation.id}`);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    assert.equal(own.headers.get('vary'), 'Cookie');
    const detail = await own.json() as { id: string; name: string; source: string; departments: Array<{ id: string }> };
    assert.equal(detail.id, oceanStation.id);
    assert.equal(detail.name, 'Deep Ocean Station');
    assert.equal(detail.source, 'memory');
    assert.deepEqual(detail.departments.map(d => d.id), ['operations', 'research']);

    assert.equal((await b.get(`/scenarios/${oceanStation.id}`)).status, 404);
    assert.equal((await api.visitor().get(`/scenarios/${oceanStation.id}`)).status, 404);
    // A catalog scenario still answers for everyone.
    assert.equal((await b.json<{ source: string }>(`/scenarios/${atlasLab.id}`)).source, 'disk');
  });
});

test('a stored id that enters the shared catalog leaves the memory store and no longer counts', async () => {
  await withCatalog(async ({ api }) => {
    const a = api.cookied();
    const admin = api.visitor({}, { 'X-Admin-Token': TOKEN });
    for (let i = 0; i < PER_VISITOR; i += 1) {
      assert.equal((await store(a, station(`a-s${i}`))).status, 200, `store ${i}`);
    }
    assert.equal((await store(a, station('a-one-more'))).status, 507);

    // The admin saves a scenario to disk under an id A stored.
    const saved = await admin.post('/scenario/store', { scenario: station('a-s0', 'Curated'), saveToDisk: true });
    assert.equal(saved.status, 200);
    assert.equal((await entry(a, 'a-s0'))?.name, 'Curated');
    assert.equal((await entry(a, 'a-s0'))?.source, 'disk');
    assert.equal((await storedIds(a)).includes('a-s0'), false);
    assert.equal((await storedIds(a)).length, PER_VISITOR - 1);
    assert.equal((await store(a, station('a-new-1'))).status, 200, 'the freed place takes a new scenario');

    // A compiles one of their own stored ids.
    const compiled = await compile(a, station('a-s1', 'Compiled'));
    assert.equal(compiled.status, 200);
    assert.match(await compiled.text(), /event: complete/);
    assert.equal((await entry(a, 'a-s1'))?.source, 'compiled');
    assert.equal((await storedIds(a)).includes('a-s1'), false);
    assert.equal((await store(a, station('a-new-2'))).status, 200, 'the freed place takes a new scenario');

    // The count is exact: A holds 10 again.
    assert.equal((await storedIds(a)).length, PER_VISITOR);
    assert.equal((await store(a, station('a-new-3'))).status, 507);
  }, { env: ADMIN_ENV });
});

test('one address holds at most 20 stored scenarios, whatever visitor ids it sends', async () => {
  await withCatalog(async ({ api }) => {
    // Three visitor ids from one address.
    const [first, second, third] = [api.cookied(), api.cookied(), api.cookied()];
    for (const [v, who] of [[first, 'v0'], [second, 'v1']] as const) {
      for (let i = 0; i < PER_VISITOR; i += 1) {
        assert.equal((await store(v, station(`${who}-s${i}`))).status, 200, `${who} store ${i}`);
      }
    }
    const pastAddress = await store(third, station('v2-s0'));
    assert.equal(pastAddress.status, 507);
    assert.match(await errorOf(pastAddress), new RegExp(`at most ${PER_ADDRESS} scenarios in memory for one address`));
    assert.deepEqual(await storedIds(third), []);
    // Storing over an id of their own still works for a visitor at that address.
    assert.equal((await store(first, station('v0-s3', 'Renamed'))).status, 200);
    assert.equal((await entry(first, 'v0-s3'))?.name, 'Renamed');

    // A visitor at another address is not held out.
    const elsewhere = api.cookied({ 'x-forwarded-for': '203.0.113.7' });
    assert.equal((await store(elsewhere, station('elsewhere-s0'))).status, 200);
    assert.deepEqual(await storedIds(elsewhere), ['elsewhere-s0']);
  });
});

test('a stored scenario left unused for the idle time is dropped, and one in use is kept', async () => {
  const IDLE_MS = 2000;
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  await withCatalog(async ({ api }) => {
    const a = api.cookied();
    for (let i = 0; i < PER_VISITOR; i += 1) {
      assert.equal((await store(a, station(`idle-s${i}`))).status, 200, `store ${i}`);
    }
    assert.equal((await store(a, station('idle-one-more'))).status, 507);

    // A reads one of them by its id after 1.2 s; 1.5 s later the other nine
    // are past the idle time and the one A read is not.
    await sleep(1200);
    assert.equal((await a.json<{ id: string }>('/scenario?id=idle-s4')).id, 'idle-s4');
    await sleep(1500);
    assert.equal((await store(a, station('idle-one-more'))).status, 200, 'the dropped scenarios made room');
    assert.deepEqual((await storedIds(a)).sort(), ['idle-one-more', 'idle-s4']);
    assert.equal((await a.get('/scenario?id=idle-s0')).status, 404);
  }, { extra: { memoryScenarioIdleMs: IDLE_MS } });
});
