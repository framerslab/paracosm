/**
 * Whose runs the run-history routes answer with.
 *
 * On the hosted demo, with the run-history routes turned on
 * (`PARACOSM_ENABLE_RUN_HISTORY_ROUTES=true`), each visitor reaches their
 * own runs:
 *
 * - the list, the aggregate and a bundle hold the visitor's runs alone;
 * - a read, a HEAD, a swarm read, a replay or a replay result for a run
 *   another visitor holds is answered as an id no run has;
 * - a run a visitor imports is theirs, also when its artifact carries a
 *   run id another visitor holds;
 * - the admin credential reaches every run;
 * - a run recorded with no owner is reached with the admin credential
 *   alone.
 *
 * A local server answers every caller with every run, as before.
 *
 * Every test goes through createMarsServer over HTTP. The runs are copies
 * of one real Mars Genesis run with a stub model
 * (tests/runtime/helpers/stub-model-mars-run.ts; no network, no paid call):
 * a visitor's run is recorded by the server's own `/setup` path, whose
 * runner here hands the server the finished artifact as the real runner
 * does, and an import goes through `POST /api/v1/library/import`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BroadcastFn } from '../../src/cli/pair-runner.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import type { RunRecord } from '../../src/server/services/run-record.js';
import type { RunHistoryStore } from '../../src/server/stores/run-history.js';
import { openSessionStore } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { runMarsWithStubModel } from '../runtime/helpers/stub-model-mars-run.js';
import { VISITOR_COOKIE, mars, settingsBody, waitFor, withVisitors, type RunServer } from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

// One runs directory for the file: the stub run writes its output there,
// the runner below writes each recorded run's artifact there, and every
// server started here reads it from its environment.
const RUNS_DIR = mkdtempSync(join(tmpdir(), 'paracosm-run-history-per-visitor-'));
process.env.PARACOSM_OUTPUT_DIR = RUNS_DIR;

const TOKEN = 'run-history-per-visitor-test-token';
const ROUTES_ON = { PARACOSM_ENABLE_RUN_HISTORY_ROUTES: 'true' };
const HOSTED = { ...ROUTES_ON, PARACOSM_HOSTED_DEMO: 'true', ADMIN_WRITE: 'true', ADMIN_TOKEN: TOKEN };
const LOCAL = { ...ROUTES_ON };

/** A finished run is titled by a model call; this stands in for it. */
const NO_MODEL = { generateText: async () => ({ text: 'A saved run' }) };

/** One stubbed run for the file, read back through JSON as a saved file is. */
let pending: Promise<RunArtifact> | undefined;
const savedRun = () => (pending ??= runMarsWithStubModel().then(({ artifact }) => JSON.parse(JSON.stringify(artifact)) as RunArtifact));

const newRunId = () => `run_${randomUUID()}`;

/** A copy of the saved run under `runId`, as an exported run file holds it. */
async function runFile(runId: string): Promise<RunArtifact> {
  const saved = await savedRun();
  return { ...saved, metadata: { ...saved.metadata, runId } } as RunArtifact;
}

type OnArtifact = (artifact: RunArtifact, leader: unknown) => void | Promise<void>;

interface Launch { runIds: string[]; done: boolean }

/**
 * A runner that finishes at once: for each actor it writes a copy of the
 * saved run into the runs directory under a run id of its own and hands
 * it to the server's `onArtifact`, which records the run.
 */
function recordingRunner(): { run: (config: NormalizedSimulationConfig, broadcast: BroadcastFn, signal?: AbortSignal, scenario?: ScenarioPackage, onArtifact?: OnArtifact) => Promise<void>; launches: Launch[] } {
  const launches: Launch[] = [];
  return {
    launches,
    run: async (config, broadcast, _signal, _scenario, onArtifact) => {
      const launch: Launch = { runIds: [], done: false };
      launches.push(launch);
      broadcast('status', { phase: 'parallel', maxTurns: 1, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
      for (const actor of config.actors) {
        broadcast('sim', { type: 'turn_start', leader: actor.name, data: { turn: 1, time: 1, title: `${actor.name} turn 1` } }, actor.name);
        const runId = newRunId();
        const outputPath = join(RUNS_DIR, `v3-per-visitor-${runId}.json`);
        const copy = await runFile(runId);
        const artifact = { ...copy, scenarioExtensions: { ...(copy.scenarioExtensions ?? {}), outputPath } } as RunArtifact;
        writeFileSync(outputPath, JSON.stringify(artifact));
        await onArtifact?.(artifact, actor);
        launch.runIds.push(runId);
        broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn: 1, time: 1 } }, actor.name);
      }
      for (const actor of config.actors) {
        broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
      }
      broadcast('complete', {});
      launch.done = true;
    },
  };
}

