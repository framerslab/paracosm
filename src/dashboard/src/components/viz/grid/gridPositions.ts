import type { CellSnapshot, ClusterMode, GridPosition } from '../viz-types.js';

/**
 * Mulberry32 seeded PRNG. Kept local (not imported from automaton/shared)
 * so this module stays self-contained and the automaton folder can be
 * deleted in Phase 5 without breaking grid tests.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function clampBounds(x: number, y: number, w: number, h: number, margin = 8): GridPosition {
  return {
    x: Math.max(margin, Math.min(w - margin, x)),
    y: Math.max(margin, Math.min(h - margin, y)),
  };
}

function collectDepartments(cells: CellSnapshot[]): string[] {
  const set = new Set<string>();
  for (const c of cells) set.add(c.department || 'unknown');
  return [...set].sort();
}

function deptCenters(
  w: number,
  h: number,
  depts: string[],
): Map<string, { cx: number; cy: number; r: number }> {
  const out = new Map<string, { cx: number; cy: number; r: number }>();
  if (depts.length === 0) return out;
  const cx = w / 2;
  const cy = h / 2;
  const ringR = Math.min(w, h) * 0.32;
  const clusterR = Math.min(w, h) * 0.14;
  if (depts.length === 1) {
    out.set(depts[0], { cx, cy, r: clusterR * 1.5 });
    return out;
  }
  for (let i = 0; i < depts.length; i++) {
    const angle = (Math.PI * 2 * i) / depts.length - Math.PI / 2;
    out.set(depts[i], {
      cx: cx + Math.cos(angle) * ringR,
      cy: cy + Math.sin(angle) * ringR,
      r: clusterR,
    });
  }
  return out;
}

function positionDepartments(
  cells: CellSnapshot[],
  w: number,
  h: number,
): Map<string, GridPosition> {
  const depts = collectDepartments(cells);
  const centers = deptCenters(w, h, depts);
  const out = new Map<string, GridPosition>();
  for (const c of cells) {
    const center = centers.get(c.department || 'unknown') ?? { cx: w / 2, cy: h / 2, r: 40 };
    const rng = mulberry32(hashString(`${c.agentId}|${w}x${h}|dept`));
    const angle = rng() * Math.PI * 2;
    const radial = Math.sqrt(rng()) * center.r;
    out.set(
      c.agentId,
      clampBounds(
        center.cx + Math.cos(angle) * radial,
        center.cy + Math.sin(angle) * radial,
        w,
        h,
      ),
    );
  }
  return out;
}

function positionFamilies(
  cells: CellSnapshot[],
  w: number,
  h: number,
): Map<string, GridPosition> {
  const out = new Map<string, GridPosition>();
  const seen = new Set<string>();
  const byId = new Map(cells.map(c => [c.agentId, c] as const));
  const pods: CellSnapshot[][] = [];
  for (const c of cells) {
    if (seen.has(c.agentId)) continue;
    if (c.partnerId && byId.has(c.partnerId) && !seen.has(c.partnerId)) {
      const partner = byId.get(c.partnerId)!;
      const children = c.childrenIds
        .map(id => byId.get(id))
        .filter((x): x is CellSnapshot => !!x);
      pods.push([c, partner, ...children]);
      seen.add(c.agentId);
      seen.add(partner.agentId);
      for (const ch of children) seen.add(ch.agentId);
    }
  }
  const solos = cells.filter(c => !seen.has(c.agentId));
  const padX = 40;
  const padY = 40;
  const podGap = Math.max(50, (w - padX * 2) / Math.max(1, pods.length));
  pods.forEach((pod, i) => {
    const cx = padX + podGap * i + podGap / 2;
    const cy = padY;
    pod.forEach((member, j) => {
      const rng = mulberry32(hashString(`${member.agentId}|fam`));
      const angle = (j / pod.length) * Math.PI * 2;
      const r = 14 + rng() * 6;
      out.set(
        member.agentId,
        clampBounds(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, w, h),
      );
    });
  });
  solos.forEach((c, i) => {
    const rng = mulberry32(hashString(`${c.agentId}|solo`));
    const cx = padX + ((w - padX * 2) * (i + 0.5)) / Math.max(1, solos.length);
    const cy = h - padY - rng() * 40;
    out.set(c.agentId, clampBounds(cx, cy, w, h));
  });
  return out;
}

function positionMood(
  cells: CellSnapshot[],
  w: number,
  h: number,
): Map<string, GridPosition> {
  const moodWeight: Record<string, number> = {
    positive: -1.0,
    hopeful: -0.6,
    neutral: 0.0,
    anxious: 0.4,
    negative: 0.8,
    defiant: 0.6,
    resigned: 0.7,
  };
  const out = new Map<string, GridPosition>();
  const margin = 40;
  for (const c of cells) {
    const w01 = (moodWeight[c.mood] ?? 0) * 0.5 + 0.5;
    const rng = mulberry32(hashString(`${c.agentId}|mood`));
    const x = margin + (w - margin * 2) * w01;
    const y = margin + (h - margin * 2) * rng();
    out.set(c.agentId, clampBounds(x, y, w, h));
  }
  return out;
}

function positionAge(
  cells: CellSnapshot[],
  w: number,
  h: number,
): Map<string, GridPosition> {
  const out = new Map<string, GridPosition>();
  const margin = 40;
  for (const c of cells) {
    const a = Math.max(0, Math.min(80, c.age ?? 30));
    const y01 = a / 80;
    const rng = mulberry32(hashString(`${c.agentId}|age`));
    const x = margin + (w - margin * 2) * rng();
    const y = margin + (h - margin * 2) * y01;
    out.set(c.agentId, clampBounds(x, y, w, h));
  }
  return out;
}

/**
 * Hashed, deterministic colonist positions for the living-colony grid.
 * Same (agentId, mode, w, h) always returns the same coords — colonists
 * don't jump around when a neighbor dies.
 */
export function computeGridPositions(
  cells: CellSnapshot[],
  mode: ClusterMode,
  width: number,
  height: number,
): Map<string, GridPosition> {
  if (mode === 'families') return positionFamilies(cells, width, height);
  if (mode === 'mood') return positionMood(cells, width, height);
  if (mode === 'age') return positionAge(cells, width, height);
  return positionDepartments(cells, width, height);
}
