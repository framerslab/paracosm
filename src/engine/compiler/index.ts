/**
 * Paracosm Scenario Compiler.
 *
 * Takes a canonical scenario JSON draft (the data portion of a ScenarioPackage)
 * and generates all runtime hooks via LLM calls. Natural-language prompts,
 * briefs, and URLs enter today through CompileOptions.seedText / seedUrl,
 * which ground the draft before hook generation. A prompt-only authoring API
 * should be a wrapper that first emits this same JSON contract, then calls this
 * compiler.
 *
 * @example
 * ```typescript
 * import { compileScenario } from 'paracosm/compiler';
 * import { run } from 'paracosm';
 *
 * // Defaults to OpenAI (gpt-5.4-mini). Pass provider: 'anthropic' to switch.
 * const scenario = await compileScenario(submarineJson);
 *
 * const result = await run('Mars colony at year 2043', { scenario });
 * console.log(result.totalTurns, result.cost.totalCostUSD);
 * ```
 *
 * @module paracosm/compiler
 */

import type { ScenarioPackage, ScenarioHooks, LlmProvider } from '../types.js';
import type { CompileOptions, GenerateTextFn } from './types.js';
import { resolveProviderWithFallback } from '../provider/resolver.js';
import {
  apiKeyForProvider,
  fallbackProvidersFor,
  resolveProviderFromCredentials,
} from '../provider/credentials.js';
import {
  COMPILE_SCHEMA_VERSION,
  cachedHooksModel,
  readCache,
  writeCache,
  readSeedBundleCache,
  writeSeedBundleCache,
  seedSignature,
} from './cache.js';
import { HOOK_NAMES, recordHookSources, type CompiledHookSources, type HookName } from './hook-sources.js';
import { generateProgressionHook, parseResponse as parseProgression } from './generate-progression.js';
import { generateDirectorInstructions } from './generate-director.js';
import { generateMilestones, parseMilestones } from './generate-milestones.js';
import { generateFingerprintHook, parseResponse as parseFingerprint } from './generate-fingerprint.js';
import { generatePoliticsHook, parseResponse as parsePolitics } from './generate-politics.js';
import { generateReactionContextHook, parseResponse as parseReactions } from './generate-reactions.js';
import { ingestSeed, ingestFromUrl } from './seed-ingestion.js';
import { generateDepartmentPromptHook, parseResponse as parsePrompts } from './generate-prompts.js';
import { validateHookCode } from './sandbox-runner.js';
import { removedBuiltInNamedIn } from './own-context.js';
import type { MilestoneEventDef } from '../types.js';

export type { CompileOptions, GenerateTextFn };
export type { CompiledHookSources } from './hook-sources.js';
export { ingestSeed, ingestFromUrl } from './seed-ingestion.js';
export type { SeedIngestionOptions } from './seed-ingestion.js';

/**
 * Build a default generateText function using AgentOS. Accepts both the
 * legacy string form (no cache) and the cache-aware `{ system, prompt }`
 * form used by the schema/code/prose wrappers.
 */
async function buildDefaultGenerateText(provider: LlmProvider, model: string, apiKey?: string, stayOnProvider?: boolean): Promise<GenerateTextFn> {
  const { generateText } = await import('@framers/agentos');
  // No fallback to another provider on an explicit key, or when the compile
  // stays on its provider (`stayOnProvider`, the hosted demo).
  const fallbackProviders = fallbackProvidersFor(apiKey, stayOnProvider);
  return async (promptOrOptions) => {
    if (typeof promptOrOptions === 'string') {
      const r = await generateText({
        provider,
        model,
        prompt: promptOrOptions,
        apiKey,
        fallbackProviders,
      });
      return r.text;
    }
    const r = await generateText({
      provider,
      model,
      system: promptOrOptions.system,
      prompt: promptOrOptions.prompt,
      maxTokens: promptOrOptions.maxTokens,
      apiKey,
      fallbackProviders,
    });
    return r.text;
  };
}

/**
 * The text function of a restore. It calls no model and answers every
 * request with nothing, so a hook that neither the saved sources nor the
 * cache hold gets its generator's own fallback, as it did in the compile
 * whose model calls for it failed.
 */
const callsNoModel: GenerateTextFn = async () => '';

/**
 * Where a restore takes its hooks from: the saved sources, when they were
 * generated under the current compile schema version; else the disk cache,
 * when it holds hooks of this exact scenario JSON, under the model that
 * wrote them. Null when neither holds a hook. Sources of an older schema
 * version are not used: raising the version generates the hooks again.
 */
