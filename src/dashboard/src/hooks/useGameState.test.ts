/**
 * Pure-logic tests for useGameState's reducer. The hook wraps the
 * reducer in useMemo so tests import the extracted pure function
 * computeGameState directly, matching the dashboard's existing test
 * pattern (see useRetryStats.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from './useSSE';
import {
  computeGameState,
  getActorColorVar,
  type MetricsState,
} from './useGameState';

const baseMetrics: MetricsState = {
  population: 100, morale: 0.8, foodMonthsReserve: 12, waterLitersPerDay: 800,
  powerKw: 400, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 0,
};

const mkTurnStart = (
  leader: string,
  turn: number,
  extras: Partial<MetricsState> = {},
): SimEvent => ({
  type: 'turn_start',
  leader,
  turn,
  data: {
    turn,
    time: 2035,
    title: `Turn ${turn} event`,
    metrics: { ...baseMetrics, ...extras },
  },
});

test('computeGameState: initial state has empty leaders map + empty actorIds', () => {
  const state = computeGameState([], false);
  assert.deepEqual(state.actors, {});
  assert.deepEqual(state.actorIds, []);
  assert.equal(state.turn, 0);
  assert.equal(state.isRunning, false);
  assert.equal(state.isComplete, false);
});

test('computeGameState: first turn_start for Alice appends her to actorIds', () => {
  const state = computeGameState([mkTurnStart('Alice', 1)], false);
  assert.deepEqual(state.actorIds, ['Alice']);
  assert.ok(state.actors.Alice, 'Alice has a state entry');
  assert.equal(state.actors.Alice.metrics?.population, 100);
});

test('computeGameState: second leader appended in launch order', () => {
  const events = [mkTurnStart('Alice', 1), mkTurnStart('Bob', 1)];
  const state = computeGameState(events, false);
  assert.deepEqual(state.actorIds, ['Alice', 'Bob']);
});

test('computeGameState: Bob arriving first preserves launch order (Bob at index 0)', () => {
  const events = [mkTurnStart('Bob', 1), mkTurnStart('Alice', 1)];
  const state = computeGameState(events, false);
  assert.deepEqual(state.actorIds, ['Bob', 'Alice'], 'launch order preserved');
});

test('computeGameState: third+ leader no longer capped at 2 (future arena-ready)', () => {
  const events = [
    mkTurnStart('Alice', 1),
    mkTurnStart('Bob', 1),
    mkTurnStart('Cleo', 1),
  ];
  const state = computeGameState(events, false);
  assert.deepEqual(state.actorIds, ['Alice', 'Bob', 'Cleo']);
  assert.ok(state.actors.Cleo, 'third leader stored (old hook dropped events beyond slot 2)');
});

test('computeGameState: events for an existing leader update that leader only', () => {
  const events = [
    mkTurnStart('Alice', 1, { population: 100 }),
    mkTurnStart('Alice', 2, { population: 95 }),
    mkTurnStart('Bob', 1, { population: 80 }),
  ];
  const state = computeGameState(events, false);
  assert.equal(state.actors.Alice.metrics?.population, 95, 'Alice updated');
  assert.equal(state.actors.Bob.metrics?.population, 80, 'Bob independent');
});

test('computeGameState: isComplete flag propagates', () => {
  const state = computeGameState([mkTurnStart('Alice', 1)], true);
  assert.equal(state.isComplete, true);
});

test('computeGameState: status phase=parallel with 2 actors populates both', () => {
  const statusEvent: SimEvent = {
    type: 'status',
    leader: '',
    data: {
      phase: 'parallel',
      maxTurns: 3,
      actors: [
        { name: 'Alice', archetype: 'Pragmatist', unit: 'Alpha', hexaco: {} },
        { name: 'Bob', archetype: 'Visionary', unit: 'Beta', hexaco: {} },
      ],
    },
  };
  const state = computeGameState([statusEvent], false);
  assert.equal(state.maxTurns, 3);
  assert.deepEqual(state.actorIds, ['Alice', 'Bob']);
  assert.equal(state.actors.Alice.leader?.name, 'Alice');
  assert.equal(state.actors.Bob.leader?.name, 'Bob');
});

test('computeGameState: sim_aborted in events forces isRunning=false even with parallel status', () => {
  const statusEvent: SimEvent = {
    type: 'status',
    leader: '',
    data: {
      phase: 'parallel',
      actors: [{ name: 'Alice', archetype: 'P', unit: 'A', hexaco: {} }],
    },
  };
  const abortEvent: SimEvent = {
    type: 'sim_aborted',
    leader: 'Alice',
    data: { reason: 'disconnect', turn: 1 },
  };
  const state = computeGameState([statusEvent, abortEvent], false);
  assert.equal(state.isRunning, false, 'abort overrides status-parallel-driven isRunning=true');
});

test('getActorColorVar: 8-slot palette + wrapping past slot 7', () => {
  // The cohort palette extends beyond the original A/B pair. Slots are:
  //   0:vis, 1:eng, 2:rust, 3:green, 4:violet, 5:coral, 6:sky, 7:olive
  // Past slot 7 the index wraps via modulo so 8 -> 0, 15 -> 7.
  assert.equal(getActorColorVar(0), 'var(--vis)');
  assert.equal(getActorColorVar(1), 'var(--eng)');
  assert.equal(getActorColorVar(2), 'var(--rust)');
  assert.equal(getActorColorVar(3), 'var(--green)');
  assert.equal(getActorColorVar(7), 'var(--olive)');
  assert.equal(getActorColorVar(8), 'var(--vis)', 'wraps to slot 0 after slot 7');
  assert.equal(getActorColorVar(15), 'var(--olive)', 'wraps to slot 7 at index 15');
});

test('computeGameState: outcome event clears pendingDecision (DECIDING chip drops)', () => {
  const decisionEvent: SimEvent = {
    type: 'decision_made',
    leader: 'Alice',
    data: { decision: 'seal_breach', rationale: 'safety first', reasoning: 'CoT', selectedPolicies: [] },
  };
  const outcomeEvent: SimEvent = {
    type: 'outcome',
    leader: 'Alice',
    data: { turn: 1, time: 2035, outcome: 'success', category: 'engineering' },
  };
  const state = computeGameState([decisionEvent, outcomeEvent], false);
  assert.equal(state.actors.Alice.pendingDecision, '', 'pending cleared after outcome');
  assert.equal(state.actors.Alice.decisions, 1, 'decision counted');
});

test('computeGameState: turn_start clears stale pendingDecision from a prior turn', () => {
  // Simulates the failure mode: orchestrator emitted decision_made but the
  // event-loop catch block ran (provider/schema error) so no outcome fired.
  // Next turn_start MUST reset the slot or DECIDING pins forever.
  const decisionEvent: SimEvent = {
    type: 'decision_made',
    leader: 'Alice',
    data: { decision: 'half_measure', rationale: 'unsure', reasoning: '', selectedPolicies: [] },
  };
  const nextTurn: SimEvent = {
    type: 'turn_start',
    leader: 'Alice',
    turn: 2,
    data: { turn: 2, time: 2036, title: 'Next event', metrics: { ...baseMetrics } },
  };
  const state = computeGameState([decisionEvent, nextTurn], false);
  assert.equal(state.actors.Alice.pendingDecision, '', 'stale pending cleared on new turn');
});

test('computeGameState: terminal state (isComplete) clears every actor\'s lingering pendingDecision', () => {
  // Simulates the user-reported bug: 8-actor cohort run finishes, but the
  // last turn errored mid-event-loop for 2 actors. Their pendingDecision
  // is still set when isComplete=true. The reconciliation pass must clear
  // everyone so the cards don't render DECIDING into a finished run.
  const decideAlice: SimEvent = { type: 'decision_made', leader: 'Alice', data: { decision: 'X', rationale: '', reasoning: '', selectedPolicies: [] } };
  const decideBob: SimEvent = { type: 'decision_made', leader: 'Bob', data: { decision: 'Y', rationale: '', reasoning: '', selectedPolicies: [] } };
  const outcomeAlice: SimEvent = { type: 'outcome', leader: 'Alice', data: { turn: 6, time: 2040, outcome: 'success', category: 'engineering' } };
  // Bob never gets outcome — his pendingDecision lingers.
  const state = computeGameState([decideAlice, decideBob, outcomeAlice], /* isComplete */ true);
  assert.equal(state.actors.Alice.pendingDecision, '', 'Alice cleared via outcome');
  assert.equal(state.actors.Bob.pendingDecision, '', 'Bob cleared via isComplete reconciliation');
});
