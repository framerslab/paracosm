/**
 * What one visitor of the server can reach of another's.
 *
 * - On the hosted demo a caller that sends no cookie gets a visitor id of
 *   its own for the run it opens, so two such callers neither read nor stop
 *   each other's runs.
 * - A finished run is saved for its own visitor: on the hosted demo the
 *   saved-session list shows a visitor their own runs and the sessions an
 *   admin saved, and the ring never drops an admin-saved session.
 * - A run that ended on a provider error is not saved as a finished run.
 * - The brief a compiled scenario came from is shown on the hosted demo
 *   only to the visitor who compiled it.
 * - A local server answers no request a page on another site sends.
 * - The platform API mode takes the admin credential on /api/v1, whatever
 *   form the request target that names the route takes.
 *
 * Every test goes through createMarsServer over HTTP with a stub runner, so
 * no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { openSessionStore, type SessionStore } from '../../src/server/stores/session.js';
import {
  VISITOR_COOKIE, heldRun, mars, quickstartBody, readReplay, settingsBody, startServer, waitFor, withVisitors,
  type Frame, type HeldLaunch, type RunServer, type Runner,
} from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOSTED = { PARACOSM_HOSTED_DEMO: 'true' };
const TOKEN = 'visitor-privacy-test-token';

interface SetupAnswer { runKey?: string; visitorId?: string; error?: string }
interface SessionRow { id: string; seedText?: string }

const memoryStore = (max = 10): SessionStore => openSessionStore(':memory:', max, { databaseOptions: { type: 'memory' } });

async function setup(v: Visitor, body: unknown): Promise<{ status: number; answer: SetupAnswer }> {
  const res = await v.post('/setup', body);
  return { status: res.status, answer: await res.json() as SetupAnswer };
}

/** A pair run of one turn, so two turn_done frames finish it. */
const oneTurn = () => ({ ...settingsBody(mars), turns: 1 });

const savedFrame = (frames: Frame[]) => frames.find(f => f.event === 'sim_saved');

/** Releases a held run and waits for the save decision its `complete` triggers. */
async function finish(v: Visitor, run: HeldLaunch): Promise<Record<string, unknown>> {
  run.release();
  await waitFor(() => run.settled, 'the run to finish');
  const saved = await waitFor(async () => savedFrame(await readReplay(v)), 'the save decision');
  return saved.data;
}

async function listSessions(v: Visitor): Promise<SessionRow[]> {
  const res = await v.get('/sessions');
  assert.equal(res.status, 200);
  return (await res.json() as { sessions: SessionRow[] }).sessions;
}

test('on the hosted demo two callers that send no cookie each get a visitor of their own', async () => {
  const held = heldRun();
  await withVisitors(async ({ visitor }) => {
    const a = visitor();
    const aRun = await setup(a, settingsBody(mars));
    assert.equal(aRun.status, 200, JSON.stringify(aRun.answer));
    assert.match(String(aRun.answer.visitorId), UUID, 'the run belongs to a visitor id of its own');
    assert.equal(a.cookies.get(VISITOR_COOKIE), aRun.answer.visitorId, 'the answer gives the caller that id as its cookie');
    await waitFor(() => held.runs[0], "A's run");

    const b = visitor();
    const results = await b.json<{ runKey?: string | null }>('/results');
    assert.equal(results.runKey ?? null, null, "B reads nothing of A's run");
    const cleared = await (await b.get('/clear', { method: 'POST' })).json() as { cleared: boolean };
    assert.equal(cleared.cleared, false, "B's Clear stops nothing");
    assert.equal(held.runs[0].signal?.aborted, false);

    const bRun = await setup(b, settingsBody(mars));
    assert.equal(bRun.status, 200, JSON.stringify(bRun.answer));
    await waitFor(() => held.runs[1], "B's run");
    assert.notEqual(bRun.answer.visitorId, aRun.answer.visitorId);
    assert.equal(held.runs[0].signal?.aborted, false, "B's run does not replace A's");
    held.runs[0].release();
    held.runs[1].release();
  }, { runner: held.runner, env: HOSTED });
});

