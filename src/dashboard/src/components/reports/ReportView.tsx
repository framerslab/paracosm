import { useMemo, useEffect, useRef, useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import type { GameState } from '../../hooks/useGameState';
import { useCitationContext } from '../../hooks/useCitationRegistry';
import { useToolContext } from '../../hooks/useToolRegistry';
import { useBranchesContext } from '../branches/BranchesContext';
import { useDashboardNavigation } from '../../App';
import { useScenarioLabels } from '../../hooks/useScenarioLabels';
import { ForkModal, type ForkConfirmPayload } from './ForkModal';
import forkStyles from './ForkModal.module.scss';
import { Badge } from '../shared/Badge';
import { CitationPills } from '../shared/CitationPills';
import { ReferencesSection } from '../shared/ReferencesSection';
import { ToolboxSection } from '../shared/ToolboxSection';
import { VerdictPanel } from '../sim/VerdictCard';
import { CostBreakdownModal } from '../layout/CostBreakdownModal';
import { CommanderTrajectoryCard } from './CommanderTrajectoryCard';
import {
  buildReportSections,
  REPORT_ARTIFACT_LABELS,
  REPORT_FOCUS_LABELS,
  type EventReportSection,
} from './reportSections';
import { HeroScoreboard } from './HeroScoreboard';
import { CohortVerdict } from './CohortVerdict';
import { RunStrip } from './RunStrip';
import { MetricSparklines } from './MetricSparklines';
import { ReportSideNav, type SideNavItem } from './ReportSideNav';
import { collectMetricSeries, collectRunStripData } from './reports-shared';
import styles from './ReportView.module.scss';

/**
 * Tiny hook for booleans persisted to localStorage. Used here to remember
 * whether the user expanded the References / Forged Toolbox sections in
 * the Reports tab, so their preference survives navigation and reloads.
 */
function usePersistedToggle(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : raw === '1';
    } catch { return initial; }
  });
  const set = useCallback((v: boolean) => {
    setValue(v);
    try { window.localStorage.setItem(key, v ? '1' : '0'); } catch {}
  }, [key]);
  return [value, set];
}

interface ReportViewProps {
  state: GameState;
  verdict?: Record<string, unknown> | null;
  reportSections: Array<'crisis' | 'departments' | 'decision' | 'outcome' | 'quotes' | 'causality'>;
}

interface EventBlock {
  /** Index within the turn (0..totalEvents-1). */
  eventIndex: number;
  /** Total events in this turn. */
  totalEvents: number;
  title?: string;
  category?: string;
  emergent?: boolean;
  description?: string;
  decision?: string;
  rationale?: string;
  policies?: string[];
  outcome?: string;
  depts: Record<string, { summary: string; tools: number; citations: number; citationList: Array<{ text: string; url: string; doi?: string }> }>;
}

interface TurnData {
  time?: number;
  metrics?: Record<string, unknown>;
  events: Map<number, EventBlock>;
  reactions: Array<Record<string, unknown>>;
  totalReactions: number;
}

function emptyTurn(): TurnData {
  return { events: new Map(), reactions: [], totalReactions: 0 };
}

function getEventBlock(turn: TurnData, eventIndex: number, totalEvents: number): EventBlock {
  let block = turn.events.get(eventIndex);
  if (!block) {
    block = { eventIndex, totalEvents, depts: {} };
    turn.events.set(eventIndex, block);
  }
  if (totalEvents > block.totalEvents) block.totalEvents = totalEvents;
  return block;
}

/**
 * Fold one actor's SSE events into a `Map<turn, TurnData>`. Pure helper
 * shared by the pair-mode turn map (used by RunStrip / Sparklines /
 * Trajectory) and the N-actor turn map (used by the turn-by-turn report
 * for 3+ actor runs). Refactor target: the original
 * inline implementation in the `turns` useMemo lived only in pair-mode
 * scope, which made it impossible to render any actor outside the
 * picked pair without re-walking the full event stream per actor.
 */
