import type { KeyPersonnel } from '../engine/core/agent-generator.js';
import type { Department } from '../engine/core/state.js';
import type { ActorConfig } from './types.js';
import {
  resolveEconomicsProfile,
  type ResolvedEconomicsProfile,
  type SimulationEconomicsProfileId,
} from '../runtime/economics/economics-profile.js';

export interface SimulationModelConfig {
  commander: string;
  departments: string;
  judge: string;
  director: string;
  agentReactions?: string;
}

export type LlmProvider = 'openai' | 'anthropic';

export interface StartingResources {
  foodMonthsReserve: number;
  waterLitersPerDay: number;
  powerKw: number;
  morale: number;
  pressurizedVolumeM3: number;
  lifeSupportCapacity: number;
  infrastructureModules: number;
  scienceOutput: number;
}

export interface StartingPolitics {
  earthDependencyPct: number;
}

export interface SimulationExecutionConfig {
  commanderMaxSteps: number;
  departmentMaxSteps: number;
  sandboxTimeoutMs: number;
  sandboxMemoryMB: number;
  /**
   * Agents per reaction LLM call. Default 10. Set to 1 for one-call-per-
   * agent (legacy, most expensive). Set to 20 for fewest calls but
   * higher risk of one bad batch losing 20 reactions.
   */
  reactionBatchSize: number;
  /**
   * When true (default), only featured + promoted + event-relevant
   * agents react on turns 2+. Turn 1 always runs a full reaction pass
   * to establish baseline memories and relationships. Cuts ~70% of
   * reaction calls after turn 1 with minor memory-sparsity tradeoff
   * (non-reacting agents don't update shortTerm memory that turn, but
   * their crisis/decision/outcome memory entries still land).
   */
  progressiveReactions: boolean;
}

export interface SimulationSetupPayload {
  actors: ActorConfig[];
  provider?: LlmProvider;
  turns?: number;
  seed?: number;
  startTime?: number;
  timePerTurn?: number;
  population?: number;
  liveSearch?: boolean;
  activeDepartments?: Department[];
  customEvents?: Array<{ turn: number; title: string; description: string }>;
  keyPersonnel?: KeyPersonnel[];
  startingResources?: Partial<{
    food: number;
    water: number;
    power: number;
    morale: number;
    pressurizedVolumeM3: number;
    lifeSupportCapacity: number;
    infrastructureModules: number;
    scienceOutput: number;
  }>;
  startingPolitics?: Partial<StartingPolitics>;
  execution?: Partial<SimulationExecutionConfig>;
  models?: Partial<SimulationModelConfig>;
  apiKey?: string;
  anthropicKey?: string;
  serperKey?: string;
  firecrawlKey?: string;
  tavilyKey?: string;
  cohereKey?: string;
  economics?: {
    profileId?: SimulationEconomicsProfileId;
    batchConcurrency?: number;
  };
  /**
   * Optional fork parent. When set, the run resumes from the supplied
   * parent artifact at `atTurn` rather than starting fresh. Server
   * calls `WorldModel.forkFromArtifact(parentArtifact, atTurn)` and
   * simulates from `atTurn + 1` forward. Spec 2B.
   */
  forkFrom?: { parentArtifact: import('../engine/schema/index.js').RunArtifact; atTurn: number };
  /**
   * Opt-in kernel snapshot capture. Dashboard sets this to true for
   * every UI-initiated run so forks are always possible. Default off
   * for programmatic consumers (per Spec 2A). Spec 2B.
   */
  captureSnapshots?: boolean;
  /**
   * Optional Quickstart metadata. When present, the run is a quickstart
   * session: leaders were LLM-generated from a seed, and the dashboard
   * routes the completion to the Quickstart tab instead of the Reports
   * tab. Tier 5.
   */
  quickstart?: { scenarioId: string };
}

