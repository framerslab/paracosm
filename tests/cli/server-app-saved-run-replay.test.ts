/**
 * A finished run, from the run to its saved replay.
 *
 * - On the hosted demo a pair run of six turns that finishes is listed in its
 *   visitor's saved runs (the list the Sim tab's "Replay from cache", Load
 *   Prior Run and the Quickstart "Replay last run" link read), and
 *   `/sessions/:id/replay` streams it back without starting a run or calling
 *   a model. A second visitor's list does not hold it. A pair run whose two
 *   actors share a name is saved too.
 * - Until the store holds 50 rows, other visitors' finished runs leave a
 *   visitor's saved run in that visitor's list.
 * - A run of 300 actors whose live buffer was trimmed, and a fork that runs
 *   turns 5 and 6 of a parent run, are finished runs and save in full.
 * - The saved cost is each actor's final artifact cost, summed, also when
 *   two artifacts share a run id.
 * - `?speed=` paces a replay; the replay of another visitor's run carries no
 *   brief that visitor compiled; the Library offers no session link the
 *   store no longer holds, and lists its runs with no links when the store
 *   cannot be read.
 * - A finished run whose save had not committed when the server stopped is
 *   saved once after the restart, with no title from a model, since the
 *   restart let go of the key that paid for the run, and its Library records
 *   link to it. A run's end is on disk as it ends, before its save starts.
 * - A local server keeps one ring of ten saved runs, whoever saved them.
 *
 * Every test goes through createMarsServer over HTTP with stub runners and
 * a stub title call, so no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSessionStore, type SessionStore, type TimestampedEvent } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import type { BroadcastFn } from '../../src/cli/pair-runner.js';
import {
  VISITOR_COOKIE, mars, readReplay, settingsBody, startServer, waitFor, withVisitors,
  type Frame, type Runner,
} from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

const HOSTED = { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-openai-key-of-this-test' };
const TURNS = 6;

interface SessionRow { id: string; turnCount?: number; title?: string; totalCostUSD?: number }

/** No Digital Twin world, so a server's boot compiles none and calls no model, whatever keys the shell holds. */
const NO_TWIN = { getDigitalTwinWorld: async () => null };

const memoryStore = (max = 10): SessionStore => openSessionStore(':memory:', max, { databaseOptions: { type: 'memory' } });

/** Stands in for the title a saved run gets from a model, and counts the calls. */
function titleStub() {
  const calls = { n: 0 };
  return { calls, generateText: async () => { calls.n += 1; return { text: 'A saved run' }; } };
}

/**
 * A pair runner that plays every turn the run asks for: a `turn_start` and a
 * `turn_done` per actor each turn, a `result` per actor, the verdict and
 * `complete`, the frames the pair runner writes for a finished run.
 */
const pairOfSixTurns: Runner = async (config, broadcast) => {
  broadcast('status', { phase: 'parallel', maxTurns: config.turns, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
  for (let turn = 1; turn <= config.turns; turn++) {
    for (const actor of config.actors) {
      broadcast('sim', { type: 'turn_start', leader: actor.name, data: { turn, time: turn, title: `${actor.name} turn ${turn}` } }, actor.name);
      broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn, time: turn } }, actor.name);
    }
  }
  for (const actor of config.actors) {
    broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
  }
  const [a, b] = config.actors;
  broadcast('verdict', {
    winner: 'A',
    winnerName: a.name,
    headline: `${a.name} wins`,
    summary: 'The bolder leader grew the settlement faster.',
    leaderA: { name: a.name, archetype: a.archetype },
    leaderB: { name: b.name, archetype: b.archetype },
  });
  broadcast('complete', { timestamp: new Date().toISOString() });
};

async function listSessions(v: Visitor): Promise<SessionRow[]> {
  const res = await v.get('/sessions');
  assert.equal(res.status, 200);
  return (await res.json() as { sessions: SessionRow[] }).sessions;
}

/** Starts a six-turn pair run as `v` and waits for the server's save decision on it. */
async function finishRun(v: Visitor): Promise<Record<string, unknown>> {
  const res = await v.post('/setup', { ...settingsBody(mars), turns: TURNS });
  assert.equal(res.status, 200, await res.text());
  const saved = await waitFor(async () => (await readReplay(v)).find(f => f.event === 'sim_saved'), 'the save decision', 5000);
  return saved.data;
}

function parseFrames(text: string): Frame[] {
  return text.split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const [eventLine, dataLine = 'data: {}'] = frame.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown> };
  });
}

