import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isJumpReveal, golRevealAlpha } from './golReveal';

const approx = (actual: number, expected: number, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tol, `expected ${actual} ≈ ${expected}`);

describe('isJumpReveal', () => {
  it('eases in the first seed, whatever turn it lands on', () => {
    assert.equal(isJumpReveal(-1, 1), true);
    assert.equal(isJumpReveal(-1, 6), true);
  });

  it('reseeds a single-turn step in place, forward or back', () => {
    assert.equal(isJumpReveal(5, 6), false);
    assert.equal(isJumpReveal(6, 5), false);
    assert.equal(isJumpReveal(3, 3), false);
  });

  it('eases in a jump of more than one turn, forward or back', () => {
    assert.equal(isJumpReveal(1, 6), true);
    assert.equal(isJumpReveal(6, 1), true);
  });
});

describe('golRevealAlpha', () => {
  it('starts at 0 and reaches the base alpha at the end of the duration', () => {
    assert.equal(golRevealAlpha(0.65, 0, 500, false), 0);
    approx(golRevealAlpha(0.65, 500, 500, false), 0.65);
    approx(golRevealAlpha(0.65, Number.POSITIVE_INFINITY, 500, false), 0.65);
  });

  it('clamps a negative elapsed time to 0', () => {
    assert.equal(golRevealAlpha(0.22, -100, 500, false), 0);
  });

  it('is front-loaded: past the linear half at the midpoint, and rising', () => {
    const quarter = golRevealAlpha(0.22, 125, 500, false);
    const half = golRevealAlpha(0.22, 250, 500, false);
    assert.ok(quarter < half && half < golRevealAlpha(0.22, 375, 500, false));
    assert.ok(half > 0.11);
  });

  it('gives the base alpha at once under reduced motion or a zero duration', () => {
    approx(golRevealAlpha(0.22, 0, 500, true), 0.22);
    approx(golRevealAlpha(0.5, 0, 0, false), 0.5);
  });
});