export interface NormalizedSimulationConfig {
  actors: ActorConfig[];
  provider: LlmProvider;
  turns: number;
  seed: number;
  startTime: number;
  timePerTurn?: number;
  initialPopulation: number;
  liveSearch: boolean;
  activeDepartments: Department[];
  customEvents: Array<{ turn: number; title: string; description: string }>;
  keyPersonnel: KeyPersonnel[];
  startingResources: StartingResources;
  startingPolitics: StartingPolitics;
  execution: SimulationExecutionConfig;
  models: SimulationModelConfig;
  economics: ResolvedEconomicsProfile;
  apiKey?: string;
  anthropicKey?: string;
  serperKey?: string;
  firecrawlKey?: string;
  tavilyKey?: string;
  cohereKey?: string;
  /** Fork parent + turn; populated from SimulationSetupPayload.forkFrom. */
  forkFrom?: { parentArtifact: import('../engine/schema/index.js').RunArtifact; atTurn: number };
  /** Whether the orchestrator should stash per-turn kernel snapshots. */
  captureSnapshots?: boolean;
  /** Quickstart metadata; populated from SimulationSetupPayload.quickstart. */
  quickstart?: { scenarioId: string };
}

export const DEFAULT_KEY_PERSONNEL: KeyPersonnel[] = [
  { name: 'Dr. Yuki Tanaka', department: 'medical', role: 'Chief Medical Officer', specialization: 'Radiation Medicine', age: 38, featured: true },
  { name: 'Erik Lindqvist', department: 'engineering', role: 'Chief Engineer', specialization: 'Structural Engineering', age: 45, featured: true },
  { name: 'Amara Osei', department: 'agriculture', role: 'Head of Agriculture', specialization: 'Hydroponics', age: 34, featured: true },
  { name: 'Dr. Priya Singh', department: 'psychology', role: 'Colony Psychologist', specialization: 'Clinical Psychology', age: 41, featured: true },
  { name: 'Carlos Fernandez', department: 'science', role: 'Chief Scientist', specialization: 'Geology', age: 50, featured: true },
];

/**
 * Default model assignments per provider.
 *
 * Tier strategy (verified against live provider rate cards 2026-04-16):
 *
 * - `departments` stays on flagship because departments forge tools. Writing
 *   correct code, schemas, and test cases needs real reasoning. Cheap
 *   models produce broken forges that waste judge calls and lower the tool
 *   approval rate.
 *
 * - `commander` drops to mid-tier. The commander reads already-written
 *   reports and picks an option. No code, no schemas, no novel reasoning.
 *   Mid-tier handles it at ~20% of flagship cost.
 *
 * - `director` drops to mid-tier. The director emits structured batch JSON
 *   from world state plus a research packet. Structured output on a
 *   well-cached system prompt is a mid-tier task. The cacheBreakpoint on
 *   the system prompt (see director.ts) already cuts repeat-turn cost.
 *
 * - `judge` stays mid-tier (was cheapest). Judges that approve bad code are
 *   a net loss because approved tools run in a sandbox against real state
 *   and waste downstream tokens. Mid-tier judge is ~$0.01 per call and
 *   worth the uplift from nano/mini reviews.
 *
 * - `agentReactions` drops to the cheapest class. ~100 colonists × 6 turns
 *   = 600 one-to-two-sentence parallel calls per run. The 5.4-nano tier
 *   (OpenAI) or haiku (Anthropic) is the right place for pure volume.
 *
 * Expected per-run spend at 6 turns, 5 departments, 100 colonists, on OpenAI:
 *   old defaults (all flagship for commander/depts/director): ~$35-45
 *   new defaults:                                              ~$8-12
 */