test("on the hosted demo a finished six-turn pair run is in its visitor's saved runs and replays without a model call", async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied, launches }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    assert.equal(launches.length, 1);
    assert.equal(launches[0].config.turns, TURNS, 'the hosted demo ran all six turns');

    const own = await listSessions(a);
    assert.deepEqual(own.map(s => s.id), [saved.id], 'the run is in its visitor\'s saved runs');
    assert.equal(own[0].turnCount, TURNS);
    // The title call lands after the save; wait for it so the replay below
    // is the only thing that could call the stub.
    await waitFor(async () => (await listSessions(a))[0]?.title === 'A saved run', 'the saved run\'s title');
    const callsBeforeReplay = titles.calls.n;

    const replay = await a.get(`/sessions/${String(saved.id)}/replay`);
    assert.equal(replay.status, 200);
    const frames = parseFrames(await replay.text());
    const turnsDone = frames.filter(f => f.event === 'sim' && f.data.type === 'turn_done');
    assert.equal(turnsDone.length, 2 * TURNS, 'every turn of both leaders replays');
    assert.ok(frames.some(f => f.event === 'verdict'), 'the verdict replays');
    assert.ok(frames.some(f => f.event === 'complete'), 'the replay ends complete');
    assert.equal(launches.length, 1, 'the replay starts no run');
    assert.equal(titles.calls.n, callsBeforeReplay, 'the replay calls no model');

    const b = cookied();
    assert.deepEqual(await listSessions(b), [], "a second visitor's list holds none of the first visitor's runs");
  }, { runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore() } });
});

test('on the hosted demo a finished pair run whose two actors share a name is saved', async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied, launches }) => {
    const a = cookied();
    const [first, second] = mars.presets[0].leaders;
    const res = await a.post('/setup', { ...settingsBody(mars), turns: TURNS, actors: [{ ...first, name: 'Ada Reyes' }, { ...second, name: 'Ada Reyes' }] });
    assert.equal(res.status, 200, await res.text());
    const saved = (await waitFor(async () => (await readReplay(a)).find(f => f.event === 'sim_saved'), 'the save decision', 5000)).data;
    const [nameA, nameB] = launches[0].config.actors.map(actor => actor.name);
    assert.equal(nameA, nameB, 'both actors ran under one name');
    // Each actor's turn_done frames carry the same leader name, so the
    // twelve actor-turns of the two actors are twelve, not six.
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    assert.deepEqual((await listSessions(a)).map(s => s.id), [saved.id]);
  }, { runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore() } });
});

test("on the hosted demo, until the store holds 50 rows, other visitors' finished runs leave a visitor's saved run in their list", async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));

    // More visitors finish runs than the store keeps for one visitor.
    for (let i = 0; i < 3; i++) {
      const other = cookied();
      const theirs = await finishRun(other);
      assert.equal(theirs.status, 'saved', JSON.stringify(theirs));
      assert.deepEqual((await listSessions(other)).map(s => s.id), [theirs.id], `visitor ${i + 2} sees their own run alone`);
    }

    assert.deepEqual((await listSessions(a)).map(s => s.id), [saved.id], "the first visitor's run is still in their list");
    const replay = await a.get(`/sessions/${String(saved.id)}/replay`);
    assert.equal(replay.status, 200, 'and still replays');
    await replay.body?.cancel();
  }, { runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore(2) } });
});

type OnArtifact = (artifact: unknown, leader: unknown) => void | Promise<void>;
type StubRunner = (
  config: NormalizedSimulationConfig,
  broadcast: BroadcastFn,
  signal?: AbortSignal,
  scenario?: unknown,
  onArtifact?: OnArtifact,
  ...rest: unknown[]
) => Promise<void>;

/** Every turn the run asks for, from `fromTurn`, for every actor: the frames the runners write. */
function playTurns(config: NormalizedSimulationConfig, broadcast: BroadcastFn, fromTurn = 1): void {
  for (let turn = fromTurn; turn <= config.turns; turn++) {
    for (const actor of config.actors) {
      broadcast('sim', { type: 'turn_start', leader: actor.name, data: { turn, time: turn, title: `${actor.name} turn ${turn}` } }, actor.name);
      broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn, time: turn } }, actor.name);
    }
  }
  for (const actor of config.actors) broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
}

