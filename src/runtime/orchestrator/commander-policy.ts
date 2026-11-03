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
}

/**
 * Apply a commander's decision to the kernel. What it moved is logged as a
 * `[policy] effects` line, and the selections that name no effect of the
 * reports (a free policy name, a key the reports do not hold) as a
 * `[policy] no effect named by` line, so none is dropped without a trace.
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
  const { unmatched, ambiguous } = resolveSelectedEffects(decision, reports);
  if (unmatched.length > 0) log(`  [policy] no effect named by: ${unmatched.map(u => JSON.stringify(u)).join(', ')}`);
  if (ambiguous.length > 0) log(`  [policy] more than one effect named by, none applied: ${ambiguous.map(u => JSON.stringify(u)).join(', ')}`);
  return { deltas, unmatched, ambiguous };
}
