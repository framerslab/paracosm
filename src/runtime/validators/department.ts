/**
 * Zod schemas for department agent reports.
 *
 * The shape matches [contracts.ts `DepartmentReport`](../contracts.ts) so
 * downstream consumers (orchestrator, kernel, dashboard) can keep their
 * current typings. The schema adds structural defaults — the old
 * `emptyReport()` skeleton disappears once every caller migrates.
 *
 * @module paracosm/runtime/validators/department
 */
import { z } from 'zod';

export const CitationSchema = z.object({
  text: z.string().min(1),
  url: z.string().min(1),
  doi: z.string().optional(),
  context: z.string().default(''),
});

export const RiskSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().min(1),
});

export const OpportunitySchema = z.object({
  impact: z.enum(['low', 'medium', 'high']),
  description: z.string().min(1),
});

export const ForgedToolUsageSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(['compose', 'sandbox']),
  description: z.string().default(''),
  output: z.unknown(),
  confidence: z.number().min(0).max(1).default(0.7),
});

export const FeaturedAgentUpdateSchema = z.object({
  agentId: z.string().min(1),
  updates: z.object({
    health: z.record(z.string(), z.unknown()).optional(),
    career: z.record(z.string(), z.unknown()).optional(),
    narrative: z.object({ event: z.string() }).optional(),
  }),
});

/**
 * Typed effect the commander can select from dept recommendations.
 * Mirrors `TypedPolicyEffect` in contracts.ts.
 */
export const RecommendedEffectSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'resource_shift', 'capacity_expansion', 'population_intake',
    'risk_mitigation', 'governance_change', 'social_investment', 'research_bet',
  ]),
  description: z.string().default(''),
  systemDelta: z.record(z.string(), z.number()).optional(),
  politicsDelta: z.record(z.string(), z.number()).optional(),
});

export const DepartmentReportSchema = z.object({
  department: z.string().min(1),
  summary: z.string().min(1),
  citations: z.array(CitationSchema).default([]),
  risks: z.array(RiskSchema).default([]),
  opportunities: z.array(OpportunitySchema).default([]),
  recommendedActions: z.array(z.string()).default([]),
  proposedPatches: z.record(z.string(), z.unknown()).default({}),
  forgedToolsUsed: z.array(ForgedToolUsageSchema).default([]),
  featuredAgentUpdates: z.array(FeaturedAgentUpdateSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
  openQuestions: z.array(z.string()).default([]),
  recommendedEffects: z.array(RecommendedEffectSchema).default([]),
});

/**
 * The report schema for a run: {@link DepartmentReportSchema}, refusing an
 * effect whose `systemDelta` or `politicsDelta` names a key the run does
 * not hold. The kernel would drop such a delta and move nothing (the Mars
 * departments of 6 November 2026 wrote "power", "water" and "science");
 * refused here, the message names the keys the run holds, and the retry
 * of `sendAndValidate` hands it to the model. A key may sit in either
 * field: the kernel adds both to wherever the run holds the key.
 */
export function departmentReportSchemaFor(heldKeys: readonly string[]) {
  const held = new Set(heldKeys);
  const list = [...held].join(', ');
  return DepartmentReportSchema.superRefine((report, ctx) => {
    report.recommendedEffects.forEach((effect, i) => {
      for (const field of ['systemDelta', 'politicsDelta'] as const) {
        for (const key of Object.keys(effect[field] ?? {})) {
          if (held.has(key)) continue;
          ctx.addIssue({
            code: 'custom',
            path: ['recommendedEffects', i, field, key],
            message: `"${key}" is not a key this run holds, so it would move nothing; use only these keys: ${list}`,
          });
        }
      }
    });
  });
}

/**
 * The report a department sent once its retries are spent, when its one
 * fault is effect keys the run does not hold: those keys come out of
 * each effect's `systemDelta` and `politicsDelta`, one line through `log`
 * names them with the keys the run holds, and the rest of the report
 * stands (summary, risks, citations, every effect with its held keys).
 * `undefined` when the reply fails the plain schema
 * ({@link DepartmentReportSchema}) too, so the caller's fallback applies.
 * The orchestrator passes it as the `salvage` of `sendAndValidate`.
 */
export function salvageDepartmentReport(
  raw: unknown,
  heldKeys: readonly string[],
  log: (line: string) => void,
): DepartmentReportZ | undefined {
  const parsed = DepartmentReportSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const held = new Set(heldKeys);
  const dropped = new Set<string>();
  const report = parsed.data;
  for (const effect of report.recommendedEffects) {
    for (const field of ['systemDelta', 'politicsDelta'] as const) {
      const deltas = effect[field];
      if (!deltas) continue;
      for (const key of Object.keys(deltas)) {
        if (held.has(key)) continue;
        delete deltas[key];
        dropped.add(key);
      }
    }
  }
  if (dropped.size > 0) {
    log(`effect keys not held, dropped: ${[...dropped].sort().join(', ')} (the run holds ${[...held].join(', ')}); the rest of the report kept`);
  }
  return report;
}

export type DepartmentReportZ = z.infer<typeof DepartmentReportSchema>;
export type RiskZ = z.infer<typeof RiskSchema>;
export type OpportunityZ = z.infer<typeof OpportunitySchema>;
export type RecommendedEffectZ = z.infer<typeof RecommendedEffectSchema>;
