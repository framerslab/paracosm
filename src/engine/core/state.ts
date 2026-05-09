/**
 * Paracosm core state — kernel types, the deterministic SimulationKernel,
 * SeededRng, and the agent generator. The lowest layer most consumers
 * touch directly: build a kernel, advance it, snapshot it, replay it.
 *
 * @module paracosm/core
 */

/** Department ID. Scenario-defined, not a fixed union. */
export type Department = string;

export interface HexacoProfile {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  emotionality: number;
  honestyHumility: number;
}

export const HEXACO_TRAITS: (keyof HexacoProfile)[] = [
  'openness', 'conscientiousness', 'extraversion',
  'agreeableness', 'emotionality', 'honestyHumility',
];

export interface PromotionRecord {
  department: Department;
  role: string;
  turnPromoted: number;
  promotedBy: string;
}

export interface HexacoSnapshot {
  turn: number;
  time: number;
  hexaco: HexacoProfile;
}

export type TurnOutcome = 'risky_success' | 'risky_failure' | 'conservative_success' | 'conservative_failure';

export interface LifeEvent {
  time: number;
  event: string;
  source: Department | 'kernel' | 'commander';
}

export interface AgentCore {
  id: string;
  name: string;
  birthTime: number;
  marsborn: boolean;
  department: Department;
  role: string;
}

export interface AgentHealth {
  alive: boolean;
  deathTime?: number;
  deathCause?: string;
  psychScore: number;
  conditions: string[];
  /** Bone density percentage (scenario-specific, used by Mars/Lunar) */
  boneDensityPct?: number;
  /** Immutable starting bone density, captured on first progression
   *  tick so the decay curve targets a stable baseline rather than
   *  recursively re-decaying its own output (scenario-specific, used
   *  by Mars/Lunar physics modules). */
  boneDensityBase?: number;
  /** Cumulative radiation exposure in millisieverts (scenario-specific, used by Mars/Lunar) */
  cumulativeRadiationMsv?: number;
  /** Scenario-defined health fields beyond the standard set */
  [key: string]: unknown;
}

export interface AgentCareer {
  specialization: string;
  yearsExperience: number;
  rank: 'junior' | 'senior' | 'lead' | 'chief';
  achievements: string[];
  currentProject?: string;
}

export interface AgentSocial {
  partnerId?: string;
  childrenIds: string[];
  friendIds: string[];
  earthContacts: number;
}

export interface AgentNarrative {
  lifeEvents: LifeEvent[];
  featured: boolean;
}

/** A single memory entry from a agent's persistent memory. */
export interface AgentMemoryEntry {
  /** Turn when this memory was formed */
  turn: number;
  /** Simulated time (year/hour/quarter/tick per scenario's timeUnitNoun) */
  time: number;
  /** What the agent remembers (1-2 sentences) */
  content: string;
  /** Emotional valence of the memory */
  valence: 'positive' | 'negative' | 'neutral';
  /** Category of event that created this memory */
  category: string;
  /** Salience score 0-1 (higher = more likely to be recalled in future prompts) */
  salience: number;
}

/** Persistent memory state for a agent across simulation turns. */
export interface AgentMemory {
  /** Recent memories (last 3-5 turns, full detail) */
  shortTerm: AgentMemoryEntry[];
  /** Consolidated long-term beliefs and relationships (auto-summarized) */
  longTerm: string[];
  /** Stance on recurring themes, -1 to 1 (e.g., "independence": 0.7) */
  stances: Record<string, number>;
  /** Relationship sentiment toward other agents by ID, -1 to 1 */
  relationships: Record<string, number>;
}

export interface Agent {
  core: AgentCore;
  health: AgentHealth;
  career: AgentCareer;
  social: AgentSocial;
  narrative: AgentNarrative;
  hexaco: HexacoProfile;
  promotion?: PromotionRecord;
  hexacoHistory: HexacoSnapshot[];
  /** Persistent memory that accumulates across turns */
  memory: AgentMemory;
}

/**
 * Universal settlement metrics shared by every scenario. Fields below the
 * `population` and `morale` core are common but optional — a non-Mars
 * scenario might not have `pressurizedVolumeM3` for example, and is free
 * to set its own values via the index signature.
 *
 * Scenario-specific metrics (e.g., a submarine's hullPressureBars or a
 * corporation's quarterlyRevenue) live alongside via `[key: string]: number`.
 */
