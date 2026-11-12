/**
 * Bounds on what one caller can make the server hold, write or log.
 *
 * - A session replay writes as fast as the reader reads, and one address
 *   holds a bounded number of open event streams; a reader that leaves
 *   before its replay starts holds none.
 * - The run-history routes read a bounded body.
 * - A library import writes a compact copy, and one address imports a
 *   bounded number of new runs a day, told to retry at the next UTC
 *   midnight past it.
 * - One address holds at most all but one of the server's run slots.
 * - /results answers a run whose buffer has not changed without reading
 *   the buffer again.
 * - A log line shows request text on one line.
 * - The hook cache answers a scenario only with hooks written for that
 *   scenario.
 *
 * Each server test goes through createMarsServer over HTTP; only the
 * runner, the compiler and the stores are stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer, type CreateMarsServerOptions } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import type { SessionStore } from '../../src/server/stores/session.js';
import { readCache, writeCache } from '../../src/engine/compiler/cache.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';

const mars = JSON.parse(readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf-8')) as {
  presets: Array<{ leaders: Array<Record<string, unknown>> }>;
};
const turnLoopArtifact = JSON.parse(
  readFileSync(new URL('../fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf-8'),
) as { metadata: Record<string, unknown> };

const NO_HOST_KEYS = {
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  SERPER_API_KEY: '',
  FIRECRAWL_API_KEY: '',
  TAVILY_API_KEY: '',
  BRAVE_API_KEY: '',
  COHERE_API_KEY: '',
  PARACOSM_CLIENT_IP_HEADER: '',
};

type Served = { base: string; port: number; responses: ServerResponse[]; runsDir: string };

async function withServer(
  options: Partial<CreateMarsServerOptions> & { env?: Record<string, string> },
  run: (served: Served) => Promise<void>,
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-request-bounds-'));
  const runsDir = join(appDir, 'runs');
  const server = createMarsServer({
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async () => {},
    ...options,
    env: {
      ...process.env,
      ...NO_HOST_KEYS,
      APP_DIR: appDir,
      PARACOSM_OUTPUT_DIR: runsDir,
      PARACOSM_HOSTED_DEMO: '',
      ...options.env,
    },
  });
  const responses: ServerResponse[] = [];
  server.on('request', (_req, res) => { responses.push(res); });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  try {
    await run({ base: `http://127.0.0.1:${port}`, port, responses, runsDir });
  } finally {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
}

const post = (base: string, path: string, payload: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A session store holding one large session. */
function largeSessionStore(events: number, frameBytes: number): SessionStore {
  const frame = `event: sim\ndata: ${JSON.stringify({ type: 'turn_done', pad: 'p'.repeat(frameBytes) })}\n\n`;
  const meta = { id: 'big', createdAt: 0, eventCount: events } as unknown;
  return {
    saveSession: async () => ({ id: 'big' }),
    listSessions: async () => [meta] as never,
    getSession: async (id: string) => id === 'big'
      ? { meta, events: Array.from({ length: events }, (_, i) => ({ ts: i, sse: frame })) } as never
      : null,
    count: async () => 1,
    updateTitle: async () => {},
  } as unknown as SessionStore;
}