/** The batch runner's frames for N actors, with no model. */
const batchRunner: StubRunner = async (config, broadcast) => {
  broadcast('status', { phase: 'parallel', batch: true, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
  playTurns(config, broadcast);
  broadcast('complete', { timestamp: new Date().toISOString() });
};

/** The fork runner's frames: its one actor plays the turns after the fork's turn. */
const forkRunner: StubRunner = async (config, broadcast) => {
  const atTurn = config.forkFrom?.atTurn ?? 0;
  broadcast('status', { phase: 'fork-running', leader: { name: config.actors[0].name }, atTurn });
  playTurns(config, broadcast, atTurn + 1);
  broadcast('complete', { timestamp: new Date().toISOString() });
};

const actorsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ ...mars.presets[0].leaders[i % 2], name: `Actor ${i + 1}` }));

function parentArtifact(turns: number[]) {
  return {
    metadata: { runId: 'parent-run', scenario: { id: mars.id, name: 'Mars Genesis' }, mode: 'turn-loop', startedAt: '2026-11-18T00:00:00.000Z' },
    scenarioExtensions: {
      kernelSnapshotsPerTurn: turns.map(turn => ({
        snapshotVersion: 1, scenarioId: mars.id, turn, time: turn, state: {}, rngState: 0, startTime: 1, seed: 11,
      })),
    },
  };
}

async function readAll(res: Response): Promise<Frame[]> {
  return parseFrames(await res.text());
}

test('a run of 300 actors whose live buffer was trimmed saves every turn of every actor', async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const res = await a.post('/setup', { actors: actorsOf(300), turns: TURNS, seed: 7, scenarioId: mars.id });
    assert.equal(res.status, 200, await res.text());
    const saved = (await waitFor(async () => (await readReplay(a)).find(f => f.event === 'sim_saved'), 'the save decision', 15000)).data;
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    const replay = await readAll(await a.get(`/sessions/${String(saved.id)}/replay`));
    assert.equal(replay.filter(f => f.event === 'sim' && f.data.type === 'turn_done').length, 300 * TURNS, 'the saved replay holds every turn the buffer dropped');
    assert.equal(replay[0]?.event, 'active_scenario');
    assert.ok(replay.some(f => f.event === 'complete'));
    assert.equal((await listSessions(a))[0]?.turnCount, TURNS);
  }, {
    env: { PARACOSM_EVENT_BUFFER_MAX: '1000' },
    extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore(), runBatchSimulations: batchRunner },
  });
});

test('a fork from turn 4 that runs turns 5 and 6 is a finished run and saves', async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const res = await a.post('/setup', {
      actors: [mars.presets[0].leaders[0]],
      turns: TURNS,
      seed: 11,
      captureSnapshots: true,
      scenarioId: mars.id,
      forkFrom: { parentArtifact: parentArtifact([1, 2, 3, 4]), atTurn: 4 },
    });
    assert.equal(res.status, 200, await res.text());
    const saved = (await waitFor(async () => (await readReplay(a)).find(f => f.event === 'sim_saved'), 'the save decision', 5000)).data;
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    const replay = await readAll(await a.get(`/sessions/${String(saved.id)}/replay`));
    assert.deepEqual(replay.filter(f => f.event === 'sim' && f.data.type === 'turn_done').map(f => (f.data.data as { turn: number }).turn), [5, 6]);
  }, { extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore(), runForkSimulation: forkRunner } });
});

/**
 * A pair runner whose actors' final artifacts cost 0.20 and 0.30. The
 * cumulative cost each actor's frames carry stops short of the artifact's
 * (0.18 and 0.27), and the verdict carries a cost of its own. With
 * `sharedRunId` both artifacts carry one run id, as the orchestrator's
 * `<scenario>-<archetype>-<ms>` gives two actors of one archetype that
 * finish in the same millisecond.
 */
function pairWithArtifacts(runIds: string[], options: { sharedRunId?: boolean } = {}): StubRunner {
  let run = 0;
  return async (config, broadcast, _signal, _scenario, onArtifact) => {
    run += 1;
    broadcast('status', { phase: 'parallel', maxTurns: config.turns, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
    const finals = [0.2, 0.3];
    for (let turn = 1; turn <= config.turns; turn++) {
      config.actors.forEach((actor, i) => {
        const cumulative = (finals[i] * 0.9 * turn) / config.turns;
        broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn, time: turn, _cost: { totalCostUSD: cumulative } } }, actor.name);
      });
    }
    for (const [i, actor] of config.actors.entries()) {
      const runId = options.sharedRunId ? `run-${run}` : `run-${run}-${i}`;
      runIds.push(runId);
      await onArtifact?.({
        metadata: { runId, scenario: { id: mars.id, name: 'Mars Genesis' }, mode: 'turn-loop', startedAt: '2026-11-18T00:00:00.000Z', completedAt: '2026-11-18T00:01:00.000Z' },
        cost: { totalUSD: finals[i] },
        scenarioExtensions: { paracosmInternal: { leader: { name: actor.name, archetype: actor.archetype } } },
      }, actor);
      broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
    }
    broadcast('verdict', { winner: 'A', winnerName: config.actors[0].name, _cost: { totalCostUSD: 0.05 } });
    broadcast('complete', { timestamp: new Date().toISOString() });
  };
}

