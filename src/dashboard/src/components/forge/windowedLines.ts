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
  /** The first and the last line of the run around the view, both included; for an empty list, last is first - 1. */
  first: number;
  last: number;
  /**
   * A line rendered apart from that run, above or below it: the kept line
   * when it stands further from the run than the next line. Absent when
   * the kept line is in the run or there is none.
   */
  kept?: number;
  /** The height of the lines between the kept line and the run, which the list keeps as room between them. */
  gap?: number;
  /** The height of the lines above the first line rendered and below the last, which the list keeps as room. */
  padTop: number;
  padBottom: number;
}

/**
 * The lines to render: every line the view shows and `overscan` more past
 * each end, one run of lines. A `keep` in that run or next to it joins the
 * run; one further away renders apart from it as `kept`, and the lines
 * between them keep their room as `gap`, so a line that holds focus stays
 * rendered without rendering every line between it and the view. A view
 * past the list's end shows its last line.
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
  const sumOf = (from: number, to: number): number => {
    let total = 0;
    for (let i = from; i < to; i += 1) total += heightOf(i);
    return total;
  };
  if (keep !== undefined && Number.isInteger(keep) && keep >= 0 && keep < count) {
    if (keep >= first - 1 && keep <= last + 1) {
      first = Math.min(first, keep);
      last = Math.max(last, keep);
    } else if (keep < first) {
      return { first, last, kept: keep, gap: sumOf(keep + 1, first), padTop: sumOf(0, keep), padBottom: sumOf(last + 1, count) };
    } else {
      return { first, last, kept: keep, gap: sumOf(last + 1, keep), padTop: sumOf(0, first), padBottom: sumOf(keep + 1, count) };
    }
  }
  return { first, last, padTop: sumOf(0, first), padBottom: sumOf(last + 1, count) };
}
