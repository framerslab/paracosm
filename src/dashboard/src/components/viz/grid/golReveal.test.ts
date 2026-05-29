import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isJumpReveal, golRevealAlpha } from './golReveal';

const approx = (actual: number, expected: number, tol = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tol,
    `expected ${actual} ≈ ${expected}`,
  );

describe('isJumpReveal', () => {
  it('does not fire on the initial seed (prevTurn < 0), even at a late turn', () => {
    // First mount is covered by the reveal curtain; the GoL fade must
    // not double up on it.
    assert.equal(isJumpReveal(-1, 1), false);
    assert.equal(isJumpReveal(-1, 6), false);
  });

  it('does not fire on a live single-turn advance', () => {
    assert.equal(isJumpReveal(5, 6), false);
    assert.equal(isJumpReveal(0, 1), false);
  });

  it('does not fire when the turn is unchanged', () => {
    assert.equal(isJumpReveal(3, 3), false);
  });

  it('fires on a forward multi-turn jump (cached load / fast scrub)', () => {
    assert.equal(isJumpReveal(1, 6), true);
  });

  it('fires on a backward jump (re-run reset / scrub back)', () => {
    assert.equal(isJumpReveal(6, 1), true);
    assert.equal(isJumpReveal(6, 4), true);
  });
});

describe('golRevealAlpha', () => {
  it('is 0 at the start of a fade', () => {
    assert.equal(golRevealAlpha(0.22, 0, 500, false), 0);
  });

  it('reaches the base alpha at the end of the duration', () => {
    approx(golRevealAlpha(0.22, 500, 500, false), 0.22);
  });

  it('clamps to base alpha past the duration', () => {
    approx(golRevealAlpha(0.65, 1000, 500, false), 0.65);
  });

  it('treats a huge elapsed (no active fade) as full base alpha', () => {
    approx(golRevealAlpha(0.65, Number.POSITIVE_INFINITY, 500, false), 0.65);
  });

  it('clamps negative elapsed to 0', () => {
    assert.equal(golRevealAlpha(0.22, -100, 500, false), 0);
  });

  it('returns base alpha immediately under reduced motion', () => {
    approx(golRevealAlpha(0.22, 0, 500, true), 0.22);
    approx(golRevealAlpha(0.22, 250, 500, true), 0.22);
  });

  it('is monotonic and front-loaded (ease-out): midpoint exceeds the linear half', () => {
    const base = 0.22;
    const dur = 500;
    const quarter = golRevealAlpha(base, dur * 0.25, dur, false);
    const half = golRevealAlpha(base, dur * 0.5, dur, false);
    const threeQuarter = golRevealAlpha(base, dur * 0.75, dur, false);
    // monotonic increase
    assert.ok(quarter < half && half < threeQuarter);
    // ease-out: at the midpoint we are already past the linear halfway point
    assert.ok(half > base * 0.5);
  });

  it('treats a zero/negative duration as instant (full base alpha)', () => {
    approx(golRevealAlpha(0.5, 0, 0, false), 0.5);
  });
});