interface World {
  api: RunServer;
  store: RunHistoryStore;
  /** Starts a run as `v` through /setup and returns the ids of the runs the server recorded for it. */
  startRun: (v: Visitor) => Promise<string[]>;
  /** A caller holding the admin credential and no visitor cookie. */
  admin: Visitor;
}

async function withServer(env: Record<string, string>, body: (world: World) => Promise<void>): Promise<void> {
  await savedRun();
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  const runner = recordingRunner();
  await withVisitors(async (api) => {
    const startRun = async (v: Visitor): Promise<string[]> => {
      const index = runner.launches.length;
      const res = await v.post('/setup', settingsBody(mars));
      assert.equal(res.status, 200, `POST /setup: ${await res.text()}`);
      const launch = await waitFor(() => (runner.launches[index]?.done ? runner.launches[index] : null), 'the run to be recorded', 10_000);
      assert.equal(launch.runIds.length, mars.presets[0].leaders.length, 'one run for each leader');
      return [...launch.runIds];
    };
    await body({ api, store, startRun, admin: api.visitor({}, { 'X-Admin-Token': TOKEN }) });
  }, {
    env,
    extra: {
      ...NO_MODEL,
      runHistoryStore: store,
      runPairSimulations: runner.run,
      sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
    },
  });
}

/** A record as a server stored one before runs had owners: no owner goes in with it. */
async function recordWithNoOwner(store: RunHistoryStore): Promise<string> {
  const runId = newRunId();
  const artifactPath = join(RUNS_DIR, `v3-no-owner-${runId}.json`);
  writeFileSync(artifactPath, JSON.stringify(await runFile(runId)));
  const record: RunRecord = {
    runId,
    createdAt: new Date().toISOString(),
    scenarioId: 'mars-genesis',
    scenarioVersion: '1.0.0',
    actorConfigHash: 'leaders:before-owners',
    economicsProfile: 'balanced',
    sourceMode: 'hosted_demo',
    createdBy: 'anonymous',
    artifactPath,
    costUSD: 1,
  };
  await store.insertRun(record);
  return runId;
}

interface Answer { status: number; body: string }

async function ask(v: Visitor, method: string, path: string, payload?: unknown): Promise<Answer> {
  const res = payload === undefined ? await v.get(path, { method }) : await v.post(path, payload);
  return { status: res.status, body: await res.text() };
}

interface RunList { runs: Array<{ runId: string; bundleId?: string }>; total: number; hasMore: boolean }
interface Aggregate { totalRuns: number; totalCostUSD: number; replaysAttempted: number; replaysMatched: number }
interface BundleAnswer { bundleId: string; memberCount: number; members: Array<{ runId: string }> }

async function listRuns(v: Visitor, query = ''): Promise<RunList> {
  const res = await v.get(`/api/v1/runs?limit=500${query}`);
  assert.equal(res.status, 200, `GET /api/v1/runs: ${res.status}`);
  return await res.json() as RunList;
}

const idsOf = (list: RunList): string[] => list.runs.map(run => run.runId).sort();
const sorted = (ids: string[]): string[] => [...ids].sort();

async function aggregate(v: Visitor): Promise<Aggregate> {
  const res = await v.get('/api/v1/runs/aggregate');
  assert.equal(res.status, 200);
  return await res.json() as Aggregate;
}

