/**
 * Each visitor's run stays their own.
 *
 * The server held one run for every visitor: one event buffer, one stream
 * set, one abort controller. Visitor A pressed Run on Mars Genesis; visitor
 * B pressed Run on Atlas Lab a minute later, and the server aborted A's run
 * to start B's. A's page then showed A's run as interrupted, A's Chat tab
 * answered with B's agents, and A's Clear wiped B's run.
 *
 * A visitor is the `paracosm_visitor` cookie the dashboard's HTML gives a
 * browser. Each visitor's run has its own buffer, stream, watchdog and
 * flags; the server runs a few at once and tells a visitor above that to
 * wait. A caller that sends no cookie (the CLI's own run, curl, scripts) is
 * the anonymous visitor, which behaves as the whole server did before.
 *
 * Every test goes through createMarsServer over HTTP with the scenario JSON
 * under scenarios/, one cookie jar per visitor, and a stub runner, so no
 * model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VISITOR_COOKIE, atlasLab, heldRun, mars, openStream, quickstartBody, readReplay, settingsBody, startServer, waitFor, withVisitors,
  type Frame,
} from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface SetupAnswer { runKey?: string; visitorId?: string; scenarioId?: string; error?: string }
interface Results {
  results: unknown[];
  isComplete: boolean;
  actors: Array<{ name: string }>;
  runKey?: string | null;
  scenarioId?: string;
  inFlight?: boolean;
}

async function setup(v: Visitor, body: unknown): Promise<{ status: number; answer: SetupAnswer; res: Response }> {
  const res = await v.post('/setup', body);
  return { status: res.status, answer: await res.json() as SetupAnswer, res };
}

/** POST /clear with no body, as the dashboard's Clear sends it. */
const clearEmpty = async (v: Visitor) => (await v.get('/clear', { method: 'POST' })).json() as Promise<Record<string, unknown>>;

const names = (frames: Frame[]) => frames
  .filter(f => f.event === 'sim')
  .map(f => String(f.data.leader));
const openings = (frames: Frame[]) => frames.filter(f => f.event === 'active_scenario');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('two visitors run beside each other, each on their own stream and results', async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const b = cookied();

    const aRun = await setup(a, settingsBody(mars));
    assert.equal(aRun.status, 200, `A's run: ${JSON.stringify(aRun.answer)}`);
    assert.equal(typeof aRun.answer.runKey, 'string');
    assert.equal(aRun.answer.visitorId, a.cookies.get(VISITOR_COOKIE));
    await waitFor(() => held.runs[0], "A's run");

    const aReplay = await readReplay(a);
    assert.equal(aReplay.connected.runKey, aRun.answer.runKey);
    assert.equal(aReplay.connected.visitorId, a.cookies.get(VISITOR_COOKIE));
    assert.equal(aReplay[0]?.event, 'active_scenario');
    assert.equal(aReplay[0].data.id, 'mars-genesis');
    assert.equal(aReplay[0].data.runKey, aRun.answer.runKey);
    assert.equal(aReplay[0].data.kind, 'pair');
    assert.deepEqual(names(aReplay), ['Aria Chen', 'Dietrich Voss']);

    // B presses Run while A's run is in flight.
    const bRun = await setup(b, quickstartBody(atlasLab));
    assert.equal(bRun.status, 200, `B's run: ${JSON.stringify(bRun.answer)}`);
    await waitFor(() => held.runs[1], "B's run");
    assert.equal(held.runs[0].signal?.aborted, false, "B's run does not stop A's");

    const bReplay = await readReplay(b);
    assert.deepEqual(openings(bReplay).map(f => f.data.id), ['atlas-lab']);
    assert.deepEqual(names(bReplay), ['Marcus Reinhardt', 'Priya Kapoor']);
    const aAgain = await readReplay(a);
    assert.deepEqual(openings(aAgain).map(f => f.data.runKey), [aRun.answer.runKey]);
    assert.deepEqual(names(aAgain), ['Aria Chen', 'Dietrich Voss']);

    held.runs[0].release();
    await waitFor(() => held.runs[0].settled, "A's run to finish");
    const aResults = await waitFor(async () => {
      const r = await a.json<Results>('/results');
      return r.isComplete ? r : null;
    }, "A's results");
    assert.equal(aResults.results.length, 2);
    assert.equal(aResults.runKey, aRun.answer.runKey);
    assert.equal(aResults.scenarioId, 'mars-genesis');
    assert.equal(aResults.inFlight, false);

    const bResults = await b.json<Results>('/results');
    assert.equal(bResults.inFlight, true);
    assert.equal(bResults.isComplete, false);
    assert.equal(bResults.scenarioId, 'atlas-lab');
    held.runs[1].release();
  }, { runner: held.runner, maxRuns: 2 });
});

