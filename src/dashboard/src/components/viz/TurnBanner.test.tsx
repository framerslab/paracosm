/**
 * The turn banner's loss clause, from the frames the engine sends through the
 * page's own reducer. A turn's `turn_done` names its deaths by cause, and a
 * turn often has more than one cause, so the line gives the total and the
 * largest cause's own count; a turn with one cause keeps "N lost to <cause>".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import type { SimEvent } from '../../hooks/useSSE';
import { computeGameState } from '../../hooks/useGameState';
import { TurnBanner } from './TurnBanner';

void React;

const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';

/** One commander's second turn as the orchestrator emits it, with the given deaths by cause. */
function secondTurn(leader: string, deathCauses: Record<string, number>): SimEvent[] {
  const turn = 2;
  const time = 2043;
  const deaths = Object.values(deathCauses).reduce((sum, n) => sum + n, 0);
  const metrics = { population: 30 - deaths, morale: 0.8, foodMonthsReserve: 18, waterLitersPerDay: 800, powerKw: 400, pressurizedVolumeM3: 3000 };
  return [
    { type: 'turn_start', leader, turn, data: { turn, time, title: 'Perchlorate Storm', category: 'environmental', births: 0, deaths, metrics } },
    { type: 'decision_made', leader, turn, data: { turn, time, decision: 'Shelter in the reinforced core.', rationale: '', reasoning: '', selectedPolicies: [], eventIndex: 0 } },
    { type: 'outcome', leader, turn, data: { turn, time, outcome: 'conservative_success', category: 'environmental', emergent: false, systemDeltas: { morale: -0.02 }, eventIndex: 0 } },
    { type: 'turn_done', leader, turn, data: { turn, time, metrics, toolsForged: 0, totalEvents: 1, deathCauses } },
    { type: 'systems_snapshot', leader, turn, data: { turn, time, agents: [], population: 30 - deaths, morale: 0.8, foodReserve: 18, births: 0, deaths } },
  ];
}

test('the turn banner gives the total and the largest cause\'s own count when a turn has several causes of death', () => {
  const events: SimEvent[] = [
    { type: 'status', leader: '', data: { phase: 'parallel', actors: [{ name: ARIA, archetype: 'The Visionary' }, { name: DIETRICH, archetype: 'The Engineer' }] } },
    ...secondTurn(ARIA, { 'radiation cancer': 2, accident: 1 }),
    ...secondTurn(DIETRICH, { 'natural causes': 2 }),
  ];
  const html = renderToString(<TurnBanner state={computeGameState(events, true)} currentTurn={1} />);

  // Three died under Aria Chen, two of them of radiation cancer.
  assert.match(html, /Aria Chen chose shelter in the reinforced core, 3 lost, 2 to radiation cancer/);
  assert.doesNotMatch(html, /3 lost to radiation cancer/);
  // Both of Dietrich Voss's deaths share one cause.
  assert.match(html, /Dietrich Voss chose shelter in the reinforced core, 2 lost to natural causes/);
});
