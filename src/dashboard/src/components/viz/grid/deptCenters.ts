import type { CellSnapshot, GridPosition } from '../viz-types.js';

/**
 * Compute the centroid of each department's alive colonists from their
 * current grid positions. Used by flare seeding to anchor forge/reuse
 * events at the originating dept's cluster rather than at a random
 * agent position.
 */
export function computeDeptCenters(
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
): Map<string, GridPosition> {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  for (const c of cells) {
    if (!c.alive) continue;
    const pos = positions.get(c.agentId);
    if (!pos) continue;
    const key = (c.department || 'unknown').toLowerCase();
    const slot = acc.get(key) ?? { x: 0, y: 0, n: 0 };
    slot.x += pos.x;
    slot.y += pos.y;
    slot.n += 1;
    acc.set(key, slot);
  }
  const out = new Map<string, GridPosition>();
  for (const [k, v] of acc.entries()) {
    out.set(k, { x: v.x / v.n, y: v.y / v.n });
  }
  return out;
}
