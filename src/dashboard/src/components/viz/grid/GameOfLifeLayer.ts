/**
 * @fileoverview Conway's Game of Life overlay — discrete cell grid
 * that evolves per frame using the classic B3/S23 rules. Seeded from
 * colonist positions on each turn change so the simulation state
 * determines the initial pattern; from there the CA runs
 * deterministically without random perturbation.
 *
 * Why deterministic matters: earlier iterations sprinkled 0.005
 * ambient-spawn per cell per frame to keep sparse panels "alive",
 * but this broke the Conway aesthetic — cells appeared randomly
 * and never formed the classic blinker / glider / still-life
 * patterns that Conway is known for. Users read it as "chaotic, not
 * cohesive, not comprehensible". Stripping all randomness restores
 * the recognizable oscillator / still-life / glider behaviour.
 *
 * Grid resolution: 32 × 16 cells at default — one tile per ~22 × 25px
 * of overlay canvas at typical laptop widths. Large enough that
 * Conway oscillators read as distinct tiles; small enough that a
 * few blinkers fill the panel with visible activity.
 *
 * Evolution cadence: paused when `tickGol` is not called, so the
 * render loop can freeze the pattern during scrub / complete states
 * without extra state machinery.
 *
 * @module paracosm/dashboard/viz/grid/GameOfLifeLayer
 */
import type { CellSnapshot, GridPosition } from '../viz-types.js';

export interface GolConfig {
  /** Cell grid width in cells. */
  cols: number;
  /** Cell grid height in cells. */
  rows: number;
  /**
   * Half-extent of the block seeded at each colonist position.
   * seedRadius=2 plants a 5×5 block (classic Conway "square" seed
   * that immediately decays into a stable 4-cell block + orbiting
   * debris — visually readable within the first few generations).
   */
  seedRadius: number;
}

export const DEFAULT_GOL_CONFIG: GolConfig = {
  // Chunky 12×6 grid = 72 cells total. At typical 600-700px panel
  // width, each tile renders ~50×55px — big enough to read as
  // primary visual texture rather than pixel specks. Prior 20×10,
  // 32×16, 64×32 iterations all produced tiles that were too fine
  // for the low alive-colonist count (3-6 colonists produce 12-20
  // alive cells; at high density those cluster as recognizable
  // oscillators, at low density as faint dots).
  cols: 12,
  rows: 6,
  seedRadius: 2,
};

/**
 * Classic Conway starter patterns. Each is a list of (x, y) offsets
 * relative to a chosen anchor.
 *
 * Pattern choice is NOT random — it is driven by the seeding
 * colonist's mood. That maps emotional state directly to the Conway
 * semantics the viewer already intuits:
 *
 *   BLOCK    — still-life, never moves. Calm/settled colonist.
 *   BEEHIVE  — larger still-life. Stable, enduring.
 *   BLINKER  — period-2 oscillator, stays in place. Restless but contained.
 *   TOAD     — period-2 oscillator, slower cadence. Uneasy.
 *   GLIDER   — moves diagonally across the grid. Agitated, active.
 *   R_PENTOMINO — chaotic, spawns gliders + debris for hundreds of
 *              generations. A colonist whose personality breaks the colony.
 *
 * This turns a formerly-meaningless Conway field into a direct
 * read of "what is the mood of this colony". A viewer scanning the
 * two panels can tell at a glance which side is calm (mostly
 * still-lifes) vs restless (oscillators/gliders everywhere).
 */
const GLIDER: Array<[number, number]> = [
  [1, 0], [2, 1], [0, 2], [1, 2], [2, 2],
];
const BLINKER: Array<[number, number]> = [
  [0, 1], [1, 1], [2, 1],
];
const BLOCK: Array<[number, number]> = [
  [0, 0], [1, 0], [0, 1], [1, 1],
];
const BEEHIVE: Array<[number, number]> = [
  [1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2],
];
const TOAD: Array<[number, number]> = [
  [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1],
];
const R_PENTOMINO: Array<[number, number]> = [
  [1, 0], [2, 0], [0, 1], [1, 1], [1, 2],
];

