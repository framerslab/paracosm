/**
 * The timeline's food line follows the snapshots that carry a food
 * reserve. A run whose scenario has no food store sends none, and a
 * snapshot without one is no measurement of zero months.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { TimelineSparkline } from './TimelineSparkline.js';
import type { TurnSnapshot } from '../viz-types.js';

function snaps(food: Array<number | undefined>): TurnSnapshot[] {
  return food.map((foodReserve, turn) => ({
    turn,
    time: turn + 1,
    cells: [],
    population: 10,
    morale: 0.5,
    ...(foodReserve === undefined ? {} : { foodReserve }),
    deaths: 0,
    births: 0,
  }));
}

/** The food paths in the rendered SVG, by stroke (side A var(--vis), side B var(--eng)). */
function foodPaths(snapsA: TurnSnapshot[], snapsB: TurnSnapshot[]): { html: string; paths: Array<{ d: string; stroke: string }> } {
  const html = renderToString(React.createElement(TimelineSparkline, { snapsA, snapsB, currentTurn: 0, onJumpToTurn: () => {} }));
  const paths = [...html.matchAll(/<path d="([^"]*)" fill="none" stroke="([^"]+)" stroke-width="0.8" stroke-dasharray="3 2"/g)]
    .map(m => ({ d: m[1], stroke: m[2] }));
  return { html, paths };
}

/** The plot's floor: a zero value lands on y = padY + plotH = 25. */
const FLOOR = /,25\.0\b/;

test('a pair with no food reserve draws no food line and names no food', () => {
  const { html, paths } = foodPaths(snaps([undefined, undefined, undefined]), snaps([undefined, undefined, undefined]));
  assert.deepEqual(paths, []);
  assert.doesNotMatch(html, /food/i);
});

test('a side without a food reserve draws no food line beside one that has it', () => {
  const { paths } = foodPaths(snaps([10, 12, 14]), snaps([undefined, undefined, undefined]));
  assert.deepEqual(paths.map(p => p.stroke), ['var(--vis)']);
  assert.doesNotMatch(paths[0].d, FLOOR);
});

test('a turn without a food reserve breaks the food line instead of dropping it to zero', () => {
  const { paths } = foodPaths(snaps([10, undefined, 14]), snaps([9, 11, 13]));
  const sideA = paths.find(p => p.stroke === 'var(--vis)');
  assert.ok(sideA, `paths: ${JSON.stringify(paths)}`);
  assert.doesNotMatch(sideA.d, FLOOR, sideA.d);
  assert.equal(sideA.d.match(/M/g)?.length, 2, sideA.d);
  assert.equal(paths.find(p => p.stroke === 'var(--eng)')?.d.match(/L/g)?.length, 2);
});