function restoreFrom(
  json: Record<string, unknown>,
  saved: CompiledHookSources | undefined,
  cache: boolean,
  cacheDir: string,
): { model: string; saved?: Partial<Record<HookName, string>> } | null {
  if (saved && saved.schemaVersion === COMPILE_SCHEMA_VERSION && Object.keys(saved.hooks).length > 0) {
    return { model: saved.model, saved: saved.hooks };
  }
  const cachedModel = cache ? cachedHooksModel(json, cacheDir) : null;
  return cachedModel === null ? null : { model: cachedModel };
}

/**
 * Derive a runId-friendly shortName from a scenario id when the seed
 * draft did not supply one. Trims to 24 chars so the resulting runId
 * (`${shortName}-${actor-slug}-${epoch}`) stays under ~80 chars in the
 * Library gallery. Falls back to `'compiled'` only if the id itself
 * is empty or non-string — in which case the runId is the only place
 * that signals "this came from compile-from-seed".
 */
function deriveShortName(rawId: unknown, override: string | undefined): string {
  if (typeof override === 'string' && override.trim() && override !== 'compiled') {
    return override;
  }
  const id = typeof rawId === 'string' ? rawId : '';
  const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return 'compiled';
  return slug.slice(0, 24);
}

/** The hooks whose cached text is code the hook runner evaluates. */
const CODE_HOOKS: ReadonlySet<string> = new Set(['progression', 'prompts', 'fingerprint', 'politics', 'reactions']);

/**
 * Why a cached code hook is not restored, or null.
 *
 * Two checks, neither of which runs the hook:
 *
 * - The runner's own (`validateHookCode`), which it applies at every call,
 *   so a hook it refuses fails every call of every run.
 * - Whether the hook names a built-in its context does not hold
 *   (`removedBuiltInNamedIn`, read from the context itself), such as a
 *   typed array or `Promise`. Such a hook loads and then throws at the
 *   call that reaches the name, and no caller of a hook catches that.
 *
 * The disk cache keeps the text an earlier build accepted, under a key
 * that holds the scenario JSON and `COMPILE_SCHEMA_VERSION` only, so a
 * change to the runner's rules or to what its context holds does not
 * empty it. Checking each cached hook here, and generating again only the
 * ones refused, keeps a compiled scenario's other hooks with no model
 * call; raising the schema version would generate every hook of every
 * compiled scenario again, at the next compile or the server's boot.
 */