function patternForMood(mood: string): Array<[number, number]> {
  switch (mood) {
    case 'positive':
    case 'hopeful':
      return BLOCK;
    case 'neutral':
      return BEEHIVE;
    case 'anxious':
      return BLINKER;
    case 'resigned':
      return TOAD;
    case 'defiant':
    case 'negative':
      return GLIDER;
    default:
      return BLINKER;
  }
}

/**
 * Draw birth markers as green filled squares with a bold "+" glyph
 * through each one at native-born colonist positions. Clearly
 * distinct from the side-tinted live Conway tiles and the gray
 * tombstone death markers. Green (new-life color) + plus glyph
 * (universal "addition") reads unmistakably as a birth event.
 */
export function drawBirthMarkers(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  overlayWidth: number,
  overlayHeight: number,
  cols: number,
  rows: number,
): void {
  const cw = overlayWidth / cols;
  const ch = overlayHeight / rows;
  const tile = Math.max(1, Math.min(cw, ch) - 2);
  ctx.save();
  ctx.fillStyle = 'rgba(106, 173, 72, 0.25)';
  ctx.strokeStyle = 'rgba(154, 205, 96, 0.95)';
  ctx.lineWidth = 2;
  for (const c of cells) {
    if (!c.alive) continue;
    if ((c.generation ?? 0) === 0) continue;
    const p = positions.get(c.agentId);
    if (!p) continue;
    const col = Math.floor((p.x / Math.max(1, overlayWidth)) * cols);
    const row = Math.floor((p.y / Math.max(1, overlayHeight)) * rows);
    const offX = (cw - tile) / 2;
    const offY = (ch - tile) / 2;
    const x = col * cw + offX;
    const y = row * ch + offY;
    ctx.fillRect(x, y, tile, tile);
    ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
    // "+" glyph — horizontal and vertical bars across the center.
    const midX = x + tile / 2;
    const midY = y + tile / 2;
    const barLen = tile * 0.4;
    ctx.beginPath();
    ctx.moveTo(midX - barLen, midY);
    ctx.lineTo(midX + barLen, midY);
    ctx.moveTo(midX, midY - barLen);
    ctx.lineTo(midX, midY + barLen);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw dead-colonist death markers as gray hollow squares with a
 * diagonal X slash through each one. Read as "tombstone tiles" —
 * clearly distinct from the filled-square live Conway cells, so
 * when the DEATHS filter is active the viewer sees death events,
 * not more live cells. Called as a separate canvas pass alongside
 * (or instead of) drawGol when the filter is active.
 */
export function drawDeadMarkers(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  overlayWidth: number,
  overlayHeight: number,
  cols: number,
  rows: number,
): void {
  const cw = overlayWidth / cols;
  const ch = overlayHeight / rows;
  const tile = Math.max(1, Math.min(cw, ch) - 2);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(168, 152, 120, 0.85)';
  ctx.fillStyle = 'rgba(168, 152, 120, 0.08)';
  for (const c of cells) {
    if (c.alive) continue;
    const p = positions.get(c.agentId);
    if (!p) continue;
    const col = Math.floor((p.x / Math.max(1, overlayWidth)) * cols);
    const row = Math.floor((p.y / Math.max(1, overlayHeight)) * rows);
    const offX = (cw - tile) / 2;
    const offY = (ch - tile) / 2;
    const x = col * cw + offX;
    const y = row * ch + offY;
    ctx.fillRect(x, y, tile, tile);
    ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + tile - 4, y + tile - 4);
    ctx.moveTo(x + tile - 4, y + 4);
    ctx.lineTo(x + 4, y + tile - 4);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Hit-test a cursor position against the GoL grid. Returns the
 * { col, row } of the alive cell under the cursor, or null when
 * the cursor is over an empty tile or off-grid. Used to back
 * tooltip + click interactions on the cellular-automata layer so
 * viewers can inspect what a Conway tile represents.
 */
export function hitTestGol(
  state: GolState,
  cursorX: number,
  cursorY: number,
  overlayWidth: number,
  overlayHeight: number,
): { col: number; row: number } | null {
  const { cols, rows, grid } = state;
  const col = Math.floor((cursorX / Math.max(1, overlayWidth)) * cols);
  const row = Math.floor((cursorY / Math.max(1, overlayHeight)) * rows);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  if (grid[row * cols + col] > 0) return { col, row };
  return null;
}

/**
 * Which grid cell does a colonist live in? Thin inverse of the
 * plantPattern position math — used by hover tooltips so we can
 * attribute an alive Conway tile back to the colonist whose seed
 * produced it (or to the nearest neighbor when the glider has
 * drifted away from its seed).
 */
export function cellToTile(
  p: GridPosition,
  overlayWidth: number,
  overlayHeight: number,
  cols: number,
  rows: number,
): { col: number; row: number } {
  return {
    col: Math.floor((p.x / Math.max(1, overlayWidth)) * cols),
    row: Math.floor((p.y / Math.max(1, overlayHeight)) * rows),
  };
}

/**
 * Drop a Conway starter pattern onto the grid at the overlay-space
 * position `p`. Used by seedFromColonists for filter-specific
 * per-event seeding (deaths, births, etc.) where each event's
 * position gets its own pattern instead of a shared mood-driven one.
 */
function plantPattern(
  grid: Uint8Array,
  cols: number,
  rows: number,
  p: GridPosition,
  overlayWidth: number,
  overlayHeight: number,
  pattern: Array<[number, number]>,
): void {
  const cx = Math.floor((p.x / Math.max(1, overlayWidth)) * cols);
  const cy = Math.floor((p.y / Math.max(1, overlayHeight)) * rows);
  for (const [dx, dy] of pattern) {
    const x = cx + dx - 1;
    const y = cy + dy - 1;
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    grid[y * cols + x] = 8;
  }
}

/**
 * When the EventChronicle filter pill is active (not 'all'), the
 * Conway seed uses a filter-specific pattern so the visualization
 * tracks the user's narrow: BIRTHS reads as stable blocks, DEATHS
 * as mostly empty, FORGES as moving gliders, CRISES as long-lived
 * chaotic debris. Returning null means "fall back to mood-driven".
 */
function patternForFilter(filter: string): Array<[number, number]> | null {
  switch (filter) {
    case 'birth': return BLOCK;
    case 'forge': return GLIDER;
    case 'crisis': return R_PENTOMINO;
    case 'death': return []; // Explicit empty — death filter kills cells.
    default: return null;
  }
}

/**
 * Persistent state between frames — owned by the caller (normally a
 * React ref) so React remounts don't reset the evolving pattern.
 */
export interface GolState {
  cols: number;
  rows: number;
  /** Current cell grid, row-major. Uint8Array. 0 = dead. 1-8 = alive
   *  age (freshly born = 8, aging survivors count down to 1 for
   *  visual trail rendering; any age >= 1 counts as "alive" for
   *  Conway rule evaluation). */
  grid: Uint8Array;
  /** Scratch buffer for next-generation computation. */
  next: Uint8Array;
  /** Frame counter — call sites increment via tickGol. */
  frame: number;
}

/** Initialise a fresh GoL state sized to the grid. */
export function createGolState(cols: number, rows: number): GolState {
  return {
    cols,
    rows,
    grid: new Uint8Array(cols * rows),
    next: new Uint8Array(cols * rows),
    frame: 0,
  };
}

/**
 * Cheap content-addressed hash for a list of colonist positions at a
 * given turn. Used as the cache key for stabilized GoL grids so the
 * same turn + same positions always resolves to the same cached
 * pattern. Not cryptographic — just a fast deterministic fingerprint.
 */
export function hashSeedLayout(
  turn: number,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  cols: number,
  rows: number,
): string {
  let h = turn * 2654435761;
  for (const c of cells) {
    if (!c.alive) continue;
    const p = positions.get(c.agentId);
    if (!p) continue;
    const cx = Math.floor((p.x / Math.max(1, cols)) * cols);
    const cy = Math.floor((p.y / Math.max(1, rows)) * rows);
    // Mix agentId char codes (pattern selection hashes off this) +
    // cx/cy so both position AND starter-pattern choice participate.
    let idH = 0;
    for (let j = 0; j < c.agentId.length; j += 1) {
      idH = (idH * 31 + c.agentId.charCodeAt(j)) | 0;
    }
    h = (h * 33) ^ idH ^ ((cx * 73856093) ^ (cy * 19349663));
    h |= 0;
  }
  return `${cols}x${rows}:${h >>> 0}`;
}

/** Reset the grid to all-dead. Useful on sim clear. */
export function clearGol(state: GolState): void {
  state.grid.fill(0);
  state.next.fill(0);
  state.frame = 0;
}

/**
 * Seed the grid from colonist positions using classic Conway starter
 * patterns. Each colonist plants a short pattern (glider / blinker /
 * block / R-pentomino) rotated by their agentId hash so adjacent
 * colonists don't all seed identical cells. This produces clean,
 * recognizable Conway motion instead of the randomized noise the
 * prior ambient-spawn implementation generated.
 *
 * Called by the render loop on turn changes — NOT every frame. Once
 * seeded, the pattern evolves via B3/S23 alone.
 */
export function seedFromColonists(
  state: GolState,
  cells: CellSnapshot[],
  positions: Map<string, GridPosition>,
  overlayWidth: number,
  overlayHeight: number,
  eventFilter: string = 'all',
): void {
  const { cols, rows, grid } = state;
  // Full reset before seeding so re-seed doesn't accumulate fossil
  // cells from previous turns. Classic Conway evolutions expect a
  // clean slate — layering old-turn patterns under new ones
  // produces the chaotic behaviour the user correctly called out.
  grid.fill(0);

  // Filter-specific seeding: only plant patterns where the filter's
  // event actually happened. DEATHS seeds TOAD at every dead cell,
  // BIRTHS seeds BLOCK at every native-born cell (generation > 0),
  // and so on. This answers "show me the deaths" with "here's where
  // each death happened" instead of an empty canvas.
  // Death filter: keep the mood-driven Conway seed running (same as
  // 'all' below) so the CA texture stays visible behind the overlay
  // tombstone markers. Previously this branch returned early and
  // cleared the grid, which meant sides with only 1 death showed a
  // nearly-empty canvas — the markers were there but lost without
  // the surrounding Conway context. Death markers still render as
  // a distinct gray X overlay in LivingSwarmGrid.
  // Fall through to the default mood-driven seed below.
  // Birth filter: same pattern as death — keep the mood-driven
  // Conway seed running so the ambient CA texture is preserved, and
  // let drawBirthMarkers render green + overlays on top in
  // LivingSwarmGrid. Sides with few births would otherwise show a
  // nearly-empty canvas with a single marker.
  // Fall through to the default mood-driven seed below.

  const filterPattern = patternForFilter(eventFilter);
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    if (!c.alive) continue;
    const p = positions.get(c.agentId);
    if (!p) continue;
    const cx = Math.floor((p.x / Math.max(1, overlayWidth)) * cols);
    const cy = Math.floor((p.y / Math.max(1, overlayHeight)) * rows);
    // Filter overrides mood when active; 'all' falls back to mood-
    // driven pattern selection.
    const pattern = filterPattern ?? patternForMood(c.mood);
    for (const [dx, dy] of pattern) {
      const x = cx + dx - 1;
      const y = cy + dy - 1;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      grid[y * cols + x] = 8;
    }
  }
}

/**
 * Inject a Conway starter pattern at the flare location so new
 * events visibly disturb the GoL grid. Call once per new event:
 *
 *   birth          → plant a BLOCK (stable growth)
 *   death          → kill a 3x3 area (decay)
 *   forge approved → plant a GLIDER (forward motion)
 *   forge rejected → plant a BLINKER (stuck, oscillating)
 *   reuse          → plant a TOAD (slow rhythm)
 *   crisis         → plant an R_PENTOMINO (chaotic, long-lived)
 *
 * Overlay-pixel coords are mapped to grid coords using the canvas
 * size. Out-of-bounds writes are clamped silently.
 */
export function injectFlareIntoGol(
  state: GolState,
  flare: { kind: string; x: number; y: number },
  overlayWidth: number,
  overlayHeight: number,
): void {
  const { cols, rows, grid } = state;
  const cx = Math.floor((flare.x / Math.max(1, overlayWidth)) * cols);
  const cy = Math.floor((flare.y / Math.max(1, overlayHeight)) * rows);
  if (flare.kind === 'death') {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        grid[y * cols + x] = 0;
      }
    }
    return;
  }
  let pattern: Array<[number, number]>;
  switch (flare.kind) {
    case 'birth': pattern = BLOCK; break;
    case 'forge_approved': pattern = GLIDER; break;
    case 'forge_rejected': pattern = BLINKER; break;
    case 'reuse': pattern = TOAD; break;
    case 'crisis': pattern = R_PENTOMINO; break;
    default: pattern = BLINKER;
  }
  for (const [dx, dy] of pattern) {
    const x = cx + dx - 1;
    const y = cy + dy - 1;
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    grid[y * cols + x] = 8;
  }
}

