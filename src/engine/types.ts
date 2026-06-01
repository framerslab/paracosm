/**
 * @module types
 * Core type definitions for the Paracosm simulation engine.
 * All types needed to define a ScenarioPackage and interact with the engine.
 */

import type { HexacoProfile, Agent, SimulationState } from './core/state.js';
import type { TraitProfile } from './traits/index.js';

// ---------------------------------------------------------------------------
// Primitive value types
// ---------------------------------------------------------------------------

/** Possible field values for agent/colonist custom fields. */
export type AgentFieldValue = number | string | boolean | string[];

// ---------------------------------------------------------------------------
// Scenario labels and theme
// ---------------------------------------------------------------------------

/** Human-readable labels for a scenario, used in UI and output naming. */
export interface ScenarioLabels {
  /** Full display name (e.g., "Mars Genesis") */
  name: string;
  /** Short identifier used in file names and localStorage keys */
  shortName: string;
  /** What to call population members (e.g., "colonists", "crew members") */
  populationNoun: string;
  /** What to call the settlement (e.g., "colony", "outpost") */
  settlementNoun: string;
  /** Currency unit (e.g., "credits") */
  currency: string;
  /** What to call turn events (e.g., "crises", "events", "incidents", "scenarios"). Default: "events" */
  eventNoun?: string;
  /** What to call a single turn event (e.g., "crisis", "event", "incident"). Default: "event" */
  eventNounSingular?: string;
  /** Singular display word for one simulation time-unit (e.g., "year", "hour", "quarter", "tick"). Default when absent: "tick". */
  timeUnitNoun?: string;
  /** Plural form of `timeUnitNoun` (e.g., "years", "hours", "quarters", "ticks"). Default when absent: "ticks". */
  timeUnitNounPlural?: string;
  /**
   * Singular display word for the swappable decision-making entity that
   * runs each parallel counterfactual. Defaults to "actor" — the universal
   * abstract type. Scenarios specialize it: Mars Genesis sets "commander",
   * a hurricane scenario sets "incident commander", an AI release sets
   * "release director", a quantum-game scenario sets "player". The
   * engine type stays `ActorConfig` for SDK back-compat; this label is
   * for UI / copy / button text rendering only.
   */
  actorNoun?: string;
  /** Plural form of `actorNoun`. Defaults to "actors". */
  actorNounPlural?: string;
  /**
   * Optional one-line "what is this scenario about" copy surfaced on
   * Quickstart cards and replay banners. Read by the LoadedScenarioCTA
   * to give first-time visitors enough context to know what they're
   * about to launch without having to dig into the JSON. Compact: <=
   * 200 chars, plain text.
   */
  tagline?: string;
}