test('above the run cap a visitor is told to wait, and the refusal costs them no run of the day', async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied({ 'x-forwarded-for': '203.0.113.1' });
    const b = cookied({ 'x-forwarded-for': '203.0.113.2' });
    assert.equal((await setup(a, settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[0], "A's run");

    const refused = await setup(b, quickstartBody(atlasLab));
    assert.equal(refused.status, 503);
    assert.equal(refused.res.headers.get('retry-after'), '180');
    assert.deepEqual(refused.answer, {
      error: 'The server is running 1 simulation right now, the most it runs at once. Try again in a few minutes.',
      runsInFlight: 1,
      maxRuns: 1,
    });
    assert.equal(held.runs[0].signal?.aborted, false, "B's refusal leaves A's run alone");

    held.runs[0].release();
    await waitFor(() => held.runs[0].settled, "A's run to finish");
    // The slot frees once A's runner has settled; B's refusals were free.
    const admitted = await waitFor(async () => {
      const attempt = await setup(b, quickstartBody(atlasLab));
      return attempt.status === 503 ? null : attempt;
    }, "B's admission");
    assert.equal(admitted.status, 200, `B's run: ${JSON.stringify(admitted.answer)}`);
    await waitFor(() => held.runs[1], "B's run");

    // B's run was charged: B's next Run is over B's day, and B's run goes on.
    const again = await setup(b, quickstartBody(atlasLab));
    assert.equal(again.status, 429);
    assert.equal(held.runs[1].signal?.aborted, false, "a refused Run leaves the visitor's own run alone");
    held.runs[1].release();
  }, { runner: held.runner, maxRuns: 1, maxSimsPerDay: 1 });
});

test("a visitor's own Run replaces their run, and the run it replaced is told why", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied, base }) => {
    const a = cookied();
    const first = await setup(a, settingsBody(mars));
    assert.equal(first.status, 200);
    await waitFor(() => held.runs[0], 'the first run');

    const second = await setup(a, settingsBody(mars));
    assert.equal(second.status, 200);
    assert.equal(typeof second.answer.runKey, 'string');
    assert.notEqual(second.answer.runKey, first.answer.runKey);
    assert.equal(held.runs[0].signal?.aborted, true);
    assert.equal(held.runs[0].signal?.reason, 'another_run_started');
    await waitFor(() => held.runs[1], 'the second run');
    await waitFor(() => held.runs[0].settled, 'the first run to stop');

    const replay = await readReplay(a);
    assert.deepEqual(openings(replay).map(f => f.data.runKey), [second.answer.runKey]);
    assert.equal(replay.some(f => f.event === 'complete'), false, "the replaced run's end does not reach the new run");
    const health = await waitFor(async () => {
      const h = await (await fetch(`${base}/health`)).json() as { runsInFlight?: number };
      return h.runsInFlight === 1 ? h : null;
    }, 'one run in flight');
    assert.equal(health.runsInFlight, 1);
    held.runs[1].release();
  }, { runner: held.runner });
});