/** The routes that name one run, each as a method and a path for a run id. */
const RUN_ROUTES: Array<{ name: string; method: string; path: (id: string) => string; payload?: unknown }> = [
  { name: 'GET /api/v1/runs/:runId', method: 'GET', path: id => `/api/v1/runs/${id}` },
  { name: 'HEAD /api/v1/runs/:runId', method: 'HEAD', path: id => `/api/v1/runs/${id}` },
  { name: 'GET /api/v1/runs/:runId/swarm', method: 'GET', path: id => `/api/v1/runs/${id}/swarm` },
  { name: 'POST /api/v1/runs/:runId/replay', method: 'POST', path: id => `/api/v1/runs/${id}/replay` },
  { name: 'POST /api/v1/runs/:runId/replay-result', method: 'POST', path: id => `/api/v1/runs/${id}/replay-result`, payload: { matches: true } },
];

/**
 * `v`'s answer on every run route for `heldId` (a run they do not hold)
 * is their answer for an id no run has: the same status and, with the id
 * taken out, the same body.
 */
async function assertAnsweredAsUnknown(v: Visitor, heldId: string, who: string): Promise<void> {
  for (const route of RUN_ROUTES) {
    const unknownId = newRunId();
    const held = await ask(v, route.method, route.path(heldId), route.payload);
    const unknown = await ask(v, route.method, route.path(unknownId), route.payload);
    assert.equal(unknown.status, 404, `${route.name}: an id no run has answers 404`);
    assert.equal(held.status, unknown.status, `${route.name}: ${who} is answered as for an id no run has (${held.body.slice(0, 200)})`);
    assert.equal(held.body.split(heldId).join('<id>'), unknown.body.split(unknownId).join('<id>'), `${route.name}: ${who} gets the body an id no run has gets`);
  }
}

test('on the hosted demo the run list, the aggregate and a filtered list hold the visitor\'s own runs', async () => {
  await withServer(HOSTED, async ({ api, store, startRun, admin }) => {
    const a = api.cookied();
    const b = api.cookied();
    const aRuns = await startRun(a);
    const bRuns = await startRun(b);
    const noOwner = await recordWithNoOwner(store);

    const aList = await listRuns(a);
    assert.deepEqual(idsOf(aList), sorted(aRuns), 'A lists A\'s runs and no other');
    assert.equal(aList.total, aRuns.length, 'A\'s total counts A\'s runs');
    assert.equal(aList.hasMore, false);

    // The answer is its caller's own, so no shared cache keeps it.
    for (const path of ['/api/v1/runs', '/api/v1/runs/aggregate', `/api/v1/runs/${aRuns[0]}`, `/api/v1/bundles/${aList.runs[0].bundleId}`]) {
      const res = await a.get(path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('cache-control'), 'no-store', `${path}: not stored by a cache`);
      assert.equal(res.headers.get('vary'), 'Cookie', `${path}: varies by cookie`);
    }

    const bList = await listRuns(b);
    assert.deepEqual(idsOf(bList), sorted(bRuns), 'B\'s list holds none of A\'s runs and none without an owner');
    assert.equal(bList.total, bRuns.length);

    const aBundle = aList.runs[0].bundleId;
    assert.ok(aBundle, 'A\'s two runs share a bundle');
    assert.deepEqual(idsOf(await listRuns(b, `&bundleId=${aBundle}`)), [], 'B\'s list filtered by A\'s bundle is empty');
    assert.deepEqual(idsOf(await listRuns(b, '&scenario=mars-genesis')), sorted(bRuns), 'a scenario filter stays inside B\'s runs');
    assert.deepEqual(idsOf(await listRuns(b, '&q=mars')), sorted(bRuns), 'a search stays inside B\'s runs');

    const nobody = api.visitor();
    const nobodyList = await listRuns(nobody);
    assert.deepEqual(nobodyList.runs, [], 'a caller with no cookie and no credential lists no run');
    assert.equal(nobodyList.total, 0);

    assert.equal((await aggregate(a)).totalRuns, aRuns.length, 'A\'s aggregate counts A\'s runs');
    assert.equal((await aggregate(b)).totalRuns, bRuns.length, 'B\'s aggregate counts B\'s runs');
    assert.equal((await aggregate(nobody)).totalRuns, 0);

    const adminList = await listRuns(admin);
    assert.deepEqual(idsOf(adminList), sorted([...aRuns, ...bRuns, noOwner]), 'the admin credential lists every run');
    assert.equal(adminList.total, aRuns.length + bRuns.length + 1);
    assert.equal((await aggregate(admin)).totalRuns, aRuns.length + bRuns.length + 1, 'and its aggregate counts every run');
  });
});

