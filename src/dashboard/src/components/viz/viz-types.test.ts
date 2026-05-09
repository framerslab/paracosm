import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSnapshotDiff, computeDivergence, type CellSnapshot, type TurnSnapshot } from './viz-types.js';

function cell(id: string, alive = true, dept = 'medical'): CellSnapshot {
  return {
    agentId: id,
    name: id,
    department: dept,
    role: 'role',
    rank: 'junior',
    alive,
    marsborn: false,
    psychScore: 0.5,
    childrenIds: [],
    featured: false,
    mood: 'neutral',
    shortTermMemory: [],
  };
}

function snap(turn: number, cells: CellSnapshot[]): TurnSnapshot {
  return {
    turn, time: 2040 + turn, cells,
    population: cells.filter(c => c.alive).length,
    morale: 0.5, foodReserve: 6, deaths: 0, births: 0,
  };
}

test('computeSnapshotDiff returns empty sets when prev is undefined', () => {
  const diff = computeSnapshotDiff(undefined, snap(1, [cell('a'), cell('b')]));
  assert.equal(diff.bornIds.size, 0);
  assert.equal(diff.diedIds.size, 0);
});

test('computeSnapshotDiff detects new alive cells as bornIds', () => {
  const prev = snap(1, [cell('a'), cell('b')]);
  const curr = snap(2, [cell('a'), cell('b'), cell('c')]);
  const diff = computeSnapshotDiff(prev, curr);
  assert.deepEqual([...diff.bornIds], ['c']);
  assert.equal(diff.diedIds.size, 0);
});

test('computeSnapshotDiff detects alive→dead transitions as diedIds', () => {
  const prev = snap(1, [cell('a'), cell('b'), cell('c')]);
  const curr = snap(2, [cell('a'), cell('b', false), cell('c')]);
  const diff = computeSnapshotDiff(prev, curr);
  assert.deepEqual([...diff.diedIds], ['b']);
  assert.equal(diff.bornIds.size, 0);
});

test('computeSnapshotDiff detects removed cells as diedIds', () => {
  const prev = snap(1, [cell('a'), cell('b'), cell('c')]);
  const curr = snap(2, [cell('a'), cell('c')]);
  const diff = computeSnapshotDiff(prev, curr);
  assert.deepEqual([...diff.diedIds], ['b']);
});

test('computeSnapshotDiff handles simultaneous birth and death', () => {
  const prev = snap(1, [cell('a'), cell('b')]);
  const curr = snap(2, [cell('a'), cell('b', false), cell('c')]);
  const diff = computeSnapshotDiff(prev, curr);
  assert.deepEqual([...diff.bornIds], ['c']);
  assert.deepEqual([...diff.diedIds], ['b']);
});

test('computeSnapshotDiff ignores cells that were already dead in prev', () => {
  const prev = snap(1, [cell('a'), cell('b', false)]);
  const curr = snap(2, [cell('a'), cell('b', false)]);
  const diff = computeSnapshotDiff(prev, curr);
  assert.equal(diff.bornIds.size, 0);
  assert.equal(diff.diedIds.size, 0);
});

test('computeDivergence returns empty when both timelines match', () => {
  const a = snap(3, [cell('x'), cell('y'), cell('z')]);
  const b = snap(3, [cell('x'), cell('y'), cell('z')]);
  const div = computeDivergence(a, b);
  assert.equal(div.aliveOnlyA.size, 0);
  assert.equal(div.aliveOnlyB.size, 0);
});

test('computeDivergence flags cells alive only in A', () => {
  const a = snap(3, [cell('x'), cell('y'), cell('z')]);
  const b = snap(3, [cell('x'), cell('y', false), cell('z')]);
  const div = computeDivergence(a, b);
  assert.deepEqual([...div.aliveOnlyA], ['y']);
  assert.equal(div.aliveOnlyB.size, 0);
});

test('computeDivergence flags cells alive only in B', () => {
  const a = snap(3, [cell('x'), cell('y', false), cell('z')]);
  const b = snap(3, [cell('x'), cell('y'), cell('z')]);
  const div = computeDivergence(a, b);
  assert.deepEqual([...div.aliveOnlyB], ['y']);
  assert.equal(div.aliveOnlyA.size, 0);
});

test('computeDivergence flags cells missing entirely from one timeline', () => {
  const a = snap(3, [cell('x'), cell('y'), cell('z')]);
  const b = snap(3, [cell('x'), cell('z')]);
  const div = computeDivergence(a, b);
  assert.deepEqual([...div.aliveOnlyA], ['y']);
});

test('computeDivergence handles bidirectional divergence', () => {
  const a = snap(3, [cell('x'), cell('y'), cell('z', false)]);
  const b = snap(3, [cell('x'), cell('y', false), cell('z')]);
  const div = computeDivergence(a, b);
  assert.deepEqual([...div.aliveOnlyA], ['y']);
  assert.deepEqual([...div.aliveOnlyB], ['z']);
});
