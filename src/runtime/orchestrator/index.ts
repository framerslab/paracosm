import { writeRunOutput } from '../output-writer.js';
import { buildRunArtifact } from '../build-artifact.js';
import type {
  Decision,
  InterventionConfig,
  RunArtifact,
  SubjectConfig,
} from '../../engine/schema/index.js';
import type { ITool } from '@framers/agentos';
import {
  createWebSearchTool,
  createEmergentEngine,
  createCallForgedTool,
  wrapForgeTool,
  type CapturedForge,
} from './emergent-setup.js';
import {
  humanizeToolName,
  emptyReport,
  emptyDecision,
  decisionToPolicy,
} from '../parsers.js';
import { sendAndValidate } from '../../llm/sendAndValidate.js';
import { DepartmentReportSchema } from '../validators/department.js';
import { CommanderDecisionSchema } from '../validators/commander.js';
import { createCostTracker } from '../cost-tracker.js';
import {
  buildPersonalityCue,
  buildCommanderBootstrap,
  runDepartmentPromotions,
} from './commander-setup.js';
import { buildAvailableToolsBlock, buildForgedToolbox, type ForgedLedger } from './tool-ledger.js';
import { buildCitationCatalog } from '../citations-catalog.js';
import type { Department, HexacoProfile, HexacoSnapshot, TurnOutcome } from '../../engine/core/state.js';
import { SeededRng } from '../../engine/core/rng.js';
import { classifyOutcome, classifyOutcomeById, driftCommanderHexaco } from '../../engine/core/progression.js';
import { buildTrajectoryCue } from '../agents/cues/hexaco/trajectory.js';
import { buildTrajectoryCue as buildTrajectoryCueGeneric, type TraitProfileSnapshot } from '../agents/cues/trait/trajectory.js';
import { normalizeActorConfig, traitsToHexaco } from '../../engine/traits/normalize-leader.js';
import { traitModelRegistry, type TraitProfile } from '../../engine/traits/index.js';
import { driftLeaderProfile } from '../../engine/traits/drift.js';
import type { DepartmentReport, CommanderDecision, TurnArtifact } from '../contracts.js';
import { SimulationKernel } from '../../engine/core/kernel.js';
import type { KeyPersonnel } from '../../engine/core/agent-generator.js';
import { getResearchPacket } from '../research/research.js';
import { getResearchFromBundle } from '../research/scenario-research.js';
import { initResearchMemory, recallResearch, closeResearchMemory } from '../research/research-memory.js';
import { buildDepartmentContext, getDepartmentsForTurn } from './departments.js';
import { EventDirector, type DirectorEvent, type DirectorContext } from './director.js';
import { runReactionStep } from './reaction-step.js';
import type { ScenarioPackage } from '../../engine/types.js';
import type { LlmProvider, SimulationModelConfig } from '../../engine/types.js';
import {
  DEFAULT_EXECUTION,
  resolveSimulationModels,
  type CostPreset,
  type SimulationExecutionConfig,
  type StartingPolitics,
  type StartingResources,
} from '../../cli/sim-config.js';
import { resolveProviderWithFallback } from '../../engine/provider/resolver.js';
import {
  apiKeyForProvider,
  resolveProviderFromCredentials,
  type RuntimeCredentialOptions,
} from '../../engine/provider/credentials.js';
import { applyCustomEventToCrisis, buildTimeSchedule } from '../runtime-helpers.js';
import { classifyProviderError, shouldAbortRun, type ClassifiedProviderError } from '../provider-errors.js';
import { EffectRegistry } from '../../engine/registries/effects.js';
import { marsScenario } from '../../engine/scenarios/index.js';
import type { ActorConfig } from '../../engine/types.js';
import type { ResolvedEconomicsProfile } from '../economics-profile.js';
import { projectSystemBags } from '../world-snapshot.js';
export type { ActorConfig };



// ---------------------------------------------------------------------------
// SimEvent — public type for the `onEvent` callback
// ---------------------------------------------------------------------------

/**
 * Universal fields spread onto every emitted event's `data` payload,
 * regardless of event type. `summary` is the "just works" one-liner for
 * casual logging (`console.log(e.type, e.data.summary)` always yields
 * something readable). `_cost` is internal book-keeping the dashboard
 * uses for a live cost counter; consumers that need the breakdown should
 * read it off the returned `result.cost` instead.
 */
export interface SimEventCostPayload {
  /**
   * Short human-readable one-liner describing what this event represents
   * (e.g. `"dust storm (natural_disaster)"` for event_start,
   * `"medical: forged radiation_calc"` for forge_attempt). Populated by
   * the runtime on every emit — consumers can rely on it being present.
   * Prefer this over per-type field access when you just want a log line.
   */
  summary: string;
  _cost?: unknown;
}

/**
 * Per-event-type data shapes. The discriminated `SimEvent` union below
 * maps each `type` to its payload so `onEvent` handlers get proper
 * type-narrowing: `if (e.type === 'event_start') e.data.title` compiles
 * without `as any` or optional chaining through `unknown`.
 *
 * Each payload documents the fields the runtime actually writes; fields
 * marked optional are conditionally populated (milestone vs emergent
 * events, degraded vs healthy paths, etc.). Adding a new field to a
 * payload is non-breaking; removing or renaming one is.
 */
export interface SimEventPayloadMap {
  /** Fires once at the start of every turn. Title/crisis carry the first event's headline when `totalEvents > 0`. */
  turn_start: {
    title: string;
    crisis?: string;
    category?: string;
    births?: number;
    deaths?: number;
    metrics?: Record<string, number>;
    emergent?: boolean;
    turnSummary?: string;
    totalEvents?: number;
    pacing?: unknown;
  };
  /** Fires before each event within a turn. One turn can carry multiple events (up to `maxEventsPerTurn`). */
  event_start: {
    eventIndex: number;
    totalEvents: number;
    title: string;
    description?: string;
    category: string;
    emergent?: boolean;
    turnSummary?: string;
    pacing?: unknown;
  };
  /** Department agent starts analyzing an event. `department` is the scenario-defined id. */
  specialist_start: { department: string; eventIndex: number };
  /** Department finished analyzing. `citationList` is truncated to 5; full list lives on the returned report. */
  specialist_done: {
    department: string;
    summary: string;
    eventIndex: number;
    citations: number;
    citationList: Array<{ text: string; url: string; doi?: string }>;
    risks: string[];
    forgedTools: unknown[];
    recommendedActions?: string[];
  };
  /** A department tried to forge a runtime tool. `approved` reflects the LLM-judge verdict. */
  forge_attempt: {
    department: string;
    name: string;
    description?: string;
    mode?: string;
    approved: boolean;
    confidence: number;
    inputFields: string[];
    outputFields: string[];
    errorReason?: string;
    timestamp: string;
    eventIndex?: number;
  };
  /** Commander is about to read department reports and pick an option. */
  decision_pending: { eventIndex: number };
  /** Commander picked. `reasoning` is the full CoT; `rationale` is the compressed version. */
  decision_made: {
    decision: string;
    rationale: string;
    reasoning: string;
    selectedPolicies: unknown[];
    selectedOptionId?: string;
    eventIndex: number;
  };
  /** Outcome classification + numerical deltas applied to the metrics state bag. */
  outcome: {
    outcome: 'risky_success' | 'risky_failure' | 'conservative_success' | 'conservative_failure' | string;
    category: string;
    emergent: boolean;
    systemDeltas: Record<string, number>;
    eventIndex: number;
  };
  /** Per-turn HEXACO drift for promoted agents + the commander. */
  personality_drift: { agents: Record<string, { name: string; hexaco: Record<string, number> }>; commander: unknown };
  /** Rollup of ~100 agent reactions for the turn (sliced preview only; full list on result). */
  agent_reactions: { reactions: unknown[]; moodSummary?: unknown };
  /** Social-media-style per-turn posts from featured agents. */
  bulletin: { posts: unknown[] };
  /** End of turn. Carries applied deltas + cumulative tool count + death-cause breakdown when relevant. */
  turn_done: {
    metrics: Record<string, number>;
    statuses?: Record<string, string | boolean>;
    environment?: Record<string, number | string | boolean>;
    toolsForged: number;
    totalEvents?: number;
    deathCauses?: Record<string, number>;
    error?: string;
  };
  /** Department-head promotion at turn 0. One per department. */
  promotion: { agentId: string; department: string; role: string; reason?: string };
  /** Full roster snapshot used by the dashboard cellular-automata viz. */
  systems_snapshot: {
    agents: unknown[];
    population: number;
    morale: number;
    foodReserve: number;
    births: number;
    deaths: number;
  };
  /** Terminal provider failure (invalid key, quota, classified auth error). The run aborts at the next turn. */
  provider_error: {
    kind: 'auth' | 'quota' | 'rate_limit' | 'network' | 'unknown';
    provider?: string;
    message: string;
    actionUrl?: string;
    site: string;
  };
  /** Non-terminal: a schema-validated call exhausted retries and returned the fallback skeleton. Run continues degraded. */
  validation_fallback: { site: string; schemaName?: string; rawTextPreview: string; error: string };
  /** Run was cancelled via `signal.abort()` (or the server's disconnect watchdog). Partial results preserved. */
  sim_aborted: {
    reason: string;
    completedTurns: number;
    metrics: Record<string, number>;
    toolsForged: number;
  };
}

/** Union of all event type strings emitted by `runSimulation`. */
export type SimEventType = keyof SimEventPayloadMap;

/**
 * A single event delivered to the `onEvent` callback during a simulation.
 *
 * Discriminated on `type`: `if (e.type === 'event_start') { e.data.title }`
 * compiles with full field-level intellisense. The runtime also spreads a
 * `_cost` book-keeping payload onto every event for the live-cost counter;
 * treat that as internal and read cost from the returned `result.cost`
 * instead.
 *
 * @example
 * ```typescript
 * const output = await runSimulation(leader, [], {
 *   scenario, maxTurns: 8, seed: 42,
 *   onEvent(e) {
 *     if (e.type === 'event_start') console.log('crisis:', e.data.title, e.data.category);
 *     if (e.type === 'outcome')     console.log('resolved:', e.data.outcome);
 *     if (e.type === 'turn_done')   console.log('T' + e.turn, 'complete');
 *   },
 * });
 * ```
 */
export type SimEvent = {
  [K in SimEventType]: {
    type: K;
    leader: string;
    turn?: number;
    time?: number;
    data: SimEventPayloadMap[K] & SimEventCostPayload;
  };
}[SimEventType];

/**
 * Build a human-readable one-liner for an event, used as the universal
 * `summary` field on every emitted event's `data`. Centralized here so
 * all 17 event types render a consistent shape and casual consumers can
 * rely on `e.data.summary` being present and informative.
 *
 * Kept intentionally short (< ~120 chars) so it fits in a log line
 * without forcing a wrap. Longer detail is still available on the
 * type-narrowed per-event payload fields (`e.data.description`,
 * `e.data.reasoning`, etc.).
 */
export function buildEventSummary(type: SimEventType, data: Record<string, unknown>): string {
  const trunc = (s: unknown, n = 80): string => {
    const str = String(s ?? '');
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  };
  const d = data;
  switch (type) {
    case 'turn_start': {
      const title = trunc(d.title, 60);
      return title ? `turn starting: ${title}` : 'turn starting';
    }
    case 'event_start': {
      const title = trunc(d.title, 60);
      const cat = d.category ? ` (${d.category})` : '';
      return `event: ${title}${cat}`;
    }
    case 'specialist_start':
      return `${d.department ?? 'department'} analyzing`;
    case 'specialist_done': {
      const s = trunc(d.summary, 80);
      return `${d.department ?? 'department'} report: ${s}`;
    }
    case 'forge_attempt': {
      const verb = d.approved === true ? 'forged' : 'rejected';
      return `${d.department ?? 'department'} ${verb} ${d.name ?? 'tool'}`;
    }
    case 'decision_pending':
      return 'commander deciding';
    case 'decision_made':
      return `commander decided: ${trunc(d.decision, 80)}`;
    case 'outcome': {
      const cat = d.category ? ` (${d.category})` : '';
      return `outcome: ${d.outcome ?? 'unknown'}${cat}`;
    }
    case 'personality_drift':
      return 'hexaco drift';
    case 'agent_reactions': {
      const n = Array.isArray(d.reactions) ? d.reactions.length : 0;
      return `${n} agent reaction${n === 1 ? '' : 's'}`;
    }
    case 'bulletin': {
      const n = Array.isArray(d.posts) ? d.posts.length : 0;
      return `bulletin: ${n} post${n === 1 ? '' : 's'}`;
    }
    case 'turn_done': {
      const metrics = d.metrics as { population?: number; morale?: number } | undefined;
      const pop = metrics?.population;
      const mor = metrics?.morale;
      if (pop != null && mor != null) {
        return `turn complete — pop ${pop}, morale ${Math.round(Number(mor) * 100)}%`;
      }
      if (d.error) return `turn complete (error: ${trunc(d.error, 60)})`;
      return 'turn complete';
    }
    case 'promotion':
      return `promoted: ${d.role ?? 'role'} (${d.department ?? 'dept'})`;
    case 'systems_snapshot': {
      const pop = d.population;
      const mor = d.morale != null ? Math.round(Number(d.morale) * 100) : null;
      return pop != null && mor != null
        ? `snapshot: pop ${pop}, morale ${mor}%`
        : 'snapshot';
    }
    case 'provider_error':
      return `provider error (${d.kind ?? 'unknown'}): ${trunc(d.message, 80)}`;
    case 'validation_fallback':
      return `schema fallback: ${d.schemaName ?? 'unknown'}`;
    case 'sim_aborted':
      return `aborted: ${d.reason ?? 'unknown'}`;
    default: {
      // Exhaustiveness guard: if a new SimEventType is added above without
      // a case here, TypeScript will flag `type` as not assignable to
      // `never` in strict mode. The runtime fallback keeps casual logging
      // readable even if the compile-time check is bypassed.
      const _exhaustive: never = type;
      return String(_exhaustive);
    }
  }
}

