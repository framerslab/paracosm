/**
 * Skeleton + policy-translation helpers that survived the Zod migration.
 *
 * The old JSON-salvage parsers (`parseDeptReport`, `parseCmdDecision`,
 * `cleanSummary`, `buildReadableSummary`) were deleted once every caller
 * migrated to `generateValidatedObject` / `sendAndValidate` with Zod
 * schemas. These helpers remain:
 *
 * - `humanizeToolName` — UI-friendly tool name display
 * - `emptyReport` / `emptyDecision` — fallback skeletons used when the
 *   validated wrappers fall through (schema retries exhausted)
 * - `decisionToPolicy` — translates a typed commander decision + the
 *   supporting dept reports into a `PolicyEffect` the kernel applies
 *
 * All pure — no IO, no LLM calls, no global state.
 *
 * @module paracosm/runtime/util/parsers
 */

import type { Department } from '../../engine/core/state.js';
import type { DepartmentReport, CommanderDecision } from '../contracts.js';
import type { PolicyEffect } from '../../engine/core/kernel.js';

/**
 * Turn a machine-readable tool name into something UI-friendly.
 * Strips `_v2` / `_v3` suffixes so reuses of the same concept
 * collapse visually, then title-cases.
 */
export function humanizeToolName(name: string): string {
  return name.replace(/_v\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Empty DepartmentReport skeleton. Every field a typed array/object so spreads are safe. */
export function emptyReport(d: Department): DepartmentReport {
  return { department: d, summary: '', citations: [], risks: [], opportunities: [], recommendedActions: [], proposedPatches: {}, forgedToolsUsed: [], featuredAgentUpdates: [], confidence: 0.7, openQuestions: [], recommendedEffects: [] };
}

/** Empty CommanderDecision skeleton. `departmentsConsulted` seeded from the active dept list. */
export function emptyDecision(d: Department[]): CommanderDecision {
  return { decision: '', rationale: '', departmentsConsulted: d, selectedPolicies: [], rejectedPolicies: [], expectedTradeoffs: [], watchMetricsNextTurn: [] };
}

/**
 * Turn a commander's decision + the dept reports into a PolicyEffect
 * the kernel can apply. Combines legacy `proposedPatches` from reports
 * (backward compat) with typed `recommendedEffects` the commander
 * selected by id.
 */
export function decisionToPolicy(
  decision: CommanderDecision,
  reports: DepartmentReport[],
  turn: number,
  time: number,
): PolicyEffect {
  const patches: PolicyEffect['patches'] = {};

  // Apply legacy proposedPatches (backward compat).
  for (const r of reports) {
    if (r.proposedPatches.metrics) patches.metrics = { ...patches.metrics, ...r.proposedPatches.metrics };
    if (r.proposedPatches.politics) patches.politics = { ...patches.politics, ...r.proposedPatches.politics };
    if (r.proposedPatches.agentUpdates) patches.agentUpdates = [...(patches.agentUpdates || []), ...r.proposedPatches.agentUpdates];
  }

  // Apply typed effects selected by commander.
  if (decision.selectedEffectIds?.length) {
    const allEffects = reports.flatMap(r => r.recommendedEffects || []);
    for (const effectId of decision.selectedEffectIds) {
      const effect = allEffects.find(e => e.id === effectId);
      if (!effect) continue;
      if (effect.systemDelta) {
        patches.metrics = patches.metrics || {};
        for (const [key, delta] of Object.entries(effect.systemDelta)) {
          const current = (patches.metrics as any)[key] ?? 0;
          (patches.metrics as any)[key] = current + (delta as number);
        }
      }
      if (effect.politicsDelta) {
        patches.politics = patches.politics || {};
        for (const [key, delta] of Object.entries(effect.politicsDelta)) {
          const current = (patches.politics as any)[key] ?? 0;
          (patches.politics as any)[key] = current + (delta as number);
        }
      }
    }
  }

  return {
    description: decision.decision,
    patches,
    events: [{ turn, time, type: 'decision', description: decision.decision.slice(0, 200), data: { policies: decision.selectedPolicies } }],
  };
}
