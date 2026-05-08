import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { GameState, LeaderInfo } from '../../hooks/useGameState';
import { useScenarioContext } from '../../App';
import { readActiveRunActors } from '../../hooks/useLastLaunchConfig';
import { DigitalTwinPanel } from '../digital-twin/DigitalTwinPanel';
import { DigitalTwinProgress } from '../digital-twin/DigitalTwinProgress';
import type { RunArtifact } from '../../../../../engine/schema/index.js';
import { useCitationContext } from '../../hooks/useCitationRegistry';
import { useToolContext } from '../../hooks/useToolRegistry';
import { ActorBar } from '../layout/ActorBar';
import { StatsBar } from '../layout/StatsBar';
import { DivergenceRail } from './DivergenceRail';
import { Timeline } from './Timeline';
import { TurnGrid } from './TurnGrid';
import { MultiActorTurnGrid } from './MultiActorTurnGrid';
import { SimFooterBar } from './SimFooterBar';
import { RerunPanel } from './RerunPanel';
import { LoadPriorRunsCTA } from '../settings/LoadPriorRunsCTA';
import { SimLayoutToggle, type SimLayout } from './SimLayoutToggle';
import { ConstellationView } from './ConstellationView';
import { ActorTable } from './ActorTable';
import { DistributionPanel } from './DistributionPanel';
import { ActorDrillInModal } from './ActorDrillInModal';
import styles from './SimView.module.scss';

interface SimViewProps {
  state: GameState;
  sseStatus?: string;
  onRun?: () => void;
  /** Optional — opens the guided tour (demo replay) from the empty
   *  state CTA. Without this, first-time users land on a dense
   *  empty page with no affordance to learn what the dashboard
   *  does before spending LLM credits on their own run. */
  onTour?: () => void;
  verdict?: Record<string, unknown> | null;
  /** App-level launching flag — survives tab navigation so users can
   *  switch to viz/chat/etc. and come back to a still-loading sim. */
  launching?: boolean;
  /** Digital-twin artifact returned by /api/quickstart/simulate-intervention
   *  (or a loaded JSON file with subject + intervention). When set,
   *  SimView replaces the parallel-actor layout with DigitalTwinPanel
   *  rendered against this single artifact. */
  interventionArtifact?: RunArtifact | null;
  /** While set (and no artifact yet), SimView renders DigitalTwinProgress
   *  with subject + intervention echo plus the live SSE event log. The
   *  payload carries just the prefilled subject + intervention shapes
   *  the dashboard knew about when the user clicked Run; once the
   *  artifact lands, App.tsx clears this field and DigitalTwinPanel
   *  renders the full result. */
  interventionRunning?: {
    subject: { id: string; name: string; profile?: Record<string, unknown> };
    intervention: { id: string; name: string; description: string; duration?: { value: number; unit: string } };
  } | null;
  /** Clears the intervention artifact so SimView returns to the standard
   *  parallel-actor layout. */
  onInterventionDismiss?: () => void;
  /** Pins the layout to a fixed value, overriding the auto-default and
   *  any previous user pick. The GuidedTour passes 'side-by-side' so its
   *  highlight selectors (`.leaders-row`, `.sim-columns`,
   *  `[aria-label="Colony statistics"]`) always exist — without this,
   *  a viewer who had previously run a 3+ actor sim would see the tour
   *  attempt to highlight nodes that the constellation layout never
   *  renders, and the tour would silently no-op past Sim. */
  forceLayout?: SimLayout;
}

// LeaderColumn (the per-leader scrolling-column helper) was removed
// when SimView switched to TurnGrid for the side-by-side layout. The
// turn-aligned grid groups events by turn across both leaders so the
// per-leader column is no longer a meaningful unit.

/**
 * Compact introduction bar. The old full-paragraph version took three
 * text lines and shoved the actual sim columns below the fold on short
 * viewports. Now collapses to a single short headline with a show/hide
 * toggle; expanded body is only rendered when the user asks for it.
 */
