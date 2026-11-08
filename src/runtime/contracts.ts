import type { Department, Agent } from '../engine/core/state.js';

export interface CrisisOption {
  id: string;
  label: string;
  description: string;
  isRisky: boolean;
}

export interface Citation {
  text: string;
  url: string;
  doi?: string;
  context: string;
}

export interface Risk {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface Opportunity {
  impact: 'low' | 'medium' | 'high';
  description: string;
}

export interface ForgedToolUsage {
  name: string;
  mode: 'compose' | 'sandbox';
  description: string;
  output: unknown;
  confidence: number;
}

export interface FeaturedAgentUpdate {
  agentId: string;
  updates: {
    health?: Partial<Agent['health']>;
    career?: Partial<Agent['career']>;
    narrative?: { event: string };
  };
}

export interface DepartmentReport {
  department: Department;
  summary: string;
  citations: Citation[];
  risks: Risk[];
  opportunities: Opportunity[];
  recommendedActions: string[];
  /**
   * What a model writes here, kept as it wrote it (notes in words, as a
   * rule). The policy step applies none of it: only the selected
   * `recommendedEffects` move the state, within one decision's bound,
   * and a `metrics`, `politics` or `agentUpdates` entry here is logged as
   * asked and left unapplied.
   */
  proposedPatches: Record<string, unknown>;
  forgedToolsUsed: ForgedToolUsage[];
  featuredAgentUpdates: FeaturedAgentUpdate[];
  confidence: number;
  openQuestions: string[];
  recommendedEffects?: TypedPolicyEffect[];
}

export interface CommanderDecision {
  selectedOptionId?: string;
  selectedEffectIds?: string[];
  decision: string;
  rationale: string;
  /**
   * Full stepwise reasoning populated by the commander's CoT prompt
   * (numbered list: personality pole, dept consensus, forged-tool
   * evidence, risk tradeoff, final choice). Empty string on pre-Zod
   * runs or on schema fallback. Dashboard renders behind a
   * "show full analysis" expand; `rationale` is the compressed view.
   */
  reasoning?: string;
  departmentsConsulted: Department[];
  selectedPolicies: string[];
  rejectedPolicies: Array<{ policy: string; reason: string }>;
  expectedTradeoffs: string[];
  watchMetricsNextTurn: string[];
}

export interface CrisisResearchPacket {
  canonicalFacts: Array<{ claim: string; source: string; url: string; doi?: string }>;
  counterpoints: Array<{ claim: string; source: string; url: string }>;
  departmentNotes: Record<string, string>;
}

export interface TurnArtifact {
  turn: number;
  time: number;
  crisis: string;
  departmentReports: DepartmentReport[];
  commanderDecision: CommanderDecision;
  policyEffectsApplied: string[];
  /**
   * The keys of the turn's selected effects that the run holds in neither
   * its metrics nor its politics, which moved nothing; absent when none.
   */
  policyKeysDropped?: string[];
  /**
   * Snapshot of the five runtime state bags at the end of the turn,
   * produced by the kernel. Widened in 0.7.x from the pre-F23
   * Mars-shape (flat `population`/`morale`/…) to a structural match
   * of the universal schema's WorldSnapshot: `metrics` for numeric
   * gauges plus optional `capacities`, `statuses`, `politics`, and
   * `environment` bags populated when the scenario declares them.
   * `buildRunArtifact` maps this directly onto per-timepoint
   * WorldSnapshot objects without flattening.
   *
   * Back-compat: Mars + lunar scenarios still put population, morale,
   * foodMonthsReserve, infrastructureModules, scienceOutput, births,
   * and deaths under `metrics`, so legacy consumers reading
   * `ta.stateSnapshotAfter.metrics.population` still work.
   */
  stateSnapshotAfter: {
    /** Numeric gauges from kernel.state.metrics (the primary bag). */
    metrics: Record<string, number>;
    /** Capacity constraints; optional, declared via world.capacities. */
    capacities?: Record<string, number>;
    /** Categorical statuses; optional, declared via world.statuses. */
    statuses?: Record<string, string | boolean>;
    /** Political / social variables; optional, declared via world.politics. */
    politics?: Record<string, number | string | boolean>;
    /** Environmental conditions; optional, declared via world.environment. */
    environment?: Record<string, number | string | boolean>;
  };
  /**
   * Each key a decision's selected effects moved otherwise than they
   * asked, by the event's index in the turn: the bound of one decision
   * held it, or a floor or ceiling stopped it. An `applied` of 0 is a
   * choice that moved nothing. Absent when every key moved as asked.
   */
  policyEffectsLimited?: Array<{ eventIndex: number; key: string; asked: number; applied: number }>;
}

export interface PromotionDecision {
  promotions: Array<{
    agentId: string;
    department: Department;
    role: string;
    reason: string;
  }>;
}

export type PolicyEffectType =
  | 'resource_shift'
  | 'capacity_expansion'
  | 'population_intake'
  | 'risk_mitigation'
  | 'governance_change'
  | 'social_investment'
  | 'research_bet';

export interface TypedPolicyEffect {
  id: string;
  type: PolicyEffectType;
  description: string;
  systemDelta?: Partial<{
    powerKw: number;
    foodMonthsReserve: number;
    waterLitersPerDay: number;
    pressurizedVolumeM3: number;
    lifeSupportCapacity: number;
    infrastructureModules: number;
    scienceOutput: number;
    morale: number;
  }>;
  politicsDelta?: Partial<{
    earthDependencyPct: number;
    independencePressure: number;
  }>;
}
