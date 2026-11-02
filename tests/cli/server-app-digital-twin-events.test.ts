/**
 * What a Digital Twin run writes to the server's event stream.
 *
 * The route forwarded each engine event under its own type name, which no
 * dashboard listener takes, and ended the run with no event at all. A page
 * that names the run's key in its request shows that run whichever scenario
 * the page is on, and a run started after it takes the buffer from it.
 *
 * Every test goes through createMarsServer over HTTP with the scenario JSON
 * under scenarios/. Only the engine is stubbed: `intervene` would call a
 * model on every turn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { WorldModel } from '../../src/runtime/world-model/index.js';

const LEADER = 'Cautious Methodical Evaluator';
const scenario = JSON.parse(readFileSync(new URL('../../scenarios/t2d-glp1-protocol.json', import.meta.url), 'utf-8')) as { id: string };
const mars = JSON.parse(readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf-8')) as {
  id: string;
  presets: Array<{ leaders: unknown[] }>;
};

const turnStart = { type: 'turn_start', leader: LEADER, data: { turn: 1, time: 1, title: 'Week 4 labs' } };
const turnDone = { type: 'turn_done', leader: LEADER, data: { turn: 1, time: 1, metrics: { hba1c: 7.6 } } };
const body = (extra: Record<string, unknown> = {}) => ({
  subject: { id: 'patient-maria-2026', name: 'Maria Chen' },
  intervention: { id: 'glp1-12wk-protocol', name: 'Semaglutide', description: 'A 12-week semaglutide and lifestyle protocol.' },
  options: { maxTurns: 2, seed: 11, costPreset: 'economy' },
  ...extra,
});

interface OnEvent { onEvent?: (event: unknown) => void }
type Intervene = (options: OnEvent) => Promise<unknown>;
type Frame = { event: string; data: Record<string, unknown> };

async function withServer(intervene: Intervene, run: (base: string) => Promise<void>): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-digital-twin-events-'));
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '' },
    maxSimsPerDay: 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async () => {},
    getDigitalTwinWorld: async () => ({ scenario, intervene }) as unknown as WorldModel,
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
}

const post = (base: string, path: string, payload: unknown) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** Connects to /events and returns the frames it replays before replay_done. */
async function readReplay(base: string, query = ''): Promise<Frame[]> {
  const ac = new AbortController();
  const res = await fetch(`${base}/events${query}`, { signal: ac.signal });
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
  const frames = text.split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const [eventLine, dataLine = 'data: {}'] = frame.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown> };
  });
  return frames.slice(1, frames.findIndex(f => f.event === 'replay_done'));
}

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("each engine event goes out as a sim event tagged with its leader, between the run's opening and its end", async () => {
  const artifact = { metadata: { runId: 'twin-1' }, subject: body().subject };
  await withServer(async ({ onEvent }) => {
    onEvent?.(turnStart);
    onEvent?.(turnDone);
    return artifact;
  }, async base => {
    const res = await post(base, '/api/quickstart/simulate-intervention', body({ runKey: 'page-run-key-1' }));
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { artifact: unknown }).artifact, artifact);

    const frames = await readReplay(base);
    assert.deepEqual(frames.map(f => f.event).filter(e => e !== 'sim_saved'), ['active_scenario', 'status', 'sim', 'sim', 'complete']);
    assert.equal(frames[0].data.id, scenario.id);
    assert.equal(frames[0].data.runKey, 'page-run-key-1');
    assert.equal(frames[1].data.maxTurns, 2);
    assert.equal(frames[1].data.phase, 'parallel');
    assert.deepEqual((frames[1].data.actors as Array<{ name: string }>).map(a => a.name), [LEADER]);
    assert.deepEqual(frames[2].data, turnStart);
    assert.deepEqual(frames[3].data, turnDone);
    assert.notEqual(frames[4].data.aborted, true);

    // A subscriber to one leader gets that leader's events; the run's
    // opening and end reach every subscriber.
    const own = await readReplay(base, `?actor=${encodeURIComponent(LEADER)}`);
    assert.equal(own.filter(f => f.event === 'sim').length, 2);
    const other = await readReplay(base, '?actor=someone-else');
    assert.deepEqual(other.filter(f => f.event === 'sim'), []);
    assert.ok(other.some(f => f.event === 'active_scenario'));
    assert.ok(other.some(f => f.event === 'complete'));
  });
});

