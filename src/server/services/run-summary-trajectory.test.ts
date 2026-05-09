import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSummaryTrajectory } from './run-summary-trajectory.js';

test('samples evenly across trajectory.points using preferred metric', () => {
  const artifact = {
    trajectory: {
      points: Array.from({ length: 100 }, (_, i) => ({ time: i, metrics: { population: i * 2, morale: 0.5 } })),
    },
  };
  const out = extractSummaryTrajectory(artifact as never, 8);
  assert.equal(out.length, 8);
  // Preferred is "population" (first in PREFERRED_METRICS that exists).
  assert.equal(out[0], 0);
  assert.equal(out[7], 198);
});

test('falls back to morale when population missing', () => {
  const artifact = {
    trajectory: {
      points: [
        { time: 0, metrics: { morale: 0.5, food: 100 } },
        { time: 1, metrics: { morale: 0.6, food: 95 } },
      ],
    },
  };
  const out = extractSummaryTrajectory(artifact as never, 8);
  assert.deepEqual(out, [0.5, 0.6]);
});

test('falls back to first metric key when no preferred present', () => {
  const artifact = {
    trajectory: {
      points: [
        { time: 0, metrics: { custom_score: 10 } },
        { time: 1, metrics: { custom_score: 20 } },
      ],
    },
  };
  const out = extractSummaryTrajectory(artifact as never, 8);
  assert.deepEqual(out, [10, 20]);
});

test('returns empty array when artifact has no trajectory', () => {
  assert.deepEqual(extractSummaryTrajectory({}, 8), []);
});

test('returns shorter array when fewer points than n', () => {
  const artifact = {
    trajectory: {
      points: [
        { time: 0, metrics: { population: 1 } },
        { time: 1, metrics: { population: 2 } },
        { time: 2, metrics: { population: 3 } },
      ],
    },
  };
  assert.deepEqual(extractSummaryTrajectory(artifact as never, 8), [1, 2, 3]);
});

test('handles batch-point mode (no trajectory.points) by returning []', () => {
  const artifact = { metadata: { mode: 'batch-point' } };
  assert.deepEqual(extractSummaryTrajectory(artifact as never, 8), []);
});

test('returns [] when points exist but have no metrics at all', () => {
  const artifact = { trajectory: { points: [{ time: 0 }, { time: 1 }] } };
  assert.deepEqual(extractSummaryTrajectory(artifact as never, 8), []);
});

test('coerces non-finite values to 0 (defensive)', () => {
  const artifact = {
    trajectory: { points: [
      { time: 0, metrics: { population: Number.NaN } },
      { time: 1, metrics: { population: 5 } },
    ] },
  };
  const out = extractSummaryTrajectory(artifact as never, 4);
  assert.equal(out[0], 0);
  assert.equal(out[1], 5);
});
