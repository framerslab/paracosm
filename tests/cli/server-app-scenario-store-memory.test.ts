/**
 * A scenario stored in memory is its visitor's own.
 *
 * POST /scenario/store without `saveToDisk` takes no credential. It put the
 * JSON into the one catalog every visitor reads, under the JSON's own id, so
 * a store whose id was a built-in's (mars-genesis) or a curated scenario's
 * (atlas-lab) replaced that scenario for everyone until a restart: GET
 * /scenarios listed the stored labels to every visitor, and every run whose
 * pick or body named that id ran the stored JSON. A store under a new id was
 * listed to every visitor as well, and the store kept any number of them.
 *
 * Now a store under an id the shared catalog holds is refused, a stored
 * scenario is listed to and run by the visitor who stored it (the
 * `paracosm_visitor` cookie) and no one else, and the store holds at most
 * 256 KiB a scenario, 10 scenarios a visitor and 100 in all
 * (MEMORY_SCENARIO_MAX_BYTES, MEMORY_SCENARIOS_PER_VISITOR and
 * MEMORY_SCENARIOS_CAP in src/server/server-app.ts).
 *
 * Every test goes through createMarsServer over HTTP with the scenario JSON
 * under scenarios/, one cookie jar per visitor, and a stub simulation runner
 * that records what the server hands it, so no model or network is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasLab, mars, settingsBody, waitFor, withVisitors } from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

/** The limits the server holds the memory store to (see the header). */
const MAX_BYTES = 256 * 1024;
const PER_VISITOR = 10;
const IN_ALL = 100;

/** A runnable scenario (the one tests/cli/server-app-scenario-per-visitor.test.ts stores). */
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

interface CatalogEntry { id: string; name: string; source: string }

async function catalog(v: Visitor): Promise<CatalogEntry[]> {
  return (await v.json<{ scenarios: CatalogEntry[] }>('/scenarios')).scenarios;
}

function store(v: Visitor, scenario: unknown): Promise<Response> {
  return v.post('/scenario/store', { scenario, saveToDisk: false });
}

test('a store under the id of a built-in or a curated scenario is refused and changes nothing anyone sees or runs', async () => {
  await withVisitors(async ({ visitor, cookied, launches }) => {
    const a = cookied();
    const b = cookied();
    const cookieless = visitor();
    for (const [who, author] of [['a visitor', a], ['a caller with no cookie', cookieless]] as const) {
      for (const id of [mars.id, atlasLab.id, 'deep-ocean-station']) {
        const res = await store(author, station(id, 'Replaced'));
        assert.equal(res.status, 409, `${who} storing ${id}: ${res.status}`);
        assert.match(((await res.json()) as { error: string }).error, new RegExp(`"${id}" is the id of a scenario every visitor`));
      }
    }

    for (const [who, reader] of [['A', a], ['B', b], ['a caller with no cookie', cookieless]] as const) {
      const entries = await catalog(reader);
      assert.equal(entries.find(e => e.id === mars.id)?.name, 'Mars Genesis', `${who}'s catalog`);
      assert.equal(entries.find(e => e.id === mars.id)?.source, 'builtin', `${who}'s catalog`);
      assert.equal(entries.find(e => e.id === atlasLab.id)?.name, 'Atlas Lab', `${who}'s catalog`);
      assert.equal(entries.filter(e => e.name === 'Replaced').length, 0, `${who}'s catalog`);
      assert.equal((await reader.json<{ labels: { name: string } }>('/scenario')).labels.name, 'Mars Genesis', `${who}'s default`);
      assert.equal((await reader.json<{ labels: { name: string } }>(`/scenario?id=${atlasLab.id}`)).labels.name, 'Atlas Lab', `${who}'s lookup`);
    }

    // B runs the built-in by its id and gets the built-in.
    const run = await b.post('/setup', settingsBody(mars));
    assert.equal(run.status, 200);
    const launch = await waitFor(() => launches[0], "B's run");
    assert.equal(launch.scenario?.labels.name, 'Mars Genesis');
  });
});