test('on the hosted demo a run another visitor holds is answered as an id no run has', async () => {
  await withServer(HOSTED, async ({ api, startRun, admin }) => {
    const a = api.cookied();
    const b = api.cookied();
    const [aRun] = await startRun(a);
    await startRun(b);

    await assertAnsweredAsUnknown(b, aRun, 'another visitor');
    await assertAnsweredAsUnknown(api.visitor(), aRun, 'a caller with no cookie');
    assert.equal((await aggregate(a)).replaysAttempted, 0, 'no other caller\'s replay or replay result counted against A\'s run');

    const read = await a.get(`/api/v1/runs/${aRun}`);
    assert.equal(read.status, 200, 'A reads A\'s run');
    const answer = await read.json() as { record: { runId: string }; artifact: { metadata: { runId: string } } };
    assert.equal(answer.record.runId, aRun);
    assert.equal(answer.artifact.metadata.runId, aRun);
    assert.equal((await ask(a, 'HEAD', `/api/v1/runs/${aRun}`)).status, 200, 'A\'s HEAD finds it');
    const swarm = await ask(a, 'GET', `/api/v1/runs/${aRun}/swarm`);
    assert.ok(swarm.status === 200 || /swarm_not_captured/.test(swarm.body), `A's swarm read reaches the run: ${swarm.status} ${swarm.body.slice(0, 200)}`);
    const replay = await ask(a, 'POST', `/api/v1/runs/${aRun}/replay`);
    assert.equal(replay.status, 200, `A replays A's run: ${replay.body.slice(0, 300)}`);
    assert.equal((await ask(a, 'POST', `/api/v1/runs/${aRun}/replay-result`, { matches: true })).status, 204, 'A records a replay result on A\'s run');
    assert.equal((await aggregate(a)).replaysAttempted, 2, 'A\'s replay and replay result are counted');

    assert.equal((await ask(admin, 'GET', `/api/v1/runs/${aRun}`)).status, 200, 'the admin credential reads A\'s run');
    assert.equal((await ask(admin, 'HEAD', `/api/v1/runs/${aRun}`)).status, 200);
  });
});

test('on the hosted demo a bundle answers with the visitor\'s own runs', async () => {
  await withServer(HOSTED, async ({ api, startRun, admin }) => {
    const a = api.cookied();
    const b = api.cookied();
    const aRuns = await startRun(a);
    await startRun(b);
    const aBundle = (await listRuns(a)).runs[0].bundleId;
    assert.ok(aBundle, 'A\'s two runs share a bundle');

    const mine = await a.get(`/api/v1/bundles/${aBundle}`);
    assert.equal(mine.status, 200);
    const bundle = await mine.json() as BundleAnswer;
    assert.deepEqual(bundle.members.map(m => m.runId).sort(), sorted(aRuns), 'A\'s bundle holds A\'s runs');
    assert.equal((await ask(a, 'GET', `/api/v1/bundles/${aBundle}/aggregate`)).status, 200);

    for (const suffix of ['', '/aggregate']) {
      const unknownBundle = randomUUID();
      const held = await ask(b, 'GET', `/api/v1/bundles/${aBundle}${suffix}`);
      const unknown = await ask(b, 'GET', `/api/v1/bundles/${unknownBundle}${suffix}`);
      assert.equal(unknown.status, 404);
      assert.equal(held.status, unknown.status, `B's read of A's bundle${suffix} is answered as a bundle no run is in`);
      assert.equal(held.body.split(aBundle).join('<id>'), unknown.body.split(unknownBundle).join('<id>'));
    }

    const all = await admin.get(`/api/v1/bundles/${aBundle}`);
    assert.equal(all.status, 200, 'the admin credential reads A\'s bundle');
    assert.equal((await all.json() as BundleAnswer).memberCount, aRuns.length);
  });
});

