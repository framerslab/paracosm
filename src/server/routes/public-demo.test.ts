import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handlePublicDemoRoute } from './public-demo.js';

function fakeReq(url: string | undefined, method = 'GET'): IncomingMessage {
  return { url, method } as IncomingMessage;
}

function fakeRes() {
  let written = false;
  let status = 0;
  let body = '';
  const res = {
    writeHead: (s: number) => { status = s; written = true; },
    end: (b?: string) => { if (b) body = b; },
  } as unknown as ServerResponse;
  return { res, get: () => ({ written, status, body: body ? JSON.parse(body) : null }) };
}

test('handlePublicDemoRoute: returns false on malformed url ("//") instead of throwing', () => {
  const { res } = fakeRes();
  // Without the URL try/catch this used to throw `TypeError: Invalid URL`
  // and crash the request handler; server logs had a flood of these from
  // bot/CF probes. Now we return false (not our route) and let the next
  // handler in the chain see the request.
  const ok = handlePublicDemoRoute('hosted_demo', fakeReq('//'), res, {});
  assert.equal(ok, false);
});

test('handlePublicDemoRoute: returns false on missing url', () => {
  const { res } = fakeRes();
  const ok = handlePublicDemoRoute('hosted_demo', fakeReq(undefined), res, {});
  assert.equal(ok, false);
});

test('handlePublicDemoRoute: returns false on non-matching path', () => {
  const { res } = fakeRes();
  const ok = handlePublicDemoRoute('hosted_demo', fakeReq('/something/else'), res, {});
  assert.equal(ok, false);
});

test('handlePublicDemoRoute: returns true + 200 on /api/v1/demo/status GET', () => {
  const { res, get } = fakeRes();
  const ok = handlePublicDemoRoute('hosted_demo', fakeReq('/api/v1/demo/status', 'GET'), res, {});
  assert.equal(ok, true);
  const out = get();
  assert.equal(out.status, 200);
  assert.equal(out.body.mode, 'hosted_demo');
});

test('handlePublicDemoRoute: rejects POST', () => {
  const { res } = fakeRes();
  const ok = handlePublicDemoRoute('hosted_demo', fakeReq('/api/v1/demo/status', 'POST'), res, {});
  assert.equal(ok, false);
});