/**
 * Advance one GoL generation using classic B3/S23 rules. No random
 * perturbation — the grid evolves deterministically from whatever
 * was seeded. This is what produces the recognizable Conway
 * oscillator / glider behaviour.
 *
 * The age field serves only rendering: survivors get age
 * `max(previous - 1, 4)` so long-running stable patterns stay
 * visibly bright rather than fading to gray; dead cells that were
 * recently alive keep a short trail via the age decay below.
 */
export function tickGol(state: GolState): void {
  const { cols, rows, grid, next } = state;
  next.fill(0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          if (grid[ny * cols + nx] > 0) neighbors += 1;
        }
      }
      const self = grid[y * cols + x];
      const alive = self > 0;
      const willLive = alive
        ? neighbors === 2 || neighbors === 3
        : neighbors === 3;
      if (willLive) {
        // Surviving cells stay bright (floor at 4 so long-lived
        // oscillators don't fade away); fresh births peak at 8.
        next[y * cols + x] = alive ? Math.max(4, self) : 8;
      } else if (alive && self > 1) {
        // Decaying trail: cells that WOULD die still render for a
        // few generations with declining age so the user can see
        // where a pattern just was. Fully dead at age 1.
        next[y * cols + x] = Math.max(0, self - 2);
      }
    }
  }
  grid.set(next);
  state.frame += 1;
}