export const DEFAULT_MODELS: Record<LlmProvider, SimulationModelConfig> = {
  openai: {
    // Flagship: forge code correctness.
    departments: 'gpt-5.4',
    // gpt-4o for commander: gpt-5.4-mini was failing CommanderDecisionSchema
    // validation 3 attempts in a row (10 fields, nested arrays). Result was
    // visible to users as "Commander decision unavailable; defer to
    // department consensus" in artifacts. gpt-4o was tuned for JSON-mode
    // / structured-output reliability and handles the schema cleanly.
    // Same input price as gpt-5.4 ($2.50/M), $10/M output (vs $15/M on
    // 5.4). Net per-run cost: ~$0.20 (was ~$0.15) for 6 turns.
    commander: 'gpt-4o',
    director: 'gpt-5.4-mini',
    judge: 'gpt-5.4-mini',
    // Cheapest: high-volume parallel reactions.
    agentReactions: 'gpt-5.4-nano',
  },
  anthropic: {
    // Flagship: forge code correctness.
    departments: 'claude-sonnet-4-6',
    // Mid-tier: structured output, no novel code.
    commander: 'claude-haiku-4-5-20251001',
    director: 'claude-haiku-4-5-20251001',
    judge: 'claude-haiku-4-5-20251001',
    // Cheapest: high-volume parallel reactions.
    agentReactions: 'claude-haiku-4-5-20251001',
  },
};

/**
 * Default per-agent step caps.
 *
 * commanderMaxSteps: 5 — commander rarely loops, decision is usually one
 *   shot with rationale. 5 is headroom, not a target.
 *
 * departmentMaxSteps: 4 — a normal dept call is 3 steps (prompt → forge →
 *   final JSON). 4 allows one retry. Previously 8, which doubled the
 *   ceiling on misbehaving model tool-call loops and cost 5 extra
 *   flagship-tier calls per incident before timing out. Lowered after
 *   cost telemetry showed real spend during bad forge loops.
 */
export const DEFAULT_EXECUTION: SimulationExecutionConfig = {
  commanderMaxSteps: 5,
  departmentMaxSteps: 4,
  sandboxTimeoutMs: 10000,
  sandboxMemoryMB: 128,
  reactionBatchSize: 10,
  progressiveReactions: true,
};

/**
 * Demo-mode model assignments. Used when a request arrives without a
 * user-supplied API key, i.e. when the run bills against the host's
 * provider keys. Tiered to keep the demo cost floor bounded while
 * avoiding the "wall of FAILs" behavior that pure-cheapest defaults
 * produce on forge-heavy tasks.
 *
 * Departments are the tier that forges code. The forge pipeline enforces
 * schema-implementation consistency, uses-every-declared-input, and
 * bounded output, and the judge rejects code that misses any of those.
 * The cheapest class (nano / haiku-by-cost-equivalent) is too weak to
 * consistently pass the judge: declared inputs get dropped, outputs
 * saturate to 0, re-forge loops triple the toolbox entries without
 * producing a usable tool. Bumping departments to the mid class cuts
 * the FAIL rate by 2-3x at roughly +$0.25 per 3-turn demo.
 *
 * Commander, director, judge, and reactions stay on the cheapest class
 * because their outputs are either short structured selections or pure
 * volume fan-outs, which the cheap tier handles fine.
 */
export const DEMO_MODELS: Record<LlmProvider, SimulationModelConfig> = {
  openai: {
    // gpt-4o for departments. gpt-4o-mini kept copying the worked
    // example verbatim for one forge and then emitting empty-property
    // schemas for every other attempt, even with maxSteps:3 giving
    // it room to retry. Stepping up to full gpt-4o ($10/M output —
    // half of gpt-5.4 flagship, 16x gpt-4o-mini) for consistent
    // structured-schema compliance on the forge path. Department
    // volume is bounded by departmentMaxSteps:3 and the ~3 depts/turn
    // demo cap, so per-run cost stays well under $1.
    //
    // Earlier this session we tried switching to gpt-5.4-mini on the
    // theory that the 611f651 forge-guidance prompt fix removed the
    // need for the stronger model. That theory ignored that the
    // verbatim-copying failure mode (the second of two reasons gpt-4o-
    // mini failed) is a capability ceiling, not a prompt-fixable
    // issue, and gpt-5.4-mini sits closer to gpt-4o-mini than to
    // gpt-4o on the model spectrum. With 100k users hitting the
    // hosted demo, demo quality outweighs ~$0.40/run savings. If we
    // want to revisit, test gpt-5.4-mini offline against real
    // scenarios and inspect forges by hand before flipping prod.
    departments: 'gpt-4o',
    commander: 'gpt-5.4-nano',
    director: 'gpt-5.4-nano',
    judge: 'gpt-5.4-nano',
    agentReactions: 'gpt-5.4-nano',
  },
  anthropic: {
    // Anthropic has a two-tier mini-vs-cheapest gap much smaller than
    // OpenAI's, so we keep departments on the dedicated coding-and-
    // agents tier (Sonnet) in demo mode. That is a bigger cost bump
    // than the OpenAI equivalent; hosted-demo sites that prefer the
    // Anthropic stack should verify the cost math before shipping.
    departments: 'claude-sonnet-4-6',
    commander: 'claude-haiku-4-5-20251001',
    director: 'claude-haiku-4-5-20251001',
    judge: 'claude-haiku-4-5-20251001',
    agentReactions: 'claude-haiku-4-5-20251001',
  },
};

