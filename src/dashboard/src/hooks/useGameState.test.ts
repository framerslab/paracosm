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

test('getActorColorVar: index 0 -> vis, 1 -> eng, 2+ -> amber fallback', () => {
  assert.equal(getActorColorVar(0), 'var(--vis)');
  assert.equal(getActorColorVar(1), 'var(--eng)');
  assert.equal(getActorColorVar(2), 'var(--amber)');
  assert.equal(getActorColorVar(9), 'var(--amber)');
});
