import { RunExportProvenanceContext } from './components/shared/RunReportDownloads';
import { AiWrittenPage } from './components/shared/AiWritten';
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, createContext, useContext, Component, type ReactNode, type ErrorInfo } from 'react';
import { ThemeProvider } from './theme/ThemeProvider';
import { useScenario, type ScenarioClientPayload } from './hooks/useScenario';
import { PAGE_TITLE } from './components/quickstart/first-screen/words';
import { clearRunLaunchHandoff, readRunLaunchHandoff } from './scenario-sync';
import { ADMIN_TOKEN_HEADER, ADMIN_TOKEN_WHERE, adminTokenState, clearAdminToken, dropUnsendableAdminToken, readAdminToken, subscribeAdminToken } from './admin-token';
import { deriveLabels } from './hooks/useScenarioLabels.helpers';
import { useSSE, type SimEvent } from './hooks/useSSE';
import { useRunPlayhead } from './hooks/useRunPlayhead';
import { useGameState } from './hooks/useGameState';
import { useGamePersistence } from './hooks/useGamePersistence';
import { useLocalHistory } from './hooks/useLocalHistory';
import { useLoadPreview } from './hooks/useLoadPreview';
import { useLoadFromUrl } from './hooks/useLoadFromUrl';
import { writeClipboardText } from './hooks/writeClipboardText';
import {
  parseAutoloadParam,
  parseDestinationTabParam,
  parseLoadUrlParam,
} from './hooks/useLoadFromUrl.helpers';
import {
  buildReplayShareUrl,
  findLatestSavedSessionId,
} from './hooks/shareUrl.helpers';
import { useDashboardDropZone } from './hooks/useDashboardDropZone';
import { LoadPreviewModal } from './components/layout/LoadPreviewModal';
import { LoadFromHostModal } from './components/layout/LoadFromHostModal';
import { DropZoneOverlay } from './components/layout/DropZoneOverlay';
import { useForgeToasts } from './hooks/useForgeToasts';
import { useTerminalToast } from './hooks/useTerminalToast';
import { useSimSavedToast } from './hooks/useSimSavedToast';
import { useShareLink } from './hooks/useShareLink';
import { ShareLinkNote } from './components/shared/ShareLinkNote';
import { useLaunchState } from './hooks/useLaunchState';
import { VerdictBanner } from './components/layout/VerdictBanner';
import { VerdictModal } from './components/layout/VerdictModal';
import { ReplayBanner, ReplayNotFoundBanner } from './components/layout/ReplayBanner';
// EventLogPanel + BranchesTab are now rendered inside SettingsPanel +
// StudioTab as sub-tabs; App.tsx no longer needs them at top level.
import { BranchesProvider } from './components/branches/BranchesContext';
import { BranchesSyncer } from './components/branches/BranchesSyncer';
import { QuickstartView } from './components/quickstart/QuickstartView';
import type { RunEntry } from './components/quickstart/first-screen/StartBand';
import { sendEvent } from './analytics/send';
import { useCitationRegistry, CitationRegistryContext } from './hooks/useCitationRegistry';
import { useToolRegistry, ToolRegistryContext } from './hooks/useToolRegistry';
import { ForgeViewProvider } from './components/forge/ForgeViewProvider';
import { TopBar } from './components/layout/TopBar';
import { ServerFactsProvider } from './components/quickstart/first-screen/useServerFacts';
import { TAB_NAMES } from './components/layout/frameWords';
import { lazyTab } from './components/layout/lazyTab';
import { ProviderErrorBanner } from './components/layout/ProviderErrorBanner';
// Toolbar merged into TopBar
import { SimView } from './components/sim/SimView';
import type { RunArtifact } from '../../engine/schema/index.js';
import { ChatPanel } from './components/chat/ChatPanel';
import type { SettingsPanelProps } from './components/settings/SettingsPanel';
import type { StudioTabProps } from './components/studio/StudioTab';
// The About tab has no panel here: setActiveTab sends it to the landing page at /
import { PageFoot } from './components/layout/PageFoot';
import { RunStatusBar } from './components/layout/RunStatusBar';
import { ToastProvider, useToast } from './components/shared/Toast';
import { ShortcutsOverlay } from './components/shared/ShortcutsOverlay';
import { HowItWorksCard } from './components/quickstart/first-screen/HowItWorksCard';
import { RunTurnsProvider } from './components/quickstart/first-screen/runTurns';
import {
  createDashboardTabHref,
  createSettingsKeyHref,
  createToolLogHref,
  createWatchTurnHref,
  DASHBOARD_TABS,
  getDashboardTabAndSubFromHref,
  type DashboardTab,
} from './tab-routing';
import styles from './App.module.scss';

const ReportView = lazyTab(() => import('./components/reports/ReportView'), 'ReportView');
const StudioTab = lazyTab<StudioTabProps, 'StudioTab'>(
  () => import('./components/studio/StudioTab'), 'StudioTab',
);
const SwarmViz = lazyTab(() => import('./components/viz/SwarmViz'), 'SwarmViz');
type LibraryTabProps = NonNullable<Parameters<typeof import('./components/library/LibraryTab').LibraryTab>[0]>;
const LibraryTab = lazyTab<LibraryTabProps, 'LibraryTab'>(
  () => import('./components/library/LibraryTab'), 'LibraryTab',
);
const SettingsPanel = lazyTab<SettingsPanelProps, 'SettingsPanel'>(
  () => import('./components/settings/SettingsPanel'), 'SettingsPanel',
);

// Scenario context available to all components. Exported so SSR tests
// can wrap their renders with a stubbed scenario value without booting
// the full App tree.
export const ScenarioContext = createContext<ScenarioClientPayload | null>(null);
export function useScenarioContext() {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenarioContext must be used within App');
  return ctx;
}

const ScenarioReadyContext = createContext(true);

/**
 * True once GET /scenario has answered and ScenarioContext holds the server's
 * active scenario, not the Mars fallback the page starts on. A control that
 * starts a run waits for it. A render given a scenario directly, outside App,
 * has it ready.
 */
export function useScenarioReady() {
  return useContext(ScenarioReadyContext);
}

/** Whether GET /scenario has failed since its last answer, and a way to ask again at once. */
export interface ScenarioLoad {
  failed: boolean;
  /** Asks for the scenario now; settles when that answer is in. */
  retryNow(): Promise<void>;
}
const ScenarioLoadContext = createContext<ScenarioLoad>({ failed: false, retryNow: () => Promise.resolve() });

/**
 * The scenario's load state: `failed` is true from a failed GET /scenario
 * until one succeeds, while the page retries by itself. Outside App the
 * scenario never failed.
 */
export function useScenarioLoad(): ScenarioLoad {
  return useContext(ScenarioLoadContext);
}

/**
 * Where a navigation lands. `logTool` opens the Settings tab's Event Log
 * filtered to that forged tool's events by its whole name (a trace's Show
 * in Event Log); `logActor` keeps the log to
 * that actor's events, since two actors of a run can forge tools of one name.
 */
export interface DashboardNavigationOptions {
  logTool?: string;
  logActor?: string;
}
type DashboardNavigate = (tab: Exclude<DashboardTab, 'about'>, options?: DashboardNavigationOptions) => void;
const DashboardNavigationContext = createContext<DashboardNavigate | null>(null);
export function useDashboardNavigation() {
  const ctx = useContext(DashboardNavigationContext);
  if (!ctx) throw new Error('useDashboardNavigation must be used within App');
  return ctx;
}

const RunStartContext = createContext<(runKey?: string, usedVisitorKey?: boolean) => void>(() => {});
/**
 * What a Run control calls once the server has taken its run (the /setup
 * answer carries a redirect, or its status is ok): App leaves the Digital
 * Twin views, which the new run replaces on the SIM tab. A run the server
 * refuses replaces nothing, so the control does not call it then. An
 * in-place launch can pass its run key to enable the finish notices.
 */
export function useRunStart() {
  return useContext(RunStartContext);
}

/**
 * Decide whether a generic sim-error toast should be suppressed because
 * the persistent provider-error banner already describes the same issue.
 *
 * Quota / auth exhaustion can produce multiple sim_error SSE events as
 * downstream calls reject after the banner already fired. Without this
 * filter, users saw one banner plus 5-10 red "Simulation Error" toasts
 * for the same underlying problem.
 */
