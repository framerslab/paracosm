/**
 * `paracosm dashboard` listens on the loopback address unless HOST names
 * another, so a laptop running it answers no other machine on its network.
 * The hosted demo and the platform API mode keep listening on every
 * interface, where a proxy on the same machine forwards to them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { listenHost } from '../../src/cli/run-dashboard.js';

test('a local dashboard listens on the loopback address', async () => {
  assert.equal(listenHost({}), '127.0.0.1');
  const server = createServer();
  server.listen(0, listenHost({}));
  await once(server, 'listening');
  try {
    assert.equal((server.address() as { address: string }).address, '127.0.0.1');
  } finally {
    server.close();
  }
});

test('HOST names the address the dashboard listens on', () => {
  assert.equal(listenHost({ HOST: '0.0.0.0' }), '0.0.0.0');
  assert.equal(listenHost({ HOST: ' ::1 ' }), '::1');
  assert.equal(listenHost({ HOST: '' }), '127.0.0.1');
});

test('the hosted demo and the platform API mode keep listening on every interface unless HOST is set', () => {
  assert.equal(listenHost({ PARACOSM_HOSTED_DEMO: 'true' }), undefined);
  assert.equal(listenHost({ PARACOSM_PLATFORM_API: 'true' }), undefined);
  assert.equal(listenHost({ PARACOSM_HOSTED_DEMO: 'true', HOST: '127.0.0.1' }), '127.0.0.1');
});
