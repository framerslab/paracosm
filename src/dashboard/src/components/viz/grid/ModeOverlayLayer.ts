/**
 * @fileoverview Mode-specific Canvas2D overlays that render AFTER the
 * base layers (RD + GoL + seeds + glyphs) but BEFORE the HUD. Each
 * entry point draws a self-contained, readable story layer for the
 * mode it owns:
 *
 *   - FORGE     : cumulative forge-count heatmap by dept centroid.
 *                 Shows where tool-genesis happened — bright glow
 *                 around dept clusters that forged the most tools.
 *   - ECOLOGY   : 4-quadrant resource hex tint (food / water / power /
 *                 volume) overlaid on the canvas, saturation ~ scarcity.
 *                 Reads as a resource-scarcity map.
 *   - DIVERGENCE: bright highlight rings around cells alive on this
 *                 side but dead on the sibling side at the same turn.
 *                 Directly visualizes leader-driven life/death divergence.
 *
 * The mode pill layer previously just dimmed the RD field for these
 * modes (0.2-0.7× fieldIntensity) — the visible delta was subtle
 * and users couldn't tell mode changes were doing anything. These
 * overlays give each mode a recognizable signature.
 *
 * @module paracosm/dashboard/viz/grid/ModeOverlayLayer
 */
import type { CellSnapshot, GridPosition, TurnSnapshot } from '../viz-types.js';

export interface ForgeEvent {
  department?: string;
  turn: number;
  approved?: boolean;
}

/**
 * Draw the FORGE heatmap — one soft-glow halo per department, sized
 * by that department's cumulative approved-forge count across the
 * current snapshot's turn window. Departments with zero forges
 * render nothing; the dept with the most forges gets the brightest
 * halo. Glows are centered on the dept cluster's centroid computed
 * from the cell positions map.
 */