test('on the hosted demo a run recorded with no owner is reached with the admin credential alone', async () => {
  await withServer(HOSTED, async ({ api, store, startRun, admin }) => {
    const a = api.cookied();
    const b = api.cookied();
    await startRun(a);
    const noOwner = await recordWithNoOwner(store);

    for (const [v, who] of [[a, 'a visitor with runs'], [b, 'a visitor with none'], [api.visitor(), 'a caller with no cookie']] as Array<[Visitor, string]>) {
      assert.ok(!idsOf(await listRuns(v)).includes(noOwner), `${who} does not list it`);
      await assertAnsweredAsUnknown(v, noOwner, who);
    }

    assert.ok(idsOf(await listRuns(admin)).includes(noOwner), 'the admin credential lists it');
    const read = await admin.get(`/api/v1/runs/${noOwner}`);
    assert.equal(read.status, 200, 'and reads it');
    assert.equal((await read.json() as { record: { runId: string } }).record.runId, noOwner);
  });
});

test('on the hosted demo a run a visitor imports is theirs, also under a run id another visitor holds', async () => {
  await withServer(HOSTED, async ({ api, startRun, admin }) => {
    const a = api.cookied();
    const b = api.cookied();
    const aRuns = await startRun(a);
    const [aRun] = aRuns;
    const readArtifact = async (): Promise<unknown> => {
      const res = await a.get(`/api/v1/runs/${aRun}`);
      assert.equal(res.status, 200, 'A reads A\'s run');
      return (await res.json() as { artifact: unknown }).artifact;
    };
    const aBefore = await readArtifact();

    // B drops a run file whose run id A's run holds, and one no run holds.
    const taken = await b.post('/api/v1/library/import', { artifact: await runFile(aRun) });
    const fresh = await b.post('/api/v1/library/import', { artifact: await runFile(newRunId()) });
    assert.equal(taken.status, 201);
    assert.equal(fresh.status, 201);
    const takenAnswer = await taken.json() as { runId: string; alreadyExisted: boolean };
    const freshAnswer = await fresh.json() as { runId: string; alreadyExisted: boolean };
    assert.equal(takenAnswer.alreadyExisted, false, 'the import of an id another visitor holds is answered as a new run');
    assert.equal(freshAnswer.alreadyExisted, false);
    assert.deepEqual(Object.keys(takenAnswer).sort(), Object.keys(freshAnswer).sort(), 'with the fields a new run\'s answer has');

    assert.deepEqual(idsOf(await listRuns(b)), sorted([takenAnswer.runId, freshAnswer.runId]), 'B lists both imports');
    for (const imported of [takenAnswer.runId, freshAnswer.runId]) {
      const read = await b.get(`/api/v1/runs/${imported}`);
      assert.equal(read.status, 200, 'B reads the run B imported');
      const answer = await read.json() as { record: { runId: string }; artifact: { metadata: { runId: string } } };
      assert.equal(answer.record.runId, imported);
      assert.equal(answer.artifact.metadata.runId, imported, 'the stored run file carries the id its record has');
    }

    assert.deepEqual(idsOf(await listRuns(a)), sorted(aRuns), 'A\'s list is A\'s runs still');
    assert.deepEqual(await readArtifact(), aBefore, 'and A\'s run holds the run file it held');
    await assertAnsweredAsUnknown(a, takenAnswer.runId, 'the visitor whose run id the import carried');

    const again = await b.post('/api/v1/library/import', { artifact: await runFile(aRun) });
    assert.equal(again.status, 201);
    assert.deepEqual(await again.json(), { runId: takenAnswer.runId, alreadyExisted: true }, 'the same drop twice is one run of B\'s');

    const own = await a.post('/api/v1/library/import', { artifact: await runFile(aRun) });
    assert.equal(own.status, 201);
    assert.deepEqual(await own.json(), { runId: aRun, alreadyExisted: true }, 'A\'s drop of A\'s own run finds it');

    // A caller with no cookie gets a visitor id with the import, and the run is that visitor's.
    const newcomer = api.visitor();
    const first = await newcomer.post('/api/v1/library/import', { artifact: await runFile(newRunId()) });
    assert.equal(first.status, 201);
    const firstAnswer = await first.json() as { runId: string };
    assert.ok(newcomer.cookies.get(VISITOR_COOKIE), 'the answer gives the caller a visitor cookie');
    assert.equal(first.headers.get('cache-control'), 'no-store', 'and is not stored by a cache');
    assert.deepEqual(idsOf(await listRuns(newcomer)), [firstAnswer.runId], 'and the import is listed to them');
    assert.deepEqual(idsOf(await listRuns(api.visitor())), [], 'and to no other caller with no cookie');

    assert.equal(idsOf(await listRuns(admin)).length, aRuns.length + 3, 'the admin credential lists every run, imports included');
  });
});

