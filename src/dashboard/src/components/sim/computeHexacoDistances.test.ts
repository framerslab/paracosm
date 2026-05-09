import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHexacoDistances } from './computeHexacoDistances.js';

const flat = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 };
const high = { openness: 1, conscientiousness: 1, extraversion: 1, agreeableness: 1, emotionality: 1, honestyHumility: 1 };
const low =  { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, emotionality: 0, honestyHumility: 0 };

test('computeHexacoDistances: 0 actors yields no pairs', () => {
  const out = computeHexacoDistances([]);
  assert.deepEqual(out.pairs, []);
});

test('computeHexacoDistances: 1 actor yields no pairs', () => {
  const out = computeHexacoDistances([{ name: 'a', hexaco: flat }]);
  assert.deepEqual(out.pairs, []);
});

test('computeHexacoDistances: 2 actors → 1 pair', () => {
  const out = computeHexacoDistances([
    { name: 'a', hexaco: flat },
    { name: 'b', hexaco: high },
  ]);
  assert.equal(out.pairs.length, 1);
  assert.equal(out.pairs[0].a, 'a');
  assert.equal(out.pairs[0].b, 'b');
});

test('computeHexacoDistances: 3 actors → 3 pairs (full graph)', () => {
  const out = computeHexacoDistances([
    { name: 'a', hexaco: flat },
    { name: 'b', hexaco: high },
    { name: 'c', hexaco: low },
  ]);
  assert.equal(out.pairs.length, 3);
});

test('computeHexacoDistances: identical actors → distance 0, normalized 0', () => {
  const out = computeHexacoDistances([
    { name: 'a', hexaco: flat },
    { name: 'b', hexaco: { ...flat } },
  ]);
  assert.equal(out.pairs[0].distance, 0);
  assert.equal(out.pairs[0].normalized, 0);
});

test('computeHexacoDistances: max-distance pair (all-0 vs all-1) → normalized 1', () => {
  const out = computeHexacoDistances([
    { name: 'a', hexaco: low },
    { name: 'b', hexaco: high },
  ]);
  assert.equal(out.pairs[0].normalized, 1);
});

test('computeHexacoDistances: normalization uses observed max not theoretical', () => {
  const a = { ...flat, openness: 0.5 };
  const b = { ...flat, openness: 0.6 };
  const c = { ...flat, openness: 0.7 };
  const out = computeHexacoDistances([
    { name: 'a', hexaco: a },
    { name: 'b', hexaco: b },
    { name: 'c', hexaco: c },
  ]);
  const ac = out.pairs.find(p => (p.a === 'a' && p.b === 'c') || (p.a === 'c' && p.b === 'a'));
  assert.ok(ac);
  assert.equal(ac!.normalized, 1);
});

test('computeHexacoDistances: missing hexaco field defaults each axis to 0.5', () => {
  const out = computeHexacoDistances([
    { name: 'a', hexaco: {} as Record<string, number> },
    { name: 'b', hexaco: high },
  ]);
  assert.ok(Math.abs(out.pairs[0].distance - Math.sqrt(1.5)) < 1e-9);
  assert.equal(out.pairs[0].normalized, 1);
});

test('computeHexacoDistances: hasSpread false when every pair distance is 0', () => {
  // All-empty case: every actor defaults each axis to 0.5, so every
  // pair distance is exactly 0. ConstellationView uses this flag to
  // suppress the "0.00" label noise so the surface doesn't read as
  // a uniform-bug when the cause is just "no HEXACO data yet".
  const empty = computeHexacoDistances([
    { name: 'a', hexaco: {} as Record<string, number> },
    { name: 'b', hexaco: {} as Record<string, number> },
    { name: 'c', hexaco: {} as Record<string, number> },
  ]);
  assert.equal(empty.hasSpread, false);
  assert.equal(empty.hasAnyData, false);
  assert.ok(empty.pairs.every((p) => p.distance === 0));

  // Identical-but-populated case: hasSpread is still false, but
  // hasAnyData is true so callers can distinguish "actors are
  // genuinely identical" from "still waiting for data".
  const identical = computeHexacoDistances([
    { name: 'a', hexaco: flat },
    { name: 'b', hexaco: { ...flat } },
  ]);
  assert.equal(identical.hasSpread, false);
  assert.equal(identical.hasAnyData, true);
});

test('computeHexacoDistances: hasSpread true when at least one pair has a non-zero distance', () => {
  const out = computeHexacoDistances([
    { name: 'a', hexaco: flat },
    { name: 'b', hexaco: high },
  ]);
  assert.equal(out.hasSpread, true);
  assert.equal(out.hasAnyData, true);
});
