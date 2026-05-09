/** Department color map — matches the Paracosm theme. */
export const DEPARTMENT_COLORS: Record<string, string> = {
  medical: '#4ecdc4',
  engineering: '#e8b44a',
  agriculture: '#6aad48',
  psychology: '#9b6b9e',
  governance: '#e06530',
};

/** Fallback color for departments not in the map (custom scenarios). */
export const DEFAULT_DEPT_COLOR = '#a89878';

/** Color flash for event categories (used for event correlation overlay). */
export const CATEGORY_COLORS: Record<string, string> = {
  environmental: '#6aad48',
  resource: '#e8b44a',
  medical: '#4ecdc4',
  infrastructure: '#e06530',
  psychological: '#9b6b9e',
  political: '#c44a1e',
  social: '#9b6b9e',
  technological: '#4ca8a8',
};

/** Visualization rendering modes. */
export type VizMode = 'department' | 'age' | 'generation' | 'mood';

export interface CellSnapshot {
  agentId: string;
  name: string;
  department: string;
  role: string;
  rank: 'junior' | 'senior' | 'lead' | 'chief';
  alive: boolean;
  marsborn: boolean;
  psychScore: number;
  /** Age in years at this turn (computed from time - birthTime). */
  age?: number;
  /** Generation depth: 0 = earth-born, 1+ = native-born depth. */
  generation?: number;
  partnerId?: string;
  childrenIds: string[];
  featured: boolean;
  mood: string;
  shortTermMemory: string[];
}

export interface TurnSnapshot {
  turn: number;
  time: number;
  cells: CellSnapshot[];
  population: number;
  morale: number;
  foodReserve: number;
  deaths: number;
  births: number;
  /** Categories of events that occurred this turn (for event flash overlay). */
  eventCategories?: string[];
}

/** A node in the force simulation. Extends CellSnapshot with position/velocity. */
export interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  department: string;
  rank: 'junior' | 'senior' | 'lead' | 'chief';
  alive: boolean;
  marsborn: boolean;
  psychScore: number;
  partnerId?: string;
  childrenIds: string[];
  featured: boolean;
  mood: string;
}

/** Cell sizes in pixels by rank. */
export const RANK_SIZES: Record<string, number> = {
  junior: 8,
  senior: 10,
  lead: 12,
  chief: 14,
};

/** Compute the diff between two consecutive turn snapshots. */
export interface SnapshotDiff {
  bornIds: Set<string>;
  diedIds: Set<string>;
}

export function computeSnapshotDiff(prev: TurnSnapshot | undefined, current: TurnSnapshot | undefined): SnapshotDiff {
  const bornIds = new Set<string>();
  const diedIds = new Set<string>();
  // Two leaders may have completed different numbers of turns at any
  // moment (e.g. A is on turn 5 while B is still finishing turn 4), so
  // either side's snapshot can be undefined when the playhead is at the
  // outer edge. Bail out gracefully instead of crashing on `.cells`.
  if (!prev || !current) return { bornIds, diedIds };

  const prevAgents = new Map(prev.cells.map(c => [c.agentId, c]));
  const currAgents = new Map(current.cells.map(c => [c.agentId, c]));

  for (const [id, c] of currAgents) {
    const p = prevAgents.get(id);
    if (!p && c.alive) bornIds.add(id);
    else if (p && p.alive && !c.alive) diedIds.add(id);
  }
  for (const [id, p] of prevAgents) {
    if (p.alive && !currAgents.has(id)) diedIds.add(id);
  }
  return { bornIds, diedIds };
}

/** Compute divergence: cells that are alive in one timeline but dead in the other at same turn. */
export function computeDivergence(snapsA: TurnSnapshot | undefined, snapsB: TurnSnapshot | undefined): { aliveOnlyA: Set<string>; aliveOnlyB: Set<string> } {
  const aliveOnlyA = new Set<string>();
  const aliveOnlyB = new Set<string>();
  if (!snapsA || !snapsB) return { aliveOnlyA, aliveOnlyB };
  const aById = new Map(snapsA.cells.map(c => [c.agentId, c]));
  const bById = new Map(snapsB.cells.map(c => [c.agentId, c]));
  for (const [id, c] of aById) {
    const b = bById.get(id);
    if (c.alive && (!b || !b.alive)) aliveOnlyA.add(id);
  }
  for (const [id, c] of bById) {
    const a = aById.get(id);
    if (c.alive && (!a || !a.alive)) aliveOnlyB.add(id);
  }
  return { aliveOnlyA, aliveOnlyB };
}

/** Clustering mode selected in the toggle row. */
export type ClusterMode = 'families' | 'departments' | 'mood' | 'age';

/** Narrative importance tier of a single colonist tile. */
export interface TileTier {
  tier: 'featured' | 'partnered' | 'solo' | 'dead';
  size: 'xl' | 'md' | 'sm' | 'ghost';
}

/** A cell plus its tier and (if partnered) pod membership. */
export interface LayoutTile extends CellSnapshot {
  tierInfo: TileTier;
  podId?: string;
  podRole?: 'anchor' | 'partner' | 'child';
}

/** A family pod: anchor, partner, and children. */
export interface LayoutPod {
  id: string;
  tiles: LayoutTile[];
  sharedTint: string;
}

/** Grouped output of the layout computation for one leader's snapshot. */
export interface ViewLayout {
  featured: LayoutTile[];
  pods: LayoutPod[];
  deptBands: Record<string, LayoutTile[]>;
  ghosts: LayoutTile[];
}

/** Maximum featured tiles per leader at once. Keeps the top row
 *  readable at narrow widths. */
export const FEATURED_CAP = 6;

/** Layers composable inside the living-colony grid. Toggled via the
 *  layer chip bar in Phase 2; declared here so Phase 1 grid-state
 *  already knows the vocabulary. */
export type LayerKey = 'field' | 'seeds' | 'flares' | 'glyphs' | 'lines' | 'hud';

/** Named compositions of layers + event filters. Phase 2 wires the
 *  cycler; Phase 1 defaults to 'living'. */
export type PresetKey = 'living' | 'mood' | 'forge' | 'ecology' | 'divergence';

/** Colonist position inside the grid (logical canvas coords). */
export interface GridPosition { x: number; y: number }
