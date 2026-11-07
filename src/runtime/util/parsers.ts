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
 * - `selectedEffectTotals` — what those effects ask of each key
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

/** The effects a decision selects, and the selections that name none or more than one. */
export interface EffectSelection {
  picked: SelectableEffect[];
  unmatched: string[];
  /** Selections whose key or bare id names more than one effect (two effects under one key, keys that differ only by case, or an id two reports hold); none of them applies. */
  ambiguous: string[];
}

/** Where a selection's key ends: the end, or the type or description written after it. */
const KEY_END = /^(?:$|[\s(:,;])/;

/**
 * The effects a commander's decision selects. The commander is asked for
 * `selectedPolicies` and writes the keys it is shown there, bare or with
 * the type or the description after them ("medical/effect_1 (risk_mitigation)"),
 * one or several to a string ("medical/effect_1, engineering/effect_1");
 * `selectedEffectIds` is read too. A selection names an effect by its key,
 * or by its bare id when one report holds that id; every department
 * numbers its effects from `effect_1`, so a bare id two reports hold names
 * neither. A key or an id matches as written first; in another case it
 * matches only when one effect has it. An effect named twice counts once.
 * A selection that names no effect is returned in `unmatched`, and one
 * whose key or bare id names two effects in `ambiguous`, once each.
 */
export function resolveSelectedEffects(decision: CommanderDecision, reports: DepartmentReport[]): EffectSelection {
  const effects = selectableEffects(reports);
  type Candidate = { entry: SelectableEffect; key: string; id: string };
  const all: Candidate[] = effects.map(e => ({ entry: e, key: e.key, id: String(e.effect.id ?? '') }));
  // Longest first, so a key that starts another ("effect_1" and "effect_10") never takes its place.
  const longest = (field: 'key' | 'id') => [...all].sort((a, b) => b[field].length - a[field].length);
  const keys = longest('key');
  const ids = longest('id');
  const fold = (v: string) => v.toLowerCase();
  const starts = (value: string, text: string) => value.length > 0 && text.startsWith(value) && KEY_END.test(text.slice(value.length));

  /** The effect a key at the head of `text` names: one, none, or more than one. */
  const byKey = (text: string): SelectableEffect | 'ambiguous' | undefined => {
    for (const cased of [true, false]) {
      const value = (c: Candidate) => (cased ? c.key : fold(c.key));
      const head = cased ? text : fold(text);
      const hit = keys.find(c => starts(value(c), head));
      if (!hit) continue;
      const same = keys.filter(c => value(c) === value(hit));
      return same.length > 1 ? 'ambiguous' : hit.entry;
    }
    return undefined;
  };
  /** The effect a bare id names, as written first: one, none, or more than one (two reports that both hold it). */
  const byId = (text: string, prefix: boolean): SelectableEffect | 'ambiguous' | undefined => {
    for (const cased of [true, false]) {
      const value = (c: Candidate) => (cased ? c.id : fold(c.id));
      const head = cased ? text : fold(text);
      const hit = ids.find(c => c.id.length > 0 && value(c) === head) ?? (prefix ? ids.find(c => starts(value(c), head)) : undefined);
      if (!hit) continue;
      const same = ids.filter(c => value(c) === value(hit));
      return same.length > 1 ? 'ambiguous' : hit.entry;
    }
    return undefined;
  };

  const picked = new Set<SelectableEffect>();
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const note = (list: string[], text: string) => { if (!list.includes(text)) list.push(text); };
  const choices = [...(decision.selectedEffectIds ?? []), ...(decision.selectedPolicies ?? [])];
  for (const chosen of choices) {
    if (typeof chosen !== 'string' || !chosen.trim()) continue;
    // A selection may list several keys, split by commas or semicolons; a
    // later part that starts with no key is the description going on.
    const parts = chosen.trim().split(/\s*[,;]\s*/);
    parts.forEach((part, i) => {
      if (!part) return;
      const first = i === 0;
      const key = byKey(part);
      const hit = key ?? byId(part, first);
      const label = first ? chosen.trim() : part;
      if (hit === 'ambiguous') note(ambiguous, label);
      else if (hit) picked.add(hit);
      else if (first) note(unmatched, label);
    });
  }
  return { picked: effects.filter(e => picked.has(e)), unmatched, ambiguous };
}

/**
 * What a decision's selected effects ask of each key: the sum of their
 * `systemDelta` and `politicsDelta` entries, one total a key whichever
 * field names it, as the kernel adds them (`applyPolicy`).
 */
export function selectedEffectTotals(decision: CommanderDecision, reports: DepartmentReport[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const { effect } of resolveSelectedEffects(decision, reports).picked) {
    for (const [key, delta] of [...Object.entries(effect.systemDelta ?? {}), ...Object.entries(effect.politicsDelta ?? {})]) {
      totals[key] = (totals[key] ?? 0) + (delta as number);
    }
  }
  return totals;
}

/**
 * Turn a commander's decision + the dept reports into a PolicyEffect
 * the kernel can apply. Legacy `proposedPatches` from reports (backward
 * compat) set values outright; the typed `recommendedEffects` the
 * commander selected (see {@link resolveSelectedEffects}) are changes,
 * added to the current values and to each other. With `bound`, each
 * key's total across both fields moves at most `bound(key)` either way
 * (the policy step passes the scenario's, `policyEffectBound`).
 */
export function decisionToPolicy(
  decision: CommanderDecision,
  reports: DepartmentReport[],
  turn: number,
  time: number,
  bound?: (key: string) => number,
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

  if (bound) {
    // The kernel adds a key's two fields into one change, so the bound
    // holds that total; a held total goes in the field that named the key
    // first, metrics before politics.
    const totals: Record<string, number> = { ...deltas.metrics };
    for (const [key, delta] of Object.entries(deltas.politics)) totals[key] = (totals[key] ?? 0) + delta;
    for (const [key, total] of Object.entries(totals)) {
      const limit = bound(key);
      const held = Math.max(-limit, Math.min(limit, total));
      if (held === total) continue;
      if (key in deltas.metrics) {
        deltas.metrics[key] = held;
        delete deltas.politics[key];
      } else {
        deltas.politics[key] = held;
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