/**
 * Demo-mode execution caps. Enforced server-side when the request has no
 * user API key. Caps apply on top of whatever the client posted.
 *
 *   turns:        6 → 3  (halves flagship calls per sim)
 *   population:  100 → 30 (cuts reaction fan-out by 70%)
 *   departments:  5 → 3  (fewer parallel forges per turn)
 *   max steps:   4-5 → 3 (tighter cap on misbehaving tool loops)
 *
 * Sandbox limits stay identical to DEFAULT_EXECUTION — they protect the
 * host process from runaway forged code regardless of who is paying.
 */
/**
 * Resolve the demo-mode turn cap. Source of truth is the
 * PARACOSM_DEMO_MAX_TURNS env var, clamped to [1, 20]. Lets operators
 * flip between recording mode (bump the env var, pm2 restart) and
 * normal hosted operation without a code push. Default is 6 for the
 * current cloud recording window; revert to a lower value (e.g. 3)
 * after the recording session by setting PARACOSM_DEMO_MAX_TURNS=3
 * in /opt/paracosm/.env and `pm2 restart paracosm`.
 */
function resolveDemoMaxTurns(): number {
  const raw = typeof process !== 'undefined' && process.env
    ? process.env.PARACOSM_DEMO_MAX_TURNS
    : undefined;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) return parsed;
  return 6;
}

export const DEMO_EXECUTION: SimulationExecutionConfig & {
  maxTurns: number;
  maxPopulation: number;
  maxActiveDepartments: number;
} = {
  commanderMaxSteps: 2,
  // Three steps gives the dept loop enough room to: forge attempt #1,
  // see the shape-validator or judge rejection, retry with the fix,
  // and write the final report. At 2 steps a shape-check rejection
  // burned the model's only retry and the tool never entered the
  // registry, so the reuse economy never got started. gpt-4o-mini
  // tokens per step are much cheaper than gpt-5.4-mini's were, so the
  // extra step's cost is well within the demo envelope.
  departmentMaxSteps: 3,
  sandboxTimeoutMs: 10000,
  sandboxMemoryMB: 128,
  reactionBatchSize: 10,
  progressiveReactions: true,
  maxTurns: resolveDemoMaxTurns(),
  maxPopulation: 30,
  maxActiveDepartments: 3,
};

const DEFAULT_ACTIVE_DEPARTMENTS: Department[] = ['medical', 'engineering', 'agriculture', 'psychology', 'governance'];

export function inferProviderFromModel(model?: string): LlmProvider | undefined {
  if (!model) return undefined;
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o')) return 'openai';
  return undefined;
}

/**
 * Infer the run's provider from the API keys the user actually supplied
 * for the session. Takes precedence over model-name inference because
 * when a user pastes only one key and leaves the model dropdowns at the
 * default OpenAI values, their intent is clearly to run against the
 * provider whose key they provided — the model tier just hasn't been
 * updated in the UI.
 *
 * Returns `'anthropic'` when the user supplied only an Anthropic key,
 * `'openai'` when only an OpenAI key, and `undefined` when both or
 * neither are present (ambiguous — defer to the next signal).
 *
 * Filters out the `...` masking string the settings panel posts when
 * a stored key is unchanged, and blank/whitespace strings.
 *
 * @param apiKey    OpenAI API key from the session payload.
 * @param anthropicKey Anthropic API key from the session payload.
 */
