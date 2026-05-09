/**
 * Paracosm v0.9 public root export.
 *
 * Imports from this entry point cover the 90% case (`run`, `runMany`,
 * `WorldModel`, public types). Power users keep subpath escape hatches:
 * `paracosm/swarm`, `paracosm/compiler`, `paracosm/digital-twin`,
 * `paracosm/schema`, `paracosm/core`.
 *
 * @module paracosm
 */

// ─── Top-level shortcuts ────────────────────────────────────────────
export { run, runMany } from './api/run.js';
export type {
  RunOptions, RunManyOptions, RunManyResult, ActorRun,
  SimulateOptions, InterveneOptions, BatchOptions,
  StreamEvent, CustomEvent,
} from './api/types.js';

// ─── Mid-level: WorldModel class ────────────────────────────────────
export { WorldModel, WorldModelReplayError, generateQuickstartActors } from './runtime/world-model/index.js';
export type {
  WorldModelSnapshot, WorldModelReplayResult, WorldModelQuickstartOptions, WorldModelQuickstartResult,
} from './runtime/world-model/index.js';

// ─── Scenario authoring (promoted from /compiler) ───────────────────
export { compileScenario, ingestFromUrl, ingestSeed } from './engine/compiler/index.js';

// ─── Built-in scenarios ─────────────────────────────────────────────
// All scenario data lives in `scenarios/*.json`; the loader assembles
// runnable ScenarioPackage values at module init by composing JSON +
// the engine's physics registry + the data-driven-hooks
// factory. No scenario-specific source files exist.
export { marsScenario, lunarScenario } from './engine/scenarios/index.js';

// ─── Actor presets (promoted from /leader-presets) ──────────────────
export { ACTOR_PRESETS, getPresetById, listPresetsByTrait } from './engine/leader-presets.js';

// ─── Trait models + factories ───────────────────────────────────────
export {
  traitModelRegistry,
  TraitModelRegistry, UnknownTraitModelError,
  withDefaults,
} from './engine/trait-models/index.js';
export { hexacoModel } from './engine/trait-models/hexaco.js';
export { aiAgentModel } from './engine/trait-models/ai-agent.js';
export {
  normalizeActorConfig, hexacoToTraits, traitsToHexaco,
} from './engine/trait-models/normalize-leader.js';
export { createParacosmClient } from './runtime/client.js';
export type { ParacosmClient, ParacosmClientOptions } from './runtime/client.js';
export { ProviderKeyMissingError, resolveProviderWithFallback } from './engine/provider-resolver.js';

// ─── Public types from the engine ───────────────────────────────────
export type {
  ActorConfig,
  ScenarioPackage, SimulationModelConfig,
} from './engine/types.js';
export type { Citation, ForgedToolRecord } from './cli/types.js';
export type { HexacoProfile } from './engine/core/state.js';
export type { TraitProfile } from './engine/trait-models/index.js';
export type { KeyPersonnel } from './engine/core/agent-generator.js';
export type { RunArtifact } from './engine/schema/types.js';
export type { SubjectConfig, InterventionConfig } from './engine/digital-twin/index.js';
