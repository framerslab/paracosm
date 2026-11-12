/**
 * POST /scenario/store writes a scenario to disk only for the admin.
 *
 * The route stores a scenario in memory for any visitor. With
 * `saveToDisk` it also writes `<scenarioDir>/<id>.json`, and that write
 * needs the admin credential the /admin/* routes take: ADMIN_WRITE=true
 * and an X-Admin-Token header matching ADMIN_TOKEN. The id names the
 * file, so a disk write takes a plain scenario id only (letters, digits,
 * hyphens and underscores, at most 128) and the file it names must sit
 * directly in the scenarios folder. A refused request stores nothing.
 *
 * At boot the server re-compiles the drafts under
 * `<scenarioDir>/compiled/`. It skips a draft whose id is not a plain
 * scenario id and compiles at most COMPILED_SCENARIOS_CAP of them, the
 * newest first, saying so in one log line.
 *
 * Every test runs createMarsServer over HTTP with a scenarios folder of
 * its own inside a temporary folder, so a file written anywhere in that
 * folder, inside the scenarios folder or beside it, shows. The compiler
 * is a stub: no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { COMPILED_SCENARIOS_CAP } from '../../src/cli/persisted-compiled-scenarios.js';
import { startServer, waitFor, type RunServer } from './helpers/run-server.js';

const TOKEN = 'store-write-test-token';

/** A runnable scenario (the one tests/cli/server-app.test.ts stores). */
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

/** Every file under `root`, as paths relative to it, sorted. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

interface Sandbox {
  /** The temporary folder; the scenarios folder is `<root>/scenarios`. */
  root: string;
  scenarioDir: string;
  api: RunServer;
}