test("Clear drops the visitor's own run and leaves every other visitor's", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const b = cookied();
    const aRun = await setup(a, settingsBody(mars));
    await waitFor(() => held.runs[0], "A's run");
    held.runs[0].release();
    assert.equal((await setup(b, quickstartBody(atlasLab))).status, 200);
    await waitFor(() => held.runs[1], "B's run");
    held.runs[1].release();
    await waitFor(async () => (await a.json<Results>('/results')).isComplete && (await b.json<Results>('/results')).isComplete, 'both runs to finish');

    assert.deepEqual(await clearEmpty(a), { cleared: true, runKey: aRun.answer.runKey });
    const aResults = await a.json<Results>('/results');
    assert.equal(aResults.runKey, null);
    assert.deepEqual(aResults.results, []);
    assert.equal((await readReplay(a)).length, 0);

    const bResults = await b.json<Results>('/results');
    assert.equal(bResults.isComplete, true);
    assert.equal(bResults.scenarioId, 'atlas-lab');
    assert.ok((await readReplay(b)).length > 0, "B's run still replays");

    assert.deepEqual(await clearEmpty(a), { cleared: false, reason: 'no_run' });
  }, { runner: held.runner });
});

test('a Clear that names a run the visitor has replaced stops nothing; one that names the current run stops it', async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const run1 = await setup(a, settingsBody(mars));
    await waitFor(() => held.runs[0], 'run 1');
    const run2 = await setup(a, settingsBody(mars));
    await waitFor(() => held.runs[1], 'run 2');

    // The Clear a page posts with the run it held, landing after its next Run.
    assert.deepEqual(await (await a.post('/clear', { runKey: run1.answer.runKey })).json(), { cleared: false, reason: 'not_current' });
    assert.equal(held.runs[1].signal?.aborted, false);

    assert.deepEqual(await (await a.post('/clear', { runKey: run2.answer.runKey })).json(), { cleared: true, runKey: run2.answer.runKey });
    assert.equal(held.runs[1].signal?.aborted, true);
    assert.equal(held.runs[1].signal?.reason, 'user_aborted');
  }, { runner: held.runner });
});

test("Clear tells the visitor's other tabs, and nothing of the stopped run reaches them after", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const run = await setup(a, settingsBody(mars));
    await waitFor(() => held.runs[0], "A's run");
    const tab1 = await openStream(a);
    const tab2 = await openStream(a);
    try {
      assert.deepEqual(await clearEmpty(a), { cleared: true, runKey: run.answer.runKey });
      for (const tab of [tab1, tab2]) {
        const cleared = await tab.next(f => f.event === 'run_cleared', 'run_cleared');
        assert.deepEqual(cleared.data, { runKey: run.answer.runKey });
      }
      await waitFor(() => held.runs[0].settled, 'the stopped run to settle');
      await sleep(50);
      for (const tab of [tab1, tab2]) {
        const live = tab.live();
        const after = live.slice(live.findIndex(f => f.event === 'run_cleared') + 1);
        assert.deepEqual(after, [], 'no frame of the stopped run after run_cleared');
      }
    } finally {
      tab1.close();
      tab2.close();
    }
  }, { runner: held.runner });
});

