/**
 * Atlas Lab scenario hooks. The scenario uses the generic
 * `closed_turn_based_settlement` engine archetype + the JSON-driven
 * `effects` table for metric drift, so this hooks module is much
 * leaner than mars/ or lunar/. We only override:
 *
 *   - departmentPromptHook: per-department context lines ("AlignBench
 *     0.84, SpecGaming 4.2%, RedTeam 55%") so each department LLM sees
 *     the metrics most relevant to its role
 *   - directorInstructions: an AI-lab-shaped Crisis Director prompt
 *     that knows about model evals, RSP tiers, capability races,
 *     spec-gaming, mesa-objectives — instead of the generic settlement
 *     director
 *   - fingerprintHook: classifies the final timeline into the
 *     ship/hold/lose-the-race trichotomy that's visible across the
 *     run summary cards in the dashboard
 *   - politicsHook: modest board/investor sentiment shifts per event
 *     category, so the political dimension actually drifts during a
 *     run
 *
 * Progression-hook is intentionally absent — Atlas Lab metrics drift
 * via the `effects` table in scenario.json keyed on event category,
 * not per-agent radiation or bone density. Adding a progression-hook
 * here would just duplicate effects-table behaviour.
 *
 * @module paracosm/engine/atlas-lab/hooks
 */
import type { SimulationState } from '../core/state.js';
import type { Agent, ActorConfig } from '../types.js';

/**
 * Per-department context lines that get injected into the LLM prompt
 * for that department. Surfacing the metrics each role actually
 * cares about means the alignment director argues about
 * `alignmentBench` and `specGamingRate` while the capability director
 * argues about `capabilityIndex` and `competitorCapabilityGap` —
 * without it, every department reads the same opaque metric block.
 */
export function atlasLabDepartmentPromptLines(dept: string, state: SimulationState): string[] {
  const m = state.metrics as Record<string, number>;
  const env = (state.environment ?? {}) as Record<string, number>;
  const pol = (state.politics ?? {}) as Record<string, number>;
  const lines: string[] = [];

  switch (dept) {
    case 'alignment_research':
      lines.push(
        'ALIGNMENT METRICS:',
        `AlignmentBench: ${(m.alignmentBench ?? 0).toFixed(3)} | SpecGamingRate: ${((m.specGamingRate ?? 0) * 100).toFixed(2)}% | RedTeamCoverage: ${((m.redTeamCoverage ?? 0) * 100).toFixed(0)}%`,
        `RSP Tier: ${(state.statuses as Record<string, string> | undefined)?.rspTier ?? 'unset'}`,
        '',
      );
      break;
    case 'capability_research':
      lines.push(
        'CAPABILITY METRICS:',
        `CapabilityIndex: ${(m.capabilityIndex ?? 0).toFixed(3)} | CompetitorGap: ${((env.competitorCapabilityGap ?? 0)).toFixed(3)} | ReleaseReadiness: ${((m.releaseReadiness ?? 0) * 100).toFixed(0)}%`,
        `Training-runs/month capacity: ${(state.capacities as Record<string, number> | undefined)?.trainingRunsPerMonth ?? '?'}`,
        '',
      );
      break;
    case 'governance':
      lines.push(
        'GOVERNANCE / BOARD:',
        `BoardConfidence: ${(pol.boardConfidence ?? 0).toFixed(0)}% | InvestorPressure: ${(pol.investorPressure ?? 0).toFixed(0)}% | RegulatoryHeat: ${(env.regulatoryHeat ?? 0).toFixed(0)}%`,
        '',
      );
      break;
    case 'deployment_engineering':
      lines.push(
        'DEPLOYMENT READINESS:',
        `RedTeamCoverage: ${((m.redTeamCoverage ?? 0) * 100).toFixed(0)}% | ReleaseReadiness: ${((m.releaseReadiness ?? 0) * 100).toFixed(0)}% | RSP Tier: ${(state.statuses as Record<string, string> | undefined)?.rspTier ?? 'unset'}`,
        '',
      );
      break;
    case 'communications':
      lines.push(
        'COMMS / PRESS POSTURE:',
        `BoardConfidence: ${(pol.boardConfidence ?? 0).toFixed(0)}% | InvestorPressure: ${(pol.investorPressure ?? 0).toFixed(0)}% | CompetitorGap: ${(env.competitorCapabilityGap ?? 0).toFixed(3)}`,
        '',
      );
      break;
  }

  return lines;
}

/**
 * Crisis Director system prompt for Atlas Lab. The default settlement
 * director generates "blizzards" and "hull breaches" — wrong frame for
 * an AI-lab simulation. This rewrites the director's voice + ruleset
 * to match the lab's domain (model evals, training runs, board
 * meetings, regulatory subpoenas, talent poaching, RSP tier changes).
 */