export interface RunOptions extends RuntimeCredentialOptions {
  maxTurns?: number;
  seed?: number;
  startTime?: number;
  timePerTurn?: number;
  liveSearch?: boolean;
  activeDepartments?: Department[];
  provider?: LlmProvider;
  onEvent?: (event: SimEvent) => void;
  customEvents?: Array<{ turn: number; title: string; description: string }>;
  models?: Partial<SimulationModelConfig>;
  /**
   * When true, the orchestrator captures a {@link KernelSnapshot} at
   * the end of every turn and stashes the resulting array under
   * `artifact.scenarioExtensions.kernelSnapshotsPerTurn`. Enables
   * `WorldModel.forkFromArtifact()` on the returned artifact. Default
   * false so normal runs stay lean; snapshots add ~100 KB per turn
   * for 100-agent Mars-shape runs.
   */
  captureSnapshots?: boolean;
  /**
   * Internal-only: `WorldModel.fork()` sets this to thread the
   * `{ parentRunId, atTurn }` link onto the child run's
   * `metadata.forkedFrom`. Not part of the public API; callers should
   * use `WorldModel.fork()` rather than setting this directly.
   */
  _forkedFrom?: { parentRunId: string; atTurn: number };
  /**
   * Internal-only: `WorldModel.fork()` sets this to a
   * {@link KernelSnapshot} that the orchestrator restores before
   * running the first turn. Not part of the public API.
   */
  _resumeFrom?: import('../../engine/core/snapshot.js').KernelSnapshot;
  /**
   * Cost-vs-quality switch for model routing. Defaults to `'quality'`
   * which keeps department agents on the flagship tier (gpt-5.4 /
   * claude-sonnet-4-6) for reliable tool forging — ~$1-3 per 6-turn run
   * on OpenAI. Set to `'economy'` to drop every role to mid/cheap
   * (gpt-4o departments, gpt-5.4-nano everything else; haiku on
   * Anthropic) — ~$0.20-0.60 per 6-turn run on OpenAI, ~5-10× cheaper.
   *
   * Economy mode drops forge approval rate by roughly 10-20pp because
   * the mid-tier model occasionally violates structured-output schemas
   * the judge rejects. Use it for quick iteration / debugging / CI;
   * use `'quality'` (default) for publishable or production runs.
   *
   * Explicit `models` entries always win over the preset, so you can
   * mix and match: `{ costPreset: 'economy', models: { departments:
   * 'gpt-5.4' } }` gives you cheap everything except departments.
   */
  costPreset?: CostPreset;
  economics?: ResolvedEconomicsProfile;
  initialPopulation?: number;
  startingResources?: StartingResources;
  startingPolitics?: StartingPolitics;
  startingStatuses?: Record<string, string | boolean>;
  startingEnvironment?: Record<string, number | string | boolean>;
  execution?: Partial<SimulationExecutionConfig>;
  scenario?: ScenarioPackage;
  /**
   * Cancellation signal. When `.aborted` flips to true, the turn loop
   * short-circuits at the next turn boundary, emits a `sim_aborted`
   * event, and returns the partial result accumulated so far.
   *
   * Server wires this to an AbortController that fires after a grace
   * period of zero connected SSE clients, so a user who closes the tab
   * or navigates away stops billing for new LLM calls while preserving
   * the partial results they already accumulated in the event buffer.
   */
  signal?: AbortSignal;
  /**
   * Subject being simulated (digital-twin person, game character,
   * etc.). Passed through verbatim to `RunArtifact.subject`.
   * Turn-loop mode does not consume this semantically; future
   * batch-trajectory executor will.
   */
  subject?: SubjectConfig;
  /**
   * Intervention being tested on the subject. Passed through verbatim to
   * `RunArtifact.intervention`. Turn-loop ignores; batch modes consume.
   */
  intervention?: InterventionConfig;
}