test('a caller that sends no cookie is the anonymous visitor, whose run a visitor with none of their own watches', async () => {
  const held = heldRun();
  await withVisitors(async ({ base, visitor, cookied }) => {
    const anon = visitor();
    const anonRun = await setup(anon, settingsBody(mars));
    assert.equal(anonRun.status, 200);
    assert.equal(anonRun.answer.visitorId, 'anonymous');
    await waitFor(() => held.runs[0], 'the anonymous run');

    const cookieless = await readReplay(base);
    assert.deepEqual(openings(cookieless).map(f => f.data.runKey), [anonRun.answer.runKey]);

    // The CLI's own run, watched from the browser that opened its dashboard.
    const c = cookied();
    const cReplay = await readReplay(c);
    assert.deepEqual(openings(cReplay).map(f => f.data.runKey), [anonRun.answer.runKey]);
    assert.equal((await c.json<Results>('/results')).runKey, anonRun.answer.runKey);
    // It is not theirs to clear.
    assert.deepEqual(await clearEmpty(c), { cleared: false, reason: 'no_run' });
    assert.equal(held.runs[0].signal?.aborted, false);

    // A visitor with a run of their own sees only theirs.
    const d = cookied();
    const dRun = await setup(d, quickstartBody(atlasLab));
    await waitFor(() => held.runs[1], "D's run");
    assert.deepEqual(openings(await readReplay(d)).map(f => f.data.runKey), [dRun.answer.runKey]);
    assert.equal((await (await fetch(`${base}/results`)).json() as Results).runKey, anonRun.answer.runKey);

    // A cookie that is not a visitor id reads as none.
    const odd = visitor({ [VISITOR_COOKIE]: 'not-a-visitor-id' });
    const oddReplay = await readReplay(odd);
    assert.equal(oddReplay.connected.visitorId, 'anonymous');
    assert.deepEqual(openings(oddReplay).map(f => f.data.runKey), [anonRun.answer.runKey]);

    held.runs[1].release();
  }, { runner: held.runner });
});

test("startWithConfig called directly, the CLI's path, opens the anonymous run, and a cookieless Clear clears it", async () => {
  const held = heldRun();
  await withVisitors(async ({ base, visitor, cookied, server, launches }) => {
    assert.equal((await setup(visitor(), settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[0], 'the first run');
    held.runs[0].release();
    await waitFor(() => held.runs[0].settled, 'the first run to finish');

    void server.startWithConfig(launches[0].config);
    await waitFor(() => held.runs[1], 'the CLI run');
    const cliKey = openings(await readReplay(base)).map(f => f.data.runKey);
    assert.equal(cliKey.length, 1);
    assert.deepEqual(openings(await readReplay(cookied())).map(f => f.data.runKey), cliKey);

    const cleared = await (await fetch(`${base}/clear`, { method: 'POST' })).json() as { cleared: boolean };
    assert.equal(cleared.cleared, true);
    assert.equal(held.runs[1].signal?.reason, 'user_aborted');
    assert.equal((await readReplay(base)).length, 0);
  }, { runner: held.runner });
});

test("a run named by key reads for anyone; another visitor's key reaches neither chat nor clear", async () => {
  const held = heldRun();
  await withVisitors(async ({ base, cookied }) => {
    const b = cookied();
    const bRun = await setup(b, quickstartBody(atlasLab));
    await waitFor(() => held.runs[0], "B's run");
    const key = String(bRun.answer.runKey);

    const byKey = await readReplay(base, `?run=${encodeURIComponent(key)}`);
    assert.equal(byKey.connected.runKey, key);
    assert.deepEqual(openings(byKey).map(f => f.data.runKey), [key]);
    assert.equal((await (await fetch(`${base}/results?run=${encodeURIComponent(key)}`)).json() as Results).runKey, key);

    for (const path of ['/events?run=no-such-run', '/results?run=no-such-run']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), { error: 'Unknown run: no-such-run' });
    }

    const a = cookied();
    const chat = await a.post('/chat', { runKey: key, agentId: 'col-1', message: 'hello' });
    assert.equal(chat.status, 403);
    assert.deepEqual(await chat.json(), { error: 'Not your run' });
    const clear = await a.post('/clear', { runKey: key });
    assert.equal(clear.status, 403);
    assert.deepEqual(await clear.json(), { error: 'Not your run' });
    assert.equal(held.runs[0].signal?.aborted, false);
    assert.deepEqual(openings(await readReplay(b)).map(f => f.data.runKey), [key]);
    held.runs[0].release();
  }, { runner: held.runner });
});

