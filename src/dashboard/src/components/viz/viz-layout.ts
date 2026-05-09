import {
  type CellSnapshot,
  type TurnSnapshot,
  type ClusterMode,
  type LayoutTile,
  type LayoutPod,
  type ViewLayout,
  DEPARTMENT_COLORS,
  DEFAULT_DEPT_COLOR,
  FEATURED_CAP,
} from './viz-types.js';

function tierSize(tier: LayoutTile['tierInfo']['tier']): LayoutTile['tierInfo']['size'] {
  switch (tier) {
    case 'featured':
      return 'xl';
    case 'partnered':
      return 'md';
    case 'solo':
      return 'sm';
    case 'dead':
      return 'ghost';
  }
}

function makeTile(cell: CellSnapshot, tier: LayoutTile['tierInfo']['tier']): LayoutTile {
  return { ...cell, tierInfo: { tier, size: tierSize(tier) } };
}

function avgTint(departments: string[]): string {
  if (departments.length === 0) return DEFAULT_DEPT_COLOR;
  return DEPARTMENT_COLORS[departments[0]] ?? DEFAULT_DEPT_COLOR;
}

/**
 * Compute a ViewLayout from a snapshot and a clustering mode.
 *
 * Modes:
 *   families    featured + partnered pods + solo dept bands + ghosts (default)
 *   departments every alive cell rendered in a dept band at md size
 *   mood        featured retains xl; others cluster by current mood at sm
 *   age         featured retains xl; others bucket by life stage at sm
 *
 * Deterministic: identical snapshots produce identical layouts so turn
 * scrubbing shows pods growing, not rearranging.
 */
export function computeLayout(snapshot: TurnSnapshot, mode: ClusterMode): ViewLayout {
  const layout: ViewLayout = {
    featured: [],
    pods: [],
    deptBands: {},
    ghosts: [],
  };

  const byId = new Map<string, CellSnapshot>(snapshot.cells.map(c => [c.agentId, c]));

  // Dead cells always go to ghosts, regardless of mode.
  for (const c of snapshot.cells) {
    if (!c.alive) layout.ghosts.push(makeTile(c, 'dead'));
  }

  if (mode === 'departments') {
    for (const c of snapshot.cells) {
      if (!c.alive) continue;
      const dept = c.department || 'unknown';
      if (!layout.deptBands[dept]) layout.deptBands[dept] = [];
      layout.deptBands[dept].push({
        ...c,
        tierInfo: { tier: 'solo', size: 'md' },
      });
    }
    return layout;
  }

  const alive = snapshot.cells.filter(c => c.alive);
  const claimed = new Set<string>();

  // 1. Featured (capped).
  const featured = alive.filter(c => c.featured).slice(0, FEATURED_CAP);
  for (const c of featured) {
    layout.featured.push(makeTile(c, 'featured'));
    claimed.add(c.agentId);
  }

  // 2. Family pods: anchor + partner + children.
  const podSeen = new Set<string>();
  for (const c of alive) {
    if (claimed.has(c.agentId) || podSeen.has(c.agentId)) continue;
    const hasPartner = !!(c.partnerId && byId.get(c.partnerId)?.alive);
    const hasChildren = c.childrenIds.some(id => byId.get(id)?.alive);
    if (!hasPartner && !hasChildren) continue;

    const podId = `pod-${c.agentId}`;
    const tiles: LayoutTile[] = [{
      ...c,
      tierInfo: { tier: 'partnered', size: 'md' },
      podId,
      podRole: 'anchor',
    }];
    const depts: string[] = [c.department];
    podSeen.add(c.agentId);

    if (hasPartner && c.partnerId) {
      const p = byId.get(c.partnerId)!;
      if (!claimed.has(p.agentId) && !podSeen.has(p.agentId)) {
        tiles.push({
          ...p,
          tierInfo: { tier: 'partnered', size: 'md' },
          podId,
          podRole: 'partner',
        });
        podSeen.add(p.agentId);
        depts.push(p.department);
      }
    }

    for (const kidId of c.childrenIds) {
      const k = byId.get(kidId);
      if (!k || !k.alive || claimed.has(k.agentId) || podSeen.has(k.agentId)) continue;
      tiles.push({
        ...k,
        tierInfo: { tier: 'partnered', size: 'sm' },
        podId,
        podRole: 'child',
      });
      podSeen.add(k.agentId);
    }

    layout.pods.push({ id: podId, tiles, sharedTint: avgTint(depts) });
  }

  for (const pod of layout.pods) {
    for (const t of pod.tiles) claimed.add(t.agentId);
  }

  // 3. Solo alive → dept bands (mood / age modes override bucket key).
  for (const c of alive) {
    if (claimed.has(c.agentId)) continue;
    let bucket: string;
    if (mode === 'mood') {
      bucket = c.mood || 'neutral';
    } else if (mode === 'age') {
      const age = c.age ?? 0;
      bucket = age < 18 ? 'youth' : age < 40 ? 'adult' : age < 65 ? 'veteran' : 'elder';
    } else {
      bucket = c.department || 'unknown';
    }
    if (!layout.deptBands[bucket]) layout.deptBands[bucket] = [];
    layout.deptBands[bucket].push({
      ...c,
      tierInfo: { tier: 'solo', size: 'sm' },
    });
  }

  return layout;
}
