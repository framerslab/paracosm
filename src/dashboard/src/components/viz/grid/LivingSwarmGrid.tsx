import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TurnSnapshot, ClusterMode, CellSnapshot } from '../viz-types.js';
import styles from './LivingSwarmGrid.module.scss';
import { computeGridPositions } from './gridPositions.js';
import { drawGlyphs } from './GlyphLayer.js';
import { drawFlares } from './FlareLayer.js';
import { drawHud } from './HudLayer.js';
import {
  drawForgeHeatmap,
  drawEcologyResourceMap,
  drawDivergenceHighlight,
} from './ModeOverlayLayer.js';
import { useGridState, type ForgeAttempt, type ReuseCall } from './useGridState.js';
import { computeDeptCenters } from './deptCenters.js';
import { GridMetricsStrip } from './GridMetricsStrip.js';
import {
  createGolState,
  seedFromColonists,
  tickGol,
  drawGol,
  drawDeadMarkers,
  drawBirthMarkers,
  hitTestGol,
  cellToTile,
  injectFlareIntoGol,
  DEFAULT_GOL_CONFIG,
  type GolState,
} from './GameOfLifeLayer.js';
import { hitTestGlyph } from './hitTest.js';
import type { GridMode } from './GridModePills.js';
import { ClickPopover, type ClickPopoverPayload } from './ClickPopover.js';
import { useMediaQuery, NARROW_QUERY, REDUCED_MOTION_QUERY } from './useMediaQuery.js';
import { DEFAULT_GRID_SETTINGS, type GridSettings } from './GridSettingsDrawer.js';
import { RosterDrawer } from './RosterDrawer.js';
import { FeaturedSpotlight } from './FeaturedSpotlight.js';
import { useScenarioLabels } from '../../../hooks/useScenarioLabels.js';

interface HexacoShape { O: number; C: number; E: number; A: number; Em: number; HH: number }

interface LivingSwarmGridProps {
  snapshot: TurnSnapshot | undefined;
  previousSnapshot?: TurnSnapshot | undefined;
  /** Full snapshot history for this side; enables recent-memory lookup. */
  snapshotHistory?: TurnSnapshot[];
  actorName: string;
  actorArchetype: string;
  leaderUnit?: string;
  /** First time of the scenario for HUD "Yr N" readout. */
  startTime?: number;
  sideColor: string;
  side: 'a' | 'b';
  lagTurns?: number;
  clusterMode?: ClusterMode;
  initialPopulation?: number;
  /** Shared grid mode across both leaders. */
  mode: GridMode;
  /** HEXACO profiles keyed by agentId for the popover radar. */
  hexacoById?: Map<string, HexacoShape>;
  /**
   * Leader's own HEXACO profile. When supplied, the Gray-Scott
   * chemistry nudges F/k based on the leader's archetype so the two
   * panels diverge visibly from turn 1 even when colony stats are
   * identical — addressing user feedback that both sides rendered
   * identically because the field inputs (morale/food/pop) were the
   * same on both colonies at launch.
   */
  leaderHexaco?: HexacoShape;
  /** Cumulative forge attempts for this side — drives forge flares. */
  forgeAttempts?: ForgeAttempt[];
  /** Cumulative reuse calls — drives reuse arcs. */
  reuseCalls?: ReuseCall[];
  /** Colonists alive on this side but dead on the other at the same
   *  turn. Highlighted in DIVERGENCE mode + tinted in all other modes
   *  when non-empty. */
  divergedIds?: Set<string>;
  /** agentId currently hovered on the SIBLING panel. Shown as a
   *  sympathetic ring on this side so the same colonist is easy to
   *  compare across panels. */
  siblingHoveredId?: string | null;
  /** Fires when the user hovers a colonist on this panel. Lifted so
   *  the sibling panel can render a sympathetic ring. */
  onHoverChange?: (agentId: string | null) => void;
  /** Case-insensitive name substring. When non-empty, matching glyphs
   *  get a bright halo and non-matches dim. */
  searchQuery?: string;
  /** Display-shader palette: 0=amber, 1=cool, 2=mono. */
  palette?: 0 | 1 | 2;
  /** User-tunable viz settings (anim speed, rings, lines, dust, crosshair). */
  settings?: GridSettings;
  /** Full-screen state — if `this` is the active full-screen side,
   *  `'a'` or `'b'`. When focused side is not this panel, we hide. */
  focusedSide?: 'a' | 'b' | null;
  /** Fires when the focus-toggle is clicked. Parent decides whether
   *  this panel becomes sole focus or both return to side-by-side. */
  onToggleFocus?: (side: 'a' | 'b') => void;
  /** Invoked when the user chooses "Open chat" inside the popover. */
  onOpenChat?: (colonistName: string) => void;
  /**
   * Active event-kind filter from the EventChronicle strip. When set
   * to anything other than `'all'`, flares whose kind doesn't match
   * are dropped from the canvas — the user's filter choice propagates
   * through to the main visualization instead of only hiding
   * chronicle rows. `'all'` (default when omitted) is a passthrough.
   */
  eventFilter?: 'all' | 'birth' | 'death' | 'forge' | 'crisis';
  /**
   * The chronicle pill the user is currently hovering (or null when
   * the cursor left the strip). When the hovered pill's `side`
   * matches this panel's side, the panel border briefly pulses in
   * the event's category color — making the chronicle row feel
   * directly connected to the canvas.
   */
  chronicleHover?: { kind: 'birth' | 'death' | 'forge' | 'crisis'; side: 'a' | 'b'; turn: number } | null;
}