test("a stored scenario is listed to and run by the visitor who stored it and no one else", async () => {
  await withVisitors(async ({ visitor, cookied, launches }) => {
    const a = cookied();
    const b = cookied();

    const stored = await store(a, oceanStation);
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), { stored: true, id: oceanStation.id, savedToDisk: false, adminWrite: false, switchable: true });

    // A's own flow: listed, picked, read and run.
    assert.equal((await catalog(a)).find(e => e.id === oceanStation.id)?.source, 'memory');
    assert.deepEqual((await a.json<{ memoryScenarios: string[] }>('/admin-config')).memoryScenarios, [oceanStation.id]);
    assert.equal((await a.post('/scenario/switch', { id: oceanStation.id })).status, 200);
    assert.equal((await a.json<{ id: string }>('/scenario')).id, oceanStation.id);
    assert.equal((await a.json<{ active: string }>('/scenarios')).active, oceanStation.id);
    const aRun = await a.post('/setup', { ...settingsBody(mars), scenarioId: oceanStation.id });
    assert.equal(aRun.status, 200);
    assert.equal((await waitFor(() => launches[0], "A's run")).scenario?.id, oceanStation.id);

    // B neither sees nor runs it, by name or with A's pick cookie.
    assert.equal((await catalog(b)).some(e => e.id === oceanStation.id), false, "B's catalog");
    assert.deepEqual((await b.json<{ memoryScenarios: string[] }>('/admin-config')).memoryScenarios, []);
    assert.equal((await b.get(`/scenario?id=${oceanStation.id}`)).status, 404);
    const bSwitch = await b.post('/scenario/switch', { id: oceanStation.id });
    assert.equal(bSwitch.status, 400);
    assert.match(((await bSwitch.json()) as { error: string }).error, /Unknown scenario/);
    const bRun = await b.post('/setup', { ...settingsBody(mars), scenarioId: oceanStation.id });
    assert.equal(bRun.status, 400);
    const withAPick = visitor({ paracosm_visitor: b.cookies.get('paracosm_visitor')!, paracosm_scenario: oceanStation.id });
    assert.equal((await withAPick.json<{ id: string }>('/scenario')).id, mars.id);
    assert.equal((await withAPick.json<{ active: string }>('/scenarios')).active, mars.id);

    // A caller with no cookie is a visitor of its own, apart from A.
    assert.equal((await catalog(visitor())).some(e => e.id === oceanStation.id), false, "a cookieless caller's catalog");

    // B can store the same id; each sees their own.
    assert.equal((await store(b, station(oceanStation.id, "B's Station"))).status, 200);
    assert.equal((await catalog(b)).find(e => e.id === oceanStation.id)?.name, "B's Station");
    assert.equal((await catalog(a)).find(e => e.id === oceanStation.id)?.name, 'Deep Ocean Station');
    assert.equal(launches.length, 1, 'only A ran');
  });
});

test('the memory store refuses a scenario over its size and a store past its count, per visitor and in all', async () => {
  await withVisitors(async ({ cookied }) => {
    const big = { ...station('big-station'), padding: 'x'.repeat(MAX_BYTES) };
    const tooBig = await store(cookied(), big);
    assert.equal(tooBig.status, 413);
    assert.match(((await tooBig.json()) as { error: string }).error, /256 KiB/);

    // Each visitor at an address of their own: one address holds fewer than the store does in all.
    const visitors = Array.from({ length: IN_ALL / PER_VISITOR }, (_, v) => cookied({ 'x-forwarded-for': `198.51.100.${v + 1}` }));
    const first = visitors[0];
    for (let i = 0; i < PER_VISITOR; i += 1) {
      assert.equal((await store(first, station(`v0-s${i}`))).status, 200, `store ${i}`);
    }
    const pastOwn = await store(first, station('v0-one-more'));
    assert.equal(pastOwn.status, 507);
    assert.match(((await pastOwn.json()) as { error: string }).error, new RegExp(`at most ${PER_VISITOR} scenarios`));
    // Storing over one of their own ids still works.
    assert.equal((await store(first, station('v0-s3', 'Renamed'))).status, 200);
    assert.equal((await catalog(first)).find(e => e.id === 'v0-s3')?.name, 'Renamed');

    for (let v = 1; v < visitors.length; v += 1) {
      for (let i = 0; i < PER_VISITOR; i += 1) {
        assert.equal((await store(visitors[v], station(`v${v}-s${i}`))).status, 200, `visitor ${v} store ${i}`);
      }
    }
    const pastAll = await store(cookied({ 'x-forwarded-for': '198.51.100.200' }), station('one-past-all'));
    assert.equal(pastAll.status, 507);
    assert.match(((await pastAll.json()) as { error: string }).error, new RegExp(`at most ${IN_ALL} scenarios`));
  });
});
