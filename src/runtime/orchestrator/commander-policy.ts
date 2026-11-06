/**
 * The policy step of a turn: the commander's decision and the department
 * reports it read become a change to the kernel's state, as the
 * orchestrator runs it after each decision.
 *
 * @module paracosm/runtime/orchestrator/commander-policy
 */
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { CommanderDecision, DepartmentReport } from '../contracts.js';
import { decisionToPolicy, resolveSelectedEffects } from '../util/parsers.js';

/** What one decision's policy step changed. */
export interface CommanderPolicyApplied {
  /** Each key the policy moved, with the change the kernel applied. */
  deltas: Record<string, number>;
  /** The selections that name no effect of the reports. */
  unmatched: string[];
  /** The selections whose key names more than one effect; none of them applied. */
  ambiguous: string[];
  /**
   * The keys of the selected effects that the run holds in neither its
   * metrics nor its politics, sorted; the kernel dropped each, so they
   * moved nothing.
   */
  notHeld: string[];
}

/**
 * Apply a commander's decision to the kernel. What it moved is logged as a
 * `[policy] effects` line, the selections that name no effect of the
 * reports (a free policy name, a key the reports do not hold) as a
 * `[policy] no effect named by` line, and the keys of the selected effects
 * the run does not hold as a `[policy] effect keys not held, dropped` line
 * with the keys it holds, so none is dropped without a trace. A report
 * that passed the run's schema (`departmentReportSchemaFor`) holds no such
 * key; one that came back as the fallback, or from a caller that validated
 * with the plain schema, may.
 */
export function applyCommanderPolicy(
  kernel: SimulationKernel,
  decision: CommanderDecision,
  reports: DepartmentReport[],
  turn: number,
  time: number,
  log: (line: string) => void = console.log,
): CommanderPolicyApplied {
  const deltas = kernel.applyPolicy(decisionToPolicy(decision, reports, turn, time));
  if (Object.keys(deltas).length > 0) log(`  [policy] effects: ${JSON.stringify(deltas)}`);
  const { picked, unmatched, ambiguous } = resolveSelectedEffects(decision, reports);
  const state = kernel.getState();
  const held = new Set(
    Object.entries({ ...state.metrics, ...state.politics }).filter(([, v]) => typeof v === 'number').map(([k]) => k),
  );
  const notHeld = [...new Set(picked.flatMap(({ effect }) => [
    ...Object.keys(effect.systemDelta ?? {}),
    ...Object.keys(effect.politicsDelta ?? {}),
  ]))].filter(k => !held.has(k)).sort();
  if (notHeld.length > 0) log(`  [policy] effect keys not held, dropped: ${notHeld.join(', ')} (the run holds ${[...held].join(', ')})`);
  if (unmatched.length > 0) log(`  [policy] no effect named by: ${unmatched.map(u => JSON.stringify(u)).join(', ')}`);
  if (ambiguous.length > 0) log(`  [policy] more than one effect named by, none applied: ${ambiguous.map(u => JSON.stringify(u)).join(', ')}`);
  return { deltas, unmatched, ambiguous, notHeld };
}