export interface WorldMetrics {
  /** Alive headcount. */
  population: number;
  /** Aggregate morale, 0..1. */
  morale: number;
  /** Months of food reserve at current consumption. */
  foodMonthsReserve: number;
  /** Generated power capacity, kW. */
  powerKw: number;
  /** Daily water budget, liters. */
  waterLitersPerDay: number;
  /** Sealed habitable volume, m³ — Mars/Lunar/space-specific, optional in others. */
  pressurizedVolumeM3: number;
  /** Life support headroom (max sustainable population). */
  lifeSupportCapacity: number;
  /** Infrastructure modules / building units. */
  infrastructureModules: number;
  /** Science / research output index. */
  scienceOutput: number;
  /** Scenario-defined metrics beyond the universal set. */
  [key: string]: number;
}

/**
 * Universal political/social state shared by every scenario.
 *
 * The previous shape baked in Mars-specific fields (earthDependencyPct,
 * governanceStatus 'earth-governed'/'commonwealth'/'independent',
 * independencePressure). Those still ship as defaults so the Mars and
 * Lunar scenarios continue to work without changes, but a custom scenario
 * (e.g., medieval kingdom with `vassalLoyaltyPct`, corporate sim with
 * `boardConfidence`) can extend via the index signature without touching
 * engine core.
 */
export interface WorldPolitics {
  /**
   * Mars/Lunar-specific: percentage of supplies still relying on the
   * parent body (Earth, planet, etc.). Custom scenarios may ignore.
   */
  earthDependencyPct: number;
  /**
   * Mars/Lunar-specific governance trajectory. Custom scenarios may ignore
   * or override with their own status string via the index signature.
   */
  governanceStatus: 'earth-governed' | 'commonwealth' | 'independent';
  /**
   * Mars/Lunar-specific: 0..1 pressure toward independence. Custom
   * scenarios may ignore.
   */
  independencePressure: number;
  /** Scenario-defined political variables beyond the universal set. */
  [key: string]: number | string | boolean;
}

export interface SimulationMetadata {
  simulationId: string;
  leaderId: string;
  seed: number;
  startTime: number;
  currentTime: number;
  currentTurn: number;
}

export interface TurnEvent {
  turn: number;
  time: number;
  type: 'crisis' | 'decision' | 'birth' | 'death' | 'promotion' | 'relationship' | 'tool_forge' | 'system';
  description: string;
  agentId?: string;
  /** For death events: the specific cause (natural causes, radiation
   *  cancer, starvation, despair, fatal fracture, accident: X). Lets
   *  downstream reporting break deaths down by cause instead of
   *  reporting a faceless total. */
  cause?: string;
  data?: Record<string, unknown>;
}

export interface SimulationState {
  metadata: SimulationMetadata;
  /**
   * Numerical world state. The `WorldMetrics` fields below
   * (`population`, `morale`, `foodMonthsReserve`, `powerKw`, etc.) are
   * Mars/space heritage conveniences. Any scenario extends the bag
   * via the `[key: string]: number` index signature without touching
   * these defaults. Was `colony` pre-0.5.0, then `systems` 0.5.x-0.6.x,
   * now `metrics` aligning with `WorldSnapshot.metrics` from the
   * universal schema.
   */
  metrics: WorldMetrics;
  agents: Agent[];
  politics: WorldPolitics;
  /**
   * Categorical state from `world.statuses` declarations
   * (governance state, faction alignment, funding round, etc.).
   * Keys are scenario-declared; always present (empty object when
   * the scenario declares no statuses).
   */
  statuses: Record<string, string | boolean>;
  /**
   * Environment conditions from `world.environment` declarations
   * (external context: market growth pct, radiation, depth, etc.).
   * Keys are scenario-declared; always present (empty object when
   * the scenario declares no environment fields).
   */
  environment: Record<string, number | string | boolean>;
  eventLog: TurnEvent[];
}

// ─── Kernel internals re-exports ────────────────────────────────────
// The simulation kernel + RNG + initial-population generator live in
// sibling files; surface them through this module so the public
// `paracosm/core` entry point exposes the full low-level kit. The root
// `paracosm` export DROPS these in v0.9.0 — power users importing them
// from root must migrate to `import { SimulationKernel } from 'paracosm/core'`.
export { SimulationKernel } from './kernel.js';
export { SeededRng } from './rng.js';
export { generateInitialPopulation } from './agent-generator.js';
export type { KeyPersonnel } from './agent-generator.js';