export function inferProviderFromKeys(
  apiKey?: string,
  anthropicKey?: string,
): LlmProvider | undefined {
  const isRealKey = (key: string | undefined): boolean => {
    if (typeof key !== 'string') return false;
    const trimmed = key.trim();
    if (!trimmed) return false;
    // Settings UI posts '...' / '...masked...' when the field wasn't
    // edited, so strip those before considering the key "set".
    if (trimmed.includes('...')) return false;
    return true;
  };
  const hasOpenai = isRealKey(apiKey);
  const hasAnthropic = isRealKey(anthropicKey);
  if (hasAnthropic && !hasOpenai) return 'anthropic';
  if (hasOpenai && !hasAnthropic) return 'openai';
  return undefined;
}

/**
 * Cost-vs-quality preset for `runSimulation` model routing.
 *
 * - `'quality'` (default): `DEFAULT_MODELS` — departments on flagship
 *   (`gpt-5.4` / `claude-sonnet-4-6`) for reliable tool forging, other
 *   roles on mid/cheap tier. Per-run spend ~$1-3 on OpenAI, ~$3-7 on
 *   Anthropic at 6 turns × 5 depts × 100 agents.
 *
 * - `'economy'`: `DEMO_MODELS` — departments on `gpt-4o` (half the
 *   cost of flagship, adequate for forge shape compliance on most
 *   scenarios), everything else on `gpt-5.4-nano` / Haiku. Per-run
 *   spend drops to ~$0.20-0.60 on OpenAI. Use for quick iteration;
 *   forge approval rate drops ~10-20pp vs quality.
 *
 * Explicit `models` overrides always win over the preset.
 */
export type CostPreset = 'quality' | 'economy';

export function resolveSimulationModels(
  provider: LlmProvider,
  models?: Partial<SimulationModelConfig>,
  costPreset: CostPreset = 'quality',
): SimulationModelConfig {
  const defaults = costPreset === 'economy' ? DEMO_MODELS[provider] : DEFAULT_MODELS[provider];
  const normalizeModel = (
    requested: string | undefined,
    fallback: string,
  ): string => {
    if (!requested) return fallback;
    return inferProviderFromModel(requested) === provider ? requested : fallback;
  };

  return {
    commander: normalizeModel(models?.commander, defaults.commander),
    departments: normalizeModel(models?.departments, defaults.departments),
    judge: normalizeModel(models?.judge, defaults.judge),
    director: normalizeModel(models?.director ?? models?.commander, defaults.director),
    // agentReactions runs once per alive agent per turn (~100 calls), so it
    // intentionally defaults to a cheaper model. Was being dropped here,
    // forcing the orchestrator to fall back to a hardcoded gpt-4o-mini even
    // when the run is on Anthropic.
    agentReactions: normalizeModel(models?.agentReactions, defaults.agentReactions ?? defaults.departments),
  };
}

function normalizeCustomEvents(
  input: SimulationSetupPayload['customEvents'],
): Array<{ turn: number; title: string; description: string }> {
  return (input ?? [])
    .filter((event): event is NonNullable<SimulationSetupPayload['customEvents']>[number] =>
      !!event && Number.isFinite(event.turn) && event.turn > 0 && !!event.title?.trim())
    .map(event => ({
      turn: Math.trunc(event.turn),
      title: event.title.trim(),
      description: event.description?.trim() ?? '',
    }))
    .sort((a, b) => a.turn - b.turn);
}

function normalizeActiveDepartments(input: SimulationSetupPayload['activeDepartments']): Department[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_ACTIVE_DEPARTMENTS];
  }

  const requested = input;
  const active = new Set<Department>(['medical', 'engineering']);

  for (const dept of requested) {
    if (DEFAULT_ACTIVE_DEPARTMENTS.includes(dept)) active.add(dept);
  }

  return DEFAULT_ACTIVE_DEPARTMENTS.filter(dept => active.has(dept));
}