function IntroBar({ onDismiss }: { onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      role="region"
      aria-label="How to read the simulation"
      className={styles.introBar}
    >
      <div className={styles.introBody}>
        <b className={styles.introHeading}>How to read this:</b>{' '}
        {expanded ? (
          <>
            Two commanders with opposing HEXACO profiles run the same seed. Left is Leader A (amber), right is Leader B (teal). Each turn, departments analyze in parallel and may forge a new computational tool in a V8 sandbox or reuse an existing one. Commanders decide. The settlement diverges. Click any tile in Viz to drill into a colonist; click any forge card to inspect the generated code.
          </>
        ) : (
          <>
            two commanders, one seed, divergent histories. HEXACO shapes every LLM call.{' '}
            <button
              onClick={() => setExpanded(true)}
              className={styles.introExpandButton}
            >
              more
            </button>
          </>
        )}
      </div>
      <button
        onClick={onDismiss}
        className={styles.introDismissButton}
        aria-label="Dismiss introduction"
      >
        Got it
      </button>
    </div>
  );
}

export function SimView({ state, sseStatus, onRun, onTour, verdict, launching: launchingProp, interventionArtifact, interventionRunning, onInterventionDismiss, forceLayout }: SimViewProps) {
  const scenario = useScenarioContext();
  // Digital-twin short-circuit: when the dashboard receives an artifact
  // produced by simulateIntervention (subject + intervention populated),
  // we replace the entire SIM body with DigitalTwinPanel. Single-actor
  // intervention runs do not slot into the parallel-actor layout, so
  // mixing the two would just confuse the read.
  if (interventionArtifact) {
    return (
      <div className={styles.root}>
        <div className={styles.scrollableBody}>
          <DigitalTwinPanel artifact={interventionArtifact} state={state} onDismiss={onInterventionDismiss} />
        </div>
      </div>
    );
  }
  // Live phase: server is still streaming SSE events for this run. We
  // know the prefilled subject + intervention from the click that
  // initiated it, so we can render their cards immediately and let the
  // event log + counters fill in as broadcast() pushes events through.
  if (interventionRunning) {
    return (
      <div className={styles.root}>
        <div className={styles.scrollableBody}>
          <DigitalTwinProgress state={state} subject={interventionRunning.subject} intervention={interventionRunning.intervention} />
        </div>
      </div>
    );
  }
  const citationRegistry = useCitationContext();
  const toolRegistry = useToolContext();
  // Local fallback only used when no parent-controlled launching flag is
  // passed (legacy callers). The App now owns this state and threads it
  // through so it survives tab navigation.
  const [localLaunching, setLocalLaunching] = useState(false);
  const launching = launchingProp ?? localLaunching;

  // Layout state. Default to side-by-side because the N-actor surface
  // (`MultiActorTurnGrid`) renders feature parity with the 2-actor
  // TurnGrid via a horizontally-scrolling track of per-actor cells.
  // For large cohorts (50+ actors) the side-by-side track turns into
  // a 50+ column DOM that the browser struggles to keep at 60fps —
  // we soft-default such runs to constellation, which scales much
  // better. The user can still flip back via the layout toggle, and
  // userPickedLayoutRef pins their explicit choice across SSE updates
  // so the auto-default never overrides them mid-run.
  const SIDE_BY_SIDE_AUTO_LIMIT = 50;
  const [layoutState, setLayoutState] = useState<SimLayout>('side-by-side');
  const userPickedLayoutRef = useRef(false);
  const setLayoutWithOverride = useCallback((next: SimLayout) => {
    userPickedLayoutRef.current = true;
    setLayoutState(next);
  }, []);
  // Auto-default to constellation once a large cohort lands. Only
  // applies if the user hasn't explicitly chosen a layout this session.
  useEffect(() => {
    if (userPickedLayoutRef.current) return;
    if (state.actorIds.length > SIDE_BY_SIDE_AUTO_LIMIT && layoutState !== 'constellation') {
      setLayoutState('constellation');
    }
  }, [state.actorIds.length, layoutState]);
  const layout: SimLayout = forceLayout ?? layoutState;

  const [drillInActor, setDrillInActor] = useState<string | null>(null);
  const drillInIndex = drillInActor ? state.actorIds.indexOf(drillInActor) : 0;

  const firstId = state.actorIds[0];
  const secondId = state.actorIds[1];
  const sideA = firstId ? state.actors[firstId] : null;
  const sideB = secondId ? state.actors[secondId] : null;
  const hasEvents = Object.values(state.actors).some(s => s.events.length > 0);
  const showLoading = state.isRunning && !hasEvents;

  // Clear local launching state once events start arriving or sim is running
  useEffect(() => {
    if ((hasEvents || state.isRunning) && launchingProp === undefined) setLocalLaunching(false);
  }, [hasEvents, state.isRunning, launchingProp]);

  const handleRun = useCallback(() => {
    if (launchingProp === undefined) setLocalLaunching(true);
    onRun?.();
  }, [onRun, launchingProp]);

  // Fallback leader info for the live header. Two-step chain:
  //   1. Scenario presets (Mars Genesis / Lunar / etc. ship leaders).
  //   2. The actors of the most recently launched run, persisted to
  //      localStorage at /setup time so compiled scenarios (which
  //      ship no presets) still surface names through the SSE
  //      connect-and-replay window.
  // ActorBar's `leader={sideA?.leader || presetLeaderA}` chain still
  // wins on the SSE-populated value once status:parallel lands.
  const defaultPreset = scenario.presets.find(p => p.id === 'default');
  const presetLeaders = defaultPreset?.leaders ?? defaultPreset?.actors;
  const persistedActors = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return readActiveRunActors(window.localStorage);
  }, []);
  // Coerce both shapes (preset entry, persisted-actor entry) into a
  // single loose record so the `unit` / `instructions` field reads
  // don't TS-error on the structural union. Preset entries don't carry
  // `unit`; the column-default provides "Colony Alpha" / "Colony Beta".
  const fallbackA = (presetLeaders?.[0] ?? persistedActors?.[0]) as
    | { name?: string; archetype?: string; unit?: string; hexaco?: unknown; instructions?: string }
    | undefined;
  const fallbackB = (presetLeaders?.[1] ?? persistedActors?.[1]) as
    | { name?: string; archetype?: string; unit?: string; hexaco?: unknown; instructions?: string }
    | undefined;
  const presetLeaderA: LeaderInfo | null = fallbackA?.name
    ? { name: fallbackA.name, archetype: fallbackA.archetype ?? '', unit: fallbackA.unit ?? 'Colony Alpha', hexaco: (fallbackA.hexaco ?? {}) as LeaderInfo['hexaco'], instructions: fallbackA.instructions ?? '', quote: '' }
    : null;
  const presetLeaderB: LeaderInfo | null = fallbackB?.name
    ? { name: fallbackB.name, archetype: fallbackB.archetype ?? '', unit: fallbackB.unit ?? 'Colony Beta', hexaco: (fallbackB.hexaco ?? {}) as LeaderInfo['hexaco'], instructions: fallbackB.instructions ?? '', quote: '' }
    : null;

  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('paracosm-intro-dismissed') !== '1';
  });

  const dismissIntro = () => {
    setShowIntro(false);
    localStorage.setItem('paracosm-intro-dismissed', '1');
  };

  // Build turn-event text for the shared stats bar
  const eventA = sideA?.event;
  const crisisText = eventA
    ? `T${eventA.turn} \u2014 ${eventA.time}: ${eventA.title}`
    : '';

  const verdictPlacementFor = useMemo(() => {
    const w = verdict && typeof verdict === 'object' ? (verdict as Record<string, unknown>).winner : null;
    return (side: 'A' | 'B'): 'winner' | 'second' | 'tie' | null => {
      if (w === 'tie') return 'tie';
      if (w === side) return 'winner';
      if (w === 'A' || w === 'B') return 'second';
      return null;
    };
  }, [verdict]);

  const progressPercent = state.maxTurns > 0
    ? Math.min(100, Math.max(0, (state.turn / state.maxTurns) * 100))
    : 0;

  const handleScrollToReplayCta = useCallback(() => {
    // Prior UX tried to programmatically click the TopBar LOAD
    // dropdown. That dropdown opens at the top of the screen while
    // the user is looking at the empty state in the middle, so the
    // click registered as "nothing happened" from the user's POV.
    //
    // Instead, scroll to the WATCH A PRIOR RUN card directly below.
    const cta = document.querySelector<HTMLElement>(
      '[data-paracosm-replay-cta="true"]',
    );
    if (!cta) return;
    cta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash the card border so the user's eye catches the landing
    // spot (scroll alone is easy to miss on a long empty state).
    cta.classList.add(styles.flashOn);
    window.setTimeout(() => cta.classList.remove(styles.flashOn), 1200);
  }, []);

  const handleGoToSettings = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'settings');
    window.history.replaceState({}, '', url.toString());
    window.location.reload();
  }, []);

  const columnsVisible = state.isRunning || state.isComplete || hasEvents || sseStatus === 'connected';

  return (
    <div className={styles.root}>
      {/* Top header strip: surfaces the layout toggle prominently so
          users can flip between Side-by-side and Constellation without
          scrolling all the way to the SimFooterBar. The footer copy
          stays for end-of-run navigation but the top one is the
          discoverable surface during a live run. Only renders when the
          SIM has something to show — empty state hides this so it
          doesn't compete with the empty-state CTAs. */}
      {columnsVisible && state.actorIds.length >= 1 && (
        <div className={styles.topHeader}>
          <span className={styles.topHeaderLabel}>LAYOUT</span>
          <SimLayoutToggle
            layout={layout}
            actorCount={state.actorIds.length}
            onChange={setLayoutWithOverride}
          />
          {state.actorIds.length >= 3 && (
            <span className={styles.topHeaderHint}>
              {state.actorIds.length} actors · scroll horizontally in side-by-side
            </span>
          )}
        </div>
      )}
      {layout === 'constellation' ? (
        <>
          <ConstellationView
            state={state}
            onActorClick={(name) => setDrillInActor(name)}
          />
          {/* N-way distribution: quantile bands across all actors per
              turn (median + IQR + min-max envelope) for morale and
              population. Replaces the A-vs-B DivergenceRail story
              with "where does the variance live across the cohort." */}
          <DistributionPanel state={state} />
          {/* Sortable actor roster — the constellation is the visual
              overview, the table is the data view for ranking by
              morale, deaths, forges, or turn progress. Click a row to
              open the same drill-in modal the constellation uses. */}
          <ActorTable
            state={state}
            onActorClick={(id) => setDrillInActor(id)}
          />
        </>
      ) : state.actorIds.length >= 3 ? (
        // N-actor side-by-side: skip the standalone leaders-row that the
        // 2-actor mode renders. `MultiActorTurnGrid` (rendered below)
        // carries its own sticky compact-ActorBar header that already
        // shows every actor's name + archetype + POP + morale + event +
        // Deciding pill. Rendering both at the same time produced two
        // visually-redundant rows of leader cards stacked on top of
        // each other (user-reported regression). StatsBar still pins
        // the global crisis text + tool counts above the grid.
        <StatsBar
          actors={state.actorIds.map(id => ({ id, state: state.actors[id] }))}
          crisisText={crisisText}
          toolRegistry={toolRegistry}
        />
      ) : (
        <>
          {/* Shared leaders row. Winner/tie/second chip on each card
              surfaces the verdict even before the user scrolls down to
              the banner card. */}
          <div className={`leaders-row ${styles.leadersRow}`}>
            <ActorBar
              actorIndex={0}
              leader={sideA?.leader || presetLeaderA}
              popHistory={sideA?.popHistory || []}
              moraleHistory={sideA?.moraleHistory || []}
              verdictPlacement={verdictPlacementFor('A')}
              event={sideA?.event}
              statuses={sideA?.statuses}
              pendingDecision={sideA?.pendingDecision}
            />
            <ActorBar
              actorIndex={1}
              leader={sideB?.leader || presetLeaderB}
              popHistory={sideB?.popHistory || []}
              moraleHistory={sideB?.moraleHistory || []}
              verdictPlacement={verdictPlacementFor('B')}
              event={sideB?.event}
              statuses={sideB?.statuses}
              pendingDecision={sideB?.pendingDecision}
            />
          </div>

          <StatsBar
            actors={state.actorIds.slice(0, 2).map(id => ({ id, state: state.actors[id] }))}
            crisisText={crisisText}
            toolRegistry={toolRegistry}
          />
        </>
      )}

      {/* Slim sim-progress bar. Visible while the run is active and
          hides on completion. */}
      {state.isRunning && !state.isComplete && state.maxTurns > 0 && (
        <div className={styles.progressBar}>
          <span className={styles.progressLabel}>
            Turn {Math.max(1, state.turn)} / {state.maxTurns}
          </span>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          </div>
          <span className={styles.progressPercent}>
            {Math.round(progressPercent)}%
          </span>
        </div>
      )}

      {showIntro && (sideA?.events.length ?? 0) > 0 && <IntroBar onDismiss={dismissIntro} />}

      {/* DivergenceRail is a pairwise A-vs-B per-turn diff — only
          renders when exactly 2 actors are running. For 3+ actors the
          constellation view above already shows the full N-way
          divergence, and a 2-actor rail would be misleading (it would
          silently drop the third actor). */}
      {state.actorIds.length === 2 && <DivergenceRail state={state} />}

      {/* Loading state: connected but no events after 2s grace period.
          role="status" + aria-live polite so SR users hear the heading
          when this state mounts. Spinner is aria-hidden — purely
          decorative, the visible "Simulation starting..." text is the
          accessible signal. */}
      {showLoading && !hasEvents && !state.isComplete && state.turn === 0 && (
        <div className={styles.centerState} role="status" aria-live="polite">
          <span className={`spinner ${styles.centerStateSpinnerSmall}`} aria-hidden="true" />
          <div className={styles.centerStateHeading}>Simulation starting...</div>
          <div className={styles.centerStateCopy}>
            The Event Director is reading simulation state and generating the first event. Departments will analyze and forge tools once it arrives.
          </div>
        </div>
      )}

      {/* Launching state: user clicked Run, waiting for first events */}
      {launching && !hasEvents && !state.isRunning && (
        <div className={styles.centerState} role="status" aria-live="polite">
          <span className={`spinner ${styles.centerStateSpinnerLarge}`} aria-hidden="true" />
          <div className={styles.centerStateHeadingAmber}>Launching Simulation...</div>
          <div className={styles.centerStateCopy}>
            Initializing the Event Director, departments, and agent personalities. First events will appear shortly.
          </div>
        </div>
      )}

      {/* Connecting state: SSE not yet connected, no events, show spinner */}
      {!hasEvents && !state.isComplete && !launching && sseStatus === 'connecting' && (
        <div className={styles.centerState} role="status" aria-live="polite">
          <span className={`spinner ${styles.centerStateSpinnerSmall}`} aria-hidden="true" />
          <div className={styles.centerStateHeading}>Connecting...</div>
          <div className={styles.centerStateCopy}>
            Loading simulation state from the server. If a simulation is running, events will appear shortly.
          </div>
        </div>
      )}

      {/* Empty state: connected but no events and no sim running */}
      {!state.isRunning && !state.isComplete && !hasEvents && sseStatus === 'connected' && !launching && (
        <div className={styles.centerState}>
          <div className={styles.centerStateHeadingLarger}>No simulation running</div>
          <div className={styles.centerStateCopyWide}>
            Configure two commanders with different HEXACO personality profiles, choose a scenario, and launch from the Settings tab. Or load a previously saved simulation.
          </div>
          <div className={styles.emptyStateActions}>
            {onRun && (
              <button
                onClick={handleRun}
                disabled={launching}
                className={styles.buttonRun}
              >
                {launching ? 'Launching…' : 'Run Simulation'}
              </button>
            )}
            <button onClick={handleScrollToReplayCta} className={styles.buttonLoad}>
              Load Prior Run
            </button>
            <button onClick={handleGoToSettings} className={styles.buttonSettings}>
              Settings
            </button>
          </div>
          {onTour && (
            <div className={styles.tourHint}>
              First time here?{' '}
              <button type="button" onClick={onTour} className={styles.tourLink}>
                Take the guided tour →
              </button>
              <span className={styles.tourAside}>(canned demo, no LLM cost)</span>
            </div>
          )}
          {/* Surface saved-run replays right in the empty state so users
              who land on SIM without a running simulation can start
              watching a prior run with one click. */}
          <div
            data-paracosm-replay-cta="true"
            className={`${styles.replayCtaWrap} ${styles.flashCard}`}
          >
            <LoadPriorRunsCTA />
          </div>
        </div>
      )}

      {/* Turn-aligned grid. The pair-mode `TurnGrid` carries the diff
          classification (different-event / different-outcome) which is
          only meaningful for two columns, so we keep it for actorIds=2.
          For N>=3 we render `MultiActorTurnGrid`, which generalises
          the same shape (sticky compact-ActorBar header + per-turn
          rows of N cells) and adds a horizontal scroll track so every
          actor's events stay visible side-by-side. Both gate on
          `columnsVisible` so the grid doesn't render in the empty /
          launching state. Side-by-side layout only — constellation
          mode handles its own surface above. */}
      {columnsVisible && layout === 'side-by-side' && state.actorIds.length === 2 && (
        <TurnGrid state={state} />
      )}
      {columnsVisible && layout === 'side-by-side' && state.actorIds.length >= 3 && (
        <MultiActorTurnGrid state={state} />
      )}

      {/* Verdict surfaces as a global top banner (App.tsx) and inline
          on the Reports tab. */}

      {/* Timeline at bottom — gets the full vertical room now that
          References / Toolbox have moved out of the inline column flow. */}
      <Timeline state={state} />

      {/* End-of-sim evidence bar: small pills that open References and
          Forged Toolbox in modals. */}
      <SimFooterBar
        citationRegistry={citationRegistry}
        toolRegistry={toolRegistry}
        layoutToggle={
          <SimLayoutToggle
            layout={layout}
            actorCount={state.actorIds.length}
            onChange={setLayoutWithOverride}
          />
        }
      />

      {/* Re-run-with-seed+1 epilogue. Extracted to its own file in F4
          batch 2 to satisfy audit finding F8 (modular concerns). */}
      <RerunPanel enabled={state.isComplete && !state.isRunning} />

      {/* Drill-in surface for constellation / actor-table clicks. For
          5+ actor runs the dock keeps the report open while the user
          clicks around the SIM tab; for smaller runs the modal-style
          overlay matches the existing UX. Renders nothing when
          actorName is null. */}
      <ActorDrillInModal
        actorName={drillInActor}
        actorIndex={drillInIndex >= 0 ? drillInIndex : 0}
        state={state}
        onClose={() => setDrillInActor(null)}
        mode={state.actorIds.length >= 5 ? 'dock' : 'modal'}
      />
    </div>
  );
}