function resolveCssColor(color: string, element: HTMLElement | null): string {
  if (color.startsWith('var(') && element) {
    const varName = color.slice(4, -1).trim();
    const computed = getComputedStyle(element).getPropertyValue(varName).trim();
    if (computed) return computed;
  }
  return color;
}

/**
 * Per-leader living swarm grid. Canvas2D overlay renders colonist
 * glyphs, event flares, hover + click interactions, and a HUD corner
 * readout on top of a static morale-tinted CSS gradient background.
 * GridMetricsStrip DOM layer sits above the canvas; FeaturedSpotlight
 * pill stack sits bottom-right. Named "swarm" rather than "colony" so
 * the component reads cleanly for non-Mars scenarios — the semantics
 * are scenario-agnostic; only the `scenarioLabels` hook localizes the
 * population-noun ("colonist" / "employee" / "soldier" / ...).
 */
export function LivingSwarmGrid(props: LivingSwarmGridProps) {
  const {
    snapshot,
    previousSnapshot,
    snapshotHistory,
    actorName,
    actorArchetype,
    startTime,
    sideColor,
    side,
    lagTurns,
    clusterMode = 'departments',
    initialPopulation = 20,
    mode,
    hexacoById,
    leaderHexaco,
    forgeAttempts,
    reuseCalls,
    divergedIds,
    siblingHoveredId,
    onHoverChange,
    searchQuery = '',
    palette = 0,
    settings = DEFAULT_GRID_SETTINGS,
    focusedSide = null,
    onToggleFocus,
    onOpenChat,
    eventFilter = 'all',
    chronicleHover = null,
  } = props;
  const isFocused = focusedSide === side;

  const narrow = useMediaQuery(NARROW_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const scenarioLabels = useScenarioLabels();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<{
    cell: CellSnapshot;
    x: number;
    y: number;
  } | null>(null);
  // Raw cursor position in overlay-canvas pixel space. Used to draw a
  // dim crosshair + "nearest colonist" reading even when the cursor
  // is between glyphs (i.e. no glyph hit but cursor is still on-canvas).
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [popover, setPopover] = useState<ClickPopoverPayload | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  // Conway tile hover: populated when the cursor is over a live GoL
  // cell or a birth/death marker but NOT over a colonist glyph. Drives
  // the compact tile-info tooltip so users can decode what a pattern
  // means instead of staring at it trying to guess.
  const [hoveredTile, setHoveredTile] = useState<{
    col: number;
    row: number;
    x: number;
    y: number;
    kind: 'life' | 'birth' | 'death';
    nearest: CellSnapshot | null;
  } | null>(null);
  /**
   * Mount-time staged reveal. Uses a CSS-driven cover-div approach
   * rather than canvas globalAlpha because the canvas layers mutate
   * alpha internally via save/restore, which would clobber any
   * outer alpha. The cover div starts opaque (hiding the canvas
   * entirely) then transitions to transparent over 400ms — gives
   * the tab a smooth "curtain rise" on mount without requiring any
   * per-frame redraw. Reduced-motion users get instant reveal.
   */
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (reducedMotion) {
      setRevealed(true);
      return;
    }
    // Start on next frame so the CSS transition fires (setting
    // revealed=true synchronously would skip the transition).
    const raf = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);
  // Conway Game of Life ambient overlay. Seeded from colonist
  // mood + position on turn change (5 warmup ticks to stabilize into
  // recognizable Conway patterns), and advanced one generation per
  // incoming event flare — so new births / deaths / forges / crises
  // cause the grid to react visibly instead of staying static.
  const golStateRef = useRef<GolState>(createGolState(DEFAULT_GOL_CONFIG.cols, DEFAULT_GOL_CONFIG.rows));
  const lastGolTurnRef = useRef<number>(-1);
  const lastGolModeRef = useRef<string>('');
  const lastGolFilterRef = useRef<string>('');
  const lastFlareSignatureRef = useRef<string | null>(null);

  // Relationship-flare: when a colonist is clicked, brighten their
  // partner/child arcs briefly (~1s decay). Ref, not state, so the
  // decay itself doesn't force re-render — consumed in the render
  // effect alongside the RD pulse.
  const relationshipFlareRef = useRef<{ id: string | null; intensity: number }>({
    id: null,
    intensity: 0,
  });

  // Resize observer on the canvas wrapper (not the full container — the
  // container also holds the metrics strip DOM above the canvas).
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(1, Math.round(e.contentRect.width));
        const h = Math.max(1, Math.round(e.contentRect.height));
        setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = overlayCanvasRef.current;
    if (!c || size.w === 0 || size.h === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const ctx = c.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [size.w, size.h]);

  // Mode-driven cluster layout: each GridMode pill picks a distinct
  // clustering so colonist positions visibly reshape on click, not
  // just the overlays. LIVING stays 'departments' (the stable default
  // that lets the viewer track individuals across turns); MOOD/FORGE/
  // ECOLOGY/DIVERGENCE switch to layouts that emphasize each mode's
  // semantic axis.
  //
  //   LIVING      → departments   (default, continuity across turns)
  //   MOOD        → mood          (happy / anxious / defiant clusters)
  //   FORGE       → age           (visually distinct arrangement)
  //   ECOLOGY     → departments   (glyphs hidden, cluster irrelevant)
  //   DIVERGENCE  → families      (diverged families surface clearly)
  //
  // Fallbacks to the clusterMode prop when the caller explicitly
  // passes one (keeps the legacy contract intact).
  const modeClusterMode: ClusterMode = (() => {
    if (clusterMode !== 'departments') return clusterMode;
    switch (mode) {
      case 'mood': return 'mood';
      case 'forge': return 'age';
      case 'divergence': return 'families';
      case 'ecology':
      case 'living':
      default: return 'departments';
    }
  })();

  const positions = useMemo(() => {
    if (!snapshot || size.w === 0) return new Map<string, { x: number; y: number }>();
    return computeGridPositions(snapshot.cells, modeClusterMode, size.w, size.h);
  }, [snapshot, modeClusterMode, size.w, size.h]);

  const deptCentersOverlay = useMemo(() => {
    if (!snapshot) return new Map<string, { x: number; y: number }>();
    return computeDeptCenters(snapshot.cells, positions);
  }, [snapshot, positions]);

  const gridState = useGridState(
    {
      snapshot,
      previousSnapshot,
      forgeAttempts,
      reuseCalls,
      eventCategories: snapshot?.eventCategories,
    },
    canvasWrapRef,
    () => positions,
    () => deptCentersOverlay,
  );

  // Mode-driven glyph intensity. Forge dims glyphs slightly so forge
  // flare pulses dominate visually; ecology hides them so the metrics
  // strip + event flares carry the story alone.
  const glyphIntensity = mode === 'forge' ? 0.7 : mode === 'ecology' ? 0 : 1;

  // MOOD mode re-derives the field tint from the dominant alive-cell
  // mood rather than side affiliation. Both leader panels end up
  // visually distinct from each other when their mood distributions
  // diverge (e.g. Aria's visionary colony trending anxious while
  // Voss's engineer colony holds neutral). Falls back to sideColor
  // on empty / null snapshots.
  const moodTintedSideColor = useMemo(() => {
    if (mode !== 'mood' || !snapshot) return sideColor;
    const alive = snapshot.cells.filter(c => c.alive);
    if (alive.length === 0) return sideColor;
    const moodCounts: Record<string, number> = {};
    for (const c of alive) {
      moodCounts[c.mood] = (moodCounts[c.mood] || 0) + 1;
    }
    let dominantMood = 'neutral';
    let bestCount = 0;
    for (const [m, n] of Object.entries(moodCounts)) {
      if (n > bestCount) { bestCount = n; dominantMood = m; }
    }
    // Map to CSS color vars so theme switching still works. Tokens
    // here match the Toast / MetricsStrip mood palette used elsewhere.
    switch (dominantMood) {
      case 'positive':
      case 'hopeful': return 'var(--green)';
      case 'anxious': return 'var(--amber)';
      case 'negative':
      case 'defiant': return 'var(--rust)';
      case 'resigned': return 'var(--text-3)';
      default: return sideColor;
    }
  }, [mode, snapshot, sideColor]);

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay || !snapshot) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    // Apply the chronicle-strip filter here so the user's "show me
    // only forges" / "only crises" choice propagates through to the
    // canvas. The flare `.kind` vocabulary is broader than the
    // chronicle's — forge covers approved, rejected, AND reuse calls
    // so a "forges" filter keeps the whole forge narrative intact.
    const flareMatchesFilter = (f: { kind: string }): boolean => {
      if (eventFilter === 'all') return true;
      if (eventFilter === 'birth') return f.kind === 'birth';
      if (eventFilter === 'death') return f.kind === 'death';
      if (eventFilter === 'crisis') return f.kind === 'crisis';
      if (eventFilter === 'forge') {
        return f.kind === 'forge_approved' || f.kind === 'forge_rejected' || f.kind === 'reuse';
      }
      return true;
    };
    const visibleFlares = gridState.flares.filter(flareMatchesFilter);

    const resolvedSide = resolveCssColor(sideColor, containerRef.current);
    const cs = containerRef.current ? getComputedStyle(containerRef.current) : null;
    const hexToRgba = (hex: string, alpha: number): string | null => {
      if (!hex.startsWith('#') || hex.length !== 7) return null;
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    const labelBg =
      (cs && hexToRgba(cs.getPropertyValue('--bg-deep').trim(), 0.85)) ||
      'rgba(10, 8, 6, 0.85)';
    const textMuted =
      (cs && hexToRgba(cs.getPropertyValue('--text-2').trim(), 0.8)) ||
      'rgba(216, 204, 176, 0.75)';
    const crosshairStroke =
      (cs && hexToRgba(cs.getPropertyValue('--text-2').trim(), 0.22)) ||
      'rgba(216, 204, 176, 0.22)';
    const crosshairTracerStroke =
      (cs && hexToRgba(cs.getPropertyValue('--text-2').trim(), 0.7)) ||
      'rgba(216, 204, 176, 0.7)';
    const crosshairTracerFill =
      (cs && hexToRgba(cs.getPropertyValue('--text-2').trim(), 0.95)) ||
      'rgba(216, 204, 176, 0.95)';
    ctx.clearRect(0, 0, size.w, size.h);
    // Conway Game of Life ambient layer. On turn change: fresh seed +
    // 5-tick warmup from colonist mood + position. On any new event
    // flare (birth / death / forge / crisis): tick one generation
    // so the grid reacts visibly — birth drops a live seed at the
    // flare location, death kills a small radius, forge drops a
    // glider at the department centroid, crisis drops an R-pentomino
    // at colony center. Each new flare event advances the CA by one
    // generation so the grid feels like it's responding to the sim.
    const gol = golStateRef.current;
    const modeChanged = mode !== lastGolModeRef.current;
    const turnChanged = snapshot.turn !== lastGolTurnRef.current;
    const filterChanged = eventFilter !== lastGolFilterRef.current;
    if (turnChanged || modeChanged || filterChanged) {
      lastGolTurnRef.current = snapshot.turn;
      lastGolModeRef.current = mode;
      lastGolFilterRef.current = eventFilter;
      seedFromColonists(gol, snapshot.cells, positions, size.w, size.h, eventFilter);
      // Mode determines warmup depth so clicking a mode pill produces
      // a visibly different CA state: LIVING = stabilized (5 ticks),
      // MOOD = fresh seed (0 ticks, patterns sit unstabilized), FORGE
      // = over-evolved (8 ticks, gliders escape), ECOLOGY = minimal
      // (2 ticks), DIVERGENCE = extreme (12 ticks, chaos).
      let warmup: number;
      if (reducedMotion) {
        warmup = 3;
      } else if (mode === 'mood') {
        warmup = 0;
      } else if (mode === 'ecology') {
        warmup = 2;
      } else if (mode === 'forge') {
        warmup = 8;
      } else if (mode === 'divergence') {
        warmup = 12;
      } else {
        warmup = 5;
      }
      for (let i = 0; i < warmup; i += 1) tickGol(gol);
      lastFlareSignatureRef.current = visibleFlares.length
        ? `${visibleFlares[0].kind}|${visibleFlares[0].x}|${visibleFlares[0].y}`
        : null;
    } else if (visibleFlares.length > 0) {
      // Detect a newly-added flare via signature of the first flare
      // (queue is stable order; new flares push to front). When a new
      // event arrives, inject its effect + advance one generation so
      // the GoL reacts to the event.
      const topSig = `${visibleFlares[0].kind}|${visibleFlares[0].x}|${visibleFlares[0].y}`;
      if (topSig !== lastFlareSignatureRef.current) {
        lastFlareSignatureRef.current = topSig;
        injectFlareIntoGol(gol, visibleFlares[0], size.w, size.h);
        if (!reducedMotion) tickGol(gol);
      }
    }
    // Higher alpha (0.65) so the chunky tiles read as the primary
    // visual texture. Color follows side tint — amber for A, teal
    // for B — so the two panels stay distinguishable at a glance.
    drawGol(ctx, gol, size.w, size.h, resolvedSide, 0.65);
    // DEATHS filter: gray hollow tombstone squares with an X at each
    // dead colonist's historical position. BIRTHS filter: green filled
    // squares with a "+" glyph at each native-born colonist's position.
    // Each filter gets a distinct visual so the viewer reads events
    // as events, not as another Conway tile pattern.
    if (eventFilter === 'death') {
      drawDeadMarkers(
        ctx,
        snapshot.cells,
        positions,
        size.w,
        size.h,
        DEFAULT_GOL_CONFIG.cols,
        DEFAULT_GOL_CONFIG.rows,
      );
    } else if (eventFilter === 'birth') {
      drawBirthMarkers(
        ctx,
        snapshot.cells,
        positions,
        size.w,
        size.h,
        DEFAULT_GOL_CONFIG.cols,
        DEFAULT_GOL_CONFIG.rows,
      );
    }
    drawFlares(ctx, visibleFlares);
    if (mode !== 'ecology')
      drawGlyphs(
        ctx,
        snapshot.cells,
        positions,
        resolvedSide,
        glyphIntensity,
        divergedIds,
        mode === 'divergence',
        reducedMotion ? 0 : performance.now(),
        searchQuery,
        true, // always-on labels for featured + diverged
        textMuted,
      );
    // Mode-specific overlays. Each runs AFTER the base layers so its
    // own visual signature rides on top of the RD backdrop, and
    // BEFORE the HUD so the corner readouts stay readable.
    if (mode === 'forge' && forgeAttempts && forgeAttempts.length > 0) {
      drawForgeHeatmap(
        ctx,
        snapshot.cells,
        positions,
        forgeAttempts.map(f => ({
          department: f.department,
          turn: f.turn,
          approved: f.approved,
        })),
        resolvedSide,
      );
    }
    if (mode === 'ecology') {
      drawEcologyResourceMap(ctx, snapshot, size.w, size.h);
    }
    if (mode === 'divergence') {
      drawDivergenceHighlight(
        ctx,
        snapshot.cells,
        positions,
        divergedIds,
        reducedMotion ? 0 : performance.now(),
        resolvedSide,
      );
    }
    drawHud(ctx, snapshot, {
      actorName,
      actorArchetype,
      startTime,
      sideColor: resolvedSide,
      width: size.w,
      height: size.h,
      lagTurns,
      cells: snapshot.cells,
      positions,
      previousSnapshot,
      labelBg,
      textMuted,
      deptLabels: settings.deptLabels,
      timeUnitShort: scenarioLabels.Time,
    });

    // Hover ring on top of HUD so it reads as "selected".
    if (hovered) {
      const pos = positions.get(hovered.cell.agentId);
      if (pos) {
        ctx.save();
        ctx.strokeStyle = resolvedSide;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    // Dim crosshair following the cursor when it's over the canvas
    // but not hovering any glyph directly. Gives the user a precise
    // positional reference when reading the field.
    if (cursor && !hovered && settings.crosshair) {
      ctx.save();
      ctx.strokeStyle = crosshairStroke;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cursor.y);
      ctx.lineTo(size.w, cursor.y);
      ctx.moveTo(cursor.x, 0);
      ctx.lineTo(cursor.x, size.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Nearest alive colonist within a 40px radius — show their name
      // as a tiny ghost label so the user can orient.
      let nearest: { id: string; name: string; dx: number; dy: number; d2: number } | null = null;
      for (const c of snapshot.cells) {
        if (!c.alive) continue;
        const pos = positions.get(c.agentId);
        if (!pos) continue;
        const dx = pos.x - cursor.x;
        const dy = pos.y - cursor.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1600) continue; // >40px
        if (!nearest || d2 < nearest.d2) nearest = { id: c.agentId, name: c.name, dx, dy, d2 };
      }
      if (nearest) {
        ctx.save();
        ctx.strokeStyle = crosshairTracerStroke;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(cursor.x, cursor.y);
        ctx.lineTo(cursor.x + nearest.dx, cursor.y + nearest.dy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = crosshairTracerFill;
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`\u2192 ${nearest.name.split(' ')[0]}`, cursor.x + 6, cursor.y + 6);
        ctx.restore();
      }
    }
    // Sympathetic ring: same colonist is being hovered on the sibling
    // panel. Dashed + dimmer so it reads as secondary.
    if (siblingHoveredId && siblingHoveredId !== hovered?.cell.agentId) {
      const pos = positions.get(siblingHoveredId);
      if (pos) {
        ctx.save();
        ctx.strokeStyle = 'rgba(232, 180, 74, 0.75)';
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }, [
    gridState.tickClock,
    snapshot,
    positions,
    size.w,
    size.h,
    sideColor,
    actorName,
    lagTurns,
    gridState.flares,
    mode,
    glyphIntensity,
    hovered,
    divergedIds,
    siblingHoveredId,
    reducedMotion,
    searchQuery,
    cursor,
    settings,
    actorArchetype,
    startTime,
    forgeAttempts,
    eventFilter,
  ]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!snapshot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCursor({ x, y });
      const hit = hitTestGlyph(snapshot.cells, positions, x, y);
      if (hit) {
        setHovered(prev =>
          prev && prev.cell.agentId === hit.agentId ? prev : { cell: hit, x, y },
        );
        setHoveredTile(null);
        onHoverChange?.(hit.agentId);
        return;
      }
      if (hovered) {
        setHovered(null);
        onHoverChange?.(null);
      }
      // Glyph missed — try hit-testing the Conway / marker layers so
      // hovering a visible tile surfaces what it represents.
      const cols = DEFAULT_GOL_CONFIG.cols;
      const rows = DEFAULT_GOL_CONFIG.rows;
      const targetTile =
        eventFilter === 'death' || eventFilter === 'birth'
          ? (() => {
              const col = Math.floor((x / Math.max(1, size.w)) * cols);
              const row = Math.floor((y / Math.max(1, size.h)) * rows);
              if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
              for (const c of snapshot.cells) {
                if (eventFilter === 'death' && c.alive) continue;
                if (eventFilter === 'birth' && (!c.alive || (c.generation ?? 0) === 0)) continue;
                const p = positions.get(c.agentId);
                if (!p) continue;
                const tile = cellToTile(p, size.w, size.h, cols, rows);
                if (tile.col === col && tile.row === row) {
                  return {
                    col, row,
                    kind: eventFilter === 'death' ? ('death' as const) : ('birth' as const),
                    nearest: c,
                  };
                }
              }
              return null;
            })()
          : (() => {
              const golHit = hitTestGol(golStateRef.current, x, y, size.w, size.h);
              if (!golHit) return null;
              // Attribute the live tile to the closest colonist whose
              // seed could have produced it. Captures both the "mood-
              // pattern at position" (ALL) and "filter pattern" cases.
              let nearest: CellSnapshot | null = null;
              let bestDist = Infinity;
              for (const c of snapshot.cells) {
                if (!c.alive) continue;
                const p = positions.get(c.agentId);
                if (!p) continue;
                const tile = cellToTile(p, size.w, size.h, cols, rows);
                const d = (tile.col - golHit.col) ** 2 + (tile.row - golHit.row) ** 2;
                if (d < bestDist) { bestDist = d; nearest = c; }
              }
              return { col: golHit.col, row: golHit.row, kind: 'life' as const, nearest };
            })();
      if (targetTile) {
        setHoveredTile({ x, y, ...targetTile });
      } else if (hoveredTile) {
        setHoveredTile(null);
      }
    },
    [snapshot, positions, hovered, onHoverChange, eventFilter, size.w, size.h, hoveredTile],
  );
  const onMouseLeave = useCallback(() => {
    setHovered(null);
    setHoveredTile(null);
    setCursor(null);
    onHoverChange?.(null);
  }, [onHoverChange]);
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!snapshot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTestGlyph(snapshot.cells, positions, x, y);
      if (hit) {
        setPopover({ cell: hit, x, y });
        setHovered(null);
        setHoveredTile(null);
        relationshipFlareRef.current = { id: hit.agentId, intensity: 1 };
        return;
      }
      // Tile-layer click: open the drilldown for the colonist the
      // hovered tile is attributed to (live CA cell → nearest seeder;
      // birth / death marker → the colonist the marker represents).
      // Gives users a way to "drill into" a tile without needing a
      // nearby glyph under the cursor.
      if (hoveredTile?.nearest) {
        setPopover({ cell: hoveredTile.nearest, x, y });
        setHovered(null);
        setHoveredTile(null);
      }
    },
    [snapshot, positions, hoveredTile],
  );

  // Touch: first tap on a glyph shows the hover tooltip, second tap on
  // the same glyph opens the popover. Matches the desktop hover-then-
  // click intent without requiring the user to emulate a hover. Tap
  // outside any glyph clears the tooltip and the pending-double-tap.
  const lastTouchIdRef = useRef<string | null>(null);
  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (!snapshot) return;
      const touch = e.touches[0];
      if (!touch) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      const hit = hitTestGlyph(snapshot.cells, positions, x, y);
      if (!hit) {
        setHovered(null);
        setCursor(null);
        lastTouchIdRef.current = null;
        onHoverChange?.(null);
        return;
      }
      if (lastTouchIdRef.current === hit.agentId) {
        setPopover({ cell: hit, x, y });
        setHovered(null);
        lastTouchIdRef.current = null;
        relationshipFlareRef.current = { id: hit.agentId, intensity: 1 };
      } else {
        setHovered({ cell: hit, x, y });
        setCursor({ x, y });
        lastTouchIdRef.current = hit.agentId;
        onHoverChange?.(hit.agentId);
      }
    },
    [snapshot, positions, onHoverChange],
  );

  // Close popover when the selected colonist vanishes (death during
  // scrub/live update). Keeps the UI from showing stale drilldowns.
  useEffect(() => {
    if (!popover || !snapshot) return;
    const stillAlive = snapshot.cells.find(c => c.agentId === popover.cell.agentId);
    if (!stillAlive) setPopover(null);
  }, [popover, snapshot]);

  // Reset the tap-sequence whenever the popover closes so the next
  // touch starts fresh rather than resuming mid-sequence.
  useEffect(() => {
    if (!popover) lastTouchIdRef.current = null;
  }, [popover]);

  // Compute morale + chronicle-hover-driven border/glow once per render
  // so the canvas's hot path doesn't reflow on every animation frame.
  const tintColor = resolveCssColor(mode === 'mood' ? moodTintedSideColor : sideColor, containerRef.current);
  const chronicleKindBorder: Record<string, string> = {
    birth: 'rgba(154, 205, 96, 0.95)',
    death: 'rgba(200, 95, 80, 0.95)',
    forge: 'rgba(232, 180, 74, 0.95)',
    crisis: 'rgba(196, 74, 30, 0.95)',
  };
  const chronicleKindGlow: Record<string, string> = {
    birth: 'rgba(154, 205, 96, 0.55)',
    death: 'rgba(200, 95, 80, 0.55)',
    forge: 'rgba(232, 180, 74, 0.55)',
    crisis: 'rgba(196, 74, 30, 0.55)',
  };
  const wrapBorder = chronicleHover && chronicleHover.side === side
    ? chronicleKindBorder[chronicleHover.kind]
    : snapshot
      ? snapshot.morale >= 0.6
        ? 'rgba(106, 173, 72, 0.55)'
        : snapshot.morale >= 0.3
          ? 'rgba(232, 180, 74, 0.55)'
          : 'rgba(196, 74, 30, 0.65)'
      : `${sideColor}33`;
  const wrapGlow = chronicleHover && chronicleHover.side === side
    ? `0 0 24px ${chronicleKindGlow[chronicleHover.kind]}`
    : snapshot
      ? snapshot.morale >= 0.6
        ? '0 0 16px rgba(106, 173, 72, 0.18)'
        : snapshot.morale >= 0.3
          ? '0 0 16px rgba(232, 180, 74, 0.12)'
          : '0 0 20px rgba(196, 74, 30, 0.25)'
      : 'none';

  return (
    <div
      ref={containerRef}
      data-testid={`living-colony-grid-${side}`}
      role="region"
      aria-label={`${actorName} ${scenarioLabels.place} viz`}
      className={[styles.region, narrow ? styles.narrow : ''].filter(Boolean).join(' ')}
    >
      {snapshot && <GridMetricsStrip snapshot={snapshot} sideColor={sideColor} />}
      <div
        ref={canvasWrapRef}
        className={styles.canvasWrap}
        style={{
          '--tint-color': tintColor,
          '--wrap-border': wrapBorder,
          '--wrap-glow': wrapGlow,
        } as CSSProperties}
      >
        <canvas
          ref={overlayCanvasRef}
          role="img"
          aria-label={
            snapshot
              ? `${actorName} ${scenarioLabels.place}, turn ${snapshot.turn}. ${snapshot.cells.filter(c => c.alive).length} alive, morale ${Math.round(snapshot.morale * 100)}%, food reserve ${snapshot.foodReserve.toFixed(1)} months. ${snapshot.births} births, ${snapshot.deaths} deaths this turn. Click a ${scenarioLabels.person} glyph for drilldown.`
              : `${actorName} ${scenarioLabels.place} — waiting for first turn.`
          }
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
          onTouchStart={onTouchStart}
          className={styles.canvas}
          style={{ '--canvas-cursor': hovered ? 'pointer' : 'default' } as CSSProperties}
        />
        {/* Staged fade-in cover. Starts opaque on mount, transitions
            to transparent so the canvas emerges over 400ms with a
            slight radial reveal. */}
        <div
          aria-hidden="true"
          className={styles.revealCover}
          style={{ '--reveal-opacity': revealed ? '0' : '1' } as CSSProperties}
        />
        <button
          type="button"
          onClick={() => setRosterOpen(v => !v)}
          aria-label={rosterOpen ? 'Close roster' : 'Open roster'}
          title={rosterOpen ? 'Close roster' : 'Open roster'}
          className={styles.cornerBtn}
          style={{
            '--right-offset': onToggleFocus ? '36px' : '8px',
            '--btn-color': rosterOpen ? 'var(--amber)' : 'var(--text-3)',
            '--btn-border': rosterOpen ? 'var(--amber)' : 'var(--border)',
          } as CSSProperties}
        >
          {'\u2630'}
        </button>
        {onToggleFocus && (
          <button
            type="button"
            onClick={() => onToggleFocus(side)}
            aria-label={isFocused ? 'Restore split view' : 'Focus this panel'}
            title={isFocused ? 'Restore split view' : 'Focus this panel'}
            className={`${styles.cornerBtn} ${styles.focusBtn}`}
            style={{
              '--btn-color': isFocused ? 'var(--amber)' : 'var(--text-3)',
              '--btn-border': isFocused ? 'var(--amber)' : 'var(--border)',
            } as CSSProperties}
          >
            {isFocused ? '\u2921' : '\u2922'}
          </button>
        )}
        <FeaturedSpotlight
          snapshot={snapshot}
          previousSnapshot={previousSnapshot}
          sideColor={resolveCssColor(sideColor, containerRef.current)}
          onSelect={c => {
            const pos = positions.get(c.agentId);
            if (pos) setPopover({ cell: c, x: pos.x, y: pos.y });
          }}
        />
        <RosterDrawer
          open={rosterOpen}
          cells={snapshot?.cells ?? []}
          actorName={actorName}
          sideColor={resolveCssColor(sideColor, containerRef.current)}
          searchQuery={searchQuery}
          hoveredId={hovered?.cell.agentId ?? siblingHoveredId ?? null}
          onHover={id => {
            if (id) {
              const c = snapshot?.cells.find(x => x.agentId === id);
              const pos = c ? positions.get(id) : null;
              if (c && pos) {
                setHovered({ cell: c, x: pos.x, y: pos.y });
                onHoverChange?.(id);
                return;
              }
            }
            setHovered(null);
            onHoverChange?.(null);
          }}
          onSelect={c => {
            const pos = positions.get(c.agentId);
            if (pos) setPopover({ cell: c, x: pos.x, y: pos.y });
          }}
          onClose={() => setRosterOpen(false)}
        />
        {mode === 'divergence' && snapshot && (divergedIds?.size ?? 0) === 0 && (
          <div className={styles.divergenceEmpty}>
            <div className={styles.divergenceEmptyMsg}>
              Both timelines identical this turn — no divergence yet
            </div>
          </div>
        )}
        {hoveredTile && !hovered && !popover && (() => {
          const ttW = 220;
          const margin = 8;
          const left = Math.min(
            Math.max(margin, hoveredTile.x + 12),
            Math.max(margin, size.w - ttW - margin),
          );
          const top = Math.max(margin, hoveredTile.y - 84);
          const kindLabel =
            hoveredTile.kind === 'birth' ? '+ BIRTH MARKER'
            : hoveredTile.kind === 'death' ? '× DEATH MARKER'
            : '◼ CONWAY CELL';
          const kindColor =
            hoveredTile.kind === 'birth' ? 'rgba(154, 205, 96, 0.95)'
            : hoveredTile.kind === 'death' ? 'rgba(168, 152, 120, 0.95)'
            : sideColor;
          return (
            <div
              className={styles.tileTooltip}
              style={{
                '--tt-left': `${left}px`,
                '--tt-top': `${top}px`,
                '--kind-color': kindColor,
              } as CSSProperties}
            >
              <div className={styles.tileKindLabel}>{kindLabel}</div>
              <div className={styles.tileCoords}>
                tile ({hoveredTile.col}, {hoveredTile.row})
              </div>
              {hoveredTile.nearest ? (
                <>
                  <div className={styles.tileNearestName}>{hoveredTile.nearest.name}</div>
                  <div className={styles.tileNearestRole}>
                    {hoveredTile.nearest.role} · {hoveredTile.nearest.department.toUpperCase()}
                  </div>
                  {hoveredTile.kind === 'death' ? (
                    <div className={styles.tileNearestDeath}>
                      deceased · mood at death: {hoveredTile.nearest.mood}
                    </div>
                  ) : hoveredTile.kind === 'birth' ? (
                    <div className={styles.tileNearestBirth}>
                      native-born · generation {hoveredTile.nearest.generation ?? 0}
                    </div>
                  ) : (
                    <div className={styles.tileNearestPattern}>
                      pattern seeded by nearest colonist's mood: {hoveredTile.nearest.mood}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.tileAmbient}>ambient CA cell</div>
              )}
              {/* Per-cell GoL state — distinguishes physically distinct
                  cells that share the same nearest-colonist attribution.
                  Without this, hovering different live cells in the
                  same Conway pattern shows identical colonist data and
                  the tooltip looks duplicated. */}
              {hoveredTile.kind === 'life' && (() => {
                const gol = golStateRef.current;
                const cols = gol.cols;
                const rows = gol.rows;
                const age = gol.grid[hoveredTile.row * cols + hoveredTile.col] ?? 0;
                let neighbors = 0;
                for (let dr = -1; dr <= 1; dr++) {
                  for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const r = hoveredTile.row + dr;
                    const c = hoveredTile.col + dc;
                    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
                    if (gol.grid[r * cols + c] >= 1) neighbors++;
                  }
                }
                return (
                  <div className={styles.tileNearestPattern}>
                    age {age} · {neighbors} neighbors alive
                  </div>
                );
              })()}
            </div>
          );
        })()}
        {hovered && !popover && (() => {
          const ttW = 200;
          const ttH = 80;
          const margin = 8;
          const left = Math.min(
            Math.max(margin, hovered.x + 12),
            Math.max(margin, size.w - ttW - margin),
          );
          const top = Math.min(
            Math.max(margin, hovered.y - ttH - 8),
            Math.max(margin, size.h - ttH - margin),
          );
          return (
          <div
            className={styles.hoverTooltip}
            style={{
              '--tt-left': `${left}px`,
              '--tt-top': `${top}px`,
              '--side-color': sideColor,
            } as CSSProperties}
          >
            <div className={styles.hoverHeader}>
              {hovered.cell.name}
              {hovered.cell.featured && (
                <span className={styles.hoverFeaturedPill}>FEATURED</span>
              )}
            </div>
            <div className={styles.hoverRole}>
              {hovered.cell.department.toUpperCase()} · {hovered.cell.role}
              {typeof hovered.cell.age === 'number' ? ` · age ${hovered.cell.age}` : ''}
            </div>
            <div className={styles.hoverMood}>
              mood: <span className={styles.hoverMoodValue}>{hovered.cell.mood}</span>
              {typeof hovered.cell.psychScore === 'number'
                ? ` · psych ${Math.round(hovered.cell.psychScore * 100)}%`
                : ''}
            </div>
            {snapshotHistory && snapshotHistory.length >= 2 && (() => {
              const sW = 140;
              const sH = 20;
              const pad = 2;
              const trail: number[] = [];
              for (const s of snapshotHistory) {
                const match = s.cells.find(c => c.agentId === hovered.cell.agentId);
                if (match && typeof match.psychScore === 'number') {
                  trail.push(Math.max(0, Math.min(1, match.psychScore)));
                }
              }
              if (trail.length < 2) return null;
              const stepX = (sW - pad * 2) / Math.max(1, trail.length - 1);
              const path = trail
                .map((v, i) => {
                  const x = pad + i * stepX;
                  const y = pad + (1 - v) * (sH - pad * 2);
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <div className={styles.psychBlock}>
                  <div className={styles.psychLabel}>PSYCH TRAJECTORY</div>
                  <svg
                    viewBox={`0 0 ${sW} ${sH}`}
                    preserveAspectRatio="none"
                    width={sW}
                    height={sH}
                    role="img"
                    aria-label={`Psychological trajectory across ${trail.length} turns`}
                    className={styles.psychSvg}
                  >
                    <line
                      x1={pad}
                      x2={sW - pad}
                      y1={pad + (sH - pad * 2) / 2}
                      y2={pad + (sH - pad * 2) / 2}
                      stroke="var(--border)"
                      strokeWidth={0.4}
                      strokeDasharray="2 2"
                    />
                    <path d={path} fill="none" stroke={sideColor} strokeWidth={1} />
                    <circle
                      cx={pad + (trail.length - 1) * stepX}
                      cy={pad + (1 - trail[trail.length - 1]) * (sH - pad * 2)}
                      r={1.6}
                      fill={sideColor}
                    />
                  </svg>
                </div>
              );
            })()}
            <div className={styles.hoverHint}>
              click for drilldown
            </div>
          </div>
          );
        })()}
        <ClickPopover
          payload={popover}
          containerW={size.w}
          containerH={size.h}
          sideColor={resolveCssColor(sideColor, containerRef.current)}
          hexacoById={hexacoById}
          snapshots={snapshotHistory}
          onClose={() => setPopover(null)}
          onOpenChat={onOpenChat}
        />
      </div>
    </div>
  );
}
