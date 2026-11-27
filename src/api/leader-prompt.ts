import type { LlmProvider } from '../engine/types.js';

/** The trait names used in a written leader's prompt explanation. */
export type LeaderPromptTrait =
  | 'honesty-humility'
  | 'emotionality'
  | 'extraversion'
  | 'agreeableness'
  | 'conscientiousness'
  | 'openness';

/** The exact first two commander inputs and a sample turn for one written place. */
export interface LeaderPromptAnswer {
  scenarioId: string;
  place: number;
  name: string;
  filled: boolean;
  parts: { system: string; opening: string; sampleTurn: string };
  scores: { trait: LeaderPromptTrait; value: number; line: string | null }[];
  speaking: LeaderPromptTrait[];
  bar: number | null;
  /** The commander model on a free run, or null off the hosted demo. */
  model: { provider: LlmProvider; model: string } | null;
}
