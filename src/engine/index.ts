/**
 * Paracosm Engine: public API
 *
 * Closed-state, turn-based settlement simulation engine.
 * Import scenario packages, registries, and core types.
 */

// Built-in trait models register themselves on the singleton
// registry as a side effect of this import. Done at the top of the
// engine barrel so any consumer that touches paracosm has hexaco +
// ai-agent available without explicit registration calls.
import './trait-models/builtins.js';

export {
  TraitModelRegistry,
  traitModelRegistry,
  UnknownTraitModelError,
  clampTrait,
  traitZone,
  withDefaults,
} from './trait-models/index.js';
export type {
  TraitModel,
  TraitProfile,
  TraitAxis,
  CueZone,
  DriftTable,
  Outcome,
} from './trait-models/index.js';
export { hexacoModel } from './trait-models/hexaco.js';
export { aiAgentModel } from './trait-models/ai-agent.js';
export { buildCueLine, pickCues, axisIntensities } from './trait-models/cue-translator.js';
export {
  applyOutcomeDrift,
  applyLeaderPull,
  applyRoleActivation,
  driftLeaderProfile,
} from './trait-models/drift.js';
export {
  normalizeActorConfig,
  hexacoToTraits,
  traitsToHexaco,
} from './trait-models/normalize-leader.js';
export type {
  NormalizedActorConfig,
  NormalizeOptions,
} from './trait-models/normalize-leader.js';

// Type system
export type {
  ScenarioPackage,
  ScenarioLabels,
  ScenarioTheme,
  ScenarioSetupSchema,
  ScenarioWorldSchema,
  WorldMetricSchema,
  WorldState,
  AgentFieldValue,
  AgentFieldDefinition,
  DepartmentDefinition,
  MetricDefinition,
  EffectDefinition,
  EventDefinition,
  ScenarioUiDefinition,
  KnowledgeCitation,
  KnowledgeTopic,
  KnowledgeBundle,
  ScenarioPolicies,
  ScenarioPreset,
  ProgressionHookContext,
  PromptHookContext,
  ScenarioHooks,
} from './types.js';

// Registries
export { EffectRegistry } from './effect-registry.js';
export { MetricRegistry } from './metric-registry.js';
export { EventTaxonomy } from './event-taxonomy.js';

// Core kernel
export { SimulationKernel } from './core/kernel.js';
export { SeededRng } from './core/rng.js';
export { generateInitialPopulation } from './core/agent-generator.js';
export { progressBetweenTurns, applyPersonalityDrift, classifyOutcome, classifyOutcomeById } from './core/progression.js';

// Core types + generic aliases
export type {
  Agent, AgentCore, AgentHealth, AgentCareer, AgentSocial, AgentNarrative, AgentMemory, AgentMemoryEntry,
  WorldMetrics, WorldPolitics, SimulationState, SimulationMetadata,
  HexacoProfile, TurnEvent, TurnOutcome, Department, PromotionRecord,
} from './core/state.js';

// Additional types
export type { KeyPersonnel } from './core/agent-generator.js';
export type { SystemsPatch, PolicyEffect, SimulationInitOverrides } from './core/kernel.js';
export type { HexacoSnapshot, LifeEvent } from './core/state.js';
export type {
  ActorConfig,
  LlmProvider,
  SimulationModelConfig,
  Scenario,
  EventOptionDef,
  MilestoneEventDef,
  TurnOutcomeType,
} from './types.js';

// Registry types — re-exported from the registries (which alias the
// canonical types from types.ts) so existing consumers can keep
// importing them by their original names.
export type { ScenarioMetric } from './metric-registry.js';
export type { ScenarioEventDef } from './event-taxonomy.js';
export type { OutcomeModifiers } from './effect-registry.js';

// Scenario packages — assembled from scenarios/*.json + the engine's
// physics registry by the scenarios loader.
export { marsScenario, lunarScenario } from './scenarios/index.js';

// Provider resolution — lets programmatic consumers catch the
// missing-key failure mode by class instead of string-matching, and
// lets tools/tests drive the resolver without importing from internal
// paths.
export { ProviderKeyMissingError, resolveProviderWithFallback } from './provider-resolver.js';
export type { ResolvedProviderChoice, ResolveProviderOptions } from './provider-resolver.js';

// Top-level client re-export so `import { createParacosmClient } from
// 'paracosm'` works. Keeps the discoverability bar low for new users:
// one import for the most common entry point, deeper imports available
// via supported public subpaths such as `paracosm/compiler` when needed.
export { createParacosmClient } from '../runtime/client.js';
export type { ParacosmClient, ParacosmClientOptions } from '../runtime/client.js';
export type { CostPreset } from '../cli/sim-config.js';
