import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FREE_RUNS, OWN_KEYS, freeRuns } from './frameWords.js';
import { visitorState } from './visitorState.js';

const hostedDemo = { status: 'ready', hostedDemo: true } as const;
const oneLeft = { status: 'ready', answer: { allowed: true, remaining: 1, limit: 1, resetAt: 0 } } as const;

test('visitorState: a launch the server refused at its daily limit reads as no free run', () => {
  // Start reads limitMet as no run left; the header and More say the same,
  // whether the count could not be read again or still shows a run.
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: hostedDemo, rateLimit: { status: 'error' }, limitMet: true }), NO_FREE_RUNS);
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: hostedDemo, rateLimit: oneLeft, limitMet: true }), NO_FREE_RUNS);
  assert.deepEqual(visitorState({ ownKey: false, adminConfig: hostedDemo, rateLimit: oneLeft, limitMet: false }), freeRuns(1));
  assert.deepEqual(visitorState({ ownKey: true, adminConfig: hostedDemo, rateLimit: oneLeft, limitMet: true }), OWN_KEYS);
});