export async function runSimulation(leader: ActorConfig, keyPersonnel: KeyPersonnel[], opts: RunOptions = {}): Promise<RunArtifact> {
  const startedAtIso = new Date().toISOString();
  const { agent } = await import('@framers/agentos');
  const sc = opts.scenario ?? marsScenario;
  const maxTurns = opts.maxTurns ?? 12;
  const startTime = opts.startTime ?? opts.scenario?.setup?.defaultStartTime ?? 0;

  // Normalize the leader so traitProfile is guaranteed populated before
  // any downstream code reads it. Legacy hexaco-only callers continue
  // to work because the resolver synthesizes a hexaco-modeled
  // traitProfile from leader.hexaco. Non-HEXACO callers (e.g. ai-agent
  // leaders) get their explicit traitProfile passed through.
  // Use the normalized trait profile throughout the run so non-HEXACO
  // actor models drive cues and drift consistently.
  const normalized = normalizeActorConfig(leader);
  leader = normalized;
  // Resolve a HEXACO-shape view for legacy downstream reads (drift
  // bookkeeping, chat-agent personality, swarm-roster snapshots). For
  // pure-traitProfile actors (e.g. ai-agent), this projects from the
  // trait map; for hexaco-supplied actors, it round-trips the same
  // values back. Either way, every `.hexaco.X` read below is safe.
  const leaderHexaco: HexacoProfile = leader.hexaco ?? traitsToHexaco(normalized.traitProfile.traits);
  const timePerTurn = opts.timePerTurn ?? opts.scenario?.setup?.defaultTimePerTurn ?? 1;
  const requestedProvider = resolveProviderFromCredentials(opts.provider, opts, 'openai');
  const requestedProviderApiKey = apiKeyForProvider(requestedProvider, opts);
  // Preflight env check. Falls back to the other supported provider if
  // the requested one has no key; throws ProviderKeyMissingError when
  // neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set, rather than
  // hanging in a retry loop during the first LLM call.
  const resolvedProvider = resolveProviderWithFallback(requestedProvider, {
    apiKey: requestedProviderApiKey,
  });
  const provider = resolvedProvider.provider;
  const providerApiKey = apiKeyForProvider(provider, opts);
  const archetypeSlug = (typeof leader.archetype === 'string' ? leader.archetype : '')
    .toLowerCase().replace(/\s+/g, '-')
    || (typeof leader.name === 'string' ? leader.name : '').toLowerCase().replace(/\s+/g, '-')
    || 'leader';
  const sid = `${sc.labels.shortName}-v2-${archetypeSlug}`;
  const modelConfig = resolveSimulationModels(provider, opts.models, opts.costPreset);
  // Cost tracking: accumulate token usage and estimated cost across all LLM calls
  // Cost tracker: per-site buckets + cache-aware fallback estimation.
  // Lives in cost-tracker.ts so the math has one home and the turn loop
  // reads as dispatch. trackUsage(result, site) is called at every LLM
  // call site with a site tag; buildCostPayload() is called before each
  // SSE emit so the dashboard breakdown modal sees live data.
  const costTracker = createCostTracker(modelConfig);
  const trackUsage = costTracker.trackUsage;
  const recordSchemaAttempt = costTracker.recordSchemaAttempt;

  // Internal emit is deliberately loose on the `data` shape (Record<string,
  // unknown>) because the orchestrator builds payloads by spreading partial
  // objects and adding a `_cost` book-keeping field. The public `SimEvent`
  // type is narrow per `type`; we cast once here at the boundary so the
  // onEvent consumer gets full per-event intellisense without the emit
  // call-sites having to match the narrow interfaces field-for-field.
  //
  // Every emit also gets a universal `summary` string computed from the
  // payload. Consumers that just want to log an event (`console.log(e.type,
  // e.data.summary)`) get a readable line for every event type without
  // having to type-narrow or know which fields carry a title — the
  // exact pain point that produced the "undefined" spam in casual
  // examples before this was wired up.
  const emit = (type: SimEventType, data?: Record<string, unknown>) => {
    const merged: Record<string, unknown> = {
      ...data,
      _cost: costTracker.buildCostPayload(),
    };
    merged.summary = buildEventSummary(type, merged);
    // Go through `unknown` because the internal emit builds a
    // Record-typed data bag that doesn't structurally match the narrow
    // per-event payload interfaces; we guarantee the shape via the
    // emit() call-sites in the orchestrator, so the double-cast is safe.
    opts.onEvent?.({
      type,
      leader: leader.name,
      data: merged,
    } as unknown as SimEvent);
  };

  /**
   * Run-scoped provider-error abort state. When a terminal error (quota
   * exhaustion, invalid API key) is detected on ANY LLM call, the
   * classifier fires `provider_error` over SSE once, sets this flag, and
   * every subsequent LLM call site short-circuits immediately instead of
   * thrashing against the same dead provider for another 5 turns.
   *
   * Reported via `output.providerError` on the returned result so
   * programmatic consumers (not just the dashboard) can detect a failed
   * run without parsing SSE.
   */
  let providerErrorState: ClassifiedProviderError | null = null;
  /** True once we've emitted the SSE so we don't spam duplicate banners. */
  let providerErrorEmitted = false;

  /**
   * Report a caught error from an LLM call site. Classifies it, and if it
   * is a terminal auth/quota failure, emits the `provider_error` SSE
   * (once) and sets the abort flag so subsequent turns skip LLM work.
   *
   * @param err The caught exception.
   * @param site Short label for where the error happened (used in logs,
   *        e.g. 'director', 'dept:medical', 'commander', 'reactions').
   * @returns The classified error so the caller can react (e.g. log
   *        differently for non-terminal errors).
   */
  const reportProviderError = (err: unknown, site: string): ClassifiedProviderError => {
    const classified = classifyProviderError(err);
    // Count every classified error, not just terminal ones, so
    // rate-limit pressure and transient network errors show up in
    // /retry-stats.providerErrors across runs.
    costTracker.recordProviderError(classified.kind);
    if (shouldAbortRun(classified.kind) && !providerErrorEmitted) {
      providerErrorState = classified;
      providerErrorEmitted = true;
      console.error(`  [${site}] PROVIDER ERROR (${classified.kind}): ${classified.message}`);
      emit('provider_error', {
        kind: classified.kind,
        provider: classified.provider,
        message: classified.message,
        actionUrl: classified.actionUrl,
        site,
      });
    }
    return classified;
  };

  /**
   * Emit a `validation_fallback` SSE event when a schema-validated LLM
   * call exhausts retries and falls back to an empty skeleton. Separate
   * from `provider_error` so the dashboard can distinguish model
   * misbehavior on schema (soft degradation, one call) from quota / auth
   * failures (terminal, aborts the run).
   */
  const reportValidationFallback = (site: string, details: { rawText: string; schemaName?: string; err: unknown }) => {
    // Surface the Zod validation issues so production runs don't throw
    // away the actual reason the model's output was rejected. Without
    // this the only signal in pm2 logs was 'Validation failed after 3
    // attempts' — which made every schema fallback look identical and
    // hid an actionable shape mismatch behind a generic message.
    const zodIssues = (details.err as { validationErrors?: { issues?: Array<{ path?: unknown[]; message?: string; code?: string }> } } | undefined)?.validationErrors?.issues;
    const issueSummary = Array.isArray(zodIssues) && zodIssues.length > 0
      ? zodIssues.slice(0, 5).map(i => `${(i.path ?? []).join('.') || '<root>'}:${i.code ?? ''}=${i.message ?? ''}`).join(' | ')
      : '';
    const headline = (details.err as { message?: string })?.message ?? String(details.err);
    console.warn(
      `  [${site}] SCHEMA FALLBACK on ${details.schemaName ?? '<unknown>'}: ${headline}` +
      (issueSummary ? `\n    issues: ${issueSummary}` : '') +
      `\n    raw[:600]: ${details.rawText.slice(0, 600).replace(/\n/g, '\\n')}`,
    );
    emit('validation_fallback', {
      site,
      schemaName: details.schemaName,
      rawTextPreview: details.rawText.slice(0, 1500),
      // Compact Zod issue list for the dashboard / forensic-replay tooling.
      issues: Array.isArray(zodIssues)
        ? zodIssues.slice(0, 5).map(i => ({ path: i.path ?? [], message: i.message, code: i.code }))
        : undefined,
    });
  };

  /** True when the run should stop launching new LLM work. */
  const isAborted = () => providerErrorState !== null;

  /**
   * Combined abort check: either an external signal flipped (client
   * disconnected past the grace period so the server's watchdog fired)
   * or a terminal provider error stopped the run. Used to gate every
   * expensive LLM call inside a turn so at most one in-flight call
   * completes after a tab close before the rest of the turn short-
   * circuits. Without these gates the turn's remaining depts +
   * commander + reactions would all fire even after the watchdog
   * aborted, burning tokens on nobody.
   */
  const shouldStop = () => opts.signal?.aborted || isAborted();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${sc.labels.name.toUpperCase()} v2`);
  console.log(`  Commander: ${leader.name} — "${leader.archetype}"`);
  console.log(`  Turns: ${maxTurns} | Live search: ${opts.liveSearch ? 'yes' : 'no'}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Initialize research memory from scenario knowledge bundle
  await initResearchMemory(sc.knowledge);

  const seed = opts.seed ?? 950;
  // WorldModel.fork() path: resume from a prior KernelSnapshot instead
  // of constructing a fresh kernel. fromSnapshot validates
  // scenarioVersion + scenarioId; the restored kernel is
  // byte-equivalent to the one that produced the snapshot.
  const kernel = opts._resumeFrom
    ? SimulationKernel.fromSnapshot(opts._resumeFrom, sc.id)
    : new SimulationKernel(seed, leader.name, keyPersonnel, {
        startTime,
        initialPopulation: opts.initialPopulation,
        scenario: opts.scenario,
        // StartingResources / StartingPolitics are subsets of the kernel's
        // Partial<WorldMetrics / WorldPolitics> shape. The kernel's types
        // carry index signatures for scenario-defined fields; the starter
        // configs only declare the universal fields, so the cast is safe.
        startingResources: opts.startingResources as Partial<import('../../engine/core/state.js').WorldMetrics> | undefined,
        startingPolitics: opts.startingPolitics as Partial<import('../../engine/core/state.js').WorldPolitics> | undefined,
        startingStatuses: opts.startingStatuses,
        startingEnvironment: opts.startingEnvironment,
      });
  // When forking, start the turn loop after the snapshot's turn.
  const firstTurn = opts._resumeFrom ? opts._resumeFrom.turn + 1 : 1;
  // Per-turn kernel snapshots captured when opts.captureSnapshots is on.
  // Populates RunArtifact.scenarioExtensions.kernelSnapshotsPerTurn.
  const kernelSnapshotsPerTurn: import('../../engine/core/snapshot.js').KernelSnapshot[] = [];

  // Rolling capture of the agent-swarm snapshot. Updated at the end of
  // each turn (immediately after the systems_snapshot emit). At end-of-
  // run this gets attached to the artifact as `finalSwarm` — the public,
  // serializable view of every agent's role, mood, family edges, memory.
  let latestSwarmSnapshot: import('../../engine/schema/index.js').SwarmSnapshot | undefined;

  const webSearchTool = createWebSearchTool(opts);
  const toolMap = new Map<string, ITool>();
  toolMap.set('web_search', webSearchTool);
  // Shared map of approved forged-tool executables. Populated by the
  // engine's onToolForged callback; read by the call_forged_tool
  // meta-tool so depts can execute prior-turn forges on new inputs
  // without paying for another judge review.
  const forgedExecutables = new Map<string, ITool>();
  const { engine, forgeTool } = createEmergentEngine(
    toolMap,
    provider,
    modelConfig.judge,
    opts.execution,
    // Forward judge-call usage into the run-wide cost tracker. Without this,
    // every forge review (often 30-50% of total API spend) was invisible to
    // the `cost` field returned from runSimulation(). Tagged 'judge' so
    // the StatsBar breakdown can show exactly how much review cost.
    (result) => trackUsage(result, 'judge'),
    // Pipe judge-call errors into the provider-error classifier so a 401
    // or 429-with-insufficient-quota from the judge fires the same abort
    // path as failures from any other LLM call site.
    (err) => reportProviderError(err, 'judge'),
    forgedExecutables,
    providerApiKey,
  );
  const callForgedTool = createCallForgedTool(forgedExecutables);
  const toolRegs: Record<string, string[]> = {};

  /**
   * Per-simulation forged-tool ledger. Tracks first-forge metadata + a
   * full reuse history so the UI can show WHEN a tool was used, BY WHICH
   * dept, on WHICH event, and WHAT OUTPUT it produced — not just a flat
   * "reused 3x" count.
   *
   * Two distinct signals:
   *   forgeCalls   the judge ran a fresh forge (succeeded or failed)
   *   uses         the LLM cited an existing tool in its dept report
   *                without re-forging (self-reported via forgedToolsUsed)
   *
   * Both surface in the UI; only the latter is "real" reuse, but tracking
   * both makes failure / re-forge attempts auditable.
   */
  const forgedLedger: ForgedLedger = new Map();

  // Commander HEXACO evolves per-turn via driftCommanderHexaco. Clone
  // the caller's leader.hexaco so we never mutate the caller's config:
  // pair-runner reuses configs across runs and chat-agents hold
  // references to the baseline profile. Every downstream read of the
  // commander's current personality goes through commanderHexacoLive.
  const commanderHexacoLive: HexacoProfile = { ...leaderHexaco };
  const commanderHexacoHistory: HexacoSnapshot[] = [
    { turn: 0, time: startTime, hexaco: { ...leaderHexaco } },
  ];

  // Parallel commander trait profile + history under whatever
  // TraitModel the leader specified (hexaco by default; ai-agent or
  // any future registered model when the leader supplies a non-HEXACO
  // traitProfile). For HEXACO leaders, this state mirrors
  // commanderHexacoLive byte-for-byte; for non-HEXACO leaders, it is
  // the canonical source for trajectory cues and downstream
  // traitProfile-aware paths. driftLeaderProfile maintains the same
  // ±0.05/turn cap and [0.05, 0.95] kernel bounds as
  // driftCommanderHexaco so cross-model drift discipline is uniform.
  const commanderTraitModel = traitModelRegistry.require(leader.traitProfile!.modelId);
  let commanderTraitProfileLive: TraitProfile = {
    modelId: leader.traitProfile!.modelId,
    traits: { ...leader.traitProfile!.traits },
  };
  const commanderTraitProfileHistory: TraitProfileSnapshot[] = [
    { turn: 0, time: 0, profile: { modelId: commanderTraitProfileLive.modelId, traits: { ...commanderTraitProfileLive.traits } } },
  ];

  // Commander does NOT use systemBlocks caching because AgentOS's
  // `systemBlocks` path replaces the assembled system prompt entirely,
  // dropping the HEXACO-derived personality descriptors that are the
  // commander's entire voice. Commander runs only ~12 calls per head-to-
  // head run, so savings from caching here (~$0.03) are not worth
  // losing the trait-driven behavioral cues that make leaders diverge.
  const commander = agent({
    provider, model: modelConfig.commander,
    apiKey: providerApiKey,
    fallbackProviders: providerApiKey ? [] : undefined,
    instructions: leader.instructions,
    personality: { openness: leaderHexaco.openness, conscientiousness: leaderHexaco.conscientiousness, extraversion: leaderHexaco.extraversion, agreeableness: leaderHexaco.agreeableness, emotionality: leaderHexaco.emotionality, honesty: leaderHexaco.honestyHumility },
    maxSteps: opts.execution?.commanderMaxSteps ?? DEFAULT_EXECUTION.commanderMaxSteps,
    // Commander outputs CommanderDecision JSON: rationale + reasoning +
    // selectedOptionId etc. Typical ~500-1500 output tokens; cap 3000
    // for headroom. Without this the session sends use the provider
    // default (4-8k) and a misbehaving model can yap to the ceiling
    // on every retry — at maxSteps=5 that compounds into real money.
    maxTokens: 3000,
  });
  const cmdSess = commander.session(`${sid}-cmd`);

  // Bootstrap the commander with a HEXACO-derived personality cue. This
  // is the FIRST LLM call in the run, so if the user's key is invalid
  // or credits are exhausted, the classifier fires here before we burn
  // compute on a run that has no hope of producing valid output.
  try {
    trackUsage(
      await cmdSess.send(buildCommanderBootstrap(buildPersonalityCue(leaderHexaco))),
      'commander',
    );
  } catch (err) {
    reportProviderError(err, 'commander-bootstrap');
    // If this is a terminal provider error, isAborted() is now true; the
    // turn loop skips LLM work but continues so the end-of-run cleanup
    // path runs and the user gets a proper `complete` SSE event.
  }

  // Turn 0: commander promotes department heads from the kernel's
  // candidate roster. Any dept the commander skips gets its top
  // candidate promoted via fallback so turn 1 starts with a full cabinet.
  // Abort gate: promotions fire one commander LLM call per department
  // (up to 5) before Turn 1 even begins. If the user clicked Run and
  // immediately closed the tab, skipping this saves those calls
  // entirely; the fallback path inside runDepartmentPromotions also
  // needs to be skipped because the whole run is being torn down.
  if (!shouldStop()) {
    await runDepartmentPromotions({
      kernel,
      scenario: sc,
      leader,
      startTime,
      sendToCommander: (prompt) => cmdSess.send(prompt),
      trackUsage,
      recordSchemaAttempt,
      emit,
    });
  }

  // Captured forge events keyed by department. Each `wrapForgeTool` push
  // here on every successful or failed forge; we drain the dept's bucket
    // around each specialist completion emit to attribute forges to the right event.
  // This is the source of truth — the LLM's self-reported `forgedToolsUsed`
  // is supplementary because it frequently omits tools it actually forged.
  const deptForgeBuckets = new Map<Department, CapturedForge[]>();
  // Track current event/turn for forge_attempt SSE emission so each
  // real-time forge can be attributed to the surrounding event.
  let currentEmitContext: { turn: number; time: number; eventIndex: number } = { turn: 0, time: startTime, eventIndex: 0 };
  const captureForge = (dept: Department) => (record: CapturedForge) => {
    const bucket = deptForgeBuckets.get(dept) ?? [];
    bucket.push(record);
    deptForgeBuckets.set(dept, bucket);
    // Feed the cost-tracker rollup so `_cost.forgeStats` ships live on
    // every subsequent SSE payload and finalCost().forgeStats lands in
    // the run artifact. The ring buffer in server-app.ts picks it up
    // on run completion for /retry-stats aggregation. Passing the tool
    // name lets the tracker compute unique-tool metrics (eventually-
    // approved vs terminally-rejected) that are more actionable than
    // raw attempt counts when the retry loop re-forges under the same
    // name.
    costTracker.recordForgeAttempt(record.approved, record.confidence, record.name, record.errorReason);
    // Real-time SSE so the dashboard can render an animated card the
    // moment a forge happens, instead of waiting for the specialist summary.
    const inputProps = (record.inputSchema && typeof record.inputSchema === 'object' && (record.inputSchema as any).properties)
      ? Object.keys((record.inputSchema as any).properties)
      : [];
    const outputProps = (record.outputSchema && typeof record.outputSchema === 'object' && (record.outputSchema as any).properties)
      ? Object.keys((record.outputSchema as any).properties)
      : [];
    emit('forge_attempt', {
      turn: currentEmitContext.turn,
      time: currentEmitContext.time,
      eventIndex: currentEmitContext.eventIndex,
      department: dept,
      name: record.name,
      description: record.description,
      mode: record.mode,
      approved: record.approved,
      confidence: record.confidence,
      inputFields: inputProps.slice(0, 8),
      outputFields: outputProps.slice(0, 8),
      errorReason: record.errorReason,
      timestamp: record.timestamp,
    });
  };

  // Create department agent sessions from promoted agents
  const deptAgents = new Map<Department, any>();
  const deptSess = new Map<Department, any>();
  const promoted = kernel.getState().agents.filter(c => c.promotion);
  for (const p of promoted) {
    const dept = p.promotion!.department;
    const cfg = sc.departments.find(c => c.id === dept);
    if (!cfg) continue;
    const wrapped = wrapForgeTool(forgeTool, `${sid}-${dept}`, sid, dept, captureForge(dept));
    // call_forged_tool lets this dept execute any tool another dept
    // (or this one) forged in a prior turn. Reuse costs ~zero vs a
    // fresh forge, so including it in the tools array on turn 1 is
    // safe — the forgedExecutables map is empty until something is
    // approved, at which point the meta-tool starts dispatching.
    const tools: ITool[] = opts.liveSearch
      ? [webSearchTool, wrapped, callForgedTool]
      : [wrapped, callForgedTool];
    // Universal forge_tool prompt injected for EVERY scenario (Mars,
    // Lunar, custom compiled, etc.). Previously only the hardcoded
    // DEPARTMENT_CONFIGS in departments.ts told the LLM about forging,
    // and that file was dead code — the orchestrator always reads
    // cfg.instructions from the scenario JSON, which doesn't mention
    // forge_tool. Result: no tools were ever forged unless the scenario
    // author thought to add the instruction themselves.
    const forgeGuidance = `

EMERGENT TOOLING — forge + reuse economy:

You have TWO meta-tools for computational analysis:

1. call_forged_tool(name, args): invoke a tool ALREADY in the ALREADY-FORGED TOOLS context block. No judge review. Costs nothing. Returns fresh output for new inputs. This is the FIRST thing to reach for when the toolbox has a tool whose scope covers your current question.

2. forge_tool(...): build a NEW tool from scratch. Judge-reviewed for safety and correctness before it executes. Adds to the toolbox. Use only when no existing tool covers the analysis, or when a fresh angle would add real insight.

Before every analysis, READ the ALREADY-FORGED TOOLS block carefully. Ask:
  (a) Does an existing tool compute what I need? → call_forged_tool it.
  (b) Does an existing tool almost compute it with different inputs? → call_forged_tool it, accept approximate fit.
  (c) Does NO existing tool apply, or would a novel composition produce genuine new insight? → forge_tool.

Forge when quantitative reasoning is needed and the toolbox has no applicable tool for it. Reuse when the toolbox already covers the question. Your personality profile above shapes how aggressive you are on either side of that line.

The implementation of forged tools runs in a hardened node:vm sandbox (10s timeout, heap usage observed but not preemptively capped, no network unless allowlisted). An LLM judge reviews your tool for safety AND CORRECTNESS before it executes.

HARD RULES — if you violate any of these, a local validator rejects the forge BEFORE the judge sees it and you waste the attempt:

1. inputSchema.properties MUST have at least two named fields, each with a JSON Schema "type". {"type":"object","additionalProperties":true} with NO properties is an automatic reject. Always list the fields your code reads.
2. outputSchema.properties MUST have at least one named field with a type. Empty output schemas are rejected.
3. additionalProperties on both schemas SHOULD be false so the declared shape is authoritative.
4. testCases MUST have at least 2 entries. Each testCase.input must be a non-empty object whose keys match your declared inputSchema fields. Tests with input:{} are rejected.
5. Every testCase.expectedOutput must name at least one field from your outputSchema — empty expectedOutput defeats the judge's correctness check.

⚠️ #1 FORGE REJECTION REASON IN PRODUCTION — READ THIS CAREFULLY:
The judge rejects most failed forges for "violates declared output schema by returning additional properties not allowed by additionalProperties:false." This happens when your implementation's return statement includes extra "helpful" fields (intermediate calculations, debug info, recommendations) that aren't declared in outputSchema.properties.

  BAD (auto-reject):
    outputSchema.properties = { score, tier }, additionalProperties: false
    return { score: 0.7, tier: "high", recommended_action: "evacuate" }  ← extra field ✗

  GOOD:
    outputSchema.properties = { score, tier }, additionalProperties: false
    return { score: 0.7, tier: "high" }  ← only declared keys ✓

  ALSO GOOD (when you want the extra field):
    outputSchema.properties = { score, tier, recommended_action }, additionalProperties: false
    return { score: 0.7, tier: "high", recommended_action: "evacuate" }  ← declare it, then return it

Your implementation's return statement MUST contain EXACTLY the keys listed in outputSchema.properties — no more, no less. If you want to return intermediate or debug fields, DECLARE THEM in outputSchema.properties first. This is the single biggest cause of wasted forge attempts.

Match the full worked example below exactly; do not emit placeholder/schema-skeleton forms.

ROBUSTNESS RULES (the judge enforces these — failed forges hurt the simulation state):
1. Validate every numeric input. If a field is missing/null/undefined or NaN, default it to a safe value or return a conservative result. Never let the function throw or return NaN/Infinity.
2. Wrap the body in a try/catch and return a defined object on error: { "score": 0, "warnings": ["missing input X"] }.
3. Use Number.isFinite() before using any input in arithmetic. Avoid division — multiply by reciprocals or guard with (denominator || 1).
4. ARRAYS: never call .includes(), .map(), .filter(), .some(), .find(), .length, etc. on an input without first checking Array.isArray(x). Default missing arrays to []: const arr = Array.isArray(input.items) ? input.items : []. A single "Cannot read properties of undefined (reading 'includes')" TypeError fails the whole tool and costs the simulation morale + power.
5. STRINGS: same rule — guard with typeof x === 'string' before .includes()/.split()/.toLowerCase(). Default to '' when missing.
6. Provide AT LEAST 3 testCases:
   - one happy path with realistic numbers
   - one with a missing/zero input (must NOT throw)
   - one with a boundary value (population=0, capacity=1, etc.)
7. Bound your output to a defined range (e.g., score 0..100, multiplier 0.1..10) so downstream code stays predictable.

GOOD FORGE EXAMPLE (follow this shape, adapt the domain). Every declared property is in "required". No optional output fields — the judge treats optional fields as schema-mismatch bait, so KEEP EVERY FIELD REQUIRED and always return every one from execute().
{
  "name": "radiation_dose_risk_score",
  "description": "Scores cumulative Mars radiation exposure risk on 0..100.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "cumulative_dose_msv": { "type": "number", "description": "mSv lifetime" },
      "age_years": { "type": "number" },
      "shielding_factor": { "type": "number", "description": "0..1 reduction" }
    },
    "required": ["cumulative_dose_msv", "age_years", "shielding_factor"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "risk_score": { "type": "number", "description": "0..100, higher is worse" },
      "tier": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
    },
    "required": ["risk_score", "tier"],
    "additionalProperties": false
  },
  "implementation": {
    "mode": "sandbox",
    "code": "function execute(input){try{const d=Number.isFinite(+input.cumulative_dose_msv)?+input.cumulative_dose_msv:0;const a=Number.isFinite(+input.age_years)?+input.age_years:30;const s=Number.isFinite(+input.shielding_factor)?Math.max(0,Math.min(1,+input.shielding_factor)):0;const eff=d*(1-s);let score=Math.max(0,Math.min(100,eff/30*(1+Math.max(0,(60-a))/100)));const tier=score>=80?'critical':score>=50?'high':score>=20?'medium':'low';return{risk_score:Math.round(score),tier};}catch(e){return{risk_score:0,tier:'low'};}}",
    "allowlist": []
  },
  "testCases": [
    { "input": { "cumulative_dose_msv": 1200, "age_years": 42, "shielding_factor": 0.3 }, "expectedOutput": { "tier": "high" } },
    { "input": { "cumulative_dose_msv": 0, "age_years": 30, "shielding_factor": 0 }, "expectedOutput": { "risk_score": 0, "tier": "low" } },
    { "input": { "cumulative_dose_msv": 4000, "age_years": 65, "shielding_factor": 0 }, "expectedOutput": { "tier": "critical" } }
  ]
}
Every field declared in properties AND required AND returned by execute() — and NOTHING ELSE returned by execute(). additionalProperties:false on both schemas means the return-statement key set equals the outputSchema.properties key set exactly. Three real test cases each with real inputs matching declared fields and a field-level assertion in expectedOutput. Match this density exactly or the judge will reject.

IF YOUR FORGE IS REJECTED: the tool result will tell you the exact shape failure ("inputSchema has no declared properties", "outputSchema has no declared properties", "testCases use empty input", etc.). Immediately call forge_tool AGAIN with those specific fixes. Do not skip. Do not move to a different tool. Fix the named fields and resubmit — you get two retries before the department moves on.

REPORT FORMAT:
Respond with valid JSON ONLY (no markdown, no prose outside the JSON):
{
  "department": "${dept}",
  "summary": "...",
  "citations": [{"text": "...", "url": "...", "context": "..."}],
  "risks": [{"severity": "low|medium|high|critical", "description": "..."}],
  "opportunities": [{"impact": "low|medium|high", "description": "..."}],
  "recommendedActions": ["..."],
  "forgedToolsUsed": [{"name": "tool_name", "mode": "sandbox", "description": "what it does", "output": {...}, "confidence": 0.9}],
  "recommendedEffects": [{"id": "effect_1", "type": "resource_shift|capacity_expansion|risk_mitigation|social_investment|research_bet", "description": "...", "systemDelta": {"morale": 0.05}}],
  "confidence": 0.85,
  "openQuestions": [],
  "featuredAgentUpdates": [],
  "proposedPatches": {}
}`;
    // Prompt caching: the combined role instructions + forge guidance
    // (~1500-2500 tokens) are identical across every session.send() call
    // for this department across all turns/events in one run. Moving it
    // to a cacheable systemBlock means the second event's dept call and
    // every subsequent one hit the provider's prefix cache at 0.1x
    // billed rate on Anthropic. Combined across 5 depts x ~12 calls,
    // this is the single largest savings in the sim pipeline.
    const deptSystemPrompt = cfg.instructions + forgeGuidance;
    const a = agent({
      provider,
      model: modelConfig.departments || cfg.defaultModel,
      apiKey: providerApiKey,
      fallbackProviders: providerApiKey ? [] : undefined,
      systemBlocks: [{ text: deptSystemPrompt, cacheBreakpoint: true }],
      tools,
      maxSteps: opts.execution?.departmentMaxSteps ?? DEFAULT_EXECUTION.departmentMaxSteps,
      // Department outputs DepartmentReport JSON: summary + risks +
      // opportunities + recommendedActions + forgedToolsUsed +
      // recommendedEffects. Typical ~2000-3500 output tokens; cap 5000
      // for headroom on tool-heavy reports. Each agentic step within
      // departmentMaxSteps gets its own cap so the worst-case ceiling
      // is bounded at maxSteps × 5000 instead of maxSteps × providerDefault.
      maxTokens: 5000,
    });
    deptAgents.set(dept, a);
    deptSess.set(dept, a.session(`${sid}-${dept}`));
  }
  console.log(`  Promoted ${promoted.length} department heads. Agents created.\n`);

  const artifacts: TurnArtifact[] = [];
  const timeSchedule = buildTimeSchedule(startTime, maxTurns, timePerTurn);
  const outcomeLog: Array<{ turn: number; time: number; outcome: TurnOutcome }> = [];
  const eventHistory: DirectorContext['previousEvents'] = [];
  let lastTurnToolOutputs: Array<{ name: string; department: string; output: string }> = [];
  let lastTurnMoodSummary: string | undefined;
  // Run-wide accumulators surfaced in the final runSimulation() result so
  // programmatic consumers see the same data the dashboard sees via SSE.
  const allDepartmentReports: Array<{ turn: number; time: number; eventIndex: number; eventTitle: string; report: DepartmentReport }> = [];
  const allCommanderDecisions: Array<{ turn: number; time: number; eventIndex: number; eventTitle: string; decision: CommanderDecision; outcome: TurnOutcome }> = [];
  const allForges: Array<CapturedForge & { turn: number; time: number; eventIndex: number }> = [];
  const allAgentReactions: Array<{ turn: number; time: number; reactions: import('../agents/agent-reactions.js').AgentReaction[] }> = [];
  const allDirectorEvents: Array<{ turn: number; time: number; eventIndex: number; event: DirectorEvent; pacing: string }> = [];
  // Per-turn slots that fill during the inner event loop and then get
  // merged into TurnArtifact at the end of the turn.
  let turnDeptReports: DepartmentReport[] = [];
  let turnDecisions: CommanderDecision[] = [];
  let turnPolicyEffects: string[] = [];
  const director = new EventDirector();
  const effectRegistry = new EffectRegistry(sc.effects[0]?.categoryDefaults ?? {});
  // Department memory: stores previous turn summaries per department for session continuity
  const deptMemory = new Map<Department, import('./departments.js').DepartmentTurnMemory[]>();
  const activeDepartments = new Set<Department>(opts.activeDepartments ?? sc.departments.map(d => d.id));

  // Track whether the run was cancelled by an external AbortSignal so
  // the final result object can carry an `aborted: true` flag and the
  // dashboard can label the run "Unfinished" instead of "Complete".
  // Distinct from provider-error abort (which is also terminal but has
  // its own classified reason). External abort is typically "user
  // navigated away and the server pulled the plug after the grace
  // period" — not a failure of the sim, just an intentional cancel.
  let externallyAborted = false;

  for (let turn = firstTurn; turn <= maxTurns; turn++) {
    const time = timeSchedule[turn - 1] ?? (timeSchedule[timeSchedule.length - 1] + (turn - timeSchedule.length) * 5);

    // ── External-abort gate ─────────────────────────────────────────
    // Fired when opts.signal flips (client disconnected and grace
    // period expired). Emits a single sim_aborted event and bails out
    // of the turn loop — we do NOT continue emitting degraded turn_done
    // stubs, because an external cancel is a clean stop, not a
    // provider-errored skip. Partial results already in the event
    // buffer stay intact so the user sees what was reached.
    if (opts.signal?.aborted && !externallyAborted) {
      externallyAborted = true;
      emit('sim_aborted', {
        turn, time,
        reason: 'client_disconnected',
        completedTurns: turn - 1,
        metrics: kernel.getState().metrics,
        toolsForged: Object.values(toolRegs).flat().length,
      });
      break;
    }

    // ── Abort gate ───────────────────────────────────────────────────
    // If a terminal provider error was hit on a previous turn (or on the
    // commander bootstrap), every LLM call in this turn would throw the
    // same way and be silently caught downstream. Skip the turn entirely
    // and emit a minimal `turn_done` event with the error attached so the
    // dashboard playhead advances to the abort point instead of looking
    // stuck. This replaces ~5 turns of thrashing + empty reports with one
    // crisp banner + graceful exit.
    if (isAborted()) {
      // Capture the provider error to a local const so TS narrowing holds
      // inside the object literal below (closure-assigned lets lose their
      // narrow through control-flow re-analysis).
      const pe = providerErrorState as ClassifiedProviderError | null;
      {
        const st = kernel.getState();
        emit('turn_done', {
          turn, time,
          metrics: st.metrics,
          statuses: Object.keys(st.statuses).length > 0 ? { ...st.statuses } : undefined,
          environment: Object.keys(st.environment).length > 0 ? { ...st.environment } : undefined,
          toolsForged: Object.values(toolRegs).flat().length,
          aborted: true,
          providerError: pe
            ? { kind: pe.kind, provider: pe.provider, message: pe.message }
            : undefined,
        });
      }
      continue;
    }

    try {

    // ── Event generation ──────────────────────────────────────────────
    const maxEvents = sc.setup.maxEventsPerTurn ?? 2;
    let turnEvents: DirectorEvent[];
    let batchPacing = 'normal';

    const getMilestone = sc.hooks.getMilestoneEvent;
    const milestone = getMilestone?.(turn, maxTurns);
    if (milestone) {
      // Milestone events are LLM-generated at compile time with freeform
      // category strings (e.g. "founding", "legacy", "Strategy & Launch")
      // that almost never match the scenario's effects map keys. The
      // EffectRegistry then falls through to its morale-only default and
      // the run's declared metrics never move under the milestone turn.
      // Force the category to a scenario-effects-map key so milestones
      // actually exercise the scenario's declared effects: turn 1 uses
      // the first effects key (typical "founding" feel — set the stage),
      // final turn uses the last (typical "legacy" feel — close the
      // arc). Falls through to the LLM-generated category when the
      // scenario declares no categoryMapping (legacy scenarios).
      const effectKeys = Object.keys(sc.knowledge?.categoryMapping ?? {});
      const forcedCategory = effectKeys.length > 0
        ? (turn === 1 ? effectKeys[0] : effectKeys[effectKeys.length - 1])
        : milestone.category;
      turnEvents = [{ ...milestone, category: forcedCategory, description: (milestone as any).description || (milestone as any).crisis || '' } as DirectorEvent];
    } else {
      const preState = kernel.getState();
      const alive = preState.agents.filter(c => c.health.alive);
      const dirCtx: DirectorContext = {
        turn, time,
        actorName: leader.name, actorArchetype: leader.archetype, leaderHexaco: commanderHexacoLive,
        leaderHexacoHistory: commanderHexacoHistory,
        state: preState.metrics as unknown as Record<string, number>,
        politics: preState.politics as unknown as Record<string, number | string | boolean>,
        systems: preState.metrics as unknown as Record<string, number>,
        aliveCount: alive.length,
        nativeBornCount: alive.filter(c => c.core.marsborn).length,
        marsBornCount: alive.filter(c => c.core.marsborn).length,
        recentDeaths: preState.eventLog.filter(e => e.turn === turn - 1 && e.type === 'death').length,
        recentBirths: preState.eventLog.filter(e => e.turn === turn - 1 && e.type === 'birth').length,
        previousEvents: eventHistory,
        previousCrises: eventHistory,
        toolsForged: Object.values(toolRegs).flat(),
        driftSummary: preState.agents.filter(c => c.promotion && c.health.alive).slice(0, 4)
          .map(c => ({ name: c.core.name, role: c.core.role, openness: c.hexaco.openness, conscientiousness: c.hexaco.conscientiousness })),
        recentToolOutputs: lastTurnToolOutputs,
        agentMoodSummary: lastTurnMoodSummary,
        // Ground director's researchKeywords / category in real bundle entries so
        // recallResearch/getResearchFromBundle can surface citations downstream.
        knowledgeTopics: Object.keys(sc.knowledge?.topics ?? {}),
        knowledgeCategories: Object.keys(sc.knowledge?.categoryMapping ?? {}),
      };
      emit('turn_start', { turn, time, title: 'Director generating...', crisis: '', births: 0, deaths: 0, metrics: preState.metrics });
      // Abort gate: if the client already left during the gap between
      // the kernel advance and the director call, skip the director's
      // flagship LLM call. The inner event loop then has nothing to
      // iterate and the outer turn loop's top-of-turn signal check
      // catches the abort on the next iteration and emits sim_aborted.
      if (shouldStop()) {
        turnEvents = [];
      } else {
      const dirInstructions = sc.hooks.directorInstructions?.();
      const batch = await director.generateEventBatch(
        dirCtx,
        maxEvents,
        provider,
        modelConfig.director,
        dirInstructions,
        // Fold director spend into the run-wide cost tracker. One flagship
        // call per turn that was previously unaccounted. Tagged 'director'
        // so the breakdown surfaces it separately from dept calls.
        (result) => trackUsage(result, 'director'),
        // Classify director-call errors so quota exhaustion fires the
        // abort banner instead of silently running six turns of canned
        // fallback events.
        (err) => reportProviderError(err, 'director'),
        // Feed per-schema retry telemetry.
        (attempts, fellBack) => recordSchemaAttempt('DirectorEventBatch', attempts, fellBack),
        providerApiKey,
      );
      turnEvents = batch.events;
      batchPacing = batch.pacing;
      }
    }

    // ── Kernel advance (once per turn, before events) ─────────────────
    const state = kernel.advanceTurn(turn, time, sc.hooks.progressionHook);
    const births = state.eventLog.filter(e => e.turn === turn && e.type === 'birth').length;
    const deaths = state.eventLog.filter(e => e.turn === turn && e.type === 'death').length;
    console.log(`  Kernel: +${births} births, -${deaths} deaths → pop ${state.metrics.population}`);

    console.log(`\n${'─'.repeat(50)}`);
    const timeNounRaw = sc.labels?.timeUnitNoun ?? 'tick';
    const TimeNoun = timeNounRaw.charAt(0).toUpperCase() + timeNounRaw.slice(1);
    console.log(`  Turn ${turn}/${maxTurns}. ${TimeNoun} ${time}: ${turnEvents.length} event(s) [${milestone ? 'MILESTONE' : 'EMERGENT'}]`);
    console.log(`${'─'.repeat(50)}`);

    emit('turn_start', { turn, time, title: turnEvents[0]?.title || '', crisis: turnEvents[0]?.description?.slice(0, 200) || '', category: turnEvents[0]?.category || '', births, deaths, metrics: state.metrics, emergent: !milestone, turnSummary: turnEvents[0]?.turnSummary || '', totalEvents: turnEvents.length, pacing: batchPacing });

    // ── Inner event loop ──────────────────────────────────────────────
    let reactions: import('../agents/agent-reactions.js').AgentReaction[] = [];
    const turnEventTitles: string[] = [];
    lastTurnToolOutputs = [];
    let lastOutcome: import('../../engine/core/state.js').TurnOutcome = 'conservative_success';
    let lastEventCategory = '';
    // Reset per-turn slots so the artifacts.push() below captures only this
    // turn's reports / decisions / policies.
    turnDeptReports = [];
    turnDecisions = [];
    turnPolicyEffects = [];

    for (let ei = 0; ei < turnEvents.length; ei++) {
      try {
      let event = applyCustomEventToCrisis(turnEvents[ei], opts.customEvents ?? [], turn);

      // Update context so any forge_attempt SSE emitted during this event
      // (from inside parallel dept calls) is attributed to the right slot.
      currentEmitContext = { turn, time, eventIndex: ei };

      console.log(`  Event ${ei + 1}/${turnEvents.length}: ${event.title} (${event.category})`);
      emit('event_start', { turn, time, eventIndex: ei, totalEvents: turnEvents.length, title: event.title, description: event.description?.slice(0, 200), category: event.category, emergent: !milestone, turnSummary: event.turnSummary, pacing: batchPacing });
      turnEventTitles.push(event.title);

      // Research
      let packet: import('../contracts.js').CrisisResearchPacket;
      if (milestone) {
        packet = getResearchFromBundle(sc.knowledge, event.category, event.researchKeywords);
        if (packet.canonicalFacts.length === 0) packet = getResearchPacket(turn);
      } else {
        const memPacket = await recallResearch(event.title + ' ' + event.description.slice(0, 100), event.researchKeywords, event.category);
        if (memPacket.canonicalFacts.length >= 2) {
          packet = memPacket;
          console.log(`  [research] Memory recall: ${packet.canonicalFacts.length} citations`);
        } else {
          const searchMode = opts.economics?.search.mode ?? 'adaptive';
          const allowsSearch =
            opts.liveSearch &&
            event.researchKeywords.length > 0 &&
            (searchMode === 'aggressive' || (searchMode === 'adaptive' && memPacket.canonicalFacts.length < 2) || (searchMode === 'gated' && memPacket.canonicalFacts.length === 0));
          if (allowsSearch) {
          try {
            const keywordBudget = Math.max(1, Math.min(3, opts.economics?.search.maxSearches ?? 3));
            const query = event.researchKeywords.slice(0, keywordBudget).join(' ') + ' ' + sc.labels.settlementNoun + ' science';
            const searchResult = await webSearchTool.execute({ query }, { gmiId: sid, personaId: sid, userContext: {} } as any);
            const results = (searchResult as any)?.output?.results || [];
            packet = { canonicalFacts: results.slice(0, 5).map((r: any) => ({ claim: r.snippet || r.title || '', source: r.title || 'web search', url: r.url || '' })), counterpoints: [], departmentNotes: {} };
          } catch (err) {
            console.log(`  [research] Live search failed: ${err}`);
            packet = getResearchFromBundle(sc.knowledge, event.category, event.researchKeywords);
          }
          } else {
            packet = getResearchFromBundle(sc.knowledge, event.category, event.researchKeywords);
          }
        }
      }

      // Departments
      const validDepts: Department[] = sc.departments.map(d => d.id as Department);
      const rawDepts = milestone ? getDepartmentsForTurn(turn) : event.relevantDepartments;
      const depts = rawDepts.filter(d => validDepts.includes(d) && activeDepartments.has(d));
      if (!depts.length) depts.push(validDepts[0] || 'medical', validDepts[1] || 'engineering');

      // Snapshot per-dept bucket lengths BEFORE this event's parallel
      // dept calls run, so the eventForges tally below can slice only
      // the forges added during this event. Without this, the tally
      // accumulated cumulative forges every event (a turn-1 failed
      // forge would be counted again on turns 2, 3, 4, 5 — inflating
      // the morale + power penalty incorrectly each turn).
      const eventBucketStarts = new Map<Department, number>();
      for (const dept of depts) {
        eventBucketStarts.set(dept, deptForgeBuckets.get(dept)?.length ?? 0);
      }

      const scenario = {
        turn, time, title: event.title, crisis: event.description,
        researchKeywords: event.researchKeywords, snapshotHints: {} as any,
        riskyOption: event.options.find(o => o.isRisky)?.label || '',
        riskSuccessProbability: event.riskSuccessProbability,
        options: event.options,
      };

      // Build a shared "previously forged tools" block for this turn so
      // every department in this event sees the same inventory. First
      // iteration listed just name + description, which wasn't enough —
      // the LLM kept re-forging because the system prompt says "Run it
      // to produce a number you reference in your summary" and there
      // was no other way to surface a number than to re-run forge_tool.
      // Now we also include the last approved output so the LLM can
      // cite both the name and the value without re-forging.
      const availableToolsBlock = buildAvailableToolsBlock(forgedLedger);

      const deptPromises = depts.map(async (dept) => {
        const sess = deptSess.get(dept);
        if (!sess) return emptyReport(dept);
        const baseCtx = buildDepartmentContext(dept, kernel.getState(), scenario, packet, deptMemory.get(dept), sc.hooks.departmentPromptHook);
        // Turn-1 bootstrap forge floor. Without a tool forged on turn 1
        // there is nothing for later turns to reuse, and high-discipline
        // dept heads on both sides converged on "existing knowledge is
        // enough, skip forging" — killing the reuse economy before it
        // started. Forcing one forge on turn 1 seeds the toolbox so the
        // personality asymmetry (Visionary reuses more, Engineer
        // rebuilds more) can actually play out in turns 2-6.
        const bootstrapDirective = turn === 1
          ? '\n\nTURN 1 IS A BOOTSTRAP TURN. You MUST call forge_tool at least once this turn to contribute a reusable computational tool to the shared toolbox. Later turns will reuse what you forge here. Pick a quantifiable aspect of THIS event (e.g. a risk score, a capacity calculator, a resource allocator) and forge a tool that computes it. Do not skip the forge — the whole run depends on building a toolbox every turn can draw from.\n'
          : '';
        const ctx = baseCtx + bootstrapDirective + availableToolsBlock;
        emit('specialist_start', { turn, time, department: dept, eventIndex: ei });
        // Snapshot the dept's forge bucket index BEFORE the LLM call so we
        // can attribute new forges to this specific specialist completion. The LLM
        // self-reports `forgedToolsUsed` in JSON but frequently omits tools
        // it actually forged — captured forges below are authoritative.
        const forgeBucketStart = deptForgeBuckets.get(dept)?.length ?? 0;
        try {
          const sendResult = await sendAndValidate({
            session: sess,
            prompt: ctx,
            schema: DepartmentReportSchema,
            schemaName: 'DepartmentReport',
            onUsage: (usage) => trackUsage(usage as any, 'departments'),
            onProviderError: (err) => reportProviderError(err, `dept:${dept}:turn${turn}:event${ei + 1}`),
            onValidationFallback: (details) => reportValidationFallback(`dept:${dept}:turn${turn}:event${ei + 1}`, details),
            fallback: { ...emptyReport(dept), summary: `${dept} report unavailable this turn.` } as any,
          });
          const { object: parsedDeptReport, fromFallback: deptFallback } = sendResult;
          recordSchemaAttempt('DepartmentReport', sendResult.attempts, deptFallback);
          if (deptFallback) {
            console.log(`    [${dept}] schema fallback; using empty report skeleton`);
          }
          // Cast schema-inferred result back to the legacy DepartmentReport
          // nominal type so downstream code (reports consumer, cost tracker,
          // citation plumbing) sees the same shape it always has.
          const report = parsedDeptReport as unknown as DepartmentReport;
          // Citation provenance guarantee: when the LLM omits citations but the
          // research packet carried real sources, attribute them to the report.
          // This keeps the citation flow auditable end-to-end (seed → memory →
          // department prompt → report → UI), even when the LLM forgets to
          // copy them into its JSON output.
          if (report.citations.length === 0 && packet.canonicalFacts.length > 0) {
            report.citations = packet.canonicalFacts.slice(0, 5).map(f => ({
              text: f.claim,
              url: f.url,
              context: f.source,
              ...(f.doi ? { doi: f.doi } : {}),
            }));
          }
          // Drain the forges captured during THIS dept's send() — the
          // ground-truth list of what actually got forged this event.
          const bucket = deptForgeBuckets.get(dept) ?? [];
          const captured = bucket.slice(forgeBucketStart);

          // Build a map keyed by tool name. Captured entries (real forge
          // events) take priority; LLM-reported entries (from JSON) fill
          // in narrative output when the captured record lacks it.
          const toolByName = new Map<string, {
            name: string; description: string; mode: string;
            confidence: number; output: unknown;
            inputSchema: unknown; outputSchema: unknown;
            approved: boolean; errorReason?: string;
          }>();

          for (const c of captured) {
            toolByName.set(c.name, {
              name: c.name,
              description: c.description,
              mode: c.mode,
              confidence: c.confidence,
              output: c.output,
              inputSchema: c.inputSchema,
              outputSchema: c.outputSchema,
              approved: c.approved,
              errorReason: c.errorReason,
            });
          }

          // Supplementary: anything the LLM reported that we somehow
          // didn't capture (rare, but covers edge cases like an LLM that
          // pre-existing-tool reuse without re-invoking forge_tool).
          for (const t of report.forgedToolsUsed || []) {
            if (!t || (!t.name && !t.description)) continue;
            const name = String(t.name || t.description || 'tool');
            if (toolByName.has(name)) {
              // Backfill output from LLM JSON if we have nothing better
              const existing = toolByName.get(name)!;
              if (!existing.output && t.output) existing.output = t.output;
              continue;
            }
            // LLM cited an existing tool without re-forging. Use the
            // tool's prior judge confidence from the ledger (set on its
            // first successful forge) rather than fabricating an 0.85
            // default. The LLM's t.confidence here is its OWN estimate
            // of the result, not the judge's verdict on the tool.
            const ledgerForName = forgedLedger.get(name);
            const existingHistory = ledgerForName?.history || [];
            const lastApproved = [...existingHistory].reverse().find(h => !h.rejected);
            const ledgerConfidence = lastApproved?.confidence;
            toolByName.set(name, {
              name,
              description: String(t.description || humanizeToolName(name)),
              mode: String(t.mode || 'sandbox'),
              confidence: ledgerConfidence ?? (typeof t.confidence === 'number' ? t.confidence : 0.85),
              output: t.output ?? null,
              inputSchema: undefined,
              outputSchema: undefined,
              approved: true,
            });
          }

          const validTools = [...toolByName.values()].map(t => {
            const rawOutput = t.output != null
              ? (typeof t.output === 'string' ? t.output : JSON.stringify(t.output))
              : null;
            // Derive a flat field list from the actual schema if we have
            // one, falling back to keys parsed from the output payload.
            let inputFields: string[] = [], outputFields: string[] = [];
            const inProps = (t.inputSchema && typeof t.inputSchema === 'object' && (t.inputSchema as any).properties) || null;
            const outProps = (t.outputSchema && typeof t.outputSchema === 'object' && (t.outputSchema as any).properties) || null;
            if (inProps) inputFields = Object.keys(inProps as Record<string, unknown>);
            if (outProps) outputFields = Object.keys(outProps as Record<string, unknown>);
            if ((inputFields.length === 0 || outputFields.length === 0) && rawOutput) {
              try {
                const p = JSON.parse(rawOutput);
                if (p && typeof p === 'object') {
                  const keys = Object.keys(p);
                  const inKey = keys.find(k => ['inputs','input','parameters','params'].includes(k));
                  if (inKey && p[inKey] && typeof p[inKey] === 'object') {
                    if (inputFields.length === 0) inputFields = Object.keys(p[inKey]);
                    if (outputFields.length === 0) outputFields = keys.filter(k => k !== inKey);
                  } else if (outputFields.length === 0) {
                    outputFields = keys;
                  }
                }
              } catch {}
            }

            // First-forge tracking: a tool is "new" only on the turn it was
            // first seen in this simulation. All subsequent appearances are
            // reuses of the same forged capability.
            const seen = forgedLedger.get(t.name);
            const isNew = !seen;
            // Determine if THIS appearance was a fresh forge attempt by
            // checking only the slice of forges captured during the
            // current LLM call (everything past forgeBucketStart). The
            // earlier check scanned the whole bucket which would flag a
            // turn-5 citation of a turn-1 forge as a re-forge.
            const captureMatched = captured.some(c => c.name === t.name);
            if (!seen) {
              // Prefer schema from the captured forge call args. Fall back
              // to the EmergentToolRegistry lookup (also our schema source).
              let inputSchema: unknown | undefined = t.inputSchema;
              let outputSchema: unknown | undefined = t.outputSchema;
              if (!inputSchema || !outputSchema) {
                try {
                  const registered = (engine as any).registry?.get?.(t.name);
                  if (registered) {
                    if (!inputSchema) inputSchema = registered.inputSchema;
                    if (!outputSchema) outputSchema = registered.outputSchema;
                  }
                } catch { /* best-effort */ }
              }
              forgedLedger.set(t.name, {
                firstForgedTurn: turn,
                firstForgedDepartment: dept,
                firstForgedEventIndex: ei,
                firstForgedEventTitle: event.title,
                inputSchema,
                outputSchema,
                history: [],
              });
            }
            const ledgerEntry = forgedLedger.get(t.name)!;
            // Append this invocation to the tool's reuse history. The first
            // append for a brand-new tool counts as the original forge; all
            // subsequent appends are reuses (whether the LLM cited it or
            // re-forged it). Skipped if a captured forge for this name
            // already wrote a history entry above (avoids double-counting
            // when the captured forge AND the LLM JSON both mention it).
            const alreadyLoggedThisEvent = ledgerEntry.history.some(h =>
              h.turn === turn && h.eventIndex === ei && h.department === dept,
            );
            if (!alreadyLoggedThisEvent) {
              ledgerEntry.history.push({
                turn, time, eventIndex: ei, eventTitle: event.title,
                department: dept,
                output: rawOutput?.slice(0, 400) || null,
                isReforge: captureMatched,
                rejected: !t.approved,
                confidence: t.confidence,
              });
            }
            const reuseCount = Math.max(0, ledgerEntry.history.length - 1);
            return {
              name: t.name,
              mode: t.mode,
              confidence: t.confidence,
              description: t.description,
              output: rawOutput?.slice(0, 400) || null,
              inputFields: inputFields.slice(0, 8),
              outputFields: outputFields.slice(0, 8),
              department: dept,
              crisis: event.title,
              approved: t.approved,
              errorReason: t.errorReason,
              // Provenance fields used by the UI to highlight emergent
              // first-forge events vs subsequent reuses.
              isNew,
              firstForgedTurn: ledgerEntry.firstForgedTurn,
              firstForgedDepartment: ledgerEntry.firstForgedDepartment,
              firstForgedEventIndex: ledgerEntry.firstForgedEventIndex,
              firstForgedEventTitle: ledgerEntry.firstForgedEventTitle,
              inputSchema: ledgerEntry.inputSchema,
              outputSchema: ledgerEntry.outputSchema,
              /** Authoritative reuse count derived from history length. */
              reuseCount,
              /** Full per-invocation history so the UI can show when, where, and what each use produced. */
              history: ledgerEntry.history,
            };
          });
          emit('specialist_done', { turn, time, department: dept, summary: report.summary, eventIndex: ei, citations: report.citations.length, citationList: report.citations.slice(0, 5).map(c => ({ text: c.text, url: c.url, doi: c.doi })), risks: report.risks, forgedTools: validTools, recommendedActions: report.recommendedActions?.slice(0, 2) });
          if (validTools.length) {
            const names = validTools.map(t => t.name).filter(Boolean);
            if (names.length) toolRegs[dept] = [...(toolRegs[dept] || []), ...names];
          }
          return report;
        } catch (err) {
          // Classify before returning the empty report. A single dept
          // failure on a transient error is fine, but if this is auth or
          // quota, the first classification flips the run-scoped abort
          // flag and the outer turn loop will skip the rest of the run.
          reportProviderError(err, `dept:${dept}`);
          console.log(`  [${dept}] ERROR: ${err}`);
          return emptyReport(dept);
        }
      });
      // Abort gate: checking before Promise.all lets us bail out
      // without firing N parallel dept LLM calls (5 flagship calls
      // per event, each with tool-forge judge passes on top). This
      // is the single largest cost on an abandoned turn.
      if (shouldStop()) {
        console.log(`  [abort] Skipping dept analysis for turn ${turn} event ${ei + 1} (${opts.signal?.aborted ? 'signal' : 'provider error'}).`);
        break;
      }
      const reports = await Promise.all(deptPromises);

      // Accumulate per-turn + run-wide so the final result includes the
      // full department report payloads (programmatic API parity with SSE).
      turnDeptReports.push(...reports);
      for (const r of reports) {
        allDepartmentReports.push({ turn, time, eventIndex: ei, eventTitle: event.title, report: r });
      }
      // Pull THIS event's captured forges into the run-wide ledger.
      // Use the per-dept eventBucketStarts snapshot instead of scanning
      // the whole bucket and de-duping with .find() (was O(n²) and prone
      // to missed matches when timestamps tied at sub-ms resolution).
      for (const dept of depts) {
        const bucket = deptForgeBuckets.get(dept) ?? [];
        const start = eventBucketStarts.get(dept) ?? 0;
        for (const forge of bucket.slice(start)) {
          allForges.push({ ...forge, turn, time, eventIndex: ei });
        }
      }

      // Accumulate tool outputs across events
      lastTurnToolOutputs.push(...reports.flatMap(r => (r.forgedToolsUsed || []).filter(t => t?.output).map(t => ({ name: t.name || 'unnamed', department: r.department, output: typeof t.output === 'string' ? t.output.slice(0, 200) : JSON.stringify(t.output).slice(0, 200) }))));

      // Department memory
      for (const r of reports) {
        const mem = { turn, time, crisis: event.title, summary: r.summary, recommendedActions: r.recommendedActions?.slice(0, 3) || [], outcome: '', toolsForged: (r.forgedToolsUsed || []).map(t => t?.name || '').filter(Boolean) };
        const existing = deptMemory.get(r.department) || [];
        existing.push(mem);
        deptMemory.set(r.department, existing);
      }

      // Commander
      // Defensive: LLM occasionally returns risks/recommendedActions as
      // a string or an object instead of an array. Previously the
      // commander prompt builder crashed with "r.risks.map is not a
      // function" and the entire event was aborted.
      const summaries = reports.map(r => {
        const risks = Array.isArray(r.risks) ? r.risks : [];
        const recs = Array.isArray(r.recommendedActions) ? r.recommendedActions : [];
        const risksLine = risks.map(x => `[${x?.severity ?? '?'}] ${x?.description ?? ''}`).join('; ') || 'none';
        const recsLine = recs.join('; ') || 'none';
        return `## ${r.department.toUpperCase()} (conf: ${r.confidence})\n${r.summary}\nRisks: ${risksLine}\nRecs: ${recsLine}`;
      }).join('\n\n');
      const optionText = event.options.length ? '\n\nOPTIONS:\n' + event.options.map(o => `- ${o.id}: ${o.label} — ${o.description}${o.isRisky ? ' [RISKY]' : ''}`).join('\n') + '\n\nYou MUST include "selectedOptionId" in your JSON response.' : '';
      const effectsList = reports.flatMap(r => (r.recommendedEffects || []).map(e => `  - ${e.id} (${e.type}): ${e.description}${e.systemDelta ? ' | Delta: ' + JSON.stringify(e.systemDelta) : ''}`));
      const effectsText = effectsList.length ? '\n\nAVAILABLE POLICY EFFECTS:\n' + effectsList.join('\n') : '';
      // Expose the current forged toolbox to the commander so their
      // rationale can cite specific tool outputs (e.g. "per Medical's
      // radiation_dose_calculator returning 3.4 mSv"). Without this,
      // commanders acknowledge tools in prose but never reference
      // specific outputs, which reads as generic risk framing rather
      // than evidence-driven decision-making.
      const commanderToolboxBlock = availableToolsBlock;
      const eventLabel = turnEvents.length > 1 ? ` (Event ${ei + 1}/${turnEvents.length})` : '';
      // Commander decision with a lightweight chain-of-thought scaffold.
      // The model is instructed to reason through four axes (trait alignment,
      // department consensus vs override, risk tolerance, forged-tool
      // evidence) inside <thinking> tags, then emit the decision JSON. On
      // the nano / haiku class where commander runs in demo mode the CoT
      // preamble adds ~300 tokens of reasoning per call but visibly sharpens
      // rationale quality (rationales started citing specific tool outputs
      // and trade tradeoffs instead of generic risk-averse hedging).
      // Trajectory cue dispatch: HEXACO leaders use the legacy path
      // for byte-identical output (the cue strings are dasherized
      // axis labels via the trait-cues shim, identical to the v0.7
      // surface). Non-HEXACO leaders use the trait-cues path which
      // pulls axis names from the registered model so the cue line
      // reads "exploration" or "verification-rigor" instead of HEXACO
      // axis names.
      const trajectoryCue = commanderTraitProfileLive.modelId === 'hexaco'
        ? buildTrajectoryCue(commanderHexacoHistory, commanderHexacoLive)
        : buildTrajectoryCueGeneric(commanderTraitProfileHistory, commanderTraitProfileLive);
      const cmdPrompt =
`TURN ${turn}${eventLabel} — ${time}: ${event.title}

${event.description}
${trajectoryCue ? `\n${trajectoryCue}\n` : ''}
DEPARTMENT REPORTS:
${summaries}
${commanderToolboxBlock}
State: Pop ${kernel.getState().metrics.population} | Morale ${Math.round(kernel.getState().metrics.morale * 100)}% | Food ${kernel.getState().metrics.foodMonthsReserve.toFixed(1)}mo${optionText}${effectsText}

REASONING — populate the "reasoning" field of your JSON response BEFORE committing to selectedOptionId. Numbered list, one point per line:
  (1) What does my personality profile push me toward on this call? Name the specific trait poles at play.
  (2) Do the department reports converge or conflict? If they conflict, which voice do I trust given my profile?
  (3) Which forged-tool outputs in the toolbox above directly inform this decision? Cite the numeric output if available.
  (4) What risk am I accepting vs refusing? My rationale must name the specific trade.
  (5) Final choice + one-line justification.

Then set selectedOptionId, decision, and rationale. The rationale compresses the reasoning into a single paragraph for default UI display; the "reasoning" field stores the full working.`;

      // Abort gate: skip the commander LLM call if the client left
      // between dept analysis and commander decision. Breaking the
      // event loop here also skips the remaining per-event outcome
      // and drift emits; the turn finishes with partial reports and
      // the next turn sees the abort flag and emits sim_aborted.
      if (shouldStop()) {
        console.log(`  [abort] Skipping commander decision for turn ${turn} event ${ei + 1}.`);
        break;
      }
      emit('decision_pending', { turn, time, eventIndex: ei });
      const cmdResult = await sendAndValidate({
        session: cmdSess,
        prompt: cmdPrompt,
        schema: CommanderDecisionSchema,
        schemaName: 'CommanderDecision',
        onUsage: (usage) => trackUsage(usage as any, 'commander'),
        onProviderError: (err) => reportProviderError(err, `commander:turn${turn}:event${ei + 1}`),
        onValidationFallback: (details) => reportValidationFallback(`commander:turn${turn}:event${ei + 1}`, details),
        fallback: { ...emptyDecision(depts), decision: 'Commander decision unavailable; defer to department consensus.' } as any,
      });
      const { object: decisionParsed, fromFallback: decisionFallback } = cmdResult;
      recordSchemaAttempt('CommanderDecision', cmdResult.attempts, decisionFallback);
      if (decisionFallback) {
        console.log(`  [commander] schema fallback for turn ${turn} event ${ei + 1}`);
      }
      const decision = decisionParsed as unknown as CommanderDecision;
      console.log(`  [commander] ${decision.decision.slice(0, 120)}...`);
      emit('decision_made', {
        turn, time,
        decision: decision.decision,
        rationale: decision.rationale,
        /** Full stepwise CoT preserved from the schema's reasoning field.
         *  Dashboard renders this behind a "Show full analysis" expand;
         *  rationale is the default compressed view. */
        reasoning: decision.reasoning ?? '',
        selectedPolicies: decision.selectedPolicies,
        eventIndex: ei,
      });

      kernel.applyPolicy(decisionToPolicy(decision, reports, turn, time));
      const agentUpdates = reports.flatMap(r => (r.featuredAgentUpdates || []).filter(u => u && u.agentId && u.updates).map(u => ({ agentId: u.agentId, health: u.updates?.health, career: u.updates?.career, narrativeEvent: u.updates?.narrative?.event })));
      if (agentUpdates.length) kernel.applyAgentUpdates(agentUpdates);

      // Outcome
      const outcomeRng = new SeededRng(seed).turnSeed(turn * 100 + ei);
      let resolvedOptionId = decision.selectedOptionId;
      if (!resolvedOptionId && event.options.length) { const decLower = (decision.decision || '').toLowerCase(); for (const opt of event.options) { if (decLower.includes(opt.id) || decLower.includes(opt.label.toLowerCase())) { resolvedOptionId = opt.id; break; } } }
      const outcome = resolvedOptionId
        ? classifyOutcomeById(resolvedOptionId, event.options, event.riskSuccessProbability, kernel.getState().metrics, outcomeRng)
        : classifyOutcome(decision.decision, scenario.riskyOption, event.riskSuccessProbability, kernel.getState().metrics, outcomeRng);

      const outcomeEffectRng = new SeededRng(seed).turnSeed(turn * 100 + ei + 50);
      // Personality bonus shapes outcome magnitude. Two extreme leaders
      // (e.g. Visionary openness=0.95 vs Engineer openness=0.25) should
      // produce visibly different world trajectories. Prior coefficients
      // (0.08/0.04) yielded ~3-5% effect spread which got lost in noise;
      // bumped to 0.20/0.12 plus an alignment term so picking a risky
      // option with high openness or a safe option with high conscientiousness
      // is rewarded extra. Values are still bounded by the effect registry's
      // delta caps, so this widens divergence without breaking the kernel.
      const isRiskyChoice = resolvedOptionId === event.riskyOptionId;
      const personalityBonus =
        (commanderHexacoLive.openness - 0.5) * 0.20 +
        (commanderHexacoLive.conscientiousness - 0.5) * 0.12 +
        // Alignment kicker: choosing in line with personality boosts effect
        (isRiskyChoice ? (commanderHexacoLive.openness - 0.5) : (commanderHexacoLive.conscientiousness - 0.5)) * 0.10;

      // Tool intelligence factor — tally what departments forged THIS
      // event (using the bucket snapshots taken before the dept calls)
      // and feed into the effect registry so emergent tools materially
      // affect outcomes. Reuses are nearly free; failed forges cost
      // morale + power. Run-wide cumulative count gives a small
      // log-scaled innovation bonus with diminishing returns.
      const eventForges = (() => {
        let newCount = 0, reuseCount = 0, failCount = 0;
        const newNamesThisEvent = new Set<string>();
        for (const dept of depts) {
          const bucket = deptForgeBuckets.get(dept) ?? [];
          const start = eventBucketStarts.get(dept) ?? 0;
          // Forges added DURING this event only — slice past start.
          const newForges = bucket.slice(start);
          for (const f of newForges) {
            if (!f.approved) { failCount++; continue; }
            // First-time forges: name not seen before (firstForgedTurn === turn
            // AND we haven't already counted it elsewhere this event).
            const ledgerEntry = forgedLedger.get(f.name);
            const isFirstUse = ledgerEntry?.firstForgedTurn === turn && !newNamesThisEvent.has(f.name);
            if (isFirstUse) {
              newCount++;
              newNamesThisEvent.add(f.name);
            } else {
              reuseCount++;
            }
          }
        }
        return {
          newToolsThisEvent: newCount,
          reuseCountThisEvent: reuseCount,
          forgeFailures: failCount,
          totalToolsForRun: forgedLedger.size,
        };
      })();

      const systemDeltas = effectRegistry.applyOutcome(event.category, outcome, {
        personalityBonus,
        noise: outcomeEffectRng.next() * 0.2 - 0.1,
        toolModifiers: eventForges,
      });
      kernel.applySystemDeltas(systemDeltas as any, [{ turn, time, type: 'system', description: `Outcome effect (${outcome}): ${Object.entries(systemDeltas).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}` }]);

      const polDelta = sc.hooks.politicsHook?.(event.category, outcome);
      if (polDelta) kernel.applyPoliticsDeltas(polDelta);

      outcomeLog.push({ turn, time, outcome });
      eventHistory.push({ turn, title: event.title, category: event.category, selectedOptionId: resolvedOptionId, decision: decision.decision.slice(0, 200), outcome });
      // Accumulate full decision + outcome + event for the API result so
      // programmatic consumers don't have to scrape SSE event buffers.
      turnDecisions.push(decision);
      if (decision.selectedPolicies?.length) {
        turnPolicyEffects.push(...decision.selectedPolicies.map(p => typeof p === 'string' ? p : JSON.stringify(p)));
      }
      allCommanderDecisions.push({ turn, time, eventIndex: ei, eventTitle: event.title, decision, outcome });
      allDirectorEvents.push({ turn, time, eventIndex: ei, event, pacing: batchPacing });
      lastOutcome = outcome;
      lastEventCategory = event.category;

      console.log(`  [outcome] ${outcome} (${event.category}) effects: ${JSON.stringify(systemDeltas)}`);
      emit('outcome', { turn, time, outcome, category: event.category, emergent: !milestone, systemDeltas, eventIndex: ei });
      } catch (err) {
        // Classify event-loop errors. Provider-side failures (auth,
        // quota, rate_limit, network) route through reportProviderError
        // so the abort gate fires on terminal kinds (auth/quota) and
        // telemetry captures the rest. Everything that classifies as
        // 'unknown' is a local runtime error (compiled hook bug,
        // unexpected data shape, etc.) — log it with full stack so the
        // root cause is visible in the output, and make clear it is
        // NOT a provider issue.
        const classified = reportProviderError(err, `event-loop:turn${turn}:event${ei + 1}`);
        const detail = err instanceof Error ? err.stack ?? err.message : String(err);
        if (classified.kind === 'unknown') {
          console.error(`  [event ${ei + 1}/${turnEvents.length}] Runtime error (not a provider issue): ${detail}`);
        } else {
          console.error(`  [event ${ei + 1}/${turnEvents.length}] Provider error (${classified.kind}): ${classified.message}`);
        }
        // Continue to next event; don't kill the turn on transient errors
      }
    } // end inner event loop

    // ── Post-events: drift, reactions, memory, artifacts ──────────────
    const prevTime = turn === 1 ? startTime : timeSchedule[turn - 2] ?? startTime;
    const timeDelta = Math.max(1, time - prevTime);
    kernel.applyDrift(commanderHexacoLive, lastOutcome, timeDelta);
    // Commander drifts alongside their agents. Outcome-pull only (no
    // leader-pull since commander IS the leader; no role-pull since
    // they have no department). Mutates commanderHexacoLive in place
    // and appends this turn's snapshot to commanderHexacoHistory.
    driftCommanderHexaco(commanderHexacoLive, lastOutcome, timeDelta, turn, time, commanderHexacoHistory);

    // Parallel drift on the commander's TraitProfile under its model.
    // For HEXACO leaders this is redundant with the line above (both
    // produce the same numbers because hexacoModel.drift.outcomes
    // mirrors progression.ts:outcomePullForTrait byte-for-byte and
    // both apply the same ±0.05/turn cap and [0.05, 0.95] bounds).
    // For non-HEXACO leaders, this is the canonical drift call site.
    commanderTraitProfileLive = driftLeaderProfile(commanderTraitProfileLive, commanderTraitModel, {
      outcome: lastOutcome,
      timeDelta,
      turn,
      time,
      history: commanderTraitProfileHistory,
    });

    const drifted = kernel.getState().agents.filter(c => c.promotion && c.health.alive);
    const driftData: Record<string, { name: string; hexaco: any }> = {};
    for (const p of drifted.slice(0, 5)) { const h = p.hexaco; driftData[p.core.id] = { name: p.core.name, hexaco: { O: +h.openness.toFixed(2), C: +h.conscientiousness.toFixed(2), E: +h.extraversion.toFixed(2), A: +h.agreeableness.toFixed(2) } }; }
    // Include the commander's current HEXACO so the dashboard can plot
    // the commander trajectory arc alongside promoted agents. Baseline
    // is commanderHexacoHistory[0] (exported at run end); the per-turn
    // current is sent here so the arc can build up live.
    const commanderHexacoSnapshot = {
      openness: +commanderHexacoLive.openness.toFixed(3),
      conscientiousness: +commanderHexacoLive.conscientiousness.toFixed(3),
      extraversion: +commanderHexacoLive.extraversion.toFixed(3),
      agreeableness: +commanderHexacoLive.agreeableness.toFixed(3),
      emotionality: +commanderHexacoLive.emotionality.toFixed(3),
      honestyHumility: +commanderHexacoLive.honestyHumility.toFixed(3),
    };
    emit('personality_drift', { turn, time, agents: driftData, commander: commanderHexacoSnapshot });

    // Agent reactions (once per turn, reacting to ALL events). Runs the
    // full roster on turn 1; turn 2+ uses progressive reactions to pick
    // only agents materially affected by this turn's events (featured +
    // promoted heads + dept-relevant, capped at 30). See reaction-step.ts.
    // Abort gate: reactions are batched but still fire many LLM calls
    // (up to ~30 per turn on turn 1). Skip them entirely if the run
    // was aborted between dept analysis and this step.
    if (shouldStop()) {
      console.log(`  [abort] Skipping reactions for turn ${turn}.`);
      continue;
    }
    const reactionResult = await runReactionStep({
      kernel,
      scenario: sc,
      turn, time, seed,
      turnEvents,
      turnEventTitles,
      lastEventCategory,
      lastOutcome,
      provider,
      apiKey: providerApiKey,
      modelConfig,
      execution: opts.execution,
      trackUsage,
      reportProviderError,
      recordSchemaAttempt,
      emit,
    });
    reactions = reactionResult.reactions;
    if (reactionResult.moodSummary) lastTurnMoodSummary = reactionResult.moodSummary;

    // Accumulate reactions for the run-wide log (also surfaced via SSE).
    if (reactions.length) {
      allAgentReactions.push({ turn, time, reactions });
    }

    const after = kernel.getState();
    // Bundle this turn's full data into the artifact (was empty placeholders
    // before — meant the runSimulation() return value silently dropped
    // every department report and commander decision the SSE stream had).
    const mergedDecision = turnDecisions.length === 1
      ? turnDecisions[0]
      : turnDecisions.reduce(
          (acc, d) => ({
            ...acc,
            decision: [acc.decision, d.decision].filter(Boolean).join(' | '),
            rationale: [acc.rationale, d.rationale].filter(Boolean).join(' | '),
            selectedPolicies: [...(acc.selectedPolicies || []), ...(d.selectedPolicies || [])],
            rejectedPolicies: [...(acc.rejectedPolicies || []), ...(d.rejectedPolicies || [])],
            expectedTradeoffs: [...(acc.expectedTradeoffs || []), ...(d.expectedTradeoffs || [])],
            watchMetricsNextTurn: [...(acc.watchMetricsNextTurn || []), ...(d.watchMetricsNextTurn || [])],
          }),
          emptyDecision(sc.departments.map(d => d.id as Department)),
        );
    artifacts.push({
      turn, time, crisis: turnEventTitles.join(' / '),
      departmentReports: turnDeptReports.slice(),
      commanderDecision: mergedDecision,
      policyEffectsApplied: turnPolicyEffects.slice(),
      stateSnapshotAfter: {
        // Metrics bag (Mars heritage: population, morale, food,
        // infra, science, etc) plus births/deaths computed ad-hoc this
        // turn. Declared capacities remain in metrics for back-compat
        // and are also projected into `capacities` below.
        ...projectSystemBags(after.metrics, sc, { births, deaths }),
        // Optional bags: only emit when the scenario declared something.
        // Empty bags land as `undefined` via conditional spread so
        // consumers can check `if (ta.stateSnapshotAfter.statuses)` cheaply.
        ...(Object.keys(after.statuses).length > 0 ? { statuses: { ...after.statuses } } : {}),
        ...(Object.keys(after.politics).length > 0 ? { politics: { ...after.politics } } : {}),
        ...(Object.keys(after.environment).length > 0 ? { environment: { ...after.environment } } : {}),
      },
    });
    // Per-turn kernel snapshot for WorldModel.forkFromArtifact. Opt-in
    // via opts.captureSnapshots; adds ~100 KB per turn for 100-agent
    // Mars-shape runs, so it's off by default.
    if (opts.captureSnapshots) {
      kernelSnapshotsPerTurn.push(kernel.toSnapshot(sc.id));
    }
    console.log(`  State: Pop ${after.metrics.population} | Morale ${Math.round(after.metrics.morale * 100)}% | Food ${after.metrics.foodMonthsReserve.toFixed(1)}mo`);
    // Death cause breakdown for this turn: maps attributed causes from
    // the kernel (natural causes, radiation cancer, starvation, despair,
    // fatal fracture, accident: X) to counts so the dashboard can
    // render "3 lost: 2 radiation cancer, 1 accident" instead of a
    // faceless total. Accident sub-types collapse to 'accident' for
    // the roll-up; the detailed descriptor stays in the individual
    // event for anyone reading the raw log.
    const deathsThisTurn = after.eventLog.filter(e => e.turn === turn && e.type === 'death');
    const deathCauses: Record<string, number> = {};
    for (const d of deathsThisTurn) {
      const raw = (d as unknown as { cause?: string }).cause ?? 'unknown';
      const key = raw.startsWith('accident:') ? 'accident' : raw;
      deathCauses[key] = (deathCauses[key] ?? 0) + 1;
    }
    emit('turn_done', {
      turn, time,
      metrics: after.metrics,
      statuses: Object.keys(after.statuses).length > 0 ? { ...after.statuses } : undefined,
      environment: Object.keys(after.environment).length > 0 ? { ...after.environment } : undefined,
      toolsForged: Object.values(toolRegs).flat().length,
      totalEvents: turnEvents.length,
      deathCauses: Object.keys(deathCauses).length > 0 ? deathCauses : undefined,
    });

    // Emit full agent roster for swarm visualization.
    //
    // Generation depth: 0 = earth-born ancestor, N = N levels of native-born descent.
    // Mars-born agents get gen >= 1. Computed by walking parent chain when possible,
    // otherwise inferred from age (younger native-borns = deeper generation).
    const agentById = new Map(after.agents.map(a => [a.core.id, a]));
    const generationCache = new Map<string, number>();
    const computeGeneration = (id: string, depth = 0): number => {
      if (depth > 10) return depth; // safety guard
      const cached = generationCache.get(id);
      if (cached !== undefined) return cached;
      const agent = agentById.get(id);
      if (!agent) return 0;
      if (!agent.core.marsborn) {
        generationCache.set(id, 0);
        return 0;
      }
      // Find parents by scanning who lists this agent as a child
      const parents = after.agents.filter(p => p.social.childrenIds.includes(id));
      if (parents.length === 0) {
        generationCache.set(id, 1);
        return 1;
      }
      const parentGen = Math.max(...parents.map(p => computeGeneration(p.core.id, depth + 1)));
      const gen = parentGen + 1;
      generationCache.set(id, gen);
      return gen;
    };

    const snapshotAgents = after.agents.map(a => ({
      agentId: a.core.id,
      name: a.core.name,
      department: a.core.department,
      role: a.core.role,
      rank: a.career.rank,
      alive: a.health.alive,
      marsborn: a.core.marsborn,
      psychScore: a.health.psychScore,
      age: Math.max(0, time - a.core.birthTime),
      generation: computeGeneration(a.core.id),
      partnerId: a.social.partnerId,
      childrenIds: a.social.childrenIds,
      featured: a.narrative.featured,
      mood: reactions.find(r => r.agentId === a.core.id)?.mood || 'neutral',
      shortTermMemory: (a.memory?.shortTerm || []).slice(-2).map(m => m.content),
    }));
    emit('systems_snapshot', {
      turn, time,
      agents: snapshotAgents,
      population: after.metrics.population,
      morale: after.metrics.morale,
      foodReserve: after.metrics.foodMonthsReserve,
      births, deaths,
    });
    latestSwarmSnapshot = {
      turn,
      time,
      agents: snapshotAgents,
      population: after.metrics.population,
      morale: after.metrics.morale,
      births,
      deaths,
    };
    } catch (err) {
      // Classify first: if this is a terminal quota/auth error it flips
      // the run-abort flag and the next turn will be skipped entirely via
      // the isAborted() gate instead of falling into this degraded path.
      reportProviderError(err, `turn${turn}:fatal`);
      console.error(`  [turn ${turn}] FATAL: ${err}`);
      // Emit a degraded systems_snapshot so the dashboard doesn't get stuck
      const fallbackAgents = kernel.getState().agents.map(a => ({
        agentId: a.core.id, name: a.core.name, department: a.core.department, role: a.core.role,
        rank: a.career.rank, alive: a.health.alive, marsborn: a.core.marsborn,
        psychScore: a.health.psychScore,
        age: Math.max(0, time - a.core.birthTime),
        generation: a.core.marsborn ? 1 : 0,
        partnerId: a.social.partnerId,
        childrenIds: a.social.childrenIds, featured: a.narrative.featured,
        mood: 'neutral', shortTermMemory: [],
      }));
      emit('systems_snapshot', {
        turn, time, agents: fallbackAgents,
        population: kernel.getState().metrics.population,
        morale: kernel.getState().metrics.morale,
        foodReserve: kernel.getState().metrics.foodMonthsReserve,
        births: 0, deaths: 0,
      });
      {
        const st = kernel.getState();
        emit('turn_done', {
          turn, time,
          metrics: st.metrics,
          statuses: Object.keys(st.statuses).length > 0 ? { ...st.statuses } : undefined,
          environment: Object.keys(st.environment).length > 0 ? { ...st.environment } : undefined,
          toolsForged: Object.values(toolRegs).flat().length,
          error: String(err),
        });
      }
    }
  }

  const final = kernel.export();

  // Build colonist trajectories for promoted leaders
  const trajectories = Object.fromEntries(
    final.agents
      .filter(c => c.promotion && c.hexacoHistory.length > 1)
      .map(c => [c.core.id, {
        name: c.core.name,
        promotedTurn: c.promotion!.turnPromoted,
        promotedAs: c.promotion!.role,
        promotedBy: c.promotion!.promotedBy,
        hexacoTrajectory: c.hexacoHistory,
      }])
  );

  // Compute timeline fingerprint. Always start from the generic engine-
  // level fingerprint (resilience / innovation / riskStyle / decision
  // discipline / tool counts) so EVERY scenario gets these classifications
  // for free. Scenario hooks layer their own domain-specific fields on
  // top (e.g., Mars: autonomy, marsbornFraction). Hook output keys win
  // on conflict so authors can override generic values intentionally.
  const { genericFingerprint } = await import('../generic-fingerprint.js');
  const generic = genericFingerprint(final, outcomeLog, leader, toolRegs, maxTurns);
  const scenarioOverlay = sc.hooks.fingerprintHook
    ? sc.hooks.fingerprintHook(final, outcomeLog, leader, toolRegs, maxTurns)
    : {};
  const fingerprint = { ...generic, ...scenarioOverlay };

  // Canonical Forged Toolbox: deduplicated by tool name with first-forge
  // metadata, full invocation history, and reuse/rejection rollups.
  // Matches the data the dashboard's ToolboxSection renders.
  const forgedToolbox = buildForgedToolbox(forgedLedger, allForges);

  // Flat unique citation list across all department reports. URL is the
  // dedup key; each entry carries the departments + turns that cited it.
  const citationCatalog = buildCitationCatalog(allDepartmentReports);

  // Build the public RunArtifact. Internal paracosm fields (tool
  // registries, director events, forge attempts, outcome log, agent
  // trajectories, leader HEXACO history) stash under
  // scenarioExtensions.paracosmInternal so internal callers (pair-runner,
  // save files, tests) keep their access paths while the universal
  // top-level shape stays consumer-friendly.
  // Flatten commander decisions into the public-shape DecisionSchema
  // (top-level fields, not nested under `.decision.*`).
  // TurnOutcome and DecisionOutcome are identical string-literal unions
  // (['risky_success','risky_failure','conservative_success','conservative_failure']);
  // the cast names the target type instead of the `never` escape hatch.
  const commanderDecisionsForArtifact = allCommanderDecisions.map((cd) => ({
    turn: cd.turn,
    time: cd.time,
    actor: leader.name,
    decision: cd.decision.decision,
    rationale: cd.decision.rationale ?? '',
    reasoning: cd.decision.reasoning,
    outcome: cd.outcome as Decision['outcome'],
  }));

  const peSnapshot = providerErrorState as ClassifiedProviderError | null;
  const labelsRecord = sc.labels as unknown as Record<string, unknown>;
  const finalCost = costTracker.finalCost();

  const output: RunArtifact = buildRunArtifact({
    runId: `${sc.labels.shortName}-${archetypeSlug}-${Date.now()}`,
    scenarioId: sc.id,
    scenarioName: sc.labels.name,
    seed: opts.seed,
    mode: 'turn-loop',
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    timeUnit: {
      singular: (labelsRecord.timeUnitNoun as string) ?? 'time',
      plural: (labelsRecord.timeUnitNounPlural as string) ?? 'years',
    },
    turnArtifacts: artifacts as never,
    commanderDecisions: commanderDecisionsForArtifact,
    forgedToolbox: forgedToolbox as never,
    citationCatalog: citationCatalog as never,
    agentReactions: allAgentReactions,
    finalState: {
      metrics: final.metrics as unknown as Record<string, number>,
      capacities: projectSystemBags(final.metrics as unknown as Record<string, number>, sc).capacities,
      politics: final.politics as unknown as Record<string, number | string | boolean>,
      statuses: final.statuses,
      environment: final.environment,
      metadata: final.metadata,
    },
    finalSwarm: latestSwarmSnapshot,
    fingerprint,
    cost: {
      totalUSD: finalCost.totalCostUSD,
      llmCalls: finalCost.llmCalls,
      inputTokens: undefined,
      outputTokens: undefined,
      cachedReadTokens: undefined,
    },
    providerError: peSnapshot
      ? {
          kind: peSnapshot.kind,
          provider: peSnapshot.provider ?? 'unknown',
          message: peSnapshot.message,
          actionUrl: peSnapshot.actionUrl,
        }
      : null,
    aborted: externallyAborted,
    subject: opts.subject,
    intervention: opts.intervention,
    scenarioExtensionsExtra: {
      paracosmInternal: {
        simulation: `${sc.id}-v3`,
        leader: {
          name: leader.name,
          archetype: leader.archetype,
          unit: leader.unit,
          hexaco: commanderHexacoLive,
          hexacoBaseline: { ...leader.hexaco },
          hexacoHistory: commanderHexacoHistory,
        },
        turnArtifacts: artifacts,
        finalState: final,
        toolRegistries: toolRegs,
        agentTrajectories: trajectories,
        outcomeClassifications: outcomeLog,
        directorEvents: allDirectorEvents,
        commanderDecisions: allCommanderDecisions,
        forgeAttempts: allForges,
        totalCitations: citationCatalog.length,
        totalToolsForged: forgedToolbox.length,
      },
      // Opt-in per-turn kernel snapshots for WorldModel.forkFromArtifact.
      // Only emitted when opts.captureSnapshots was on AND at least one
      // turn actually ran; otherwise left off so normal artifacts stay
      // lean.
      ...(kernelSnapshotsPerTurn.length > 0
        ? { kernelSnapshotsPerTurn }
        : {}),
    },
    forkedFrom: opts._forkedFrom,
  });

  const writtenPath = writeRunOutput(output, {
    actorName: leader.name,
    actorArchetype: leader.archetype,
    turns: artifacts.length,
    toolRegs,
  });
  // Stash the on-disk path on scenarioExtensions so server-app can
  // enrich the SQLite RunRecord at run-end. /api/v1/runs/:runId reads
  // record.artifactPath to load the full artifact via the Library tab.
  const extObj = (output.scenarioExtensions ?? {}) as Record<string, unknown>;
  extObj.outputPath = writtenPath;
  output.scenarioExtensions = extObj as RunArtifact['scenarioExtensions'];

  engine.cleanupSession(sid);
  await closeResearchMemory();
  await commander.close();
  for (const a of deptAgents.values()) await a.close();
  return output;
}

