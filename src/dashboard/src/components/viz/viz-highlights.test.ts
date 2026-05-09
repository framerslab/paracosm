import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTurnHighlight, snapToHighlight, type HighlightInput } from './viz-highlights';
import type { TurnSnapshot } from './viz-types';

const baseInput: HighlightInput = {
  population: 100,
  morale: 0.85,
  deathsThisTurn: 0,
  birthsThisTurn: 0,
  eventCategories: [],
  year: 2035,
};

describe('computeTurnHighlight', () => {
  it('mass deaths on one side win over morale wobble', () => {
    const a: HighlightInput = { ...baseInput, deathsThisTurn: 0, year: 2051 };
    const b: HighlightInput = { ...baseInput, deathsThisTurn: 4, year: 2051 };
    const out = computeTurnHighlight(a, b, 3);
    assert.match(out, /Turn 3/);
    assert.match(out, /Leader B/);
    assert.match(out, /4/);
  });

  it('morale crash beats no-deaths/no-events case', () => {
    const a: HighlightInput = { ...baseInput, morale: 0.17, year: 2067 };
    const b: HighlightInput = { ...baseInput, morale: 0.47, year: 2067 };
    const out = computeTurnHighlight(a, b, 5);
    assert.match(out, /morale collapsed/i);
    assert.match(out, /17%|47%/);
  });

  it('event-category divergence is reported when state matches', () => {
    const a: HighlightInput = { ...baseInput, eventCategories: ['environmental'], year: 2043 };
    const b: HighlightInput = { ...baseInput, eventCategories: ['social'], year: 2043 };
    const out = computeTurnHighlight(a, b, 2);
    assert.match(out, /different events/i);
  });

  it('identical first event short-circuits to "identical"', () => {
    const a: HighlightInput = { ...baseInput, eventCategories: ['onboarding'] };
    const b: HighlightInput = { ...baseInput, eventCategories: ['onboarding'] };
    const out = computeTurnHighlight(a, b, 1);
    assert.match(out, /identical/i);
  });

  it('null snapshots fall through to neutral copy', () => {
    const out = computeTurnHighlight(null, null, 0);
    assert.match(out, /awaiting first turn/i);
  });

  it('snapToHighlight derives turn-deltas from cumulative deaths/births', () => {
    const prev: TurnSnapshot = {
      turn: 1,
      time: 2035,
      cells: [],
      population: 100,
      morale: 0.85,
      foodReserve: 18,
      deaths: 0,
      births: 0,
    };
    const current: TurnSnapshot = {
      turn: 2,
      time: 2043,
      cells: [],
      population: 96,
      morale: 0.65,
      foodReserve: 14,
      deaths: 4,
      births: 0,
      eventCategories: ['environmental'],
    };
    const input = snapToHighlight(current, prev);
    assert.equal(input.deathsThisTurn, 4);
    assert.equal(input.birthsThisTurn, 0);
    assert.deepEqual(input.eventCategories, ['environmental']);
    assert.equal(input.year, 2043);
  });
});
