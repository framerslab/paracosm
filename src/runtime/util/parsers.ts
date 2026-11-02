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
 * the kernel can apply. Legacy `proposedPatches` from reports (backward
 * compat) set values outright; the typed `recommendedEffects` the
 * commander selected by id are changes, added to the current values and
 * to each other.
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

  // Add up the typed effects selected by the commander.
  const deltas: Required<NonNullable<PolicyEffect['deltas']>> = { metrics: {}, politics: {} };
  if (decision.selectedEffectIds?.length) {
    const allEffects = reports.flatMap(r => r.recommendedEffects || []);
    for (const effectId of decision.selectedEffectIds) {
      const effect = allEffects.find(e => e.id === effectId);
      if (!effect) continue;
      for (const [key, delta] of Object.entries(effect.systemDelta ?? {})) {
        deltas.metrics[key] = (deltas.metrics[key] ?? 0) + (delta as number);
      }
      for (const [key, delta] of Object.entries(effect.politicsDelta ?? {})) {
        deltas.politics[key] = (deltas.politics[key] ?? 0) + (delta as number);
      }
    }
  }

  return {
    description: decision.decision,
    patches,
    deltas,
    events: [{ turn, time, type: 'decision', description: decision.decision.slice(0, 200), data: { policies: decision.selectedPolicies } }],
  };
}