test("on the hosted demo a visitor's saved run is listed to them and to no other visitor", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    assert.equal((await setup(a, oneTurn())).status, 200);
    const run = await waitFor(() => held.runs[0], "A's run");
    const saved = await finish(a, run);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));

    const b = cookied();
    assert.deepEqual(await listSessions(b), [], "B's list holds none of A's runs");
    assert.equal((await listSessions(a)).length, 1, 'A sees their own saved run');
  }, { runner: held.runner, env: HOSTED, extra: { sessionStore: memoryStore() } });
});

test('a session the admin saved stays when visitors fill the ring', async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const admin = cookied({ 'X-Admin-Token': TOKEN });
    assert.equal((await setup(admin, oneTurn())).status, 200);
    await finish(admin, await waitFor(() => held.runs[0], "the admin's run"));
    const pinned = await admin.get('/admin/sessions/save', { method: 'POST' });
    assert.equal(pinned.status, 200);
    const { id } = await pinned.json() as { id: string };

    for (let i = 1; i <= 2; i++) {
      const v = cookied();
      assert.equal((await setup(v, oneTurn())).status, 200);
      const saved = await finish(v, await waitFor(() => held.runs[i], `visitor run ${i}`));
      assert.equal(saved.status, 'saved', JSON.stringify(saved));
    }
    assert.equal((await admin.get(`/sessions/${id}`)).status, 200, 'the admin-saved session is still stored');
    assert.ok((await listSessions(cookied())).some(s => s.id === id), 'and listed to every visitor');
  }, {
    runner: held.runner,
    env: { ...HOSTED, ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN },
    extra: { sessionStore: memoryStore(2) },
  });
});

test('a run that ended on a provider error is not saved as a finished run', async () => {
  const store = memoryStore();
  const runner: Runner = async (config, broadcast) => {
    broadcast('status', { phase: 'parallel', maxTurns: 1, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
    broadcast('sim', { type: 'provider_error', leader: config.actors[0].name, data: { kind: 'auth', message: '401 invalid_api_key' } }, config.actors[0].name);
    for (const actor of config.actors) {
      broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn: 1, time: 1, aborted: true } }, actor.name);
    }
    broadcast('complete', { aborted: true });
  };
  await withVisitors(async ({ cookied, launches }) => {
    const a = cookied();
    assert.equal((await setup(a, { ...oneTurn(), apiKey: 'sk-test-not-a-real-key' })).status, 200);
    await waitFor(() => launches[0], 'the run');
    const saved = await waitFor(async () => savedFrame(await readReplay(a)), 'the save decision');
    assert.equal(saved.data.status, 'skipped', JSON.stringify(saved.data));
    assert.equal(await store.count(), 0);
  }, { runner, extra: { sessionStore: store } });
});

const BRIEF = `Patient cohort notes, do not share. ${'Cohort detail line. '.repeat(12)}`;
const BRIEF_ID = 'brief-probe';

