/**
 * Per-cell A-vs-B divergence at a single turn. Pure function.
 *
 * `magnitude` is the L1-normalized average of three signal deltas:
 * agentCount (delta normalized by max(a, b, 1)), dominantMood (1 if
 * differs, 0 if matches), department (1 if differs, 0). Output is in
 * [0, 1].
 *
 * SwarmViz computes this when the diff overlay toggle is on, then
 * passes each Tile its diff entry. Tile renders the outline + Δ badge.
 *
 * @module viz/viz-diff
 */

/**
 * Minimal per-cell shape this helper consumes. SwarmViz aggregates
 * per-agent CellSnapshot data into one DiffCell per (department, slot)
 * tile so the diff is computed at the tile granularity the viz
 * actually renders.
 */
export interface DiffCell {
  cellKey: string;
  department: string;
  agentCount: number;
  dominantMood: string;
}

export interface CellDiff {
  magnitude: number;
  aState: DiffCell;
  bState: DiffCell;
}

export function computeCellDiff(
  aCells: ReadonlyArray<DiffCell>,
  bCells: ReadonlyArray<DiffCell>,
): Map<string, CellDiff> {
  const out = new Map<string, CellDiff>();
  const aByKey = new Map(aCells.map((c) => [c.cellKey, c]));
  const bByKey = new Map(bCells.map((c) => [c.cellKey, c]));
  const allKeys = new Set([...aByKey.keys(), ...bByKey.keys()]);
  for (const key of allKeys) {
    const a = aByKey.get(key) ?? emptyCell(key);
    const b = bByKey.get(key) ?? emptyCell(key);
    const denom = Math.max(a.agentCount, b.agentCount, 1);
    const countDelta = Math.abs(a.agentCount - b.agentCount) / denom;
    const moodDelta = a.dominantMood === b.dominantMood ? 0 : 1;
    const deptDelta = a.department === b.department ? 0 : 1;
    const magnitude = (countDelta + moodDelta + deptDelta) / 3;
    out.set(key, { magnitude, aState: a, bState: b });
  }
  return out;
}

function emptyCell(key: string): DiffCell {
  return { cellKey: key, department: '', agentCount: 0, dominantMood: 'steady' };
}
