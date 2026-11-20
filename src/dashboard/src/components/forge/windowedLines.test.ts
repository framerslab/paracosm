/**
 * Which lines the forged toolbox renders past 50: the 300-actor run with
 * every fold open is 3,912 lines (300 fold heads and 3,612 rows), each with
 * its own height, in a view 900 px tall.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERSCAN, windowRange, type WindowInput } from './windowedLines';

/** A fold head at 1440 px, and rows whose words wrap to one, two or three lines. */
const HEAD = 56;
const ROWS = [88, 112, 136];

/** 300 heads, each over 12 or 13 rows: 3,912 lines. */
function maximumRunHeights(): number[] {
  const heights: number[] = [];
  let rows = 0;
  for (let actor = 0; actor < 300; actor += 1) {
    heights.push(HEAD);
    const own = actor < 12 ? 13 : 12;
    for (let r = 0; r < own; r += 1) heights.push(ROWS[(actor + r) % ROWS.length]);
    rows += own;
  }
  assert.equal(rows, 3612);
  return heights;
}

const sum = (heights: readonly number[], from: number, to: number): number =>
  heights.slice(from, to).reduce((total, h) => total + h, 0);

/** Every line the view shows lies inside the range: the range's top is at or above the view's, its bottom at or below. */
function assertCovers(input: WindowInput, heights: readonly number[]): void {
  const { first, last } = windowRange(input);
  const total = sum(heights, 0, heights.length);
  const top = Math.min(input.scrollTop, total);
  assert.ok(sum(heights, 0, first) <= top, `the range starts at or above the view at ${input.scrollTop}`);
  const bottom = Math.min(input.scrollTop + input.viewport, total);
  assert.ok(sum(heights, 0, last + 1) >= bottom, `the range ends at or below the view at ${input.scrollTop}`);
}

test('a 3,912-line list at a 900px viewport renders no more than 60 lines, wherever it is scrolled', () => {
  const heights = maximumRunHeights();
  assert.equal(heights.length, 3912);
  const total = sum(heights, 0, heights.length);
  for (let scrollTop = 0; scrollTop <= total; scrollTop += 457) {
    const input = { count: heights.length, lineHeights: heights, scrollTop, viewport: 900, overscan: OVERSCAN };
    const { first, last } = windowRange(input);
    assert.ok(last - first + 1 <= 60, `${last - first + 1} lines at ${scrollTop}`);
    assertCovers(input, heights);
  }
  // At the smallest line the toolbox draws, a department's line of 40 px, it holds too.
  for (let scrollTop = 0; scrollTop <= 3912 * 40; scrollTop += 911) {
    const { first, last } = windowRange({ count: 3912, lineHeights: 40, scrollTop, viewport: 900, overscan: OVERSCAN });
    assert.ok(last - first + 1 <= 60, `${last - first + 1} lines of 40 px at ${scrollTop}`);
  }
});

test('the range moves with scrollTop, and the pads hold the lines left out', () => {
  const at = (scrollTop: number) => windowRange({ count: 3912, lineHeights: 44, scrollTop, viewport: 880, overscan: 8 });
  assert.deepEqual(at(0), { first: 0, last: 27, padTop: 0, padBottom: (3912 - 28) * 44 });
  // 1,000 lines down: the view shows lines 1,000 to 1,019, and 8 more render past each end.
  assert.deepEqual(at(44 * 1000), { first: 992, last: 1027, padTop: 992 * 44, padBottom: (3912 - 1028) * 44 });
  // Half a line further, the line the view cuts at its top still renders.
  assert.equal(at(44 * 1000 + 22).first, 992);
  assert.equal(at(44 * 1000 + 22).last, 1028);
  // At the end, the last line renders and nothing is kept below it.
  const end = at(44 * 3912 - 880);
  assert.equal(end.last, 3911);
  assert.equal(end.padBottom, 0);
  // A view past the end shows the last line.
  assert.equal(at(44 * 5000).last, 3911);
});

test('the kept line stays in the range, however far it is from the view', () => {
  const heights = maximumRunHeights();
  const base = { count: heights.length, lineHeights: heights, viewport: 900, overscan: OVERSCAN };
  const below = windowRange({ ...base, scrollTop: 0, keep: 3900 });
  assert.equal(below.first, 0);
  assert.equal(below.last, 3900);
  assert.equal(below.padBottom, sum(heights, 3901, heights.length));
  const total = sum(heights, 0, heights.length);
  const above = windowRange({ ...base, scrollTop: total - 900, keep: 3 });
  assert.equal(above.first, 3);
  assert.equal(above.last, 3911);
  assert.equal(above.padTop, sum(heights, 0, 3));
  // A keep the list does not hold changes nothing.
  assert.deepEqual(windowRange({ ...base, scrollTop: 0, keep: 9000 }), windowRange({ ...base, scrollTop: 0 }));
});

test('heights that differ (heads and rows) sum to the pads', () => {
  const heights = maximumRunHeights();
  const total = sum(heights, 0, heights.length);
  for (const scrollTop of [0, 1234, 98_765, total / 2, total - 900]) {
    const { first, last, padTop, padBottom } = windowRange({ count: heights.length, lineHeights: heights, scrollTop, viewport: 900, overscan: OVERSCAN });
    assert.equal(padTop, sum(heights, 0, first), `padTop at ${scrollTop}`);
    assert.equal(padBottom, sum(heights, last + 1, heights.length), `padBottom at ${scrollTop}`);
    assert.equal(padTop + sum(heights, first, last + 1) + padBottom, total, `the list keeps its height at ${scrollTop}`);
  }
});

test('an empty list renders no line, and a list shorter than its view renders whole', () => {
  assert.deepEqual(windowRange({ count: 0, lineHeights: 56, scrollTop: 0, viewport: 900, overscan: OVERSCAN }), { first: 0, last: -1, padTop: 0, padBottom: 0 });
  assert.deepEqual(windowRange({ count: 12, lineHeights: 56, scrollTop: 0, viewport: 900, overscan: OVERSCAN }), { first: 0, last: 11, padTop: 0, padBottom: 0 });
});
