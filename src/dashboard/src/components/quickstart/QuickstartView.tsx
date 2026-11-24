/**
 * QuickstartView: orchestrates Input -> Progress -> Results.
 * Reads sse state via props + useBranchesContext for parent promotion.
 *
 * @module paracosm/dashboard/quickstart/QuickstartView
 */
import { useState, useCallback, useEffect } from 'react';
import { InterventionDemoCard } from '../digital-twin/InterventionDemoCard';
import { CompareModal } from '../compare/CompareModal.js';
import { ReplayLastRunCTA } from './ReplayLastRunCTA';
import { RunFirstScreen } from './first-screen/RunFirstScreen';
import { PageFoot } from './first-screen/PageFoot';
import { presetLeadersForLaunch, type LoadedRunOptions } from './first-screen/effectiveLaunch';
import { QuickstartProgress, type Stage, type ActorProgress } from './QuickstartProgress';
import { QuickstartResults } from './QuickstartResults';
import type { ActorConfig, ScenarioPackage } from '../../../../engine/types.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';
import type { LeaderPreset } from '../../../../engine/presets/index.js';
import type { SimEvent } from '../../hooks/useSSE';
import { useScenarioContext } from '../../App';
import { keepActiveRunActors, readTabKeyOverrides, readLastLaunchConfig, writeActiveRunActors } from '../../hooks/useLastLaunchConfig';
import { useToast } from '../shared/Toast';
import { resolveSetupRedirectHref } from '../../tab-routing';
import { markRunLaunchHandoff } from '../../scenario-sync';
import { compileScenarioWithPolling } from './compile-poll';
import { sessionProviderKeys, visitorKeyTransportError } from '../settings/sessionProviderKeys';
import { atLimitAfter, atLimitReset } from './first-screen/words';
import styles from './QuickstartView.module.scss';

/** Shape returned by /api/quickstart/ground-scenario, surfaced to the
 *  Quickstart progress panel so the Research stage card can render
 *  real citation events instead of the legacy "folded into compile"
 *  placeholder. */
export type GroundingSummary =
  | { skipped: true; reason: string }
  | {
      citations: Array<{
        query: string;
        sources: Array<{ title: string; link: string; domain: string; provider?: string }>;
      }>;
      totalSources: number;
      durationMs: number;
      providersUsed?: string[];
      providersFailed?: Array<{ provider: string; reason: string }>;
    };

interface SseResultItem {
  leader: string;
  summary: Record<string, unknown>;
  fingerprint: Record<string, string> | null;
  artifact?: RunArtifact;
  actorIndex?: number;
}

export interface QuickstartViewProps {
  sse: {
    events: SimEvent[];
    results: SseResultItem[];
    verdict?: Record<string, unknown> | null;
    isComplete: boolean;
    isAborted: boolean;
    errors: string[];
    /** Clears the page's run and posts /clear; each launch awaits it, so the /clear lands before the run opens. */
    reset: () => void | Promise<void>;
  };
  sessionId?: string;
  /** Leaves the Digital Twin views at launch so a late twin result cannot
   *  navigate away while Quickstart prepares the run. */
  onRunStarted?: () => void;
  /** True while the SIM tab shows a Digital Twin's progress or result.
   *  The first screen's Start then leaves those views, and the page's
   *  events, as they are until the server takes the run it asks for: a run
   *  the server refuses replaces nothing. */
  showsDigitalTwin?: boolean;
  /** Forwarded to the InterventionDemoCard. When the digital-twin run
   *  completes, App.tsx receives the artifact, parks it in
   *  interventionArtifact state, and switches to the SIM tab so
   *  DigitalTwinPanel renders. The run's key comes with it, so App.tsx
   *  drops the answer of a run the page has left since. */
  onInterventionResult?: (artifact: RunArtifact, runKey: string) => void;
  /** Fired the instant the user clicks Run inside InterventionDemoCard,
   *  before the fetch lands. App.tsx uses it to switch to SIM
   *  immediately so live SSE events from the run render in
   *  DigitalTwinProgress while the synchronous fetch is still in
   *  flight. Carries the prefilled subject + intervention. */
  onInterventionStart?: (payload: {
    runKey: string;
    subject: { id: string; name: string; profile?: Record<string, unknown> };
    intervention: { id: string; name: string; description: string; duration?: { value: number; unit: string } };
  }) => void | Promise<void>;
  /** Fired when the digital-twin run fails. App.tsx ends the progress view
   *  the page is on by then, in the SIM tab, and says why there. It answers
   *  false for a run the page has left since, whose failure says nothing on
   *  this tab either. */
  onInterventionError?: (message: string, runKey: string) => boolean | void;
}