// ─────────────────────────────────────────────────────────────────────
// Replay
// ─────────────────────────────────────────────────────────────────────

/**
 * Thrown by {@link replaySimulation} when the input artifact lacks the
 * preconditions for deterministic replay (missing per-turn kernel
 * snapshots, missing recorded decisions, or a scenario id mismatch).
 */
export class WorldModelReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldModelReplayError';
  }
}

/**
 * Re-execute the kernel transitions captured in a stored RunArtifact.
 *
 * Implementation note (2026-04-25): the v1 replay is a kernel
 * progression-hook re-execution. It restores the kernel from each
 * recorded snapshot and re-runs `advanceTurn` between snapshots,
 * capturing fresh snapshots produced by the current kernel code. The
 * caller compares fresh snapshots to the input artifact's snapshots
 * (via canonicalJson on the kernelSnapshotsPerTurn arrays) to verify
 * kernel determinism: byte-equal arrays prove the progression hook is
 * unchanged since the original run.
 *
 * Out of scope for v1: re-applying recorded decisions via
 * `kernel.applyPolicy()`. The orchestrator's policy-application path
 * requires the full department reports, which the public RunArtifact
 * does not preserve in the shape `decisionToPolicy()` expects. A
 * follow-up spec adds policy replay once department reports are
 * normalized into a replay-ready shape on the artifact.
 *
 * Used by {@link WorldModel.replay}. Direct callers should prefer the
 * façade method.
 *
 * @param scenario The compiled scenario the artifact was produced from.
 *                 Must match `artifact.metadata.scenario.id`.
 * @param artifact The stored RunArtifact to replay.
 * @returns A fresh RunArtifact with kernelSnapshotsPerTurn produced by
 *          the current code's kernel. Other fields copy from the input.
 * @throws WorldModelReplayError when preconditions are not met.
 */
