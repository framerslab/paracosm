/**
 * A local server answers its own pages, loopback callers and the names it
 * is served under, and refuses a page of any other site.
 *
 * A site can point a name of its own at 127.0.0.1 (DNS rebinding): its
 * page then sends requests to the local server with that name in Host, and
 * in Origin when it sends one. Host and Origin then agree, so the server
 * must check the name itself: it answers loopback names, address literals
 * and the name HOST gives, and refuses any other name, with or without an
 * Origin.
 *
 * Every request is sent over HTTP to createMarsServer in local mode, with
 * the Host and Origin a browser would send.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { rmSync } from 'node:fs';
import { startServer, type RunServer } from './helpers/run-server.js';

/** GET /health with exactly these headers; resolves to the status. */
function health(api: RunServer, headers: Record<string, string>): Promise<number> {
  const url = new URL('/health', api.base);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers, timeout: 5000 }, res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('no answer within 5 s')));
    req.on('error', reject);
    req.end();
  });
}

async function withLocalServer(body: (api: RunServer, port: string) => Promise<void>, env: Record<string, string> = {}): Promise<void> {
  const api = await startServer({ env: { PARACOSM_PLATFORM_API: '', HOST: '', ...env } });
  try {
    await body(api, new URL(api.base).port);
  } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
  }
}

test('a page of another site under a name that points at the local server is refused, with or without an Origin', async () => {
  await withLocalServer(async (api, port) => {
    const host = `rebind.example.test:${port}`;
    assert.equal(await health(api, { Host: host, Origin: `http://${host}` }), 403, 'a request with the name in Origin and Host');
    assert.equal(await health(api, { Host: host }), 403, 'a same-origin read, which carries no Origin');
  });
});

test('loopback callers and the dashboard\'s own pages are answered, and another site\'s page is not', async () => {
  await withLocalServer(async (api, port) => {
    assert.equal(await health(api, { Host: `127.0.0.1:${port}` }), 200);
    assert.equal(await health(api, { Host: `localhost:${port}`, Origin: `http://localhost:${port}` }), 200);
    assert.equal(await health(api, { Host: `[::1]:${port}`, Origin: 'http://localhost:5173' }), 200);
    assert.equal(await health(api, { Host: `127.0.0.1:${port}`, Origin: 'http://other.example.test' }), 403);
    assert.equal(await health(api, { Host: `127.0.0.1:${port}`, Origin: 'null' }), 403);
  });
});

test('a server reached by its address, or by the name HOST gives, answers its own pages', async () => {
  await withLocalServer(async (api, port) => {
    assert.equal(await health(api, { Host: `192.168.1.20:${port}`, Origin: `http://192.168.1.20:${port}` }), 200);
    assert.equal(await health(api, { Host: `[fd00::20]:${port}`, Origin: `http://[fd00::20]:${port}` }), 200);
  });
  await withLocalServer(async (api, port) => {
    assert.equal(await health(api, { Host: `box.lan:${port}`, Origin: `http://box.lan:${port}` }), 200);
    assert.equal(await health(api, { Host: `Box.LAN:${port}` }), 200);
    assert.equal(await health(api, { Host: `other.lan:${port}`, Origin: `http://other.lan:${port}` }), 403);
  }, { HOST: 'box.lan' });
});
