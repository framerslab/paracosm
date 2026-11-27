import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { GameState, LeaderInfo } from '../../hooks/useGameState';
import { useScenarioContext } from '../../App';
import { leaderUnit } from '../../hooks/useScenarioLabels.helpers';
import { readActiveRunActors } from '../../hooks/useLastLaunchConfig';
import { DigitalTwinPanel } from '../digital-twin/DigitalTwinPanel';
import { DigitalTwinProgress } from '../digital-twin/DigitalTwinProgress';
import type { RunArtifact } from '../../../../engine/schema/index.js';
import { useCitationContext } from '../../hooks/useCitationRegistry';
import { useToolContext } from '../../hooks/useToolRegistry';
import { ActorBar } from '../layout/ActorBar';
import { StatsBar } from '../layout/StatsBar';
import { Timeline } from './Timeline';
import { TurnGrid } from './TurnGrid';
import { MultiActorTurnGrid } from './MultiActorTurnGrid';
import { WatchGridPanels } from './WatchGridPanels';
import { PairTurn } from './PairTurn';
import { hasChoice, pairTurnAt } from './pair-turn';
import { createReportTurnHref, createWatchPlaceHref, watchPlaceFromHref } from '../../tab-routing';
import { SimFooterBar } from './SimFooterBar';
import { RerunPanel } from './RerunPanel';
import { VerdictPanel } from './VerdictCard';
import { EmptyTab } from '../layout/EmptyTab';
import { useOnline } from '../quickstart/first-screen/useOnline';
import { SimLayoutToggle, type SimLayout } from './SimLayoutToggle';
import { ConstellationView } from './ConstellationView';
import { ActorTable } from './ActorTable';
import { DistributionPanel } from './DistributionPanel';
import { ActorDrillInModal } from './ActorDrillInModal';
import styles from './SimView.module.scss';

interface SimViewProps {
  state: GameState;
  sseStatus?: string;
  openReportTurn?: (href: string) => void;
  verdict?: Record<string, unknown> | null;
  /** Names the run the page shows. What the verdict's export key said
   *  about one run never shows on the next, the same saved file loaded
   *  again included. */
  shownRun?: string;
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
  /** The state the Digital Twin views read: the run this page started,
   *  whichever scenario it is in. Falls back to `state`. */
  interventionState?: GameState;
  /** Clears the intervention artifact so SimView returns to the standard
   *  parallel-actor layout. */
  onInterventionDismiss?: () => void;
}

// LeaderColumn (the per-leader scrolling-column helper) was removed
// when SimView switched to TurnGrid for the side-by-side layout. The
// turn-aligned grid groups events by turn across both leaders so the
// per-leader column is no longer a meaningful unit.