test("a saved pair run's cost is the sum of its two actors' final artifact costs", async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    const cost = (await listSessions(a))[0]?.totalCostUSD;
    assert.ok(cost !== undefined && Math.abs(cost - 0.5) < 1e-9, `0.20 + 0.30, got ${cost}`);
  }, { extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore(), runPairSimulations: pairWithArtifacts([]) } });
});

test("a saved pair run's cost counts both actors when their artifacts share a run id", async () => {
  const titles = titleStub();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    const cost = (await listSessions(a))[0]?.totalCostUSD;
    assert.ok(cost !== undefined && Math.abs(cost - 0.5) < 1e-9, `0.20 + 0.30, got ${cost}`);
  }, { extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: memoryStore(), runPairSimulations: pairWithArtifacts([], { sharedRunId: true }) } });
});

test("the Library offers no session link for a run whose saved session the store no longer holds", async () => {
  const titles = titleStub();
  const runIds: string[] = [];
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const savedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const saved = await finishRun(a);
      assert.equal(saved.status, 'saved', JSON.stringify(saved));
      savedIds.push(String(saved.id));
    }
    // The ring keeps two: the first run's session is gone.
    assert.equal((await a.get(`/sessions/${savedIds[0]}`)).status, 404);
    const { runs } = await a.json<{ runs: Array<{ runId: string; sessionId?: string }> }>('/api/v1/runs');
    const sessionOf = (runId: string) => runs.find(r => r.runId === runId)?.sessionId;
    assert.equal(runs.length, 6);
    assert.equal(sessionOf('run-1-0'), undefined, "the evicted session's link is gone");
    assert.equal(sessionOf('run-1-1'), undefined);
    assert.equal(sessionOf('run-2-0'), savedIds[1]);
    assert.equal(sessionOf('run-3-1'), savedIds[2]);
  }, {
    extra: {
      ...NO_TWIN,
      generateText: titles.generateText,
      sessionStore: memoryStore(2),
      runHistoryStore: createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } }),
      runPairSimulations: pairWithArtifacts(runIds),
    },
  });
});

test('the Library lists its runs, with no session links, when the session store cannot be read', async () => {
  const titles = titleStub();
  const store = memoryStore();
  const unreadable: SessionStore = { ...store, existingIds: async () => { throw new Error('database is locked'); } };
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const saved = await finishRun(a);
    assert.equal(saved.status, 'saved', JSON.stringify(saved));
    const res = await a.get('/api/v1/runs');
    assert.equal(res.status, 200, await res.clone().text());
    const { runs } = await res.json() as { runs: Array<{ runId: string; sessionId?: string }> };
    assert.deepEqual(runs.map(r => r.runId).sort(), ['run-1-0', 'run-1-1']);
    assert.ok(runs.every(r => r.sessionId === undefined), 'no link the server could not check');
  }, {
    extra: {
      ...NO_TWIN,
      generateText: titles.generateText,
      sessionStore: unreadable,
      runHistoryStore: createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } }),
      runPairSimulations: pairWithArtifacts([]),
    },
  });
});

const BRIEF = `Private board brief, do not share. ${'Detail line. '.repeat(10)}`;
const ownerKey = (visitorId: string) => createHash('sha256').update(`paracosm-session-owner:${visitorId}`).digest('hex');
const frameOf = (event: string, data: unknown, ts: number): TimestampedEvent => ({ ts, sse: `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` });

/** A session saved under `owner` from a run that started from a compiled brief. */
async function savedBriefRun(store: SessionStore, owner: string): Promise<string> {
  const { id } = await store.saveSession([
    frameOf('active_scenario', { id: mars.id, name: 'Mars Genesis', seedText: BRIEF, runKey: 'brief-run' }, 1000),
    frameOf('sim', { type: 'turn_done', leader: 'Aria', data: { turn: 1, time: 1 } }, 1040),
    frameOf('complete', { timestamp: '2026-11-18T00:00:00.000Z' }, 1080),
  ], undefined, { owner });
  return id;
}