type Phase =
  | { kind: 'input' }
  | { kind: 'progress'; stage: Stage; scenario?: ScenarioPackage; actors?: ActorConfig[] }
  | { kind: 'results'; scenario: ScenarioPackage; actors: ActorConfig[]; artifacts: RunArtifact[] };

function handOffLaunch(redirect: string, runKey: unknown): void {
  // The receiving page uses the pending flag for the launch spinner and
  // the run key to show that run's verdict and notices when it finishes.
  try { window.localStorage.setItem('paracosm:launchPending', '1'); } catch { /* private mode */ }
  markRunLaunchHandoff(runKey);
  window.location.href = resolveSetupRedirectHref(window.location.href, redirect);
}

/**
 * Map a raw launch-error message (from /setup or /api/quickstart/*)
 * into actionable user-facing copy. Mirrors handleSeedReady's existing
 * mapping so the loaded-scenario CTA path produces the same friendly
 * messages instead of dumping raw stack traces / rate-limit JSON into
 * the error banner.
 */
function mapLaunchErrorToMessage(raw: string): string {
  if (/Failed to fetch|NetworkError|ERR_CONNECTION|ERR_NETWORK/i.test(raw)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/HTTP 502|HTTP 503|HTTP 504/.test(raw)) {
    return 'Server is temporarily unavailable (502/503/504). Try again in a moment.';
  }
  if (/HTTP 429|rate.?limit/i.test(raw)) {
    return `${atLimitReset()} ${atLimitAfter(false)}`;
  }
  if (/HTTP 401|HTTP 403|unauthor/i.test(raw)) {
    return 'Auth error talking to the LLM provider. Check your API key in Settings.';
  }
  if (/Two actors required|at least 2 actors/i.test(raw)) {
    return 'This scenario needs at least 2 actors. Bump the slider before launching.';
  }
  // Last-resort guard: never let a raw V8 TypeError or generic
  // reference error bleed into the user-facing banner. Internal-shape
  // failures ('Cannot read properties of null', 'undefined is not a
  // function', etc.) are developer-facing — a user seeing them can't
  // act on the message. Translate to actionable copy and keep the
  // raw text in the console for debugging.
  if (/TypeError|ReferenceError|Cannot read propert|is not a function|is not iterable/i.test(raw)) {
    if (typeof console !== 'undefined') console.error('[quickstart] launch error:', raw);
    return 'Something went wrong starting the run. Refresh the page and try again — if it keeps happening, drop a note in the GitHub issues with what you clicked just before.';
  }
  return raw;
}

