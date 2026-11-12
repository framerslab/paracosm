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
 * - A hosted run on the caller's own model key searches only on the search
 *   keys the caller sends, and the addresses of one IPv6 /64 share a limit.
 * - A hosted /compile with no seed charges no search allowance, and the
 *   demo caps bound each leader's and key person's text.
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
import { fetchPublicUrl, htmlToText } from '../../src/engine/compiler/public-url-fetch.js';
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
  await withServer({
    maxSimsPerDay: 1,
    env: { PARACOSM_HOSTED_DEMO: 'true' },
    // The compile answers with the id it was sent, as the compiler does.
    compileScenario: async (json, options) => {
      captured.push(options);
      return { ...marsScenario, id: String(json.id) } as never;
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

const HOST_SEARCH_KEYS = {
  SERPER_API_KEY: 'host-serper-key',
  FIRECRAWL_API_KEY: 'host-firecrawl-key',
  TAVILY_API_KEY: 'host-tavily-key',
  BRAVE_API_KEY: 'host-brave-key',
  COHERE_API_KEY: 'host-cohere-key',
};

test('a hosted run on the caller\'s own model key searches only on search keys the caller sends', async () => {
  const runs: Array<{ config: { liveSearch: boolean; serperKey?: string }; runnerOptions?: { searchEnv?: NodeJS.ProcessEnv } }> = [];
  await withServer({
    maxSimsPerDay: 1,
    env: { PARACOSM_HOSTED_DEMO: 'true', ...HOST_SEARCH_KEYS },
    runPairSimulations: async (config, _broadcast, _signal, _scenario, _onArtifact, runnerOptions) => {
      runs.push({ config, runnerOptions: runnerOptions as { searchEnv?: NodeJS.ProcessEnv } | undefined });
    },
  }, async base => {
    const body = { actors: mars.presets[0].leaders, turns: 1, scenarioId: 'mars-genesis', apiKey: 'sk-caller-own-model-key', liveSearch: true };
    const withoutSearchKey = await post(base, '/setup', body);
    await withoutSearchKey.text();
    assert.equal(withoutSearchKey.status, 200);
    const withSearchKey = await post(base, '/setup', { ...body, serperKey: 'caller-serper-key' });
    await withSearchKey.text();
    assert.equal(withSearchKey.status, 200);
    const deadline = Date.now() + 8000;
    while (runs.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  });
  assert.equal(runs.length, 2);
  // No search key of the caller's: the run has no live search to spend the host's keys on.
  assert.equal(runs[0].config.liveSearch, false);
  // The caller's own search key: live search runs, and the run's search
  // reads no key from the host's environment.
  assert.equal(runs[1].config.liveSearch, true);
  assert.equal(runs[1].config.serperKey, 'caller-serper-key');
  for (const { runnerOptions } of runs) {
    const searchEnv = runnerOptions?.searchEnv;
    assert.ok(searchEnv, 'the run names the environment its search reads; without one it reads the host\'s');
    for (const name of Object.keys(HOST_SEARCH_KEYS)) assert.equal(searchEnv[name], undefined, name);
  }
});

test('behind the trusted proxy, the addresses of one IPv6 /64 share a day limit', async () => {
  await withServer({ maxSimsPerDay: 1, env: { PARACOSM_CLIENT_IP_HEADER: 'cf-connecting-ip' } }, async base => {
    const body = { actors: mars.presets[0].leaders, turns: 1, scenarioId: 'mars-genesis' };
    const statusFor = async (address: string) => {
      const res = await post(base, '/setup', body, { 'cf-connecting-ip': address });
      await res.text();
      return res.status;
    };
    assert.equal(await statusFor('2001:db8:1:2::1'), 200);
    assert.equal(await statusFor('2001:db8:1:2:ffff:ffff:ffff:fffe'), 429);
    assert.equal(await statusFor('2001:0db8:0001:0002:0:0:0:9'), 429);
    assert.equal(await statusFor('2001:db8:1:3::1'), 200);
    // An IPv4-mapped IPv6 address is the IPv4 address it carries.
    assert.equal(await statusFor('198.51.100.7'), 200);
    assert.equal(await statusFor('::ffff:198.51.100.7'), 429);
  });
});

test('a redirect\'s body is not read on once its Location is taken', async () => {
  let redirectClosed = false;
  const target = createServer((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { Location: '/page', 'Content-Type': 'text/plain' });
      const chunk = Buffer.alloc(64 * 1024, 'r');
      const timer = setInterval(() => res.write(chunk), 5);
      res.on('close', () => { clearInterval(timer); redirectClosed = true; });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('the page');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const { port } = target.address() as { port: number };
  try {
    const fetched = await fetchPublicUrl(`http://127.0.0.1:${port}/hop`, { allowPrivateAddresses: true, timeoutMs: 10_000 });
    assert.equal(fetched.text, 'the page');
    const deadline = Date.now() + 1000;
    while (!redirectClosed && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.ok(redirectClosed, 'the redirect\'s response is closed, not read until the fetch times out');
  } finally {
    target.closeAllConnections();
    target.close();
  }
});

test('a page\'s <header> is page text, not the document head', () => {
  assert.equal(htmlToText('<header>Important summary</header><main>Details</main>'), 'Important summary Details');
  assert.equal(htmlToText('<html><HEAD><title>T</title></HEAD><body><header>Site</header><p>Body</p></body></html>'), 'Site Body');
  assert.equal(htmlToText('<body><header class="top">Masthead<p>Lead</p></body>'), 'Masthead Lead');
  // A head with no closing tag ends where the body starts.
  assert.equal(htmlToText('<html><head><title>T</title><body><header>Site</header><p>Body</p></body></html>'), 'Site Body');
});

test('the hosted demo caps keep one custom event a turn, within the run\'s turns', () => {
  const customEvents = [
    { turn: 1, title: 'First', description: 'a' },
    { turn: 1, title: 'Second on turn one', description: 'b' },
    { turn: 1, title: 'Third on turn one', description: 'c' },
    { turn: 2, title: 'Turn two', description: 'd' },
    { turn: 50, title: 'Past the last turn', description: 'e' },
  ];
  const config = normalizeSimulationConfig({
    actors: mars.presets[0].leaders, turns: 3, customEvents,
  } as unknown as Parameters<typeof normalizeSimulationConfig>[0], marsScenario);
  const capped = applyDemoCaps(config);
  assert.deepEqual(capped.customEvents.map(event => [event.turn, event.title]), [[1, 'First'], [2, 'Turn two']]);
});

test('a hosted /compile with no seed to search for uses none of the caller\'s search allowance', async () => {
  const captured: Array<Record<string, unknown>> = [];
  await withServer({
    maxSimsPerDay: 1,
    env: { PARACOSM_HOSTED_DEMO: 'true' },
    compileScenario: async (json, options) => {
      captured.push(options);
      return { ...marsScenario, id: String(json.id) } as never;
    },
  }, async base => {
    for (let i = 0; i < 6; i++) {
      const res = await post(base, '/compile', { scenario: { id: `seedless-${i}`, departments: [] }, apiKey: 'sk-caller-own-key' });
      await res.text();
      assert.equal(res.status, 200);
    }
    const seeded = await post(base, '/compile', {
      scenario: { id: 'seeded', departments: [] },
      apiKey: 'sk-caller-own-key',
      seedText: 'A brief worth a search.',
    });
    await seeded.text();
    assert.equal(seeded.status, 200);
  });
  assert.equal(captured.length, 7);
  assert.notEqual(captured[6].webSearch, false, 'six compiles with nothing to search for leave the seeded compile its search');
});

test('the hosted demo caps bound the text of each leader and key person a run keeps', () => {
  const leader = mars.presets[0].leaders[0];
  const long = 'z'.repeat(50_000);
  const actors = [0, 1].map(i => ({ ...leader, name: `Leader ${i} ${long}`, archetype: long, unit: long }));
  const keyPersonnel = Array.from({ length: 30 }, (_, i) => ({
    name: `Person ${i} ${long}`, department: 'engineering', role: long, specialization: long, age: 30, featured: true,
  }));
  const config = normalizeSimulationConfig({
    actors, turns: 3, keyPersonnel,
  } as unknown as Parameters<typeof normalizeSimulationConfig>[0], marsScenario);
  const capped = applyDemoCaps(config);
  assert.equal(capped.keyPersonnel.length, 30);
  for (const actor of capped.actors as unknown as Array<Record<string, unknown>>) {
    for (const field of ['name', 'archetype', 'unit']) assert.ok(String(actor[field] ?? '').length <= 120, `leader ${field}: ${String(actor[field] ?? '').length}`);
  }
  for (const person of capped.keyPersonnel as unknown as Array<Record<string, unknown>>) {
    for (const field of ['name', 'role', 'specialization']) assert.ok(String(person[field] ?? '').length <= 120, `key person ${field}: ${String(person[field] ?? '').length}`);
  }
});

test('a page\'s entities are decoded once', () => {
  assert.equal(htmlToText('<p>&amp;lt;b&amp;gt; and &amp;amp;</p>'), '&lt;b&gt; and &amp;');
});

test('a hosted /compile from a seed URL on the caller\'s own model key counts against the compile limit, web search or not', async () => {
  await withServer({
    maxSimsPerDay: 1,
    env: { PARACOSM_HOSTED_DEMO: 'true', FIRECRAWL_API_KEY: 'host-firecrawl-key' },
    compileScenario: async json => ({ ...marsScenario, id: String(json.id) }) as never,
  }, async base => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(base, '/compile', {
        scenario: { id: `from-url-${i}`, departments: [] },
        apiKey: 'sk-caller-own-key',
        seedUrl: `https://example.com/brief-${i}`,
        webSearch: false,
      });
      await res.text();
      statuses.push(res.status);
    }
    // The host's scraping key reads each seed URL, so the sixth is refused.
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  });
});
