import test from 'node:test';
import assert from 'node:assert/strict';

import { alignToNewest, latestTurn } from './watch-grid.helpers.js';
import type { TurnSnapshot } from '../viz/viz-types';

const roster = (turn: number): TurnSnapshot => ({ turn, time: 2035 + turn, cells: [], population: 30, morale: 0.8, deaths: 0, births: 0 });

test('alignToNewest: one index reads each leader\'s own latest roster and the one before it', () => {
  const ahead = [roster(1), roster(2), roster(3)];
  const behind = [roster(1)];
  const middle = [roster(1), roster(2)];
  const { aligned, newest } = alignToNewest(['ahead', 'behind', 'middle', 'waiting'], { ahead, behind, middle });

  assert.equal(newest, 2);
  // The leader furthest on keeps its rosters as they are.
  assert.equal(aligned.ahead, ahead);
  // A leader behind reads its own latest at the newest index, and its own earlier roster before it.
  assert.deepEqual(aligned.behind.map(s => s.turn), [1, 1, 1]);
  assert.equal(aligned.behind[newest], behind[0]);
  assert.deepEqual(aligned.middle.map(s => s.turn), [1, 1, 2]);
  assert.equal(aligned.middle[newest], middle[1]);
  assert.equal(aligned.middle[newest - 1], middle[0]);
  // A leader with no roster yet has none: its panel waits.
  assert.deepEqual(aligned.waiting, []);
});

test('alignToNewest: no roster at all reads index 0 of nothing', () => {
  const { aligned, newest } = alignToNewest(['a', 'b'], {});
  assert.equal(newest, 0);
  assert.deepEqual(aligned, { a: [], b: [] });
});

test('latestTurn: a fork resumed after turn 3 reads its own turn number, and no roster reads 0', () => {
  assert.equal(latestTurn([roster(4), roster(5)]), 5);
  assert.equal(latestTurn([]), 0);
  assert.equal(latestTurn(undefined), 0);
});
