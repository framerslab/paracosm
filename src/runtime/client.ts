/**
 * Paracosm client — one-call factory that pins `provider`, `costPreset`,
 * per-role `models`, and compile-time options once, then hands back
 * methods that inherit those defaults on every call.
 *
 * Problem it solves: a typical programmatic workflow runs 10-50
 * simulations (batch sweeps, CI regression checks, per-scenario
 * ablations). Passing the same `{ provider, costPreset, models }` on
 * every `runSimulation(leader, [], { ... })` call is noisy and
 * error-prone; a typo in one config entry silently breaks that run's
 * model routing without breaking the others. The client centralizes
 * the defaults so per-call overrides become the exception, not the
 * baseline.
 *
 * Layering (lowest precedence to highest):
 *   1. Built-in defaults from `DEFAULT_MODELS` / `DEMO_MODELS`
 *   2. `PARACOSM_*` env vars (read once at client construction)
 *   3. Explicit `createParacosmClient({ ... })` args
 *   4. Per-call overrides on `client.runSimulation(leader, [], { ... })`
 *
 * Each higher layer merges over the lower one; `models` merges at the
 * per-role level so you can pin `departments: 'gpt-5.4'` at the client
 * and still override `judge` per call.
 *
 * @module paracosm/runtime/client
 */

import { runSimulation, type RunOptions, type ActorConfig } from './orchestrator/index.js';
import { runBatch, type BatchConfig, type BatchManifest } from './batch.js';
import { compileScenario } from '../engine/compiler/index.js';
import type { CompileOptions } from '../engine/compiler/types.js';
import type { KeyPersonnel } from '../engine/core/agent-generator.js';
import type { LlmProvider, ScenarioPackage, SimulationModelConfig } from '../engine/types.js';
import type { CostPreset } from '../cli/sim-config.js';

/** Options passed to `createParacosmClient`. Every field is optional and composes with env-var reads. */
export interface ParacosmClientOptions {
  /**
   * Default provider for `runSimulation` / `runBatch`. Env fallback:
   * `PARACOSM_PROVIDER=openai` or `=anthropic`. Per-call `opts.provider`
   * still wins.
   */
  provider?: LlmProvider;
  /**
   * Default cost preset. Env fallback: `PARACOSM_COST_PRESET=quality`
   * or `=economy`.
   */
  costPreset?: CostPreset;
  /**
   * Per-role model pins. Env fallbacks:
   *   PARACOSM_MODEL_COMMANDER, PARACOSM_MODEL_DEPARTMENTS,
   *   PARACOSM_MODEL_JUDGE, PARACOSM_MODEL_DIRECTOR,
   *   PARACOSM_MODEL_AGENT_REACTIONS
   * Merged at the per-role level, not whole-object: setting
   * `models: { departments: 'gpt-5.4' }` pins departments but leaves
   * commander / director / judge / agentReactions flowing from the
   * preset as before.
   */
  models?: Partial<SimulationModelConfig>;
  /**
   * Provider to use for compile-time LLM calls in `client.compileScenario`.
   * Defaults to `provider` when unset so most users only configure one
   * provider. Env fallback: `PARACOSM_COMPILER_PROVIDER`.
   */
  compilerProvider?: LlmProvider;
  /**
   * Model to use for compile-time LLM calls. Env fallback:
   * `PARACOSM_COMPILER_MODEL`. If omitted the compiler picks a
   * provider-default (gpt-5.4-mini on OpenAI, claude-sonnet-4-6 on
   * Anthropic).
   */
  compilerModel?: string;
}

/**
 * Handle returned by `createParacosmClient`. The three methods mirror
 * the corresponding standalone exports — same arg shapes, same return
 * types — but with the client's defaults layered in.
 */
export interface ParacosmClient {
  /**
   * Run one simulation. Leader + key personnel passed per-call; all
   * other options inherit from the client with per-call overrides.
   */
  runSimulation: (
    leader: ActorConfig,
    keyPersonnel: KeyPersonnel[],
    opts?: RunOptions,
  ) => ReturnType<typeof runSimulation>;
  /**
   * Run a batch sweep. Scenarios / leaders / turns / seed are the
   * caller's responsibility; provider + costPreset + models inherit.
   */
  runBatch: (config: BatchConfig) => Promise<BatchManifest>;
  /**
   * Compile a scenario with the client's compiler defaults.
   */
  compileScenario: (
    scenarioJson: Record<string, unknown>,
    opts?: CompileOptions,
  ) => Promise<ScenarioPackage>;
}

const VALID_PROVIDERS: readonly LlmProvider[] = ['openai', 'anthropic'] as const;
const VALID_PRESETS: readonly CostPreset[] = ['quality', 'economy'] as const;