test('a session replay to a reader that does not read holds a bounded amount of the session', async () => {
  // 2,000 frames of about 32 KB: about 64 MB.
  await withServer({ sessionStore: largeSessionStore(2000, 32 * 1024) }, async ({ port, responses }) => {
    const socket = connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write('GET /sessions/big/replay HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    socket.pause();
    try {
      await sleep(1500);
      const replay = responses.find(res => res.req.url === '/sessions/big/replay');
      assert.ok(replay, 'the replay request reached the server');
      assert.ok(replay.writableLength < 16 * 1024 * 1024, `${replay.writableLength} bytes held for the reader`);
    } finally {
      socket.destroy();
    }
  });
});

test('one address holds a bounded number of open event streams', async () => {
  await withServer({}, async ({ base }) => {
    const controllers: AbortController[] = [];
    const statuses: number[] = [];
    try {
      for (let i = 0; i < 40; i++) {
        const controller = new AbortController();
        controllers.push(controller);
        const res = await fetch(`${base}/events`, { signal: controller.signal });
        statuses.push(res.status);
        if (res.status !== 200) await res.text();
      }
    } finally {
      for (const controller of controllers) controller.abort();
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(', ')}`);
    assert.equal(statuses[0], 200);
  });
});

test('a replay result body over the size limit is refused before it is read in full', async () => {
  await withServer({}, async ({ base }) => {
    const res = await post(base, '/api/v1/runs/r-cap/replay-result', { matches: true, pad: 'x'.repeat(65536) });
    await res.text();
    assert.equal(res.status, 413);
  });
});

function freshArtifact(extra: Record<string, unknown> = {}) {
  return { ...turnLoopArtifact, metadata: { ...turnLoopArtifact.metadata, runId: `run-${randomUUID()}` }, ...extra };
}

function nested(depth: number, inner: number): unknown {
  let value: unknown = new Array(inner).fill(0);
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

test('a library import writes a copy about the size of what it was sent', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  await withServer({ runHistoryStore: store }, async ({ base, runsDir }) => {
    const body = JSON.stringify({ artifact: freshArtifact({ x: nested(40, 200_000) }) });
    const res = await post(base, '/api/v1/library/import', body);
    assert.equal(res.status, 201, await res.text());
    const copies = readdirSync(runsDir).filter(name => name.startsWith('v3-imported-'));
    assert.equal(copies.length, 1);
    const size = statSync(join(runsDir, copies[0])).size;
    assert.ok(size <= 2 * body.length, `a ${body.length} byte body wrote ${size} bytes`);
  });
});

test('one address imports a bounded number of new runs a day', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  await withServer({ runHistoryStore: store, env: { PARACOSM_IMPORTS_PER_DAY: '2' } }, async ({ base, runsDir }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await post(base, '/api/v1/library/import', { artifact: freshArtifact() });
      await res.text();
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [201, 201, 429]);
    assert.equal(readdirSync(runsDir).filter(name => name.startsWith('v3-imported-')).length, 2);
  });
});

test('one address with its own key cannot hold every run slot', async () => {
  const releases: Array<() => void> = [];
  const runner = async () => { await new Promise<void>(resolve => { releases.push(resolve); }); };
  try {
    await withServer({
      maxRuns: 3,
      maxSimsPerDay: 10,
      runPairSimulations: runner,
      env: { PARACOSM_CLIENT_IP_HEADER: 'cf-connecting-ip' },
    }, async ({ base }) => {
      const body = (extra: Record<string, unknown> = {}) => ({ actors: mars.presets[0].leaders, turns: 1, scenarioId: 'mars-genesis', ...extra });
      for (let i = 0; i < 3; i++) {
        const res = await post(base, '/setup', body({ apiKey: 'sk-test' }), {
          cookie: `paracosm_visitor=${randomUUID()}`,
          'cf-connecting-ip': '198.51.100.7',
        });
        await res.text();
      }
      const other = await post(base, '/setup', body(), {
        cookie: `paracosm_visitor=${randomUUID()}`,
        'cf-connecting-ip': '198.51.100.8',
      });
      const text = await other.text();
      assert.equal(other.status, 200, text);
    });
  } finally {
    for (const release of releases) release();
  }
});

test('/results for a run whose buffer has not changed does not parse the buffer again', async () => {
  const runner = async (_config: unknown, broadcast: (event: string, data: unknown) => void) => {
    for (let i = 0; i < 2000; i++) broadcast('sim', { type: 'turn_done', leader: 'A', data: { turn: 1, i } });
    broadcast('complete', {});
  };
  await withServer({ runPairSimulations: runner as CreateMarsServerOptions['runPairSimulations'] }, async ({ base }) => {
    const cookie = `paracosm_visitor=${randomUUID()}`;
    const res = await post(base, '/setup', { actors: mars.presets[0].leaders, turns: 1, scenarioId: 'mars-genesis' }, { cookie });
    assert.equal(res.status, 200, await res.text());
    const deadline = Date.now() + 5000;
    for (;;) {
      const results = await (await fetch(`${base}/results`, { headers: { cookie } })).json() as { isComplete: boolean };
      if (results.isComplete) break;
      assert.ok(Date.now() < deadline, 'the run finishes');
      await sleep(50);
    }
    // The save status lands after the run's end; then the buffer stays.
    await sleep(500);
    await (await fetch(`${base}/results`, { headers: { cookie } })).text();
    const original = JSON.parse;
    let parses = 0;
    JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      parses += 1;
      return original(text, reviver);
    }) as typeof JSON.parse;
    try {
      const again = await fetch(`${base}/results`, { headers: { cookie } });
      assert.equal(again.status, 200);
      await again.text();
    } finally {
      JSON.parse = original;
    }
    assert.ok(parses < 50, `${parses} parses for an unchanged run`);
  });
});

test('a scenario name with a line break stays on one log line', async () => {
  const forged = '  [rate-limit] Bypassed (forged line)';
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await withServer({
      maxSimsPerDay: 10,
      compileScenario: async () => ({ ...marsScenario, id: 'forge-a', labels: { ...marsScenario.labels, name: `x\n${forged}` } }) as never,
    }, async ({ base }) => {
      const compiled = await post(base, '/compile', { scenario: { id: 'forge-a', labels: { name: `x\n${forged}` }, departments: [] } });
      await compiled.text();
      const res = await post(base, '/setup', { scenarioId: 'forge-a', actors: mars.presets[0].leaders, turns: 1 });
      await res.text();
      await sleep(200);
    });
  } finally {
    console.log = original;
  }
  const physical = lines.flatMap(line => line.split('\n'));
  assert.ok(!physical.some(line => line.startsWith(forged)), 'no log line starts with the forged text');
});

test('the hook cache answers a scenario only with hooks written for that scenario', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-hook-cache-'));
  try {
    const a = { id: 'same-id', version: '1.0.0', labels: { name: 'A' } };
    const b = { id: 'same-id', version: '1.0.0', labels: { name: 'B' } };
    writeCache(b, 'progression', 'export const b = 1;', 'm', dir);
    writeCache(a, 'progression', 'export const a = 1;', 'm', dir);
    writeCache(b, 'reactions', 'export const r = 1;', 'm', dir);
    assert.equal(readCache(b, 'progression', 'm', dir), null);
    assert.equal(readCache(b, 'reactions', 'm', dir), 'export const r = 1;');

    writeCache(a, 'progression', 'export const a = 2;', 'm', dir);
    writeCache(b, 'director', 'prose', 'm', dir);
    assert.equal(readCache(b, 'progression', 'm', dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a replay whose reader left while the session loaded holds no stream slot', async () => {
  const frame = `event: sim\ndata: ${JSON.stringify({ type: 'turn_done' })}\n\n`;
  const meta = { id: 'slow', createdAt: 0, eventCount: 1 } as unknown;
  const slowStore = {
    saveSession: async () => ({ id: 'slow' }),
    listSessions: async () => [meta] as never,
    getSession: async (id: string) => {
      await sleep(300);
      return id === 'slow' ? { meta, events: [{ ts: 0, sse: frame }] } as never : null;
    },
    count: async () => 1,
    updateTitle: async () => {},
  } as unknown as SessionStore;
  await withServer({ sessionStore: slowStore, env: { PARACOSM_MAX_STREAMS_PER_ADDRESS: '2' } }, async ({ base, port }) => {
    // Three readers ask for the replay and close their connections while
    // the session is still loading.
    for (let i = 0; i < 3; i++) {
      const socket = connect(port, '127.0.0.1');
      await once(socket, 'connect');
      socket.write('GET /sessions/slow/replay HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      await sleep(50);
      socket.destroy();
    }
    await sleep(700);
    const res = await fetch(`${base}/sessions/slow/replay`);
    const text = await res.text();
    assert.equal(res.status, 200, text.slice(0, 200));
  });
});

test('an import past the daily limit is told to retry at the next UTC midnight', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  await withServer({ runHistoryStore: store, env: { PARACOSM_IMPORTS_PER_DAY: '1' } }, async ({ base }) => {
    const first = await post(base, '/api/v1/library/import', { artifact: freshArtifact() });
    await first.text();
    assert.equal(first.status, 201);
    const second = await post(base, '/api/v1/library/import', { artifact: freshArtifact() });
    await second.text();
    assert.equal(second.status, 429);
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    const untilMidnight = Math.ceil((midnight.getTime() - Date.now()) / 1000);
    const retryAfter = Number(second.headers.get('retry-after'));
    assert.ok(Math.abs(retryAfter - untilMidnight) <= 5, `Retry-After ${retryAfter}, ${untilMidnight} s to midnight`);
  });
});