test('a request that names no run key gets one from the server, and a malformed key is refused', async () => {
  await withServer(async () => ({ metadata: { runId: 'twin-1' } }), async base => {
    const bad = await post(base, '/api/quickstart/simulate-intervention', body({ runKey: 'not a key' }));
    assert.equal(bad.status, 400);

    assert.equal((await post(base, '/api/quickstart/simulate-intervention', body())).status, 200);
    const [opening] = await readReplay(base);
    assert.equal(opening.event, 'active_scenario');
    assert.equal(typeof opening.data.runKey, 'string');
    assert.ok((opening.data.runKey as string).length > 0);
  });
});

test('a Digital Twin run is not saved as a session: its artifact comes back in its answer', async () => {
  await withServer(async ({ onEvent }) => {
    onEvent?.(turnStart);
    onEvent?.(turnDone);
    return { metadata: { runId: 'twin-1' } };
  }, async base => {
    assert.equal((await post(base, '/api/quickstart/simulate-intervention', body())).status, 200);
    await waitFor(async () => (await readReplay(base)).some(f => f.event === 'sim_saved'), 'the save outcome');
    const saved = (await readReplay(base)).find(f => f.event === 'sim_saved');
    assert.deepEqual(saved?.data, { status: 'skipped', reason: 'digital_twin' });
    // The session store opens in the background.
    await waitFor(async () => (await fetch(`${base}/sessions`)).ok, 'the session store');
    const sessions = (await (await fetch(`${base}/sessions`)).json()) as { sessions: unknown[] };
    assert.deepEqual(sessions.sessions, []);
  });
});

test('a run started during a Digital Twin run takes the buffer: the twin writes nothing more to it', async () => {
  let finish = () => {};
  const held = new Promise<void>(resolve => { finish = resolve; });
  await withServer(async ({ onEvent }) => {
    onEvent?.(turnStart);
    await held;
    onEvent?.(turnDone);
    return { metadata: { runId: 'twin-1' } };
  }, async base => {
    const answer = post(base, '/api/quickstart/simulate-intervention', body({ runKey: 'page-run-key-1' }));
    await waitFor(async () => (await readReplay(base)).some(f => f.event === 'sim'), "the twin's first event");

    const setup = await post(base, '/setup', { actors: mars.presets[0].leaders, turns: 6, seed: 951, scenarioId: mars.id });
    assert.equal(setup.status, 200);
    await waitFor(async () => (await readReplay(base))[0]?.data.id === mars.id, 'the new run to open');

    finish();
    const res = await answer;
    assert.equal(res.status, 200, 'the page that ran the twin still gets its artifact');
    const frames = await readReplay(base);
    assert.equal(frames[0].event, 'active_scenario');
    assert.notEqual(frames[0].data.runKey, 'page-run-key-1');
    assert.deepEqual(frames.filter(f => f.event === 'sim'), [], "the new run's buffer holds none of the twin's events");
    assert.deepEqual(frames.filter(f => f.event === 'complete'), [], "the twin's end does not end the new run");
  });
});

test('a run that fails says so on the stream and ends', async () => {
  await withServer(async ({ onEvent }) => {
    onEvent?.(turnStart);
    throw new Error('the engine stopped');
  }, async base => {
    const res = await post(base, '/api/quickstart/simulate-intervention', body());
    assert.equal(res.status, 500);
    assert.match(((await res.json()) as { error: string }).error, /the engine stopped/);

    const frames = await readReplay(base);
    const failed = frames.find(f => f.event === 'sim_error');
    assert.equal(failed?.data.leader, LEADER);
    assert.match(String(failed?.data.error), /the engine stopped/);
    const end = frames.filter(f => f.event === 'complete');
    assert.equal(end.length, 1);
    assert.equal(end[0].data.aborted, true);
  });
});

test('a run the provider stopped ends as aborted, as a pair run does', async () => {
  await withServer(async ({ onEvent }) => {
    onEvent?.(turnStart);
    return { metadata: { runId: 'twin-1' }, providerError: { kind: 'quota', message: 'No credits' } };
  }, async base => {
    assert.equal((await post(base, '/api/quickstart/simulate-intervention', body())).status, 200);
    const end = (await readReplay(base)).filter(f => f.event === 'complete');
    assert.equal(end.length, 1);
    assert.equal(end[0].data.aborted, true);
  });
});
