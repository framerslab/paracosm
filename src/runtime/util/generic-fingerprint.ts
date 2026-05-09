/**
 * Generic, scenario-agnostic timeline fingerprint.
 *
 * Computes resilience / prosperity / innovation / risk-style /
 * decision-discipline classifications from the run's universal data:
 * outcome history, leader HEXACO, final colony stats, agent survival,
 * and the forged toolbox.
 *
 * Used as the default for any scenario without its own fingerprintHook,
 * AND merged with scenario-specific fingerprints so domain hooks don't
 * have to re-implement the universal pieces (innovation index, decision
 * discipline, etc.).
 */
import type { SimulationState, TurnOutcome } from '../../engine/core/state.js';
import type { ActorConfig } from '../../engine/types.js';

export function genericFingerprint(
  finalState: SimulationState,
  outcomeLog: Array<{ turn: number; time: number; outcome: TurnOutcome }>,
  leader: ActorConfig,
  toolRegs: Record<string, string[]>,
  maxTurns: number,
): Record<string, string> {
  const totalDecisions = outcomeLog.length || 1;
  const riskySuccess = outcomeLog.filter(o => o.outcome === 'risky_success').length;
  const riskyFailure = outcomeLog.filter(o => o.outcome === 'risky_failure').length;
  const safeSuccess = outcomeLog.filter(o => o.outcome === 'conservative_success').length;
  const safeFailure = outcomeLog.filter(o => o.outcome === 'conservative_failure').length;
  const successCount = riskySuccess + safeSuccess;
  const riskyCount = riskySuccess + riskyFailure;
  const successRate = successCount / totalDecisions;
  const riskRate = riskyCount / totalDecisions;

  const alive = finalState.agents.filter(a => a.health.alive).length;
  const totalAgents = finalState.agents.length || 1;
  const survivalRate = alive / totalAgents;

  // Innovation index from the toolbox: total unique tools forged across
  // all departments. Three buckets — sparse, productive, prolific.
  const totalTools = Object.values(toolRegs).flat().length;
  const departmentsWithTools = Object.values(toolRegs).filter(arr => arr.length > 0).length;

  let innovation: string;
  if (totalTools >= 12) innovation = 'prolific';
  else if (totalTools >= 5) innovation = 'productive';
  else if (totalTools >= 1) innovation = 'experimental';
  else innovation = 'conservative';

  let resilience: string;
  if (survivalRate >= 0.95 && successRate >= 0.7) resilience = 'robust';
  else if (survivalRate >= 0.85) resilience = 'stable';
  else if (survivalRate >= 0.6) resilience = 'strained';
  else resilience = 'fragile';

  let riskStyle: string;
  if (riskRate >= 0.7) riskStyle = 'bold';
  else if (riskRate >= 0.4) riskStyle = 'opportunistic';
  else riskStyle = 'cautious';

  let decisionDiscipline: string;
  if (successRate >= 0.8) decisionDiscipline = 'decisive';
  else if (successRate >= 0.5) decisionDiscipline = 'mixed';
  else decisionDiscipline = 'undisciplined';

  // One-line summary suitable for fingerprint UI / verdict prompt context.
  const summary = `${riskStyle} leadership with ${decisionDiscipline} execution; ${innovation} use of emergent tooling (${totalTools} forged across ${departmentsWithTools} depts) over ${maxTurns} turns.`;

  return {
    resilience,
    innovation,
    riskStyle,
    decisionDiscipline,
    summary,
    /** Counts surfaced as strings so callers can display without re-derivation. */
    totalTools: String(totalTools),
    successRate: successRate.toFixed(2),
    survivalRate: survivalRate.toFixed(2),
    riskRate: riskRate.toFixed(2),
  };
}