function buildSideTurnMap(
  events: Array<{ type: string; turn?: number; data?: Record<string, unknown> }> | undefined,
): Map<number, TurnData> {
  const map = new Map<number, TurnData>();
  if (!events) return map;
  const pending = new Map<number, { decision: string; rationale: string; policies: string[] }>();
  for (const evt of events) {
    const turn = evt.turn;
    // Reject only events with no turn assignment. Falsy `!turn` would
    // also drop turn === 0; while the runtime currently emits turns
    // starting at 1, scenario hooks COULD legitimately emit turn 0
    // events (e.g. an opening prologue or "turn-zero" intro state),
    // and silently dropping them would surface as a missing turn row
    // in the report.
    if (typeof turn !== 'number') continue;
    let t = map.get(turn);
    if (!t) { t = emptyTurn(); map.set(turn, t); }
    const eventIndex = Number(evt.data?.eventIndex ?? 0);
    const totalEvents = Number(evt.data?.totalEvents ?? 1);

    if (evt.type === 'turn_start') {
      if (evt.data?.time != null) t.time = evt.data.time as number;
      if (evt.data?.metrics) t.metrics = evt.data.metrics as Record<string, unknown>;
      if (evt.data?.title && evt.data?.title !== 'Director generating...' && !evt.data?.totalEvents) {
        const block = getEventBlock(t, 0, 1);
        block.title = evt.data.title as string;
        block.category = evt.data.category as string | undefined;
        block.emergent = evt.data.emergent as boolean | undefined;
        block.description = (evt.data.crisis as string) || (evt.data.turnSummary as string) || '';
      }
    }
    if (evt.type === 'event_start') {
      const block = getEventBlock(t, eventIndex, totalEvents);
      block.title = evt.data?.title as string | undefined;
      block.category = evt.data?.category as string | undefined;
      block.emergent = evt.data?.emergent as boolean | undefined;
      block.description = (evt.data?.description as string) || (evt.data?.turnSummary as string) || '';
    }
    if (evt.type === 'decision_made') {
      pending.set(eventIndex, {
        decision: String(evt.data?.decision || ''),
        rationale: String(evt.data?.rationale || ''),
        policies: Array.isArray(evt.data?.selectedPolicies)
          ? (evt.data.selectedPolicies as unknown[]).map(p => typeof p === 'string' ? p : JSON.stringify(p))
          : [],
      });
    }
    if (evt.type === 'outcome') {
      const block = getEventBlock(t, eventIndex, totalEvents);
      block.outcome = String(evt.data?.outcome || '');
      const p = pending.get(eventIndex);
      if (p) {
        block.decision = p.decision;
        block.rationale = p.rationale;
        block.policies = p.policies;
        pending.delete(eventIndex);
      }
    }
    if (evt.type === 'specialist_done') {
      const block = getEventBlock(t, eventIndex, totalEvents);
      const dept = evt.data?.department as string;
      if (dept) {
        const filtered = (evt.data?._filteredTools as Array<Record<string, unknown>>) || [];
        const approvedCount = filtered.filter((tool) => tool?.approved !== false).length;
        block.depts[dept] = {
          summary: (evt.data?.summary as string) || '',
          tools: approvedCount,
          citations: Number(evt.data?.citations ?? 0),
          citationList: (evt.data?.citationList as Array<{ text: string; url: string; doi?: string }>) || [],
        };
      }
    }
    if (evt.type === 'agent_reactions') {
      t.reactions = ((evt.data?.reactions as Array<Record<string, unknown>>) || []).slice(0, 3);
      t.totalReactions = Number(evt.data?.totalReactions ?? 0);
    }
  }
  return map;
}

function toneColor(tone: 'pos' | 'neg' | 'neutral' | undefined): string {
  if (tone === 'pos') return 'var(--green)';
  if (tone === 'neg') return 'var(--rust)';
  return 'var(--text-1)';
}

