/**
 * Commander bootstrap + turn-0 department-head promotions.
 *
 * Extracted from orchestrator.ts so runSimulation reads as a turn loop
 * rather than a 100-line setup block before the loop even starts.
 * The two responsibilities are:
 *
 *   1. Build a personality-cue line from the leader's HEXACO so the
 *      commander's first message reinforces trait-driven decision
 *      style (high-openness → "favor novel approaches", etc.).
 *   2. Fire the turn-0 promotion LLM call, parse the response, and
 *      ask the kernel to promote the named candidates. A top-candidate
 *      fallback runs for any department the commander skipped so
 *      every dept always has a head going into turn 1.
 *
 * All kernel mutations, SSE emits, and cost-tracker calls flow through
 * callbacks passed in by the orchestrator, so this module stays free
 * of the turn-loop's closure state.
 *
 * @module paracosm/runtime/commander-setup
 */

import type { Department, HexacoProfile } from '../../engine/core/state.js';
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { ScenarioPackage, ActorConfig } from '../../engine/types.js';
import type { CallUsage } from '../cost-tracker.js';
import { buildPromotionPrompt } from '../runtime-helpers.js';
import { sendAndValidate } from '../../llm/sendAndValidate.js';
import { PromotionsSchema } from '../validators/commander.js';

/**
 * Build a "Your decision style" block from the leader's HEXACO profile.
 *
 * Covers all six HEXACO axes at both poles with concrete behavioural
 * cues that translate cleanly into decision-making: what option to
 * pick, how to frame rationale, how much risk to accept, how to
 * communicate outcomes. Each cue names a SPECIFIC downstream effect
 * (e.g. "the unknown is opportunity, not threat") rather than a trait
 * label, so the LLM cannot just parrot the trait name back. The
 * Honesty-Humility, Extraversion, and Agreeableness poles that were
 * previously missing produce the sharpest additional divergence
 * between Visionary + Engineer archetypes beyond openness alone.
 *
 * Thresholds (0.7 / 0.3) match the kernel's personality-drift bounds
 * so cues only fire when the trait is meaningfully expressed.
 */
export function buildPersonalityCue(h: HexacoProfile): string {
  const cues: string[] = [];

  // Openness: novelty vs proven protocols
  if (h.openness > 0.7) cues.push('You favor novel, untested approaches over proven ones; the unknown is an opportunity, not a threat');
  if (h.openness < 0.3) cues.push('You trust proven protocols and incremental improvement; experiments need an extraordinary justification');

  // Conscientiousness: discipline vs improvisation
  if (h.conscientiousness > 0.7) cues.push('You demand evidence and contingency plans before committing; you would rather be slow and right than fast and wrong');
  if (h.conscientiousness < 0.3) cues.push('You move fast and accept ambiguity; waiting for full evidence is itself a risk');

  // Extraversion: visible command vs quiet technical leadership
  if (h.extraversion > 0.7) cues.push('You lead from the front: public announcements, rallying speeches, visible command presence; your rationale frames collective purpose');
  if (h.extraversion < 0.3) cues.push('You work through technical channels: brief memos, quiet protocols, minimal public drama; your rationale reads as an engineering log');

  // Agreeableness: consensus vs decisiveness
  if (h.agreeableness > 0.7) cues.push('You seek consensus across departments and with Earth-command before committing; you treat disagreement as a signal to gather more input');
  if (h.agreeableness < 0.3) cues.push('You override department consensus when you see a better path; you accept friction as the cost of clarity');

  // Emotionality: human-cost weighting
  if (h.emotionality > 0.7) cues.push('You weigh human cost heavily — even small mortality risks deter you, and morale is a first-class metric that constrains the option space');
  if (h.emotionality < 0.3) cues.push('You accept casualties for strategic gain; morale is downstream of results, not a primary constraint');

  // Honesty-Humility: transparency vs information asymmetry
  if (h.honestyHumility > 0.7) cues.push('You report failures transparently, accept blame, and refuse to spin bad outcomes; credibility is the only currency that compounds');
  if (h.honestyHumility < 0.3) cues.push('You leverage information asymmetries when useful; public framing is part of strategy, not a post-hoc wrap');

  return cues.length ? `Your decision style: ${cues.join('. ')}.` : '';
}

/**
 * Assemble the bootstrap message sent to the commander session right
 * after it's created. Reinforces the leader's personality cue + the
 * selectedOptionId JSON format the downstream turn loop expects.
 */
export function buildCommanderBootstrap(personalityCue: string): string {
  return (
    `You are the colony commander. You receive department reports and make strategic decisions. ` +
    `${personalityCue} ` +
    `Your personality MUST visibly shape your choices — do not converge on a centrist option just because ` +
    `it sounds reasonable. If your traits push you toward the risky option, take it; if they push you toward ` +
    `the safe option, take it. The simulation's value is in how different leaders produce different outcomes ` +
    `from the same starting state. ` +
    `When the crisis includes options with IDs, you MUST include selectedOptionId in your JSON response. ` +
    `Return JSON with selectedOptionId, decision, rationale, selectedPolicies, rejectedPolicies, ` +
    `expectedTradeoffs, watchMetricsNextTurn. Acknowledge.`
  );
}

