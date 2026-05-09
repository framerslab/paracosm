import test from 'node:test';
import assert from 'node:assert/strict';

import {
  linearQuantile,
  projectQuantileBands,
  popSeries,
  moraleSeries,
  bandRange,
  normalizeBand,
  type QuantileBand,
} from './distribution.helpers.js';
import type { ActorSideState, GameState } from '../../hooks/useGameState';

function fakeActor(popHistory: number[] = [], moraleHistory: number[] = []): ActorSideState {
  return {
    leader: { name: 'A', archetype: 'X', unit: 'U', hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 } },
    event: null,
    events: [],
    popHistory,
    moraleHistory,
    deaths: 0,
    deathCauses: {},
    tools: 0,
    toolNames: new Set<string>(),
    citations: 0,
    decisions: 0,
    pendingDecision: '',
    pendingRationale: '',
  } as unknown as ActorSideState;
}

function makeState(actors: Array<{ id: string; pop?: number[]; morale?: number[] }>): GameState {
  const ids = actors.map(a => a.id);
  const map: Record<string, ActorSideState> = {};
  for (const a of actors) map[a.id] = fakeActor(a.pop ?? [], a.morale ?? []);
  return { actorIds: ids, actors: map } as unknown as GameState;
}

test('linearQuantile: empty array returns 0', () => {
  assert.equal(linearQuantile([], 0.5), 0);
});

test('linearQuantile: single value returns the value at any p', () => {
  assert.equal(linearQuantile([42], 0), 42);
  assert.equal(linearQuantile([42], 0.5), 42);
  assert.equal(linearQuantile([42], 1), 42);
});

test('linearQuantile: type-7 median of [1,2,3,4,5] is 3', () => {
  assert.equal(linearQuantile([1, 2, 3, 4, 5], 0.5), 3);
});

test('linearQuantile: type-7 Q1 of [1,2,3,4,5] is 2', () => {
  assert.equal(linearQuantile([1, 2, 3, 4, 5], 0.25), 2);
});

test('linearQuantile: type-7 Q3 of [1,2,3,4,5] is 4', () => {
  assert.equal(linearQuantile([1, 2, 3, 4, 5], 0.75), 4);
});

test('linearQuantile: even-length linear interpolates between middle values', () => {
  // [10, 20, 30, 40] median should be 25
  assert.equal(linearQuantile([10, 20, 30, 40], 0.5), 25);
});

test('linearQuantile: clamps p outside [0,1]', () => {
  assert.equal(linearQuantile([1, 2, 3], -1), 1, 'p < 0 → min');
  assert.equal(linearQuantile([1, 2, 3], 2), 3, 'p > 1 → max');
});

test('projectQuantileBands: empty state → empty bands', () => {
  assert.deepEqual(projectQuantileBands({ actorIds: [], actors: {} } as unknown as GameState, popSeries), []);
});

test('projectQuantileBands: one band per turn at least one actor reached', () => {
  // 3 actors, all 3 turns deep; single value per turn for clarity.
  const state = makeState([
    { id: 'a', pop: [10, 20, 30] },
    { id: 'b', pop: [12, 18, 28] },
    { id: 'c', pop: [14, 22, 25] },
  ]);
  const bands = projectQuantileBands(state, popSeries);
  assert.equal(bands.length, 3);
  assert.equal(bands[0].turn, 1);
  assert.equal(bands[0].n, 3);
  assert.equal(bands[0].min, 10);
  assert.equal(bands[0].max, 14);
  assert.equal(bands[0].median, 12);
});

test('projectQuantileBands: stragglers do not back-fill — n drops as actors fall behind', () => {
  // Actor 'a' reached turn 3, 'b' only got to 2, 'c' only got to 1.
  const state = makeState([
    { id: 'a', pop: [10, 11, 12] },
    { id: 'b', pop: [20, 21] },
    { id: 'c', pop: [30] },
  ]);
  const bands = projectQuantileBands(state, popSeries);
  assert.equal(bands.length, 3, 'should have one band for each turn at least one actor reached');
  assert.equal(bands[0].n, 3, 'turn 1 has all 3 actors');
  assert.equal(bands[1].n, 2, 'turn 2 has 2 actors');
  assert.equal(bands[2].n, 1, 'turn 3 has 1 actor');
});

test('projectQuantileBands: skips turns no actor reached (no holes in the band list)', () => {
  // No actor has any data — no bands.
  const state = makeState([
    { id: 'a', pop: [] },
    { id: 'b', pop: [] },
  ]);
  assert.deepEqual(projectQuantileBands(state, popSeries), []);
});

test('projectQuantileBands: morale picker reads moraleHistory', () => {
  const state = makeState([
    { id: 'a', pop: [10], morale: [80, 70, 60] },
    { id: 'b', pop: [10], morale: [85, 75, 50] },
  ]);
  const bands = projectQuantileBands(state, moraleSeries);
  assert.equal(bands.length, 3);
  assert.equal(bands[0].max, 85);
  assert.equal(bands[2].min, 50);
});

test('bandRange: lo/hi span across all bands', () => {
  const bands: QuantileBand[] = [
    { turn: 1, n: 3, min: 10, q1: 11, median: 12, q3: 13, max: 14 },
    { turn: 2, n: 3, min: 15, q1: 16, median: 17, q3: 18, max: 22 },
    { turn: 3, n: 3, min: 9,  q1: 10, median: 11, q3: 12, max: 13 },
  ];
  assert.deepEqual(bandRange(bands), { lo: 9, hi: 22 });
});

test('bandRange: empty input returns 0..1 fallback', () => {
  assert.deepEqual(bandRange([]), { lo: 0, hi: 1 });
});

test('bandRange: zero-span (all values equal) pads ±1 so the band has height', () => {
  const bands: QuantileBand[] = [
    { turn: 1, n: 1, min: 50, q1: 50, median: 50, q3: 50, max: 50 },
  ];
  assert.deepEqual(bandRange(bands), { lo: 49, hi: 51 });
});

test('normalizeBand: maps quantiles to [0,1] fractions', () => {
  const b: QuantileBand = { turn: 1, n: 3, min: 0, q1: 25, median: 50, q3: 75, max: 100 };
  const n = normalizeBand(b, 0, 100);
  assert.equal(n.min, 0);
  assert.equal(n.q1, 0.25);
  assert.equal(n.median, 0.5);
  assert.equal(n.q3, 0.75);
  assert.equal(n.max, 1);
});

test('normalizeBand: zero span → all 0.5 (centered fallback)', () => {
  const b: QuantileBand = { turn: 1, n: 1, min: 7, q1: 7, median: 7, q3: 7, max: 7 };
  const n = normalizeBand(b, 7, 7);
  assert.equal(n.min, 0.5);
  assert.equal(n.median, 0.5);
});
