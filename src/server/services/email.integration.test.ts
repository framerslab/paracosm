/**
 * Drives the real Resend SDK (no injected mock client) against a local HTTP
 * stub of the Resend API, so a resend upgrade that changes the wire mapping
 * or the { data, error } result shape fails CI instead of production.
 *
 * RESEND_BASE_URL must be set before the SDK module loads: resend 4.x reads
 * it once at import time, resend 6.x reads it in the Resend constructor. The
 * module under test is therefore imported dynamically after the env is set.
 * node:test runs each test file in its own process, so no other file has
 * loaded the SDK first.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: unknown;
}

const captured: CapturedRequest[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { id: 'msg_stub_1' } };

const server = createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    raw += chunk;
  });
  req.on('end', () => {
    captured.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    res.writeHead(reply.status, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify(reply.body));
  });
});

const prevBaseUrl = process.env.RESEND_BASE_URL;
const prevKey = process.env.RESEND_API_KEY;

let sendEmail: typeof import('./email.js').sendEmail;
let resetClient: typeof import('./email.js').__resetEmailClientForTests;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.RESEND_API_KEY = 're_integration_test';
  ({ sendEmail, __resetEmailClientForTests: resetClient } = await import('./email.js'));
  resetClient();
});

after(async () => {
  resetClient?.();
  if (prevBaseUrl === undefined) delete process.env.RESEND_BASE_URL;
  else process.env.RESEND_BASE_URL = prevBaseUrl;
  if (prevKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prevKey;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('sendEmail sends the Resend wire format through the real SDK and returns true on 200', async () => {
  captured.length = 0;
  reply = { status: 200, body: { id: 'msg_stub_1' } };

  const ok = await sendEmail({
    from: 'Paracosm <team@frame.dev>',
    to: 'person@example.com',
    subject: 'You are on the list',
    html: '<p>hi</p>',
    text: 'hi',
    replyTo: 'team@frame.dev',
  });

  assert.equal(ok, true);
  assert.equal(captured.length, 1);
  const [req] = captured;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/emails');
  assert.equal(req.headers.authorization, 'Bearer re_integration_test');
  assert.match(String(req.headers['content-type']), /application\/json/);
  assert.match(String(req.headers['user-agent']), /^resend-node:/);
  // camelCase replyTo must reach the API as snake_case reply_to.
  assert.deepEqual(req.body, {
    from: 'Paracosm <team@frame.dev>',
    to: 'person@example.com',
    subject: 'You are on the list',
    html: '<p>hi</p>',
    text: 'hi',
    reply_to: 'team@frame.dev',
  });
});

test('sendEmail returns false when the Resend API rejects the request', async () => {
  captured.length = 0;
  reply = {
    status: 422,
    body: { statusCode: 422, name: 'validation_error', message: 'Invalid `from` field.' },
  };

  const ok = await sendEmail({
    from: 'not-an-address',
    to: 'person@example.com',
    subject: 'subject',
    html: '<p>x</p>',
    text: 'x',
  });

  assert.equal(ok, false);
  assert.equal(captured.length, 1);
});