/**
 * Candidate-summary dependencies needed to run the turn-0 promotion.
 * Kept minimal so the flow doesn't couple to the full kernel surface —
 * tests can stub getCandidates + promoteAgent with ~20 lines of fakes.
 */
export interface PromotionKernel {
  getCandidates: SimulationKernel['getCandidates'];
  promoteAgent: SimulationKernel['promoteAgent'];
  getState: SimulationKernel['getState'];
}

export interface RunPromotionArgs {
  kernel: PromotionKernel;
  scenario: ScenarioPackage;
  leader: ActorConfig;
  startTime: number;
  /** Commander session `.send(prompt)` — returns whatever AgentOS returns. */
  sendToCommander: (prompt: string) => Promise<{ text: string; usage?: CallUsage }>;
  /** Tagged cost-tracker entry point so the commander bucket gets charged. */
  trackUsage: (result: { usage?: CallUsage }, site?: 'commander') => void;
  /** Record the promotion call's retry count in the schema-retry rollup. */
  recordSchemaAttempt?: (schemaName: string, attempts: number, fellBack: boolean) => void;
  /** SSE emit used to publish each successful promotion. */
  emit: (type: 'promotion', data?: Record<string, unknown>) => void;
}

/**
 * Run the turn-0 promotion flow end to end: build the candidate summary
 * from the kernel, send it to the commander session, parse the returned
 * JSON, and tell the kernel to promote each accepted candidate. When
 * the commander skips a department (bad JSON, refused promotion, etc.)
 * the top kernel candidate for that department is promoted as a
 * fallback so no department enters turn 1 without a head.
 */
export async function runDepartmentPromotions(args: RunPromotionArgs): Promise<void> {
  const { kernel, scenario, leader, startTime, sendToCommander, trackUsage, recordSchemaAttempt, emit } = args;

  console.log('  [Turn 0] Commander evaluating roster for promotions...');
  const promotionDepts: Department[] = scenario.departments.map(d => d.id as Department);
  const roleNames: Record<string, string> = Object.fromEntries(scenario.departments.map(d => [d.id, d.role]));
  const candidateSummaries = promotionDepts.map(dept => {
    const candidates = kernel.getCandidates(dept, 5);
    return `## ${dept.toUpperCase()} — Top 5 Candidates:\n${candidates.map(c => {
      const age = startTime - c.core.birthTime;
      const h = c.hexaco;
      return `- ${c.core.name} (${c.core.id}), age ${age}, spec: ${c.career.specialization}, O:${h.openness.toFixed(2)} C:${h.conscientiousness.toFixed(2)} E:${h.extraversion.toFixed(2)} A:${h.agreeableness.toFixed(2)} Em:${h.emotionality.toFixed(2)} HH:${h.honestyHumility.toFixed(2)}`;
    }).join('\n')}`;
  }).join('\n\n');

  const promoResult = await sendAndValidate({
    session: { send: sendToCommander as (p: string) => Promise<{ text: string; usage?: any }> },
    prompt: buildPromotionPrompt(candidateSummaries),
    schema: PromotionsSchema,
    schemaName: 'Promotions',
    onUsage: (r) => trackUsage({ usage: r.usage as CallUsage }, 'commander'),
    fallback: { promotions: [] },
  });
  const { object: promoDecision, fromFallback } = promoResult;
  recordSchemaAttempt?.('Promotions', promoResult.attempts, fromFallback);
  if (fromFallback) {
    console.log('  [promotion] schema fallback; commander promotions skipped (fallback pass below will fill)');
  }
  for (const p of promoDecision.promotions) {
    try {
      kernel.promoteAgent(p.agentId, p.department as Department, p.role, leader.name);
      console.log(`  ✦ ${p.agentId} → ${p.role}: ${p.reason?.slice(0, 80)}`);
      emit('promotion', { agentId: p.agentId, department: p.department, role: p.role, reason: p.reason?.slice(0, 120) });
    } catch (err) { console.log(`  ✦ Promotion failed: ${err}`); }
  }

  // Fallback: promote the top candidate for any department the commander
  // left unfilled, so turn 1 starts with a full cabinet regardless of
  // how well the LLM followed instructions.
  for (const dept of promotionDepts) {
    const hasLeader = kernel.getState().agents.some(c => c.promotion?.department === dept);
    if (!hasLeader) {
      const top = kernel.getCandidates(dept, 1)[0];
      if (top) {
        kernel.promoteAgent(top.core.id, dept, roleNames[dept] || `Head of ${dept}`, leader.name);
        console.log(`  ✦ [fallback] ${top.core.name} → ${roleNames[dept]}`);
      }
    }
  }
}
