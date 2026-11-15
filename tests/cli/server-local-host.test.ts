import test from 'node:test';
import assert from 'node:assert/strict';
import { request, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { rmSync } from 'node:fs';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { startServer, type RunServer } from './helpers/run-server.js';

interface Answer { status: number; headers: IncomingHttpHeaders; text: string }
function send(api: RunServer, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Answer> {
  const url = new URL(path, api.base);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path, method, headers, timeout: 5000 }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('no answer within 5 s')));
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function withServer(body: (api: RunServer, port: string, calls: { compile: number }) => Promise<void>, env: Record<string, string> = {}): Promise<void> {
  const calls = { compile: 0 };
  const api = await startServer({
    env: { PARACOSM_HOSTED_DEMO: '', PARACOSM_PLATFORM_API: '', HOST: '', PARACOSM_ALLOWED_HOSTS: '', ...env },
    compileScenario: async json => { calls.compile++; return { ...marsScenario, id: String(json.id) }; },
  });
  try { await body(api, new URL(api.base).port, calls); } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
  }
}

function localRefusal(answer: Answer) {
  assert.deepEqual({ status: answer.status, cors: answer.headers['access-control-allow-origin'], cookie: answer.headers['set-cookie'], text: answer.text.startsWith('{') ? JSON.parse(answer.text).error : answer.text },
    { status: 403, cors: undefined, cookie: undefined, text: 'cross_site_refused' });
}

test('a name PARACOSM_ALLOWED_HOSTS lists is answered when HOST is an address', async t => {
  await withServer(async (api, port) => {
    for (const [name, status] of [['box.lan', 200], ['LAN-BOX.local', 200], ['bad', 403], ['other.lan', 403]] as const) {
      await t.test(name, async () => {
        const answer = await send(api, 'GET', '/health', { Host: `${name}:${port}`, ...(name === 'box.lan' ? { Origin: `http://${name}:${port}` } : {}) });
        assert.equal(answer.status, status, answer.text);
      });
    }
  }, { HOST: '0.0.0.0', PARACOSM_ALLOWED_HOSTS: 'box.lan, LAN-Box.local, bad:3456' });
});

test("a local server behind a proxy that passes the browser's host and port answers the dashboard's POST", async t => {
  await withServer(async (api, _port, calls) => {
    for (const [i, host] of ['box.lan:8443', 'box.lan'].entries()) await t.test(host, async () => {
      const before = calls.compile;
      const answer = await send(api, 'POST', '/compile', { 'Content-Type': 'application/json', Host: host, Origin: `https://${host}` }, { scenario: { id: `proxied-${i + 1}`, departments: [] } });
      assert.deepEqual({ status: answer.status, type: answer.headers['content-type'], calls: calls.compile - before },
        { status: 200, type: 'text/event-stream', calls: 1 });
    });
    await t.test("a Host without the page's port is refused", async () => {
      const before = calls.compile;
      localRefusal(await send(api, 'POST', '/compile', { 'Content-Type': 'application/json', Host: 'box.lan', Origin: 'https://box.lan:8443' }, { scenario: { id: 'proxied-3', departments: [] } }));
      assert.equal(calls.compile, before);
    });
  }, { PARACOSM_ALLOWED_HOSTS: 'box.lan' });
});

test('a CORS preflight sent to a name the server does not answer is refused', async () => {
  await withServer(async (api, port) => {
    localRefusal(await send(api, 'OPTIONS', '/setup', { Host: `other.example:${port}`, Origin: `http://other.example:${port}`, 'Access-Control-Request-Method': 'POST' }));
  });
});

test('a request sent to a name the server does not answer is refused, with or without an Origin', async () => {
  await withServer(async (api, port, calls) => {
    const Host = `other.example:${port}`;
    localRefusal(await send(api, 'GET', '/scenarios', { Host }));
    localRefusal(await send(api, 'POST', '/compile', { Host, Origin: `http://${Host}`, 'Content-Type': 'application/json' }, { scenario: { id: 'unknown-name', departments: [] } }));
    assert.equal(calls.compile, 0);
  });
});

test('a request with no Host, or sent to localhost., is refused', async () => {
  await withServer(async (api, port) => {
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: Number(port) }, () => { socket.write('GET /health HTTP/1.0\r\n\r\n'); });
      let text = '';
      socket.setEncoding('utf8');
      socket.setTimeout(5000, () => socket.destroy(new Error('no answer within 5 s')));
      socket.on('data', chunk => { text += chunk; });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.[01] 403 /);
    localRefusal(await send(api, 'GET', '/health', { Host: `LOCALHOST.:${port}` }));
  });
});

test('a preflight sent to a loopback address is answered as before', async () => {
  await withServer(async (api, port) => {
    const answer = await send(api, 'OPTIONS', '/setup', { Host: `127.0.0.1:${port}`, Origin: 'https://elsewhere.example', 'Access-Control-Request-Method': 'POST' });
    assert.equal(answer.status, 204);
    assert.equal(answer.headers['access-control-allow-origin'], '*');
  });
});

test('a hosted server reads no local name list', async () => {
  await withServer(async api => { assert.equal((await send(api, 'GET', '/health', { Host: 'paracosm.example' })).status, 200); }, { PARACOSM_HOSTED_DEMO: 'true' });
});