export async function replaySimulation(
  scenario: ScenarioPackage,
  artifact: RunArtifact,
): Promise<RunArtifact> {
  if (artifact.metadata.scenario.id !== scenario.id) {
    throw new WorldModelReplayError(
      `Scenario id mismatch: artifact was produced from '${artifact.metadata.scenario.id}' ` +
      `but replay is being attempted against '${scenario.id}'. Cross-scenario replay is not supported.`,
    );
  }

  const inputSnaps = (artifact.scenarioExtensions as { kernelSnapshotsPerTurn?: import('../../engine/core/snapshot.js').KernelSnapshot[] } | undefined)?.kernelSnapshotsPerTurn;
  if (!inputSnaps || inputSnaps.length === 0) {
    throw new WorldModelReplayError(
      `Replay requires per-turn kernel snapshots. The input artifact has none. ` +
      `Re-run the original simulation with \`captureSnapshots: true\` on the RunOptions ` +
      `to enable replay on the resulting artifact.`,
    );
  }

  const recordedDecisions = artifact.decisions;
  if (!recordedDecisions || recordedDecisions.length === 0) {
    throw new WorldModelReplayError(
      `Replay requires recorded decisions on the input artifact. ` +
      `The supplied artifact's \`decisions\` field is empty or missing.`,
    );
  }

  // Re-execute the deterministic between-turn progression hook from
  // each snapshot to the next. Fresh snapshots are captured immediately
  // after each advanceTurn call.
  const freshSnapshots: import('../../engine/core/snapshot.js').KernelSnapshot[] = [inputSnaps[0]];
  for (let i = 0; i < inputSnaps.length - 1; i++) {
    const here = inputSnaps[i];
    const next = inputSnaps[i + 1];
    const kernel = SimulationKernel.fromSnapshot(here, scenario.id);
    kernel.advanceTurn(next.turn, next.time, scenario.hooks?.progressionHook);
    freshSnapshots.push(kernel.toSnapshot(scenario.id));
  }

  const freshRunId = `replay-${artifact.metadata.runId}-${Date.now().toString(36)}`;
  const freshArtifact: RunArtifact = {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      runId: freshRunId,
    },
    scenarioExtensions: {
      ...(artifact.scenarioExtensions ?? {}),
      kernelSnapshotsPerTurn: freshSnapshots,
    },
  };
  return freshArtifact;
}