function isRedundantProviderErrorToast(
  errMessage: string,
  bannerKind: 'quota' | 'auth' | 'rate_limit' | 'network' | 'unknown',
): boolean {
  const lower = errMessage.toLowerCase();
  // Signals that the toast text is about a provider/HTTP failure. If it
  // matches ANY of these AND the banner is one of the terminal kinds,
  // suppress — otherwise let it through (could be a real unrelated bug).
  const isProviderShaped =
    /\b(401|402|403|429|500|502|503|504)\b/.test(errMessage) ||
    lower.includes('exceeded your current quota') ||
    lower.includes('insufficient_quota') ||
    lower.includes('credit_balance_too_low') ||
    lower.includes('quota_exceeded') ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('overloaded_error') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication_error') ||
    lower.includes('too many requests') ||
    lower.includes('api key') ||
    lower.includes('provider error') ||
    lower.includes('openai') ||
    lower.includes('anthropic');
  const bannerCoversIt = bannerKind === 'quota' || bannerKind === 'auth' || bannerKind === 'rate_limit';
  return isProviderShaped && bannerCoversIt;
}

/**
 * Read the `?replay=<id>` query param. Used to switch the SSE source
 * from the live /events feed to /sessions/:id/replay so the dashboard
 * can show a stored sim instead of triggering a new one. Re-runs on
 * popstate so back/forward navigation toggles replay mode without a
 * full page reload.
 */