/**
 * Apply demo-mode caps to an already-normalized sim config.
 *
 * Called server-side when a request arrives without a user-supplied API
 * key, so the run bills against the host's provider key. Replaces models
 * with DEMO_MODELS, clamps turn/population/department counts, and tightens
 * tool-loop step caps. Leaders, seed, scenario content, and scenario-level
 * starting state pass through unchanged so the run still feels like a
 * real sim rather than a canned preview.
 *
 * The client cannot bypass by posting its own `models` or `turns` values.
 * Whatever the normalizer produced is overwritten here.
 */
export function applyDemoCaps(config: NormalizedSimulationConfig): NormalizedSimulationConfig {
  const demoModels = DEMO_MODELS[config.provider];
  const activeClamped = config.activeDepartments.slice(0, DEMO_EXECUTION.maxActiveDepartments);
  // Pure economy tier for the hosted demo: let the 'economy' profile's
  // own model matrix win, rather than layering DEMO_MODELS on top as
  // overrides. DEMO_MODELS was pinning `gpt-4o` on departments to avoid
  // gpt-4o-mini's verbatim-copying failure mode, but that was blended
  // ~$2/M tokens on full runs — a 6-turn public demo was costing
  // ~$2-3. The economy profile uses `gpt-5.4-mini` for departments
  // (validated for structured-schema work) and `gpt-5.4-nano` for the
  // shorter selection / reaction calls, which drops the public-demo
  // cost to well under $0.30/run. Users who provide their own keys
  // keep their selected profile — this path only fires when the
  // server is running on host-provided keys in hosted-demo mode.
  const economics = resolveEconomicsProfile({
    profileId: 'economy',
    provider: config.provider,
    baseModels: demoModels,
  });
  return {
    ...config,
    turns: Math.min(config.turns, DEMO_EXECUTION.maxTurns),
    initialPopulation: Math.min(config.initialPopulation, DEMO_EXECUTION.maxPopulation),
    activeDepartments: activeClamped,
    execution: {
      commanderMaxSteps: DEMO_EXECUTION.commanderMaxSteps,
      departmentMaxSteps: DEMO_EXECUTION.departmentMaxSteps,
      sandboxTimeoutMs: DEMO_EXECUTION.sandboxTimeoutMs,
      sandboxMemoryMB: DEMO_EXECUTION.sandboxMemoryMB,
      reactionBatchSize: DEMO_EXECUTION.reactionBatchSize,
      progressiveReactions: DEMO_EXECUTION.progressiveReactions,
    },
    economics,
    models: economics.models,
  };
}