test('on the hosted demo a visitor\'s imports under a bundle another visitor made stay out of that visitor\'s bundle', async () => {
  await withServer(HOSTED, async ({ api, admin }) => {
    const a = api.cookied();
    const b = api.cookied();
    const made = await a.post('/api/v1/library/import', { artifacts: [await runFile(newRunId()), await runFile(newRunId())] });
    assert.equal(made.status, 201);
    const { bundleId, runIds } = await made.json() as { bundleId: string; runIds: string[] };

    const added = await b.post('/api/v1/library/import', { artifacts: [await runFile(newRunId())], addToBundle: bundleId });
    assert.equal(added.status, 201);
    const addedAnswer = await added.json() as { bundleId: string; runIds: string[] };
    assert.equal(addedAnswer.bundleId, bundleId);

    const aBundle = await (await a.get(`/api/v1/bundles/${bundleId}`)).json() as BundleAnswer;
    assert.deepEqual(aBundle.members.map(m => m.runId).sort(), sorted(runIds), 'A\'s bundle holds A\'s imports alone');
    const bBundle = await (await b.get(`/api/v1/bundles/${bundleId}`)).json() as BundleAnswer;
    assert.deepEqual(bBundle.members.map(m => m.runId), addedAnswer.runIds, 'B\'s read of the bundle holds B\'s import alone');
    const adminBundle = await (await admin.get(`/api/v1/bundles/${bundleId}`)).json() as BundleAnswer;
    assert.equal(adminBundle.memberCount, 3, 'the admin credential reads every run in it');
  });
});

test('a local server answers every caller with every run, as before', async () => {
  await withServer(LOCAL, async ({ api, store, startRun }) => {
    const a = api.cookied();
    const b = api.cookied();
    const aRuns = await startRun(a);
    const [aRun] = aRuns;
    const noOwner = await recordWithNoOwner(store);
    const everyRun = sorted([...aRuns, noOwner]);

    for (const v of [a, b, api.visitor()]) {
      const list = await listRuns(v);
      assert.deepEqual(idsOf(list), everyRun, 'every caller lists every run');
      assert.equal(list.total, everyRun.length);
      assert.equal((await aggregate(v)).totalRuns, everyRun.length);
      assert.equal((await ask(v, 'GET', `/api/v1/runs/${aRun}`)).status, 200);
      assert.equal((await ask(v, 'HEAD', `/api/v1/runs/${aRun}`)).status, 200);
      assert.equal((await ask(v, 'GET', `/api/v1/runs/${noOwner}`)).status, 200);
    }
    assert.equal((await a.get('/api/v1/runs')).headers.get('cache-control'), null, 'the list carries no cache header of the hosted demo');
    const aBundle = (await listRuns(a)).runs.find(run => run.runId === aRun)?.bundleId;
    assert.ok(aBundle);
    const bundle = await (await b.get(`/api/v1/bundles/${aBundle}`)).json() as BundleAnswer;
    assert.equal(bundle.memberCount, aRuns.length, 'another caller reads the whole bundle');
    assert.equal((await ask(b, 'POST', `/api/v1/runs/${aRun}/replay`)).status, 200, 'and replays the run');
    assert.equal((await ask(b, 'POST', `/api/v1/runs/${aRun}/replay-result`, { matches: true })).status, 204);

    // An import keeps the run id its file carries; an id the store holds is reported as already there.
    const taken = await b.post('/api/v1/library/import', { artifact: await runFile(aRun) });
    assert.equal(taken.status, 201);
    assert.deepEqual(await taken.json(), { runId: aRun, alreadyExisted: true });
    const freshId = newRunId();
    const fresh = await b.post('/api/v1/library/import', { artifact: await runFile(freshId) });
    assert.equal(fresh.status, 201);
    assert.deepEqual(await fresh.json(), { runId: freshId, alreadyExisted: false });
    assert.equal(b.cookies.size, 1, 'an import sets no cookie');
    assert.deepEqual(idsOf(await listRuns(a)), sorted([...everyRun, freshId]), 'every caller lists the import');
  });
});
