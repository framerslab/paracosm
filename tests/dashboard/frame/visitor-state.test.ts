import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepVisitorState, visitorState } from '../../../src/dashboard/src/components/layout/visitorState.js';

type Inputs = Parameters<typeof visitorState>[0];
const demo = { status: 'ready', hostedDemo: true } as const;
const server = { status: 'ready', hostedDemo: false } as const;
const pending = { status: 'loading' } as const;
const unknown = { status: 'error' } as const;
const count = (remaining: number): Inputs['rateLimit'] => ({
  status: 'ready', answer: { allowed: remaining > 0, remaining, limit: 3, resetAt: 1000 },
});
const unlimited = { status: 'unlimited' } as const;
const ownWords = { long: 'Your API key', short: 'Your key' };
const serverWords = { long: "This server's API keys", short: 'Server keys' };
const oneRun = { long: 'Free demo: 1 run left today', short: '1 free run' };
const noRuns = { long: 'Free demo: no run left today', short: 'No free run' };

test('visitor state follows the payer and the returned free-run count in order', () => {
  assert.deepEqual(visitorState({ ownKey: true, adminConfig: pending, rateLimit: count(0) }), ownWords);
  assert.equal(visitorState({ ownKey: false, adminConfig: pending, rateLimit: count(1) }), null);
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: server, rateLimit: count(1) }), serverWords);
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: demo, rateLimit: count(1) }), oneRun);
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: demo, rateLimit: count(0) }), noRuns);
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: demo, rateLimit: count(3) }), {
    long: 'Free demo: 3 runs left today', short: '3 free runs',
  });
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: unknown, rateLimit: unlimited }), serverWords);
  assert.equal(visitorState({ ownKey: false, adminConfig: demo, rateLimit: unlimited }), null);
  assert.equal(visitorState({ ownKey: false, adminConfig: demo, rateLimit: unknown }), null);
});

test('the current visitor state replaces the last known state, which survives a failed read', () => {
  assert.equal(keepVisitorState(null, null), null);
  assert.equal(keepVisitorState(null, oneRun), oneRun);
  assert.equal(keepVisitorState(oneRun, null), oneRun);
  assert.equal(keepVisitorState(oneRun, noRuns), noRuns);
});

test('a removed provider key does not keep its payer words through an unknown answer', () => {
  // The last key went from Settings while the free-run count could not be read.
  assert.equal(keepVisitorState(ownWords, null), null);
  assert.equal(keepVisitorState(ownWords, oneRun), oneRun);
});
