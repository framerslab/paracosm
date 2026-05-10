import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWaitlist, type WaitlistRouteDeps } from './waitlist.js';
import { IncomingMessage, ServerResponse } from 'node:http';

function fakeReq(ip = '9.9.9.9'): IncomingMessage {
  const req = {
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
  return req;
}

interface CaptureRes {
  res: ServerResponse;
  status: () => number;
  body: () => unknown;
}

function fakeRes(): CaptureRes {
  let status = 200;
  let body: unknown;
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code: number) { status = code; },
    end(b?: string) { body = b ? JSON.parse(b) : undefined; },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => body,
  };
}

function makeDeps(over: Partial<WaitlistRouteDeps> = {}): WaitlistRouteDeps {
  return {
    waitlistStore: {
      insertOrGetExisting: async () => ({ id: 1, position: 1, alreadyExisted: false }),
      count: async () => 1,
      findByEmail: async () => null,
      listAll: async () => [],
    },
    sendEmail: async () => true,
    rateLimiter: {
      consumeWaitlist: () => ({ allowed: true, remaining: 0, resetAt: Date.now() + 1000, limit: 1 }),
      getClientIp: (req) => (req.headers['x-forwarded-for'] as string) ?? '0.0.0.0',
    },
    waitlistFrom: 'Paracosm <team@frame.dev>',
    ...over,
  };
}

test('POST /api/waitlist returns 200 + position on success', async () => {
  const deps = makeDeps();
  const { res, status, body } = fakeRes();
  await handleWaitlist(fakeReq(), res, JSON.stringify({ email: 'good@x.co', name: 'G' }), deps);
  assert.equal(status(), 200);
  assert.deepEqual(body(), { ok: true, position: 1, alreadyOnList: false, emailSent: true });
});

test('POST /api/waitlist returns 200 + alreadyOnList on dedup, no email sent', async () => {
  let sendEmailCalls = 0;
  const deps = makeDeps({
    waitlistStore: {
      insertOrGetExisting: async () => ({ id: 1, position: 1, alreadyExisted: true }),
      count: async () => 1,
      findByEmail: async () => null,
      listAll: async () => [],
    },
    sendEmail: async () => { sendEmailCalls++; return true; },
  });
  const { res, status, body } = fakeRes();
  await handleWaitlist(fakeReq(), res, JSON.stringify({ email: 'dup@x.co' }), deps);
  assert.equal(status(), 200);
  assert.deepEqual(body(), { ok: true, position: 1, alreadyOnList: true, emailSent: false });
  assert.equal(sendEmailCalls, 0);
});

test('POST /api/waitlist returns 400 on bad email', async () => {
  const deps = makeDeps();
  const { res, status, body } = fakeRes();
  await handleWaitlist(fakeReq(), res, JSON.stringify({ email: 'not-an-email' }), deps);
  assert.equal(status(), 400);
  const parsed = body() as { error?: string };
  assert.match(parsed.error ?? '', /[Ii]nvalid/);
});

test('POST /api/waitlist returns 429 when rate-limited', async () => {
  const deps = makeDeps({
    rateLimiter: {
      consumeWaitlist: () => ({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000, limit: 1 }),
      getClientIp: () => '0.0.0.0',
    },
  });
  const { res, status } = fakeRes();
  await handleWaitlist(fakeReq(), res, JSON.stringify({ email: 'a@x.co' }), deps);
  assert.equal(status(), 429);
});

test('POST /api/waitlist returns 200 + emailSent:false when send fails', async () => {
  const deps = makeDeps({ sendEmail: async () => false });
  const { res, status, body } = fakeRes();
  await handleWaitlist(fakeReq(), res, JSON.stringify({ email: 'a@x.co' }), deps);
  assert.equal(status(), 200);
  const parsed = body() as { emailSent: boolean };
  assert.equal(parsed.emailSent, false);
});

test('POST /api/waitlist rejects useCase larger than 2000 chars', async () => {
  const deps = makeDeps();
  const { res, status } = fakeRes();
  const huge = 'x'.repeat(2001);
  await handleWaitlist(fakeReq(), res, JSON.stringify({ email: 'a@x.co', useCase: huge }), deps);
  assert.equal(status(), 400);
});
