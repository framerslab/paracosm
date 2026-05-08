/**
 * QuickstartView: orchestrates Input -> Progress -> Results.
 * Reads sse state via props + useBranchesContext for parent promotion.
 *
 * @module paracosm/dashboard/quickstart/QuickstartView
 */
import { useState, useCallback, useEffect } from 'react';
import { SeedInput } from './SeedInput';
import { InterventionDemoCard } from '../digital-twin/InterventionDemoCard';
import { CompareModal } from '../compare/CompareModal.js';
import { ReplayLastRunCTA } from './ReplayLastRunCTA';
import { QuickstartProgress, type Stage, type ActorProgress } from './QuickstartProgress';
import { QuickstartResults } from './QuickstartResults';
import type { ActorConfig, ScenarioPackage } from '../../../../../engine/types.js';
import type { RunArtifact } from '../../../../../engine/schema/index.js';
import type { LeaderPreset } from '../../../../../engine/leader-presets.js';
import type { SimEvent } from '../../hooks/useSSE';
import { useScenarioContext } from '../../App';
import { readKeyOverrides, readLastLaunchConfig, writeActiveRunActors } from '../../hooks/useLastLaunchConfig';
import { useToast } from '../shared/Toast';
import { resolveSetupRedirectHref } from '../../tab-routing';
import { compileScenarioWithPolling } from './compile-poll';
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
    isComplete: boolean;
    isAborted: boolean;
    errors: string[];
    reset: () => void;
  };
  sessionId?: string;
  /** Fires the moment the user clicks Generate so App.tsx can flip the
   *  user-triggered-run gate that controls the verdict banner + the
   *  terminal/sim-saved toasts. Without it, a Quickstart-started run
   *  is treated like a stale rehydration and its outputs stay hidden
   *  in the cross-tab views (VIZ, REPORTS, banner). */
  onRunStarted?: () => void;
  /** Forwarded to the InterventionDemoCard. When the digital-twin run
   *  completes, App.tsx receives the artifact, parks it in
   *  interventionArtifact state, and switches to the SIM tab so
   *  DigitalTwinPanel renders. */
  onInterventionResult?: (artifact: RunArtifact) => void;
  /** Fired the instant the user clicks Run inside InterventionDemoCard,
   *  before the fetch lands. App.tsx uses it to switch to SIM
   *  immediately so live SSE events from the run render in
   *  DigitalTwinProgress while the synchronous fetch is still in
   *  flight. Carries the prefilled subject + intervention. */
  onInterventionStart?: (payload: {
    subject: { id: string; name: string; profile?: Record<string, unknown> };
    intervention: { id: string; name: string; description: string; duration?: { value: number; unit: string } };
  }) => void;
}

type Phase =
  | { kind: 'input' }
  | { kind: 'progress'; stage: Stage; scenario?: ScenarioPackage; actors?: ActorConfig[] }
  | { kind: 'results'; scenario: ScenarioPackage; actors: ActorConfig[]; artifacts: RunArtifact[] };

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
    return 'Hosted demo is rate-limited (3 runs/day). Drop your own API key in Settings to bypass — your saved keys flow into the run automatically.';
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