export function atlasLabDirectorInstructions(): string {
  return `You are the Crisis Director for Atlas Lab, a frontier AI research lab racing competitor labs to ship a multimodal foundation model that just crossed deployment-grade capability thresholds. You observe the lab's state each month and generate events that test the leadership's weaknesses, exploit consequences of prior decisions, and create narrative tension between the alignment and capability councils.

RULES:
- Every event MUST be specific to AI-lab operations: an eval result, a training-run anomaly, a competitor release, a regulatory subpoena, a board member resignation over RSP, a talent poaching, an investor demanding deployment, a press leak, a red-team paper preprint, a refusal-policy regression in production. Never use generic settlement themes (no blizzards, no plagues, no hull breaches).
- Anchor each crisis to AT LEAST ONE concrete metric: AlignmentBench, SpecGamingRate, CapabilityIndex, RedTeamCoverage, ReleaseReadiness, BoardConfidence, RegulatoryHeat, CompetitorGap.
- The risky option should always carry a real ship-vs-hold tension: ship now (capability gain, alignment risk) vs hold (alignment gain, competitor catches up).
- Categories you may use: alignment, capability, safety_breach, regulatory, talent, financial, press.
- When AlignmentBench < 0.7 OR SpecGamingRate > 0.07 OR RedTeamCoverage < 0.5, escalate the next event to a safety_breach or regulatory category. The lab's RSP tier was set up to catch exactly this profile.
- When CompetitorGap > 0.1 AND CapabilityIndex > 0.85, escalate to a competitor-shipped press cycle that erodes BoardConfidence — the board is watching the gap close.

Each crisis you generate ships with options the leadership will pick from. Make the tradeoffs sharp. Atlas Lab gets compared against another council running the same scenario in parallel, so the divergent outcomes are the product.`;
}

/**
 * Fingerprint classifier. Tags the final timeline with an Atlas-Lab-
 * shaped trichotomy: "shipped-aggressive" (capability gains beat
 * alignment), "held-the-line" (alignment metrics survived
 * competitor pressure), "lost-the-race" (held too long, competitor
 * shipped first). Surfaces in the run summary cards so users can
 * see at a glance how the timeline ended without re-reading the
 * verdict prose.
 */
export function atlasLabFingerprint(
  finalState: SimulationState,
  _outcomeLog: Array<{ turn: number; time: number; outcome: string }>,
  _leader: ActorConfig,
  _toolRegs: Record<string, string[]>,
  _maxTurns: number,
): Record<string, string> {
  const m = finalState.metrics as Record<string, number>;
  const env = (finalState.environment ?? {}) as Record<string, number>;
  const alignFinal = m.alignmentBench ?? 0;
  const capFinal = m.capabilityIndex ?? 0;
  const competitorGap = env.competitorCapabilityGap ?? 0;
  const released = (m.releaseReadiness ?? 0) >= 0.85;

  let posture: string;
  if (released && capFinal >= 0.88 && alignFinal < 0.78) {
    posture = 'shipped-aggressive';
  } else if (alignFinal >= 0.84 && competitorGap < 0.15) {
    posture = 'held-the-line';
  } else if (competitorGap >= 0.15) {
    posture = 'lost-the-race';
  } else {
    posture = 'mixed-posture';
  }

  return {
    posture,
    alignment: alignFinal >= 0.85 ? 'high' : alignFinal >= 0.7 ? 'moderate' : 'degraded',
    capability: capFinal >= 0.9 ? 'frontier' : capFinal >= 0.78 ? 'competitive' : 'lagging',
    released: released ? 'shipped' : 'held',
  };
}

/**
 * Politics deltas per event category. The base `effects` table
 * already moves the engineering metrics (alignmentBench etc); this
 * hook adds the political dimension on top — board confidence,
 * investor pressure — keyed on the same category enum.
 */
export function atlasLabPoliticsHook(category: string, outcome: string): Record<string, number> | null {
  const success = outcome.endsWith('success');
  switch (category) {
    case 'alignment':
      return { boardConfidence: success ? 3 : -2 };
    case 'capability':
      return { boardConfidence: success ? 4 : -3, investorPressure: success ? -3 : 4 };
    case 'safety_breach':
      return { boardConfidence: -8, investorPressure: 5 };
    case 'regulatory':
      return { boardConfidence: -4, investorPressure: 2 };
    case 'press':
      return { boardConfidence: success ? 5 : -4, investorPressure: success ? -2 : 5 };
    case 'talent':
      return { boardConfidence: success ? 2 : -3 };
    case 'financial':
      return { boardConfidence: success ? 1 : -3, investorPressure: success ? -3 : 6 };
    default:
      return null;
  }
}

/**
 * Reaction context — the per-agent quote prompts. Anchors the agent
 * voice to their role (alignment researcher, comms director, etc.)
 * so the quotes read as "the alignment researcher is anxious about
 * the capability gap" instead of generic settler reactions.
 */
export function atlasLabReactionContext(agent: Agent, _ctx: { time: number; turn: number }): string {
  const role = agent.role || 'researcher';
  const dept = agent.department || 'engineering';
  return `You are a ${role} on the ${dept} team at Atlas Lab. You speak from inside the lab — not as a public commentator. Your reactions are about evals, training runs, model behaviour, deployment readiness, board pressure, the competitor gap, or the next RSP review. Anchor your quote to ONE concrete observation about the current state.`;
}
