import test from 'node:test';
import assert from 'node:assert/strict';

import { extractNodeStats } from './constellation-stats.js';
import type { GameState, ActorSideState, ProcessedEvent } from '../../hooks/useGameState.js';

function side(events: ProcessedEvent[], pop: number[], morale: number[], decisions = 0, tools = 0, deaths = 0): ActorSideState {
  return {
    leader: null,
    metrics: null, prevMetrics: null, event: null, events,
    popHistory: pop, moraleHistory: morale,
    deaths, deathCauses: {}, tools, toolNames: new Set(),
    citations: 0, decisions, pendingDecision: '', pendingRationale: '',
    pendingReasoning: '', pendingPolicies: [], outcome: null,
    agentSnapshots: [], currentEvents: [],
  } as ActorSideState;
}

const stateWith = (events: ProcessedEvent[], pop: number[], morale: number[], decisions = 0, tools = 0, deaths = 0): GameState => ({
  actors: { 'A': side(events, pop, morale, decisions, tools, deaths) },
  actorIds: ['A'],
  turn: 1, maxTurns: 6, isRunning: true, isComplete: false,
  meta: null, cost: null,
} as unknown as GameState);

test('extractNodeStats: empty events → pending, null pop/morale, zero counts', () => {
  const s = extractNodeStats(stateWith([], [], []), 'A');
  assert.equal(s.latestOutcome, 'pending');
  assert.equal(s.pop, null);
  assert.equal(s.morale, null);
  assert.equal(s.decisions, 0);
  assert.equal(s.tools, 0);
  assert.equal(s.deaths, 0);
});

test('extractNodeStats: latest outcome with `success` substring → success', () => {
  const s = extractNodeStats(stateWith(
    [{ id: 'o1', type: 'outcome', turn: 1, data: { outcome: 'risky_success' } }],
    [], [],
  ), 'A');
  assert.equal(s.latestOutcome, 'success');
});

test('extractNodeStats: latest outcome with `failure` substring → failure', () => {
  const s = extractNodeStats(stateWith(
    [{ id: 'o1', type: 'outcome', turn: 1, data: { outcome: 'conservative_failure' } }],
    [], [],
  ), 'A');
  assert.equal(s.latestOutcome, 'failure');
});

test('extractNodeStats: pop/morale come from last entry in their histories', () => {
  // moraleHistory is pre-scaled to 0-100 by useGameState (Math.round(metrics.morale * 100)),
  // so the last entry is an integer percent value. Locking the contract here so the
  // ConstellationView display logic (which now reads stats.morale verbatim) doesn't
  // accidentally re-multiply.
  const s = extractNodeStats(stateWith([], [25, 28, 30], [90, 86]), 'A');
  assert.equal(s.pop, 30);
  assert.equal(s.morale, 86);
});

test('extractNodeStats: counts pull from pre-counted state fields, not events walk', () => {
  const s = extractNodeStats(stateWith([], [], [], 4, 2, 7), 'A');
  assert.equal(s.decisions, 4);
  assert.equal(s.tools, 2);
  assert.equal(s.deaths, 7);
});

test('extractNodeStats: missing actor → pending zeros', () => {
  const s = extractNodeStats(stateWith([], [], []), 'NONEXISTENT');
  assert.equal(s.latestOutcome, 'pending');
  assert.equal(s.pop, null);
  assert.equal(s.decisions, 0);
});
