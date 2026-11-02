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
import type { ScenarioPackage, ActorConfig, ScenarioLabels } from '../../engine/types.js';
import type { CallUsage } from '../economics/cost-tracker.js';
import { buildPromotionPrompt } from '../util/runtime-helpers.js';
import { scenarioWords } from '../util/scenario-words.js';
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
  if (h.agreeableness > 0.7) cues.push('You seek consensus across departments and with those you answer to before committing; you treat disagreement as a signal to gather more input');
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
 * selectedOptionId JSON format the downstream turn loop expects, and
 * names the leader, the place, the people and the time unit in the
 * scenario's own words ("the lab release director", "researchers",
 * "months"; Mars Genesis: "the colony commander", "colonists", "years").
 */
export function buildCommanderBootstrap(personalityCue: string, labels?: Partial<ScenarioLabels>): string {
  const w = scenarioWords(labels);
  return (
    `You are the ${w.leaderTitle}. You receive department reports and make strategic decisions. ` +
    `The people you lead are ${w.population}, and each turn moves time forward in ${w.timeUnitPlural}. ` +
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

/** What one turn's commander decision prompt is built from. */
export interface CommanderTurnPromptArgs {
  turn: number;
  time: number;
  /** " (Event 2/3)" when the turn has several events, else "". */
  eventLabel: string;
  title: string;
  description: string;
  trajectoryCue?: string;
  /** The department reports, one block each. */
  summaries: string;
  /** The forged-toolbox block, or "". */
  toolboxBlock: string;
  /** The scenario's metrics on one line (see `formatStateLine`). */
  stateLine: string;
  /** The options block with its selectedOptionId instruction, or "". */
  optionText: string;
  /** The available policy effects block, or "". */
  effectsText: string;
  labels?: Partial<ScenarioLabels>;
}

/**
 * The commander's decision prompt for one event. The heading names the
 * time in the scenario's unit ("TURN 1, Month 1: ..."); it printed the
 * bare number before, and the lab's commanders filled in years.
 */
export function buildCommanderTurnPrompt(a: CommanderTurnPromptArgs): string {
  const w = scenarioWords(a.labels);
  return `TURN ${a.turn}${a.eventLabel}, ${w.TimeUnit} ${a.time}: ${a.title}

${a.description}
${a.trajectoryCue ? `\n${a.trajectoryCue}\n` : ''}
DEPARTMENT REPORTS:
${a.summaries}
${a.toolboxBlock}
State: ${a.stateLine}${a.optionText}${a.effectsText}

REASONING — populate the "reasoning" field of your JSON response BEFORE committing to selectedOptionId. Numbered list, one point per line:
  (1) What does my personality profile push me toward on this call? Name the specific trait poles at play.
  (2) Do the department reports converge or conflict? If they conflict, which voice do I trust given my profile?
  (3) Which forged-tool outputs in the toolbox above directly inform this decision? Cite the numeric output if available.
  (4) What risk am I accepting vs refusing? My rationale must name the specific trade.
  (5) Final choice + one-line justification.

Then set selectedOptionId, decision, and rationale. The rationale compresses the reasoning into a single paragraph for default UI display; the "reasoning" field stores the full working.`;
}

/**
 * The departments a run keeps, in the scenario's order: the requested
 * ids the scenario declares, or every scenario department when the list
 * is absent or names none of them (an empty list, or one written for
 * another scenario). The promotions and the turn loop both read it, so
 * the heads promoted are the departments that receive events.
 */
export function resolveActiveDepartments(
  requested: readonly string[] | undefined,
  departments: ReadonlyArray<{ id: string }>,
): string[] {
  const wanted = new Set(requested ?? []);
  const kept = departments.filter(d => wanted.has(d.id)).map(d => d.id);
  return kept.length ? kept : departments.map(d => d.id);
}

/**
 * Find the scenario department a model's department text means: the
 * exact id; else the id or the label with case and punctuation dropped
 * ("Alignment Research", "alignment-research"); else a short form, the
 * first word or the start of one department's id or label ("alignment",
 * "deployment"). A loose match counts only when it names exactly one
 * department. Returns undefined for anything else.
 */
export function resolveDepartmentId(
  text: unknown,
  departments: ReadonlyArray<{ id: string; label?: string }>,
): string | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const exact = departments.find(d => d.id === text);
  if (exact) return exact.id;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wanted = norm(text);
  if (!wanted) return undefined;
  const names = departments.map(d => ({ id: d.id, names: [norm(d.id), norm(d.label ?? '')].filter(Boolean) }));
  const only = (hits: typeof names) => (hits.length === 1 ? hits[0].id : undefined);
  const full = names.filter(d => d.names.includes(wanted));
  if (full.length) return only(full);
  return only(names.filter(d => d.names.some(n => n.startsWith(`${wanted} `))));
}

/**
 * The departments that analyse an event: the ones it names that the run
 * keeps, matched as the promotions match them, in the order named. When it
 * names none of them (a director's guess, a canned event written for Mars)
 * the first two the run keeps answer, since only those have heads.
 */
export function resolveEventDepartments(
  named: readonly unknown[] | undefined,
  departments: ReadonlyArray<{ id: string; label?: string }>,
  active: ReadonlySet<string>,
): string[] {
  const kept = departments.filter(d => active.has(d.id));
  const resolved = (named ?? []).map(text => resolveDepartmentId(text, kept)).filter((id): id is string => !!id);
  return resolved.length ? [...new Set(resolved)] : kept.slice(0, 2).map(d => d.id);
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
  findAgent: SimulationKernel['findAgent'];
}

export interface RunPromotionArgs {
  kernel: PromotionKernel;
  scenario: ScenarioPackage;
  leader: ActorConfig;
  startTime: number;
  /**
   * The departments the run keeps, in any order. Promotions fill these
   * alone; the hosted demo keeps three. Defaults to every department the
   * scenario declares.
   */
  activeDepartments?: readonly string[];
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
 * JSON, and tell the kernel to promote each accepted candidate.
 *
 * A promotion is accepted when its department resolves to one of the
 * run's departments (see {@link resolveDepartmentId}), that department
 * has no living head, and its agent is alive and heads no other department.
 * Anything else is refused with one log line. The fallback then promotes
 * the top kernel candidate for each department still without a head, so
 * every department enters turn 1 with exactly one living head.
 *
 * A fork restores its heads with the snapshot and comes through here too.
 * The commander is asked only about a department whose head has died, and
 * not at all when every department has one.
 */
export async function runDepartmentPromotions(args: RunPromotionArgs): Promise<void> {
  const { kernel, scenario, leader, startTime, sendToCommander, trackUsage, recordSchemaAttempt, emit } = args;

  console.log('  [Turn 0] Commander evaluating roster for promotions...');
  const active = new Set(resolveActiveDepartments(args.activeDepartments, scenario.departments));
  const departments = scenario.departments.filter(d => active.has(d.id));
  const promotionDepts: Department[] = departments.map(d => d.id as Department);
  const roleNames: Record<string, string> = Object.fromEntries(departments.map(d => [d.id, d.role]));
  const headOf = (dept: string) => kernel.getState().agents.find(c => c.promotion?.department === dept && c.health.alive);
  const open = departments.filter(d => !headOf(d.id));
  if (open.length === 0) {
    console.log('  [Turn 0] Every department has a living head; no promotions to make');
    return;
  }
  const candidateSummaries = open.map(d => {
    const candidates = kernel.getCandidates(d.id as Department, 5);
    return `## ${d.label || d.id} (department id "${d.id}"): Top 5 Candidates:\n${candidates.map(c => {
      const age = startTime - c.core.birthTime;
      const h = c.hexaco;
      return `- ${c.core.name} (${c.core.id}), age ${age}, spec: ${c.career.specialization}, O:${h.openness.toFixed(2)} C:${h.conscientiousness.toFixed(2)} E:${h.extraversion.toFixed(2)} A:${h.agreeableness.toFixed(2)} Em:${h.emotionality.toFixed(2)} HH:${h.honestyHumility.toFixed(2)}`;
    }).join('\n')}`;
  }).join('\n\n');

  const promoResult = await sendAndValidate({
    session: { send: sendToCommander as (p: string) => Promise<{ text: string; usage?: any }> },
    prompt: buildPromotionPrompt(
      candidateSummaries,
      open.map(d => ({ id: d.id, label: d.label || d.id, role: d.role })),
      scenario.labels,
    ),
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
    const dept = resolveDepartmentId(p.department, departments);
    if (!dept) {
      console.log(`  ✦ Promotion refused: department "${p.department}" for ${p.agentId} is none of this run's departments (${promotionDepts.join(', ')}); the fallback fills it`);
      continue;
    }
    const sitting = headOf(dept);
    if (sitting) {
      console.log(`  ✦ Promotion refused: ${dept} already has a head (${sitting.core.id}); ${p.agentId} not promoted`);
      continue;
    }
    const agent = kernel.findAgent(p.agentId);
    if (!agent) {
      console.log(`  ✦ Promotion failed: Error: Agent ${p.agentId} not found; the fallback fills ${dept}`);
      continue;
    }
    if (!agent.health.alive) {
      console.log(`  ✦ Promotion refused: ${agent.core.id} has died; the fallback fills ${dept}`);
      continue;
    }
    if (agent.promotion) {
      console.log(`  ✦ Promotion refused: ${agent.core.id} already heads ${agent.promotion.department}; not moved to ${dept}`);
      continue;
    }
    try {
      const agentId = kernel.promoteAgent(agent.core.id, dept as Department, p.role, leader.name);
      console.log(`  ✦ ${agentId} → ${p.role}: ${p.reason?.slice(0, 80)}`);
      emit('promotion', { agentId, department: dept, role: p.role, reason: p.reason?.slice(0, 120) });
    } catch (err) { console.log(`  ✦ Promotion failed: ${err}`); }
  }

  // Fallback: promote the top candidate for any department the commander
  // left unfilled, so turn 1 starts with a full cabinet regardless of
  // how well the LLM followed instructions.
  for (const dept of promotionDepts) {
    if (!headOf(dept)) {
      const top = kernel.getCandidates(dept, 1)[0];
      if (top) {
        const role = roleNames[dept] || `Head of ${dept}`;
        const agentId = kernel.promoteAgent(top.core.id, dept, role, leader.name);
        console.log(`  ✦ [fallback] ${top.core.name} → ${role}`);
        // The dashboard's feed lists a head from this event.
        emit('promotion', { agentId, department: dept, role, reason: 'Top candidate for the department.' });
      }
    }
  }
}
