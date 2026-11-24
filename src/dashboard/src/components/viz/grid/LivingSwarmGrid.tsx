import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
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
import { isJumpReveal, golRevealAlpha, GOL_REVEAL_MS } from './golReveal.js';
import { hitTestGlyph } from './hitTest.js';
import type { GridMode } from './GridModePills.js';
import { ClickPopover, type ClickPopoverPayload } from './ClickPopover.js';
import { useMediaQuery, NARROW_QUERY, REDUCED_MOTION_QUERY } from './useMediaQuery.js';
import { DEFAULT_GRID_SETTINGS, type GridSettings } from './GridSettingsDrawer.js';
import { RosterDrawer } from './RosterDrawer.js';
import { FeaturedSpotlight } from './FeaturedSpotlight.js';
import { useScenarioLabels } from '../../../hooks/useScenarioLabels.js';
import { nearestPointOnLabel, placeNameLabels, type NameLabelPlace } from './nameLabelLayout.js';

interface HexacoShape { O: number; C: number; E: number; A: number; Em: number; HH: number }

interface LivingSwarmGridProps {
  /** Use the Viz panel's layout and keep its floating notices outside the field. */
  vizPanel?: boolean;
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
  /** User-tunable viz settings (dept labels, crosshair). */
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
  /**
   * Drawn in place of the leader strip above the canvas. The strip is what
   * names the panel's leader, so with a header the canvas's own corner
   * readout of the leader (name, archetype, turn and population) is left out
   * too, and `actorName` is the panel's whole spoken name: the canvas, an
   * image, is named by it alone, and the panel is no named region of its
   * own. Omitted, the strip and the readout draw as they do on the Viz tab.
   */
  header?: ReactNode;
  /**
   * `'featured'` sets the people's names as text over the field in place of
   * the names the canvas paints: each featured person's name stands by its
   * ring at 15 px in the ink, no two overlapping, and every other person's
   * name shows on focus, on hover or on a press. Each name is a key that
   * opens the person's popover, and the arrow keys move between them, so the
   * panel is one stop. The spotlight pills, the roster key and the hover
   * cards, which name the same people at the Viz tab's sizes, are left out.
   * Omitted, the canvas paints the names as it does on the Viz tab.
   */
  nameLabels?: 'featured';
  /**
   * True for a panel at rest, before a run: the Game of Life layer is seeded
   * once from the people's places and moods and no later generation is
   * drawn, no frame loop runs, and nothing fades in under reduced motion.
   * The cells draw at the side colour's full strength on a flat field edged
   * in the control edge, with none of a run's morale border and glow, and
   * the canvas takes the height its holder sets in `--grid-field-height`.
   * Omitted, the panel plays as it does on the Viz tab.
   */
  resting?: boolean;
}

/** The live tile strength of a playing panel, by look; see the note where the tiles draw. */
const PLAYING_TILE_STRENGTH = { light: 0.22, dark: 0.65 } as const;
/** A resting panel's cells draw at the side colour itself: drawGol scales a fresh cell by 0.9. */
const RESTING_TILE_STRENGTH = 1 / 0.9;
/** How far a name may stand from its ring before a line joins the two. */
const NAME_LINE_FROM = 18;

/**
 * The readings ECOLOGY tints its quadrants by, as the canvas's accessible
 * name gives them: food, water, power and pressurized volume, each only when
 * the snapshot carries it.
 */
