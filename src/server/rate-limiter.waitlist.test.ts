import test from 'node:test';
import assert from 'node:assert/strict';
import { IpRateLimiter } from './rate-limiter.js';

test('consumeWaitlist allows first submission from a new IP', () => {
  const r = new IpRateLimiter(3, 5, 30, null, 500);
  const decision = r.consumeWaitlist('1.1.1.1');
  assert.equal(decision.allowed, true);
  r.destroy();
});

test('consumeWaitlist rejects a second submission within the cooldown', () => {
  const r = new IpRateLimiter(3, 5, 30, null, 500);
  r.consumeWaitlist('2.2.2.2');
  const second = r.consumeWaitlist('2.2.2.2');
  assert.equal(second.allowed, false);
  assert.ok(second.resetAt > Date.now());
  r.destroy();
});

test('consumeWaitlist is per-IP', () => {
  const r = new IpRateLimiter(3, 5, 30, null, 500);
  r.consumeWaitlist('3.3.3.3');
  const other = r.consumeWaitlist('4.4.4.4');
  assert.equal(other.allowed, true);
  r.destroy();
});