export function drawForgeHeatmap(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  forgeEvents: ForgeEvent[],
  sideColor: string,
): void {
  if (cells.length === 0 || forgeEvents.length === 0) return;

  // Count approved forges per dept.
  const forgesByDept = new Map<string, number>();
  for (const ev of forgeEvents) {
    if (ev.approved === false) continue;
    const dept = (ev.department || 'unknown').toLowerCase();
    forgesByDept.set(dept, (forgesByDept.get(dept) ?? 0) + 1);
  }
  if (forgesByDept.size === 0) return;

  // Centroid per dept from the live positions map.
  const centroids = new Map<string, { x: number; y: number; count: number }>();
  for (const c of cells) {
    if (!c.alive) continue;
    const pos = positions.get(c.agentId);
    if (!pos) continue;
    const dept = (c.department || 'unknown').toLowerCase();
    const slot = centroids.get(dept) ?? { x: 0, y: 0, count: 0 };
    slot.x += pos.x;
    slot.y += pos.y;
    slot.count += 1;
    centroids.set(dept, slot);
  }

  const maxForges = Math.max(...forgesByDept.values());
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [dept, count] of forgesByDept.entries()) {
    const centroid = centroids.get(dept);
    if (!centroid || centroid.count === 0) continue;
    const cx = centroid.x / centroid.count;
    const cy = centroid.y / centroid.count;
    // Halo radius scales 30-80px based on forge-count ratio, so the
    // top dept is clearly dominant. Inner alpha peaks at 0.45,
    // fading to 0 at the outer ring — visible but doesn't wash out
    // the colonist glyphs layered on top.
    const ratio = count / maxForges;
    const radius = 30 + ratio * 50;
    const alpha = 0.2 + ratio * 0.25;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, withAlpha(sideColor, alpha));
    grad.addColorStop(0.6, withAlpha(sideColor, alpha * 0.4));
    grad.addColorStop(1, withAlpha(sideColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    // Forge count badge centered on the glow. Small but legible.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = withAlpha(sideColor, 0.95);
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${count}`, cx, cy);
    ctx.globalCompositeOperation = 'lighter';
  }
  ctx.restore();
}

/**
 * Draw the ECOLOGY resource quadrant tint. Divides the canvas into
 * four quadrants (top-left = food, top-right = water, bottom-left =
 * power, bottom-right = volume) and paints each with a saturation
 * ramp derived from the resource's scarcity — full alpha when the
 * resource is critically low, transparent when abundant.
 *
 * Reads the snapshot's resource fields if present. Silently no-op
 * for snapshots that don't carry the expected keys (scenarios other
 * than Mars may label differently; this is a Mars-tuned overlay for
 * now).
 */
export function drawEcologyResourceMap(
  ctx: CanvasRenderingContext2D,
  snapshot: TurnSnapshot,
  width: number,
  height: number,
): void {
  const asNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const snap = snapshot as unknown as Record<string, unknown>;
  const food = asNum(snap.foodReserve);
  const water = asNum(snap.waterLitersPerDay);
  const power = asNum(snap.powerKw);
  const volume = asNum(snap.pressurizedVolumeM3);
  if (food == null && water == null && power == null && volume == null) return;

  // Scarcity tier: 1.0 = critical, 0.0 = abundant. Units are scenario-
  // specific so the thresholds below are rough Mars-defaults; scenarios
  // with different scales will just render softer tints (not wrong,
  // just less informative).
  const scarcity = (val: number | null, critical: number, abundant: number): number => {
    if (val == null) return 0;
    if (val <= critical) return 1;
    if (val >= abundant) return 0;
    return 1 - (val - critical) / (abundant - critical);
  };
  const foodS = scarcity(food, 3, 18);
  const waterS = scarcity(water, 200, 1200);
  const powerS = scarcity(power, 150, 600);
  const volumeS = scarcity(volume, 1500, 4000);

  // Colors: green channel for abundant overlays, amber/rust for scarce.
  // Alpha capped at 0.22 so the glyphs remain visible above.
  const tint = (s: number): string => {
    if (s < 0.33) return `rgba(106, 173, 72, ${0.06 + s * 0.1})`; // green-ish
    if (s < 0.66) return `rgba(232, 180, 74, ${0.08 + (s - 0.33) * 0.2})`; // amber
    return `rgba(196, 74, 30, ${0.12 + (s - 0.66) * 0.3})`; // rust
  };

  const halfW = width / 2;
  const halfH = height / 2;
  ctx.save();
  // Top-left — food
  ctx.fillStyle = tint(foodS);
  ctx.fillRect(0, 0, halfW, halfH);
  // Top-right — water
  ctx.fillStyle = tint(waterS);
  ctx.fillRect(halfW, 0, halfW, halfH);
  // Bottom-left — power
  ctx.fillStyle = tint(powerS);
  ctx.fillRect(0, halfH, halfW, halfH);
  // Bottom-right — volume
  ctx.fillStyle = tint(volumeS);
  ctx.fillRect(halfW, halfH, halfW, halfH);

  // Labels so users can tell which quadrant is which. Small faint
  // monospace in each quadrant's corner.
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(216, 204, 176, 0.6)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (food != null) ctx.fillText(`FOOD ${food.toFixed(1)}mo`, 8, 8);
  if (water != null) {
    ctx.textAlign = 'right';
    ctx.fillText(`WATER ${Math.round(water)}L/d`, width - 8, 8);
  }
  if (power != null) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`POWER ${Math.round(power)}kW`, 8, height - 8);
  }
  if (volume != null) {
    ctx.textAlign = 'right';
    ctx.fillText(`VOL ${Math.round(volume)}m³`, width - 8, height - 8);
  }
  // Reset baseline for downstream layers.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'start';
  ctx.restore();
}

/**
 * Draw the DIVERGENCE highlight pass — bright rings around cells
 * whose agentId is in `divergedIds` (colonists alive on this side
 * but dead on the sibling at the same turn). Renders on top of the
 * normal glyph pass so the highlight reads as an overlay rather
 * than replacing the glyph.
 *
 * Pulses subtly via timeMs so the highlight stands out even in
 * dense panels without per-frame re-evolution of the ring.
 */
export function drawDivergenceHighlight(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  divergedIds: Set<string> | undefined,
  timeMs: number,
  sideColor: string,
): void {
  if (!divergedIds || divergedIds.size === 0) return;
  const pulse = 0.6 + 0.4 * Math.sin(timeMs * 0.004);
  ctx.save();
  for (const c of cells) {
    if (!c.alive) continue;
    if (!divergedIds.has(c.agentId)) continue;
    const pos = positions.get(c.agentId);
    if (!pos) continue;
    // Triple ring: bright inner, fading outer. Outer ring scales
    // with the sin-pulse so the whole set breathes at ~2s period.
    ctx.strokeStyle = sideColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45 * pulse;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 14 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.2 * pulse;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 20 + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Convert a CSS color string (hex or rgb/rgba) to rgba with a given
 *  alpha. Accepts canvas-resolved colors; unresolved `var(--x)` would
 *  silently fail at the canvas layer so callers are expected to pass
 *  a concrete color. */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    if (c.length === 7) {
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map(s => s.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
    }
  }
  return c;
}