function ecologyReadings(snapshot: TurnSnapshot): string {
  const parts: string[] = [];
  if (typeof snapshot.foodReserve === 'number') parts.push(`food reserve ${snapshot.foodReserve.toFixed(1)} months`);
  if (typeof snapshot.waterLitersPerDay === 'number') parts.push(`water ${Math.round(snapshot.waterLitersPerDay)} litres a day`);
  if (typeof snapshot.powerKw === 'number') parts.push(`power ${Math.round(snapshot.powerKw)} kW`);
  if (typeof snapshot.pressurizedVolumeM3 === 'number') parts.push(`pressurized volume ${Math.round(snapshot.pressurizedVolumeM3)} cubic metres`);
  return parts.map(p => `, ${p}`).join('');
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
    vizPanel = false,
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
    header,
    nameLabels,
    resting = false,
  } = props;
  const isFocused = focusedSide === side;
  const hasHeader = header !== undefined;
  const domNames = nameLabels === 'featured';

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
  const [revealed, setRevealed] = useState(reducedMotion);
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
  // The commander the grid was last seeded for. A cohort run's pair view
  // changes a panel's commander on the same turn, mode and filter.
  const lastGolActorRef = useRef<string | null>(null);
  // The canvas size a resting panel was last seeded at. The people's places
  // follow the canvas's size, and a resting panel draws the seed itself, so
  // it seeds again when its size changes.
  const lastGolSizeRef = useRef<string>('');
  // The tile each living colonist seeded the Conway layer from. A Viz panel
  // keeps its tiles through a resize while the people's places follow the
  // new size, so a hovered tile is credited to the seed that drew it.
  const golSeedTilesRef = useRef<Map<string, { col: number; row: number }>>(new Map());
  const lastFlareSignatureRef = useRef<string | null>(null);
  // Timestamp (performance.now) when the GoL tile fade started, or
  // -Infinity when no fade is active. Set on the first seed, on a jump of
  // more than one turn (a cached load, a replay, a scrub) and when the
  // panel's commander changes, so the tile layer eases in instead of
  // painting its whole steady state in one frame. See golReveal.ts.
  const golRevealStartRef = useRef<number>(Number.NEGATIVE_INFINITY);
  const revealPaintTimes = useRef<number[]>([]);

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
  //
  // A panel with no box measures 0 by 0: the other actor's panel on a
  // phone, or the side a full-screen focus hides. The size stays 0 then,
  // so nothing is seeded or drawn until the panel is shown again. A floor
  // of 1 let a turn change seed the Conway grid from positions clamped
  // outside a 1 by 1 canvas and mark the turn seeded, and the panel came
  // back with no tiles.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(0, Math.round(e.contentRect.width));
        const h = Math.max(0, Math.round(e.contentRect.height));
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
      still: resting,
      paintTimes: vizPanel ? revealPaintTimes : undefined,
    },
    canvasWrapRef,
    () => positions,
    () => deptCentersOverlay,
  );

  // A resting panel has no frame loop to pick up a change of look, so it
  // repaints when the page's look changes: the canvas reads its colours from
  // the look's tokens each time it draws.
  const [lookTick, setLookTick] = useState(0);
  useEffect(() => {
    if (!resting || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setLookTick(tick => tick + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [resting]);

  // The people's names as text over the field (`nameLabels`): each name's
  // own size is read from the page once it is laid out, again when the
  // served faces load, and again whenever a name's box changes size (a
  // larger text setting), and the names are then placed so no two overlap.
  const peopleRef = useRef<HTMLDivElement | null>(null);
  const [nameSizes, setNameSizes] = useState<Map<string, { w: number; h: number }>>(() => new Map());
  const [rovingId, setRovingId] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!domNames) return;
    const layer = peopleRef.current;
    if (!layer) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const next = new Map<string, { w: number; h: number }>();
      // A name's whole width, whatever box it stands in now (scrollWidth is
      // a whole number, so one more pixel covers its rounding), and no wider
      // than the field less its margins.
      const widest = Math.max(0, layer.clientWidth - 4);
      layer.querySelectorAll<HTMLElement>('[data-person]').forEach(el => {
        const id = el.dataset.person;
        if (id) next.set(id, { w: Math.min(el.scrollWidth + 1, widest), h: el.offsetHeight });
      });
      setNameSizes(prev => {
        if (prev.size === next.size && [...next].every(([id, s]) => prev.get(id)?.w === s.w && prev.get(id)?.h === s.h)) return prev;
        return next;
      });
    };
    measure();
    void document.fonts?.ready.then(measure);
    // A name's box does not depend on where it stands, so reading it again
    // when it changes size cannot start a loop.
    const boxes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    layer.querySelectorAll<HTMLElement>('[data-person]').forEach(el => boxes?.observe(el));
    return () => {
      cancelled = true;
      boxes?.disconnect();
    };
  }, [domNames, snapshot, size.w, size.h]);

  const namePlaces = useMemo(() => {
    const none = new Map<string, NameLabelPlace>();
    if (!domNames || !snapshot || size.w === 0 || size.h === 0) return none;
    const alive = snapshot.cells.filter(c => c.alive && positions.has(c.agentId));
    const rings = alive.map(c => {
      const pos = positions.get(c.agentId)!;
      return { x: pos.x, y: pos.y, r: c.featured ? 12 : 6 };
    });
    const items = alive
      .filter(c => c.featured && nameSizes.has(c.agentId))
      .map(c => {
        const pos = positions.get(c.agentId)!;
        const s = nameSizes.get(c.agentId)!;
        return { id: c.agentId, x: pos.x, y: pos.y, w: s.w, h: s.h };
      });
    return placeNameLabels(items, { w: size.w, h: size.h }, rings);
  }, [domNames, snapshot, positions, nameSizes, size.w, size.h]);

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
    // Nothing is drawn or seeded before the canvas has a size: positions are
    // empty until then, and a Conway seed taken from them would mark the turn
    // seeded with an empty grid that a replay parked on its last turn never
    // reseeds.
    if (!overlay || !snapshot || size.w === 0 || size.h === 0) return;
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
    const textSize = vizPanel ? parseFloat(cs?.getPropertyValue('--viz-read-size') || '15') : undefined;
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
    // Theme-aware tombstone + ecology-label colors. The dead-marker
    // tombstone reads as text-3 (warm muted in dark, dark brown in
    // light); the ecology quadrant captions reuse text-2 at 60% so
    // they read crisply on whichever theme is active. Both layers
    // accept these as opts (defaults are the dark-mode tones for
    // backwards compatibility).
    const tombstoneStroke =
      (cs && hexToRgba(cs.getPropertyValue('--text-3').trim(), 0.85)) ||
      'rgba(168, 152, 120, 0.85)';
    const tombstoneFill =
      (cs && hexToRgba(cs.getPropertyValue('--text-3').trim(), 0.08)) ||
      'rgba(168, 152, 120, 0.08)';
    const ecologyLabelColor =
      (cs && hexToRgba(cs.getPropertyValue('--text-2').trim(), 0.6)) ||
      'rgba(216, 204, 176, 0.6)';
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
    const actorChanged = actorName !== lastGolActorRef.current;
    const sizeKey = `${size.w}x${size.h}`;
    const fieldResized = resting && sizeKey !== lastGolSizeRef.current;
    const prevGolTurn = lastGolTurnRef.current;
    if (turnChanged || modeChanged || filterChanged || actorChanged || fieldResized) {
      lastGolSizeRef.current = sizeKey;
      lastGolTurnRef.current = snapshot.turn;
      lastGolModeRef.current = mode;
      lastGolFilterRef.current = eventFilter;
      lastGolActorRef.current = actorName;
      seedFromColonists(gol, snapshot.cells, positions, size.w, size.h, eventFilter);
      const seedTiles = new Map<string, { col: number; row: number }>();
      for (const c of snapshot.cells) {
        const p = positions.get(c.agentId);
        if (c.alive && p) seedTiles.set(c.agentId, cellToTile(p, size.w, size.h, gol.cols, gol.rows));
      }
      golSeedTilesRef.current = seedTiles;
      // Mode determines warmup depth so clicking a mode pill produces
      // a visibly different CA state: LIVING = stabilized (5 ticks),
      // MOOD = fresh seed (0 ticks, patterns sit unstabilized), FORGE
      // = over-evolved (8 ticks, gliders escape), ECOLOGY = minimal
      // (2 ticks), DIVERGENCE = extreme (12 ticks, chaos).
      let warmup: number;
      if (resting) {
        // At rest the seed itself is drawn: each person's own pattern at its
        // place, and no generation after it.
        warmup = 0;
      } else if (reducedMotion) {
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
      // Keep the colonists' seeded pattern if all of its tiles would die
      // before the first frame. A turn with no seeds still draws no tiles.
      const seeded = vizPanel && warmup > 0 ? gol.grid.slice() : undefined;
      for (let i = 0; i < warmup; i += 1) tickGol(gol);
      if (seeded && !gol.grid.some(Boolean)) gol.grid.set(seeded);
      // First seed, cached load, replay, multi-turn scrub or a new commander
      // on this panel: ease the tile layer in instead of painting the full
      // steady state in one frame. Single-turn advances (a live run,
      // playback) reseed in place.
      if (!reducedMotion && !resting && ((turnChanged && isJumpReveal(prevGolTurn, snapshot.turn)) || actorChanged)) {
        const began = performance.now();
        golRevealStartRef.current = began;
        // A scrub can start with the grid offscreen. Let that canvas paint
        // during the fade and settle at full strength for capture.
        if (vizPanel) revealPaintTimes.current = [began + GOL_REVEAL_MS / 6, began + GOL_REVEAL_MS];
      }
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
    // Conway tiles paint with the actor's sideColor at variable alpha.
    // In dark mode 0.65 is the right intensity for the chunky tiles to
    // read as the primary visual texture. In light mode the sideColor
    // tokens are deliberately darker (amber #6b4700 vs dark-mode
    // #e8b44a) to clear WCAG contrast on cream, so 0.65 painted across
    // every alive tile in every cohort panel cumulatively reads as a
    // heavy dark wash — that's the "dark gradient" complaint on viz
    // cached-run loads, where every panel paints the steady-state
    // tile pattern in one frame instead of streaming in. Drop the
    // light-mode intensity to 0.22 so tiles still register but don't
    // dominate.
    const isLightTheme = typeof document !== 'undefined'
      && document.documentElement.classList.contains('light');
    // The tile layer draws on every run, live, finished or replayed. On a
    // jump it eases in over GOL_REVEAL_MS (see golRevealStartRef above).
    const golAlpha = resting
      ? RESTING_TILE_STRENGTH
      : golRevealAlpha(
          isLightTheme ? PLAYING_TILE_STRENGTH.light : PLAYING_TILE_STRENGTH.dark,
          performance.now() - golRevealStartRef.current,
          GOL_REVEAL_MS,
          reducedMotion,
        );
    drawGol(ctx, gol, size.w, size.h, resolvedSide, golAlpha);
    if (resting) {
      // A resting panel's cells are the colour of its rings, so each ring
      // gets a clear disc of the field under it and never stands on a cell.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      for (const c of snapshot.cells) {
        if (!c.alive) continue;
        const pos = positions.get(c.agentId);
        if (!pos) continue;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, c.featured ? 14 : 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
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
        tombstoneStroke,
        tombstoneFill,
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
        // Always-on labels for featured + diverged, unless the names are
        // set as text over the field.
        !domNames,
        textMuted,
        // labelChipBg — theme-aware bg-deep at 55% opacity. Was
        // hardcoded near-black in GlyphLayer which stamped dark
        // splotches across light-mode cohort canvases on cached-run
        // loads (100+ colonist labels per panel × 6 panels).
        labelBg,
        textSize,
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
        textSize,
      );
    }
    if (mode === 'ecology') {
      drawEcologyResourceMap(ctx, snapshot, size.w, size.h, ecologyLabelColor, textSize);
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
    // The corner readout names the panel's leader; a header given in the
    // strip's place says what the panel is, so the readout is left out.
    if (!hasHeader)
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
        textSize,
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
        ctx.font = `bold ${textSize ?? 11}px ui-monospace, monospace`;
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
    resting,
    hasHeader,
    vizPanel,
    domNames,
    lookTick,
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
                const tile = golSeedTilesRef.current.get(c.agentId) ?? cellToTile(p, size.w, size.h, cols, rows);
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

  // The people as keys over the field (`nameLabels`): one stop, the arrow
  // keys moving between them in the order the snapshot lists them.
  const people = useMemo(
    () => (domNames && snapshot ? snapshot.cells.filter(c => c.alive && positions.has(c.agentId)) : []),
    [domNames, snapshot, positions],
  );
  const rovingPerson = people.find(c => c.agentId === rovingId)?.agentId ?? people[0]?.agentId ?? null;
  const onPeopleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const layer = peopleRef.current;
    if (!layer) return;
    const keys = Array.from(layer.querySelectorAll<HTMLButtonElement>('[data-person]'));
    const at = keys.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || keys.length === 0) return;
    const last = keys.length - 1;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at === last ? 0 : at + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at === 0 ? last : at - 1)
        : e.key === 'Home' ? 0
          : e.key === 'End' ? last
            : -1;
    if (to < 0) return;
    e.preventDefault();
    keys[to]?.focus();
  }, []);
  /** Where a name that is not standing shows when its person is focused, hovered or pressed: under its ring, inside the field. */
  const quietPlace = (pos: { x: number; y: number }, s: { w: number; h: number } | undefined): NameLabelPlace => {
    // Not measured yet: at the field's corner, unseen, where its whole width shows.
    if (!s) return { left: 0, top: 0 };
    const { w, h } = s;
    return {
      left: Math.max(2, Math.min(pos.x - w / 2, size.w - w - 2)),
      top: pos.y + 14 + h > size.h - 2 ? Math.max(2, pos.y - 14 - h) : pos.y + 14,
    };
  };

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

  const spotlight = !domNames && (
    <FeaturedSpotlight
      snapshot={snapshot}
      previousSnapshot={previousSnapshot}
      sideColor={resolveCssColor(sideColor, containerRef.current)}
      inFlow={vizPanel}
      onSelect={cell => {
        const pos = positions.get(cell.agentId);
        if (pos) setPopover({ cell, x: pos.x, y: pos.y });
      }}
    />
  );

  return (
    <div
      ref={containerRef}
      // A resting panel is no leader's side: the Run tab keeps one mounted
      // while another tab shows the leaders' own panels.
      data-testid={`living-colony-grid-${resting ? 'rest' : side}`}
      role={hasHeader ? undefined : 'region'}
      aria-label={hasHeader ? undefined : `${actorName} ${scenarioLabels.place} viz`}
      className={[styles.region, narrow ? styles.narrow : '', vizPanel ? styles.vizPanel : '', resting ? styles.resting : ''].filter(Boolean).join(' ')}
    >
      {hasHeader ? header : snapshot && <GridMetricsStrip snapshot={snapshot} sideColor={sideColor} />}
      <div
        ref={canvasWrapRef}
        data-testid={`living-colony-field-${resting ? 'rest' : side}`}
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
            hasHeader
              ? actorName
              : snapshot
                ? `${actorName} ${scenarioLabels.place}, turn ${snapshot.turn}. ${snapshot.cells.filter(c => c.alive).length} alive, morale ${Math.round(snapshot.morale * 100)}%${ecologyReadings(snapshot)}. ${snapshot.births} births, ${snapshot.deaths} deaths this turn. Click a ${scenarioLabels.person} glyph for drilldown.`
                : `${actorName} ${scenarioLabels.place} — waiting for first turn.`
          }
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
          onTouchStart={onTouchStart}
          className={styles.canvas}
          style={{ '--canvas-cursor': hovered ? 'pointer' : 'default' } as CSSProperties}
        />
        {!vizPanel && (
          <div
            aria-hidden="true"
            className={styles.revealCover}
            style={{ '--reveal-opacity': revealed ? '0' : '1' } as CSSProperties}
          />
        )}
        {domNames && snapshot && (
          <div ref={peopleRef} className={styles.people} onKeyDown={onPeopleKeyDown}>
            <svg className={styles.nameLines} width={size.w} height={size.h} aria-hidden="true" focusable="false">
              {people.map(cell => {
                const pos = positions.get(cell.agentId);
                const place = namePlaces.get(cell.agentId);
                const s = nameSizes.get(cell.agentId);
                if (!pos || !place || !s) return null;
                const to = nearestPointOnLabel(place, s, pos);
                if (to.distance < NAME_LINE_FROM) return null;
                // From the ring's edge, not its middle.
                const from = 13 / to.distance;
                return (
                  <line
                    key={cell.agentId}
                    x1={pos.x + (to.x - pos.x) * from}
                    y1={pos.y + (to.y - pos.y) * from}
                    x2={to.x}
                    y2={to.y}
                  />
                );
              })}
            </svg>
            {people.map(cell => {
              const pos = positions.get(cell.agentId);
              if (!pos) return null;
              const standing = namePlaces.get(cell.agentId);
              const measured = nameSizes.get(cell.agentId);
              const at = standing ?? quietPlace(pos, measured);
              const active = hovered?.cell.agentId === cell.agentId || popover?.cell.agentId === cell.agentId;
              return (
                <button
                  key={cell.agentId}
                  type="button"
                  className={styles.person}
                  data-person={cell.agentId}
                  data-featured={cell.featured ? 'true' : 'false'}
                  data-standing={standing ? 'true' : 'false'}
                  data-measured={measured ? 'true' : 'false'}
                  data-active={active ? 'true' : undefined}
                  data-ring-x={pos.x}
                  data-ring-y={pos.y}
                  tabIndex={cell.agentId === rovingPerson ? 0 : -1}
                  translate="no"
                  style={{ '--name-left': `${at.left}px`, '--name-top': `${at.top}px` } as CSSProperties}
                  onClick={() => {
                    setPopover({ cell, x: pos.x, y: pos.y });
                    setHoveredTile(null);
                  }}
                  onFocus={() => {
                    setRovingId(cell.agentId);
                    setHovered({ cell, x: pos.x, y: pos.y });
                  }}
                  onBlur={() => setHovered(prev => (prev?.cell.agentId === cell.agentId ? null : prev))}
                  onMouseEnter={() => setHovered({ cell, x: pos.x, y: pos.y })}
                  onMouseLeave={() => setHovered(prev => (prev?.cell.agentId === cell.agentId ? null : prev))}
                >
                  {cell.name}
                </button>
              );
            })}
          </div>
        )}
        {!domNames && (
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
        )}
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
        {!vizPanel && spotlight}
        {!domNames && <RosterDrawer
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
        />}
        {mode === 'divergence' && snapshot && (divergedIds?.size ?? 0) === 0 && (
          <div className={styles.divergenceEmpty}>
            <div className={styles.divergenceEmptyMsg}>
              Both timelines identical this turn — no divergence yet
            </div>
          </div>
        )}
        {!domNames && hoveredTile && !hovered && !popover && (() => {
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
        {!domNames && hovered && !popover && (() => {
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
          keepHeaderInView={vizPanel}
          containerW={size.w}
          containerH={size.h}
          sideColor={resolveCssColor(sideColor, containerRef.current)}
          hexacoById={hexacoById}
          snapshots={snapshotHistory}
          onClose={() => setPopover(null)}
          onOpenChat={onOpenChat}
        />
      </div>
      {vizPanel && !domNames && <div className={styles.spotlightSlot}>{spotlight}</div>}
    </div>
  );
}