export function normalizeSimulationConfig(input: SimulationSetupPayload): NormalizedSimulationConfig {
  // Fork setup takes exactly one actor (the override for the forked
  // branch). Regular pair setup takes exactly two and dispatches to
  // runPairSimulations with verdict comparison. Swarm setups (3+
  // actors) dispatch to runBatchSimulations and skip the verdict
  // because verdicts compare exactly two leaders and would be
  // ambiguous across N >= 3. The upper bound is a defense-in-depth
  // sanity check matching the Quickstart UI's clamp and the
  // economics-profile design target; batches of
  // `economics.batch.maxConcurrency` (default 8) keep provider
  // rate-limit pressure bounded at any swarm size.
  if (input.forkFrom) {
    if (!Array.isArray(input.actors) || input.actors.length !== 1) {
      throw new Error('Fork setup requires exactly one actor');
    }
  } else if (!Array.isArray(input.actors) || input.actors.length < 2) {
    throw new Error('Simulation requires at least 2 actors');
  } else if (input.actors.length > 300) {
    throw new Error(`Simulation accepts at most 300 actors per run, got ${input.actors.length}`);
  }

  // Priority for provider resolution:
  //   1. User-supplied keys — if exactly one is set, that's the provider
  //      the user wants to bill against. Beats `input.provider` because
  //      the UI sends the Provider dropdown state even when the user
  //      only changed the key fields, so `provider: 'openai'` may just
  //      be the default useState value rather than a deliberate choice.
  //   2. Explicit input.provider (deliberate when both keys are set so
  //      keys don't disambiguate).
  //   3. Model-name hints (legacy signal; accurate when the UI wires
  //      models and keys together).
  //   4. Fall back to 'openai' to match the hosted demo's default
  //      server-key path.
  //
  // Prior order inferred provider purely from explicit-or-model-name
  // signals, so a user who pasted only an Anthropic key left the
  // default gpt-5.4 model tiers in place and silently ran against the
  // server's env OPENAI_API_KEY while their Anthropic key sat unused
  // in ANTHROPIC_API_KEY.
  const inferredProvider =
    inferProviderFromKeys(input.apiKey, input.anthropicKey) ??
    input.provider ??
    inferProviderFromModel(input.models?.commander) ??
    inferProviderFromModel(input.models?.departments) ??
    inferProviderFromModel(input.models?.judge) ??
    'openai';
  const startTime = input.startTime ?? 2035;
  const economics = resolveEconomicsProfile({
    profileId: input.economics?.profileId,
    provider: inferredProvider,
    baseModels: DEFAULT_MODELS[inferredProvider],
    overrides: input.models,
    batchConcurrency: input.economics?.batchConcurrency,
  });

  return {
    actors: input.actors,
    provider: inferredProvider,
    turns: input.turns ?? 12,
    seed: input.seed ?? 950,
    startTime,
    timePerTurn: input.timePerTurn,
    initialPopulation: input.population ?? 100,
    liveSearch: economics.search.mode === 'off' ? false : (input.liveSearch ?? false),
    activeDepartments: normalizeActiveDepartments(input.activeDepartments),
    customEvents: normalizeCustomEvents(input.customEvents),
    keyPersonnel: input.keyPersonnel?.length ? input.keyPersonnel : DEFAULT_KEY_PERSONNEL,
    startingResources: {
      foodMonthsReserve: input.startingResources?.food ?? 18,
      waterLitersPerDay: input.startingResources?.water ?? 800,
      powerKw: input.startingResources?.power ?? 400,
      morale: (input.startingResources?.morale ?? 85) / 100,
      pressurizedVolumeM3: input.startingResources?.pressurizedVolumeM3 ?? 3000,
      lifeSupportCapacity: input.startingResources?.lifeSupportCapacity ?? 120,
      infrastructureModules: input.startingResources?.infrastructureModules ?? 3,
      scienceOutput: input.startingResources?.scienceOutput ?? 0,
    },
    startingPolitics: {
      earthDependencyPct: input.startingPolitics?.earthDependencyPct ?? 95,
    },
    execution: {
      commanderMaxSteps: input.execution?.commanderMaxSteps ?? DEFAULT_EXECUTION.commanderMaxSteps,
      departmentMaxSteps: input.execution?.departmentMaxSteps ?? DEFAULT_EXECUTION.departmentMaxSteps,
      sandboxTimeoutMs: input.execution?.sandboxTimeoutMs ?? DEFAULT_EXECUTION.sandboxTimeoutMs,
      sandboxMemoryMB: input.execution?.sandboxMemoryMB ?? DEFAULT_EXECUTION.sandboxMemoryMB,
      reactionBatchSize: input.execution?.reactionBatchSize ?? DEFAULT_EXECUTION.reactionBatchSize,
      progressiveReactions: input.execution?.progressiveReactions ?? DEFAULT_EXECUTION.progressiveReactions,
    },
    models: economics.models,
    economics,
    apiKey: input.apiKey,
    anthropicKey: input.anthropicKey,
    serperKey: input.serperKey,
    firecrawlKey: input.firecrawlKey,
    tavilyKey: input.tavilyKey,
    cohereKey: input.cohereKey,
    forkFrom: input.forkFrom,
    captureSnapshots: input.captureSnapshots === true,
    quickstart: input.quickstart,
  };
}
