/**
 * Which of a long list's lines to render.
 *
 * Past 50 lines the forged toolbox renders only the lines in view: fold
 * heads, department lines and rows, each of its own height. From the lines'
 * heights, how far the view starts below the list's top and how tall it is,
 * `windowRange` says which lines to render, a few more past each end of the
 * view, and the height of the lines it leaves out above and below, which
 * the list keeps as room so its whole height and its scroll bar stay as
 * they would be with every line rendered.
 */

/** Up to this many lines a list renders whole. */
export const WINDOW_PAST = 50;

/** The lines rendered past each end of the view, so a short scroll or a key press finds the next line in place. */
export const OVERSCAN = 8;

export interface WindowInput {
  /** How many lines the list holds. */
  count: number;
  /** Each line's height in px, or one height for every line. */
  lineHeights: readonly number[] | number;
  /** How far below the list's top the view starts, in px. */
  scrollTop: number;
  /** How tall the view is, in px. */
  viewport: number;
  /** How many lines to render past each end of the view. */
  overscan: number;
  /** A line rendered wherever it stands, such as the one that holds focus. */
  keep?: number;
}

export interface WindowRange {
  /** The first and the last line to render, both included; for an empty list, last is first - 1. */
  first: number;
  last: number;
  /** The height of the lines above `first` and below `last`, which the list keeps as room. */
  padTop: number;
  padBottom: number;
}

/**
 * The lines to render: every line the view shows, `overscan` more past each
 * end, and `keep` with the lines between it and the view, so the range is
 * one run of lines. A view past the list's end shows its last line.
 */
export function windowRange({ count, lineHeights, scrollTop, viewport, overscan, keep }: WindowInput): WindowRange {
  if (count <= 0) return { first: 0, last: -1, padTop: 0, padBottom: 0 };
  const heightOf = (i: number): number => {
    const h = typeof lineHeights === 'number' ? lineHeights : (lineHeights[i] ?? 0);
    return Number.isFinite(h) && h > 0 ? h : 0;
  };
  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(0, viewport);

  // The first line whose bottom passes the view's top, and the last whose top is above its bottom.
  let offset = 0;
  let firstSeen = -1;
  let lastSeen = -1;
  for (let i = 0; i < count; i += 1) {
    const h = heightOf(i);
    if (offset >= bottom && firstSeen >= 0) break;
    if (firstSeen < 0 && offset + h > top) firstSeen = i;
    if (firstSeen >= 0) lastSeen = i;
    offset += h;
  }
  if (firstSeen < 0) {
    firstSeen = count - 1;
    lastSeen = count - 1;
  }

  const margin = Math.max(0, Math.floor(overscan));
  let first = Math.max(0, firstSeen - margin);
  let last = Math.min(count - 1, lastSeen + margin);
  if (keep !== undefined && Number.isInteger(keep) && keep >= 0 && keep < count) {
    first = Math.min(first, keep);
    last = Math.max(last, keep);
  }

  let padTop = 0;
  let padBottom = 0;
  for (let i = 0; i < count; i += 1) {
    if (i < first) padTop += heightOf(i);
    else if (i > last) padBottom += heightOf(i);
  }
  return { first, last, padTop, padBottom };
}
