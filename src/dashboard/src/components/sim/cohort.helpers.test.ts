import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectCohorts,
  reorderByCohort,
  describeCohorts,
  type Cohort,
} from './cohort.helpers.js';
import type { ActorSideState, GameState } from '../../hooks/useGameState';

function fakeActor(archetype: string | null = 'Engineer'): ActorSideState {
  return {
    leader: archetype === null
      ? null
      : { name: 'A', archetype, unit: 'U', hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 } },
    event: null,
    events: [],
    popHistory: [],
    moraleHistory: [],
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

function makeState(actorEntries: Array<[string, string | null]>): GameState {
  const ids = actorEntries.map(([id]) => id);
  const actors: Record<string, ActorSideState> = {};
  for (const [id, archetype] of actorEntries) {
    actors[id] = fakeActor(archetype);
  }
  return { actorIds: ids, actors } as unknown as GameState;
}

test('projectCohorts: groups actors by exact archetype', () => {
  const state = makeState([
    ['a', 'Visionary'],
    ['b', 'Engineer'],
    ['c', 'Visionary'],
    ['d', 'Engineer'],
    ['e', 'Pragmatist'],
  ]);
  const cohorts = projectCohorts(state);
  assert.equal(cohorts.length, 3);
  // Order by first-seen actorId index — Visionary first because actor 'a' was first.
  assert.equal(cohorts[0].label, 'Visionary');
  assert.deepEqual(cohorts[0].ids, ['a', 'c']);
  assert.equal(cohorts[1].label, 'Engineer');
  assert.deepEqual(cohorts[1].ids, ['b', 'd']);
  assert.equal(cohorts[2].label, 'Pragmatist');
  assert.deepEqual(cohorts[2].ids, ['e']);
});

test('projectCohorts: empty actorIds → empty array', () => {
  const cohorts = projectCohorts({ actorIds: [], actors: {} } as unknown as GameState);
  assert.deepEqual(cohorts, []);
});

test('projectCohorts: missing leader info bucketed as Unknown', () => {
  const state = makeState([
    ['a', null],
    ['b', 'Engineer'],
    ['c', null],
  ]);
  const cohorts = projectCohorts(state);
  assert.equal(cohorts.length, 2);
  assert.equal(cohorts[0].label, 'Unknown');
  assert.deepEqual(cohorts[0].ids, ['a', 'c']);
  assert.equal(cohorts[1].label, 'Engineer');
});

test('projectCohorts: whitespace in archetype is trimmed', () => {
  const state = makeState([
    ['a', '  Visionary  '],
    ['b', 'Visionary'],
  ]);
  const cohorts = projectCohorts(state);
  assert.equal(cohorts.length, 1, 'trimmed names should match the un-trimmed name');
  assert.deepEqual(cohorts[0].ids, ['a', 'b']);
});

test('projectCohorts: order is stable across re-projections (no flip on SSE)', () => {
  // Same state shape, two consecutive projections should return the
  // same cohort ordering — used by the constellation re-render path.
  const state = makeState([
    ['a', 'B'],
    ['b', 'A'],
    ['c', 'B'],
    ['d', 'A'],
  ]);
  const first = projectCohorts(state);
  const second = projectCohorts(state);
  assert.deepEqual(first.map(c => c.label), second.map(c => c.label));
  // 'B' first because actor 'a' (archetype B) appears at index 0.
  assert.equal(first[0].label, 'B');
  assert.equal(first[1].label, 'A');
});

test('reorderByCohort: adjacent same-archetype actors on the perimeter', () => {
  const state = makeState([
    ['a', 'X'],
    ['b', 'Y'],
    ['c', 'X'],
    ['d', 'Y'],
    ['e', 'Z'],
  ]);
  const reordered = reorderByCohort(state);
  // X cohort first (a, c), then Y (b, d), then Z (e).
  assert.deepEqual(reordered, ['a', 'c', 'b', 'd', 'e']);
});

test('reorderByCohort: original order preserved within each cohort', () => {
  const state = makeState([
    ['z', 'A'],
    ['m', 'B'],
    ['k', 'A'],
    ['n', 'B'],
  ]);
  const reordered = reorderByCohort(state);
  assert.deepEqual(reordered, ['z', 'k', 'm', 'n']);
});

test('describeCohorts: comma-separated count + label string', () => {
  const cohorts: Cohort[] = [
    { archetype: 'V', label: 'Visionary', ids: ['1', '2', '3', '4', '5', '6', '7', '8'], firstIndex: 0 },
    { archetype: 'E', label: 'Engineer', ids: ['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'], firstIndex: 8 },
    { archetype: 'P', label: 'Pragmatist', ids: ['21', '22', '23', '24', '25', '26', '27', '28', '29', '30'], firstIndex: 20 },
  ];
  assert.equal(describeCohorts(cohorts), '8 Visionary · 12 Engineer · 10 Pragmatist');
});

test('describeCohorts: empty list → empty string', () => {
  assert.equal(describeCohorts([]), '');
});
