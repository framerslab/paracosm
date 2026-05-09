import type { CellSnapshot, GridPosition } from '../viz-types.js';

/**
 * Hit-test a colonist glyph at (x, y) in overlay-canvas pixel space.
 * Iterates in reverse so featured/later-drawn glyphs win overlap ties.
 */
export function hitTestGlyph(
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  x: number,
  y: number,
): CellSnapshot | null {
  // Generous hit radius so users don't have to pixel-hunt on 3-5px
  // glyphs. 18px slop means any cursor within ~23px of a featured
  // glyph's center triggers the hover popover, which addresses
  // consistent feedback that 'hovering shows no tooltip' — the
  // actual issue was the hit target being too tight relative to
  // the discrete Conway tiles rendered around it.
  const slop = 18;
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (!c.alive) continue;
    const pos = positions.get(c.agentId);
    if (!pos) continue;
    const r = (c.featured ? 5 : 3) + slop;
    const dx = x - pos.x;
    const dy = y - pos.y;
    if (dx * dx + dy * dy <= r * r) return c;
  }
  return null;
}
