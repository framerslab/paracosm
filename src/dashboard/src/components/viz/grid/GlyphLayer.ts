import type { CellSnapshot, GridPosition } from '../viz-types.js';

interface DrawGlyphsOptions {
  intensity?: number;
  divergedIds?: Set<string>;
  divergenceOnly?: boolean;
  /** performance.now() — drives the featured-colonist sinusoidal pulse
   *  so it breathes at ~2s period without a per-glyph timer. */
  timeMs?: number;
}

/** Outlined colonist markers. Primary hit-test target. Featured
 *  colonists get an outer halo that sinusoidally pulses with `timeMs`
 *  so the eye tracks them without losing positional stability.
 *  `searchQuery` (case-insensitive substring) highlights matching
 *  colonists with a bright amber ring and dims non-matches.
 *  `nameLabels` when true renders first-name labels under featured
 *  and diverged glyphs — surfaces narrative-important colonists
 *  without requiring hover. */
export function drawGlyphs(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  sideColor: string,
  intensity = 1,
  divergedIds?: Set<string>,
  divergenceOnly = false,
  timeMs = 0,
  searchQuery = '',
  nameLabels = false,
  labelColor = 'rgba(216, 204, 176, 0.9)',
): void {
  void ({} as DrawGlyphsOptions);
  ctx.save();
  const pulse = 0.5 + 0.5 * Math.sin(timeMs * 0.003);
  const tokens = searchQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hasQuery = tokens.length > 0;
  const matchCell = (c: CellSnapshot): boolean => {
    if (!hasQuery) return false;
    const hay = `${c.name} ${c.department} ${c.role} ${c.mood}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  };
  for (const c of cells) {
    if (!c.alive) continue;
    const pos = positions.get(c.agentId);
    if (!pos) continue;
    const diverged = divergedIds?.has(c.agentId) ?? false;
    if (divergenceOnly && !diverged) continue;
    const matchesSearch = matchCell(c);
    const searchDim = hasQuery && !matchesSearch;
    const r = c.featured ? 5 : 3;
    const baseAlpha = c.featured ? 0.95 : 0.75;
    const searchAlphaMult = searchDim ? 0.25 : 1;

    if (c.featured && !searchDim) {
      // Static outer ring around featured colonists. Previously
      // pulsed with a sinusoid ("breathing" halo that expanded
      // ~5→10px over 2s), but users consistently misread the
      // animation as a moving ball on the canvas — the pulse was a
      // stylistic flourish that read as meaningful signal. Keep a
      // solid ring so featured colonists still stand out without
      // the distracting motion.
      const haloR = r + 6;
      const haloAlpha = 0.42 * intensity;
      ctx.strokeStyle = sideColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = haloAlpha;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, haloR, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (matchesSearch) {
      // Bright amber search halo, thicker than normal rings so matches
      // pop even in dense clusters.
      const mPulse = 0.7 + 0.3 * Math.sin(timeMs * 0.006);
      ctx.strokeStyle = 'rgba(248, 225, 150, 1)';
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = intensity * mPulse;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (diverged && !searchDim) {
      ctx.strokeStyle = 'rgba(232, 180, 74, 0.9)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = intensity;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = diverged ? 'rgba(224, 101, 48, 1)' : sideColor;
    ctx.lineWidth = c.featured || diverged || matchesSearch ? 1.6 : 1;
    ctx.globalAlpha = (diverged ? 1 : baseAlpha) * intensity * searchAlphaMult;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Always-on name labels for featured + diverged colonists. Rendered
  // in a second pass so labels aren't overdrawn by adjacent glyph strokes.
  if (nameLabels) {
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const c of cells) {
      if (!c.alive) continue;
      const pos = positions.get(c.agentId);
      if (!pos) continue;
      const diverged = divergedIds?.has(c.agentId) ?? false;
      if (divergenceOnly && !diverged) continue;
      if (!c.featured && !diverged) continue;
      const matchesSearch = matchCell(c);
      const searchDim = hasQuery && !matchesSearch;
      if (searchDim) continue;
      const label = c.name.split(/\s+/)[0];
      const y = pos.y + (c.featured ? 12 : 10);
      // Plate behind the label so it reads over the RD field.
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(10, 8, 6, 0.55)';
      ctx.fillRect(pos.x - w / 2 - 3, y - 1, w + 6, 10);
      ctx.fillStyle = diverged
        ? 'rgba(232, 180, 74, 0.95)'
        : labelColor;
      ctx.globalAlpha = intensity;
      ctx.fillText(label, pos.x, y);
    }
  }
  ctx.restore();
}
