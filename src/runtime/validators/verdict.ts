/**
 * Zod schema for the pair-runner verdict call.
 *
 * Replaces the existing `<thinking>...</thinking><verdict>{...}</verdict>`
 * transport. Reasoning (previously thrown away after the strip) now lives
 * in the `reasoning` field. The schema enforces 0-10 score bounds per
 * axis — the old parser silently accepted any number.
 *
 * @module paracosm/runtime/validators/verdict
 */
import { z } from 'zod';

const ScoreAxesSchema = z.object({
  survival: z.number().min(0).max(10),
  prosperity: z.number().min(0).max(10),
  morale: z.number().min(0).max(10),
  innovation: z.number().min(0).max(10),
});

export const VerdictScoresSchema = z.object({
  a: ScoreAxesSchema,
  b: ScoreAxesSchema,
});

export const VerdictSchema = z.object({
  winner: z.enum(['A', 'B', 'tie']),
  winnerName: z.string().min(1),
  headline: z.string().min(1).max(80),
  summary: z.string().min(1),
  keyDivergence: z.string().min(1),
  scores: VerdictScoresSchema,
  reasoning: z.string().default(''),
});

export type VerdictZ = z.infer<typeof VerdictSchema>;
export type VerdictScoresZ = z.infer<typeof VerdictScoresSchema>;

/**
 * Per-actor entry in a cohort verdict. Cohort runs (3+ actors) skip the
 * pair-mode A-vs-B winner schema and emit a ranked list with per-actor
 * scores + rationale instead.
 */
export const CohortRankingEntrySchema = z.object({
  actorName: z.string().min(1),
  actorIndex: z.number().int().min(0),
  rank: z.number().int().min(1),
  scores: ScoreAxesSchema,
  rationale: z.string().min(1),
});

/**
 * Zod schema for the cohort verdict LLM call emitted by
 * `runBatchSimulations`. Produces an absolute winner + a full ranked
 * list so the dashboard can render a cohort-aware top banner instead
 * of silently skipping the verdict the way it did before this schema
 * landed.
 */
export const CohortVerdictSchema = z.object({
  winner: z.string().min(1),
  winnerIndex: z.number().int().min(0),
  headline: z.string().min(1).max(80),
  summary: z.string().min(1),
  keyDivergence: z.string().min(1),
  rankings: z.array(CohortRankingEntrySchema).min(2),
  reasoning: z.string().default(''),
});

export type CohortVerdictZ = z.infer<typeof CohortVerdictSchema>;
export type CohortRankingEntryZ = z.infer<typeof CohortRankingEntrySchema>;
