/**
 * The Viz snapshots of a fork resumed after turn 2: its first systems_snapshot
 * is turn 3, so each roster pairs with its own snapshot and turn_done by order
 * and turn number, never by array index.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from '../../hooks/useSSE';
import { computeGameState } from '../../hooks/useGameState';
import { buildVizSnapshots } from './useVizSnapshots';

const LEADER = 'Aria Chen';
const agent = { agentId: 'col-bruno-morales', name: 'Bruno Morales', department: 'engineering', role: 'Chief Engineer', rank: 'chief', alive: true, marsborn: false, psychScore: 0.8, age: 51, generation: 0, childrenIds: [], featured: true, mood: 'defiant', shortTermMemory: [] };

function resumedTurn(turn: number, time: number, deaths: number, water: number): SimEvent[] {
  const metrics = { population: 30 - deaths, morale: 0.84, foodMonthsReserve: 34, waterLitersPerDay: water, powerKw: 400, pressurizedVolumeM3: 3000 };
  return [
    { type: 'turn_start', leader: LEADER, turn, data: { turn, time, title: `Turn ${turn}`, category: 'medical', births: 0, deaths, metrics } },
    { type: 'turn_done', leader: LEADER, turn, data: { turn, time, metrics, toolsForged: 0, deathCauses: { 'radiation cancer': deaths } } },
    { type: 'systems_snapshot', leader: LEADER, turn, data: { turn, time, agents: [agent], population: 30 - deaths, morale: 0.84, foodReserve: 34, births: 0, deaths } },
  ];
}

test('buildVizSnapshots pairs a resumed fork\'s rosters with their own turns and readings', () => {
  const state = computeGameState([...resumedTurn(3, 2051, 1, 800), ...resumedTurn(4, 2059, 2, 760)], true);
  const snaps = buildVizSnapshots(state)[LEADER];
  assert.deepEqual(snaps.map(s => s.turn), [3, 4]);
  assert.deepEqual(snaps.map(s => s.time), [2051, 2059]);
  assert.deepEqual(snaps.map(s => s.deaths), [1, 2]);
  assert.deepEqual(snaps.map(s => s.waterLitersPerDay), [800, 760]);
  assert.equal(snaps[1].powerKw, 400);
  assert.equal(snaps[1].pressurizedVolumeM3, 3000);
  assert.deepEqual(snaps[0].eventCategories, ['medical']);
});