/** A server whose scenarios folder sits inside a temporary folder of its own. */
async function withSandbox(env: Record<string, string>, body: (box: Sandbox) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-store-write-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(scenarioDir);
  // The server's APP_DIR is a folder of its own, outside `root`, so the
  // state the server keeps there never shows as a file written.
  const api = await startServer({ env, scenarioDir });
  try {
    await body({ root, scenarioDir, api });
  } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

/** POST /scenario/store with `headers` on top of the JSON content type. */
function store(base: string, payload: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/scenario/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

/** The ids GET /scenarios lists. */
async function catalogIds(base: string): Promise<string[]> {
  const res = await fetch(`${base}/scenarios`);
  const body = await res.json() as { scenarios: Array<{ id: string }> };
  return body.scenarios.map(scenario => scenario.id);
}

const ADMIN_ENV = { ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN };

test('a disk write with no admin credential is refused and stores nothing', async () => {
  await withSandbox(ADMIN_ENV, async ({ root, api }) => {
    const before = filesUnder(root);
    const res = await store(api.base, { scenario: oceanStation, saveToDisk: true });
    assert.equal(res.status, 401);
    assert.match(((await res.json()) as { error: string }).error, /X-Admin-Token/);
    assert.deepEqual(filesUnder(root), before, 'no file was written');
    assert.equal((await catalogIds(api.base)).includes(oceanStation.id), false, 'nothing was stored in memory either');
  });
});

test('a disk write with a wrong admin credential is refused and stores nothing', async () => {
  await withSandbox(ADMIN_ENV, async ({ root, api }) => {
    const before = filesUnder(root);
    for (const token of ['wrong-token', `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      const res = await store(api.base, { scenario: oceanStation, saveToDisk: true }, { 'X-Admin-Token': token });
      assert.equal(res.status, 401, `token ${JSON.stringify(token)}`);
    }
    assert.deepEqual(filesUnder(root), before, 'no file was written');
    assert.equal((await catalogIds(api.base)).includes(oceanStation.id), false);
  });
});

test('a disk write on a server with ADMIN_WRITE=true and no ADMIN_TOKEN is refused (fail closed)', async () => {
  await withSandbox({ ADMIN_WRITE: 'true', ADMIN_TOKEN: '' }, async ({ root, api }) => {
    const before = filesUnder(root);
    const res = await store(api.base, { scenario: oceanStation, saveToDisk: true }, { 'X-Admin-Token': '' });
    assert.equal(res.status, 503);
    assert.match(((await res.json()) as { error: string }).error, /ADMIN_TOKEN must be set/);
    assert.deepEqual(filesUnder(root), before, 'no file was written');
  });
});

test('a disk write on a server with ADMIN_WRITE off is refused, the token notwithstanding', async () => {
  await withSandbox({ ADMIN_WRITE: 'false', ADMIN_TOKEN: TOKEN }, async ({ root, api }) => {
    const before = filesUnder(root);
    const res = await store(api.base, { scenario: oceanStation, saveToDisk: true }, { 'X-Admin-Token': TOKEN });
    assert.equal(res.status, 403);
    assert.deepEqual(filesUnder(root), before, 'no file was written');
  });
});

test('an in-memory store needs no credential and writes no file', async () => {
  await withSandbox(ADMIN_ENV, async ({ root, api }) => {
    const before = filesUnder(root);
    const res = await store(api.base, { scenario: oceanStation, saveToDisk: false });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { stored: true, id: oceanStation.id, savedToDisk: false, adminWrite: true, switchable: true });
    assert.deepEqual(filesUnder(root), before, 'no file was written');
    assert.ok((await catalogIds(api.base)).includes(oceanStation.id));
  });
});

test('an authorised disk write of a plain id writes exactly one file, in the scenarios folder', async () => {
  await withSandbox(ADMIN_ENV, async ({ root, api }) => {
    const before = filesUnder(root);
    const res = await store(api.base, { scenario: oceanStation, saveToDisk: true }, { 'X-Admin-Token': TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { stored: true, id: oceanStation.id, savedToDisk: true, adminWrite: true, switchable: true });
    assert.deepEqual(filesUnder(root), [...before, join('scenarios', `${oceanStation.id}.json`)].sort());
    assert.ok((await catalogIds(api.base)).includes(oceanStation.id));
  });
});

test('an authorised disk write is refused before any write when the id is not a plain scenario id', async (t) => {
  await withSandbox(ADMIN_ENV, async ({ root, api }) => {
    const cases: Array<{ name: string; id: unknown; error: RegExp }> = [
      { name: 'a path separator', id: 'nested/child', error: /scenario id/i },
      { name: 'a backslash', id: '..\\escape', error: /scenario id/i },
      { name: 'a dot segment that climbs out of the folder', id: '../escape', error: /scenario id/i },
      { name: 'a bare dot segment', id: '..', error: /scenario id/i },
      { name: 'a path into the compiled drafts folder', id: 'compiled/planted', error: /scenario id/i },
      { name: 'an absolute path', id: join(root, 'absolute-escape'), error: /scenario id/i },
      { name: 'a null byte', id: 'ocean\u0000station', error: /scenario id/i },
      { name: 'percent-encoded separators', id: '..%2Fescape', error: /scenario id/i },
      { name: 'an over-long id (129 characters)', id: 'a'.repeat(129), error: /scenario id/i },
      { name: 'an id that is not a string', id: ['..', 'escape'], error: /scenario id/i },
      // Refused by the route's first check, the one every store passes.
      { name: 'an empty id', id: '', error: /id required/i },
    ];
    for (const c of cases) {
      await t.test(c.name, async () => {
        const before = filesUnder(root);
        const res = await store(api.base, { scenario: { ...oceanStation, id: c.id }, saveToDisk: true }, { 'X-Admin-Token': TOKEN });
        const body = await res.json() as { error?: string };
        assert.equal(res.status, 400, `status for ${JSON.stringify(c.id)}: ${JSON.stringify(body)}`);
        assert.match(String(body.error), c.error);
        assert.deepEqual(filesUnder(root), before, 'no file was written');
      });
    }
  });
});

/** A draft as persistCompiledScenario writes it: the scenario minus its hooks, plus its meta. */
function draftJson(id: unknown): string {
  const { hooks: _hooks, ...rest } = oceanStation;
  return JSON.stringify({ ...rest, id, _persistMeta: { compiledAt: '2026-11-01T00:00:00.000Z', seedText: null } });
}

test('boot skips a persisted draft whose id is not a plain scenario id and compiles at most the cap, newest first, in one log line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-store-write-boot-'));
  const scenarioDir = join(root, 'scenarios');
  const compiledDir = join(scenarioDir, 'compiled');
  mkdirSync(compiledDir, { recursive: true });
  // Two more valid drafts than the cap, each a second older than the
  // one after it, so the two oldest (draft-000, draft-001) are the ones
  // past the cap.
  const total = COMPILED_SCENARIOS_CAP + 2;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < total; i += 1) {
    const id = `draft-${String(i).padStart(3, '0')}`;
    const file = join(compiledDir, `${id}.json`);
    writeFileSync(file, draftJson(id));
    utimesSync(file, now - (total - i) * 10, now - (total - i) * 10);
  }
  // The newest file of all, whose id climbs out of the folder.
  const planted = join(compiledDir, 'planted.json');
  writeFileSync(planted, draftJson('../outside'));
  utimesSync(planted, now, now);

  const compiled: string[] = [];
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.log = capture;
  console.warn = capture;
  let api: RunServer | undefined;
  try {
    api = await startServer({
      scenarioDir,
      compileScenario: async (draft) => {
        compiled.push(String(draft.id));
        return { ...(draft as object), hooks: {} } as unknown as ScenarioPackage;
      },
    });
    await waitFor(() => compiled.length >= COMPILED_SCENARIOS_CAP, 'the boot compiles', 5000);
    // The stub compiles at once, so a draft past the cap would be compiled
    // within this wait.
    await new Promise(resolve => setTimeout(resolve, 300));
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    await api?.close();
    if (api) rmSync(api.appDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }

  assert.equal(compiled.length, COMPILED_SCENARIOS_CAP, `compiled ${compiled.length} drafts`);
  assert.equal(compiled.includes('../outside'), false, 'the draft whose id climbs out of the folder is skipped');
  assert.equal(compiled.includes('draft-000'), false, 'the oldest draft is past the cap');
  assert.equal(compiled.includes('draft-001'), false, 'the second oldest draft is past the cap');
  assert.ok(compiled.includes(`draft-${String(total - 1).padStart(3, '0')}`), 'the newest valid draft is compiled');
  assert.ok(lines.some(line => /planted\.json/.test(line) && /not a plain scenario id/.test(line)), 'one line names the skipped file');
  const capLines = lines.filter(line => /persisted compiled draft/.test(line) && /\bcap\b/.test(line));
  assert.equal(capLines.length, 1, `one line states the cap: ${JSON.stringify(capLines)}`);
  assert.ok(lines.every(line => !line.includes('../outside')), 'no line carries the id read from the skipped file');
});