test("on the hosted demo a replay of another visitor's run carries none of the brief that visitor compiled", async () => {
  const store = memoryStore();
  const aId = randomUUID();
  const id = await savedBriefRun(store, ownerKey(aId));
  await withVisitors(async ({ visitor, cookied }) => {
    const a = visitor({ [VISITOR_COOKIE]: aId });
    const own = await readAll(await a.get(`/sessions/${id}/replay`));
    assert.equal(own.find(f => f.event === 'active_scenario')?.data.seedText, BRIEF, 'the visitor who compiled it reads their brief');

    for (const b of [cookied(), visitor()]) {
      const res = await b.get(`/sessions/${id}/replay`);
      assert.equal(res.status, 200, 'the replay is shared by its link');
      const text = await res.text();
      assert.ok(!text.includes('Private board brief'), 'no frame carries the brief');
      const opening = parseFrames(text).find(f => f.event === 'active_scenario');
      assert.equal(opening?.data.name, 'Mars Genesis');
      assert.equal(opening?.data.seedText ?? null, null);
      assert.equal((await b.json<{ meta: { seedText?: string } }>(`/sessions/${id}`)).meta.seedText, undefined);
    }
  }, { env: HOSTED, extra: { ...NO_TWIN, sessionStore: store } });
});

test('a replay asked for at a speed streams the saved run', async () => {
  const store = memoryStore();
  const id = await savedBriefRun(store, ownerKey(randomUUID()));
  await withVisitors(async ({ cookied }) => {
    const res = await cookied().get(`/sessions/${id}/replay?speed=2`);
    assert.equal(res.status, 200, await res.clone().text());
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const frames = await readAll(res);
    assert.deepEqual(frames.map(f => f.event), ['active_scenario', 'sim', 'complete']);
  }, { env: HOSTED, extra: { ...NO_TWIN, sessionStore: store } });
});

