/**
 * Where each person's name stands over the living grid's field, when the
 * names are set as text over the canvas (LivingSwarmGrid's `nameLabels`).
 *
 * A name stands beside its person's ring: on the side away from the field's
 * middle first, then under it, over it and on the other side, then the same
 * places moved up or down a row at a time. A place is taken only when the
 * name lies whole inside the field and touches no name already placed; among
 * those, one that covers no person's ring is taken first. When no place near
 * the ring is free, the free place nearest the ring anywhere in the field is
 * taken. A name with no free place is left out, and the caller shows it on
 * focus, on hover or on a press instead.
 *
 * Pure and deterministic: the same people, sizes and field give the same
 * places.
 *
 * @module paracosm/dashboard/viz/grid/nameLabelLayout
 */

/** A name to place: its person's ring centre and the name's own box, in the field's pixels. */
export interface NameLabelInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A ring the names keep clear of where they can. */
export interface NameLabelRing {
  x: number;
  y: number;
  r: number;
}

/** A placed name's top left corner, in the field's pixels. */
export interface NameLabelPlace {
  left: number;
  top: number;
}

export interface NameLabelOptions {
  /** From a ring's centre to the near edge of its name. */
  gap?: number;
  /** Kept clear between two names. */
  pad?: number;
  /** Kept clear between a name and the field's edge. */
  margin?: number;
}

interface Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

const touches = (a: Box, b: Box, pad: number): boolean =>
  a.left < b.left + b.w + pad && b.left < a.left + a.w + pad && a.top < b.top + b.h + pad && b.top < a.top + a.h + pad;

const coversRing = (box: Box, ring: NameLabelRing): boolean => {
  const nearX = Math.max(box.left, Math.min(ring.x, box.left + box.w));
  const nearY = Math.max(box.top, Math.min(ring.y, box.top + box.h));
  const dx = ring.x - nearX;
  const dy = ring.y - nearY;
  return dx * dx + dy * dy < ring.r * ring.r;
};

/**
 * Places the names in the order given, so an earlier name keeps its place
 * whatever follows. Returns the placed names by id.
 */
export function placeNameLabels(
  items: readonly NameLabelInput[],
  bounds: { w: number; h: number },
  rings: readonly NameLabelRing[] = [],
  options: NameLabelOptions = {},
): Map<string, NameLabelPlace> {
  const gap = options.gap ?? 14;
  const pad = options.pad ?? 2;
  const margin = options.margin ?? 2;
  const out = new Map<string, NameLabelPlace>();
  const placed: Box[] = [];
  if (!(bounds.w > 0) || !(bounds.h > 0)) return out;

  /** The box moved inside the field where it fits; a name wider or taller than the field starts at the margin. */
  const inside = (left: number, top: number, w: number, h: number): Box => ({
    left: Math.max(margin, Math.min(left, bounds.w - w - margin)),
    top: Math.max(margin, Math.min(top, bounds.h - h - margin)),
    w,
    h,
  });
  const free = (box: Box): boolean => !placed.some((other) => touches(box, other, pad));
  const covered = (box: Box): number => rings.reduce((n, ring) => n + (coversRing(box, ring) ? 1 : 0), 0);

  for (const item of items) {
    if (!(item.w > 0) || !(item.h > 0)) continue;
    const { x, y, w, h } = item;
    const outward = x >= bounds.w / 2 ? x + gap : x - gap - w;
    const inward = x >= bounds.w / 2 ? x - gap - w : x + gap;
    const row = h + pad;
    const rows = Math.ceil(bounds.h / row);
    const near: Box[] = [
      inside(outward, y - h / 2, w, h),
      inside(x - w / 2, y + gap, w, h),
      inside(x - w / 2, y - gap - h, w, h),
      inside(inward, y - h / 2, w, h),
    ];
    for (let k = 1; k <= rows; k += 1) {
      for (const side of [outward, inward, x - w / 2]) {
        near.push(inside(side, y - h / 2 + k * row, w, h));
        near.push(inside(side, y - h / 2 - k * row, w, h));
      }
    }

    let best: Box | null = null;
    let bestCovered = Infinity;
    for (const box of near) {
      if (!free(box)) continue;
      const n = covered(box);
      if (n < bestCovered) {
        best = box;
        bestCovered = n;
        if (n === 0) break;
      }
    }

    if (!best) {
      // No place near the ring: the free place nearest to it anywhere in the field.
      let nearest = Infinity;
      for (let top = margin; top <= bounds.h - h - margin; top += 4) {
        for (let left = margin; left <= bounds.w - w - margin; left += 8) {
          const box: Box = { left, top, w, h };
          if (!free(box)) continue;
          const dx = left + w / 2 - x;
          const dy = top + h / 2 - y;
          const d = dx * dx + dy * dy;
          if (d < nearest) {
            nearest = d;
            best = box;
          }
        }
      }
    }

    if (best) {
      placed.push(best);
      out.set(item.id, { left: best.left, top: best.top });
    }
  }
  return out;
}

/**
 * The point on a placed name's box nearest its person's ring, and how far
 * that is: a line joins the two when the name stands away from the ring.
 */
export function nearestPointOnLabel(
  place: NameLabelPlace,
  size: { w: number; h: number },
  ring: { x: number; y: number },
): { x: number; y: number; distance: number } {
  const x = Math.max(place.left, Math.min(ring.x, place.left + size.w));
  const y = Math.max(place.top, Math.min(ring.y, place.top + size.h));
  return { x, y, distance: Math.hypot(ring.x - x, ring.y - y) };
}
