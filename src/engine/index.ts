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
import './traits/builtins.js';

export {
  TraitModelRegistry,
  traitModelRegistry,
  UnknownTraitModelError,
  clampTrait,
  traitZone,
  withDefaults,
} from './traits/index.js';
export type {
  TraitModel,
  TraitProfile,
  TraitAxis,
  CueZone,
  DriftTable,
  Outcome,
} from './traits/index.js';
export { hexacoModel } from './traits/hexaco.js';
export { aiAgentModel } from './traits/ai-agent.js';
export { buildCueLine, pickCues, axisIntensities } from './traits/cue-translator.js';
export {
  applyOutcomeDrift,
  applyLeaderPull,
  applyRoleActivation,
  driftLeaderProfile,
} from './traits/drift.js';
export {
  normalizeActorConfig,
  hexacoToTraits,
  traitsToHexaco,
} from './traits/normalize-leader.js';
export type {
  NormalizedActorConfig,
  NormalizeOptions,
} from './traits/normalize-leader.js';

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
export { EffectRegistry } from './registries/effects.js';
export { MetricRegistry } from './registries/metrics.js';
export { EventTaxonomy } from './registries/events.js';

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
export type { ScenarioMetric } from './registries/metrics.js';
export type { ScenarioEventDef } from './registries/events.js';
export type { OutcomeModifiers } from './registries/effects.js';

// Scenario packages — assembled from scenarios/*.json + the engine's
// physics registry by the scenarios loader.
export { marsScenario, lunarScenario } from './scenarios/index.js';

// Provider resolution — lets programmatic consumers catch the
// missing-key failure mode by class instead of string-matching, and
// lets tools/tests drive the resolver without importing from internal
// paths.
export { ProviderKeyMissingError, resolveProviderWithFallback } from './provider/resolver.js';
export type { ResolvedProviderChoice, ResolveProviderOptions } from './provider/resolver.js';

export type { CostPreset } from '../cli/sim-config.js';