test('a finished run whose save had not committed when the server stopped is saved once after the restart', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-save-restart-'));
  const titles = titleStub();
  try {
    // The first server's store never answers a save, as a server stopped
    // between the run's end and the save's commit leaves it.
    const stalled = memoryStore();
    const neverSaves: SessionStore = { ...stalled, saveSession: () => new Promise(() => {}) };
    const first = await startServer({ appDir, runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: neverSaves } });
    const a = first.cookied();
    const visitorId = a.cookies.get(VISITOR_COOKIE)!;
    try {
      const res = await a.post('/setup', { ...settingsBody(mars), turns: TURNS });
      assert.equal(res.status, 200, await res.text());
      await waitFor(async () => (await readReplay(a)).some(f => f.event === 'complete'), 'the run to finish');
    } finally {
      await first.close();
    }

    const store = memoryStore();
    const second = await startServer({ appDir, runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: store } });
    try {
      const again = second.visitor({ [VISITOR_COOKIE]: visitorId });
      const rows = await waitFor(async () => { const r = await listSessions(again); return r.length > 0 && r; }, 'the run to be saved after the restart', 5000);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].turnCount, TURNS);
    } finally {
      await second.close();
    }

    // A third start finds the run saved and saves it no second time.
    const third = await startServer({ appDir, runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: store } });
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(await store.count(), 1);
    } finally {
      await third.close();
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("a run saved after a restart, on a visitor's key the restart let go of, gets no title from a model", async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-save-restart-title-'));
  try {
    const stalled = memoryStore();
    const neverSaves: SessionStore = { ...stalled, saveSession: () => new Promise(() => {}) };
    const first = await startServer({ appDir, runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titleStub().generateText, sessionStore: neverSaves } });
    const a = first.cookied();
    const visitorId = a.cookies.get(VISITOR_COOKIE)!;
    try {
      // The run is paid for with the visitor's own Anthropic key, which the
      // server holds in memory alone.
      const res = await a.post('/setup', { ...settingsBody(mars), turns: TURNS, provider: 'anthropic', anthropicKey: 'visitor-anthropic-key-of-this-test' });
      assert.equal(res.status, 200, await res.text());
      await waitFor(async () => (await readReplay(a)).some(f => f.event === 'complete'), 'the run to finish');
    } finally {
      await first.close();
    }

    const store = memoryStore();
    const titles = titleStub();
    const second = await startServer({ appDir, runner: pairOfSixTurns, env: HOSTED, extra: { ...NO_TWIN, generateText: titles.generateText, sessionStore: store } });
    try {
      const again = second.visitor({ [VISITOR_COOKIE]: visitorId });
      const rows = await waitFor(async () => { const r = await listSessions(again); return r.length > 0 && r; }, 'the run to be saved after the restart', 5000);
      assert.equal(rows.length, 1);
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(titles.calls.n, 0, 'no title call on the host key or another provider');
      assert.equal((await listSessions(again))[0]?.title, undefined);
    } finally {
      await second.close();
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("a run's end is on disk the moment it ends, so a server stopped before the save commits saves the run after its restart", async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-run-end-on-disk-'));
  const seen: { ended?: boolean } = {};
  const endsOnDisk: Runner = async (config, broadcast, scenario, signal) => {
    await pairOfSixTurns(config, broadcast, scenario, signal);
    // Still in the tick that broadcast `complete`, so no write delay has run.
    const dir = join(appDir, '.live-runs');
    seen.ended = existsSync(dir) && readdirSync(dir).some(name => {
      const persisted = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as { events?: string[] };
      return (persisted.events ?? []).some(frame => frame.startsWith('event: complete\n'));
    });
  };
  try {
    const server = await startServer({ appDir, runner: endsOnDisk, extra: { ...NO_TWIN, generateText: titleStub().generateText, sessionStore: memoryStore() } });
    try {
      const a = server.cookied();
      const res = await a.post('/setup', { ...settingsBody(mars), turns: TURNS });
      assert.equal(res.status, 200, await res.text());
      await waitFor(async () => (await readReplay(a)).some(f => f.event === 'sim_saved'), 'the save decision');
      assert.equal(seen.ended, true, "the run's file holds its complete frame before its save starts");
    } finally {
      await server.close();
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a run saved after a restart links its Library records to its saved session', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-save-restart-links-'));
  // One run-history store across both starts, as a server's database file is.
  const runHistoryStore = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  try {
    const stalled = memoryStore();
    const neverSaves: SessionStore = { ...stalled, saveSession: () => new Promise(() => {}) };
    const first = await startServer({ appDir, extra: { ...NO_TWIN, generateText: titleStub().generateText, sessionStore: neverSaves, runHistoryStore, runPairSimulations: pairWithArtifacts([]) } });
    const a = first.cookied();
    const visitorId = a.cookies.get(VISITOR_COOKIE)!;
    try {
      const res = await a.post('/setup', { ...settingsBody(mars), turns: TURNS });
      assert.equal(res.status, 200, await res.text());
      await waitFor(async () => (await readReplay(a)).some(f => f.event === 'complete'), 'the run to finish');
    } finally {
      await first.close();
    }

    const store = memoryStore();
    const second = await startServer({ appDir, extra: { ...NO_TWIN, generateText: titleStub().generateText, sessionStore: store, runHistoryStore, runPairSimulations: pairWithArtifacts([]) } });
    try {
      const again = second.visitor({ [VISITOR_COOKIE]: visitorId });
      const rows = await waitFor(async () => { const r = await listSessions(again); return r.length > 0 && r; }, 'the run to be saved after the restart', 5000);
      const runs = await waitFor(async () => {
        const { runs: listed } = await again.json<{ runs: Array<{ runId: string; sessionId?: string }> }>('/api/v1/runs');
        return listed.length === 2 && listed.every(r => r.sessionId !== undefined) && listed;
      }, "the Library records' session links", 3000);
      assert.deepEqual(runs.map(r => r.sessionId), [rows[0].id, rows[0].id]);
    } finally {
      await second.close();
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a local server keeps one ring of ten saved runs, whoever saved them', async () => {
  const titles = titleStub();
  await withVisitors(async ({ visitor, cookied }) => {
    // A run with no cookie, as the CLI's own run is, then ten from a browser.
    const cli = await finishRun(visitor());
    assert.equal(cli.status, 'saved', JSON.stringify(cli));
    const browser = cookied();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const saved = await finishRun(browser);
      assert.equal(saved.status, 'saved', JSON.stringify(saved));
      ids.push(String(saved.id));
    }
    const listed = (await listSessions(browser)).map(s => s.id);
    assert.equal(listed.length, 10);
    assert.ok(!listed.includes(String(cli.id)), 'the oldest run went');
    assert.deepEqual(listed, [...ids].reverse());
  }, { runner: pairOfSixTurns, extra: { ...NO_TWIN, generateText: titles.generateText } });
});