async function withCompiledBrief(body: (api: RunServer) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-brief-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  const raw = JSON.parse(readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8')) as Record<string, unknown>;
  const { hooks: _hooks, ...rest } = raw;
  writeFileSync(join(scenarioDir, 'compiled', `${BRIEF_ID}.json`), JSON.stringify({
    ...rest,
    id: BRIEF_ID,
    labels: { ...(raw.labels as Record<string, unknown>), name: 'Brief Probe' },
    _persistMeta: { compiledAt: '2026-11-01T00:00:00.000Z', seedText: BRIEF },
  }));
  const held = heldRun();
  const api = await startServer({
    env: HOSTED,
    scenarioDir,
    runner: held.runner,
    compileScenario: async (json) => ({ ...(json as object), hooks: {} }) as unknown as ScenarioPackage,
  });
  try {
    await waitFor(async () => {
      const list = await (await fetch(`${api.base}/scenarios`)).json() as { scenarios: Array<{ id: string }> };
      return list.scenarios.some(s => s.id === BRIEF_ID);
    }, 'the compiled scenario to enter the catalog', 5000);
    await body(api);
  } finally {
    for (const run of held.runs) run.release();
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('on the hosted demo a compiled scenario shows its brief to no visitor who did not compile it', async () => {
  await withCompiledBrief(async ({ cookied, visitor }) => {
    for (const b of [cookied(), visitor()]) {
      const list = await b.json<{ scenarios: Array<{ id: string; seedText?: string }> }>('/scenarios');
      const entry = list.scenarios.find(s => s.id === BRIEF_ID);
      assert.ok(entry);
      assert.equal(entry.seedText ?? null, null, 'the catalog lists no brief');
      const detail = await b.json<{ seedText?: string }>(`/scenarios/${BRIEF_ID}`);
      assert.equal(detail.seedText ?? null, null, 'the detail holds no brief');
    }
    const b = cookied();
    const run = await setup(b, { ...quickstartBody({ ...mars, id: BRIEF_ID }), actors: mars.presets[0].leaders });
    assert.equal(run.status, 200, JSON.stringify(run.answer));
    const opening = (await readReplay(b)).find(f => f.event === 'active_scenario');
    assert.equal(opening?.data.seedText ?? null, null, "the run's opening frame carries no brief");
  });
});

test('a local server refuses a request a page on another site sends', async () => {
  await withVisitors(async ({ base, launches }) => {
    const setupRes = await fetch(`${base}/setup`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(settingsBody(mars)),
    });
    assert.equal(setupRes.status, 403);
    assert.equal(launches.length, 0, 'no run opened');

    const read = await fetch(`${base}/api/v1/runs`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(read.status, 403);
    assert.equal(read.headers.get('access-control-allow-origin'), null);

    // The dashboard's own requests, and the dev server's on another local port, pass.
    const own = await fetch(`${base}/clear`, { method: 'POST', headers: { Origin: base } });
    assert.equal(own.status, 200);
    const dev = await fetch(`${base}/clear`, { method: 'POST', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(dev.status, 200);
  });
});

test('the platform API mode answers /api/v1 only with the admin credential', async () => {
  await withVisitors(async ({ base }) => {
    const open = await fetch(`${base}/api/v1/runs`);
    assert.equal(open.status, 401);
    const imported = await fetch(`${base}/api/v1/library/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(imported.status, 401);
    const withToken = await fetch(`${base}/api/v1/runs`, { headers: { 'X-Admin-Token': TOKEN } });
    assert.equal(withToken.status, 200);
    const status = await (await fetch(`${base}/api/v1/demo/status`)).json() as { authenticatedApiAvailable: boolean };
    assert.equal(status.authenticatedApiAvailable, true);
  }, { env: { PARACOSM_PLATFORM_API: 'true', ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN } });
});

/**
 * The status a GET of `target` answers, the request line carrying `target`
 * as it is written (fetch would resolve dot segments and send origin form).
 */
function rawGet(base: string, target: string): Promise<number> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path: target, method: 'GET', timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error(`GET ${target} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

test('the platform API mode asks for the admin credential on every request target that names an /api/v1 route', async () => {
  await withVisitors(async ({ base }) => {
    for (const target of ['/./api/v1/runs', '/x/../api/v1/runs', `http://${new URL(base).host}/api/v1/runs`, '/api/v1/../api/v1/runs']) {
      assert.equal(await rawGet(base, target), 401, `GET ${target} without the credential`);
    }
  }, { env: { PARACOSM_PLATFORM_API: 'true', ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN } });
});

test('the platform API mode with no admin credential configured reports no authenticated API', async () => {
  await withVisitors(async ({ base }) => {
    const status = await (await fetch(`${base}/api/v1/demo/status`)).json() as { authenticatedApiAvailable: boolean };
    assert.equal(status.authenticatedApiAvailable, false);
    assert.notEqual((await fetch(`${base}/api/v1/runs`)).status, 200);
  }, { env: { PARACOSM_PLATFORM_API: 'true' } });
});