export function ReportView({ state, verdict, reportSections }: ReportViewProps) {
  const citationRegistry = useCitationContext();
  const toolRegistry = useToolContext();
  // User's expand/collapse preference for References + Toolbox in this tab,
  // persisted across reloads. Default collapsed so the actual report
  // (turn-by-turn events) is the focus when the tab opens.
  const [refsOpen, setRefsOpen] = usePersistedToggle('paracosm-reports-refs-open', false);
  const [toolsOpen, setToolsOpen] = usePersistedToggle('paracosm-reports-tools-open', false);
  // Cost breakdown moved off the dense StatsBar; Reports is the right
  // home for the full modal since users land here to dig into the run.
  const [costOpen, setCostOpen] = useState(false);
  // Fork UX (Tier 2 Spec 2B): a per-turn "Fork at turn N" button
  // visible once the parent run is terminal and snapshots exist.
  const { state: branchesState, dispatch: branchesDispatch } = useBranchesContext();
  const navigate = useDashboardNavigation();
  const labels = useScenarioLabels();
  const [forkModalAtTurn, setForkModalAtTurn] = useState<number | null>(null);
  const parentArtifact = branchesState.parent;
  const canFork = useCallback(
    (turnNum: number): boolean => {
      if (!parentArtifact) return false;
      if (state.isRunning) return false;
      const snaps = (parentArtifact.scenarioExtensions as { kernelSnapshotsPerTurn?: Array<{ turn: number }> } | undefined)?.kernelSnapshotsPerTurn;
      if (!snaps || snaps.length === 0) return false;
      return snaps.some(s => s.turn === turnNum);
    },
    [parentArtifact, state.isRunning],
  );
  const handleForkConfirm = useCallback(
    async (payload: ForkConfirmPayload) => {
      setForkModalAtTurn(null);
      const localId = `branch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      branchesDispatch({
        type: 'BRANCH_OPTIMISTIC',
        localId,
        forkedAtTurn: payload.atTurn,
        actorName: payload.leader.name,
        actorArchetype: payload.leader.archetype,
      });
      const parentTurns = payload.parentArtifact.trajectory?.timepoints?.length ?? 6;
      const seed = payload.seedOverride ?? payload.parentArtifact.metadata.seed ?? 42;
      try {
        const res = await fetch('/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actors: [payload.leader],
            turns: parentTurns,
            seed,
            captureSnapshots: true,
            customEvents: payload.customEvents,
            forkFrom: {
              parentArtifact: payload.parentArtifact,
              atTurn: payload.atTurn,
            },
          }),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          branchesDispatch({
            type: 'BRANCH_ERROR',
            localId,
            message: errBody.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        // Branches is a sub-tab of Studio after the merge.
        navigate('studio');
      } catch (err) {
        branchesDispatch({
          type: 'BRANCH_ERROR',
          localId,
          message: String(err),
        });
      }
    },
    [branchesDispatch, navigate],
  );
  // Actor pair selection. For 2-actor runs the picker is hidden and the
  // canonical actorIds[0]/[1] pair is used. For 3+ actor runs the user
  // can swap either side via a dropdown so they can browse the cohort
  // pairwise without ever feeling like the report is locked to the
  // first two leaders. The selected ids feed every memo below — the
  // turn map, the strip cells, the sparklines, the trajectory cards,
  // and the cost breakdown — so the whole report rotates as one.
  const defaultAId = state.actorIds[0] ?? null;
  const defaultBId = state.actorIds[1] ?? null;
  const [pickedAId, setPickedAId] = useState<string | null>(defaultAId);
  const [pickedBId, setPickedBId] = useState<string | null>(defaultBId);
  // Reset selection if the run just rotated to a different cohort.
  // Without this, switching scenarios mid-session leaves a stale id
  // that maps to nothing and the view goes blank.
  useEffect(() => {
    if (pickedAId && !state.actorIds.includes(pickedAId)) setPickedAId(defaultAId);
    if (pickedBId && !state.actorIds.includes(pickedBId)) setPickedBId(defaultBId);
  }, [state.actorIds, pickedAId, pickedBId, defaultAId, defaultBId]);
  const aId = pickedAId ?? defaultAId;
  const bId = pickedBId ?? defaultBId;
  const isNActor = state.actorIds.length > 2;

  // Per-actor turn map. One entry per actor, keyed by actor id. The
  // pair-mode `turns` derivation below picks two of these for the
  // strip/sparklines/trajectory; the N-actor turn-by-turn view
  // (`nActorTurnList`) renders all of them. Memoizing on `state` only
  // keeps the heavy fold off the picker hot path — swapping aId/bId
  // re-derives the cheap pair view but never re-walks the events.
  const perActorTurns = useMemo(() => {
    const out = new Map<string, Map<number, TurnData>>();
    for (const id of state.actorIds) {
      out.set(id, buildSideTurnMap(state.actors[id]?.events));
    }
    return out;
  }, [state]);

  const turns = useMemo(() => {
    // Pair-mode derivation: pick the user's currently selected aId/bId
    // out of the per-actor map. RunStrip + MetricSparklines +
    // CommanderTrajectoryCard pair are pair-shaped visualizations so
    // they always read from this view. For 2-actor runs aId/bId
    // collapse to actorIds[0]/[1] and behavior is unchanged.
    const aMap = (aId && perActorTurns.get(aId)) || new Map<number, TurnData>();
    const bMap = (bId && perActorTurns.get(bId)) || new Map<number, TurnData>();
    const turnNums = new Set<number>([...aMap.keys(), ...bMap.keys()]);
    return [...turnNums]
      .sort((x, y) => x - y)
      .map((t) => [t, { a: aMap.get(t) ?? emptyTurn(), b: bMap.get(t) ?? emptyTurn() }] as [number, { a: TurnData; b: TurnData }]);
  }, [perActorTurns, aId, bId]);

  // N-actor turn list: ordered by turn, then per-actor cells indexed
  // off state.actorIds so column order on screen matches the launch
  // order users already see in the SIM tab. Only consumed by the
  // 3+ actor turn-by-turn render.
  const nActorTurnList = useMemo<Array<[number, Map<string, TurnData>]>>(() => {
    if (!isNActor) return [];
    const turnSet = new Set<number>();
    for (const m of perActorTurns.values()) {
      for (const k of m.keys()) turnSet.add(k);
    }
    return [...turnSet]
      .sort((x, y) => x - y)
      .map((t) => {
        const cells = new Map<string, TurnData>();
        for (const id of state.actorIds) {
          cells.set(id, perActorTurns.get(id)?.get(t) ?? emptyTurn());
        }
        return [t, cells];
      });
  }, [isNActor, perActorTurns, state.actorIds]);

  const firstId = aId;
  const secondId = bId;
  const sideA = firstId ? state.actors[firstId] : null;
  const sideB = secondId ? state.actors[secondId] : null;
  const nameA = sideA?.leader?.name || 'Leader A';
  const nameB = sideB?.leader?.name || 'Leader B';
  const hasTrajectories = (sideA?.events.some(e => e.type === 'personality_drift') ?? false) || (sideB?.events.some(e => e.type === 'personality_drift') ?? false);
  const hasQuotes = turns.some(([, sides]) => sides.a.reactions.length > 0 || sides.b.reactions.length > 0);
  const hasCausality = turns.some(([, sides]) => (
    [...sides.a.events.values(), ...sides.b.events.values()].some(block => Boolean(block.rationale))
  ));
  const reportPlan = useMemo(() => buildReportSections({
    configuredSections: reportSections,
    hasQuotes,
    hasCausality,
    hasVerdict: Boolean(verdict),
    hasTrajectories,
    hasCost: Boolean(state.cost && state.cost.llmCalls > 0),
    hasToolbox: toolRegistry.list.length > 0,
    hasReferences: citationRegistry.list.length > 0,
  }), [
    reportSections,
    hasQuotes,
    hasCausality,
    verdict,
    hasTrajectories,
    state.cost,
    toolRegistry.list.length,
    citationRegistry.list.length,
  ]);

  // Derivations for the new top-of-report surfaces. All memoized on the
  // same inputs the existing turn map uses so they update in sync.
  // Strip + sparklines respect the picker so swapping actors rotates
  // every panel that mentions A/B in lockstep.
  const stripCells = useMemo(() => collectRunStripData(turns), [turns]);
  const metricSeries = useMemo(() => collectMetricSeries(state, aId, bId), [state, aId, bId]);
  const sideNavItems = useMemo<SideNavItem[]>(() => {
    // Order now matches the new section layout: turn-by-turn content
    // at the top (Strip → Metrics → Trajectory → individual turns →
    // Toolbox), then the Run Summary / Verdict block, then References.
    // Hero scoreboard + verdict are nested under the single
    // `#summary` section so the sidenav jumps straight there.
    const items: SideNavItem[] = [];
    if (stripCells.length > 0) items.push({ id: 'strip', label: 'Strip' });
    if (metricSeries.some(m => m.a.length > 0 || m.b.length > 0)) items.push({ id: 'sparklines', label: 'Metrics' });
    if (hasTrajectories) items.push({ id: 'trajectory', label: 'Trajectory' });
    for (const [turnNum] of turns) items.push({ id: `turn-${turnNum}`, label: `Turn ${turnNum}` });
    if (toolRegistry.list.length > 0) items.push({ id: 'toolbox', label: 'Toolbox' });
    items.push({ id: 'summary', label: verdict ? 'Verdict' : 'Summary' });
    if (citationRegistry.list.length > 0) items.push({ id: 'references', label: 'References' });
    return items;
  }, [verdict, stripCells.length, metricSeries, hasTrajectories, turns, toolRegistry.list.length, citationRegistry.list.length]);

  // All hooks must be declared before any conditional return, otherwise
  // React throws #310 ("rendered more hooks than during the previous
  // render") when the empty-state early-return branch stops taking.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tail-to-bottom: auto-scroll on new turns only when the user is
  // already near the bottom. Releases as soon as they scroll up to
  // read an earlier turn.
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    if (!pinnedRef.current) return;
    if (scrollRef.current && turns.length > 0) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [turns.length]);

  if (!(sideA?.events.length ?? 0) && !(sideB?.events.length ?? 0)) {
    // Differentiate "never ran" from "currently running, no events
    // yet": during the launch + research window the SSE stream is
    // already flowing but the first turn-event hasn't arrived. Showing
    // the static "Run a simulation first" copy in that window read as
    // "the run isn't happening" even though it was. Mirror SimView's
    // launching/connecting language and surface a spinner.
    if (state.isRunning) {
      return (
        <div className={styles.empty}>
          <div className={`${styles.emptyMsg} ${styles.emptyMsgRunning ?? ''}`} role="status" aria-live="polite">
            <span className={styles.emptySpinner} aria-hidden="true" />
            <span>Awaiting first turn — the report populates once the kernel reports an event.</span>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.empty}>
        <div className={styles.emptyMsg}>
          Run a simulation first to see the report.
        </div>
      </div>
    );
  }

  return (
    <div className={`reports-layout ${styles.layout}`}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={`reports-content ${styles.scroll}`}
        role="region"
        aria-label="Turn-by-turn report"
      >
      {/* Key Insight tile — the TL;DR card at the very top so users
          who aren't going to scroll the full report still see the
          verdict headline + the three most important stat deltas.
          Computed from the same verdict payload the Summary section
          below consumes; renders null when no verdict is available
          yet (still-running runs skip the block). */}
      {(() => {
        const v = verdict as { winnerName?: string; winner?: 'A' | 'B' | 'tie'; headline?: string; summary?: string } | null;
        const winnerName = v?.winnerName || '';
        const headline = v?.headline || v?.summary || '';
        if (!verdict && turns.length === 0) return null;
        const turnCount = turns.length;
        const lastTurn = turns[turns.length - 1];
        const firstTurn = turns[0];
        const pick = (systems: Record<string, unknown> | undefined, key: string): number => {
          const v = systems?.[key];
          return typeof v === 'number' ? v : 0;
        };
        const finalPopA = pick(lastTurn?.[1]?.a?.metrics, 'population');
        const finalPopB = pick(lastTurn?.[1]?.b?.metrics, 'population');
        const finalMoraleA = pick(lastTurn?.[1]?.a?.metrics, 'morale');
        const finalMoraleB = pick(lastTurn?.[1]?.b?.metrics, 'morale');
        const initialPopA = pick(firstTurn?.[1]?.a?.metrics, 'population') || finalPopA;
        const initialPopB = pick(firstTurn?.[1]?.b?.metrics, 'population') || finalPopB;
        const totalToolsA = sideA?.events.filter(e => e.type === 'forge_attempt' && e.data?.approved === true).length ?? 0;
        const totalToolsB = sideB?.events.filter(e => e.type === 'forge_attempt' && e.data?.approved === true).length ?? 0;
        const stats: Array<{ label: string; value: string; tone?: 'pos' | 'neg' | 'neutral' }> = [
          { label: 'Turns', value: String(turnCount) },
          {
            label: 'Final pop',
            value: `A ${finalPopA}${finalPopA < initialPopA ? ` (↓${initialPopA - finalPopA})` : ''} · B ${finalPopB}${finalPopB < initialPopB ? ` (↓${initialPopB - finalPopB})` : ''}`,
            tone: finalPopA + finalPopB < initialPopA + initialPopB ? 'neg' : 'neutral',
          },
          {
            label: 'Final morale',
            value: `A ${Math.round(finalMoraleA * 100)}% · B ${Math.round(finalMoraleB * 100)}%`,
            tone: Math.min(finalMoraleA, finalMoraleB) < 0.3 ? 'neg' : Math.min(finalMoraleA, finalMoraleB) >= 0.6 ? 'pos' : 'neutral',
          },
          { label: 'Tools forged', value: `A ${totalToolsA} · B ${totalToolsB}` },
        ];
        return (
          <div className={styles.tldr}>
            <div className={styles.tldrTopRow}>
              <span className={styles.tldrTag}>TL;DR</span>
              {winnerName ? (
                <span className={styles.tldrHeadline}>{winnerName} wins</span>
              ) : turnCount > 0 ? (
                <span className={styles.tldrHeadline}>
                  Run {turnCount} turn{turnCount === 1 ? '' : 's'} — verdict pending
                </span>
              ) : null}
              {headline && <span className={styles.tldrSub}>{headline}</span>}
            </div>
            <div className={styles.tldrStats}>
              {stats.map(s => (
                <span key={s.label}>
                  <span className={styles.tldrStatLabel}>{s.label}:</span>
                  <span
                    className={styles.tldrStatValue}
                    style={{ '--tone-color': toneColor(s.tone) } as CSSProperties}
                  >
                    {s.value}
                  </span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Header row: title on the left, jump-to-summary CTA on the
          right. User asked for the verdict / winner results at the
          bottom (just above References) with a scroll-to anchor up
          top so they can jump there without reading the whole
          turn-by-turn report first. */}
      <div className={styles.headerRow}>
        <h2 className={styles.headerTitle}>Turn-by-Turn Report</h2>
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById('summary');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className={styles.jumpBtn}
        >
          {verdict ? '↓ See verdict + full summary' : '↓ Jump to summary'}
        </button>
      </div>

      {/* Pair-focus picker for 3+ actor runs. The strip, sparklines,
          and trajectory cards below are pair-shaped (A-vs-B framing)
          so they always render exactly two actors; this picker rotates
          which two. The turn-by-turn section further down renders ALL
          N actors via the horizontally-scrolling track — the picker
          does NOT scope it. */}
      {isNActor && (
        <div className={styles.actorPairPicker} role="region" aria-label="Pair focus for strip + sparklines + trajectory">
          <span className={styles.actorPairPickerLabel}>Focus pair</span>
          <select
            aria-label="Left side actor"
            className={styles.actorPairPickerSelect}
            value={aId ?? ''}
            onChange={(e) => setPickedAId(e.target.value || null)}
          >
            {state.actorIds.map(id => (
              <option key={id} value={id} disabled={id === bId}>
                {state.actors[id]?.leader?.name ?? id}
              </option>
            ))}
          </select>
          <span className={styles.actorPairPickerVs}>vs</span>
          <select
            aria-label="Right side actor"
            className={styles.actorPairPickerSelect}
            value={bId ?? ''}
            onChange={(e) => setPickedBId(e.target.value || null)}
          >
            {state.actorIds.map(id => (
              <option key={id} value={id} disabled={id === aId}>
                {state.actors[id]?.leader?.name ?? id}
              </option>
            ))}
          </select>
          <span className={styles.actorPairPickerHint}>
            applies to strip + metrics + trajectory only · turn-by-turn
            below shows all {state.actorIds.length} actors
          </span>
        </div>
      )}

      <section id="strip">
        <RunStrip turns={stripCells} leaderAName={nameA} leaderBName={nameB} />
      </section>

      <section id="sparklines">
        <MetricSparklines metrics={metricSeries} leaderAName={nameA} leaderBName={nameB} />
      </section>

      {/* Commander personality arcs. Shown once per side once there's at
          least one turn of drift data, so the user can visually inspect
          how each commander's HEXACO evolved across the run. Data comes
          from drift SSE events emitted after every turn. */}
      <section id="trajectory">
        {hasTrajectories && (
          <div className={`responsive-grid-2 ${styles.trajectoryGrid}`}>
            <CommanderTrajectoryCard
              events={sideA?.events ?? []}
              actorName={nameA}
              baselineHexaco={sideA?.leader?.hexaco}
            />
            <CommanderTrajectoryCard
              events={sideB?.events ?? []}
              actorName={nameB}
              baselineHexaco={sideB?.leader?.hexaco}
            />
          </div>
        )}
      </section>

      {/* Cost breakdown trigger. Moved out of the StatsBar header when
          the row got too dense; Reports is the right home since users
          land here to dig into the run. Hidden on cached runs that
          never reported any LLM calls. */}
      {state.cost && state.cost.llmCalls > 0 && (
        <div className={styles.costBar}>
          <span className={styles.costLabel}>Run cost</span>
          <span className={styles.costAmount}>
            ${state.cost.totalCostUSD < 0.01 ? state.cost.totalCostUSD.toFixed(4) : state.cost.totalCostUSD.toFixed(2)}
          </span>
          <span className={styles.costMeta}>
            · {state.cost.llmCalls} LLM calls · {(state.cost.totalTokens / 1000).toFixed(1)}k tokens
          </span>
          <button
            type="button"
            onClick={() => setCostOpen(true)}
            className={styles.costBtn}
          >
            Per-stage breakdown ›
          </button>
        </div>
      )}
      {costOpen && state.cost && state.cost.llmCalls > 0 && (
        <CostBreakdownModal
          combined={state.cost}
          leaderA={(firstId ? state.costByActor[firstId] : undefined) ?? { totalTokens: 0, totalCostUSD: 0, llmCalls: 0 }}
          leaderB={(secondId ? state.costByActor[secondId] : undefined) ?? { totalTokens: 0, totalCostUSD: 0, llmCalls: 0 }}
          leaderAName={sideA?.leader?.name}
          leaderBName={sideB?.leader?.name}
          onClose={() => setCostOpen(false)}
        />
      )}

      {/* Turn-by-turn: split rendering between pair-mode (N=2) and the
          N-actor horizontally-scrolling view (N>=3). Pair mode keeps
          the rich DiffBadge + TurnSharedFooter layout the dashboard has
          shipped since v0.5; N-actor mode mirrors the SIM tab's
          MultiActorTurnGrid pattern so all actors are visible per turn
          instead of the previous "first 2 of N" silent truncation that
          left users thinking they were looking at the wrong run. */}
      {!isNActor && turns.map(([turnNum, sides]) => {
        const a = sides.a;
        const b = sides.b;
        const time = a.time || b.time || '?';
        const eventCount = Math.max(
          ...[...a.events.values()].map(e => e.totalEvents),
          ...[...b.events.values()].map(e => e.totalEvents),
          1,
        );
        // Determine divergence by comparing event titles between A and B
        const aFirst = a.events.get(0)?.title;
        const bFirst = b.events.get(0)?.title;
        const diverged = !!(aFirst && bFirst && aFirst !== bFirst);

        return (
          <section
            key={turnNum}
            id={`turn-${turnNum}`}
            className={[styles.turnSection, diverged ? styles.diverged : ''].filter(Boolean).join(' ')}
          >
            <div className={styles.turnHeader}>
              <span className={styles.turnTitle}>
                Turn {turnNum} &mdash; Y{time}
                {eventCount > 1 && (
                  <span className={styles.turnEventCount}>{eventCount} events</span>
                )}
              </span>
              <div className={styles.turnHeaderRight}>
                <span className={[styles.divergenceFlag, diverged ? styles.diverged : ''].filter(Boolean).join(' ')}>
                  {diverged ? 'DIVERGENT' : 'SHARED'}
                </span>
                {canFork(turnNum) && (
                  <button
                    type="button"
                    className={forkStyles.forkButton}
                    onClick={() => setForkModalAtTurn(turnNum)}
                    aria-label={`Fork at ${labels.time} ${turnNum}`}
                  >
                    &#x21B3; Fork at {labels.Time} {turnNum}
                  </button>
                )}
              </div>
            </div>

            {/* Render each event as its own row of two side-by-side blocks */}
            {Array.from({ length: eventCount }).map((_, ei) => (
              <div
                key={ei}
                className={`responsive-grid-2 ${ei < eventCount - 1 ? styles.eventGridSpaced : styles.eventGrid}`}
              >
                <EventSide block={a.events.get(ei)} eventIndex={ei} totalEvents={eventCount} name={nameA} sideColor="var(--vis)" sections={reportPlan.eventSections} />
                <EventSide block={b.events.get(ei)} eventIndex={ei} totalEvents={eventCount} name={nameB} sideColor="var(--eng)" sections={reportPlan.eventSections} />
              </div>
            ))}

            {/* Per-turn shared sections: colony state + agent voices */}
            <div className={`responsive-grid-2 ${styles.footerGrid}`}>
              <TurnSharedFooter data={a} name={nameA} sideColor="var(--vis)" showQuotes={reportPlan.footerSections.includes('quotes')} />
              <TurnSharedFooter data={b} name={nameB} sideColor="var(--eng)" showQuotes={reportPlan.footerSections.includes('quotes')} />
            </div>
          </section>
        );
      })}

      {isNActor && nActorTurnList.map(([turnNum, cells]) => {
        // N-actor turn section. Each row of EventSide cards lives inside
        // its own horizontal-scroll track so 3-300 columns line up
        // without forcing the page to scroll horizontally as a whole.
        // Determine divergence at the cohort level: any two actors with
        // different event-0 titles flips the badge.
        const titles: string[] = [];
        let firstTime: number | undefined;
        let maxEventCount = 1;
        for (const id of state.actorIds) {
          const td = cells.get(id);
          if (!td) continue;
          if (firstTime == null) firstTime = td.time;
          for (const ev of td.events.values()) {
            if (ev.totalEvents > maxEventCount) maxEventCount = ev.totalEvents;
          }
          const title = td.events.get(0)?.title;
          if (title) titles.push(title);
        }
        const diverged = new Set(titles).size > 1;
        const time = firstTime ?? '?';
        return (
          <section
            key={turnNum}
            id={`turn-${turnNum}`}
            className={[styles.turnSection, diverged ? styles.diverged : ''].filter(Boolean).join(' ')}
          >
            <div className={styles.turnHeader}>
              <span className={styles.turnTitle}>
                Turn {turnNum} &mdash; Y{time}
                {maxEventCount > 1 && (
                  <span className={styles.turnEventCount}>{maxEventCount} events</span>
                )}
              </span>
              <div className={styles.turnHeaderRight}>
                <span className={[styles.divergenceFlag, diverged ? styles.diverged : ''].filter(Boolean).join(' ')}>
                  {diverged ? 'DIVERGENT' : 'SHARED'}
                </span>
                {canFork(turnNum) && (
                  <button
                    type="button"
                    className={forkStyles.forkButton}
                    onClick={() => setForkModalAtTurn(turnNum)}
                    aria-label={`Fork at ${labels.time} ${turnNum}`}
                  >
                    &#x21B3; Fork at {labels.Time} {turnNum}
                  </button>
                )}
              </div>
            </div>

            {/* One scroll track per event (so multi-event turns stack
                vertically while each event row scrolls horizontally
                across all N actors). Cell width is bound by CSS
                (--n-actor-cell-min-width) so 4 actors fill the
                viewport while 50 actors trigger horizontal scroll
                without breaking layout. */}
            {Array.from({ length: maxEventCount }).map((_, ei) => (
              <div key={ei} className={ei < maxEventCount - 1 ? styles.nActorEventTrackSpaced : styles.nActorEventTrack}>
                {state.actorIds.map((id, idx) => {
                  const td = cells.get(id);
                  const block = td?.events.get(ei);
                  const actorName = state.actors[id]?.leader?.name ?? id;
                  const sideColor = idx === 0 ? 'var(--vis)' : idx === 1 ? 'var(--eng)' : 'var(--amber)';
                  return (
                    <EventSide
                      key={id}
                      block={block}
                      eventIndex={ei}
                      totalEvents={maxEventCount}
                      name={actorName}
                      sideColor={sideColor}
                      sections={reportPlan.eventSections}
                    />
                  );
                })}
              </div>
            ))}

            {/* Per-turn shared sections: colony state + agent voices,
                one per actor, in the same horizontal-scroll track. */}
            <div className={styles.nActorFooterTrack}>
              {state.actorIds.map((id, idx) => {
                const td = cells.get(id);
                if (!td) return null;
                const actorName = state.actors[id]?.leader?.name ?? id;
                const sideColor = idx === 0 ? 'var(--vis)' : idx === 1 ? 'var(--eng)' : 'var(--amber)';
                return (
                  <TurnSharedFooter
                    key={id}
                    data={td}
                    name={actorName}
                    sideColor={sideColor}
                    showQuotes={reportPlan.footerSections.includes('quotes')}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Forged Toolbox + References — collapsed by default in the Reports
          tab so the turn-by-turn report is the focus on open. The user's
          expand choice is persisted to localStorage so subsequent visits
          restore their preferred view. */}
      <section id="toolbox">
        {toolRegistry.list.length > 0 && (
          <ToolboxSection
            registry={toolRegistry}
            title="Forged Toolbox"
            collapsible
            defaultOpen={toolsOpen}
            onToggle={setToolsOpen}
          />
        )}
      </section>

      {/* Full run summary lives at the bottom of the report so users
          can scroll down at their own pace after reading the
          turn-by-turn breakdown. The top-of-page CTA jumps here via
          the `#summary` anchor. Hosts both the hero scoreboard
          (winner + key deltas) and the full verdict panel (LLM
          judgement reasoning). */}
      <section id="summary" className={styles.summarySection}>
        <div className={styles.summaryLabel}>Run Summary · Verdict · Winner</div>
        <HeroScoreboard
          verdict={verdict}
          leaderAName={nameA}
          leaderBName={nameB}
        />
        {/* Cohort-aware verdict for 3+ actor runs. The HeroScoreboard
            above is the A-vs-B story; CohortVerdict adds quartile
            rankings, the pareto front across morale × population ×
            deaths × tools, and per-actor delta-from-median. Renders
            nothing for ≤2 actor runs (the scoreboard is the right
            shape there). */}
        <CohortVerdict state={state} />
        {verdict && (
          <div className={styles.summaryVerdictWrap}>
            <VerdictPanel verdict={verdict} />
          </div>
        )}
      </section>

      <section id="references">
        {citationRegistry.list.length > 0 && (
          <ReferencesSection
            registry={citationRegistry}
            title="References"
            collapsible
            defaultOpen={refsOpen}
            onToggle={setRefsOpen}
          />
        )}
      </section>

      <details className={styles.aboutDetails}>
        <summary className={styles.aboutSummary}>What's in this report?</summary>
        <div className={styles.aboutBody}>
          <div>
            <div className={styles.aboutBlockTitle}>Scenario focus</div>
            <div className={styles.aboutChips}>
              {reportPlan.focusSections.map(section => (
                <span key={section} className={styles.aboutChip}>
                  {REPORT_FOCUS_LABELS[section]}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className={styles.aboutBlockTitle}>This run produced</div>
            <div className={styles.aboutChips}>
              {reportPlan.artifacts.map(artifact => (
                <span key={artifact} className={styles.aboutChipNeutral}>
                  {REPORT_ARTIFACT_LABELS[artifact]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </details>
      </div>
      <ReportSideNav items={sideNavItems} scrollRoot={scrollRef.current} />
      {forkModalAtTurn !== null && parentArtifact && (
        <ForkModal
          parentArtifact={parentArtifact}
          atTurn={forkModalAtTurn}
          maxTurns={parentArtifact.trajectory?.timepoints?.length ?? 6}
          costPreset="economy"
          provider="openai"
          onConfirm={handleForkConfirm}
          onClose={() => setForkModalAtTurn(null)}
        />
      )}
    </div>
  );
}

const moodColors: Record<string, string> = {
  positive: 'var(--green)', negative: 'var(--rust)', anxious: 'var(--amber)',
  defiant: 'var(--rust)', hopeful: 'var(--green)', resigned: 'var(--text-3)', neutral: 'var(--text-2)',
};

function EventSide({ block, eventIndex, totalEvents, name, sideColor, sections }: {
  block: EventBlock | undefined;
  eventIndex: number;
  totalEvents: number;
  name: string;
  sideColor: string;
  sections: EventReportSection[];
}) {
  const sideStyle = { '--side-color': sideColor } as CSSProperties;

  if (!block || !block.title) {
    return (
      <div className={styles.eventCard}>
        <h4 className={styles.eventHeading} style={sideStyle}>
          {name}
          {totalEvents > 1 && (
            <span className={styles.eventSubLabel}>Event {eventIndex + 1}/{totalEvents}</span>
          )}
        </h4>
        <span className={styles.eventAwaiting}>Awaiting data...</span>
      </div>
    );
  }

  const eventSections: Record<EventReportSection, ReactNode> = {
    crisis: (
      <div key="crisis">
        <div className={styles.eventTitle}>
          {block.title}
          {block.category && <span className={styles.categoryPill}>{block.category}</span>}
          {block.emergent && <span className={styles.emergentPill}>EMERGENT</span>}
        </div>

        {block.description && (
          <div className={styles.eventDescription}>{block.description}</div>
        )}
      </div>
    ),
    decision: block.decision ? (
      <div key="decision" className={styles.eventDecision}>{block.decision}</div>
    ) : null,
    outcome: block.outcome ? (
      <div key="outcome" className={styles.eventOutcomeRow}>
        <Badge outcome={block.outcome} />
        {Array.isArray(block.policies) && block.policies.length > 0 && (
          <span className={styles.eventPolicies}>
            {block.policies.map(p => String(p)).join(' / ')}
          </span>
        )}
      </div>
    ) : null,
    causality: block.rationale ? (
      <details key="causality" className={styles.eventDetails}>
        <summary className={styles.eventDetailsSummary} style={sideStyle}>Rationale</summary>
        <div className={styles.eventRationale} style={sideStyle}>{block.rationale}</div>
      </details>
    ) : null,
    departments: Object.keys(block.depts).length > 0 ? (
      <details key="departments" className={styles.eventDetails} open>
        <summary className={styles.eventDetailsSummary} style={sideStyle}>
          Departments ({Object.keys(block.depts).length})
        </summary>
        <div className={styles.deptList}>
          {Object.entries(block.depts).map(([dept, d]) => (
            <div key={dept} className={styles.deptItem} style={sideStyle}>
              <div className={styles.deptHead}>
                <span className={styles.deptName}>{dept.charAt(0).toUpperCase() + dept.slice(1)}</span>
                <span className={styles.deptMeta}>{d.citations}c {d.tools}t</span>
              </div>
              {d.summary && <div className={styles.deptSummary}>{d.summary}</div>}
              <CitationPills citations={d.citationList} label="" />
            </div>
          ))}
        </div>
      </details>
    ) : null,
  };

  return (
    <div className={styles.eventCard}>
      <h4 className={styles.eventHeading} style={sideStyle}>
        {name}
        {totalEvents > 1 && (
          <span className={styles.eventSubLabel}>Event {eventIndex + 1}/{totalEvents}</span>
        )}
      </h4>

      {sections.map(section => eventSections[section]).filter(Boolean)}
    </div>
  );
}

function TurnSharedFooter({ data, name, sideColor, showQuotes }: { data: TurnData; name: string; sideColor: string; showQuotes: boolean }) {
  const systems = data.metrics as Record<string, number> | undefined;
  if (!systems && (!showQuotes || data.reactions.length === 0)) return <div />;

  const sideStyle = { '--side-color': sideColor } as CSSProperties;

  return (
    <div className={styles.footerCard}>
      {systems && (
        <details className={data.reactions.length ? styles.footerDetails : styles.footerDetailsLast}>
          <summary className={styles.footerSummary} style={sideStyle}>
            {name} &middot; Systems State
          </summary>
          <div className={styles.systemsRow}>
            {Object.entries(systems).map(([k, v]) => (
              <span key={k} className={styles.systemItem}>
                <span className={styles.systemKey}>{k}: </span>
                <span className={styles.systemValue}>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</span>
              </span>
            ))}
          </div>
        </details>
      )}

      {showQuotes && data.reactions.length > 0 && (
        <details open>
          <summary className={styles.footerSummary} style={sideStyle}>
            Agent Voices ({data.totalReactions || data.reactions.length})
          </summary>
          <div className={styles.reactionsList}>
            {data.reactions.map((r, i) => (
              <div key={i} className={styles.reactionItem}>
                <div className={styles.reactionHead}>
                  <span className={styles.reactionName} style={sideStyle}>{String(r.name)}</span>
                  <span
                    className={styles.moodPill}
                    style={{ '--mood-color': moodColors[String(r.mood)] || 'var(--text-3)' } as CSSProperties}
                  >
                    {String(r.mood || '').toUpperCase()}
                  </span>
                </div>
                <div className={styles.reactionQuote}>
                  &ldquo;{String(r.quote || '')}&rdquo;
                </div>
                {!!r.role && (
                  <div className={styles.reactionRole}>
                    {String(r.role)} {r.department ? `in ${String(r.department)}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
