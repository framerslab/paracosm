/**
 * Zod schemas for commander-session outputs.
 *
 * Shape matches [contracts.ts `CommanderDecision`](../contracts.ts) plus
 * one new field: `reasoning` (preserves CoT that was previously stripped
 * and thrown away). The schema is the target for sendAndValidate over
 * the commander session so its conversation memory survives validation
 * retries.
 *
 * @module paracosm/runtime/validators/commander
 */
import { z } from 'zod';

/** A reply value that holds nothing: missing, null, a boolean, 0, an empty array or an empty object. */
function holdsNothing(v: unknown): boolean {
  if (v == null || typeof v === 'boolean' || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  return typeof v === 'object' && Object.keys(v as object).length === 0;
}

export const CommanderDecisionSchema = z.object({
  selectedOptionId: z.string().optional(),
  /**
   * The fact the commander departs from its bar for, when its prompt
   * stated one (see `buildDecisionRule`): a fact the stated odds do not
   * count, with its number. Empty when it follows its bar. A value that
   * holds nothing (missing, null, a boolean, 0, [] or {}) reads as empty
   * and any other value that is not text as its JSON, so the field never
   * costs a retry; the commander step flags a departure with this field
   * empty (`checkBarDeparture`).
   */
  barDeparture: z.preprocess(
    (v) => (holdsNothing(v) ? '' : typeof v === 'string' ? v : JSON.stringify(v)),
    z.string().default(''),
  ),
  selectedEffectIds: z.array(z.string()).optional(),
  decision: z.string().min(1),
  rationale: z.string().default(''),
  /**
   * Full stepwise reasoning. Replaces the old `<thinking>...</thinking>` tag
   * that was stripped before JSON parse and discarded. Populated BEFORE
   * the model commits to selectedOptionId so the field captures actual
   * deliberation, not post-hoc justification. Dashboard renders this
   * behind a "show full analysis" expand; rationale is the default view.
   */
  reasoning: z.string().default(''),
  departmentsConsulted: z.array(z.string()).default([]),
  selectedPolicies: z.array(z.string()).default([]),
  // Accept BOTH shapes the LLM emits in production:
  //   1. The schema-canonical { policy, reason } object form, and
  //   2. Bare strings (the policy name only) — every commander turn on
  //      every supported model emits this form a non-trivial fraction
  //      of the time, costing 3 retry calls per turn before falling
  //      back. Production diagnostic at commit 7a3ef1529 caught it as
  //      'rejectedPolicies.0:invalid_type=expected object, received
  //      string'. Coercing strings to { policy, reason: '' } keeps the
  //      full schema downstream contract intact while skipping the
  //      retry-and-fallback storm.
  rejectedPolicies: z.preprocess(
    (v) => {
      if (!Array.isArray(v)) return v;
      return v.map((entry) =>
        typeof entry === 'string'
          ? { policy: entry, reason: '' }
          : entry,
      );
    },
    z.array(
      z.object({ policy: z.string().min(1), reason: z.string().default('') }),
    ).default([]),
  ),
  expectedTradeoffs: z.array(z.string()).default([]),
  watchMetricsNextTurn: z.array(z.string()).default([]),
});

export const PromotionEntrySchema = z.object({
  agentId: z.string().min(1),
  department: z.string().min(1),
  role: z.string().min(1),
  reason: z.string().default(''),
});

export const PromotionsSchema = z.object({
  promotions: z.array(PromotionEntrySchema).default([]),
});

export type CommanderDecisionZ = z.infer<typeof CommanderDecisionSchema>;
export type PromotionsZ = z.infer<typeof PromotionsSchema>;
export type PromotionEntryZ = z.infer<typeof PromotionEntrySchema>;
