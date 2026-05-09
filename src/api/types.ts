/**
 * Public option/result types for the v0.9 top-level API and the
 * options-bag forms of WorldModel methods. All fields here are part of
 * the published surface — breaking changes require a major bump.
 *
 * @module paracosm/api/types
 */
import type {
  ActorConfig,
  ScenarioPackage,
  SimulationModelConfig,
} from '../engine/types.js';
import type { KeyPersonnel } from '../engine/core/agent-generator.js';
import type { RunArtifact, SubjectConfig, InterventionConfig } from '../engine/schema/types.js';
import type { WorldModel } from '../runtime/world-model/index.js';
import type { RunOptions as InternalRunOptions } from '../runtime/orchestrator/index.js';
import type { z } from 'zod';
import type { StreamEventSchema } from '../engine/schema/stream.js';

/** Discriminated union of all stream events emitted during a run. */
export type StreamEvent = z.infer<typeof StreamEventSchema>;

/** Custom event injected into a run via `RunOptions.customEvents`. */
export interface CustomEvent {
  /** Turn at which the event fires. */
  turn: number;
  /** Short user-facing title surfaced in agent prompts. */
  title: string;
  /** One-paragraph description used as event-card body. */
  description: string;
}

/**
 * Options accepted by the top-level `run(prompt, opts)` function.
 *
 * @public
 */
export interface RunOptions {
  /** Per-run seed. Default: scenario's `setup.defaultSeed` else 42. */
  seed?: number;
  /** Hard cap on turns. Default: scenario's `setup.defaultTurns`. */
  maxTurns?: number;
  /** Whether to embed kernel snapshots so the result is fork-eligible. Default true. */
  captureSnapshots?: boolean;
  /** LLM provider for the simulation. Default 'anthropic'. */
  provider?: 'openai' | 'anthropic';
  /** Cost preset. Default 'quality'. */
  costPreset?: 'quality' | 'economy';
  /** Per-role model overrides. */
  models?: SimulationModelConfig;
  /** Custom events to inject during the run. */
  customEvents?: CustomEvent[];
  /** Cancel the run early. */
  signal?: AbortSignal;
  /** Stream-event callback (forge attempts, decisions, errors). */
  onEvent?: (e: StreamEvent) => void;
  /** Compiler cache directory. Reused across multiple runs in `runMany`. */
  cacheDir?: string;
}

/**
 * Options accepted by `runMany(prompt, opts)`. Extends `RunOptions` with
 * parallel-run params.
 *
 * @public
 */
export interface RunManyOptions extends RunOptions {
  /** How many actors to generate + run in parallel. Default 3, range 2..6. */
  count?: number;
}

/**
 * One actor + its artifact, zipped together. Returned by `runMany` and
 * also exposed on `wm.quickstart` results so call sites can iterate
 * `runs.forEach(({ actor, artifact }) => ...)` without juggling parallel
 * arrays.
 *
 * @public
 */
export interface ActorRun {
  actor: ActorConfig;
  artifact: RunArtifact;
}

/**
 * Shape returned by `runMany(prompt, opts)`.
 *
 * @public
 */
export interface RunManyResult {
  /** The compiled scenario the run was executed against. */
  scenario: ScenarioPackage;
  /** Mid-level handle for fork/replay/intervene against the same scenario. */
  wm: WorldModel;
  /** One entry per actor; actor + artifact zipped. */
  runs: ActorRun[];
}

/**
 * Options-bag for `wm.simulate`. Replaces the v0.8 positional form
 * `simulate(leader, options, keyPersonnel)`. Extends the full internal
 * RunOptions (provider keys, economics, initial population, etc.) and
 * adds `actor` + `keyPersonnel` so visitor-facing call sites need only
 * one argument.
 *
 * @public
 */
export interface SimulateOptions extends InternalRunOptions {
  /** The actor whose decisions drive the simulation. */
  actor: ActorConfig;
  /** Optional supporting cast for context retrieval. Default []. */
  keyPersonnel?: KeyPersonnel[];
}

/**
 * Options-bag for `wm.intervene`. Adds subject + intervention to
 * SimulateOptions. Replaces the v0.8 `simulateIntervention(subject,
 * intervention, leader, opts)` 4-positional form.
 *
 * @public
 */
export interface InterveneOptions extends SimulateOptions {
  subject: SubjectConfig;
  intervention: InterventionConfig;
}

/**
 * Options-bag for `wm.batch`. Already a single-arg options-bag in v0.8;
 * v0.9 just re-exports the existing shape from the public root for
 * symmetry with `SimulateOptions` / `InterveneOptions`.
 *
 * Note: uses `turns` (required) instead of `maxTurns` (optional) to
 * match the underlying `runBatch` signature. For variable per-actor
 * lengths, call `wm.simulate({...})` directly in a loop.
 *
 * @public
 */
export type BatchOptions = import('../runtime/world-model/index.js').WorldModelBatchOptions;