export function QuickstartView({ sse, sessionId, onRunStarted, onInterventionResult, onInterventionStart }: QuickstartViewProps) {
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
   */
  const handleLoadedScenarioRun = useCallback(async (actorCount: number) => {
    setErrorBanner(null);
    onRunStarted?.();
    // Reset the local SSE buffer up front so the Progress panel never
    // shows leftover events from a prior run while this one ramps up.
    // The later sse.reset() right before the /setup fetch is kept as
    // belt-and-suspenders for the brief window when actor-generation
    // is still in flight.
    sse.reset();

    // Inherit the user's Settings-tab choices (API keys, provider,
    // model picks, economics profile) so the CTA respects what the
    // user configured and bypasses the hosted-demo rate limit when
    // their own keys are available. Mirrors how RerunPanel composes
    // the next-run body — the same /setup endpoint reads the same
    // field names (apiKey, anthropicKey, provider, models, economics).
    const overrides = typeof window !== 'undefined' ? readKeyOverrides(window.localStorage) : {};
    const lastLaunch = typeof window !== 'undefined' ? readLastLaunchConfig(window.localStorage) : null;
    const settingsSpread: Record<string, unknown> = {};
    if (overrides.openai) settingsSpread.apiKey = overrides.openai;
    if (overrides.anthropic) settingsSpread.anthropicKey = overrides.anthropic;
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

    const presetActors = scenario.presets[0]?.leaders ?? scenario.presets[0]?.actors ?? [];
    const presetCount = presetActors.length;

    // Fast path: scenario has enough presets to fill the requested
    // actor count. Skip compile + actor generation; post directly to
    // /setup with the preset's leader configs.
    if (presetCount >= actorCount) {
      setPhase({ kind: 'progress', stage: 'running' });
      const actors: ActorConfig[] = presetActors.slice(0, actorCount).map(p => ({
        name: p.name,
        archetype: p.archetype,
        // The scenario-payload preset's hexaco is a generic
        // `Record<string, number>`; the engine's HexacoProfile expects
        // named axes (openness/conscientiousness/etc.). Cast through
        // unknown — the runtime values are produced by the same
        // engine that consumes them, so the keys match by contract.
        hexaco: p.hexaco as unknown as ActorConfig['hexaco'],
        instructions: p.instructions,
      } as ActorConfig));
      sse.reset();
      // Persist the actors we're about to launch so the SIM header
      // carries names through the SSE connect-and-replay window. Compiled
      // scenarios ship no preset leaders, so without this fallback the
      // ActorBar renders the alphabetic placeholder until the status
      // event with `phase: 'parallel'` lands and useGameState pairs the
      // names against state.actorIds.
      if (typeof window !== 'undefined') {
        writeActiveRunActors(window.localStorage, actors);
      }
      try {
        const setupRes = await fetch('/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          throw new Error(body.error ?? `Setup failed: HTTP ${setupRes.status}`);
        }
        // /setup returns { redirect: '/sim', ... } so the dashboard
        // can navigate to the running simulation. Routing through
        // resolveSetupRedirectHref forces ?tab=sim onto the URL — a
        // bare /sim lands on the QUICKSTART tab (the URL parser's
        // default), which is exactly where the user just came from,
        // making the click look silently broken.
        const setupData = (await setupRes.json().catch(() => ({}))) as { redirect?: string };
        if (setupData.redirect) {
          // Hand off launching state across the page reload — App reads
          // this on mount so the Sim tab shows "Launching simulation..."
          // instead of the empty "No simulation running" state during
          // the 2-5s window between SSE connect and first event.
          try { window.localStorage.setItem('paracosm:launchPending', '1'); } catch { /* private mode */ }
          window.location.href = resolveSetupRedirectHref(window.location.href, setupData.redirect);
          return;
        }
      } catch (err) {
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
    setPhase({ kind: 'progress', stage: 'actors' });
    try {
      const actorsRes = await fetch('/api/quickstart/generate-actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id, count: actorCount }),
      });
      if (!actorsRes.ok) {
        const body = await actorsRes.json().catch(() => ({} as { error?: string }));
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
        throw new Error('Actor generation returned no actors');
      }
      setPhase({ kind: 'progress', stage: 'running' });

      sse.reset();
      if (typeof window !== 'undefined') {
        writeActiveRunActors(window.localStorage, actors);
      }
      const setupRes = await fetch('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        throw new Error(body.error ?? `Setup failed: HTTP ${setupRes.status}`);
      }
      const setupData = (await setupRes.json().catch(() => ({}))) as { redirect?: string };
      if (setupData.redirect) {
        // Mirror the preset fast-path: hand off launching state across
        // the page reload so the Sim tab shows "Launching simulation…"
        // instead of "No simulation running" during the SSE-connect window.
        try { window.localStorage.setItem('paracosm:launchPending', '1'); } catch { /* private mode */ }
        window.location.href = resolveSetupRedirectHref(window.location.href, setupData.redirect);
        return;
      }
    } catch (err) {
      setPhase({ kind: 'input' });
      const raw = (err as Error)?.message ?? String(err);
      const friendly = mapLaunchErrorToMessage(raw);
      setErrorBanner(friendly);
      toast('error', 'Launch failed', friendly, 8000);
    }
  }, [scenario, sse, onRunStarted, toast]);

  const handleSeedReady = useCallback(async (payload: { seedText: string; sourceUrl?: string; domainHint?: string; actorCount?: number }) => {
    setErrorBanner(null);
    // Flip the user-triggered-run gate before any UI changes so the
    // verdict banner + terminal/sim-saved toasts unlock for this
    // session. Symmetric with handleRun's setUserTriggeredRun(true)
    // in App.tsx.
    onRunStarted?.();
    // Clear local SSE buffer immediately. Without this, the
    // QuickstartProgress panel's "Run N simulations" stage card renders
    // any events still resident from a prior run while the new compile
    // is in flight — the user reported seeing 192 stale events labeled
    // with the prior run's actors before this fix.
    sse.reset();
    setPhase({ kind: 'progress', stage: 'compile' });
    try {
      // compileScenarioWithPolling encapsulates the async-job dance:
      // POST /compile-from-seed returns 202 + jobId, then we poll
      // /compile-from-seed/status every 2s. Cloudflare's 100s edge
      // timeout never fires because each individual response is
      // sub-second. The 5-min timeout in the helper covers the
      // worst-case slow compile; beyond that the server keeps the
      // resolved scenario in its 10-min TTL cache for a clean retry.
      const { scenario, scenarioId } = await compileScenarioWithPolling(payload);
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
        body: JSON.stringify({ scenarioId, count: requestedCount }),
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

      sse.reset();
      if (typeof window !== 'undefined') {
        writeActiveRunActors(window.localStorage, actors);
      }
      const setupRes = await fetch('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
      const setupData = (await setupRes.json().catch(() => ({}))) as { redirect?: string };
      if (setupData.redirect) {
        try { window.localStorage.setItem('paracosm:launchPending', '1'); } catch { /* private mode */ }
        window.location.href = resolveSetupRedirectHref(window.location.href, setupData.redirect);
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
        <>
          <header className={styles.header}>
            <h2>Quickstart</h2>
            <p>Paste a what-if scenario. Paracosm compiles it into a typed world and runs LLM-driven decision-makers with measurable personalities against it, returning a replayable trajectory you can fork and compare.</p>
            {/* Collapsed by default so the input form sits closer to the
                fold. First-time users open it for the glossary; repeat
                visitors keep it folded and skip the wall of definitions. */}
            <details className={styles.howItWorks}>
              <summary className={styles.howItWorksSummary}>How it works</summary>
              <ul className={styles.glossary} aria-label="Key terms">
                <li><strong>Scenario</strong> — the world Paracosm compiles from your prompt: departments, agents, events, starting state.</li>
                <li><strong>Actor</strong> — an LLM decision-maker driving the scenario, weighted by a HEXACO personality vector.</li>
                <li><strong>Run</strong> — one actor playing the scenario turn by turn. Paracosm runs N actors in parallel against the same world so you can compare divergent outcomes.</li>
              </ul>
              <p className={styles.timingHint}>
                <strong>Heads-up:</strong> a fresh run takes <strong>2-5 minutes</strong> (compile, ground with citations, generate actors, simulate). For instant results, replay a cached run below.
              </p>
            </details>
          </header>
          {errorBanner && <p className={styles.errorBanner} role="alert">{errorBanner}</p>}
          <ReplayLastRunCTA />
          <SeedInput
            onSeedReady={handleSeedReady}
            onLoadedScenarioRunStart={handleLoadedScenarioRun}
          />
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
              onError={(msg) => setErrorBanner(msg)}
            />
          )}
        </>
      )}
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
    </div>
  );
}