/**
 * Render the grid as discrete cells onto the overlay canvas. Cells
 * draw as square pixels sized to the cols/rows density; age drives
 * alpha (newly born = bright, aging = progressively dimmer) giving
 * the signature "trail" look that reads as cellular-automaton
 * rather than static scatter.
 *
 * @param intensity 0..1 multiplier on the final alpha, so callers
 *   can dim the whole layer in modes where GoL is a background
 *   element (e.g. ECOLOGY with its metrics-strip-led layout).
 */
export function drawGol(
  ctx: CanvasRenderingContext2D,
  state: GolState,
  overlayWidth: number,
  overlayHeight: number,
  sideColor: string,
  intensity: number = 1,
): void {
  const { cols, rows, grid } = state;
  if (intensity <= 0) return;
  const cw = overlayWidth / cols;
  const ch = overlayHeight / rows;
  // Draw cells as SQUARES sized by the smaller of (cw, ch). Only 2px
  // subtracted for gap so tiles are chunky — at 12×6 default grid
  // that gives ~45px solid squares on a typical panel, visually
  // unambiguous Conway cells.
  const tile = Math.max(1, Math.min(cw, ch) - 2);
  const offX = (cw - tile) / 2;
  const offY = (ch - tile) / 2;
  ctx.save();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const age = grid[y * cols + x];
      if (age === 0) continue;
      // Alpha peaks at 0.9 for fresh (age=8) and trails down to
      // ~0.1 for almost-dead (age=1). Intensity scales the whole
      // layer per mode.
      const alpha = Math.min(1, (age / 8) * 0.9 * intensity);
      ctx.fillStyle = sideColor;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x * cw + offX, y * ch + offY, tile, tile);
    }
  }
  ctx.restore();
}
