import type { HexacoProfile } from '../engine/core/state.js';
import type { TraitProfile } from '../engine/traits/index.js';
export type { HexacoProfile };

import type { ActorAuthorship } from '../engine/types.js';

export interface ActorConfig {
  aiAuthorship?: ActorAuthorship;
  name: string;
  archetype: string;
  unit: string;
  /** Optional in v0.9: ai-agent and other non-HEXACO trait models can
   * omit this if they supply `traitProfile` instead. */
  hexaco?: HexacoProfile;
  /** Pluggable trait profile naming a registered TraitModel. When set,
   * overrides `hexaco` for cue translation and drift. See engine/types.ts. */
  traitProfile?: TraitProfile;
  instructions: string;
}

export interface Citation {
  text: string;
  url: string;
  doi?: string;
  context: string;
}

export interface ForgedToolRecord {
  name: string;
  mode: 'compose' | 'sandbox';
  description: string;
  confidence: number;
  judgeVerdict: 'approved' | 'rejected';
}

export interface SystemsSnapshot {
  population: number;
  waterLitersPerDay: number;
  foodMonthsReserve: number;
  powerKw: number;
  morale: number;
  infrastructureModules: number;
  scienceOutput: number;
  unplannedDeaths: number;
  toolsForgedTotal: number;
}

export interface TurnResult {
  turn: number;
  time: number;
  title: string;
  crisis: string;
  decision: string;
  reasoning: string;
  citations: Citation[];
  toolsForged: ForgedToolRecord[];
  snapshot: SystemsSnapshot;
  rawResponse: string;
}

export interface SimulationLog {
  simulation: 'mars-genesis';
  version: '1.0.0';
  startedAt: string;
  completedAt: string;
  leader: Omit<ActorConfig, 'instructions'>;
  turns: TurnResult[];
  finalAssessment: {
    population: number;
    toolsForged: number;
    unplannedDeaths: number;
    scienceOutput: number;
    infrastructureModules: number;
    morale: number;
  };
}

export interface Scenario {
  turn: number;
  time: number;
  title: string;
  crisis: string;
  researchKeywords: string[];
  snapshotHints: Partial<SystemsSnapshot>;
  riskyOption: string;
  riskSuccessProbability: number;
  options?: import('../runtime/contracts.js').CrisisOption[];
}