/** Visual theme for a scenario. Applied to the dashboard via CSS custom properties. */
export interface ScenarioTheme {
  primaryColor: string;
  accentColor: string;
  /** CSS custom properties injected into :root on scenario load */
  cssVariables: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Setup schema
// ---------------------------------------------------------------------------

/** Default values for the simulation setup form. */
export interface ScenarioSetupSchema {
  defaultTurns: number;
  defaultSeed: number;
  defaultStartTime: number;
  defaultTimePerTurn?: number;
  defaultPopulation: number;
  /** Maximum events the Event Director can generate per turn. Default: 3 */
  maxEventsPerTurn?: number;
  /** Which setup form sections to expose in the dashboard */
  configurableSections: Array<'actors' | 'personnel' | 'resources' | 'departments' | 'events' | 'models' | 'advanced'>;
}

// ---------------------------------------------------------------------------
// World state schema
// ---------------------------------------------------------------------------

/** Schema for a single world metric, capacity, status, or political variable. */
export interface WorldMetricSchema {
  id: string;
  label: string;
  unit: string;
  type: 'number' | 'string' | 'boolean';
  initial: number | string | boolean;
  min?: number;
  max?: number;
  category: 'metric' | 'capacity' | 'status' | 'politic' | 'environment';
}

/** Declares all world state variables for a scenario. */
export interface ScenarioWorldSchema {
  metrics: Record<string, WorldMetricSchema>;
  capacities: Record<string, WorldMetricSchema>;
  statuses: Record<string, WorldMetricSchema>;
  politics: Record<string, WorldMetricSchema>;
  environment: Record<string, WorldMetricSchema>;
}

/** Runtime world state with typed record bags. Not everything is a flat numeric resource. */
export interface WorldState {
  /** Numeric gauges: food, power, water, population, morale */
  metrics: Record<string, number>;
  /** Capacity constraints: life support, housing */
  capacities: Record<string, number>;
  /** Categorical state: governance status, faction alignment */
  statuses: Record<string, string | boolean>;
  /** Political/social pressures */
  politics: Record<string, number | string | boolean>;
  /** Environment conditions */
  environment: Record<string, number | string | boolean>;
}

// ---------------------------------------------------------------------------
// Agent field definitions
// ---------------------------------------------------------------------------

/** Defines a custom field on agents/colonists for a scenario. */
export interface AgentFieldDefinition {
  id: string;
  label: string;
  unit: string;
  type: 'number' | 'string' | 'boolean' | 'tags';
  initial: AgentFieldValue;
  min?: number;
  max?: number;
  mortalityContribution?: { threshold: number; ratePerYear: number };
  showInTooltip: boolean;
  includeInReactionContext: boolean;
}

// ---------------------------------------------------------------------------
// Department definitions
// ---------------------------------------------------------------------------

/** Defines a department (analysis group) in the scenario. */
export interface DepartmentDefinition {
  id: string;
  label: string;
  role: string;
  icon: string;
  defaultModel: string;
  instructions: string;
}

// ---------------------------------------------------------------------------
// Metrics, effects, events
// ---------------------------------------------------------------------------

/** Defines a derived metric displayed in the dashboard header. */
export interface MetricDefinition {
  id: string;
  label: string;
  source: string;
  format: 'number' | 'percent' | 'currency' | 'duration';
}

/** Defines an effect category with base deltas applied on crisis outcomes. */
export interface EffectDefinition {
  id: string;
  type: string;
  label: string;
  /** Maps crisis category to base colony system deltas */
  categoryDefaults: Record<string, Record<string, number>>;
}

/** Defines an event type with render metadata for the dashboard. */
export interface EventDefinition {
  id: string;
  label: string;
  icon: string;
  color: string;
}

// ---------------------------------------------------------------------------
// UI schema
// ---------------------------------------------------------------------------

/** Tells the dashboard how to render scenario-specific UI elements. */
export interface ScenarioUiDefinition {
  headerMetrics: Array<{ id: string; format: 'number' | 'percent' | 'currency' | 'duration' }>;
  tooltipFields: string[];
  reportSections: Array<'crisis' | 'departments' | 'decision' | 'outcome' | 'quotes' | 'causality'>;
  departmentIcons: Record<string, string>;
  eventRenderers: Record<string, { icon: string; color: string }>;
  setupSections: Array<'actors' | 'personnel' | 'resources' | 'departments' | 'events' | 'models' | 'advanced'>;
}

// ---------------------------------------------------------------------------
// Knowledge bundle
// ---------------------------------------------------------------------------

/** A single research citation with optional DOI. */
export interface KnowledgeCitation {
  claim: string;
  source: string;
  url: string;
  doi?: string;
}

/** A research topic with facts, counterpoints, and department-specific notes. */
export interface KnowledgeTopic {
  canonicalFacts: KnowledgeCitation[];
  counterpoints: Array<{ claim: string; source: string; url: string }>;
  departmentNotes: Record<string, string>;
}

/** Scenario-owned research knowledge organized by topic with crisis category mapping. */
export interface KnowledgeBundle {
  topics: Record<string, KnowledgeTopic>;
  /** Maps crisis category to relevant topic IDs */
  categoryMapping: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/** Feature policies controlling what capabilities are enabled for a scenario. */
export interface ScenarioPolicies {
  toolForging: { enabled: boolean; requiredPerDepartment?: boolean };
  liveSearch: { enabled: boolean; mode: 'off' | 'manual' | 'auto' };
  bulletin: { enabled: boolean };
  characterChat: { enabled: boolean };
  sandbox: { timeoutMs: number; memoryMB: number };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** A product-level preset with pre-configured leaders, personnel, and starting state. */
export interface ScenarioPreset {
  id: string;
  label: string;
  leaders?: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }>;
  personnel?: Array<{ name: string; department: string; role: string; specialization: string; age: number; featured: boolean }>;
  startingState?: Partial<WorldState>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Context passed to the scenario progression hook during between-turn advancement. */
export interface ProgressionHookContext {
  /** All agents (mutable: the hook modifies health fields in place) */
  agents: Agent[];
  timeDelta: number;
  time: number;
  turn: number;
  startTime: number;
  /** Seeded RNG for deterministic random operations */
  rng: { chance(probability: number): boolean; next(): number; pick<T>(arr: readonly T[]): T; int(min: number, max: number): number };
}

/** Context passed to the scenario department prompt hook. */
export interface PromptHookContext {
  department: string;
  state: SimulationState;
  scenario: Scenario;
  researchPacket: { canonicalFacts: Array<{ claim: string; source: string; url: string }>; counterpoints: Array<{ claim: string; source: string; url: string }>; departmentNotes: Record<string, string> };
}

/** Outcome classification for a turn. */
export type TurnOutcomeType = 'risky_success' | 'risky_failure' | 'conservative_success' | 'conservative_failure';

/**
 * Lifecycle hooks that a scenario provides to inject domain-specific behavior
 * into the generic engine. All hooks are optional.
 */
export interface ScenarioHooks {
  /** Called during between-turn progression for scenario-specific health/field changes (e.g., radiation, bone density) */
  progressionHook?: (ctx: ProgressionHookContext) => void;
  /** Builds department-specific prompt context lines for LLM department agents */
  departmentPromptHook?: (ctx: PromptHookContext) => string[];
  /** Returns the Event Director's system instructions for this scenario */
  directorInstructions?: () => string;
  /** Builds the Event Director's per-turn context prompt */
  directorPromptHook?: (ctx: Record<string, unknown>) => string;
  /** Returns location/identity/health phrasing for agent reaction prompts */
  reactionContextHook?: (colonist: Agent, ctx: { time: number; turn: number }) => string;
  /** Computes a timeline fingerprint classification from final simulation state */
  fingerprintHook?: (finalState: SimulationState, outcomeLog: Array<{ turn: number; time: number; outcome: string }>, leader: ActorConfig, toolRegs: Record<string, string[]>, maxTurns: number) => Record<string, string>;
  /** Returns a milestone event for narrative anchor turns (turn 1, final turn) */
  getMilestoneEvent?: (turn: number, maxTurns: number) => MilestoneEventDef | null;
  /** Returns politics deltas for political/social events, null if not applicable */
  politicsHook?: (category: string, outcome: string) => Record<string, number> | null;
}

// ---------------------------------------------------------------------------
// Event definitions (scenario-driven turn events)
// ---------------------------------------------------------------------------

/** An option presented to the commander for a turn event. */
export interface EventOptionDef {
  id: string;
  label: string;
  description: string;
  isRisky: boolean;
}

/** A milestone event (fixed narrative anchor, e.g., turn 1 founding or final assessment). */
export interface MilestoneEventDef {
  title: string;
  description: string;
  /** Full detailed narrative text for the milestone event */
  crisis?: string;
  options: EventOptionDef[];
  riskyOptionId: string;
  riskSuccessProbability: number;
  category: string;
  researchKeywords: string[];
  relevantDepartments: string[];
  turnSummary: string;
}

/** Legacy turn-based scenario (used by static SCENARIOS array and department context). */
export interface Scenario {
  turn: number;
  time: number;
  title: string;
  crisis: string;
  researchKeywords: string[];
  snapshotHints: Record<string, unknown>;
  riskyOption: string;
  riskSuccessProbability: number;
  options?: EventOptionDef[];
}

// ---------------------------------------------------------------------------
// Actor config (decision-making entity per parallel run)
// ---------------------------------------------------------------------------

/**
 * Configuration for a simulation actor — the swappable decision-making
 * entity that runs each parallel counterfactual. Was `ActorConfig` in
 * 0.7.x; renamed in 0.8.0 to match the user-facing terminology
 * (`scenario.labels.actorNoun` selects the per-domain label like
 * "commander" / "mayor" / "release director").
 *
 * The legacy `ActorConfig` name is exported below as a `@deprecated`
 * type alias so 0.7.x callers compile unchanged. Drop in 1.0.
 */
export interface ActorConfig {
  name: string;
  archetype: string;
  /**
   * The organizational unit / faction / org / team this leader
   * commands (e.g. "Station Alpha", "Engineering Org", "Player Faction").
   * Was `colony` pre-0.5.0; renamed for domain-agnostic semantics so
   * non-space scenarios (markets, game worlds, incident response) read
   * naturally instead of being named after a Mars heritage concept.
   */
  unit: string;
  /**
   * Six-axis HEXACO personality profile. Optional in v0.9: callers
   * supplying `traitProfile` (e.g. ai-agent leaders) can omit this.
   * The runtime requires AT LEAST ONE of `hexaco` or `traitProfile`;
   * `normalizeActorConfig` throws a clear error if both are missing.
   * When both are supplied, `traitProfile` wins for cue translation +
   * drift; `hexaco` is preserved on the artifact for legacy display.
   */
  hexaco?: HexacoProfile;
  /**
   * Pluggable trait profile naming a registered TraitModel and its
   * per-axis values. When set, this overrides the legacy `hexaco`
   * field for cue translation, drift, and prompt generation. When
   * omitted, the runtime synthesizes a profile from `hexaco` with
   * `modelId: 'hexaco'`.
   */
  traitProfile?: TraitProfile;
  instructions: string;
}

// ---------------------------------------------------------------------------
// LLM provider types
// ---------------------------------------------------------------------------

/** Supported LLM provider. */
export type LlmProvider = 'openai' | 'anthropic';

/** Model assignments for different simulation roles. */
export interface SimulationModelConfig {
  commander: string;
  departments: string;
  judge: string;
  director: string;
  agentReactions?: string;
}

// ---------------------------------------------------------------------------
// ScenarioPackage (top-level)
// ---------------------------------------------------------------------------

/**
 * The top-level contract for a Paracosm scenario.
 * Defines everything the engine needs to run a closed-state, turn-based
 * settlement simulation: world schema, departments, effects, UI metadata,
 * research knowledge, policies, presets, and lifecycle hooks.
 *
 * @example
 * ```typescript
 * import type { ScenarioPackage } from 'paracosm';
 * import { marsScenario } from 'paracosm';
 *
 * const myScenario: ScenarioPackage = { ... };
 * ```
 */
export interface ScenarioPackage {
  /** Unique scenario identifier (e.g., "mars-genesis", "lunar-outpost") */
  id: string;
  /**
   * Optional permalink to the scenario JSON in the public repo (e.g.
   * https://github.com/framerslab/paracosm/blob/master/scenarios/mars.json).
   * Surfaced in the dashboard so users can read or fork the scenario
   * source from the settings panel without leaving the app.
   */
  sourceUrl?: string;
  /** Semantic version of this scenario definition */
  version: string;
  /** Engine archetype this scenario targets */
  engineArchetype: 'closed_turn_based_settlement';

  labels: ScenarioLabels;
  theme: ScenarioTheme;
  setup: ScenarioSetupSchema;
  world: ScenarioWorldSchema;

  departments: DepartmentDefinition[];
  metrics: MetricDefinition[];
  events: EventDefinition[];
  effects: EffectDefinition[];
  ui: ScenarioUiDefinition;
  knowledge: KnowledgeBundle;
  policies: ScenarioPolicies;
  presets: ScenarioPreset[];
  hooks: ScenarioHooks;
}