export function QuickstartView({ sse, sessionId, onRunStarted, showsDigitalTwin = false, onInterventionResult, onInterventionStart, onInterventionError }: QuickstartViewProps) {
  const scenario = useScenarioContext();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  // Bundle id for the just-finished run; surfaced as a "Compare all N
  // actors" CTA on the results phase. Discovered by fetching the first
  // artifact's RunRecord (the RunRecord carries bundleId from /setup).
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  // Citations from the ground-scenario pass, set after compile + before
  // generate-actors. Forwarded into QuickstartProgress so the Research
  // stage card can render real citation events.
  const [groundingSummary, setGroundingSummary] = useState<GroundingSummary | null>(null);

  /**
   * One-click run path: when the user clicks LoadedScenarioCTA, run
   * the loaded scenario directly. With presets ≥ requested actorCount,
   * skip compile + actor-generation and post straight to /setup. With
   * fewer presets (or none), route through generate-actors first, then
   * /setup. The CTA stays visible in both cases; only the wait time
   * differs (~0s vs ~30s).
   *
   * The first screen's Start passes `opts`: the body it worked out, and
   * two callbacks. With them the first screen stays in view until the page
   * moves to the run: no progress panel, no toast and no banner. Each stage
   * (writing the leaders, starting) and each failed request (its status and
   * parsed answer, or no answer at all) goes to the callbacks, and the first
   * screen says it in its own words. Without `opts` nothing here changes.
   *
   * Start on a page that shows a Digital Twin keeps the twin until the
   * server takes the run: the twin's views stay, and the page's events are
   * not reset, so a run the server refuses replaces nothing. The run the
   * server takes replaces the visitor's run there, and the page load that
   * opens it leaves the twin.
   */
  const handleLoadedScenarioRun = useCallback(async (actorCount: number, opts?: LoadedRunOptions) => {
    setErrorBanner(null);
    // Inherit the user's Settings-tab choices (API keys, provider,
    // model picks, economics profile) so the CTA respects what the
    // user configured and bypasses the hosted-demo rate limit when
    // their own keys are available. Mirrors how RerunPanel composes
    // the next-run body — the same /setup endpoint reads the same
    // field names (apiKey, anthropicKey, provider, models, economics).
    const overrides = typeof window !== 'undefined' ? readTabKeyOverrides() : {};
    const lastLaunch = typeof window !== 'undefined' ? readLastLaunchConfig(window.localStorage) : null;
    // The provider keys as the server reads them: also sent to actor
    // generation, so the leaders are written on the visitor's key too.
    const providerKeys = sessionProviderKeys(overrides);
    const settingsSpread: Record<string, unknown> = { ...providerKeys };
    if (overrides.serper) settingsSpread.serperKey = overrides.serper;
    if (overrides.firecrawl) settingsSpread.firecrawlKey = overrides.firecrawl;
    if (overrides.tavily) settingsSpread.tavilyKey = overrides.tavily;
    if (overrides.cohere) settingsSpread.cohereKey = overrides.cohere;
    if (lastLaunch?.provider) settingsSpread.provider = lastLaunch.provider;
    if (lastLaunch?.models && typeof lastLaunch.models === 'object') {
      settingsSpread.models = lastLaunch.models;
    }
    if (lastLaunch?.economics && typeof lastLaunch.economics === 'object') {
      settingsSpread.economics = lastLaunch.economics;
    }

    const transportError = visitorKeyTransportError({ ...opts?.body, ...settingsSpread });
    if (transportError) {
      if (opts) opts.onFailure?.({ visitorKeyTransport: true });
      else setErrorBanner(transportError);
      return;
    }

    const keepsTwin = Boolean(opts) && showsDigitalTwin;
    if (!keepsTwin) {
      onRunStarted?.();
      // Reset the local SSE buffer up front so the Progress panel never
      // shows leftover events from a prior run while this one ramps up.
      // The later sse.reset() right before the /setup fetch is kept as
      // belt-and-suspenders for the brief window when actor-generation
      // is still in flight. Each reset is awaited: an unawaited /clear can
      // land after the /setup that follows and stop the new run.
      await sse.reset();
    }

    const presetActors = presetLeadersForLaunch(scenario, actorCount);
    const presetCount = presetActors.length;

    // Fast path: scenario has enough presets to fill the requested
    // actor count. Skip compile + actor generation; post directly to
    // /setup with the preset's leader configs.
    if (presetCount >= actorCount) {
      if (!opts) setPhase({ kind: 'progress', stage: 'running' });
      const actors = presetActors;
      if (!keepsTwin) await sse.reset();
      // Persist the actors we're about to launch so the SIM header
      // carries names through the SSE connect-and-replay window. Compiled
      // scenarios ship no preset leaders, so without this fallback the
      // ActorBar renders the alphabetic placeholder until the status
      // event with `phase: 'parallel'` lands and useGameState pairs the
      // names against state.actorIds. A launch the server refuses puts
      // back the leaders stored before it.
      let restoreActors: () => void = () => undefined;
      if (typeof window !== 'undefined') {
        restoreActors = keepActiveRunActors(window.localStorage);
        writeActiveRunActors(window.localStorage, actors, scenario.id);
      }
      opts?.onStage?.('starting');
      try {
        const setupRes = await fetch('/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts?.body ? { ...opts.body, actors } : {
            ...settingsSpread,
            actors,
            turns: scenario.setup.defaultTurns,
            seed: scenario.setup.defaultSeed ?? 42,
            captureSnapshots: true,
            quickstart: { scenarioId: scenario.id },
          }),
        });
        if (!setupRes.ok) {
          const body = await setupRes.json().catch(() => ({} as { error?: string }));
          if (opts) {
            restoreActors();
            opts.onFailure?.({ status: setupRes.status, body: body as Record<string, unknown> });
            return;
          }
          throw new Error(body.error ?? `Setup failed: HTTP ${setupRes.status}`);
        }
        // /setup returns { redirect: '/sim', ... } so the dashboard
        // can navigate to the running simulation. Routing through
        // resolveSetupRedirectHref forces ?tab=sim onto the URL — a
        // bare /sim lands on the QUICKSTART tab (the URL parser's
        // default), which is exactly where the user just came from,
        // making the click look silently broken.
        const setupData = (await setupRes.json().catch(() => ({}))) as { redirect?: string; runKey?: string };
        if (setupData.redirect) {
          handOffLaunch(setupData.redirect, setupData.runKey);
          return;
        }
        // An answer that opens no run is a run that did not start.
        restoreActors();
        opts?.onFailure?.({ status: setupRes.status, body: setupData as Record<string, unknown> });
      } catch (err) {
        restoreActors();
        if (opts) {
          opts.onFailure?.({ networkError: true });
          return;
        }
        setPhase({ kind: 'input' });
        const raw = (err as Error)?.message ?? String(err);
        const friendly = mapLaunchErrorToMessage(raw);
        setErrorBanner(friendly);
        // Toast on top of the banner so the user actually notices the
        // failure — banner alone is easy to miss when scrolled past.
        toast('error', 'Launch failed', friendly, 8000);
      }
      return;
    }

    // Fallback: scenario has fewer presets than requested. Use the
    // existing /api/quickstart/generate-actors endpoint with the
    // loaded scenario's id, then /setup.
    if (!opts) setPhase({ kind: 'progress', stage: 'actors' });
    opts?.onStage?.('writing', actorCount);
    // Set once the leaders are stored: a launch the server refuses puts back those stored before it.
    let restoreActors: () => void = () => undefined;
    try {
      const actorsRes = await fetch('/api/quickstart/generate-actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id, count: actorCount, ...providerKeys }),
      });
      if (!actorsRes.ok) {
        const body = await actorsRes.json().catch(() => ({} as { error?: string }));
        if (opts) {
          opts.onFailure?.({ status: actorsRes.status, body: body as Record<string, unknown>, request: 'leaders' });
          return;
        }
        throw new Error(body.error ?? `Actor generation failed: HTTP ${actorsRes.status}`);
      }
      const actorsData = (await actorsRes.json().catch(() => null)) as { actors?: ActorConfig[] } | null;
      const actors = actorsData?.actors;
      // Empty array is the only failure mode here. Single-actor runs
      // are valid (the CTA slider allows actorCount=1); /setup itself
      // enforces the >=2 rule for non-fork setups, so let it surface
      // that error if the user picked an invalid count rather than
      // pre-filtering valid 1-actor responses out at this layer.
      if (!actors || actors.length === 0) {
        if (opts) {
          opts.onFailure?.({ status: actorsRes.status, request: 'leaders' });
          return;
        }
        throw new Error('Actor generation returned no actors');
      }
      if (!opts) setPhase({ kind: 'progress', stage: 'running' });

      if (!keepsTwin) await sse.reset();
      if (typeof window !== 'undefined') {
        restoreActors = keepActiveRunActors(window.localStorage);
        writeActiveRunActors(window.localStorage, actors, scenario.id);
      }
      opts?.onStage?.('starting');
      const setupRes = await fetch('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts?.body ? { ...opts.body, actors } : {
          ...settingsSpread,
          actors,
          turns: scenario.setup.defaultTurns,
          seed: scenario.setup.defaultSeed ?? 42,
          captureSnapshots: true,
          quickstart: { scenarioId: scenario.id },
        }),
      });
      if (!setupRes.ok) {
        const body = await setupRes.json().catch(() => ({} as { error?: string }));
        if (opts) {
          restoreActors();
          opts.onFailure?.({ status: setupRes.status, body: body as Record<string, unknown> });
          return;
        }
        throw new Error(body.error ?? `Setup failed: HTTP ${setupRes.status}`);
      }
      const setupData = (await setupRes.json().catch(() => ({}))) as { redirect?: string; runKey?: string };
      if (setupData.redirect) {
        handOffLaunch(setupData.redirect, setupData.runKey);
        return;
      }
      restoreActors();
      opts?.onFailure?.({ status: setupRes.status, body: setupData as Record<string, unknown> });
    } catch (err) {
      restoreActors();
      if (opts) {
        opts.onFailure?.({ networkError: true });
        return;
      }
      setPhase({ kind: 'input' });
      const raw = (err as Error)?.message ?? String(err);
      const friendly = mapLaunchErrorToMessage(raw);
      setErrorBanner(friendly);
      toast('error', 'Launch failed', friendly, 8000);
    }
  }, [scenario, sse, onRunStarted, showsDigitalTwin, toast]);

  const handleSeedReady = useCallback(async (payload: { seedText: string; sourceUrl?: string; domainHint?: string; actorCount?: number }) => {
    setErrorBanner(null);
    // All three model calls in this flow use the same Settings keys.
    const providerKeys = sessionProviderKeys(readTabKeyOverrides());
    const transportError = visitorKeyTransportError(providerKeys);
    if (transportError) return transportError;
    onRunStarted?.();
    // Clear local SSE buffer immediately. Without this, the
    // QuickstartProgress panel's "Run N simulations" stage card renders
    // any events still resident from a prior run while the new compile
    // is in flight — the user reported seeing 192 stale events labeled
    // with the prior run's actors before this fix. Awaited, as every reset
    // before a launch is.
    await sse.reset();
    setPhase({ kind: 'progress', stage: 'compile' });
    try {
      // compileScenarioWithPolling encapsulates the async-job dance:
      // POST /compile-from-seed returns 202 + jobId, then we poll
      // /compile-from-seed/status every 2s. Cloudflare's 100s edge
      // timeout never fires because each individual response is
      // sub-second. The 5-min timeout in the helper covers the
      // worst-case slow compile; beyond that the server keeps the
      // resolved scenario in its 10-min TTL cache for a clean retry.
      // The visitor's own provider keys from Settings go to every step that
      // calls a model (the draft and its compile, the actors, the run), so
      // each runs on the visitor's key when they saved one.
      const { scenario, scenarioId } = await compileScenarioWithPolling({ ...payload, ...providerKeys });
      setPhase({ kind: 'progress', stage: 'research', scenario });
      // Real grounding pass: hits Serper for 3 derived queries, attaches
      // citations to the scenario's metadata server-side. Returns
      // { skipped: true } when SERPER_API_KEY is missing on the server,
      // in which case we just continue — the run isn't blocked by
      // missing grounding, only impoverished.
      try {
        const groundRes = await fetch('/api/quickstart/ground-scenario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenarioId }),
        });
        if (groundRes.ok) {
          const groundBody = await groundRes.json() as GroundingSummary;
          setGroundingSummary(groundBody);
        }
      } catch {
        // Network/parse error — surface nothing, still let the run continue.
        setGroundingSummary({ skipped: true, reason: 'request failed' });
      }
      setPhase({ kind: 'progress', stage: 'actors', scenario });

      // Honor the actor-count from the seed input; fall back to 2
      // because the dashboard's primary surface is the 2-actor side-by-
      // side comparison. The N-actor TurnGrid scales up cleanly via
      // horizontal scroll, so 3+ runs are first-class — the slider
      // default is just a sensible starting point. Server-side
      // GenerateActorsSchema clamps 1-300 (the cohort batch cap).
      const requestedCount = Math.max(1, Math.min(300, payload.actorCount ?? 2));
      const actorsRes = await fetch('/api/quickstart/generate-actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId, count: requestedCount, ...providerKeys }),
      });
      if (!actorsRes.ok) {
        const body = await actorsRes.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Actor generation failed: HTTP ${actorsRes.status}`);
      }
      const actorsBody = await actorsRes.json().catch(() => null) as { actors?: ActorConfig[] } | null;
      const actors = actorsBody?.actors;
      if (!actors || actors.length === 0) {
        throw new Error('Actor generation returned no actors');
      }
      setPhase({ kind: 'progress', stage: 'running', scenario, actors });

      await sse.reset();
      if (typeof window !== 'undefined') {
        writeActiveRunActors(window.localStorage, actors, scenarioId);
      }
      const setupRes = await fetch('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...providerKeys,
          actors,
          turns: scenario.setup.defaultTurns,
          seed: scenario.setup.defaultSeed ?? 42,
          captureSnapshots: true,
          quickstart: { scenarioId },
        }),
      });
      if (!setupRes.ok) {
        const body = await setupRes.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Setup failed: HTTP ${setupRes.status}`);
      }
      // Mirror the loaded-scenario CTA path: /setup returns
      // { redirect: '/sim', ... } so the dashboard can navigate to the
      // running simulation. Without this, handleSeedReady left the user
      // on Quickstart staring at the Progress panel until SSE results
      // landed; the loaded-scenario CTA already navigates so the two
      // entry points must behave the same way.
      const setupData = (await setupRes.json().catch(() => ({}))) as { redirect?: string; runKey?: string };
      if (setupData.redirect) {
        handOffLaunch(setupData.redirect, setupData.runKey);
        return;
      }
    } catch (err) {
      setPhase({ kind: 'input' });
      const raw = (err as Error)?.message ?? String(err);
      const friendly = mapLaunchErrorToMessage(raw);
      setErrorBanner(friendly);
      toast('error', 'Quickstart failed', friendly, 8000);
    }
  }, [sse, onRunStarted, toast]);

  // Transition to results when all expected artifacts arrive.
  useEffect(() => {
    if (phase.kind !== 'progress' || phase.stage !== 'running') return;
    if (!phase.scenario || !phase.actors) return;
    const artifacts = sse.results
      .map(r => r.artifact)
      .filter((a): a is RunArtifact => !!a);
    if (artifacts.length >= phase.actors.length) {
      setPhase({
        kind: 'results',
        scenario: phase.scenario,
        actors: phase.actors,
        artifacts: artifacts.slice(0, phase.actors.length),
      });
    }
  }, [sse.results, phase]);

  // After results arrive, look up the bundleId for the first artifact
  // so the "Compare all N actors" CTA can open the CompareModal scoped
  // to this Quickstart submission. The first runId is enough — every
  // artifact in this submission shares the same bundleId.
  useEffect(() => {
    if (phase.kind !== 'results') return;
    if (bundleId !== null) return;
    const firstRunId = phase.artifacts[0]?.metadata?.runId;
    if (!firstRunId) return;
    let cancelled = false;
    fetch(`/api/v1/runs/${encodeURIComponent(firstRunId)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ record?: { bundleId?: string } }>;
      })
      .then((body) => {
        if (cancelled) return;
        const id = body?.record?.bundleId;
        if (id) setBundleId(id);
      })
      .catch(() => { /* CTA stays hidden if lookup fails; UX degrades gracefully */ });
    return () => { cancelled = true; };
  }, [phase, bundleId]);

  // Derive per-actor progress from SSE events for the running phase.
  const actorProgress: ActorProgress[] | undefined =
    phase.kind === 'progress' && phase.stage === 'running' && phase.actors
      ? phase.actors.map((a, i) => {
          const lastTurn = sse.events
            .filter(e => e.type === 'turn_done' || e.type === 'turn_start')
            .reduce((max, e) => {
              const t = (e.data as { turn?: number } | null | undefined)?.turn ?? 0;
              return t > max ? t : max;
            }, 0);
          const result = sse.results.find(r => r.actorIndex === i);
          const errored = sse.errors.length > 0 && !result;
          const status: ActorProgress['status'] = errored
            ? 'error'
            : sse.isAborted
              ? 'aborted'
              : result
                ? 'complete'
                : 'running';
          return {
            name: a.name,
            archetype: a.archetype,
            currentTurn: result ? (phase.scenario?.setup.defaultTurns ?? lastTurn) : lastTurn,
            maxTurns: phase.scenario?.setup.defaultTurns ?? 6,
            status,
          };
        })
      : undefined;

  const handleSwap = useCallback((actorIndex: number, preset: LeaderPreset) => {
    // MVP: swap points users at the Branches Fork flow for now.
    // v1.1 will wire this to a single-actor /setup POST that reruns
    // just that card in place.
    void actorIndex; void preset;
    setErrorBanner('Actor swap rerun is a v1.1 follow-up. Use "Fork in Branches" on the Branches tab to try a preset actor against this run.');
  }, []);

  return (
    <div className={styles.view}>
      {phase.kind === 'input' && (
        <RunFirstScreen onStart={handleLoadedScenarioRun} onSeedReady={handleSeedReady}>
          {errorBanner && <p className={styles.errorBanner} role="alert">{errorBanner}</p>}
          <ReplayLastRunCTA />
          {/* Digital-twin demo lives BELOW the seed input as a
              secondary path. Quickstart's primary use case is
              compile-a-scenario + run-three-actors; the dt card is a
              one-click "or test a single subject under one
              intervention" affordance. The dt section on the landing
              page is the dedicated showcase for the digital-twin
              import path. */}
          {onInterventionResult && (
            <InterventionDemoCard
              onResult={onInterventionResult}
              onRunStart={onInterventionStart}
              onError={(msg, runKey) => {
                // The failure of a twin run the page has left says nothing.
                if (onInterventionError?.(msg, runKey) === false) return;
                setErrorBanner(msg);
              }}
            />
          )}
        </RunFirstScreen>
      )}
      {/* The first screen's h1 is the scenario's name; while a run starts
          or shows its results, the tab's name is the page's h1. */}
      {phase.kind !== 'input' && <h1 className="sr-only">Run</h1>}
      {phase.kind === 'progress' && (
        <QuickstartProgress
          stage={phase.stage}
          actors={actorProgress}
          events={sse.events}
          actorCount={phase.actors?.length ?? actorProgress?.length ?? 2}
          groundingSummary={groundingSummary}
        />
      )}
      {phase.kind === 'results' && (
        <>
          {errorBanner && <p className={styles.errorBanner} role="alert">{errorBanner}</p>}
          {bundleId && phase.artifacts.length >= 2 && (
            <button
              type="button"
              className={styles.compareCta}
              onClick={() => setCompareOpen(true)}
              aria-label={`Compare all ${phase.artifacts.length} actors side-by-side`}
            >
              Compare all {phase.artifacts.length} actors →
            </button>
          )}
          <QuickstartResults
            actors={phase.actors}
            artifacts={phase.artifacts}
            verdict={sse.results.some(result => result.artifact?.metadata.runId === phase.artifacts[0]?.metadata.runId)
              ? sse.verdict : null}
            sessionId={sessionId}
            onSwap={handleSwap}
          />
          {bundleId && compareOpen && (
            <CompareModal
              bundleId={bundleId}
              open
              onClose={() => setCompareOpen(false)}
            />
          )}
        </>
      )}
      {/* The first screen ends in its own foot; while a run starts or shows
          its results, the same foot ends the tab. */}
      {phase.kind !== 'input' && <PageFoot />}
    </div>
  );
}