function useReplaySessionId(): string | null {
  const [id, setId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('replay');
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setId(new URLSearchParams(window.location.search).get('replay'));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return id;
}

/** The events of a page that holds no run of its own in another scenario. */
const NO_EVENTS: SimEvent[] = [];
/** A failed read of /admin-config for the server data gate is asked again after this long, then at twice the gap each time. */
const ADMIN_CONFIG_RETRY_FIRST_MS = 2_000;
/** The longest gap between two reads of /admin-config for that gate. */
const ADMIN_CONFIG_RETRY_MAX_MS = 15_000;
/** What the verdict banner reads for a fork that ran to its end: a fork runs one leader and gets no verdict. */
const FORK_ENDED: Record<string, unknown> = { skipped: true, reason: 'single_actor_fork' };

function AppContent() {
  const { scenario, ready: scenarioReady, failed: scenarioFailed, retryNow: retryScenario } = useScenario();
  const scenarioLoad = useMemo<ScenarioLoad>(() => ({ failed: scenarioFailed, retryNow: retryScenario }), [scenarioFailed, retryScenario]);
  const replaySessionId = useReplaySessionId();
  // The live feed shows a run only in the page's scenario: the server holds
  // one run for every visitor, whichever scenario each one picked.
  // What the page does when the server says it let go of the run the page
  // shows (run_cleared). Set below, where the Digital Twin's state is.
  const runClearedRef = useRef<(runKey: string) => void>(() => {});
  const handleRunCleared = useCallback((runKey: string) => runClearedRef.current(runKey), []);
  const sse = useSSE({ replaySessionId, scenarioId: scenarioReady ? scenario.id : null, onRunCleared: handleRunCleared });
  const [launchedRun, setLaunchedRun] = useState(readRunLaunchHandoff);
  const launchedRunKey = launchedRun?.runKey ?? null;
  useEffect(() => {
    if (launchedRunKey !== null) clearRunLaunchHandoff(launchedRunKey);
  }, [launchedRunKey]);
  // The How it works card: the header's key opens and closes it on every
  // tab. Nothing opens it by itself.
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const howItWorksKeyRef = useRef<HTMLButtonElement | null>(null);
  const toggleHowItWorks = useCallback(() => {
    if (!howItWorksOpen) sendEvent('qs_how_open', {});
    setHowItWorksOpen(!howItWorksOpen);
  }, [howItWorksOpen]);
  const closeHowItWorks = useCallback(() => setHowItWorksOpen(false), []);

  // Global verdict banner. Closable by the user; a dismissal belongs to
  // the run it was made on, so the next run's banner shows, the same
  // winner and headline included.
  const [verdictDismissedKey, setVerdictDismissedKey] = useState<string | null>(null);
  const [verdictModalOpen, setVerdictModalOpen] = useState(false);

  // Escape closes the verdict modal. All other dashboard modals
  // (CostBreakdown, ShortcutsOverlay, ToolDetail, VerdictCard inline
  // modal) already have the same handler; this keeps keyboard
  // dismissal consistent across every overlay.
  useEffect(() => {
    if (!verdictModalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVerdictModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [verdictModalOpen]);

  // The page's title says what the page does, in the words of its
  // description (src/dashboard/index.html), whichever scenario is loaded.
  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  const gameState = useGameState(sse.events, sse.isComplete, sse.results);
  // Names the run the page shows, the same saved file loaded twice as two
  // runs. The Chat tab's threads start afresh for each run, and the
  // verdict's export key drops what it said about the run before.
  const shownRun = `${sse.runKey ?? ''}:${sse.loadedRuns}`;
  // What the Digital Twin views read: the run this page started when the
  // page's own state is not it, and the page's state otherwise.
  const ownRunState = useGameState(sse.ownRun?.events ?? NO_EVENTS, sse.ownRun?.isComplete ?? false);
  const interventionState = sse.ownRun ? ownRunState : gameState;

  // Forge-attempt toast pipeline (sessionStorage + watermark + toasted-key
  // set). Three-layer gating extracted to hooks/useForgeToasts.ts; see
  // that file for the rationale.
  const { toast } = useToast();
  // The run actions menu's share note: the link, what became of the copy
  // and who can open it. It names one run's link, so whatever replaces the
  // run on screen clears it.
  const shareLink = useShareLink();
  const shareRunLink = shareLink.share;
  const clearShareLink = shareLink.clear;
  useForgeToasts({
    events: sse.events,
    replayDone: sse.replayDone,
  });

  const citationRegistry = useCitationRegistry(gameState);
  const toolRegistry = useToolRegistry(gameState);
  const persistence = useGamePersistence(scenario.labels.shortName, {
    id: scenario.id,
    version: scenario.version,
    shortName: scenario.labels.shortName,
  });
  const history = useLocalHistory({ scenarioShortName: scenario.labels.shortName });
  // Initial tab + sub-tab from URL. Legacy ?tab=branches and ?tab=log
  // resolve to studio/settings with the matching sub-tab pre-selected
  // so old deep links keep working.
  const initialRoute = getDashboardTabAndSubFromHref(window.location.href);
  const [activeTab, setActiveTabState] = useState<DashboardTab>(initialRoute.tab);
  const [initialRunEntry] = useState<RunEntry>(() => {
    try {
      const from = new URL(document.referrer);
      if (from.origin === window.location.origin && (from.pathname === '/' || from.pathname === '/index.html')) {
        return 'from_landing';
      }
    } catch {
      // Direct navigation can have an empty referrer.
    }
    return 'direct';
  });
  const visitedOtherTab = useRef(initialRoute.tab !== 'quickstart');
  const runEntry = activeTab === 'quickstart' ? (visitedOtherTab.current ? 'from_tab' : initialRunEntry) : null;
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (activeTab !== 'quickstart') visitedOtherTab.current = true;
    if (pageRef.current) pageRef.current.scrollTop = 0;
  }, [activeTab]);
  const [studioInitialSubTab] = useState<'author' | 'branches'>(
    initialRoute.tab === 'studio' && initialRoute.sub === 'branches' ? 'branches' : 'author',
  );
  // The sub-tab the Settings tab opens on: its settings unless the URL
  // or a forged tool's Show in Event Log asks for the Event Log.
  const [settingsInitialSubTab, setSettingsInitialSubTab] = useState<'config' | 'log'>(
    initialRoute.tab === 'settings' && initialRoute.sub === 'log' ? 'log' : 'config',
  );
  const setActiveTab = useCallback((tab: DashboardTab) => {
    if (tab === 'about') {
      window.location.href = '/';
      return;
    }
    if (tab === 'settings') setSettingsInitialSubTab('config');
    setActiveTabState(tab);
    window.history.replaceState(window.history.state, '', createDashboardTabHref(window.location.href, tab));
  }, []);
  const openReportTurn = useCallback((href: string) => {
    setActiveTabState('reports');
    window.history.replaceState(window.history.state, '', href);
  }, []);
  const changeFrameTab = useCallback((tab: DashboardTab) => {
    if (tab !== activeTab) sendEvent('tab_change', { to: tab });
    setActiveTab(tab);
  }, [activeTab, setActiveTab]);

  // The navigation components get. A trace's Show in Event Log opens the
  // Event Log with the tool's filter, and a toolbox actor's with that actor's:
  // the URL is written before the panel mounts, so EventLogPanel reads the
  // filter from it on its first render.
  const navigateTab = useCallback<DashboardNavigate>((tab, options) => {
    if (options?.logTool || options?.logActor) {
      setSettingsInitialSubTab('log');
      setActiveTabState('settings');
      window.history.replaceState(window.history.state, '', createToolLogHref(window.location.href, options.logTool ?? '', options.logActor));
      return;
    }
    setActiveTab(tab);
  }, [setActiveTab]);
  // A trace's Show in Event Log: the Event Log on one actor's tool, or on
  // the actor's events alone when the tool's name is empty.
  const showToolLog = useCallback((toolName: string, actorName: string) => {
    navigateTab('settings', { logTool: toolName, logActor: actorName });
  }, [navigateTab]);

  // Direct deep-link to /sim?tab=about lands the user on the dashboard
  // with activeTab='about' but no rendering branch handles it (the
  // setActiveTab redirect only fires on user click). Without this
  // effect, the page renders blank below the topbar/tab-bar — caught
  // by the post-deploy click-through audit.
  useEffect(() => {
    if (activeTab === 'about') {
      window.location.href = '/';
    }
  }, [activeTab]);

  const handleSave = useCallback(() => {
    // Include verdict in the export so reload restores the end-of-sim
    // judgment (previously dropped — saves looked incomplete on load).
    persistence.save(sse.events, sse.results, sse.verdict, sse.provenance);
    toast('success', 'Saved', `${sse.events.length} events${sse.verdict ? ' + verdict' : ''} saved to file.`);
  }, [sse.events, sse.results, sse.verdict, sse.provenance, persistence, toast]);

  // Deep-link intent captured once at mount via useState lazy init.
  // Only populated when the initial URL has a valid `?load=<url>` param
  // — picker / DnD flows leave this empty so they retain their "always
  // land on sim" default. `destinationTab` lets a share link target a
  // non-sim tab (most commonly viz for r/dataisbeautiful-style social
  // shares); `autoload` skips the F9 preview modal so the share is
  // one-click. Setter unused — value is immutable for the session.
  const [deepLinkIntent] = useState<{
    destinationTab: DashboardTab | null;
    autoload: boolean;
  }>(() => {
    if (typeof window === 'undefined') return { destinationTab: null, autoload: false };
    const parsed = parseLoadUrlParam(window.location.href);
    if (!parsed.ok) return { destinationTab: null, autoload: false };
    return {
      destinationTab: parseDestinationTabParam(window.location.href, DASHBOARD_TABS),
      autoload: parseAutoloadParam(window.location.href),
    };
  });
  // True from the moment the link's own file goes to the preview until a
  // file the visitor picks or drops takes its place. The link's autoload
  // and tab apply to that file alone: after the visitor cancels the link,
  // or its file fails to load, their own file still gets the preview.
  const linkFileRef = useRef(false);

  // Digital-twin artifact returned by /api/quickstart/simulate-intervention.
  // When set, SIM tab renders DigitalTwinPanel instead of the parallel-actor
  // layout. Single-actor intervention runs are structurally different from
  // multi-actor side-by-side runs, so the SIM UI swaps wholesale rather
  // than trying to merge both shapes into one view. Cleared by the panel's
  // dismiss button, and by leaveDigitalTwin.
  const [interventionArtifact, setInterventionArtifact] = useState<RunArtifact | null>(null);
  // While set, SIM renders DigitalTwinProgress (live-streaming events
  // from the in-flight simulate-intervention run) instead of the
  // parallel-actor layout or the static panel. Carries the prefilled
  // subject + intervention so the progress view can echo them on
  // screen before any artifact comes back. Cleared when the artifact
  // arrives (panel takes over), when the user dismisses, and by
  // leaveDigitalTwin.
  const [interventionRunning, setInterventionRunning] = useState<{
    subject: { id: string; name: string; profile?: Record<string, unknown> };
    intervention: { id: string; name: string; description: string; duration?: { value: number; unit: string } };
  } | null>(null);
  // The key of the Digital Twin run whose answer the page waits for, null
  // when it waits for none. The answer of a run the page has left (the
  // server took another run from the page, or the views were dismissed) is
  // dropped: the server goes on with the twin and still answers, and that
  // late answer would put the panel back over what the page shows since.
  const twinRunKeyRef = useRef<string | null>(null);
  // The key of the run whose result the panel shows, null when it shows
  // none. The result is a view of that run. When the server says it let go
  // of the run (run_cleared: Delete server data, the visitor's Clear local
  // data in another tab, the server's held-run caps), the result leaves the
  // page with the feed's other views of the run: the server holds nothing
  // of it to show again.
  const twinResultKeyRef = useRef<string | null>(null);
  runClearedRef.current = (runKey: string) => {
    if (runKey !== twinResultKeyRef.current) return;
    twinResultKeyRef.current = null;
    setInterventionArtifact(null);
  };
  // Leaves the Digital Twin views on the SIM tab for what replaces them: a
  // run the server took from one of the page's Run controls, a Quickstart
  // launch, a run loaded from a file or from history, or a clear of the
  // page's local data. A run the server refuses replaces nothing. The feed
  // stops showing the twin's run as the page's own, as a dismiss does.
  const { leaveOwnRun } = sse;
  const leaveDigitalTwin = useCallback(() => {
    twinRunKeyRef.current = null;
    twinResultKeyRef.current = null;
    setInterventionRunning(null);
    setInterventionArtifact(null);
    leaveOwnRun();
  }, [leaveOwnRun]);

  // An accepted launch takes the visitor from saved playback to their
  // own live stream. Other tab changes keep the replay address intact.
  const showNewRun = useCallback((runKey?: string, usedVisitorKey = false) => {
    leaveDigitalTwin();
    setLaunchedRun(runKey ? { runKey, usedVisitorKey } : null);
    const url = new URL(window.location.href);
    const wasReplay = url.searchParams.has('replay');
    url.searchParams.delete('replay');
    window.history.replaceState(window.history.state, '', createWatchTurnHref(url.toString(), null));
    if (wasReplay) window.dispatchEvent(new PopStateEvent('popstate'));
  }, [leaveDigitalTwin]);

  // A run on this page's feed is running. A kept run or a run file loaded
  // now would take the stream's next events into it, so loading waits until
  // the run ends. A launch whose first frame has not come is not held: that
  // frame opens a new run, which replaces what the page shows.
  const runLive = gameState.isRunning;
  const runLiveRef = useRef(runLive);
  runLiveRef.current = runLive;

  const loadPreview = useLoadPreview({
    pickFile: async () => {
      const file = await persistence.pickFile();
      if (file) linkFileRef.current = false;
      return file;
    },
    parseFile: persistence.parseFile,
    currentScenario: { id: scenario.id, name: scenario.labels.name },
    onConfirm: ({ events, results, verdict, provenance }) => {
      // Every way in (Studio, a drop, a preview opened before the run began) ends here.
      if (runLiveRef.current) {
        toast('info', 'Run in progress', 'A run file opens once the run on screen ends.');
        return;
      }
      leaveDigitalTwin();
      sse.loadEvents(events, results, verdict, provenance);
      clearShareLink();
      toast('info', 'Loaded', `${events.length} events loaded.`);
      // Respect the share-link's `?tab=` when it was specified alongside
      // `?load=` — falls back to 'sim' for picker / DnD loads and for
      // share links that didn't pin a tab. 'about' is excluded because
      // landing on / would discard the just-loaded sim state.
      const target = linkFileRef.current ? deepLinkIntent.destinationTab : null;
      linkFileRef.current = false;
      setActiveTab(target && target !== 'about' ? target : 'sim');
    },
    onError: (reason) => {
      toast('error', 'Load Failed', reason);
    },
  });
  const handleLoad = loadPreview.openPicker;

  // ?load=<url> query-param auto-fetch. Runs once on mount; if the
  // param isn't present, the hook is a no-op. A file on another site
  // waits for the visitor's answer to LoadFromHostModal.
  const loadFromUrl = useLoadFromUrl({
    openFromFile: (file) => {
      linkFileRef.current = true;
      return loadPreview.openFromFile(file);
    },
    onInfo: (title, body) => toast('info', title, body),
    onError: (title, body) => toast('error', title, body),
  });

  // ?autoload=1 share-link path: when the F9 preview is ready AND the
  // initial URL asked for auto-confirm, fire confirm once and clear the
  // flag. Without this, social-share viewers would see a "Load run?"
  // modal asking them to click before the viz appears — defeats the
  // one-click share. `consumed` guards against re-firing if state ever
  // cycles back through 'preview' for a subsequent picker / DnD load,
  // and `linkFileRef` confirms only the file the link fetched.
  const autoloadConsumedRef = useRef(false);
  useEffect(() => {
    if (autoloadConsumedRef.current) return;
    if (!deepLinkIntent.autoload) return;
    if (loadPreview.state.kind !== 'preview') return;
    if (!linkFileRef.current) return;
    autoloadConsumedRef.current = true;
    loadPreview.confirm();
  }, [deepLinkIntent.autoload, loadPreview.state.kind, loadPreview]);

  // Drag-and-drop a .json save file anywhere on the dashboard. Uses the
  // same preview + parse pipeline as the file-picker flow.
  const dropZone = useDashboardDropZone({
    onFile: (file) => {
      linkFileRef.current = false;
      return loadPreview.openFromFile(file);
    },
    onError: () => {
      toast('error', 'Unsupported file', 'Only .json simulation files supported.');
    },
    onMultipleFiles: (totalCount) => {
      toast('info', 'Multi-file drop', `Loaded first of ${totalCount} files; ignoring the rest.`);
    },
  });

  const handleClear = useCallback(() => {
    // Clears every browser-side cache the dashboard owns (localStorage
    // event cache, SSE in-memory state, the user-triggered-run gate), with
    // an admin token saved or not. On the server it touches only this
    // browser's own run: POST /clear lets go of it, and stops it when it
    // is running, so a reload does not replay the events just
    // cleared. The question says so. Run history, saved sessions and
    // output files are Delete server data's, a separate item in the same
    // menu (handleWipeServer below).
    if (!confirm(
      'Clear local data? This wipes the in-browser simulation buffer + cached events for this dashboard.\n\n' +
      "It also lets go of this browser's run on the server, and stops it if it is running.\n\n" +
      'Run history, saved sessions, and on-disk artifact files are kept.\n\n' +
      'Cannot be undone.',
    )) return;
    persistence.clearCache();
    leaveDigitalTwin();
    sse.reset();
    setUserTriggeredRun(false);
    setLaunchedRun(null);
    toast('info', 'Local data cleared', 'In-browser caches wiped. Server-stored runs are unchanged.');
    setActiveTab('settings');
  }, [persistence, sse, toast, leaveDigitalTwin]);

  // Delete server data shows only where the server takes admin writes and
  // this browser holds an admin token. The token is watched (Settings saves
  // and clears it, a refused call clears it); /admin-config is asked once a
  // token is there, so a browser without one sends no extra request.
  const [adminTokenSaved, setAdminTokenSaved] = useState(() => adminTokenState() !== 'none');
  useEffect(() => subscribeAdminToken(() => setAdminTokenSaved(adminTokenState() !== 'none')), []);
  // A request that fails, or is answered with an error, is asked again
  // after 2 seconds, then at twice the gap up to 15, and at once when the
  // run actions menu or the Settings controls open, so one failed request
  // does not hide the item for the rest of the page load.
  const [serverAdminWrite, setServerAdminWrite] = useState<boolean | null>(null);
  const [adminConfigAsk, setAdminConfigAsk] = useState(0);
  const adminConfigFailedRef = useRef(false);
  const adminConfigGapRef = useRef(ADMIN_CONFIG_RETRY_FIRST_MS);
  useEffect(() => {
    if (!adminTokenSaved || serverAdminWrite !== null) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const failed = () => {
      if (!live) return;
      adminConfigFailedRef.current = true;
      const gap = adminConfigGapRef.current;
      adminConfigGapRef.current = Math.min(gap * 2, ADMIN_CONFIG_RETRY_MAX_MS);
      retry = setTimeout(() => {
        adminConfigFailedRef.current = false;
        setAdminConfigAsk(n => n + 1);
      }, gap);
    };
    adminConfigFailedRef.current = false;
    fetch('/admin-config')
      .then(res => (res.ok ? res.json() : null))
      .then((config: { adminWrite?: unknown } | null) => {
        if (!live) return;
        if (!config) return failed();
        adminConfigGapRef.current = ADMIN_CONFIG_RETRY_FIRST_MS;
        setServerAdminWrite(config.adminWrite === true);
      })
      .catch(failed);
    return () => {
      live = false;
      if (retry !== undefined) clearTimeout(retry);
    };
  }, [adminTokenSaved, serverAdminWrite, adminConfigAsk]);
  const handleRunActionsOpen = useCallback(() => {
    if (!adminConfigFailedRef.current) return;
    adminConfigFailedRef.current = false;
    setAdminConfigAsk(n => n + 1);
  }, []);

  const handleWipeServer = useCallback(async () => {
    // The server wipe, POST /admin/data/wipe with the admin token: the
    // server's stored runs, saved sessions and run output files, for every
    // visitor. It also drops every finished run the server holds for the
    // live feed, and tells each page showing one (run_cleared), this page
    // included, so those views empty: a page left showing a run the server
    // has deleted would show data the wipe was asked to remove, and could
    // not reload it. The question says so. Runs in progress are kept.
    // This browser's cached data is Clear local data's.
    const adminToken = readAdminToken();
    if (!adminToken) return;
    if (!confirm(
      'Delete server data? This asks the server to delete its stored runs, saved sessions and run output files, for every visitor of this server, not only this browser.\n\n' +
      'Pages showing a finished run this server holds, this one included, empty their view of it. A run in progress keeps running.\n\n' +
      "Clear local data, a separate item, clears this browser's cached data.\n\n" +
      'Cannot be undone.',
    )) return;
    const unsendable = dropUnsendableAdminToken(adminToken);
    if (unsendable) {
      toast('info', 'Server data kept', unsendable);
      setActiveTab('settings');
      return;
    }
    try {
      const res = await fetch('/admin/data/wipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ADMIN_TOKEN_HEADER]: adminToken },
        body: JSON.stringify({ wipeRuns: true, wipeSessions: true, wipeOutput: true }),
      });
      if (res.ok) {
        const body = await res.json() as { wiped: { runs: number; sessions: number; outputFiles: number } };
        toast(
          'info',
          'Server data deleted',
          `${body.wiped.runs} runs, ${body.wiped.sessions} sessions and ${body.wiped.outputFiles} files deleted on the server.`,
        );
      } else if (res.status === 401) {
        // The token no longer matches the server's ADMIN_TOKEN: drop it and
        // say where it is entered. A token entered since the request went
        // out is not the refused one, and stays; the words say which.
        clearAdminToken(adminToken);
        toast(
          'info',
          'Server data kept',
          readAdminToken()
            ? 'Server data not deleted: the server refused the admin token this request was sent with. A newer token is saved in this browser; choose Delete server data again to try with it.'
            : `Server data not deleted: the admin token was refused and has been cleared. ${ADMIN_TOKEN_WHERE}`,
        );
      } else if (res.status === 403) {
        toast('info', 'Server data kept', 'Admin writes are off on this server.');
      } else if (res.status === 503) {
        toast('info', 'Server data kept', 'Admin writes are on but no ADMIN_TOKEN is set on the server.');
      } else {
        const err = await res.json().catch(() => ({} as { error?: string }));
        const detail = err.error ?? `HTTP ${res.status}`;
        if (res.status >= 500) {
          // An error of the server's own. The wipe deletes store by store
          // and restores nothing, so what it deleted before the error
          // stays deleted: the data is not reported as kept.
          toast(
            'error',
            'Server error while deleting',
            `The server reported an error while deleting (${detail}). It may have deleted some of its data before the error.`,
          );
        } else {
          toast('info', 'Server data kept', `Server data not deleted: ${detail}`);
        }
      }
    } catch (err) {
      // The request did not complete, or its answer could not be read. The
      // server may have deleted its data all the same, so neither outcome
      // is claimed.
      toast(
        'info',
        'Deletion not confirmed',
        `Whether the server's data was deleted is not known: its answer did not arrive or could not be read (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
    setActiveTab('settings');
  }, [toast]);

  // Local dismiss flag for the provider-error banner. Lives outside useSSE
  // so dismissing hides the current banner without clearing the underlying
  // sse.providerError state (which stays available to programmatic readers
  // and any later "why did my run fail?" logic). Reset when the error
  // resolves (e.g. key fixed, sim re-run successfully).
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    // If the error state clears (sim reset), also clear the dismiss flag
    // so the banner reappears on a fresh problem.
    if (!sse.providerError) setBannerDismissed(false);
  }, [sse.providerError]);

  // Show simulation errors as toasts — but suppress toasts that are
  // already covered by the persistent provider-error banner. Quota /
  // auth exhaustion fires ONE banner but CAN emit follow-up generic
  // sim_error messages (e.g. when a leader's run promise eventually
  // rejects after provider_error fired). Without dedup, users saw the
  // banner AND a flurry of "Simulation Error: 429 ... exceeded your
  // current quota" toasts for the same underlying issue, which they
  // correctly read as spam.
  //
  // Heuristic: if the banner is active, silently swallow any toast
  // whose text clearly describes the same class of failure (quota,
  // auth, rate-limit, or provider/HTTP wording). Real non-provider
  // errors (validation, runtime JS errors) still toast through.
  const lastErrorCount = useRef(0);
  useEffect(() => {
    if (sse.errors.length <= lastErrorCount.current) return;
    const newErrors = sse.errors.slice(lastErrorCount.current);
    lastErrorCount.current = sse.errors.length;
    const banner = sse.providerError;
    for (const err of newErrors) {
      if (banner && isRedundantProviderErrorToast(err, banner.kind)) {
        // Skip — the sticky banner already tells the user about this.
        continue;
      }
      const short = err.length > 120 ? err.slice(0, 120) + '...' : err;
      toast('error', 'Simulation Error', short);
    }
  }, [sse.errors, sse.providerError, toast]);

  // Narrative event/outcome toasts were removed. Event titles, descriptions,
  // and per-leader outcome verdicts are already shown in the sim flow column
  // and the stats bar. Surfacing them again as transient pop-ups produced
  // walls of jargon ("Safe Success", "Safe Failure") and narrative text
  // that read as alerts but carried no actionable signal. Toasts are now
  // reserved for operational UX only: save, load, clear, copy, launch,
  // launch-stalled, rate-limited, and simulation errors. The server's
  // `replay_done` SSE marker stays in place for future transient UX.

  // Chat handoff from the VIZ drilldown. Sets the URL hash so
  // ChatPanel can read it on mount or on hashchange, then switches
  // tabs. Hash survives the tab switch so preselection works even
  // though ChatPanel re-renders when the chat tab becomes active.
  const navigateToChat = useCallback((colonistName: string) => {
    window.location.hash = `chat=${encodeURIComponent(colonistName)}`;
    setActiveTab('chat');
  }, [setActiveTab]);

  const handleCopySummary = useCallback(() => {
    // Generalised to N actors. Pair runs render the existing two-actor
    // summary with an inline "Key Divergence" callout when both actors
    // share an event; cohort runs (3+ actors) render one section per
    // actor with no divergence note (pairwise divergence isn't
    // meaningful across N).
    const actorTitle = (scenario.labels.actorNoun ?? 'actor').replace(/^./, (c: string) => c.toUpperCase());
    const labels = deriveLabels(scenario);
    const lines: string[] = [
      `## ${scenario.labels.name} — Simulation Report`,
      `**Turns**: ${gameState.turn}/${gameState.maxTurns} | **Seed**: ${gameState.seed} | **${labels.Time}**: ${gameState.time}`,
    ];

    for (let i = 0; i < gameState.actorIds.length; i++) {
      const actorId = gameState.actorIds[i];
      const side = gameState.actors[actorId];
      // Use 1-based index for the fallback so cohorts past 26 actors
      // don't get non-letter ASCII characters where the slot letter
      // should go. Pair runs still read "Commander A / B" because the
      // ActorBar / leader-detail panels carry the alphabetic slot
      // label separately.
      const name = side?.leader?.name || `${actorTitle} ${i + 1}`;
      const archetype = side?.leader?.archetype || '';
      const unit = side?.leader?.unit || '';
      lines.push(
        '',
        `### ${name}${archetype ? ` (${archetype})` : ''}`,
        `Unit: ${unit} | Pop: ${side?.metrics?.population ?? '?'} | Morale: ${side?.metrics ? Math.round(side.metrics.morale * 100) : '?'}% | Deaths: ${side?.deaths ?? 0}`,
        `Tools forged: ${side?.tools ?? 0} | Citations: ${side?.citations ?? 0} | Decisions: ${side?.decisions ?? 0}`,
      );
    }

    if (gameState.actorIds.length === 2) {
      const a = gameState.actors[gameState.actorIds[0]];
      const b = gameState.actors[gameState.actorIds[1]];
      if (a?.event && b?.event && a.event.turn === b.event.turn) {
        lines.push('', '### Key Divergence');
        lines.push(`Same event "${a.event.title}" at T${a.event.turn}.`);
      }
    }

    lines.push('', `Generated by Paracosm (paracosm.sh)`);

    // A page with no clipboard (plain http at a network address) gets the
    // same failure toast as a refused one.
    writeClipboardText(lines.join('\n')).then(() => {
      toast('success', 'Copied', 'Simulation summary copied to clipboard.');
    }).catch(() => {
      toast('error', 'Copy Failed', 'Clipboard access denied.');
    });
  }, [gameState, scenario, toast]);

  // Sharable session id for the currently visible run. Two sources:
  //   1. The replay query param when the user landed via a share link.
  //   2. The latest `sim_saved` event with status='saved' from the
  //      server's autoSaveOnComplete pass.
  // Stays null until one of those exists so the TopBar's Share menu
  // item stays hidden for fresh / in-flight sims that haven't yet
  // produced a sharable id.
  const currentSessionId = replaySessionId ?? findLatestSavedSessionId(sse.events);

  // Copy a deep link that opens the current run on the viz tab. Used
  // for social shares (r/dataisbeautiful etc.) where viewers click
  // straight through to the swarm visualization with no upload step.
  // The note names one run's link: it goes when the run on screen is
  // another one or none (a new run, a cleared page, leaving a replay).
  useEffect(() => {
    clearShareLink();
  }, [currentSessionId, clearShareLink]);
  // A reset (RUN, Clear local data, clearing history) empties the page's
  // events and can keep the replay parameter, so the session id above
  // does not change; an empty page clears the note too.
  const pageHoldsEvents = sse.events.length > 0;
  useEffect(() => {
    if (!pageHoldsEvents) clearShareLink();
  }, [pageHoldsEvents, clearShareLink]);
  const handleShareViz = useCallback(() => {
    if (!currentSessionId) return;
    shareRunLink(buildReplayShareUrl(window.location.origin, currentSessionId, 'viz'));
  }, [currentSessionId, shareRunLink]);

  // App-level "launching" state: persists across tab navigation so the
  // user can submit /setup, switch to viz/chat/etc., come back to sim,
  // and still see the spinner instead of the empty-state Run button.
  // Local SimView state was being lost on unmount, which made the user
  // think nothing happened and click Run again.
  //
  // Initial value reads a localStorage handoff flag set by Quickstart
  // (and any other launch path that uses window.location.href to
  // navigate to /sim). Without this, a Quickstart Run → page reload →
  // /sim?tab=sim mount has launching=false, no events yet, and SSE
  // already connected → SimView falls into the empty Watch state for 2-5s while the server queues + emits the first
  // event. The flag clears in a useEffect once the first event lands
  // OR after a 30s safety timeout so a stuck launch doesn't pin the
  // spinner forever.
  const [launching, setLaunching] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem('paracosm:launchPending') === '1'; }
    catch { return false; }
  });

  // Accumulator for /chat turn cost + tokens. Folded into the run status bar's
  // `cost` prop so users see the real run-plus-chat total spend. Prior
  // behaviour: footer only counted simulation cost, chat turns billed
  // invisibly. Reset to zero whenever the sim event list empties —
  // that is the canonical "fresh session" signal (both handleClear and
  // fresh-mount routes through it).
  const [chatUsage, setChatUsage] = useState<{ totalTokens: number; costUSD: number; calls: number }>({
    totalTokens: 0,
    costUSD: 0,
    calls: 0,
  });
  const handleChatUsage = useCallback((usage: { totalTokens: number; costUSD: number }) => {
    setChatUsage(prev => ({
      totalTokens: prev.totalTokens + (usage.totalTokens || 0),
      costUSD: Math.round((prev.costUSD + (usage.costUSD || 0)) * 10000) / 10000,
      calls: prev.calls + 1,
    }));
  }, []);
  // Zero the chat-usage accumulator when the sim is cleared. Detecting
  // a clear via events.length going to zero keeps this decoupled from
  // the specific handleClear implementation — if Clear gains new side
  // effects or a new code path empties the buffer, chatUsage still
  // resets correctly without additional wiring.
  const prevEventsLenRef = useRef(sse.events.length);
  useEffect(() => {
    const prev = prevEventsLenRef.current;
    const curr = sse.events.length;
    prevEventsLenRef.current = curr;
    if (prev > 0 && curr === 0) {
      setChatUsage({ totalTokens: 0, costUSD: 0, calls: 0 });
    }
  }, [sse.events.length]);

  useLaunchState({
    launching,
    setLaunching,
    isRunning: gameState.isRunning,
    isComplete: sse.isComplete,
    sseStatus: sse.status,
    eventsCount: sse.events.length,
  });

  const [runStartedInPage, setUserTriggeredRun] = useState(false);
  // The hand-off and Settings launch both name the exact live run that may
  // show finish notices. A cold load, a saved replay or a replacement run
  // from another tab does not inherit that permission.
  const userTriggeredRun = runStartedInPage || (
    replaySessionId === null && launchedRunKey !== null && launchedRunKey === sse.runKey
  );

  // Handlers for the digital-twin intervention path: declared here so
  // setUserTriggeredRun is in scope.
  //
  // Start: fires the moment the user clicks "Run intervention demo".
  // We reset prior SSE state, follow the run's key so its events show
  // whichever scenario the run is in, switch to SIM immediately (so
  // streaming events from the server show up live), and park the prefilled
  // subject + intervention so DigitalTwinProgress can echo them. It returns
  // the reset's /clear, which the card awaits before it starts the run: a
  // /clear that landed after the run opened would stop it.
  //
  // Result: artifact landed, swap progress -> panel (single render
  // pass; the artifact carries subject + intervention so the panel
  // does not need the running payload).
  const handleInterventionStart = useCallback((payload: {
    runKey: string;
    subject: { id: string; name: string; profile?: Record<string, unknown> };
    intervention: { id: string; name: string; description: string; duration?: { value: number; unit: string } };
  }): Promise<void> => {
    const cleared = sse.reset();
    sse.followRun(payload.runKey);
    twinRunKeyRef.current = payload.runKey;
    twinResultKeyRef.current = null;
    setInterventionArtifact(null);
    setInterventionRunning(payload);
    setUserTriggeredRun(true);
    setActiveTab('sim');
    return cleared;
  }, [sse, setActiveTab]);
  const handleInterventionResult = useCallback((artifact: RunArtifact, runKey: string) => {
    if (runKey !== twinRunKeyRef.current) return;
    twinRunKeyRef.current = null;
    twinResultKeyRef.current = runKey;
    setInterventionRunning(null);
    setInterventionArtifact(artifact);
    setUserTriggeredRun(true);
    setActiveTab('sim');
  }, [setActiveTab]);
  const handleInterventionDismiss = useCallback(() => {
    twinRunKeyRef.current = null;
    twinResultKeyRef.current = null;
    setInterventionRunning(null);
    setInterventionArtifact(null);
    sse.leaveOwnRun();
  }, [sse]);
  // Answers whether the page took the failure: the failure of a run it has
  // left says nothing, here or on the Quickstart tab.
  const handleInterventionError = useCallback((message: string, runKey: string): boolean => {
    if (runKey !== twinRunKeyRef.current) return false;
    twinRunKeyRef.current = null;
    setInterventionRunning(null);
    sse.leaveOwnRun();
    toast('error', 'Digital twin failed', message);
    return true;
  }, [sse, toast]);
  const shownRunComplete = sse.isComplete && sse.finishRunKey === sse.runKey;
  // The verdict of the run the page shows. A fork that ran to its end has
  // none of its own: its banner says so, and `sse.verdict` stays its
  // parent's for Reports, the SIM tab and a saved file.
  const ownVerdict = sse.verdictRunKey === sse.runKey ? sse.verdict : null;
  const forkEnded = sse.forkOutcome !== null && sse.forkOutcome.runKey === sse.runKey;
  const shownRunVerdict = ownVerdict ?? (forkEnded ? FORK_ENDED : null);
  useTerminalToast({
    runKey: sse.runKey,
    isComplete: shownRunComplete,
    isAborted: sse.isAborted && sse.finishRunKey === sse.runKey,
    abortReason: sse.abortReason,
    resultsCount: sse.results.length,
    hasVerdict: Boolean(shownRunVerdict),
    replayDone: sse.replayDone,
    userTriggeredRun,
    verdict: shownRunVerdict,
  });

  // Local cache fallback: write completed runs to localStorage keyed
  // by scenario shortName so Library can show them even when
  // the server-side /sessions save was skipped (e.g. hosted container
  // lost the SQLite volume, or the run took a path that tripped one
  // of autoSaveOnComplete's guards). Dedup via the same fingerprint
  // the terminal-toast effect uses so a remount doesn't rewrite the
  // same data; bounded by the scenarioShortName key so switching
  // scenarios doesn't trample prior scenario caches.
  useEffect(() => {
    if (!shownRunComplete) return;
    if (sse.events.length === 0) return;
    const fingerprint = JSON.stringify([
      scenario.labels.shortName, sse.runKey ?? replaySessionId, sse.events.length, sse.isAborted, sse.provenance,
    ]);
    const storageKey = 'paracosm:lastCachedRunFingerprint';
    try {
      if (sessionStorage.getItem(storageKey) === fingerprint) return;
      sessionStorage.setItem(storageKey, fingerprint);
    } catch {
      /* silent */
    }
    history.push({
      events: sse.events,
      results: sse.results,
      verdict: sse.verdict,
      provenance: sse.provenance,
    });
  }, [
    sse.isComplete,
    sse.runKey,
    replaySessionId,
    sse.provenance,
    sse.isAborted,
    sse.events,
    sse.results,
    sse.verdict,
    scenario.labels.shortName,
    history,
  ]);

  useSimSavedToast({ savedEvent: sse.simSaved, runKey: sse.runKey, userTriggeredRun });

  // A Digital Twin can run in a different scenario and use its own event feed.
  const showsDigitalTwin = interventionRunning !== null || interventionArtifact !== null;
  // A twin the provider stopped, or a signal cancelled, returns its partial
  // artifact marked as the server marks its stream: aborted.
  const stoppedArtifact = interventionArtifact as (RunArtifact & { aborted?: unknown; providerError?: unknown }) | null;
  const twinStopped = stoppedArtifact !== null && (stoppedArtifact.aborted === true || !!stoppedArtifact.providerError);
  const runExists = sse.events.length > 0 || sse.isComplete || launching || showsDigitalTwin;
  const canRecoverVisitorKey = activeTab === 'sim'
    && replaySessionId === null
    && launchedRun?.usedVisitorKey === true
    && launchedRun.runKey === sse.runKey
    && sse.providerError?.kind === 'auth';
  // The status bar's spend is the run its progress shows: a Digital Twin's
  // own when the page shows one.
  const shownRunCost = (showsDigitalTwin ? interventionState : gameState).cost;
  const pairWatch = !showsDigitalTwin && gameState.actorIds.length === 2;
  const pairIdentity = pairWatch
    ? sse.runKey ?? (replaySessionId ? `replay:${replaySessionId}` : `recording:${sse.loadedRuns}`)
    : null;
  const pairTurns = useMemo(() => {
    if (!pairWatch) return [];
    const turns = new Set<number>();
    for (const id of gameState.actorIds) {
      for (const event of gameState.actors[id].events) {
        if (event.turn !== undefined && event.turn > 0) turns.add(event.turn);
      }
    }
    return [...turns].sort((a, b) => a - b);
  }, [gameState, pairWatch]);
  const stoppedPair = pairWatch && (gameState.isAborted || sse.isAborted);
  // Older saved streams can finish without sending a verdict or the live
  // feed's replay marker. Their recorded completion still ends playback.
  const pairEndReady = pairWatch && !stoppedPair && sse.isComplete &&
    Boolean(ownVerdict?.winner || ownVerdict?.skipped ||
      replaySessionId || sse.loadedRuns && !sse.runKey && sse.replayDone);
  const playhead = useRunPlayhead(pairIdentity, pairTurns, pairEndReady);
  const showStatusCost = activeTab !== 'sim' || !pairWatch || (launchedRun?.runKey === sse.runKey && launchedRun?.usedVisitorKey === true);
  const wipeServer = adminTokenSaved && serverAdminWrite === true ? handleWipeServer : undefined;

  return (
    <BranchesProvider>
    <DashboardNavigationContext.Provider value={navigateTab}>
     <RunStartContext.Provider value={showNewRun}>
      <ScenarioContext.Provider value={scenario}>
      <ScenarioReadyContext.Provider value={scenarioReady}>
      <ScenarioLoadContext.Provider value={scenarioLoad}>
       <CitationRegistryContext.Provider value={citationRegistry}>
        <ToolRegistryContext.Provider value={toolRegistry}>
        <RunExportProvenanceContext.Provider value={sse.provenance}>
        <ForgeViewProvider state={gameState} runKey={sse.runKey ?? null} sessionId={currentSessionId} showToolLog={showToolLog}>
        <BranchesSyncer sse={sse} />
        <div className={`scanline-overlay ${styles.shell} ${activeTab === 'viz' ? styles.vizShortScroll : ''}`}>
          {sse.providerError && !bannerDismissed ? (
            <ProviderErrorBanner
              providerError={sse.providerError}
              settingsKeyHref={canRecoverVisitorKey ? createSettingsKeyHref(window.location.href, sse.providerError?.provider) : undefined}
              onDismiss={() => setBannerDismissed(true)}
            />
          ) : null}
          {replaySessionId && sse.status === 'replay_not_found' ? (
            <ReplayNotFoundBanner replaySessionId={replaySessionId} />
          ) : null}
          {replaySessionId && sse.status !== 'replay_not_found' ? (
            <ReplayBanner replaySessionId={replaySessionId} />
          ) : null}
          <TopBar
            activeTab={activeTab}
            onTabChange={changeFrameTab}
            scenario={scenario}
            hasEvents={Object.values(gameState.actors).some(actor => actor.events.length > 0)}
            onSave={handleSave}
            onClear={handleClear}
            onWipeServer={wipeServer}
            onRunActionsOpen={handleRunActionsOpen}
            onHowItWorks={toggleHowItWorks}
            howItWorksOpen={howItWorksOpen}
            howItWorksKeyRef={howItWorksKeyRef}
            onCopy={handleCopySummary}
            onShareViz={currentSessionId ? handleShareViz : undefined}
            runExists={runExists}
          />
          {/* In the page's flow under the tabs, so it covers none of the top bar's keys. */}
          {shareLink.shared && (
            <ShareLinkNote shared={shareLink.shared} onClose={shareLink.clear} />
          )}
          {/* The banner and finish notices share the launch gate. */}
          {userTriggeredRun && !(activeTab === 'sim' && gameState.actorIds.length === 2) && (
            <VerdictBanner
              verdict={shownRunVerdict}
              runIdentity={shownRun}
              currentTurn={gameState.turn}
              maxTurns={gameState.maxTurns}
              dismissedKey={verdictDismissedKey}
              onOpenModal={() => setVerdictModalOpen(true)}
              onDismiss={setVerdictDismissedKey}
              onNavigateTab={setActiveTab}
            />
          )}

          <div className={styles.page} ref={pageRef}>
            <main
              id="main-content"
              // tabIndex={-1} so the skip link's #main-content anchor
              // actually translates focus into the main region. Without
              // this, browsers scroll to the target but leave focus on
              // the <a> itself, defeating the skip-link purpose.
              tabIndex={-1}
              className={styles.main}
              role="main"
              data-run-connection={sse.status}
              aria-label={TAB_NAMES[activeTab]}
            >
              {/* SR-only h1 anchors the heading hierarchy per tab. Sighted
                  users see the visible TabBar + view chrome; AT users
                  land on a real <h1> on every tab so the page outline
                  reads the tab name instead of "no h1 found".
                  Per-tab views can still emit their own h2/h3 for
                  section structure. */}
              {/* The Run tab's first screen shows its own visible h1, the
                  scenario's name, so the page keeps one h1 there. */}
              {activeTab !== 'quickstart' && <h1 className="sr-only">{TAB_NAMES[activeTab]}</h1>}
              {/* QuickstartView stays mounted across tab switches so an in-
                  flight compile/research/actors run survives navigation. The
                  handleSeedReady pipeline is a chain of long fetches (compile
                  up to 5 min on first-paste, ground-scenario, generate-actors,
                  /setup) that drive local Phase state via setState — unmount
                  during any of those would silently drop the user back on the
                  input form when they returned, even though the server-side
                  work was still in progress. Hidden via display:none + the
                  `hidden` attribute so the panel exits layout AND the a11y
                  tree on inactive tabs while preserving every promise + state
                  slot. ChatPanel uses the same pattern to keep per-agent
                  threads alive. */}
              <section
                id="tabpanel-quickstart"
                aria-label={TAB_NAMES.quickstart}
                hidden={activeTab !== 'quickstart'}
                // tabIndex={-1}: panel contains its own focusable
                // descendants (buttons, inputs, etc.), so per ARIA APG
                // we don't insert an extra Tab stop on the panel
                // itself. -1 keeps it programmatically focusable for
                // skip-link / future activation handlers.
                tabIndex={-1}
                className={activeTab === 'quickstart' ? styles.tabPanel : styles.tabPanelHidden}
              >
                <QuickstartView
                  entry={runEntry}
                  sse={sse}
                  sessionId={replaySessionId ?? undefined}
                  onRunStarted={leaveDigitalTwin}
                  showsDigitalTwin={showsDigitalTwin}
                  onInterventionStart={handleInterventionStart}
                  onInterventionResult={handleInterventionResult}
                  onInterventionError={handleInterventionError}
                />
              </section>

              {activeTab === 'sim' && (
                <section
                  id="tabpanel-sim"
                  aria-label={TAB_NAMES.sim}
                  // tabIndex={-1}: panel contains its own focusable
                  // descendants (buttons, inputs, etc.), so per ARIA APG
                  // we don't insert an extra Tab stop on the panel
                  // itself. -1 keeps it programmatically focusable for
                  // skip-link / future activation handlers.
                  tabIndex={-1}
                  className={styles.tabPanel}
                >
                  <SimView
                    state={gameState}
                    sseStatus={sse.status}
                    openReportTurn={openReportTurn}
                    playhead={playhead}
                    pairTurns={pairTurns}
                    stoppedPair={stoppedPair}
                    verdict={sse.verdict}
                    shownRun={shownRun}
                    launching={launching}
                    interventionArtifact={interventionArtifact}
                    interventionRunning={interventionRunning}
                    interventionState={interventionState}
                    onInterventionDismiss={handleInterventionDismiss}
                  />
                </section>
              )}

              {activeTab === 'viz' && (
                <section
                  id="tabpanel-viz"
                  aria-label={TAB_NAMES.viz}
                  // tabIndex={-1}: panel contains its own focusable
                  // descendants (buttons, inputs, etc.), so per ARIA APG
                  // we don't insert an extra Tab stop on the panel
                  // itself. -1 keeps it programmatically focusable for
                  // skip-link / future activation handlers.
                  tabIndex={-1}
                  className={styles.tabPanel}
                >
                  <SwarmViz key={shownRun} state={gameState} playhead={pairWatch ? playhead : undefined} stoppedPair={stoppedPair} isReplay={replaySessionId !== null} onNavigateToChat={navigateToChat} />
                </section>
              )}

              {activeTab === 'settings' && (
                <section
                  id="tabpanel-settings"
                  aria-label={TAB_NAMES.settings}
                  // tabIndex={-1}: panel contains its own focusable
                  // descendants (buttons, inputs, etc.), so per ARIA APG
                  // we don't insert an extra Tab stop on the panel
                  // itself. -1 keeps it programmatically focusable for
                  // skip-link / future activation handlers.
                  tabIndex={-1}
                  className={styles.tabPanel}
                >
                  <SettingsPanel
                    events={sse.events}
                    initialSubTab={settingsInitialSubTab}
                    onClearLocal={handleClear}
                    onWipeServer={wipeServer}
                    onOpenStoredData={handleRunActionsOpen}
                  />
                </section>
              )}

              {activeTab === 'reports' && (
                <section
                  id="tabpanel-reports"
                  aria-label={TAB_NAMES.reports}
                  // tabIndex={-1}: panel contains its own focusable
                  // descendants (buttons, inputs, etc.), so per ARIA APG
                  // we don't insert an extra Tab stop on the panel
                  // itself. -1 keeps it programmatically focusable for
                  // skip-link / future activation handlers.
                  tabIndex={-1}
                  className={styles.tabPanel}
                >
                  <ReportView state={gameState} verdict={sse.verdict} shownRun={shownRun} reportSections={scenario.ui.reportSections} />
                </section>
              )}

              {activeTab === 'library' && (
                <section
                  id="tabpanel-library"
                  aria-label={TAB_NAMES.library}
                  // tabIndex={-1}: panel contains its own focusable
                  // descendants (buttons, inputs, etc.), so per ARIA APG
                  // we don't insert an extra Tab stop on the panel
                  // itself. -1 keeps it programmatically focusable for
                  // skip-link / future activation handlers.
                  tabIndex={-1}
                  className={styles.tabPanel}
                >
                  <LibraryTab savedRuns={{
                    history: history.entries,
                    // A started run whose first frame has not come is open too.
                    runOpen: sse.events.length > 0 || launching,
                    runLive,
                    onRestore: (entry) => {
                      leaveDigitalTwin();
                      clearShareLink();
                      history.restore(entry, sse.loadEvents);
                      setActiveTab('sim');
                    },
                    onClear: () => {
                      history.clear();
                      persistence.clearCache();
                      leaveDigitalTwin();
                      void sse.reset();
                      setUserTriggeredRun(false);
                      setLaunchedRun(null);
                    },
                  }} />
                </section>
              )}

              {activeTab === 'studio' && (
                <section
                  id="tabpanel-studio"
                  aria-label={TAB_NAMES.studio}
                  // tabIndex={-1}: panel contains its own focusable
                  // descendants (buttons, inputs, etc.), so per ARIA APG
                  // we don't insert an extra Tab stop on the panel
                  // itself. -1 keeps it programmatically focusable for
                  // skip-link / future activation handlers.
                  tabIndex={-1}
                  className={styles.tabPanel}
                >
                  <StudioTab initialSubTab={studioInitialSubTab} onOpenRunFile={runLive ? undefined : handleLoad} />
                </section>
              )}

              {/* ChatPanel stays mounted across tab switches so per-agent
                  message threads survive when the user jumps to Sim / Reports
                  / Viz and comes back. ChatPanel owns the `threads` Map in
                  local state; unmounting on tab change dropped every
                  conversation the moment the user navigated away. Other tabs
                  (Sim, Viz, Settings, Reports, Log) have no user-generated
                  state at risk and stay on the unmount-on-switch pattern.

                  Hide path: `display: none` via .chatSurfaceHidden — that
                  alone removes the subtree from layout, the a11y tree, and
                  tab order. Do NOT switch to visibility/opacity hiding
                  without auditing chat input + send button focus order
                  (would create a hidden-but-focusable trap).

                  Keyed on the run the page shows (its key, or which run
                  loaded from a file or from history it is): a new run, the
                  same scenario with the same people included, mounts a fresh
                  panel, so no thread and no history from the last run shows
                  or goes to /chat. A reconnect replays the same key and keeps
                  the threads. */}
              <section
                id="tabpanel-chat"
                aria-label={TAB_NAMES.chat}
                tabIndex={-1}
                className={activeTab === 'chat' ? styles.chatSurfaceVisible : styles.chatSurfaceHidden}
              >
                {replaySessionId
                  ? <p>Start your own run to chat with its characters.</p>
                  : <ChatPanel key={shownRun} state={gameState} onChatUsage={handleChatUsage} />}
              </section>

              {/* LOG moved into SETTINGS as a sub-tab; EventLogPanel is now
                  rendered inside SettingsPanel when its sub-tab is 'log'. */}

              {/* About tab redirects to the landing page */}
            </main>
            <PageFoot />
          </div>
          {runExists && <RunStatusBar
            progress={{
              gameState: showsDigitalTwin ? interventionState : gameState,
              hideTrack: pairWatch && activeTab === 'sim',
              // The twin's progress counts the twin's own fallbacks.
              validationFallbacks: showsDigitalTwin && sse.ownRun ? sse.ownRun.validationFallbacks : sse.validationFallbacks,
            }}
            cost={showStatusCost ? {
              totalTokens: (shownRunCost?.totalTokens ?? 0) + chatUsage.totalTokens,
              totalCostUSD: Math.round(((shownRunCost?.totalCostUSD ?? 0) + chatUsage.costUSD) * 10000) / 10000,
              llmCalls: (shownRunCost?.llmCalls ?? 0) + chatUsage.calls,
            } : undefined}
            costBreakdown={{
              simUSD: shownRunCost?.totalCostUSD ?? 0,
              simCalls: shownRunCost?.llmCalls ?? 0,
              chatUSD: chatUsage.costUSD,
              chatCalls: chatUsage.calls,
            }}
            simStatus={{
              isRunning: showsDigitalTwin ? interventionRunning !== null : gameState.isRunning || launching,
              isComplete: showsDigitalTwin ? interventionArtifact !== null : sse.isComplete,
              isAborted: showsDigitalTwin ? twinStopped : sse.isAborted,
              connectionStatus: sse.status,
              abortReason: sse.abortReason,
              providerError: sse.providerError,
            }}
          />}
          {verdictModalOpen && sse.verdict && (
            <VerdictModal
              verdict={sse.verdict as Record<string, unknown>}
              onClose={() => setVerdictModalOpen(false)}
            />
          )}
          {loadFromUrl.pendingHost && (
            <LoadFromHostModal
              host={loadFromUrl.pendingHost}
              onLoad={loadFromUrl.confirmPending}
              onCancel={loadFromUrl.cancelPending}
            />
          )}
          {loadPreview.metadata && (
            <LoadPreviewModal
              metadata={loadPreview.metadata}
              showOverwriteWarning={sse.events.length > 0 && !replaySessionId}
              currentEventCount={sse.events.length}
              onConfirm={loadPreview.confirm}
              onCancel={loadPreview.cancel}
            />
          )}
          <DropZoneOverlay active={dropZone.isDragging} />
          <ShortcutsOverlay />
          <HowItWorksCard open={howItWorksOpen} onClose={closeHowItWorks} anchor={howItWorksKeyRef} />
        </div>
        </ForgeViewProvider>
        </RunExportProvenanceContext.Provider>
        </ToolRegistryContext.Provider>
       </CitationRegistryContext.Provider>
      </ScenarioLoadContext.Provider>
      </ScenarioReadyContext.Provider>
      </ScenarioContext.Provider>
     </RunStartContext.Provider>
    </DashboardNavigationContext.Provider>
    </BranchesProvider>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Paracosm] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.errorBoundary}>
          <div className={styles.errorTitle}>SIMULATION ERROR</div>
          <div className={styles.errorMessage}>{this.state.error.message}</div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className={styles.errorReload}
          >
            Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <RunTurnsProvider>
            <ServerFactsProvider>
              <AiWrittenPage><AppContent /></AiWrittenPage>
            </ServerFactsProvider>
          </RunTurnsProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
