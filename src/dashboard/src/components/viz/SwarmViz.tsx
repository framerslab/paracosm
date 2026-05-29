import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameState, LeaderInfo } from '../../hooks/useGameState.js';
import styles from './SwarmViz.module.scss';
import { useScenarioContext, useDashboardNavigation } from '../../App';
import { useToast } from '../shared/Toast';
import { useVizSnapshots } from './useVizSnapshots.js';
import { CohortSwarmGrid } from './CohortSwarmGrid.js';
import { TurnBanner } from './TurnBanner.js';
import { VizControls } from './VizControls.js';
import { LivingSwarmGrid } from './grid/LivingSwarmGrid.js';
import { GridModePills, gridModeHint, type GridMode } from './grid/GridModePills.js';
import { GridHelpOverlay } from './grid/GridHelpOverlay.js';
import { useMediaQuery, NARROW_QUERY, PHONE_QUERY } from './grid/useMediaQuery.js';
import { TimelineSparkline } from './grid/TimelineSparkline.js';
import { EventChronicle, type ChronicleFilter, type ChronicleEvent } from './grid/EventChronicle.js';
import { TurnProgress } from './grid/TurnProgress.js';
import { ColonistSearch, type SearchMatch } from './grid/ColonistSearch.js';
import {
  GridSettingsDrawer,
  DEFAULT_GRID_SETTINGS,
  type GridSettings,
} from './grid/GridSettingsDrawer.js';
import { useSoundCues } from './grid/useSoundCues.js';
import { RunSummaryDrawer } from './grid/RunSummaryDrawer.js';
import { ForgeLineageModal, type ForgeLineagePayload } from './grid/ForgeLineageModal.js';
import { ExportMenu } from './grid/ExportMenu.js';
import { useScenarioLabels } from '../../hooks/useScenarioLabels.js';
import { HighlightStrip } from './HighlightStrip';
import { VizLegendBar } from './VizLegendBar';
import { DivergenceDetail } from './DivergenceDetail';
import { computeTurnHighlight, snapToHighlight } from './viz-highlights';
import { computeCellDiff, type DiffCell } from './viz-diff';
import { DEPARTMENT_COLORS, DEFAULT_DEPT_COLOR } from './viz-types';

/** Tiny keyboard-shortcut chip for the footer legend. Kept local since
 *  it's only used in the viz tab footer. */
/**
 * Aggregate alive cells of a TurnSnapshot into per-department DiffCell
 * entries — one row per department label, with the agent count and the
 * dominant mood across that department's alive members. Returns []
 * when the snapshot is missing (lagging side at the playhead edge).
 */
function aggregateByDept(snap: TurnSnapshot | undefined): DiffCell[] {
  if (!snap) return [];
  const byDept = new Map<string, { count: number; moods: Record<string, number> }>();
  for (const c of snap.cells) {
    if (!c.alive) continue;
    const dept = c.department || 'unknown';
    let entry = byDept.get(dept);
    if (!entry) {
      entry = { count: 0, moods: {} };
      byDept.set(dept, entry);
    }
    entry.count += 1;
    const m = c.mood || 'neutral';
    entry.moods[m] = (entry.moods[m] ?? 0) + 1;
  }
  const out: DiffCell[] = [];
  for (const [dept, agg] of byDept) {
    const dominantMood =
      Object.entries(agg.moods).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
    out.push({ cellKey: dept, department: dept, agentCount: agg.count, dominantMood });
  }
  return out;
}

function Kbd({ k, v }: { k: string; v: string }) {
  return (
    <span className={styles.kbd}>
      <kbd className={styles.kbdKey}>{k}</kbd>
      <span className={styles.kbdLabel}>{v}</span>
    </span>
  );
}
import {
  computeDivergence,
  type CellSnapshot,
  type TurnSnapshot,
} from './viz-types.js';

interface HexacoShape { O: number; C: number; E: number; A: number; Em: number; HH: number }

interface SwarmVizProps {
  state: GameState;
  onNavigateToChat?: (colonistName: string) => void;
}

/**
 * VIZ tab composition root. Owns playhead state, grid mode, palette,
 * chronicle filter, focused-side, and timelapse recording. Delegates
 * everything visual to LivingSwarmGrid (canvas + HUD + popovers) and
 * the strip widgets (TurnBanner, TimelineSparkline, EventChronicle).
 */