test("the disconnect watchdog stops only the run whose last viewer left", async () => {
  const held = heldRun();
  await withVisitors(async ({ visitor, cookied }) => {
    const a = cookied();
    const b = cookied();
    assert.equal((await setup(a, settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[0], "A's run");
    assert.equal((await setup(b, quickstartBody(atlasLab))).status, 200);
    await waitFor(() => held.runs[1], "B's run");
    const aStream = await openStream(a);
    const bStream = await openStream(b);

    aStream.close();
    await sleep(200);
    assert.equal(held.runs[0].signal?.aborted, true, "A's run stops once A's last stream is gone");
    assert.equal(held.runs[0].signal?.reason, 'client_disconnected');
    assert.equal(held.runs[1].signal?.aborted, false, "B's run goes on while B watches");

    // B reloads: the stream drops and comes back inside the grace.
    bStream.close();
    await sleep(15);
    const bAgain = await openStream(b);
    await sleep(200);
    assert.equal(held.runs[1].signal?.aborted, false, "B's run goes on through B's reload");
    bAgain.close();

    // A run nobody ever watched is never stopped by the watchdog.
    assert.equal((await setup(visitor(), settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[2], 'the unwatched run');
    await sleep(200);
    assert.equal(held.runs[2].signal?.aborted, false);
    held.runs[2].release();
  }, { runner: held.runner, disconnectGraceMs: 50 });
});

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

const forkBody = () => ({
  actors: [atlasLab.presets[0].leaders[0]],
  turns: 6,
  seed: 11,
  captureSnapshots: true,
  forkFrom: { parentArtifact: atlasParent(), atTurn: 1 },
});

test("a fork is refused only while the visitor's own run is in flight", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied, forkLaunches }) => {
    const a = cookied();
    const b = cookied();
    assert.equal((await setup(a, quickstartBody(atlasLab))).status, 200);
    await waitFor(() => held.runs[0], "A's run");
    held.runs[0].release();
    await waitFor(() => held.runs[0].settled, "A's run to finish");
    assert.equal((await setup(b, settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[1], "B's run");

    const fork = await setup(a, forkBody());
    assert.equal(fork.status, 200, `A's fork while B runs: ${JSON.stringify(fork.answer)}`);
    const launched = await waitFor(() => forkLaunches[0], 'the fork');
    assert.equal(launched.scenario?.id, 'atlas-lab');
    const opening = openings(await readReplay(a))[0];
    assert.deepEqual(opening?.data.forkedFrom, { parentRunId: 'parent-1', atTurn: 1 });
    assert.equal(opening?.data.kind, 'fork');

    // With a run of A's own in flight, the same fork is refused.
    assert.equal((await setup(a, quickstartBody(atlasLab))).status, 200);
    await waitFor(() => held.runs[2], "A's second run");
    assert.equal((await setup(a, forkBody())).status, 409);
    held.runs[1].release();
    held.runs[2].release();
  }, { runner: held.runner });
});

test('a finished run survives a restart for its visitor, and a run the restart cut ends as interrupted', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-run-restart-'));
  const runFile = (key: string) => join(appDir, '.live-runs', `${key}.json`);
  try {
    const held = heldRun();
    const first = await startServer({ appDir, runner: held.runner });
    const a = first.cookied();
    const c = first.cookied();
    let aKey = '';
    let cKey = '';
    try {
      aKey = String((await setup(a, settingsBody(mars))).answer.runKey);
      await waitFor(() => held.runs[0], "A's run");
      held.runs[0].release();
      await waitFor(() => existsSync(runFile(aKey)) && readFileSync(runFile(aKey), 'utf-8').includes('event: complete'), "A's run on disk", 3000);

      cKey = String((await setup(c, quickstartBody(atlasLab))).answer.runKey);
      await waitFor(() => held.runs[1], "C's run");
      await waitFor(() => existsSync(runFile(cKey)) && readFileSync(runFile(cKey), 'utf-8').includes('turn_start'), "C's run on disk", 3000);
    } finally {
      await first.close();
    }
    // A buffer the old server wrote names no visitor, so it is never replayed.
    writeFileSync(join(appDir, '.event-buffer.json'), JSON.stringify(['event: result\ndata: {"leader":"Old Leader"}\n\n']));

    const second = await startServer({ appDir });
    try {
      const aBack = second.visitor({ [VISITOR_COOKIE]: String(a.cookies.get(VISITOR_COOKIE)) });
      const aReplay = await readReplay(aBack);
      assert.deepEqual(openings(aReplay).map(f => f.data.runKey), [aKey]);
      assert.equal(aReplay.filter(f => f.event === 'result').length, 2);
      assert.equal((await aBack.json<Results>('/results')).isComplete, true);

      assert.equal((await readReplay(second.cookied())).length, 0, 'another visitor gets nothing');
      assert.equal((await readReplay(second.base)).length, 0, 'the old buffer replays to nobody');
      assert.equal(existsSync(join(appDir, '.event-buffer.json')), false);

      const cBack = second.visitor({ [VISITOR_COOKIE]: String(c.cookies.get(VISITOR_COOKIE)) });
      const cReplay = await readReplay(cBack);
      const [aborted, end] = cReplay.slice(-2);
      assert.equal(aborted.event, 'sim');
      assert.equal(aborted.data.type, 'sim_aborted');
      assert.equal((aborted.data.data as { reason?: string }).reason, 'server_restarted');
      assert.equal(end.event, 'complete');
      assert.equal(end.data.aborted, true);
      assert.equal((await cBack.json<Results>('/results')).isComplete, true);
      assert.ok(readFileSync(runFile(cKey), 'utf-8').includes('server_restarted'));
    } finally {
      await second.close();
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a finished run someone keeps reading survives a restart; one nobody read goes', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-run-fresh-'));
  try {
    const held = heldRun();
    const first = await startServer({ appDir, runner: held.runner, staleBufferMs: 150 });
    const d = first.cookied();
    const e = first.cookied();
    try {
      assert.equal((await setup(d, settingsBody(mars))).status, 200);
      assert.equal((await setup(e, quickstartBody(atlasLab))).status, 200);
      await waitFor(() => held.runs[1], 'both runs');
      held.runs[0].release();
      held.runs[1].release();
      await waitFor(() => held.runs[0].settled && held.runs[1].settled, 'both runs to finish');
      const until = Date.now() + 250;
      while (Date.now() < until) {
        assert.equal((await d.json<Results>('/results')).isComplete, true);
        await sleep(30);
      }
    } finally {
      await first.close();
    }

    const second = await startServer({ appDir, staleBufferMs: 150 });
    try {
      const dBack = second.visitor({ [VISITOR_COOKIE]: String(d.cookies.get(VISITOR_COOKIE)) });
      const eBack = second.visitor({ [VISITOR_COOKIE]: String(e.cookies.get(VISITOR_COOKIE)) });
      assert.equal((await dBack.json<Results>('/results')).isComplete, true, "D's run is held");
      assert.equal((await eBack.json<Results>('/results')).runKey, null, "E's run is gone");
    } finally {
      await second.close();
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a finished run nobody reads or watches goes after the idle time, with its file', async () => {
  const held = heldRun();
  await withVisitors(async ({ base, cookied, appDir }) => {
    const a = cookied();
    const run = await setup(a, settingsBody(mars));
    await waitFor(() => held.runs[0], "A's run");
    const stream = await openStream(a);
    held.runs[0].release();
    await stream.next(f => f.event === 'complete', "A's complete");
    const file = join(appDir, '.live-runs', `${run.answer.runKey}.json`);
    await waitFor(() => existsSync(file), "A's run on disk", 3000);
    stream.close();
    await sleep(100);

    const results = await a.json<Results>('/results');
    assert.equal(results.runKey, null);
    assert.deepEqual(results.results, []);
    const health = await (await fetch(`${base}/health`)).json() as { runsHeld?: number };
    assert.equal(health.runsHeld, 0);
    assert.equal(existsSync(file), false);
  }, { runner: held.runner, staleBufferMs: 50 });
});

test('the held-run caps let the oldest finished runs go first', async () => {
  const finishRun = async (v: Visitor, held: ReturnType<typeof heldRun>, index: number) => {
    assert.equal((await setup(v, settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[index], `run ${index}`);
    held.runs[index].release();
    await waitFor(() => held.runs[index].settled, `run ${index} to finish`);
    await sleep(20);
  };

  const byCount = heldRun();
  await withVisitors(async ({ cookied }) => {
    const visitors = [cookied(), cookied(), cookied()];
    for (const [i, v] of visitors.entries()) await finishRun(v, byCount, i);
    assert.equal((await visitors[0].json<Results>('/results')).runKey, null, 'the oldest run is gone');
    assert.equal((await visitors[1].json<Results>('/results')).isComplete, true);
    assert.equal((await visitors[2].json<Results>('/results')).isComplete, true);
  }, { runner: byCount.runner, maxHeldRuns: 2 });

  const byBytes = heldRun();
  await withVisitors(async ({ cookied }) => {
    const older = cookied();
    const newer = cookied();
    await finishRun(older, byBytes, 0);
    await finishRun(newer, byBytes, 1);
    assert.equal((await older.json<Results>('/results')).runKey, null, 'the older run is gone');
    assert.equal((await newer.json<Results>('/results')).isComplete, true);
  }, { runner: byBytes.runner, maxHeldRunBytes: 1800 });
});

test("chat reads the caller's own run: a visitor with none is told there is no simulation", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const b = cookied();
    assert.equal((await setup(a, settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[0], "A's run");
    held.runs[0].release();
    await waitFor(() => held.runs[0].settled, "A's run to finish");

    const bChat = await b.post('/chat', { agentId: 'col-1', message: 'hello' });
    assert.equal(bChat.status, 400);
    assert.match((await bChat.json() as { error: string }).error, /no simulation in memory/);

    assert.equal((await clearEmpty(a)).cleared, true);
    const aChat = await a.post('/chat', { agentId: 'col-1', message: 'hello' });
    assert.equal(aChat.status, 400);
    assert.match((await aChat.json() as { error: string }).error, /no simulation in memory/);
  }, { runner: held.runner });
});

test("a pair run's chat speaks for one leader's character, with that leader's memories", async () => {
  // Both leaders' colonies hold the same people. Lena Ortiz reacted under
  // each leader; the chat mixed her two lives into one agent.
  const calls: Array<{ memories: Array<{ text: string }>; profile: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const reaction = (mood: string, quote: string) => ({ agentId: 'col-shared', name: 'Lena Ortiz', role: 'Botanist', department: 'agriculture', age: 34, mood, quote });
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const run = await setup(a, settingsBody(mars));
    await waitFor(async () => (await a.json<Results>('/results')).isComplete, "A's run to finish");

    const chat = async (leader?: string) => {
      const res = await a.post('/chat', { agentId: 'col-shared', message: 'How was the year?', ...(leader ? { leader } : {}) });
      assert.equal(res.status, 200, `chat as ${leader}: ${res.status} ${await res.clone().text()}`);
      return calls[calls.length - 1];
    };

    const voss = await chat('Dietrich Voss');
    assert.equal(voss.profile.name, 'Lena Ortiz');
    assert.ok(voss.memories.some(m => m.text.includes('furious')), 'her life under Voss');
    assert.ok(!voss.memories.some(m => m.text.includes('hopeful')), 'none of her life under Chen');
    assert.equal(voss.opts.leader, 'Dietrich Voss');
    assert.equal(voss.opts.runKey, run.answer.runKey);

    const chen = await chat('Aria Chen');
    assert.ok(chen.memories.some(m => m.text.includes('hopeful')));
    assert.ok(!chen.memories.some(m => m.text.includes('furious')));
    assert.equal(chen.opts.leader, 'Aria Chen');

    // A chat that names no leader still speaks for one of them.
    const unnamed = await chat();
    const lives = ['hopeful', 'furious'].filter(mood => unnamed.memories.some(m => m.text.includes(mood)));
    assert.equal(lives.length, 1, `one leader's memories, got ${lives.join(' and ')}`);
  }, {
    runner: async (_config, broadcast) => {
      broadcast('sim', { type: 'agent_reactions', leader: 'Aria Chen', data: { turn: 1, time: 2035, reactions: [reaction('hopeful', 'Aria kept us fed.')] } }, 'Aria Chen');
      broadcast('sim', { type: 'agent_reactions', leader: 'Dietrich Voss', data: { turn: 1, time: 2035, reactions: [reaction('furious', 'Voss rationed the water.')] } }, 'Dietrich Voss');
      broadcast('complete', {});
    },
    extra: {
      chatAgent: async (profile: Record<string, unknown>, memories: Array<{ text: string }>, opts: Record<string, unknown>) => {
        calls.push({ profile, memories, opts });
        return { session: { send: async () => ({ text: 'The year was long.', usage: {} }) }, isNew: true };
      },
    },
  });
});

test("a compile drops only the caller's finished run and stops no run", async () => {
  const held = heldRun();
  await withVisitors(async ({ cookied }) => {
    const a = cookied();
    const b = cookied();
    assert.equal((await setup(a, settingsBody(mars))).status, 200);
    await waitFor(() => held.runs[0], "A's run");
    held.runs[0].release();
    await waitFor(async () => (await a.json<Results>('/results')).isComplete, "A's run to finish");
    assert.equal((await setup(b, quickstartBody(atlasLab))).status, 200);
    await waitFor(() => held.runs[1], "B's run");

    const c = cookied();
    assert.equal((await c.post('/api/quickstart/compile-from-seed', { seedText: 'x' })).status, 400);
    assert.equal((await a.json<Results>('/results')).isComplete, true, "C's compile leaves A's run");
    assert.equal((await b.json<Results>('/results')).inFlight, true, "C's compile leaves B's run");

    assert.equal((await a.post('/api/quickstart/compile-from-seed', { seedText: 'x' })).status, 400);
    assert.equal((await a.json<Results>('/results')).runKey, null, "A's compile drops A's finished run");
    assert.equal((await b.json<Results>('/results')).inFlight, true);
    assert.equal(held.runs[1].signal?.aborted, false);
    held.runs[1].release();
  }, { runner: held.runner });
});

test('the dashboard HTML gives a browser its visitor id once; per-visitor answers are never cached', async () => {
  await withVisitors(async ({ visitor }) => {
    const v = visitor();
    const first = await v.get('/sim');
    assert.equal(first.status, 200, 'the dashboard build is present (CI builds it before npm test)');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const cookie = first.headers.getSetCookie().find(line => line.startsWith(`${VISITOR_COOKIE}=`));
    assert.ok(cookie, `no ${VISITOR_COOKIE} cookie: ${first.headers.getSetCookie().join(' | ')}`);
    const [pair, ...attributes] = cookie.split(';').map(part => part.trim());
    assert.match(pair.slice(VISITOR_COOKIE.length + 1), UUID);
    for (const attribute of ['Path=/', 'Max-Age=2592000', 'SameSite=Lax', 'HttpOnly']) {
      assert.ok(attributes.includes(attribute), `${attribute} in ${cookie}`);
    }
    assert.ok(!attributes.includes('Secure'), 'a local server answers plain HTTP');

    const again = await v.get('/sim');
    assert.equal(again.headers.getSetCookie().some(line => line.startsWith(`${VISITOR_COOKIE}=`)), false);

    const results = await v.get('/results');
    assert.equal(results.headers.get('cache-control'), 'no-store');
    assert.equal(results.headers.get('vary'), 'Cookie');
  });
});
