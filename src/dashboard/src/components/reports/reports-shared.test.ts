import test from 'node:test';
import assert from 'node:assert/strict';
import {
  outcomeColor,
  classifyTurn,
  collectMetricSeries,
  collectRunStripData,
} from './reports-shared.js';
import type { GameState } from '../../hooks/useGameState';

test('outcomeColor maps known outcome keys to the right CSS variable', () => {
  assert.equal(outcomeColor('conservative_success'), 'var(--green)');
  assert.equal(outcomeColor('risky_success'), 'var(--amber)');
  assert.equal(outcomeColor('conservative_failure'), 'var(--rust-dim, var(--rust))');
  assert.equal(outcomeColor('risky_failure'), 'var(--rust)');
  assert.equal(outcomeColor(undefined), 'var(--text-3)');
  assert.equal(outcomeColor('mystery'), 'var(--text-3)');
});

test('classifyTurn returns shared when both titles match, divergent otherwise', () => {
  assert.equal(classifyTurn('Landfall', 'Landfall'), 'shared');
  assert.equal(classifyTurn('Water crisis', 'Solar storm'), 'divergent');
  assert.equal(classifyTurn(undefined, 'Landfall'), 'divergent');
  assert.equal(classifyTurn('Landfall', undefined), 'divergent');
  assert.equal(classifyTurn(undefined, undefined), 'divergent');
});

test('collectMetricSeries extracts six metrics per side from turn_done events', () => {
  const state = {
    actorIds: ['Alice', 'Bob'],
    actors: {
      Alice: {
        events: [
          { id: '1', type: 'turn_done', turn: 1, data: { metrics: { population: 30, morale: 0.8, foodMonthsReserve: 100, powerKw: 500, infrastructureModules: 5, scienceOutput: 10 } } },
          { id: '2', type: 'turn_done', turn: 2, data: { metrics: { population: 28, morale: 0.7, foodMonthsReserve: 95, powerKw: 480, infrastructureModules: 6, scienceOutput: 15 } } },
        ],
      },
      Bob: {
        events: [
          { id: '3', type: 'turn_done', turn: 1, data: { metrics: { population: 29, morale: 0.75, foodMonthsReserve: 90, powerKw: 450, infrastructureModules: 5, scienceOutput: 12 } } },
        ],
      },
    },
  } as unknown as GameState;

  const metrics = collectMetricSeries(state);
  assert.equal(metrics.length, 6);
  const pop = metrics.find(m => m.id === 'population');
  assert.ok(pop);
  assert.deepEqual(pop!.a, [{ turn: 1, value: 30 }, { turn: 2, value: 28 }]);
  assert.deepEqual(pop!.b, [{ turn: 1, value: 29 }]);
  const morale = metrics.find(m => m.id === 'morale');
  assert.ok(morale);
  assert.deepEqual(morale!.a, [{ turn: 1, value: 0.8 }, { turn: 2, value: 0.7 }]);
});

test('collectMetricSeries drops events without a metrics payload', () => {
  const state = {
    actorIds: ['Alice', 'Bob'],
    actors: {
      Alice: {
        events: [
          { id: '1', type: 'turn_start', turn: 1, data: {} },
          { id: '2', type: 'turn_done', turn: 1, data: { metrics: { population: 30, morale: 0.8, foodMonthsReserve: 100, powerKw: 500, infrastructureModules: 5, scienceOutput: 10 } } },
          { id: '3', type: 'agent_reactions', turn: 1, data: {} },
        ],
      },
      Bob: { events: [] },
    },
  } as unknown as GameState;

  const metrics = collectMetricSeries(state);
  const pop = metrics.find(m => m.id === 'population');
  assert.deepEqual(pop!.a, [{ turn: 1, value: 30 }]);
});

test('collectRunStripData builds a cell per turn with per-side outcome + diverged flag', () => {
  const turns: Array<[number, {
    a: { time?: number; events: Map<number, { title?: string; outcome?: string; category?: string }> };
    b: { time?: number; events: Map<number, { title?: string; outcome?: string; category?: string }> };
  }]> = [
    [1, {
      a: { time: 2035, events: new Map([[0, { title: 'Landfall', outcome: 'risky_success', category: 'infrastructure' }]]) },
      b: { time: 2035, events: new Map([[0, { title: 'Landfall', outcome: 'conservative_success', category: 'infrastructure' }]]) },
    }],
    [2, {
      a: { time: 2043, events: new Map([[0, { title: 'Perchlorate', outcome: 'conservative_failure', category: 'resource' }]]) },
      b: { time: 2043, events: new Map([[0, { title: 'Solar storm', outcome: 'conservative_failure', category: 'environmental' }]]) },
    }],
  ];

  const cells = collectRunStripData(turns);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].turn, 1);
  assert.equal(cells[0].time, 2035);
  assert.equal(cells[0].diverged, false);
  assert.equal(cells[0].a.outcome, 'risky_success');
  assert.equal(cells[0].b.outcome, 'conservative_success');
  assert.equal(cells[1].diverged, true);
  assert.equal(cells[1].a.title, 'Perchlorate');
  assert.equal(cells[1].b.title, 'Solar storm');
});