function cachedHookRefusal(hookName: string, source: string): string | null {
  if (!CODE_HOOKS.has(hookName)) return null;
  try {
    validateHookCode(source.trim());
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  const removed = removedBuiltInNamedIn(source);
  return removed === null ? null : `it names ${removed}, which the hook's context does not hold`;
}

/** Restore a hook from cached source text. Returns the hook assignment or null if parse fails. */
function restoreHookFromCache(hookName: string, source: string): Partial<ScenarioHooks> | null {
  const refusal = cachedHookRefusal(hookName, source);
  if (refusal !== null) {
    console.warn(`[compile] the cached ${hookName} hook is not restored, the hook runner refuses it (${refusal}); generating it again`);
    return null;
  }
  try {
    switch (hookName) {
      case 'progression': {
        const fn = parseProgression(source);
        return fn ? { progressionHook: fn } : null;
      }
      case 'director': {
        const cleaned = source.trim();
        return cleaned.length > 50 ? { directorInstructions: () => cleaned } : null;
      }
      case 'prompts': {
        const fn = parsePrompts(source);
        return fn ? { departmentPromptHook: fn } : null;
      }
      case 'milestones': {
        const result = parseMilestones(source);
        if (!result) return null;
        const [founding, legacy] = result;
        return {
          getMilestoneEvent: (turn: number, maxTurns: number): MilestoneEventDef | null => {
            if (turn === 1) return founding;
            if (turn === maxTurns) return legacy;
            return null;
          },
        };
      }
      case 'fingerprint': {
        const fn = parseFingerprint(source);
        return fn ? { fingerprintHook: fn } : null;
      }
      case 'politics': {
        const fn = parsePolitics(source);
        return fn ? { politicsHook: fn } : null;
      }
      case 'reactions': {
        const fn = parseReactions(source);
        return fn ? { reactionContextHook: fn } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Compile a scenario JSON draft into a complete ScenarioPackage with generated hooks.
 *
 * @param scenarioJson - Canonical world draft (labels, departments, metrics, effects, etc.)
 * @param options - Compiler options (provider, model, cache settings, seed text / URL grounding)
 * @returns A complete ScenarioPackage ready for `WorldModel.fromScenario(...).simulate()`
 */
export async function compileScenario(
  scenarioJson: Record<string, unknown>,
  options: CompileOptions = {},
): Promise<ScenarioPackage> {
  const {
    // Default to OpenAI since OPENAI_API_KEY is the more commonly set
    // one, and runSimulation already defaults to openai. Swap with
    // provider: 'anthropic' + model: 'claude-sonnet-4-6' when desired.
    provider: requestedProviderRaw,
    model: requestedModel,
    cache = true,
    cacheDir = '.paracosm/cache',
    onProgress,
  } = options;

  const json = scenarioJson as Record<string, any>;

  // A restore of a saved compiled scenario (`options.restore`) rebuilds the
  // hooks from its saved sources, or from the disk cache, under the model
  // that generated them: no provider is resolved and no model is called, so
  // a host restores it whatever keys it holds. When neither holds a hook,
  // the scenario compiles as the other options say.
  const restoring = options.restore
    ? restoreFrom(json, options.restore.hookSources, cache, cacheDir)
    : null;

  let model: string;
  let genText: GenerateTextFn;
  if (restoring) {
    model = restoring.model;
    genText = callsNoModel;
  } else {
    // Preflight: if the requested provider has no API key in env, fall
    // through to another supported provider that does. This turns the
    // silent retry-forever failure mode (seen on the landing-page example
    // when ANTHROPIC_API_KEY was not set) into either a clean fallback
    // or a loud ProviderKeyMissingError at the top of the run.
    const requestedProvider = resolveProviderFromCredentials(requestedProviderRaw, options, 'openai');
    const requestedProviderApiKey = apiKeyForProvider(requestedProvider, options);
    const resolved = options.generateText
      ? { provider: requestedProvider, fellBack: false, requested: requestedProvider }
      : resolveProviderWithFallback(requestedProvider, { apiKey: requestedProviderApiKey, stayOnProvider: options.stayOnProvider });
    const provider = resolved.provider;
    // When fallback kicked in, the caller's model (if any) was chosen for
    // the requested provider and will not work on the fallback. Force the
    // fallback provider's default model in that case and log the swap.
    const fallbackDefaultModel = provider === 'openai' ? 'gpt-5.4-mini' : 'claude-sonnet-4-6';
    model = resolved.fellBack
      ? fallbackDefaultModel
      : (requestedModel ?? fallbackDefaultModel);
    if (resolved.fellBack && requestedModel && requestedModel !== model) {
      console.warn(
        `[paracosm] Requested model '${requestedModel}' was for provider '${resolved.requested}'; ` +
        `using '${model}' on the fallback provider '${provider}'.`,
      );
    }

    genText = options.generateText ?? await buildDefaultGenerateText(
      provider,
      model,
      apiKeyForProvider(provider, options),
      options.stayOnProvider,
    );
  }
  const hooks: ScenarioHooks = {};
  // The source of each hook restored or generated here (never a fallback's),
  // recorded with the scenario so the server's writer can save them.
  const sources: Partial<Record<HookName, string>> = {};

  // Generate each hook in parallel, using cache when available.
  //
  // Hooks are independent — each reads from the same `json` and
  // `genText` but mutates a different field of the `hooks` object —
  // so we fan out with Promise.all instead of awaiting them in series.
  // Serial generation was costing ~210s (7 hooks × ~30s) on top of the
  // ~30s draft call; parallel cuts the wall-clock to roughly the
  // slowest single hook.
  //
  // Cache writes skip `result.fromFallback === true` so a failed
  // generation (key exhaustion, transient LLM error) does not poison
  // future compiles with the fallback's no-op source. The runtime path
  // still gets the fallback hook for THIS run; the disk cache stays
  // empty so the next compile retries against the LLM. Prior bug:
  // `'// No-op: generation failed'` was cached for `progression`, then
  // crashed the sandbox at parse on every subsequent simulate.
  await Promise.all(HOOK_NAMES.map(async (hookName) => {
    // A restore takes the hook's saved source first, checked as a cached
    // source is (`restoreHookFromCache`).
    const savedSource = restoring?.saved?.[hookName];
    if (savedSource !== undefined) {
      const restored = restoreHookFromCache(hookName, savedSource);
      if (restored) {
        onProgress?.(hookName, 'cached');
        Object.assign(hooks, restored);
        sources[hookName] = savedSource;
        return;
      }
    }

    // Try to restore from cache first.
    //
    // `restoreHookFromCache` validates the cached source via the same
    // `parseResponse` used after a fresh LLM call, so a corrupted cache
    // entry (older builds wrote comment-only fallbacks) returns null
    // and falls through to regeneration instead of returning a closure
    // that fails at simulate-time. It also refuses a code hook the hook
    // runner refuses, or one that names a built-in the runner's context
    // does not hold (`cachedHookRefusal`), so only that hook is generated
    // again and the scenario's other cached hooks are kept.
    if (cache) {
      const cached = readCache(json, hookName, model, cacheDir);
      if (cached !== null) {
        const restored = restoreHookFromCache(hookName, cached);
        if (restored) {
          onProgress?.(hookName, 'cached');
          Object.assign(hooks, restored);
          sources[hookName] = cached;
          return;
        }
      }
    }

    onProgress?.(hookName, 'generating');
    // A generated source is kept, and cached, unless it is the fallback's.
    const keep = (result: { source: string; fromFallback: boolean }): void => {
      if (result.fromFallback) return;
      sources[hookName] = result.source;
      if (cache) writeCache(json, hookName, result.source, model, cacheDir);
    };

    switch (hookName) {
      case 'progression': {
        const result = await generateProgressionHook(json, genText, { telemetry: options.telemetry });
        hooks.progressionHook = result.hook;
        keep(result);
        break;
      }
      case 'director': {
        const result = await generateDirectorInstructions(json, genText, { telemetry: options.telemetry });
        hooks.directorInstructions = result.hook;
        keep(result);
        break;
      }
      case 'prompts': {
        const result = await generateDepartmentPromptHook(json, genText, { telemetry: options.telemetry });
        hooks.departmentPromptHook = result.hook;
        keep(result);
        break;
      }
      case 'milestones': {
        const result = await generateMilestones(json, genText, { telemetry: options.telemetry });
        hooks.getMilestoneEvent = result.hook;
        keep(result);
        break;
      }
      case 'fingerprint': {
        const result = await generateFingerprintHook(json, genText, { telemetry: options.telemetry });
        hooks.fingerprintHook = result.hook;
        keep(result);
        break;
      }
      case 'politics': {
        const result = await generatePoliticsHook(json, genText, { telemetry: options.telemetry });
        hooks.politicsHook = result.hook;
        keep(result);
        break;
      }
      case 'reactions': {
        const result = await generateReactionContextHook(json, genText, { telemetry: options.telemetry });
        hooks.reactionContextHook = result.hook;
        keep(result);
        break;
      }
    }

    onProgress?.(hookName, 'done');
  }));

  // Seed ingestion: enrich knowledge bundle from document or URL.
  // Cached on disk by seed signature (text/URL + maxSearches + webSearch flag)
  // so re-running a compile with the same seed never re-fetches pages or
  // re-runs the extraction LLM call.
  // A restore reads no seed: the saved scenario's knowledge is in its JSON.
  let knowledge = json.knowledge ?? { topics: {}, categoryMapping: {} };
  if (!restoring && (options.seedUrl || options.seedText)) {
    const sig = seedSignature({
      seedText: options.seedText,
      seedUrl: options.seedUrl,
      webSearch: options.webSearch,
      maxSearches: options.maxSearches,
    });

    let seedBundle: Awaited<ReturnType<typeof ingestSeed>> | null = null;
    if (cache) {
      const cached = readSeedBundleCache(json, sig, cacheDir);
      if (cached && typeof cached === 'object') {
        onProgress?.('seed-ingestion', 'cached');
        seedBundle = cached as Awaited<ReturnType<typeof ingestSeed>>;
      }
    }

    if (!seedBundle) {
      onProgress?.('seed-ingestion', 'generating');
      const ingestOpts = {
        generateText: genText,
        webSearch: options.webSearch ?? true,
        maxSearches: options.maxSearches ?? 5,
        serperKey: options.serperKey,
        firecrawlKey: options.firecrawlKey,
        tavilyKey: options.tavilyKey,
        braveKey: options.braveKey,
        cohereKey: options.cohereKey,
        onProgress: (step: string, status: 'start' | 'done') =>
          onProgress?.(`seed-${step}`, status === 'start' ? 'generating' : 'done'),
      };
      seedBundle = options.seedUrl
        ? await ingestFromUrl(options.seedUrl, ingestOpts)
        : await ingestSeed(options.seedText!, ingestOpts);
      if (cache) writeSeedBundleCache(json, sig, seedBundle, cacheDir);
      onProgress?.('seed-ingestion', 'done');
    }

    knowledge = mergeKnowledgeBundles(knowledge, seedBundle);
  }

  // Build world schema from metrics if not already structured
  const world = json.world ?? {
    metrics: {},
    capacities: {},
    statuses: {},
    politics: {},
    environment: {},
  };

  // Build effects array
  const effects = Array.isArray(json.effects)
    ? json.effects
    : json.effects && typeof json.effects === 'object'
      ? [{ id: 'category_effects', type: 'category_outcome', label: 'Category Outcome Effects', categoryDefaults: json.effects }]
      : [];

  // Build UI definition. ScenarioUiDefinition has six required fields
  // (engine/types.ts:173); spreading `json.ui ?? {}` alone leaves any
  // omitted field undefined, which crashes downstream consumers (the
  // dashboard's REPORTS tab does `for (const x of ui.reportSections)`
  // and unmounts the tab bar on undefined). Default each field to a
  // benign value so any `compileScenario` caller — including the
  // schema-light `compileFromSeed` path — gets a consumable shape.
  const ui = {
    headerMetrics: [] as Array<{ id: string; format: 'number' | 'percent' | 'currency' | 'duration' }>,
    tooltipFields: [] as string[],
    reportSections: ['crisis', 'departments', 'decision', 'outcome'] as Array<'crisis' | 'departments' | 'decision' | 'outcome' | 'quotes' | 'causality'>,
    departmentIcons: {} as Record<string, string>,
    setupSections: ['actors', 'departments', 'models'] as Array<'actors' | 'personnel' | 'resources' | 'departments' | 'events' | 'models' | 'advanced'>,
    ...(json.ui ?? {}),
    eventRenderers: Object.fromEntries(
      (json.events ?? []).map((e: any) => [e.id, { icon: e.icon, color: e.color }])
    ),
  };

  const scenario = {
    id: json.id ?? 'compiled-scenario',
    version: json.version ?? '1.0.0',
    engineArchetype: json.engineArchetype ?? 'closed_turn_based_settlement',
    // Labels: spread explicit values over benign defaults so a seed
    // draft that lacks `actorNoun` / `actorNounPlural` (or any other
    // optional noun) gets sensible UI fallbacks instead of leaving
    // dashboard fields undefined.
    //
    // `shortName` falls back to a derivative of the scenario id rather
    // than the literal 'compiled' so RunRecord runIds read as
    // `glp1-alzheimers-offlabel-trial-the-engineer-...` instead of
    // `compiled-the-engineer-...` for compile-from-seed scenarios.
    // Cap at 24 chars so the full runId stays under 80 in the Library
    // gallery.
    labels: {
      name: 'Compiled Scenario',
      shortName: deriveShortName(json.id, json.labels?.shortName),
      populationNoun: 'members',
      settlementNoun: 'settlement',
      currency: 'credits',
      actorNoun: 'actor',
      actorNounPlural: 'actors',
      ...(json.labels ?? {}),
    },
    theme: json.theme ?? { primaryColor: '#6366f1', accentColor: '#818cf8', cssVariables: {} },
    setup: json.setup ?? { defaultTurns: 8, defaultSeed: 100, defaultStartTime: 2040, defaultPopulation: 50, configurableSections: ['actors', 'departments', 'models'] },
    world,
    departments: json.departments ?? [],
    metrics: json.metrics ?? [],
    events: json.events ?? [],
    effects,
    ui,
    knowledge,
    policies: json.policies ?? {
      toolForging: { enabled: true },
      liveSearch: { enabled: false, mode: 'off' as const },
      bulletin: { enabled: true },
      characterChat: { enabled: true },
      sandbox: { timeoutMs: 10000, memoryMB: 128 },
    },
    presets: json.presets ?? [],
    hooks,
  } as ScenarioPackage;
  recordHookSources(hooks, { schemaVersion: COMPILE_SCHEMA_VERSION, model, hooks: sources });
  return scenario;
}

/** Merge two knowledge bundles, combining topics and category mappings. */
function mergeKnowledgeBundles(
  base: { topics: Record<string, any>; categoryMapping: Record<string, string[]> },
  overlay: { topics: Record<string, any>; categoryMapping: Record<string, string[]> },
): { topics: Record<string, any>; categoryMapping: Record<string, string[]> } {
  const topics = { ...base.topics };
  for (const [key, topic] of Object.entries(overlay.topics)) {
    if (topics[key]) {
      // Merge citations into existing topic
      topics[key] = {
        ...topics[key],
        canonicalFacts: [...(topics[key].canonicalFacts || []), ...(topic.canonicalFacts || [])],
        counterpoints: [...(topics[key].counterpoints || []), ...(topic.counterpoints || [])],
      };
    } else {
      topics[key] = topic;
    }
  }

  const categoryMapping = { ...base.categoryMapping };
  for (const [cat, topicIds] of Object.entries(overlay.categoryMapping)) {
    categoryMapping[cat] = [...new Set([...(categoryMapping[cat] || []), ...topicIds])];
  }

  return { topics, categoryMapping };
}
