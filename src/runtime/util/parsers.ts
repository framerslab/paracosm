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
 * - `resolveSelectedEffects` — the effects a commander's decision selects
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
 * The effects a commander can select, each under a key of its own. Every
 * department numbers its effects from `effect_1`, so an id alone names one
 * in each report; the key names the department too.
 */
export function selectableEffects(reports: DepartmentReport[]) {
  return reports.flatMap(r => (r.recommendedEffects || []).map(effect => ({ key: `${r.department}/${effect.id}`, effect })));
}

/** One effect a commander can select, under its key. */
export type SelectableEffect = ReturnType<typeof selectableEffects>[number];

/** The effects a decision selects, and the selections that name none. */
export interface EffectSelection {
  picked: SelectableEffect[];
  unmatched: string[];
}

/** Where a selection's key ends: the end, or the type or description written after it. */
const KEY_END = /^(?:$|[\s(:,;])/;

/**
 * The effects a commander's decision selects. The commander is asked for
 * `selectedPolicies` and writes the keys it is shown there, bare or with
 * the type or the description after them ("medical/effect_1 (risk_mitigation)");
 * `selectedEffectIds` is read too. A selection names an effect by its key,
 * or by its bare id, which reads the first report that holds it; case does
 * not count, and an effect named twice counts once. A selection that names
 * no effect is returned in `unmatched`, once.
 */
export function resolveSelectedEffects(decision: CommanderDecision, reports: DepartmentReport[]): EffectSelection {
  const effects = selectableEffects(reports);
  const byKey = effects.map(e => ({ entry: e, key: e.key.toLowerCase(), id: String(e.effect.id ?? '').toLowerCase() }));
  // Longest first, so a key that starts another ("effect_1" and "effect_10") never takes its place.
  const longest = (field: 'key' | 'id') => [...byKey].sort((a, b) => b[field].length - a[field].length);
  const keys = longest('key');
  const ids = longest('id');
  const names = (field: 'key' | 'id', text: string) => (c: (typeof byKey)[number]) =>
    c[field].length > 0 && text.startsWith(c[field]) && KEY_END.test(text.slice(c[field].length));

  const picked = new Set<SelectableEffect>();
  const unmatched: string[] = [];
  const choices = [...(decision.selectedEffectIds ?? []), ...(decision.selectedPolicies ?? [])];
  for (const chosen of choices) {
    if (typeof chosen !== 'string' || !chosen.trim()) continue;
    const text = chosen.trim().toLowerCase();
    const hit = keys.find(names('key', text)) ?? ids.find(c => c.id === text) ?? ids.find(names('id', text));
    if (hit) picked.add(hit.entry);
    else if (!unmatched.includes(chosen.trim())) unmatched.push(chosen.trim());
  }
  return { picked: effects.filter(e => picked.has(e)), unmatched };
}

/**
 * Turn a commander's decision + the dept reports into a PolicyEffect
 * the kernel can apply. Legacy `proposedPatches` from reports (backward
 * compat) set values outright; the typed `recommendedEffects` the
 * commander selected (see {@link resolveSelectedEffects}) are changes,
 * added to the current values and to each other.
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
  for (const { effect } of resolveSelectedEffects(decision, reports).picked) {
    for (const [key, delta] of Object.entries(effect.systemDelta ?? {})) {
      deltas.metrics[key] = (deltas.metrics[key] ?? 0) + (delta as number);
    }
    for (const [key, delta] of Object.entries(effect.politicsDelta ?? {})) {
      deltas.politics[key] = (deltas.politics[key] ?? 0) + (delta as number);
    }
  }

  return {
    description: decision.decision,
    patches,
    deltas,
    events: [{ turn, time, type: 'decision', description: decision.decision.slice(0, 200), data: { policies: decision.selectedPolicies } }],
  };
}
