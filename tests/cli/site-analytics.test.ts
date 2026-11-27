/**
 * The hosted demo's analytics on the server: the ids the dashboard's build
 * hands the consent bar, the page views the bar sends to POST /api/event,
 * and their forward to the Plausible instance.
 *
 * The route is driven over HTTP against a real server in hosted_demo mode
 * whose forward goes to a sink on a local port, so nothing is counted.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { CountEventLimit, countedEvent, parseSiteAnalyticsIds, readSiteAnalyticsIds } from '../../src/server/site-analytics.js';

test('only an id of its vendor\'s shape reaches the bar', () => {
  assert.deepEqual(parseSiteAnalyticsIds({ ga: 'G-AB12CD34EF', clarity: 'abc123xyz' }), { ga: 'G-AB12CD34EF', clarity: 'abc123xyz' });
  assert.deepEqual(parseSiteAnalyticsIds({ ga: ' G-AB12CD34EF\n', clarity: '' }), { ga: 'G-AB12CD34EF', clarity: '' });
  assert.deepEqual(parseSiteAnalyticsIds({ ga: 'G-XXXX"</script>', clarity: 'ABC123XYZ' }), { ga: '', clarity: '' });
  assert.deepEqual(parseSiteAnalyticsIds({ ga: 'UA-1234-1', clarity: 'your-clarity-id' }), { ga: '', clarity: '' });
  assert.deepEqual(parseSiteAnalyticsIds(null), { ga: '', clarity: '' });
  assert.deepEqual(parseSiteAnalyticsIds({ ga: 42, clarity: ['abc123xyz'] }), { ga: '', clarity: '' });
});

test('a build without site-analytics.json, or with one that does not parse, gives empty ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-site-analytics-'));
  try {
    assert.deepEqual(readSiteAnalyticsIds(dir), { ga: '', clarity: '' });
    writeFileSync(join(dir, 'site-analytics.json'), '{"ga":');
    assert.deepEqual(readSiteAnalyticsIds(dir), { ga: '', clarity: '' });
    writeFileSync(join(dir, 'site-analytics.json'), '{"ga":"G-AB12CD34EF","clarity":"abc123xyz"}\n');
    assert.deepEqual(readSiteAnalyticsIds(dir), { ga: 'G-AB12CD34EF', clarity: 'abc123xyz' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a page view is forwarded as its public page and nothing of the referring page', () => {
  assert.deepEqual(countedEvent(JSON.stringify({ n: 'pageview', u: '/sim', r: 'https://news.example.com/item?id=7#c' })), {
    name: 'pageview',
    url: 'https://paracosm.agentos.sh/sim',
    domain: 'paracosm.agentos.sh',
  });
  // A query or fragment in the path is dropped; dot segments resolve.
  assert.equal(countedEvent(JSON.stringify({ n: 'pageview', u: '/docs/../sim?token=secret#x' }))?.url, 'https://paracosm.agentos.sh/sim');
});

test('a page view names one of the site\'s public pages, never the rest of a path', () => {
  const url = (u: string, isDocsPage?: (path: string) => boolean) => {
    const event = countedEvent(JSON.stringify({ n: 'pageview', u }), isDocsPage);
    return typeof event === 'object' && event !== null ? event.url : event;
  };
  assert.equal(url('/'), 'https://paracosm.agentos.sh/');
  assert.equal(url('/index.html'), 'https://paracosm.agentos.sh/');
  assert.equal(url('/sim/index.html'), 'https://paracosm.agentos.sh/sim');
  // The dashboard answers any path under /sim; the rest of it is never sent.
  assert.equal(url('/sim/run-key-example'), 'https://paracosm.agentos.sh/sim');
  assert.equal(url('/sim/a/b/c'), 'https://paracosm.agentos.sh/sim');
  // An API docs page counts under its own path only when it is one of the built pages.
  const built = (path: string) => path === '/docs/modules.html';
  assert.equal(url('/docs/modules.html', built), 'https://paracosm.agentos.sh/docs/modules.html');
  assert.equal(url('/docs/secret-token-page.html', built), 'unlisted');
  // Any other path is no page of this site: it is not forwarded.
  for (const path of ['/another-page', '/api/runs/abc', '/simulator', '/docs', '/brand/consent/consent.js']) {
    assert.equal(url(path, built), 'unlisted', path);
  }
});

test('no referrer reaches the instance, whatever the page sends', () => {
  for (const r of [
    'https://ticket-123.internal/',
    'https://news.example.co.uk/',
    'https://token-example.preview.example.org/view',
    'https://www.google.com/search?q=paracosm',
    'http://192.168.1.5/admin',
    '',
    'javascript:alert(1)',
  ]) {
    const event = countedEvent(JSON.stringify({ n: 'pageview', u: '/', r }));
    assert.ok(typeof event === 'object' && event !== null, r);
    assert.equal('referrer' in event, false, r);
  }
});

test('the count limit holds each address only for its window, with no further page view needed to drop it', async () => {
  const limit = new CountEventLimit(120, 50);
  assert.equal(limit.take('198.51.100.1'), true);
  assert.equal(limit.take('198.51.100.2'), true);
  assert.equal(limit.size, 2);
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  assert.equal(limit.size, 0, 'an ended window leaves no address behind');
  // A new window starts for an address that comes back.
  assert.equal(limit.take('198.51.100.1'), true);
  assert.equal(limit.size, 1);
  limit.close();
});

test('a body that is not a page view of this site forwards nothing', () => {
  for (const body of [
    '',
    'not json',
    'null',
    JSON.stringify({ n: 'signup', u: '/' }),
    JSON.stringify({ n: 'pageview' }),
    JSON.stringify({ n: 'pageview', u: 'https://elsewhere.example/' }),
    JSON.stringify({ n: 'pageview', u: '//elsewhere.example/path' }),
    JSON.stringify({ n: 'pageview', u: `/${'a'.repeat(600)}` }),
  ]) {
    assert.equal(countedEvent(body), null, body.slice(0, 60));
  }
});

interface Received {
  body: Record<string, unknown>;
  headers: import('node:http').IncomingHttpHeaders;
  userAgent: string | undefined;
  forwardedFor: string | undefined;
}

const received: Received[] = [];
let sink: Server;
let sinkUrl = '';
let site = '';
let localSite = '';
const cleanups: Array<() => Promise<void>> = [];

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

before(async () => {
  sink = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const header = (name: string) => (typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined);
      received.push({ body: JSON.parse(raw) as Record<string, unknown>, headers: req.headers, userAgent: header('user-agent'), forwardedFor: header('x-forwarded-for') });
      res.writeHead(202);
      res.end('ok');
    });
  });
  sinkUrl = `${await listen(sink)}/api/event`;
  cleanups.push(async () => { sink.close(); await once(sink, 'close'); });

  for (const hosted of [true, false]) {
    const appDir = mkdtempSync(join(tmpdir(), 'paracosm-count-'));
    const server = createMarsServer({
      env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: hosted ? 'true' : '', PARACOSM_PLATFORM_API: undefined, PARACOSM_CLIENT_IP_HEADER: 'x-forwarded-for' },
      runPairSimulations: async () => {},
      countEventUrl: sinkUrl,
    });
    const origin = await listen(server);
    if (hosted) site = origin; else localSite = origin;
    cleanups.push(async () => {
      server.close();
      await once(server, 'close');
      rmSync(appDir, { recursive: true, force: true });
    });
  }
});

after(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

function post(origin: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'count-test-browser', 'Sec-Fetch-Site': 'same-origin', ...headers },
    body,
  });
}

test('POST /api/event on the hosted demo forwards one page view with the visitor\'s browser name and address', async () => {
  received.length = 0;
  const res = await post(site, JSON.stringify({ n: 'pageview', u: '/sim?tab=library', r: 'https://ticket-123.internal/q?x=1' }), { 'X-Forwarded-For': '198.51.100.7' });
  assert.equal(res.status, 202);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(received.length, 1);
  const { headers, ...event } = received[0];
  assert.equal(headers.referer, undefined);
  assert.deepEqual(event, {
    body: { name: 'pageview', url: 'https://paracosm.agentos.sh/sim', domain: 'paracosm.agentos.sh' },
    userAgent: 'count-test-browser',
    forwardedFor: '198.51.100.7',
  });
});

const namedEvents = [
  ['qs_view', { state: 'ready', entry: 'direct' }],
  ['qs_start', { picked: 'no', key: 'host', size: '2' }],
  ['run_started', { key: 'own' }],
  ['run_failed', { reason: 'capacity' }],
  ['qs_how_open', {}],
  ['qs_no_run_left_view', {}],
  ['qs_no_run_left_action', { action: 'replay_last' }],
  ['qs_pair_switch', { to: '2' }],
  ['qs_prompt_open', { side: 'left' }],
  ['qs_prompt_open', { side: 'right' }],
  ['tab_change', { to: 'settings' }],
] as const;
const pairEvent = { n: 'qs_pair_switch', u: '/sim', p: { to: '2' } };

test('POST /api/event forwards every approved event with only its public page and fixed properties', async () => {
  received.length = 0;
  for (const [n, p] of namedEvents) {
    const res = await post(site, JSON.stringify({ n, u: '/sim/private-marker?input=typed-marker#fragment-marker', p }), {
      'X-Forwarded-For': '192.0.2.17',
      Referer: 'https://example.test/referrer-marker',
      Cookie: 'visitor=cookie-marker',
    });
    assert.equal(res.status, 202, n);
    const entry = received.at(-1);
    assert.ok(entry);
    assert.deepEqual(entry.body, {
      name: n,
      url: 'https://paracosm.agentos.sh/sim',
      domain: 'paracosm.agentos.sh',
      props: p,
    });
    assert.equal(entry.userAgent, 'count-test-browser');
    assert.equal(entry.forwardedFor, '192.0.2.17');
    assert.equal(entry.headers.referer, undefined);
    assert.equal(entry.headers.cookie, undefined);
    assert.doesNotMatch(JSON.stringify(entry), /(?:private|typed|fragment|referrer|cookie)-marker/);
  }
  assert.equal(received.length, namedEvents.length);
});

test('POST /api/event rejects names, envelopes, paths and fields outside the named event contract', async () => {
  received.length = 0;
  const invalid = [
    { ...pairEvent, n: 'unknown' },
    { ...pairEvent, n: 'qs_prompt_open', p: { side: 'marker' } },
    { ...pairEvent, n: 'qs_prompt_open', p: { side: 'left', prompt: 'marker' } },
    { ...pairEvent, n: 'constructor' },
    { ...pairEvent, r: 'referrer-marker' },
    { n: pairEvent.n, u: pairEvent.u },
    { ...pairEvent, p: { to: '2', constructor: 'extra' } },
    { ...pairEvent, p: {} },
    { ...pairEvent, p: { action: 'add_key' } },
    { ...pairEvent, p: { to: '3' } },
    { ...pairEvent, p: { to: 'typed-marker' } },
    { ...pairEvent, p: { to: 2 } },
    { ...pairEvent, p: ['2'] },
    { ...pairEvent, p: null },
    { ...pairEvent, u: 'https://example.test/sim' },
    { ...pairEvent, u: '//example.test/sim' },
    { ...pairEvent, u: '/%zz/sim' },
    [pairEvent],
    null,
  ];
  for (const body of invalid) {
    assert.equal((await post(site, JSON.stringify(body))).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(received, []);
});

test('named events share the count route privacy, page and request limits', async () => {
  received.length = 0;
  const body = JSON.stringify(pairEvent);
  for (const headers of [{ DNT: '1' }, { 'Sec-GPC': '1' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await post(site, body, headers as Record<string, string>)).status, 204);
  }
  for (const headers of [{ DNT: '1' }, { 'Sec-GPC': '1' }]) {
    assert.equal((await post(site, JSON.stringify({ ...pairEvent, n: 'qs_prompt_open', p: { side: 'left' } }), headers as Record<string, string>)).status, 204);
  }
  for (const u of ['/', '/another-page']) {
    assert.equal((await post(site, JSON.stringify({ ...pairEvent, u }))).status, 204);
  }
  assert.equal((await post(site, body.padEnd(4097))).status, 413);
  assert.equal((await post(localSite, body)).status, 404);
  assert.deepEqual(received, []);
});

test('POST /api/event forwards nothing under a privacy signal, from another site, or for a body that is not a page view', async () => {
  received.length = 0;
  const pageview = JSON.stringify({ n: 'pageview', u: '/' });
  assert.equal((await post(site, pageview, { 'Sec-GPC': '1' })).status, 204);
  assert.equal((await post(site, pageview, { DNT: '1' })).status, 204);
  assert.equal((await post(site, pageview, { 'Sec-Fetch-Site': 'cross-site' })).status, 204);
  assert.equal((await post(site, JSON.stringify({ n: 'pageview', u: 'https://elsewhere.example/' }))).status, 400);
  assert.equal((await post(site, 'x'.repeat(5000))).status, 413);
  assert.equal((await fetch(`${site}/api/event`)).status, 405);
  assert.equal(received.length, 0);
});

test('POST /api/event answers 502 when the instance does not take the page view', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-count-down-'));
  // A port nothing listens on: the sink's, closed.
  const closed = createServer();
  const closedUrl = `${await listen(closed)}/api/event`;
  closed.close();
  await once(closed, 'close');
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: 'true', PARACOSM_PLATFORM_API: undefined },
    runPairSimulations: async () => {},
    countEventUrl: closedUrl,
  });
  const origin = await listen(server);
  try {
    assert.equal((await post(origin, JSON.stringify({ n: 'pageview', u: '/' }))).status, 502);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('POST /api/event shares a limit of 120 page views and named events a minute from one address, and answers 429 past it', async () => {
  received.length = 0;
  const pageview = JSON.stringify({ n: 'pageview', u: '/' });
  // Direct calls with no Origin and no fetch metadata, as a script would send them.
  const send = (body: string) => fetch(`${site}/api/event`, {
    method: 'POST',
    headers: { 'User-Agent': 'count-flood', 'X-Forwarded-For': '203.0.113.9' },
    body,
  });
  const answers: number[] = [];
  const named = JSON.stringify(pairEvent);
  for (let i = 0; i < 125; i++) answers.push((await send(i % 2 === 0 ? pageview : named)).status);
  assert.deepEqual([...new Set(answers.slice(0, 120))], [202]);
  assert.deepEqual([...new Set(answers.slice(120))], [429]);
  const counted = received.filter(event => event.userAgent === 'count-flood');
  assert.equal(counted.length, 120);
  assert.equal(counted.filter(event => event.body.name === 'qs_pair_switch').length, 60);

  // Another address still counts.
  const other = await post(site, pageview, { 'X-Forwarded-For': '203.0.113.10' });
  assert.equal(other.status, 202);
});

test('POST /api/event holds at most 32 forwards open at once, and answers 429 past them', async () => {
  const held: Array<import('node:http').ServerResponse> = [];
  const slowSink = createServer((req, res) => {
    req.resume();
    held.push(res);
  });
  const slowUrl = `${await listen(slowSink)}/api/event`;
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-count-slow-'));
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: 'true', PARACOSM_PLATFORM_API: undefined, PARACOSM_CLIENT_IP_HEADER: 'x-forwarded-for' },
    runPairSimulations: async () => {},
    countEventUrl: slowUrl,
  });
  const origin = await listen(server);
  try {
    const pageview = JSON.stringify({ n: 'pageview', u: '/' });
    // 32 page views from 32 addresses, each held open by the sink.
    const open = Array.from({ length: 32 }, (_, i) => post(origin, pageview, { 'X-Forwarded-For': `198.51.100.${i + 1}` }));
    const deadline = Date.now() + 4_000;
    while (held.length < 32 && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 20));
    assert.equal(held.length, 32, 'the 32 forwards reach the sink');
    const refused = await post(origin, pageview, { 'X-Forwarded-For': '198.51.100.200' });
    assert.equal(refused.status, 429);
    for (const res of held) { res.writeHead(202); res.end(); }
    assert.deepEqual([...new Set((await Promise.all(open)).map(res => res.status))], [202]);
  } finally {
    for (const res of held) if (!res.writableEnded) res.end();
    server.close();
    slowSink.close();
    await Promise.all([once(server, 'close'), once(slowSink, 'close')]);
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a copy run from the package or a clone has no /api/event route', async () => {
  received.length = 0;
  const res = await post(localSite, JSON.stringify({ n: 'pageview', u: '/' }));
  assert.equal(res.status, 404);
  assert.equal(received.length, 0);
});

test('a request that sends DNT: 1 alone gets a bar told to run nothing', async () => {
  const res = await fetch(`${site}/`, { headers: { DNT: '1' } });
  assert.equal(res.status, 200);
  const config = (await res.text()).match(/<script type="application\/json" id="paracosm-consent-config">([^<]*)<\/script>/);
  assert.ok(config, 'the page carries the bar\'s configuration');
  assert.equal((JSON.parse(config[1]) as { signal: boolean }).signal, true);
});

test('POST /api/event drops a path that is no page of the site, and forwards nothing for it', async () => {
  received.length = 0;
  const res = await post(site, JSON.stringify({ n: 'pageview', u: '/another-page' }), { 'X-Forwarded-For': '192.0.2.40' });
  assert.equal(res.status, 204);
  assert.equal(received.length, 0);
});

test('POST /api/event limits the addresses of one IPv6 /64 together, and forwards the full address', async () => {
  received.length = 0;
  const pageview = JSON.stringify({ n: 'pageview', u: '/' });
  const send = (address: string) => post(site, pageview, { 'User-Agent': 'count-v6', 'X-Forwarded-For': address });
  const first = await send('2001:db8:5:7::1');
  assert.equal(first.status, 202);
  assert.equal(received[0]?.forwardedFor, '2001:db8:5:7::1', 'the instance gets the address itself');
  for (let i = 1; i < 120; i++) assert.equal((await send(`2001:db8:5:7::${(i + 1).toString(16)}`)).status, 202);
  // Another address of the same /64 shares the window, now full.
  assert.equal((await send('2001:db8:5:7::ffff')).status, 429);
  // An address of another /64 still counts.
  assert.equal((await send('2001:db8:5:8::1')).status, 202);
});
