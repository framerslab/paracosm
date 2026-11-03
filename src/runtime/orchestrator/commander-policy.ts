/**
 * The policy step of a turn: the commander's decision and the department
 * reports it read become a change to the kernel's state, as the
 * orchestrator runs it after each decision.
 *
 * @module paracosm/runtime/orchestrator/commander-policy
 */
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { CommanderDecision, DepartmentReport } from '../contracts.js';
import { decisionToPolicy } from '../util/parsers.js';

/** What one decision's policy step changed. */
export interface CommanderPolicyApplied {
  /** Each key the policy moved, with the change the kernel applied. */
  deltas: Record<string, number>;
  /** The selections that name no effect of the reports. */
  unmatched: string[];
}

/**
 * Apply a commander's decision to the kernel and log what it moved as a
 * `[policy] effects` line.
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
  return { deltas, unmatched: [] };
}