function envString(key: string): string | undefined {
  const env = typeof process !== 'undefined' && process.env ? process.env : undefined;
  if (!env) return undefined;
  const v = env[key];
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvClientOptions(): ParacosmClientOptions {
  const rawProvider = envString('PARACOSM_PROVIDER');
  const rawCompilerProvider = envString('PARACOSM_COMPILER_PROVIDER');
  const rawPreset = envString('PARACOSM_COST_PRESET');
  const provider = rawProvider && (VALID_PROVIDERS as readonly string[]).includes(rawProvider)
    ? (rawProvider as LlmProvider)
    : undefined;
  const compilerProvider = rawCompilerProvider && (VALID_PROVIDERS as readonly string[]).includes(rawCompilerProvider)
    ? (rawCompilerProvider as LlmProvider)
    : undefined;
  const costPreset = rawPreset && (VALID_PRESETS as readonly string[]).includes(rawPreset)
    ? (rawPreset as CostPreset)
    : undefined;

  const models: Partial<SimulationModelConfig> = {};
  const commander = envString('PARACOSM_MODEL_COMMANDER');
  const departments = envString('PARACOSM_MODEL_DEPARTMENTS');
  const judge = envString('PARACOSM_MODEL_JUDGE');
  const director = envString('PARACOSM_MODEL_DIRECTOR');
  const agentReactions = envString('PARACOSM_MODEL_AGENT_REACTIONS');
  if (commander) models.commander = commander;
  if (departments) models.departments = departments;
  if (judge) models.judge = judge;
  if (director) models.director = director;
  if (agentReactions) models.agentReactions = agentReactions;

  return {
    provider,
    compilerProvider,
    costPreset,
    models: Object.keys(models).length > 0 ? models : undefined,
    compilerModel: envString('PARACOSM_COMPILER_MODEL'),
  };
}

/**
 * Create a Paracosm client with pinned defaults. Env vars are read once
 * at construction; subsequent `process.env` mutations won't retrigger.
 *
 * @example
 * ```typescript
 * import { createParacosmClient } from 'paracosm';
 *
 * const client = createParacosmClient({
 *   provider: 'openai',
 *   costPreset: 'economy',
 *   models: { departments: 'gpt-5.4' },  // pin only departments to flagship
 * });
 *
 * const scenario = await client.compileScenario(worldJson);
 * const out = await client.runSimulation(leader, [], { maxTurns: 6, seed: 42 });
 *
 * // Per-call override wins over client defaults:
 * const quality = await client.runSimulation(leader, [], {
 *   maxTurns: 8, seed: 42,
 *   costPreset: 'quality',  // promote this one run to flagship
 * });
 * ```
 *
 * @example Env-driven (zero-code config for hosting / CI):
 * ```bash
 * PARACOSM_PROVIDER=anthropic \
 * PARACOSM_COST_PRESET=economy \
 * PARACOSM_MODEL_DEPARTMENTS=claude-sonnet-4-6 \
 *   node my-runner.js
 * ```
 * ```typescript
 * const client = createParacosmClient();  // no args — reads from env
 * ```
 */
export function createParacosmClient(options: ParacosmClientOptions = {}): ParacosmClient {
  const fromEnv = readEnvClientOptions();

  // Explicit args win over env; env wins over the built-in library
  // defaults further down the call chain (DEFAULT_MODELS / DEMO_MODELS).
  const provider = options.provider ?? fromEnv.provider;
  const costPreset = options.costPreset ?? fromEnv.costPreset;
  const mergedModels: Partial<SimulationModelConfig> = {
    ...fromEnv.models,
    ...options.models,
  };
  const compilerProvider = options.compilerProvider
    ?? fromEnv.compilerProvider
    ?? provider;
  const compilerModel = options.compilerModel ?? fromEnv.compilerModel;

  const hasClientModels = Object.keys(mergedModels).length > 0;

  return {
    runSimulation: (leader, keyPersonnel, opts = {}) => runSimulation(leader, keyPersonnel, {
      ...opts,
      provider: opts.provider ?? provider,
      costPreset: opts.costPreset ?? costPreset,
      // Per-role merge so caller's override only stomps the role(s)
      // they specified, not the whole client pin.
      models: hasClientModels || opts.models
        ? { ...mergedModels, ...opts.models }
        : undefined,
    }),
    runBatch: (config) => runBatch({
      ...config,
      provider: config.provider ?? provider,
      costPreset: config.costPreset ?? costPreset,
      models: hasClientModels || config.models
        ? { ...mergedModels, ...config.models }
        : undefined,
    }),
    compileScenario: (scenarioJson, opts = {}) => compileScenario(scenarioJson, {
      ...opts,
      provider: opts.provider ?? compilerProvider,
      model: opts.model ?? compilerModel,
    }),
  };
}
