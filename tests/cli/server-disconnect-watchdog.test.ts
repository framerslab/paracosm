/**
 * Cancel-on-disconnect watchdog, through the real server: POST /setup
 * starts a run (the pair runner stubbed so no model is called), a real
 * /events stream connects and leaves, and the run's AbortSignal shows
 * whether the watchdog stopped it. setTimeout is mocked only after the
 * stream is open, so the server's own timer is the one the test
 * advances; the grace is the server's default, not an injected value.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarsServer } from '../../src/server/server-app.js';

const hexaco = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 };
const setupBody = {
  actors: [
    { name: 'Aria Chen', archetype: 'The Visionary', colony: 'Ares Horizon', hexaco, instructions: 'Leader A' },
    { name: 'Dietrich Voss', archetype: 'The Engineer', colony: 'Meridian Base', hexaco, instructions: 'Leader B' },
  ],
  provider: 'anthropic',
  turns: 1,
  startTime: 2042,
  population: 110,
  activeDepartments: ['medical', 'engineering', 'governance'],
  execution: { commanderMaxSteps: 7, departmentMaxSteps: 11, sandboxTimeoutMs: 15000, sandboxMemoryMB: 256 },
  models: { commander: 'gpt-5.4', departments: 'gpt-5.4-mini', judge: 'gpt-5.4' },
};

/** Spin on setImmediate (not mocked) until `pred` holds, up to 5 s of real time. */
async function waitUntil(pred: () => boolean, label: string) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setImmediate(r));
  }
}

async function startRun(t: TestContext) {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-watchdog-'));
  let runSignal: AbortSignal | null = null;
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir },
    maxSimsPerDay: 0,
    runPairSimulations: async (_config: unknown, _broadcast: unknown, signal: AbortSignal) => {
      runSignal = signal;
      await new Promise(r => signal.addEventListener('abort', r, { once: true }));
    },
  } as any);
  server.listen(0);
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const streams: AbortController[] = [];
  const delays: number[] = [];
  let mockedSetTimeout: typeof setTimeout | null = null;

  t.after(async () => {
    if (mockedSetTimeout) globalThis.setTimeout = mockedSetTimeout;
    t.mock.timers.reset();
    for (const s of streams) s.abort();
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  });

  const setupRes = await fetch(`http://127.0.0.1:${port}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setupBody),
  });
  assert.ok(setupRes.ok, `setup failed: ${setupRes.status} ${await setupRes.text()}`);
  await waitUntil(() => runSignal !== null, 'the run to start');

  /** Open /events and read until the replay is done (the server has registered the client by then). */
  const connect = async () => {
    const ac = new AbortController();
    streams.push(ac);
    const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: ac.signal });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: replay_done')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    assert.ok(text.includes('event: replay_done'), `no replay_done: ${text}`);
    return () => { ac.abort(); };
  };

  /** From here on the server's setTimeout calls are mocked and their delays recorded. */
  const mockTimers = () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const mocked = globalThis.setTimeout;
    mockedSetTimeout = mocked;
    globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      delays.push(ms ?? 0);
      return mocked(fn, ms, ...rest);
    }) as typeof setTimeout;
  };

  /**
   * Times the watchdog has armed: setTimeout calls of 30 s or more. The
   * server's only other timer is its 500 ms buffer persist, and the
   * fetch client's own timers run at a second or less.
   */
  const watchdogArms = () => delays.filter(d => d >= 30_000).length;

  return { signal: () => runSignal!, connect, mockTimers, delays, watchdogArms };
}

test('a run with no viewer for 60 s keeps going, and stops once the 10 minute grace passes', async (t) => {
  const run = await startRun(t);
  const leave = await run.connect();
  run.mockTimers();
  leave();
  await waitUntil(() => run.watchdogArms() > 0, 'the watchdog to arm');

  t.mock.timers.tick(60_000);
  assert.equal(run.signal().aborted, false, `aborted after 60 s with the grace armed at ${run.delays.join(', ')} ms`);

  t.mock.timers.tick(9 * 60_000 - 1);
  assert.equal(run.signal().aborted, false, 'aborted before the grace ran out');

  t.mock.timers.tick(1);
  assert.equal(run.signal().aborted, true, 'still running 10 minutes after the viewer left');
});

test('a viewer who comes back inside the grace clears the timer; leaving again starts a new grace', async (t) => {
  const run = await startRun(t);
  const leave = await run.connect();
  run.mockTimers();
  leave();
  await waitUntil(() => run.watchdogArms() > 0, 'the watchdog to arm');

  t.mock.timers.tick(5 * 60_000);
  assert.equal(run.signal().aborted, false);

  // Back at 5 minutes, gone again at 6.
  const leaveAgain = await run.connect();
  t.mock.timers.tick(60_000);
  assert.equal(run.signal().aborted, false, 'the watchdog fired although the viewer came back');
  const armed = run.watchdogArms();
  leaveAgain();
  await waitUntil(() => run.watchdogArms() > armed, 'the watchdog to re-arm');

  // 10 minutes after the first leave: the first timer, had the
  // reconnect not cleared it, would fire here.
  t.mock.timers.tick(4 * 60_000 + 1);
  assert.equal(run.signal().aborted, false, 'the first grace still ran after the viewer came back');

  // 10 minutes after the second leave.
  t.mock.timers.tick(6 * 60_000 - 1);
  assert.equal(run.signal().aborted, true, 'the run kept going after the viewer left a second time');
});

test('closing the server does not keep the process alive for the rest of the grace', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-watchdog-exit-'));
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  // Without the test runner's marker, so the child runs as a plain script.
  const { NODE_TEST_CONTEXT: _testContext, ...childEnv } = process.env;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--import', './scripts/test-css-stub.mjs', fileURLToPath(new URL('./fixtures/server-close-after-leave.ts', import.meta.url))],
    { cwd: repoRoot, env: { ...childEnv, APP_DIR: appDir }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  // The grace is 10 minutes; a process the watchdog holds is still up at 60 s.
  const kill = setTimeout(() => child.kill('SIGKILL'), 60_000);
  try {
    // 'close' comes after the child's stdout and stderr have ended, so
    // `output` holds everything it printed; 'exit' can come before that.
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null];
    assert.ok(output.includes('fixture: server closed'), `the child did not reach server.close(): ${output}`);
    assert.equal(signal, null, `the process was still running 60 s after it started, held by the watchdog timer: ${output}`);
    assert.equal(code, 0, output);
  } finally {
    clearTimeout(kill);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(appDir, { recursive: true, force: true });
  }
});