export function SimView({ state, sseStatus, openReportTurn, verdict, shownRun, launching = false, interventionArtifact, interventionRunning, interventionState = state, onInterventionDismiss }: SimViewProps) {
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
          <DigitalTwinPanel artifact={interventionArtifact} state={interventionState} onDismiss={onInterventionDismiss} />
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
          <DigitalTwinProgress state={interventionState} subject={interventionRunning.subject} intervention={interventionRunning.intervention} />
        </div>
      </div>
    );
  }
  const citationRegistry = useCitationContext();
  const toolRegistry = useToolContext();

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
  const layout = layoutState;

  const [drillInActor, setDrillInActor] = useState<string | null>(null);
  const drillInIndex = drillInActor ? state.actorIds.indexOf(drillInActor) : 0;

  const firstId = state.actorIds[0];
  const secondId = state.actorIds[1];
  const sideA = firstId ? state.actors[firstId] : null;
  const sideB = secondId ? state.actors[secondId] : null;
  const hasEvents = Object.values(state.actors).some(s => s.events.length > 0);
  const showLoading = state.isRunning && !hasEvents;

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
  // `unit`; the default is named for the scenario's settlement.
  const fallbackA = (presetLeaders?.[0] ?? persistedActors?.[0]) as
    | { name?: string; archetype?: string; unit?: string; hexaco?: unknown; instructions?: string }
    | undefined;
  const fallbackB = (presetLeaders?.[1] ?? persistedActors?.[1]) as
    | { name?: string; archetype?: string; unit?: string; hexaco?: unknown; instructions?: string }
    | undefined;
  const presetLeaderA: LeaderInfo | null = fallbackA?.name
    ? { name: fallbackA.name, archetype: fallbackA.archetype ?? '', unit: fallbackA.unit ?? leaderUnit(scenario, 0), hexaco: (fallbackA.hexaco ?? {}) as LeaderInfo['hexaco'], instructions: fallbackA.instructions ?? '', quote: '' }
    : null;
  const presetLeaderB: LeaderInfo | null = fallbackB?.name
    ? { name: fallbackB.name, archetype: fallbackB.archetype ?? '', unit: fallbackB.unit ?? leaderUnit(scenario, 1), hexaco: (fallbackB.hexaco ?? {}) as LeaderInfo['hexaco'], instructions: fallbackB.instructions ?? '', quote: '' }
    : null;

  const [place, setPlace] = useState(() => typeof window === 'undefined' ? 0 : watchPlaceFromHref(window.location.href));
  const selectPlace = (next: number) => {
    setPlace(next);
    window.history.replaceState({}, '', createWatchPlaceHref(window.location.href, next));
  };
  const [stack, setStack] = useState<string | null>(null);
  const showingStack = stack === (shownRun ?? '');
  const pair = state.actorIds.length === 2;
  const pairTurns = useMemo(() => pair
    ? [...new Set(state.actorIds.flatMap(id => state.actors[id].events.flatMap(e => e.turn && e.turn > 0 ? [e.turn] : [])))].sort((a, b) => a - b)
    : [], [pair, state]);
  const turn = pairTurns.at(-1) ?? 1;
  const data = useMemo(() => pairTurnAt(state, turn), [state, turn]);
  const [firstEvidence, setFirstEvidence] = useState<{ run: string | undefined; turn: number } | null>(null);
  useEffect(() => {
    if (!pair || firstEvidence?.run === shownRun && firstEvidence?.turn !== undefined) return;
    if (data.crises.some(crisis => crisis.sides.some(side => side?.outcome && hasChoice(side.choice)))) {
      setFirstEvidence({ run: shownRun, turn });
    }
  }, [pair, shownRun, firstEvidence, turn, data.crises]);
  const reportHref = typeof window === 'undefined' ? `/sim?tab=reports#turn-${turn}` : createReportTurnHref(window.location.href, turn);

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

  const online = useOnline();
  const replayRequested = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('replay');
  if (!state.isRunning && !state.isComplete && !hasEvents && !launching && !replayRequested && (sseStatus === 'connected' || !online)) {
    return <EmptyTab kind="watch" />;
  }

  const columnsVisible = state.isRunning || state.isComplete || hasEvents || sseStatus === 'connected';

  if (pair) return (
    <div className={styles.root}>
      <div className={styles.scrollableBody}>
        {state.isRunning && !state.isComplete && state.maxTurns > 0 && (
          <div className={styles.progressBar}>
            <span className={styles.progressLabel}>Turn {turn} / {state.maxTurns}</span>
            <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${progressPercent}%` }} /></div>
            <span className={styles.progressPercent}>{Math.round(progressPercent)}%</span>
          </div>
        )}
        {showingStack ? <>
          <WatchGridPanels state={state} place={place} onSelectPlace={selectPlace} />
          <button type="button" className={styles.watchKey} onClick={() => {
            setStack(null);
            requestAnimationFrame(() => document.getElementById('watch-turn-heading')?.focus());
          }}>Back to one turn at a time</button>
          <div className={`leaders-row ${styles.leadersRow} ${styles.watchHistoryLeaders}`}>
            {[sideA, sideB].map((side, index) => <ActorBar
              key={index} actorIndex={index} leader={side?.leader ?? null}
              popHistory={side?.popHistory ?? []} moraleHistory={side?.moraleHistory ?? []}
            />)}
          </div>
          <div className={styles.turnRows}><TurnGrid state={state} /></div>
        </> : <PairTurn
          key={`${shownRun}:${turn}`}
          turn={turn} maxTurns={state.maxTurns} data={data} place={place}
          noun={scenario.labels.eventNounSingular ?? 'crisis'}
          metrics={scenario.ui.headerMetrics}
          reportHref={reportHref}
          firstEvidence={!firstEvidence || firstEvidence.run !== shownRun || firstEvidence.turn === turn}
          openReport={openReportTurn ? event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            openReportTurn(reportHref);
          } : undefined}
          grid={<WatchGridPanels state={state} place={place} onSelectPlace={selectPlace} />}
        />}
        {!showingStack && pairTurns.length >= 2 && <button type="button" className={styles.watchKey}
          onClick={() => setStack(shownRun ?? '')}>Read all {pairTurns.length} turns at once</button>}
        {state.isComplete && verdict?.winner != null && <VerdictPanel verdict={verdict} shownRun={shownRun} pairTone />}
      </div>
      <SimFooterBar citationRegistry={citationRegistry} toolRegistry={toolRegistry} />
      <RerunPanel enabled={state.isComplete && !state.isRunning} />
    </div>
  );

  return (
    <div className={styles.root}>
      {/*
        Two-pane SimView shell:
          • <div.scrollableBody> — everything that scrolls (the active
            layout's content, plus Timeline). The app shell is
            `overflow: hidden; height: 100dvh` to keep the topbar /
            tab nav pinned, so SimView creates its own scroll context
            here. Constellation mode (with DistributionPanel + ActorTable
            + Timeline below the constellation SVG) easily exceeds
            viewport height; without an internal scroll the bottom of
            the column was simply clipped and unreachable.
          • <SimFooterBar> + <RerunPanel> — sit OUTSIDE the scroll body
            as flex siblings, so the layout-toggle row and rerun
            controls stay glued to the bottom of the SIM panel
            regardless of how much content is above. Sticky positioning
            inside a flex column is fragile across browsers; siblings
            outside the scroll context are not.
      */}
      <div className={styles.scrollableBody}>
      {/* Inline verdict panel — appears at the top of the SIM body
          when the run completes and the LLM verdict is in. Persistent
          (not dismissable) so the winner + reasoning stays in place
          while the user scrolls through the run details below. The
          global VerdictBanner at the top of every tab remains the
          dismissable surface; this panel is the always-visible
          counterpart pinned to the SIM tab. */}
      {state.isComplete && verdict && (verdict as Record<string, unknown>).winner ? (
        <VerdictPanel verdict={verdict} shownRun={shownRun} />
      ) : null}
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


      {/* DivergenceRail used to render here as its own full-width row.
          Per-turn divergence is already badged on each TurnRow header
          (the DiffBadge inline pill), so the dedicated rail just ate
          a row of vertical space repeating the same signal. The
          constellation layout has its own divergence story via
          DistributionPanel; the side-by-side flow now relies on the
          per-turn DiffBadges alone. */}

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

      {/* Replay-aware empty state: ?replay=<id> in the URL means the user
          just clicked Load Prior Run; the cached events stream in
          shortly. Showing the generic "No simulation running" copy here
          reads as a broken load. Mirror the SwarmViz fix from 147d55055
          (instant cached-run replay + replay-aware empty state). */}
      {!state.isRunning && !state.isComplete && !hasEvents && sseStatus === 'connected' && !launching && replayRequested && (
        <div className={styles.centerState} role="status" aria-live="polite">
          <span className={`spinner ${styles.centerStateSpinnerSmall}`} aria-hidden="true" />
          <div className={styles.centerStateHeading}>Loading replay…</div>
          <div className={styles.centerStateCopy}>
            Streaming the cached run back from the server. Turns and events will populate as they arrive.
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
      {/* The living grid, each leader's own colony once the run has sent a
          roster: a pair's two panels, or from 3 leaders the track of one
          panel a leader, in either layout. It stands above the turn rows,
          which keep a readable height under it. */}
      {columnsVisible && <WatchGridPanels state={state} />}
      {columnsVisible && layout === 'side-by-side' && state.actorIds.length >= 3 && (
        <div className={styles.turnRows}>
          <MultiActorTurnGrid state={state} />
        </div>
      )}

      {/* Verdict surfaces as a global top banner (App.tsx) and inline
          on the Reports tab. */}

      {/* Timeline at bottom — gets the full vertical room now that
          References / Toolbox have moved out of the inline column flow. */}
      <Timeline state={state} />
      </div>

      {/* End-of-sim evidence bar: small pills that open References and
          Forged Toolbox in modals. Sits OUTSIDE scrollableBody so the
          layout-toggle row + reference/toolbox pills stay pinned at the
          bottom of the SIM panel even when constellation-mode content
          overflows the viewport. */}
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