export function SwarmViz({ state, onNavigateToChat }: SwarmVizProps) {
  const snapshotMap = useVizSnapshots(state);
  // Cohort-aware focus-pair: SwarmViz's living-swarm grid is built for
  // exactly two side-by-side panels (side='a' + side='b' on each
  // LivingSwarmGrid prop). For cohort runs the user picks which two
  // actors land on those panels via the focus-pair selector below;
  // the rest of the cohort stays accessible by rotating the picker.
  // Default + back-compat for pair runs: actorIds[0]/[1].
  const defaultAId = state.actorIds[0];
  const defaultBId = state.actorIds[1];
  const [pickedAId, setPickedAId] = useState<string | undefined>(defaultAId);
  const [pickedBId, setPickedBId] = useState<string | undefined>(defaultBId);
  useEffect(() => {
    if (pickedAId && !state.actorIds.includes(pickedAId)) setPickedAId(defaultAId);
    if (pickedBId && !state.actorIds.includes(pickedBId)) setPickedBId(defaultBId);
  }, [state.actorIds, pickedAId, pickedBId, defaultAId, defaultBId]);
  const firstLeaderId = pickedAId ?? defaultAId;
  const secondLeaderId = pickedBId ?? defaultBId;
  const snapsA = (firstLeaderId ? snapshotMap[firstLeaderId] : undefined) ?? [];
  const snapsB = (secondLeaderId ? snapshotMap[secondLeaderId] : undefined) ?? [];
  const sideStateA = firstLeaderId ? state.actors[firstLeaderId] : null;
  const sideStateB = secondLeaderId ? state.actors[secondLeaderId] : null;
  const isCohort = state.actorIds.length > 2;
  // View mode: 'pair' renders the existing two-panel A/B layout with
  // the cohort focus-pair picker. 'cohort' replaces that with a
  // horizontally-scrolling CohortSwarmGrid showing every actor's
  // living-swarm panel lazy-mounted side-by-side. Pair runs always
  // stay in 'pair'; cohort runs default to 'cohort' so users land
  // on the all-actor view first and opt into pair drill-in via the
  // toggle.
  const [vizMode, setVizMode] = useState<'pair' | 'cohort'>(isCohort ? 'cohort' : 'pair');
  useEffect(() => {
    setVizMode(isCohort ? 'cohort' : 'pair');
  }, [isCohort]);
  const maxTurn = Math.max(snapsA.length, snapsB.length);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Grid mode (new living-colony grid). Shared across both leaders so
  // tabs toggle in lockstep. Persisted to localStorage so the user's
  // last-picked mode survives a page reload.
  const [gridMode, setGridModeState] = useState<GridMode>(() => {
    try {
      const raw = localStorage.getItem('paracosm:gridMode');
      if (raw === 'living' || raw === 'mood' || raw === 'forge' || raw === 'ecology' || raw === 'divergence') {
        return raw;
      }
    } catch { /* silent */ }
    return 'living';
  });
  const setGridMode = useCallback((m: GridMode) => {
    setGridModeState(m);
    try { localStorage.setItem('paracosm:gridMode', m); } catch { /* silent */ }
  }, []);

  const { toast } = useToast();
  const timerRef = useRef<number>(0);
  const prevMaxTurnRef = useRef(0);

  useEffect(() => {
    const prev = prevMaxTurnRef.current;
    prevMaxTurnRef.current = maxTurn;
    if (maxTurn > prev && !playing) setCurrentTurn(maxTurn - 1);
  }, [maxTurn, playing]);

  useEffect(() => {
    if (!playing) return;
    const interval = 2000 / speed;
    timerRef.current = window.setInterval(() => {
      setCurrentTurn(prev => {
        if (prev >= maxTurn - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, interval);
    return () => clearInterval(timerRef.current);
  }, [playing, speed, maxTurn]);

  const handlePlayPause = useCallback(() => {
    if (maxTurn <= 1) return;
    setPlaying(p => {
      if (!p && currentTurn >= maxTurn - 1) setCurrentTurn(0);
      return !p;
    });
  }, [currentTurn, maxTurn]);

  const handleStepBack = useCallback(() => {
    setPlaying(false);
    setCurrentTurn(t => Math.max(0, t - 1));
  }, []);

  const handleStepForward = useCallback(() => {
    setPlaying(false);
    setCurrentTurn(t => Math.min(maxTurn - 1, t + 1));
  }, [maxTurn]);

  const handleTurnChange = useCallback((turn: number) => {
    setPlaying(false);
    setCurrentTurn(turn);
  }, []);

  // Cross-tab nav: switch to Reports and scroll to the given turn's
  // detail section. Fired by the chronicle strip on shift+click so
  // users can jump from "I saw this event happened" to "show me the
  // full breakdown of that turn" without manually changing tabs.
  const navigateTab = useDashboardNavigation();
  const handleJumpToReports = useCallback((turn: number) => {
    navigateTab('reports');
    // Let the Reports tab render before attempting to scroll — the
    // section element doesn't exist until ReportView mounts.
    requestAnimationFrame(() => {
      const el = document.getElementById(`turn-${turn}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [navigateTab]);

  const [helpOpen, setHelpOpen] = useState(false);
  const scenario = useScenarioContext();
  const scenarioLabels = useScenarioLabels();
  const [hoveredA, setHoveredA] = useState<string | null>(null);
  const [hoveredB, setHoveredB] = useState<string | null>(null);
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null);
  // Event-kind filter shared between EventChronicle (strip above the
  // viz panels) and each LivingSwarmGrid (main canvas). Prior to
  // lifting this to SwarmViz, clicking BIRTHS / DEATHS / FORGES /
  // CRISES only hid entries in the chronicle strip — the canvas
  // flares continued to fire for every event regardless. Controlled
  // pattern keeps a single source of truth for both widgets.
  const [chronicleFilter, setChronicleFilter] = useState<ChronicleFilter>('all');
  // Hovered chronicle event — propagated to LivingSwarmGrid so the
  // matching side's panel flashes the event's category color while
  // the cursor is on the pill. Makes the chronicle row feel connected
  // to the main canvas instead of a detached dot strip.
  const [hoveredChronicleEvent, setHoveredChronicleEvent] = useState<
    { kind: ChronicleEvent['kind']; side: 'a' | 'b'; turn: number } | null
  >(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Latest crisis event that hasn't been dismissed — drives the toast
  // banner. Keyed by turn + category so the same crisis is announced
  // once per turn across both leaders.
  const [crisisToast, setCrisisToast] = useState<{
    key: string;
    side: 'a' | 'b';
    turn: number;
    category: string;
    title: string;
    expiresAt: number;
  } | null>(null);

  // gridSettings is declared here BEFORE any effect that reads it in a
  // dependency array. Previously it was declared further below, which
  // caused a TDZ "Cannot access before initialization" error in the
  // minified bundle because React dep-arrays evaluate inline during
  // render (unlike the effect bodies themselves).
  const [gridSettings, setGridSettingsState] = useState<GridSettings>(() => {
    // Schema version tagged into localStorage so default-changes
    // propagate to users with older stored settings. Bumping when a
    // default flips (v2: `lines` true → false, `deptLabels` off; v3:
    // `deptRings` true → false) forces a clean reset for existing
    // localStorage entries instead of letting the stored `true`
    // override the new `false`. Users who customized get reset once;
    // they can re-toggle from the drawer after.
    const SETTINGS_VERSION = 3;
    try {
      const raw = localStorage.getItem('paracosm:gridSettings');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GridSettings> & { __v?: number };
        if (parsed.__v === SETTINGS_VERSION) {
          const { __v, ...rest } = parsed;
          void __v;
          return { ...DEFAULT_GRID_SETTINGS, ...rest };
        }
        // Stale schema — drop the stored blob and use defaults.
        localStorage.removeItem('paracosm:gridSettings');
      }
    } catch {
      /* silent */
    }
    return DEFAULT_GRID_SETTINGS;
  });
  const setGridSettings = useCallback((next: GridSettings) => {
    setGridSettingsState(next);
    try {
      localStorage.setItem('paracosm:gridSettings', JSON.stringify({ ...next, __v: 3 }));
    } catch {
      /* silent */
    }
  }, []);

  // Scan both event streams for the most recent un-toasted crisis.
  // Dedup across component remounts (e.g. user navigates to About tab
  // and back) via sessionStorage — keeping the Set in a local ref would
  // reset on every remount and the user would see the same crisis toast
  // replay each time they return to the Sim tab.
  //
  // Gated on `state.isRunning` so completed / historical runs don't
  // fire toasts on mount. User feedback that transient notifications
  // popping on Viz tab open "makes no sense" — a finished sim's past
  // crises aren't fresh news; the user is inspecting historical data,
  // not monitoring a live run.
  useEffect(() => {
    if (!gridSettings.alerts) return;
    if (!state.isRunning) return;
    const crisisKinds = new Set(['event_start', 'director_crisis']);
    const storageKey = 'paracosm:seenCrisisToasts';
    const readSeen = (): Set<string> => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw) as string[]);
      } catch {
        return new Set();
      }
    };
    const writeSeen = (s: Set<string>) => {
      try {
        // Cap at 200 entries to bound session storage growth.
        const arr = [...s].slice(-200);
        sessionStorage.setItem(storageKey, JSON.stringify(arr));
      } catch {
        /* silent */
      }
    };
    const seen = readSeen();
    type Evt = { type: string; turn?: number; data?: Record<string, unknown> };
    const findLatest = () => {
      let best: { key: string; side: 'a' | 'b'; turn: number; category: string; title: string } | null = null;
      const slots: Array<{ side: 'a' | 'b'; actorName: string }> = [];
      if (firstLeaderId) slots.push({ side: 'a', actorName: firstLeaderId });
      if (secondLeaderId) slots.push({ side: 'b', actorName: secondLeaderId });
      for (const { side, actorName } of slots) {
        const sideState = state.actors[actorName];
        if (!sideState) continue;
        const events = sideState.events as Evt[];
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i];
          if (!crisisKinds.has(e.type)) continue;
          const turn = Number(e.turn ?? e.data?.turn ?? 0);
          const cat = typeof e.data?.category === 'string' ? e.data.category : '';
          if (!cat) continue;
          const key = `${side}:${turn}:${cat}`;
          if (seen.has(key)) continue;
          const title = typeof e.data?.title === 'string' ? e.data.title : '';
          if (!best || turn > best.turn) {
            best = { key, side, turn, category: cat, title };
          }
          break;
        }
      }
      return best;
    };
    const latest = findLatest();
    if (!latest) return;
    seen.add(latest.key);
    writeSeen(seen);
    setCrisisToast(prev => {
      if (prev && prev.key === latest.key) return prev;
      return { ...latest, expiresAt: performance.now() + 5500 };
    });
  }, [state.actorIds, state.actors, gridSettings.alerts, state.isRunning]);

  // Dismiss crisis toast after timeout.
  useEffect(() => {
    if (!crisisToast) return;
    const remaining = crisisToast.expiresAt - performance.now();
    if (remaining <= 0) {
      setCrisisToast(null);
      return;
    }
    const id = setTimeout(() => setCrisisToast(null), remaining);
    return () => clearTimeout(id);
  }, [crisisToast]);

  // Threshold alerts: fire when morale or food crosses a critical
  // boundary for either leader. Dedup per (side, turn, kind) so the
  // same alert isn't repeated after a render.
  type AlertKind = 'morale-crash' | 'food-low';
  const [alertToast, setAlertToast] = useState<{
    key: string;
    side: 'a' | 'b';
    turn: number;
    kind: AlertKind;
    message: string;
    expiresAt: number;
  } | null>(null);
  // Seen-alert dedup: backed by sessionStorage so the same morale/food
  // alert doesn't replay every time the user navigates away and back.
  // useRef alone resets on remount — tab switches within the SPA would
  // surface every historical threshold crossing as a fresh toast.
  const alertStorageKey = 'paracosm:seenThresholdAlerts';
  const readSeenAlerts = useCallback((): Set<string> => {
    try {
      const raw = sessionStorage.getItem(alertStorageKey);
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  }, []);
  const writeSeenAlerts = useCallback((s: Set<string>) => {
    try {
      sessionStorage.setItem(alertStorageKey, JSON.stringify([...s].slice(-200)));
    } catch {
      /* silent */
    }
  }, []);
  useEffect(() => {
    if (!gridSettings.alerts) return;
    // Same reasoning as the crisis toast above: historical threshold
    // crossings from a completed sim aren't fresh news. Only surface
    // alerts while the sim is actively running so the user isn't
    // spammed on tab open with past morale crashes and food drops.
    if (!state.isRunning) return;
    const seen = readSeenAlerts();
    const fire = (key: string, toast: Omit<
      NonNullable<typeof alertToast>,
      'key' | 'expiresAt'
    >) => {
      if (seen.has(key)) return;
      seen.add(key);
      setAlertToast({ key, ...toast, expiresAt: performance.now() + 5500 });
    };
    const check = (side: 'a' | 'b', snaps: TurnSnapshot[]) => {
      if (snaps.length < 2) return;
      const current = snaps[snaps.length - 1];
      const prev = snaps[snaps.length - 2];
      const moraleDrop = prev.morale - current.morale;
      if (moraleDrop >= 0.2) {
        fire(`${side}|${current.turn}|morale-crash`, {
          side,
          turn: current.turn,
          kind: 'morale-crash',
          message: `Morale crashed ${Math.round(moraleDrop * 100)}% → ${Math.round(current.morale * 100)}% this turn`,
        });
      }
      if (current.foodReserve < 3 && prev.foodReserve >= 3) {
        fire(`${side}|${current.turn}|food-low`, {
          side,
          turn: current.turn,
          kind: 'food-low',
          message: `Food reserve fell below 3mo (${current.foodReserve.toFixed(1)}mo remaining)`,
        });
      }
    };
    check('a', snapsA);
    check('b', snapsB);
    writeSeenAlerts(seen);
  }, [snapsA, snapsB, gridSettings.alerts, readSeenAlerts, writeSeenAlerts, state.isRunning]);
  useEffect(() => {
    if (!alertToast) return;
    const remaining = alertToast.expiresAt - performance.now();
    if (remaining <= 0) {
      setAlertToast(null);
      return;
    }
    const id = setTimeout(() => setAlertToast(null), remaining);
    return () => clearTimeout(id);
  }, [alertToast]);

  // Palette cycler — cycles through warm amber (default), cool cyan,
  // monochrome. Persists to localStorage.
  type PaletteKey = 'amber' | 'cool' | 'mono';
  const [palette, setPaletteState] = useState<PaletteKey>(() => {
    try {
      const raw = localStorage.getItem('paracosm:gridPalette');
      if (raw === 'cool' || raw === 'mono' || raw === 'amber') return raw;
    } catch {
      /* silent */
    }
    return 'amber';
  });
  const setPalette = useCallback((p: PaletteKey) => {
    setPaletteState(p);
    try {
      localStorage.setItem('paracosm:gridPalette', p);
    } catch {
      /* silent */
    }
  }, []);
  const cyclePalette = useCallback(() => {
    setPalette(palette === 'amber' ? 'cool' : palette === 'cool' ? 'mono' : 'amber');
  }, [palette, setPalette]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Overflow reveal: collapses palette / STATS / Export / Settings
  // behind a single "⋯" toggle so the top strip defaults to
  // {mode pills + more + help}. Expanded state is not persisted —
  // the default collapsed state is the intended look; opening it
  // is a short-lived "I need a tool" gesture.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [forgeLineage, setForgeLineage] = useState<ForgeLineagePayload | null>(null);
  const [focusedSide, setFocusedSide] = useState<'a' | 'b' | null>(null);
  const toggleFocus = useCallback((side: 'a' | 'b') => {
    setFocusedSide(prev => (prev === side ? null : side));
  }, []);
  // Note: gridSettings is hoisted above (near crisisToast) so effects
  // that depend on it can register without triggering a TDZ in minified
  // production bundles.

  // useSoundCues depends on forgeFeeds which is memoized further down
  // in the hook block; the hook body is called later but its argument
  // object is evaluated inline here. The call is now hoisted AFTER
  // forgeFeeds below to avoid TDZ in minified bundles.

  // Snap + leader derivations hoisted here (pre-callback) so any hook
  // that captures them in its dependency array — handleExportJson,
  // searchMatchesMemo, useSoundCues — doesn't hit a TDZ in minified
  // production bundles. Deps evaluate inline during render, so every
  // variable referenced by any hook's deps array MUST appear above the
  // hook. React component scope is one giant `let` block after
  // minification, so forward refs are runtime errors not parse errors.
  const snapA = snapsA[currentTurn] ?? snapsA[snapsA.length - 1];
  const snapB = snapsB[currentTurn] ?? snapsB[snapsB.length - 1];
  const snapATurn = snapA?.turn ?? 0;
  const snapBTurn = snapB?.turn ?? 0;
  const defaultPreset = scenario.presets.find(p => p.id === 'default');
  // Server populates `leaders` (engine field name) post-rename; legacy
  // `actors` alias stays on older fixtures. Read leaders first so the
  // VIZ panel labels carry the loaded scenario's commander names during
  // the launch window before SSE status fires.
  const presetLeaders = defaultPreset?.leaders ?? defaultPreset?.actors;
  const presetA: LeaderInfo | null = presetLeaders?.[0]
    ? { name: presetLeaders[0].name, archetype: presetLeaders[0].archetype, unit: 'Colony Alpha', hexaco: presetLeaders[0].hexaco, instructions: presetLeaders[0].instructions, quote: '' }
    : null;
  const presetB: LeaderInfo | null = presetLeaders?.[1]
    ? { name: presetLeaders[1].name, archetype: presetLeaders[1].archetype, unit: 'Colony Beta', hexaco: presetLeaders[1].hexaco, instructions: presetLeaders[1].instructions, quote: '' }
    : null;
  const leaderA = sideStateA?.leader ?? presetA;
  const leaderB = sideStateB?.leader ?? presetB;

  // Timelapse recording state. Uses MediaRecorder on a composite
  // canvas stream so the user can capture a short webm of the viz.
  const vizRootRef = useRef<HTMLDivElement | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recCompositeRef = useRef<HTMLCanvasElement | null>(null);
  const recRafRef = useRef<number>(0);

  const startTimelapse = useCallback(() => {
    const root = vizRootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const width = Math.max(640, Math.round(rect.width));
    const height = Math.max(360, Math.round(rect.height));
    const composite = document.createElement('canvas');
    composite.width = width;
    composite.height = height;
    const ctx = composite.getContext('2d');
    if (!ctx) return;
    recCompositeRef.current = composite;
    const stream = composite.captureStream(30);
    let mimeType = 'video/webm;codecs=vp9';
    if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    } catch {
      console.warn('MediaRecorder unavailable — timelapse skipped');
      return;
    }
    recChunksRef.current = [];
    rec.ondataavailable = e => {
      if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      if (recRafRef.current) cancelAnimationFrame(recRafRef.current);
      recRafRef.current = 0;
      const blob = new Blob(recChunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paracosm-timelapse-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    recorderRef.current = rec;
    setRecording(true);
    rec.start();

    const loop = () => {
      const c = recCompositeRef.current;
      const r = vizRootRef.current;
      if (!c || !r) return;
      const cctx = c.getContext('2d');
      if (!cctx) return;
      cctx.fillStyle = getComputedStyle(r).getPropertyValue('--bg-deep').trim() || '#0a0806';
      cctx.fillRect(0, 0, c.width, c.height);
      const rootRect = r.getBoundingClientRect();
      const sx = c.width / Math.max(1, rootRect.width);
      const sy = c.height / Math.max(1, rootRect.height);
      const allCanvases = Array.from(r.querySelectorAll('canvas')) as HTMLCanvasElement[];
      for (const cv of allCanvases) {
        const cr = cv.getBoundingClientRect();
        if (cr.width === 0 || cr.height === 0) continue;
        cctx.drawImage(
          cv,
          (cr.left - rootRect.left) * sx,
          (cr.top - rootRect.top) * sy,
          cr.width * sx,
          cr.height * sy,
        );
      }
      recRafRef.current = requestAnimationFrame(loop);
    };
    recRafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopTimelapse = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* silent */
    }
    recorderRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        try {
          recorderRef.current.stop();
        } catch {
          /* silent */
        }
      }
      if (recRafRef.current) cancelAnimationFrame(recRafRef.current);
    };
  }, []);

  // Export the current run state as a JSON replay file.
  const handleExportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      leaderA: { name: leaderA?.name ?? 'Leader A', archetype: leaderA?.archetype ?? '' },
      leaderB: { name: leaderB?.name ?? 'Leader B', archetype: leaderB?.archetype ?? '' },
      currentTurn,
      snapshots: { a: snapsA, b: snapsB },
      events: { a: sideStateA?.events ?? [], b: sideStateB?.events ?? [] },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paracosm-replay-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [currentTurn, leaderA, leaderB, snapsA, snapsB, sideStateA, sideStateB]);


  const handleExportPng = useCallback(() => {
    const root = vizRootRef.current;
    if (!root) return;
    const allCanvases = Array.from(root.querySelectorAll('canvas')) as HTMLCanvasElement[];
    if (allCanvases.length === 0) return;
    const rootRect = root.getBoundingClientRect();
    const scale = 2;
    const out = document.createElement('canvas');
    out.width = Math.round(rootRect.width * scale);
    out.height = Math.round(rootRect.height * scale);
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(root).getPropertyValue('--bg-deep').trim() || '#0a0806';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.scale(scale, scale);
    for (const c of allCanvases) {
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
    }
    out.toBlob(
      blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `paracosm-viz-t${currentTurn + 1}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      'image/png',
    );
  }, [currentTurn]);
  // Scene-transition vignette — briefly dims the whole viz when the
  // user jumps the playhead more than 1 turn in either direction.
  const [vignetteKey, setVignetteKey] = useState(0);
  const lastTurnRef = useRef<number>(-1);
  useEffect(() => {
    if (lastTurnRef.current === -1) {
      lastTurnRef.current = currentTurn;
      return;
    }
    if (Math.abs(currentTurn - lastTurnRef.current) >= 2) {
      setVignetteKey(k => k + 1);
    }
    lastTurnRef.current = currentTurn;
  }, [currentTurn]);
  useEffect(() => {
    const useNewGridFlag = import.meta.env.VITE_NEW_GRID !== '0';
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); handleStepBack(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handleStepForward(); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); handlePlayPause(); }
      else if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setHelpOpen(h => !h); }
      else if (e.key === 'Escape' && helpOpen) { e.preventDefault(); setHelpOpen(false); }
      else if (e.key === '1') { e.preventDefault(); setGridMode('living'); }
      else if (e.key === '2') { e.preventDefault(); setGridMode('mood'); }
      else if (e.key === '3') { e.preventDefault(); setGridMode('forge'); }
      else if (e.key === '4') { e.preventDefault(); setGridMode('ecology'); }
      else if (e.key === '5') { e.preventDefault(); setGridMode('divergence'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleStepBack, handleStepForward, handlePlayPause, helpOpen, setGridMode]);

  // Per-side snapshot resolution with lag tolerance. Two leaders run in
  // parallel via Promise.all, but one side can lag by 10-30 seconds
  // mid-turn (LLM calls are not perfectly synchronized). When the
  // playhead auto-advances to max(snapsA.length, snapsB.length) - 1,
  // the lagging side's `snaps[currentTurn]` is undefined and the grid
  // renders the empty "No snapshot yet" state even though that leader
  // has plenty of earlier snapshots to show. Fall back to the most
  // recent snapshot that side has so both columns always render real
  // colony data. The lag indicator below the header (turn N, lagging)
  // tells the viewer when the two sides are not at the same playhead.
  // snap + leader derivations now live above the export callbacks so
  // their deps arrays can reference leaderA/leaderB without TDZ.

  // Memoize search matches: recomputes only when the query or either
  // snapshot changes. Previously re-ran on every parent re-render,
  // which fires roughly per animation frame via child tickClock bumps.
  const searchMatchesMemo = useMemo<SearchMatch[]>(() => {
    const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const cellMatches = (c: CellSnapshot): boolean => {
      const hay = `${c.name} ${c.department} ${c.role} ${c.mood}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    };
    return [
      ...(snapA?.cells ?? [])
        .filter(c => c.alive && cellMatches(c))
        .map(cell => ({
          cell,
          side: 'a' as const,
          actorName: leaderA?.name ?? 'Leader A',
          sideColor: '#e8b44a',
        })),
      ...(snapB?.cells ?? [])
        .filter(c => c.alive && cellMatches(c))
        .map(cell => ({
          cell,
          side: 'b' as const,
          actorName: leaderB?.name ?? 'Leader B',
          sideColor: '#4ecdc4',
        })),
    ];
  }, [searchQuery, snapA, snapB, leaderA, leaderB]);

  const divergenceData = useMemo(() => computeDivergence(snapA, snapB), [snapA, snapB]);

  /**
   * HEXACO lookup is built from agent_reactions events, which carry a
   * full trait vector per colonist per turn. CellSnapshot does not
   * include hexaco, so we scan events on each side and capture the
   * latest HEXACO seen for each name/agentId.
   */
  /**
   * Per-side forge attempt + reuse ledger. Derived from the raw event
   * stream so the forge automaton mode sees every birth, rejection,
   * and cross-dept reuse call as particles / tracers / orbits.
   * Idempotent via the forge state's seenForgeKeys set, so this can
   * rebuild on each render without duplicate particles.
   */
  const forgeFeeds = useMemo(() => {
    type Attempt = { turn: number; eventIndex: number; department: string; name: string; approved: boolean; confidence?: number };
    type Reuse = { turn: number; originDept: string; callingDept: string; name: string };
    const feed: Record<'a' | 'b', { attempts: Attempt[]; reuses: Reuse[] }> = {
      a: { attempts: [], reuses: [] },
      b: { attempts: [], reuses: [] },
    };
    const slots: Array<{ side: 'a' | 'b'; actorName: string }> = [];
    if (firstLeaderId) slots.push({ side: 'a', actorName: firstLeaderId });
    if (secondLeaderId) slots.push({ side: 'b', actorName: secondLeaderId });
    for (const { side, actorName } of slots) {
      const sideState = state.actors[actorName];
      if (!sideState) continue;
      const firstByName = new Map<string, string>();
      for (const evt of sideState.events) {
        if (evt.type === 'forge_attempt') {
          const d = evt.data || {};
          feed[side].attempts.push({
            turn: Number(d.turn ?? 0),
            eventIndex: Number(d.eventIndex ?? 0),
            department: String(d.department || ''),
            name: String(d.name || ''),
            approved: d.approved === true || d.approved === 'true',
            confidence: typeof d.confidence === 'number' ? d.confidence : undefined,
          });
          if (d.name && d.department && d.approved === true && !firstByName.has(String(d.name))) {
            firstByName.set(String(d.name), String(d.department));
          }
          continue;
        }
        if (evt.type !== 'specialist_done') continue;
        const d = evt.data || {};
        const dept = String(d.department || '');
        const tools = Array.isArray(d.forgedTools) ? d.forgedTools : [];
        for (const t of tools) {
          const tt = t as Record<string, unknown>;
          const name = String(tt.name || '');
          if (!name || name === 'unnamed') continue;
          const firstDept = typeof tt.firstForgedDepartment === 'string'
            ? String(tt.firstForgedDepartment)
            : firstByName.get(name);
          const firstTurn = typeof tt.firstForgedTurn === 'number'
            ? (tt.firstForgedTurn as number)
            : undefined;
          const thisTurn = Number(evt.turn ?? d.turn ?? 0);
          if (firstDept && firstTurn !== undefined && firstTurn < thisTurn) {
            feed[side].reuses.push({
              turn: thisTurn,
              originDept: firstDept,
              callingDept: dept,
              name,
            });
          } else if (firstDept && firstDept !== dept) {
            // Cross-dept mention on same turn counts as reuse too.
            feed[side].reuses.push({
              turn: thisTurn,
              originDept: firstDept,
              callingDept: dept,
              name,
            });
          }
        }
      }
    }
    return feed;
  }, [state]);

  // Now that forgeFeeds exists, wire up sound cues. The hook internally
  // guards on `enabled` so it's cheap when sound is off.
  useSoundCues({
    enabled: gridSettings.sound,
    snapshotA: snapsA[snapsA.length - 1],
    prevSnapshotA: snapsA[snapsA.length - 2],
    snapshotB: snapsB[snapsB.length - 1],
    prevSnapshotB: snapsB[snapsB.length - 2],
    forgeAttemptsA: forgeFeeds.a.attempts,
    forgeAttemptsB: forgeFeeds.b.attempts,
  });

  const hexacoById = useMemo(() => {
    const m = new Map<string, HexacoShape>();
    for (const actorName of state.actorIds) {
      const sideState = state.actors[actorName];
      if (!sideState) continue;
      for (const evt of sideState.events) {
        if (evt.type !== 'agent_reactions') continue;
        const reactions = (evt.data?.reactions as Array<Record<string, unknown>>) || [];
        for (const r of reactions) {
          const h = r.hexaco as HexacoShape | undefined;
          if (!h) continue;
          const id = (r.agentId as string) || (r.name as string);
          if (id) m.set(id, h);
        }
      }
    }
    return m;
  }, [state]);

  const handleOpenChat = useCallback((name: string) => {
    onNavigateToChat?.(name);
  }, [onNavigateToChat]);

  // Media-query hooks MUST be called unconditionally before any
  // early return. A previous iteration had them below the
  // `maxTurn === 0` guard — that broke the Rules of Hooks whenever
  // the user switched from a running sim (hooks fire) to the empty
  // state (hooks don't fire), producing React error #310.
  const narrow = useMediaQuery(NARROW_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);

  // Highlight + legend + diff-overlay hooks. Same Rules-of-Hooks
  // constraint as the media-query hooks above: must run on every render
  // including the maxTurn === 0 empty-state branch, otherwise React
  // throws #310 on the transition between empty-state and populated.
  // Highlight strip: pure derivation from the current and previous
  // snapshot pair. snapToHighlight converts cumulative deaths/births
  // into per-turn deltas; computeTurnHighlight picks the largest
  // divergence and returns one templated sentence. Recomputes on turn
  // change. Nothing async, no LLM.
  const highlightText = useMemo(() => {
    const a = snapsA[currentTurn]
      ? snapToHighlight(snapsA[currentTurn], snapsA[currentTurn - 1])
      : null;
    const b = snapsB[currentTurn]
      ? snapToHighlight(snapsB[currentTurn], snapsB[currentTurn - 1])
      : null;
    return computeTurnHighlight(a, b, currentTurn + 1);
  }, [snapsA, snapsB, currentTurn]);

  // Department list for the legend popover. Colors come from the shared
  // DEPARTMENT_COLORS table so the swatch in the legend matches the
  // tile color rendered on the grid. Memoized on scenario.id so we
  // don't rebuild the array every render.
  const legendDepartments = useMemo(
    () =>
      scenario.departments.map((d) => ({
        id: d.id,
        label: d.label,
        color: DEPARTMENT_COLORS[d.id] ?? DEFAULT_DEPT_COLOR,
      })),
    [scenario.departments],
  );

  // Department label lookup for the divergence-detail chips.
  const departmentLabels = useMemo<Record<string, string>>(
    () => Object.fromEntries(scenario.departments.map((d) => [d.id, d.label])),
    [scenario.departments],
  );

  // Diff overlay state: persisted so the toggle survives page reloads.
  // Default off — first-time viewers shouldn't be hit by the divergence
  // panel before they've understood the highlight strip + legend.
  const [diffOverlayOn, setDiffOverlayOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('paracosm:vizDiffOverlay') === '1';
    } catch {
      return false;
    }
  });
  const setDiffOverlay = useCallback((next: boolean) => {
    setDiffOverlayOn(next);
    try {
      window.localStorage.setItem('paracosm:vizDiffOverlay', next ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, []);

  // D hotkey toggle. Skipped while typing in inputs / textareas / contenteditable
  // so the user's search query doesn't get interrupted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.matches('input, textarea, [contenteditable=true]')) return;
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setDiffOverlay(!diffOverlayOn);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [diffOverlayOn, setDiffOverlay]);

  // Per-department diff at the current turn. Computed only when the
  // overlay is on — useMemo dependency on diffOverlayOn means the heavy
  // work is skipped entirely when the user has the toggle off.
  const cellDiff = useMemo<Map<string, import('./viz-diff').CellDiff> | null>(() => {
    if (!diffOverlayOn) return null;
    const aCells = aggregateByDept(snapsA[currentTurn]);
    const bCells = aggregateByDept(snapsB[currentTurn]);
    return computeCellDiff(aCells, bCells);
  }, [diffOverlayOn, snapsA, snapsB, currentTurn]);

  if (maxTurn === 0) {
    // Running but no first-turn snapshot yet: the run starts with
    // research + commander prompts that take ~10-30s before the first
    // kernel snapshot lands. Showing the static "Run a simulation"
    // empty state in that window read as "nothing happened" even though
    // the SSE stream was carrying status events. Render a live waiting
    // state instead so the user sees the run is on the way.
    if (state.isRunning) {
      return (
        <div className={`viz-content ${styles.empty}`} role="status" aria-live="polite">
          <span className={styles.emptySpinner} aria-hidden="true" />
          <span>Awaiting first turn snapshot — the {scenarioLabels.place} viz will populate once the kernel reports state.</span>
        </div>
      );
    }
    // Replay mode: ?replay=<id> is in the URL but events haven't streamed
    // back yet (or the session was empty). Showing "Run a simulation"
    // here reads as "the cached run failed to load" — instead show a
    // replay-aware empty state so the user knows the load is in flight.
    const isReplaying = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).has('replay');
    if (isReplaying) {
      return (
        <div className={`viz-content ${styles.empty}`} role="status" aria-live="polite">
          <span className={styles.emptySpinner} aria-hidden="true" />
          <span>Loading replay — the {scenarioLabels.place} viz will populate as the cached events stream in.</span>
        </div>
      );
    }
    return (
      <div className={`viz-content ${styles.empty}`}>
        Run a simulation to see the {scenarioLabels.place} visualization.
      </div>
    );
  }

  // Leader metadata is now resolved above (pre-early-return) so
  // dependency arrays in searchMatchesMemo / useSoundCues don't hit TDZ.
  const diffLine = snapA && snapB
    ? `A vs B: ${snapB.population - snapA.population >= 0 ? '+' : ''}${snapB.population - snapA.population} pop, ${snapB.morale - snapA.morale >= 0 ? '+' : ''}${Math.round((snapB.morale - snapA.morale) * 100)}% morale, ${snapB.foodReserve - snapA.foodReserve > 0 ? '+' : ''}${(snapB.foodReserve - snapA.foodReserve).toFixed(1)}mo food`
    : '';

  // Phone: force single-panel view. Side-by-side at 380-400px makes
  // each panel too small to read glyphs and the Conway field; stacked
  // vertically it doubles scroll length. A/B toggle above gives the
  // user deliberate control without giving up deliberate design.
  const effectiveFocusedSide: 'a' | 'b' | null = phone ? (focusedSide ?? 'a') : focusedSide;
  const prevSnapA = currentTurn > 0
    ? (snapsA[currentTurn - 1] ?? snapsA[snapsA.length - 2])
    : undefined;
  const prevSnapB = currentTurn > 0
    ? (snapsB[currentTurn - 1] ?? snapsB[snapsB.length - 2])
    : undefined;
  // Search matches are recomputed only when the query or snapshots
  // change, not on every parent re-render (was triggering on every
  // tickClock bump ~30x/sec before this memo).
  const searchMatches: SearchMatch[] = searchMatchesMemo;

  return (
      <div
        ref={vizRootRef}
        className={`viz-content ${styles.root}`}
      >
        {isCohort && (
          <div className={styles.cohortViewBar} role="region" aria-label="Cohort view controls">
            <div className={styles.cohortViewModeToggle} role="tablist" aria-label="Swarm grid view mode">
              <button
                type="button"
                role="tab"
                aria-selected={vizMode === 'cohort'}
                onClick={() => setVizMode('cohort')}
                className={[
                  styles.cohortViewModeButton,
                  vizMode === 'cohort' ? styles.cohortViewModeButtonActive : '',
                ].filter(Boolean).join(' ')}
                title="Show every actor's living-swarm panel side-by-side with horizontal scroll"
              >
                All {state.actorIds.length} actors
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={vizMode === 'pair'}
                onClick={() => setVizMode('pair')}
                className={[
                  styles.cohortViewModeButton,
                  vizMode === 'pair' ? styles.cohortViewModeButtonActive : '',
                ].filter(Boolean).join(' ')}
                title="Focus on a 2-actor head-to-head with the original pair-mode diff overlay + sympathy hover"
              >
                Focus pair
              </button>
            </div>
            {vizMode === 'pair' && (
              <div className={styles.cohortPairPicker}>
                <select
                  aria-label="Left panel actor"
                  className={styles.cohortPairPickerSelect}
                  value={firstLeaderId ?? ''}
                  onChange={(e) => setPickedAId(e.target.value || undefined)}
                >
                  {state.actorIds.map((id) => (
                    <option key={id} value={id} disabled={id === secondLeaderId}>
                      {state.actors[id]?.leader?.name ?? id}
                    </option>
                  ))}
                </select>
                <span className={styles.cohortPairPickerVs}>vs</span>
                <select
                  aria-label="Right panel actor"
                  className={styles.cohortPairPickerSelect}
                  value={secondLeaderId ?? ''}
                  onChange={(e) => setPickedBId(e.target.value || undefined)}
                >
                  {state.actorIds.map((id) => (
                    <option key={id} value={id} disabled={id === firstLeaderId}>
                      {state.actors[id]?.leader?.name ?? id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        <TurnBanner state={state} currentTurn={currentTurn} />
        <HighlightStrip text={highlightText} turn={currentTurn + 1} />
        <VizLegendBar departments={legendDepartments} />
        {diffOverlayOn && cellDiff && (
          <DivergenceDetail diff={cellDiff} departmentLabels={departmentLabels} />
        )}
        <div className={styles.toolbarStrip}>
          <div className={styles.toolbarTopRow}>
            <div className={styles.modePillsWrap}>
              <GridModePills
                mode={gridMode}
                onChange={setGridMode}
                counts={{
                  forge:
                    forgeFeeds.a.attempts.filter(a => a.approved).length +
                    forgeFeeds.b.attempts.filter(a => a.approved).length,
                  divergence:
                    (divergenceData.aliveOnlyA?.size ?? 0) +
                    (divergenceData.aliveOnlyB?.size ?? 0),
                }}
                labels={scenarioLabels}
              />
            </div>
            <button
              type="button"
              onClick={() => setOverflowOpen(o => !o)}
              aria-label={overflowOpen ? 'Hide advanced tools' : 'Show advanced tools (palette, stats, export, settings)'}
              aria-expanded={overflowOpen}
              title={overflowOpen ? 'Hide tools' : 'Palette · Stats · Export · Settings'}
              className={[styles.overflowToggle, overflowOpen ? styles.overflowToggleOpen : ''].filter(Boolean).join(' ')}
            >
              {'\u22ef'}
            </button>
            <button
              type="button"
              onClick={() => setDiffOverlay(!diffOverlayOn)}
              aria-label={diffOverlayOn ? 'Hide A-vs-B diff overlay (D)' : 'Show A-vs-B diff overlay (D)'}
              aria-pressed={diffOverlayOn}
              title="Highlight where Leader A and Leader B diverged this turn (press D)"
              className={styles.helpBtn}
            >
              Diff {diffOverlayOn ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Open help overlay (shortcut: ?)"
              title="What do these colors / symbols / modes mean? (press ?)"
              className={styles.helpBtn}
            >
              ? Help
            </button>
            {overflowOpen && (
              <div
                role="toolbar"
                aria-label="Viz tools"
                className={styles.toolsRow}
              >
                <button
                  type="button"
                  onClick={cyclePalette}
                  aria-label={`Palette: ${palette}. Click to cycle.`}
                  title={`Palette: ${palette.toUpperCase()} (click to cycle)`}
                  className={styles.paletteBtn}
                  style={{
                    '--palette-bg':
                      palette === 'amber'
                        ? 'linear-gradient(135deg, #e8b44a 0 40%, #c44a1e 100%)'
                        : palette === 'cool'
                        ? 'linear-gradient(135deg, #4ecdc4 0 40%, #9b6bd8 100%)'
                        : 'linear-gradient(135deg, #f5f0e4 0 40%, #6b5f50 100%)',
                  } as CSSProperties}
                >
                  {palette}
                </button>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  aria-label="Open run summary"
                  title="Run summary (cumulative totals)"
                  className={styles.toolBtn}
                >
                  STATS
                </button>
                <ExportMenu
                  recording={recording}
                  onExportPng={handleExportPng}
                  onExportJson={handleExportJson}
                  onToggleRecording={recording ? stopTimelapse : startTimelapse}
                />
                <button
                  type="button"
                  onClick={() => setSettingsOpen(o => !o)}
                  aria-label="Open grid settings"
                  aria-expanded={settingsOpen}
                  title="Viz settings"
                  className={[styles.settingsBtn, settingsOpen ? styles.settingsBtnOpen : ''].filter(Boolean).join(' ')}
                >
                  {'\u2699'}
                </button>
              </div>
            )}
          </div>
          <div className={styles.modeHint}>
            {gridModeHint(gridMode, scenarioLabels)}
          </div>
        </div>
        <ColonistSearch
          value={searchQuery}
          onChange={setSearchQuery}
          matches={searchMatches}
          onPick={m => {
            // Narrow the query to exactly this colonist so the bright
            // ring lands on a single glyph. Click the glyph for full
            // drilldown / chat.
            setSearchQuery(m.cell.name);
          }}
        />
        <TurnProgress
          eventsA={(sideStateA?.events ?? []) as Array<{ type: string; turn?: number; data?: Record<string, unknown> }>}
          eventsB={(sideStateB?.events ?? []) as Array<{ type: string; turn?: number; data?: Record<string, unknown> }>}
          totalDepartments={scenario.departments.length}
        />
        <EventChronicle
          eventsA={(sideStateA?.events ?? []) as Array<{ type: string; turn?: number; data?: Record<string, unknown> }>}
          eventsB={(sideStateB?.events ?? []) as Array<{ type: string; turn?: number; data?: Record<string, unknown> }>}
          currentTurn={currentTurn}
          onJumpToTurn={handleTurnChange}
          hoveredTurn={hoveredTurn}
          onHoverTurnChange={setHoveredTurn}
          filter={chronicleFilter}
          onFilterChange={setChronicleFilter}
          onHoverEventChange={setHoveredChronicleEvent}
          onJumpToReports={handleJumpToReports}
          onForgeSelect={(toolName, side) =>
            setForgeLineage({
              toolName,
              side,
              sideColor: side === 'a' ? 'var(--vis)' : 'var(--eng)',
            })
          }
        />
        <TimelineSparkline
          snapsA={snapsA}
          snapsB={snapsB}
          currentTurn={currentTurn}
          onJumpToTurn={handleTurnChange}
          hoveredTurn={hoveredTurn}
          onHoverTurnChange={setHoveredTurn}
        />
        {vizMode === 'pair' && diffLine && (
          <div className={styles.diffLine}>{diffLine}</div>
        )}
        {vizMode === 'pair' && phone && (
          <div
            role="tablist"
            aria-label="Leader panel selector"
            className={styles.phoneTabRow}
          >
            {(['a', 'b'] as const).map(s => {
              const label = s === 'a' ? (leaderA?.name ?? 'Leader A') : (leaderB?.name ?? 'Leader B');
              const color = s === 'a' ? 'var(--vis)' : 'var(--eng)';
              const active = effectiveFocusedSide === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFocusedSide(s)}
                  className={[styles.phoneTab, active ? styles.phoneTabActive : ''].filter(Boolean).join(' ')}
                  style={active ? ({ '--tab-color': color } as CSSProperties) : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {vizMode === 'cohort' && (
          <CohortSwarmGrid
            state={state}
            snapshotMap={snapshotMap}
            currentTurn={currentTurn}
            gridMode={gridMode}
            palette={palette === 'cool' ? 1 : palette === 'mono' ? 2 : 0}
            gridSettings={gridSettings}
            hexacoById={hexacoById}
            searchQuery={searchQuery}
            chronicleFilter={chronicleFilter}
            chronicleHover={hoveredChronicleEvent}
            startTime={scenario.setup?.defaultStartTime}
            onOpenChat={handleOpenChat}
          />
        )}
        {vizMode === 'pair' && (
        <div
          className={[
            'leaders-row',
            styles.leadersRow,
            narrow ? styles.leadersRowNarrow : '',
          ].filter(Boolean).join(' ')}
        >
          <div
            className={[
              styles.sideWrap,
              effectiveFocusedSide === 'b' ? styles.sideWrapHidden : '',
            ].filter(Boolean).join(' ')}
          >
          <LivingSwarmGrid
            snapshot={snapA}
            isLiveRun={state.isRunning}
            previousSnapshot={prevSnapA}
            snapshotHistory={snapsA}
            actorName={leaderA?.name ?? 'Leader A'}
            actorArchetype={leaderA?.archetype ?? ''}
            leaderUnit={leaderA?.unit ?? ''}
            sideColor="var(--vis)"
            side="a"
            lagTurns={snapATurn < snapBTurn ? snapBTurn - snapATurn : 0}
            mode={gridMode}
            hexacoById={hexacoById}
            leaderHexaco={leaderA?.hexaco ? {
              O: leaderA.hexaco.O ?? leaderA.hexaco.openness ?? 0.5,
              C: leaderA.hexaco.C ?? leaderA.hexaco.conscientiousness ?? 0.5,
              E: leaderA.hexaco.E ?? leaderA.hexaco.extraversion ?? 0.5,
              A: leaderA.hexaco.A ?? leaderA.hexaco.agreeableness ?? 0.5,
              Em: leaderA.hexaco.Em ?? leaderA.hexaco.emotionality ?? 0.5,
              HH: leaderA.hexaco.HH ?? leaderA.hexaco.honestyHumility ?? 0.5,
            } : undefined}
            forgeAttempts={forgeFeeds.a.attempts}
            reuseCalls={forgeFeeds.a.reuses}
            divergedIds={divergenceData.aliveOnlyA}
            siblingHoveredId={hoveredB}
            onHoverChange={setHoveredA}
            searchQuery={searchQuery}
            palette={palette === 'cool' ? 1 : palette === 'mono' ? 2 : 0}
            settings={gridSettings}
            startTime={scenario.setup?.defaultStartTime}
            focusedSide={effectiveFocusedSide}
            onToggleFocus={phone ? undefined : toggleFocus}
            onOpenChat={handleOpenChat}
            eventFilter={chronicleFilter}
            chronicleHover={hoveredChronicleEvent}
          />
          </div>
          <div
            className={[
              styles.sideWrap,
              effectiveFocusedSide === 'a' ? styles.sideWrapHidden : '',
            ].filter(Boolean).join(' ')}
          >
          <LivingSwarmGrid
            snapshot={snapB}
            isLiveRun={state.isRunning}
            previousSnapshot={prevSnapB}
            snapshotHistory={snapsB}
            actorName={leaderB?.name ?? 'Leader B'}
            actorArchetype={leaderB?.archetype ?? ''}
            leaderUnit={leaderB?.unit ?? ''}
            sideColor="var(--eng)"
            side="b"
            lagTurns={snapBTurn < snapATurn ? snapATurn - snapBTurn : 0}
            mode={gridMode}
            hexacoById={hexacoById}
            leaderHexaco={leaderB?.hexaco ? {
              O: leaderB.hexaco.O ?? leaderB.hexaco.openness ?? 0.5,
              C: leaderB.hexaco.C ?? leaderB.hexaco.conscientiousness ?? 0.5,
              E: leaderB.hexaco.E ?? leaderB.hexaco.extraversion ?? 0.5,
              A: leaderB.hexaco.A ?? leaderB.hexaco.agreeableness ?? 0.5,
              Em: leaderB.hexaco.Em ?? leaderB.hexaco.emotionality ?? 0.5,
              HH: leaderB.hexaco.HH ?? leaderB.hexaco.honestyHumility ?? 0.5,
            } : undefined}
            forgeAttempts={forgeFeeds.b.attempts}
            reuseCalls={forgeFeeds.b.reuses}
            divergedIds={divergenceData.aliveOnlyB}
            siblingHoveredId={hoveredA}
            onHoverChange={setHoveredB}
            searchQuery={searchQuery}
            palette={palette === 'cool' ? 1 : palette === 'mono' ? 2 : 0}
            settings={gridSettings}
            startTime={scenario.setup?.defaultStartTime}
            focusedSide={effectiveFocusedSide}
            onToggleFocus={phone ? undefined : toggleFocus}
            onOpenChat={handleOpenChat}
            eventFilter={chronicleFilter}
            chronicleHover={hoveredChronicleEvent}
          />
          </div>
        </div>
        )}
        <VizControls
          currentTurn={currentTurn}
          maxTurn={maxTurn}
          time={snapA?.time ?? snapB?.time ?? 0}
          playing={playing}
          speed={speed}
          onTurnChange={handleTurnChange}
          onPlayPause={handlePlayPause}
          onStepBack={handleStepBack}
          onStepForward={handleStepForward}
          onSpeedChange={setSpeed}
        />
        <div className={styles.footerKeys}>
          <Kbd k="?" v="help" />
          <Kbd k="1-5" v="mode" />
          <Kbd k="← →" v="scrub turn" />
          <Kbd k="space" v="play / pause" />
          <Kbd k="click" v={`${scenarioLabels.person} drilldown`} />
          <Kbd k="esc" v="close popover" />
        </div>
        {/* Off-screen aria-live region announces turn deltas to
            screen readers without visual change. Only updates when
            the turn index changes. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className={styles.srOnly}
        >
          {snapA && snapB
            ? `Turn ${Math.max(snapA.turn, snapB.turn)}. ${leaderA?.name ?? 'A'} ${scenarioLabels.place}: ${snapA.cells.filter(c => c.alive).length} alive, ${snapA.births} born, ${snapA.deaths} died, morale ${Math.round(snapA.morale * 100)}%. ${leaderB?.name ?? 'B'} ${scenarioLabels.place}: ${snapB.cells.filter(c => c.alive).length} alive, ${snapB.births} born, ${snapB.deaths} died, morale ${Math.round(snapB.morale * 100)}%.`
            : ''}
        </div>
        {maxTurn > 1 && currentTurn < maxTurn - 1 && (
          <button
            type="button"
            onClick={() => handleTurnChange(maxTurn - 1)}
            aria-label={`Jump to latest turn (T${maxTurn})`}
            className={styles.jumpLatest}
          >
            {'\u2193'} Latest · T{maxTurn}
            <span className={styles.jumpLatestBehind}>
              ({maxTurn - 1 - currentTurn} turn{maxTurn - 1 - currentTurn === 1 ? '' : 's'} behind)
            </span>
          </button>
        )}
        <GridHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
        <GridSettingsDrawer
          open={settingsOpen}
          settings={gridSettings}
          onChange={setGridSettings}
          onClose={() => setSettingsOpen(false)}
        />
        <ForgeLineageModal
          payload={forgeLineage}
          forgeAttemptsA={forgeFeeds.a.attempts}
          forgeAttemptsB={forgeFeeds.b.attempts}
          reuseCallsA={forgeFeeds.a.reuses}
          reuseCallsB={forgeFeeds.b.reuses}
          onClose={() => setForgeLineage(null)}
          onJumpToTurn={t => {
            handleTurnChange(t);
            setForgeLineage(null);
          }}
        />
        <RunSummaryDrawer
          open={summaryOpen}
          onClose={() => setSummaryOpen(false)}
          snapsA={snapsA}
          snapsB={snapsB}
          actorNameA={leaderA?.name ?? 'Leader A'}
          actorNameB={leaderB?.name ?? 'Leader B'}
          forgeApprovedA={forgeFeeds.a.attempts.filter(x => x.approved).length}
          forgeApprovedB={forgeFeeds.b.attempts.filter(x => x.approved).length}
          reuseCountA={forgeFeeds.a.reuses.length}
          reuseCountB={forgeFeeds.b.reuses.length}
          divergedCount={
            (divergenceData.aliveOnlyA?.size ?? 0) + (divergenceData.aliveOnlyB?.size ?? 0)
          }
        />
        {alertToast && (
          <div
            key={alertToast.key}
            role="status"
            aria-live="assertive"
            onClick={() => setAlertToast(null)}
            className={styles.toast}
            style={{
              '--toast-top': crisisToast ? '68px' : '8px',
              '--side-color': alertToast.side === 'a' ? 'var(--vis)' : 'var(--eng)',
              '--left-accent': alertToast.kind === 'morale-crash' ? 'var(--rust)' : 'var(--amber)',
            } as CSSProperties}
            title="Click to dismiss"
          >
            <div
              className={styles.toastKicker}
              style={{
                '--kicker-color': alertToast.kind === 'morale-crash' ? 'var(--rust)' : 'var(--amber)',
              } as CSSProperties}
            >
              <span>{alertToast.kind === 'morale-crash' ? '\u25BC Alert' : '\u26A0 Alert'}</span>
              <span className={styles.toastKickerMeta}>
                {alertToast.side.toUpperCase()} · T{alertToast.turn}
              </span>
            </div>
            <div className={styles.toastBody}>{alertToast.message}</div>
          </div>
        )}
        {crisisToast && (
          <div
            key={crisisToast.key}
            role="status"
            aria-live="polite"
            onClick={() => setCrisisToast(null)}
            className={styles.toast}
            style={{
              '--side-color': crisisToast.side === 'a' ? 'var(--vis)' : 'var(--eng)',
              '--left-accent': 'var(--rust)',
            } as CSSProperties}
            title="Click to dismiss"
          >
            <div className={styles.toastKicker}>
              <span>⚡ Crisis</span>
              <span className={styles.toastKickerMeta}>
                {crisisToast.side.toUpperCase()} · T{crisisToast.turn} · {crisisToast.category}
              </span>
            </div>
            <div className={styles.toastBodyMd}>
              {crisisToast.title || `${crisisToast.category} crisis unfolding`}
            </div>
          </div>
        )}
        {vignetteKey > 0 && (
          <div
            key={vignetteKey}
            aria-hidden="true"
            className={styles.vignette}
          />
        )}
        <style>{`
          @keyframes paracosm-vignette {
            0% { opacity: 0; }
            25% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes paracosm-toast-in {
            0% { opacity: 0; transform: translate(-50%, -8px); }
            100% { opacity: 1; transform: translate(-50%, 0); }
          }
          @keyframes paracosm-jump-pulse {
            0%, 100% { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 0 rgba(232, 180, 74, 0.4); }
            50%      { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 8px rgba(232, 180, 74, 0); }
          }
          @keyframes paracosm-rec-pulse {
            0%, 100% { filter: brightness(1); }
            50%      { filter: brightness(1.2); }
          }
          @keyframes paracosm-spotlight-in {
            0%   { opacity: 0; transform: translateY(-6px); }
            100% { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
}
