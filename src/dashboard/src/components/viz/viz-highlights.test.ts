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

  it('snapToHighlight takes each turn\'s own deaths and births, never a difference from the turn before', () => {
    // systems_snapshot counts the deaths of its own turn: one death in turn
    // 5 and none in turn 6 is a turn 6 with no deaths, not -1.
    const prev: TurnSnapshot = {
      turn: 5,
      time: 2067,
      cells: [],
      population: 30,
      morale: 0.85,
      deaths: 1,
      births: 2,
    };
    const current: TurnSnapshot = {
      turn: 6,
      time: 2075,
      cells: [],
      population: 31,
      morale: 0.9,
      deaths: 0,
      births: 1,
      eventCategories: ['technological'],
    };
    const input = snapToHighlight(current, prev);
    assert.equal(input.deathsThisTurn, 0);
    assert.equal(input.birthsThisTurn, 1);
    assert.deepEqual(input.eventCategories, ['technological']);
    assert.equal(input.year, 2075);
  });

  it('names who lost how many with the scenario\'s nouns, and none for a side with no deaths', () => {
    const a: HighlightInput = { ...baseInput, deathsThisTurn: 0, year: 2075 };
    const b: HighlightInput = { ...baseInput, deathsThisTurn: 1, year: 2075 };
    const words = { nameA: 'Aria Chen', nameB: 'Dietrich Voss', person: 'crew member', people: 'crew' };
    assert.equal(computeTurnHighlight(a, b, 6, words), 'Turn 6, year 2075: Dietrich Voss lost 1 crew member; Aria Chen lost none.');
    assert.equal(
      computeTurnHighlight({ ...a, deathsThisTurn: 3 }, { ...b, deathsThisTurn: 1 }, 6, words),
      'Turn 6, year 2075: Aria Chen lost 3 crew; Dietrich Voss lost 1 crew member.',
    );
  });
});
