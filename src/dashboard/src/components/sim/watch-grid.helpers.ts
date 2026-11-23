/**
 * What the Sim tab's grid panels work out before they draw: which roster
 * each leader's panel shows.
 *
 * @module paracosm/dashboard/sim/watch-grid.helpers
 */
import type { TurnSnapshot } from '../viz/viz-types';

/**
 * Every leader's rosters lined up on the newest turn any leader has
 * reached: a leader who is behind has its first roster repeated in front,
 * so one index reads each leader's own latest roster and the one before
 * it. The track of panels takes one turn for all its panels, and leaders
 * of a larger run reach their turns at different times. A leader with no
 * roster yet keeps none, and its panel waits.
 */
export function alignToNewest(
  actorIds: readonly string[],
  snapshotMap: Record<string, TurnSnapshot[]>,
): { aligned: Record<string, TurnSnapshot[]>; newest: number } {
  const longest = Math.max(0, ...actorIds.map(id => snapshotMap[id]?.length ?? 0));
  const aligned: Record<string, TurnSnapshot[]> = {};
  for (const id of actorIds) {
    const snaps = snapshotMap[id] ?? [];
    aligned[id] = snaps.length === 0 || snaps.length === longest
      ? snaps
      : [...Array.from({ length: longest - snaps.length }, () => snaps[0]), ...snaps];
  }
  return { aligned, newest: Math.max(0, longest - 1) };
}

/** The turn of a leader's latest roster; 0 before its first. */
export function latestTurn(snaps: readonly TurnSnapshot[] | undefined): number {
  return snaps && snaps.length > 0 ? snaps[snaps.length - 1].turn : 0;
}
