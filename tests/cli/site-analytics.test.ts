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
import { countEventFrom, parseSiteAnalyticsIds, readSiteAnalyticsIds } from '../../src/server/site-analytics.js';

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

test('a page view is forwarded path only, with the referring site\'s origin alone', () => {
  assert.deepEqual(countEventFrom(JSON.stringify({ n: 'pageview', u: '/sim', r: 'https://news.example.com/item?id=7#c' })), {
    name: 'pageview',
    url: 'https://paracosm.agentos.sh/sim',
    domain: 'paracosm.agentos.sh',
    referrer: 'https://news.example.com/',
  });
  // A query or fragment in the path is dropped; dot segments resolve.
  assert.equal(countEventFrom(JSON.stringify({ n: 'pageview', u: '/docs/../sim?token=secret#x' }))?.url, 'https://paracosm.agentos.sh/sim');
  assert.equal(countEventFrom(JSON.stringify({ n: 'pageview', u: '/', r: '' }))?.referrer, '');
  assert.equal(countEventFrom(JSON.stringify({ n: 'pageview', u: '/', r: 'javascript:alert(1)' }))?.referrer, '');
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
    assert.equal(countEventFrom(body), null, body.slice(0, 60));
  }
});

interface Received {
  body: Record<string, unknown>;
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
      received.push({ body: JSON.parse(raw) as Record<string, unknown>, userAgent: header('user-agent'), forwardedFor: header('x-forwarded-for') });
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
  const res = await post(site, JSON.stringify({ n: 'pageview', u: '/sim?tab=library', r: 'https://search.example/q?x=1' }), { 'X-Forwarded-For': '198.51.100.7' });
  assert.equal(res.status, 202);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    body: { name: 'pageview', url: 'https://paracosm.agentos.sh/sim', domain: 'paracosm.agentos.sh', referrer: 'https://search.example/' },
    userAgent: 'count-test-browser',
    forwardedFor: '198.51.100.7',
  });
});

test('POST /api/event forwards nothing under a privacy signal, from another site, or for a body that is not a page view', async () => {
  received.length = 0;
  const pageview = JSON.stringify({ n: 'pageview', u: '/' });
  assert.equal((await post(site, pageview, { 'Sec-GPC': '1' })).status, 204);
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

test('a copy run from the package or a clone has no /api/event route', async () => {
  received.length = 0;
  const res = await post(localSite, JSON.stringify({ n: 'pageview', u: '/' }));
  assert.equal(res.status, 404);
  assert.equal(received.length, 0);
});
