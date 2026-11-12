/**
 * Limits on the routes that spend the host's model and search keys or fetch
 * a URL the request names.
 *
 * - The Quickstart routes on the hosted demo count against the caller's
 *   daily limits: compile-from-seed against the compile limit, the
 *   grounding, actor and URL routes against a Quickstart limit of their own,
 *   and a Digital Twin run against the day's run limit, on the economy tier.
 * - The hosted demo's run caps bound the leaders, key personnel, custom
 *   events and instructions a run takes.
 * - The rate limiter keys a caller on the connection's address unless the
 *   server is told which proxy header to trust, and reading a limit adds
 *   no entry.
 * - A URL the request names is fetched only from a public address, with a
 *   bounded body, and its markup is stripped in linear time.
 * - /compile on the hosted demo bounds the searches a compile runs.
 *
 * Each server test goes through createMarsServer over HTTP. Only the
 * engine, the compiler and the Digital Twin world are stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer, type CreateMarsServerOptions } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import { IpRateLimiter } from '../../src/server/rate-limiter.js';
import { applyDemoCaps, normalizeSimulationConfig } from '../../src/cli/sim-config.js';
import { fetchSeedFromUrl, type WebSearchModule } from '../../src/cli/fetch-seed-url.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { WorldModel } from '../../src/runtime/world-model/index.js';

const mars = JSON.parse(readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf-8')) as {
  presets: Array<{ leaders: Array<Record<string, unknown>> }>;
};
const twinScenario = JSON.parse(readFileSync(new URL('../../scenarios/t2d-glp1-protocol.json', import.meta.url), 'utf-8')) as { id: string };

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

async function withServer(
  options: Partial<CreateMarsServerOptions> & { env?: Record<string, string> },
  run: (base: string) => Promise<void>,
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-server-limits-'));
  const server = createMarsServer({
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async () => {},
    ...options,
    env: { ...process.env, ...NO_HOST_KEYS, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '', ...options.env },
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

const post = (base: string, path: string, payload: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

const brief = (n: number) => `${'A coastal town weighs a seawall against managed retreat as storms worsen, with fishing, tourism and insurance at stake for every household. '.repeat(2)} Variant ${n}.`;

test('compile-from-seed on the hosted demo counts against the daily compile limit', async () => {
  await withServer({ maxSimsPerDay: 1, env: { PARACOSM_HOSTED_DEMO: 'true' } }, async base => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(base, '/api/quickstart/compile-from-seed', { seedText: brief(i) });
      await res.text();
      statuses.push(res.status);
    }
    const started = statuses.filter(status => status === 202).length;
    assert.ok(started <= 5, `at most five compiles a day start, got ${statuses.join(', ')}`);
    assert.ok(statuses.every(status => status === 202 || status === 429 || status === 503), statuses.join(', '));
  });
});

test('ground-scenario on the hosted demo has a daily limit per caller', async () => {
  await withServer({ maxSimsPerDay: 1, env: { PARACOSM_HOSTED_DEMO: 'true' } }, async base => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await post(base, '/api/quickstart/ground-scenario', { scenarioId: 'mars-genesis' });
      await res.text();
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(', ')}`);
  });
});

const twinBody = (extra: Record<string, unknown> = {}) => ({
  subject: { id: 's', name: 'S' },
  intervention: { id: 'i', name: 'I', description: 'd' },
  options: { maxTurns: 6, costPreset: 'quality' },
  ...extra,
});

test('a Digital Twin run on the hosted demo takes the day\'s run and runs on the economy tier', async () => {
  const presets: unknown[] = [];
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const intervene = async (opts: { costPreset?: unknown }) => {
    presets.push(opts.costPreset);
    await released;
    return { metadata: {} };
  };
  await withServer({
    maxSimsPerDay: 1,
    env: { PARACOSM_HOSTED_DEMO: 'true' },
    getDigitalTwinWorld: async () => ({ scenario: twinScenario, intervene }) as unknown as WorldModel,
  }, async base => {
    const pending = [0, 1, 2].map(() => post(base, '/api/quickstart/simulate-intervention', twinBody()));
    const deadline = Date.now() + 3000;
    while (presets.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 300));
    release();
    const statuses = await Promise.all(pending.map(async p => { const res = await p; await res.text(); return res.status; }));
    assert.equal(statuses.filter(status => status === 200).length, 1, statuses.join(', '));
    assert.equal(statuses.filter(status => status === 429).length, 2, statuses.join(', '));
    assert.deepEqual(presets, ['economy']);
  });
});

test('a Digital Twin request with leader instructions over 400 characters is refused', async () => {
  let runs = 0;
  await withServer({
    maxSimsPerDay: 0,
    getDigitalTwinWorld: async () => ({ scenario: twinScenario, intervene: async () => { runs += 1; return { metadata: {} }; } }) as unknown as WorldModel,
  }, async base => {
    const leader = {
      name: 'L', archetype: 'A',
      hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
      instructions: 'x'.repeat(5000),
    };
    const res = await post(base, '/api/quickstart/simulate-intervention', twinBody({ leader, options: { maxTurns: 1 } }));
    await res.text();
    assert.equal(res.status, 400);
    assert.equal(runs, 0);
  });
});

test('the hosted demo caps bound leaders, key personnel, custom events and instructions', () => {
  const leader = mars.presets[0].leaders[0];
  const actors = Array.from({ length: 300 }, (_, i) => ({ ...leader, name: `Leader ${i}`, instructions: 'y'.repeat(10_000) }));
  const keyPersonnel = Array.from({ length: 2000 }, (_, i) => ({
    name: `Person ${i}`, department: 'engineering', role: 'Engineer', specialization: 'Systems', age: 30, featured: true,
  }));
  const customEvents = Array.from({ length: 50 }, (_, i) => ({ turn: (i % 6) + 1, title: `Event ${i} ${'t'.repeat(500)}`, description: 'd'.repeat(100_000) }));
  const config = normalizeSimulationConfig({
    actors, turns: 6, keyPersonnel, customEvents, liveSearch: true,
  } as unknown as Parameters<typeof normalizeSimulationConfig>[0], marsScenario);
  const capped = applyDemoCaps(config);
  assert.equal(capped.actors.length, 2);
  assert.ok(capped.keyPersonnel.length <= capped.initialPopulation, `${capped.keyPersonnel.length} key personnel`);
  assert.ok(capped.customEvents.length <= capped.turns, `${capped.customEvents.length} custom events`);
  for (const event of capped.customEvents) {
    assert.ok(event.title.length <= 120 && event.description.length <= 600, `${event.title.length}/${event.description.length}`);
  }
  for (const actor of capped.actors) assert.ok((actor.instructions ?? '').length <= 400);
  assert.equal(capped.liveSearch, false);
});

test('the day limit keys on the connection, not on an address header the caller sends', async () => {
  await withServer({ maxSimsPerDay: 1 }, async base => {
    const body = { actors: mars.presets[0].leaders, turns: 1, scenarioId: 'mars-genesis' };
    const first = await post(base, '/setup', body, { 'cf-connecting-ip': '198.51.100.1' });
    await first.text();
    assert.equal(first.status, 200);
    const second = await post(base, '/setup', body, { 'cf-connecting-ip': '198.51.100.2', 'x-forwarded-for': '198.51.100.3' });
    await second.text();
    assert.equal(second.status, 429);

    const read = await fetch(`${base}/rate-limit`, { headers: { 'cf-connecting-ip': 'z'.repeat(4000) } });
    const status = await read.json() as { ip: string };
    assert.notEqual(status.ip, 'z'.repeat(4000));
  });
});

test('behind a proxy the server is told to trust, each client address has its own day limit', async () => {
  await withServer({ maxSimsPerDay: 1, env: { PARACOSM_CLIENT_IP_HEADER: 'cf-connecting-ip' } }, async base => {
    const body = { actors: mars.presets[0].leaders, turns: 1, scenarioId: 'mars-genesis' };
    const statusFor = async (address: string) => {
      const res = await post(base, '/setup', body, { 'cf-connecting-ip': address });
      await res.text();
      return res.status;
    };
    assert.equal(await statusFor('198.51.100.1'), 200);
    assert.equal(await statusFor('198.51.100.2'), 200);
    assert.equal(await statusFor('198.51.100.1'), 429);
    // A value that is not an address counts against the connection's address.
    assert.equal(await statusFor('not-an-address'), 200);
    assert.equal(await statusFor('also-not-an-address'), 429);
  });
});

test('reading a limit adds no entry for the address read', () => {
  const limiter = new IpRateLimiter(1, 5, 30, null, 500);
  try {
    for (let i = 0; i < 100; i++) limiter.check(`unseen-${i}`);
    assert.equal(limiter.stats().totalIps, 0);
  } finally {
    limiter.destroy();
  }
});

test('fetch-seed refuses a URL on a loopback or link-local address without connecting to it', async () => {
  let hits = 0;
  const target = createServer((_req, res) => { hits += 1; res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('internal marker'); });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const { port } = target.address() as { port: number };
  try {
    await withServer({ maxSimsPerDay: 0 }, async base => {
      for (const url of [`http://127.0.0.1:${port}/marker`, `http://localhost:${port}/marker`, 'http://169.254.169.254/latest/meta-data/']) {
        const res = await post(base, '/api/quickstart/fetch-seed', { url });
        const text = await res.text();
        assert.equal(res.status, 400, `${url}: ${res.status} ${text.slice(0, 200)}`);
        assert.ok(!text.includes('internal marker'));
      }
    });
    assert.equal(hits, 0);
  } finally {
    target.close();
  }
});

const noSearch: WebSearchModule = {
  WebSearchService: class { registerProvider() {} hasProviders() { return false; } async search() { return []; } } as unknown as WebSearchModule['WebSearchService'],
  FirecrawlProvider: class {} as unknown as WebSearchModule['FirecrawlProvider'],
  TavilyProvider: class {} as unknown as WebSearchModule['TavilyProvider'],
  SerperProvider: class {} as unknown as WebSearchModule['SerperProvider'],
  BraveProvider: class {} as unknown as WebSearchModule['BraveProvider'],
};

test('a fetched page is read up to 2 MiB', async () => {
  const fetched = await fetchSeedFromUrl('https://example.com/large', {
    env: {},
    importWebSearch: async () => noSearch,
    fetchImpl: async () => new Response('a'.repeat(3 * 1024 * 1024), { status: 200, headers: { 'content-type': 'text/plain' } }),
  });
  assert.ok(fetched.text.length <= 2 * 1024 * 1024, `${fetched.text.length} characters`);
});

test('markup with no closing brackets is stripped in linear time', async () => {
  const started = Date.now();
  const fetched = await fetchSeedFromUrl('https://example.com/brackets', {
    env: {},
    importWebSearch: async () => noSearch,
    fetchImpl: async () => new Response(`<html>${'<'.repeat(100_000)}${'<script'.repeat(20_000)}${'<title'.repeat(20_000)}`, { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  const elapsed = Date.now() - started;
  assert.equal(typeof fetched.text, 'string');
  assert.ok(elapsed < 1500, `stripping took ${elapsed} ms`);
});

test('/compile on the hosted demo bounds the searches a compile runs, with or without a caller key', async () => {
  const captured: Array<Record<string, unknown>> = [];
  let n = 0;
  await withServer({
    maxSimsPerDay: 1,
    env: { PARACOSM_HOSTED_DEMO: 'true' },
    compileScenario: async (_json, options) => {
      captured.push(options);
      n += 1;
      return { ...marsScenario, id: `limits-compiled-${n}` } as never;
    },
  }, async base => {
    for (let i = 0; i < 7; i++) {
      const res = await post(base, '/compile', {
        scenario: { id: `limits-compiled-${i}`, departments: [] },
        apiKey: i === 0 ? undefined : 'sk-caller-own-key',
        seedText: `brief ${i}`,
        maxSearches: 200,
      });
      await res.text();
      assert.equal(res.status, 200);
    }
  });
  assert.equal(captured.length, 7);
  for (const options of captured) {
    assert.ok(typeof options.maxSearches === 'number' && options.maxSearches <= 5, `maxSearches ${String(options.maxSearches)}`);
  }
  assert.ok(captured.some(options => options.webSearch === false), 'a caller past the compile limit compiles without the host\'s search');
});
