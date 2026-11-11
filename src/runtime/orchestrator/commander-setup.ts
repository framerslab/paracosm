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

import type { Department, HexacoProfile, WorldMetrics } from '../../engine/core/state.js';
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { ScenarioPackage, ActorConfig, ScenarioLabels } from '../../engine/types.js';
import type { CallUsage } from '../economics/cost-tracker.js';
import { buildPromotionPrompt } from '../util/runtime-helpers.js';
import { scenarioWords } from '../util/scenario-words.js';
import { ageInYears } from '../../engine/core/time-unit.js';
import { sendAndValidate } from '../../llm/sendAndValidate.js';
import { PromotionsSchema } from '../validators/commander.js';
import type { CrisisOption, DepartmentReport } from '../contracts.js';
import { selectableEffects } from '../util/parsers.js';
import { outcomeSuccessChance } from '../../engine/core/progression.js';
import { OUTCOME_MULTIPLIERS, costMultiple, type TurnOutcome } from '../../engine/registries/effects.js';

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
 * A cue fires at 0.7 and above or at 0.3 and below, so a trait written
 * at a pole is heard: the Mars presets were written at those poles (Aria
 * Chen's emotionality 0.30, Dietrich Voss's extraversion 0.30 and
 * emotionality 0.70), and strict comparisons left them silent.
 */
export function buildPersonalityCue(h: HexacoProfile): string {
  const cues: string[] = [];

  // Openness: novelty vs proven protocols
  if (h.openness >= 0.7) cues.push('You favor novel, untested approaches over proven ones; the unknown is an opportunity, not a threat');
  if (h.openness <= 0.3) cues.push('You trust proven protocols and incremental improvement; experiments need an extraordinary justification');

  // Conscientiousness: discipline vs improvisation
  if (h.conscientiousness >= 0.7) cues.push('You demand evidence and contingency plans before committing; you would rather be slow and right than fast and wrong');
  if (h.conscientiousness <= 0.3) cues.push('You move fast and accept ambiguity; waiting for full evidence is itself a risk');

  // Extraversion: visible command vs quiet technical leadership
  if (h.extraversion >= 0.7) cues.push('You lead from the front: public announcements, rallying speeches, visible command presence; your rationale frames collective purpose');
  if (h.extraversion <= 0.3) cues.push('You work through technical channels: brief memos, quiet protocols, minimal public drama; your rationale reads as an engineering log');

  // Agreeableness: consensus vs decisiveness
  if (h.agreeableness >= 0.7) cues.push('You seek consensus across departments and with those you answer to before committing; you treat disagreement as a signal to gather more input');
  if (h.agreeableness <= 0.3) cues.push('You override department consensus when you see a better path; you accept friction as the cost of clarity');

  // Emotionality: human-cost weighting
  if (h.emotionality >= 0.7) cues.push('You weigh human cost heavily — even small mortality risks deter you, and morale is a first-class metric that constrains the option space');
  if (h.emotionality <= 0.3) cues.push('You accept casualties for strategic gain; morale is downstream of results, not a primary constraint');

  // Honesty-Humility: transparency vs information asymmetry
  if (h.honestyHumility >= 0.7) cues.push('You report failures transparently, accept blame, and refuse to spin bad outcomes; credibility is the only currency that compounds');
  if (h.honestyHumility <= 0.3) cues.push('You leverage information asymmetries when useful; public framing is part of strategy, not a post-hoc wrap');

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

/**
 * The policy effects the department reports recommend, one line each
 * under the key a commander selects it by, and the instruction to put
 * the adopted keys in `selectedPolicies`; or "" when no report
 * recommends one.
 */
export function buildEffectsBlock(reports: DepartmentReport[]): string {
  const lines = selectableEffects(reports).map(({ key, effect: e }) => `  - ${key} (${e.type}): ${e.description}${e.systemDelta ? ' | Delta: ' + JSON.stringify(e.systemDelta) : ''}`);
  if (!lines.length) return '';
  return '\n\nAVAILABLE POLICY EFFECTS:\n' + lines.join('\n') +
    '\n\nPut the key of each effect you adopt in "selectedPolicies", exactly as listed above (for example "' +
    selectableEffects(reports)[0].key + '"). Each adopted effect changes the state by its delta; an effect you leave out changes nothing.';
}

/**
 * How far a leader's appetite moves the bar for the bold option: the bar
 * is the break-even chance plus this times (0.5 minus the appetite). The
 * simulation's own choice. At 0.8 the two Mars presets' bars stand 0.46
 * apart (36 and 82 in 100), and they part on "Landfall", the one event
 * every Mars pair shares at turn 1 (its bold option's chance is 80 in 100
 * at the landing state); at 0.6 the Engineer's bar is 76 and he would
 * take it too.
 */
export const RISK_BAR_SLOPE = 0.8;
/** The range a bar is held in: the range an option's chance can take (`outcomeSuccessChance`). */
const RISK_BAR_MIN = 0.1;
const RISK_BAR_MAX = 0.9;

/**
 * A leader's appetite for the bold option, from 0 (never takes it) to 1
 * (always does): the mean of openness, one minus conscientiousness and one
 * minus emotionality, the three axes the opening cues tie to risk. Equal
 * weights are the simulation's own choice. Aria Chen's preset reads 0.767,
 * Dietrich Voss's 0.193.
 */
export function riskAppetite(h: HexacoProfile): number {
  return (h.openness + (1 - h.conscientiousness) + (1 - h.emotionality)) / 3;
}

/**
 * What a cost (a harmful entry of a category table) is multiplied by on
 * each outcome at no modifier, as the effect registry applies it
 * ({@link costMultiple}): 0, 4, 1 and 3 for a risky success, a risky
 * failure, a conservative success and a conservative failure.
 */
export const COST_MULTIPLES: Readonly<Record<TurnOutcome, number>> = {
  risky_success: costMultiple(OUTCOME_MULTIPLIERS.risky_success),
  risky_failure: costMultiple(OUTCOME_MULTIPLIERS.risky_failure),
  conservative_success: costMultiple(OUTCOME_MULTIPLIERS.conservative_success),
  conservative_failure: costMultiple(OUTCOME_MULTIPLIERS.conservative_failure),
};

/**
 * The bold option's chance at which it and a safe option come out even on
 * average, for one set of outcome multiples. A safe option's chance is
 * `(1 + p) / 2` where the bold option's is `p` (see `outcomeSuccessChance`),
 * so with a bold success `rs`, a bold failure `rf`, a safe success `cs` and
 * a safe failure `cf`, `p * rs + (1 - p) * rf = (1 + p) / 2 * cs + (1 - p) / 2 * cf`
 * at `p = ((cs + cf) / 2 - rf) / (rs - rf - (cs - cf) / 2)`. On what an
 * event gains (the multipliers 2.5, -2, 1 and -1) that is 4/7, the default
 * and the centre of the bar; on what it costs ({@link COST_MULTIPLES}: 0, 4,
 * 1 and 3) it is 2/3. Nothing is chosen here; the multiples fix it.
 */
export function breakEvenChance(m: Readonly<Record<TurnOutcome, number>> = OUTCOME_MULTIPLIERS): number {
  const rs = m.risky_success;
  const rf = m.risky_failure;
  const cs = m.conservative_success;
  const cf = m.conservative_failure;
  return ((cs + cf) / 2 - rf) / (rs - rf - (cs - cf) / 2);
}

/**
 * The chance at or above which a leader of this appetite takes the bold
 * option: the break-even chance on what an event gains for a leader with
 * no lean (appetite 0.5),
 * lower for a bolder leader and higher for a more careful one, by
 * {@link RISK_BAR_SLOPE}, held within 0.1 and 0.9.
 */
export function riskBar(appetite: number): number {
  return Math.max(RISK_BAR_MIN, Math.min(RISK_BAR_MAX, breakEvenChance() + RISK_BAR_SLOPE * (0.5 - appetite)));
}

/** What a decision's rule block is built from. */
export interface DecisionRuleArgs {
  /** The leader's profile as it stands this turn. */
  hexaco: HexacoProfile;
  /** The event's options; the ones marked risky are the bold ones. */
  options: ReadonlyArray<Pick<CrisisOption, 'id' | 'isRisky'>>;
  /** The chance the event declares for its bold option. */
  riskSuccessProbability: number;
  /** The run's metrics now, which move that chance (see `outcomeSuccessChance`). */
  metrics: WorldMetrics;
  /**
   * State the leader's bar. A leader on a trait model other than HEXACO
   * has no appetite here, so it is shown the odds and the multipliers
   * alone. Default true.
   */
  withBar?: boolean;
}

/** The start of the line of a rule block that states the leader's bar. */
const BAR_LINE = '- Your bar:';

/**
 * The reply field a commander writes the fact it departs from its bar for
 * in (see `CommanderDecisionSchema`).
 */
export const BAR_DEPARTURE_FIELD = 'barDeparture';

/** "option_a", "option_a and option_c", "option_a, option_b and option_c". */
function listIds(ids: readonly string[]): string {
  return ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

/**
 * The numbers a decision's rule block states, in whole numbers out of 100,
 * so the commander step can check the reply against what its prompt said.
 */
export interface DecisionRuleNumbers {
  /** The ids of the options marked risky. */
  boldIds: string[];
  /** The ids of the other options. */
  safeIds: string[];
  /** The bold option's chance of success. */
  boldChance: number;
  /** Each safe option's chance of success. */
  safeChance: number;
  /** The leader's bar for the bold option; absent for a leader with no bar. */
  bar?: number;
}

/**
 * The chances and the bar a decision's rule block states, or undefined for
 * an event with no option marked risky, or none safe. The chances are the
 * outcome step's `outcomeSuccessChance` for the run's metrics now; the bar
 * is {@link riskBar} for the profile as it stands this turn.
 */
export function decisionRuleNumbers(a: DecisionRuleArgs): DecisionRuleNumbers | undefined {
  const boldIds = a.options.filter(o => o.isRisky).map(o => o.id);
  const safeIds = a.options.filter(o => !o.isRisky).map(o => o.id);
  if (!boldIds.length || !safeIds.length || !Number.isFinite(a.riskSuccessProbability)) return undefined;
  const outOf100 = (x: number) => Math.round(100 * x);
  return {
    boldIds,
    safeIds,
    boldChance: outOf100(outcomeSuccessChance(true, a.riskSuccessProbability, a.metrics)),
    safeChance: outOf100(outcomeSuccessChance(false, a.riskSuccessProbability, a.metrics)),
    ...(a.withBar !== false ? { bar: outOf100(riskBar(riskAppetite(a.hexaco))) } : {}),
  };
}

/**
 * The decision rule a commander reads for one event: the bold option's
 * chance and the safe options' chance, as the outcome step's
 * `outcomeSuccessChance` gives them for the run's metrics now; what a
 * success and a failure multiply the event's gains by
 * ({@link OUTCOME_MULTIPLIERS}) and its costs by ({@link COST_MULTIPLES}),
 * as the effect registry applies them; the leader's bar for the bold
 * option from the profile as it stands this turn ({@link riskBar}); that
 * the department reports were written without the options; that the
 * chances and multiples already include the dangers the event describes;
 * what following the bar means; and that a departure from it names, in its
 * own reply field ({@link BAR_DEPARTURE_FIELD}), a fact the odds do not
 * count. Whole numbers out of 100, rounded.
 *
 * The departure line read "for a reason that belongs to this event" until
 * #250: on the first live pair with the rule, Aria Chen stated that the
 * bold option's chance cleared her bar on all 6 events and chose a safe
 * option on 5, each time for a danger the event described, which a bold
 * failure is and which its chance and multiples already count.
 *
 * The block states odds and a bar and picks nothing: the commander chooses.
 * The outcome draw meets the chance after the adopted effects apply, so
 * the stated chance is "about": it differs only when an adopted effect
 * carries morale across 0.7, food across 12 months or the population across
 * 150. Returns "" for an event with no option marked risky, or none safe.
 */
export function buildDecisionRule(a: DecisionRuleArgs): string {
  const n = decisionRuleNumbers(a);
  if (!n) return '';
  const outOf100 = (x: number) => Math.round(100 * x);
  const m = OUTCOME_MULTIPLIERS;
  const c = COST_MULTIPLES;
  const h = a.hexaco;
  const theBold = n.boldIds.length === 1 ? 'the bold option' : 'a bold option';
  const lines = [
    'YOUR DECISION RULE',
    n.boldIds.length === 1
      ? `- ${n.boldIds[0]} is the bold option. It succeeds about ${n.boldChance} times in 100.`
      : `- ${listIds(n.boldIds)} are the bold options. Each succeeds about ${n.boldChance} times in 100.`,
    n.safeIds.length === 1
      ? `- ${n.safeIds[0]} is the safe option. It succeeds about ${n.safeChance} times in 100.`
      : `- ${listIds(n.safeIds)} are the safe options. Each succeeds about ${n.safeChance} times in 100.`,
    `- What this kind of event gains is multiplied by ${m.risky_success} on a bold success and ${m.risky_failure} on a bold failure, against ${m.conservative_success} and ${m.conservative_failure} on a safe success and a safe failure.`,
    `- What it costs is multiplied by ${c.risky_success} on a bold success and ${c.risky_failure} on a bold failure, against ${c.conservative_success} and ${c.conservative_failure} on a safe success and a safe failure.`,
    ...(n.bar !== undefined
      ? [`${BAR_LINE} you take the bold option when it succeeds at least ${n.bar} times in 100. It comes from your profile as it stands this turn (openness ${h.openness.toFixed(2)}, conscientiousness ${h.conscientiousness.toFixed(2)}, emotionality ${h.emotionality.toFixed(2)}). A leader with no lean either way takes it at ${outOf100(breakEvenChance())} in 100, where the two paths gain the same on average. On what the event costs they are even at ${outOf100(breakEvenChance(COST_MULTIPLES))} in 100.`]
      : []),
    '- The departments wrote their reports without this option list or these odds. Their reports describe the problem; the choice between the options is yours.',
    ...(n.bar !== undefined
      ? [
          `- The chances and multiples above already include the dangers this event describes. If ${theBold} goes wrong, that is a bold failure: the chance above already allows for it, what the event gains is multiplied by ${m.risky_failure} against ${m.conservative_failure} for a safe failure, and what it costs by ${c.risky_failure} against ${c.conservative_failure}. A danger the event describes is not a reason to depart from your bar, and neither is a downside tail or the cost of failing.`,
          `- Choose by your bar: when the bold option's chance is at least your bar, following it means choosing ${theBold}; when it is under, a safe option. Depart from it only for a fact these odds do not count: a supply in the State line too low to take a bold failure, named with its number and what it falls short of, or something an option needs that the colony lacks. Write that fact in "${BAR_DEPARTURE_FIELD}"; leave "${BAR_DEPARTURE_FIELD}" empty when you follow your bar.`,
        ]
      : []),
  ];
  return lines.join('\n');
}

/** How one decision stands against the bar its prompt stated. */
export interface BarCheck {
  /** The bold option's chance the prompt stated, out of 100. */
  boldChance: number;
  /** The bar the prompt stated, out of 100. */
  bar: number;
  /** The bold option's chance is at least the bar. */
  clearsBar: boolean;
  /** The option chosen is a bold one. */
  choseBold: boolean;
  /** The choice is not the one the bar gives. */
  departs: boolean;
  /** What the reply wrote in its departure field, trimmed; "" for none. */
  departureFact: string;
  /** A departure whose reply names no fact for it. */
  unexplained: boolean;
}

/**
 * A departure field that says there is none: a placeholder word alone or
 * before punctuation ("None, I follow my bar", "N/A - following the bar").
 * A placeholder before a word ("None of the 39 colonists ...") opens a fact.
 */
const NO_FACT = /^(?:none|nothing|n\/?a|null|nil|not applicable|-+)(?:\s*[.,;:!()–—-][\s\S]*)?$/i;

/**
 * A departure field that opens by saying the bar is followed or nothing
 * departs ("I follow my bar", "No departure.").
 */
const SAYS_FOLLOWED = /^(?:i\s+)?(?:follow(?:s|ing)?\s+(?:my|the)\s+bar|no\s+departure|not\s+departing)\b/i;

/** "in 100", "out of 100" and "/100": the scale the prompt states its numbers on. */
const OUT_OF_100 = /\b(?:in|out\s+of)\s+100\b|\/\s*100\b/gi;

/** The numbers a text writes, outside words such as option_2 and the scale "in 100". */
function numbersIn(text: string): number[] {
  return (text.replace(OUT_OF_100, ' ').match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * The fact a departure field names, or "" when it names none. A field that
 * opens with a placeholder or by saying the bar is followed names a fact
 * only when it writes a number its prompt did not state ("None: 0 spare
 * cartridges"); the bar and the chances restated ("I follow my bar (41)")
 * are no fact. A field that opens any other way is kept as written.
 */
function departureFactOf(written: string, stated: readonly number[]): string {
  if (!NO_FACT.test(written) && !SAYS_FOLLOWED.test(written)) return written;
  return numbersIn(written).some(n => !stated.includes(n)) ? written : '';
}

/**
 * Check a reply against the bar its prompt stated: whether the option it
 * chose is the one the bar gives (the bold option when its chance is at
 * least the bar, a safe one when under), and, when it is not, whether the
 * reply named the fact it departs for. Undefined when the prompt stated no
 * bar or the reply chose no option the event offers.
 *
 * The check flags and counts; it changes nothing. A departure with no fact
 * stands as the commander's choice: a retry could only check that the
 * field is filled, not that the fact lies outside the odds, and would teach
 * the model to fill it.
 */
export function checkBarDeparture(
  numbers: DecisionRuleNumbers | undefined,
  chosenOptionId: string | null | undefined,
  barDeparture: unknown,
): BarCheck | undefined {
  if (!numbers || numbers.bar === undefined || !chosenOptionId) return undefined;
  const choseBold = numbers.boldIds.includes(chosenOptionId);
  if (!choseBold && !numbers.safeIds.includes(chosenOptionId)) return undefined;
  const clearsBar = numbers.boldChance >= numbers.bar;
  const departs = clearsBar !== choseBold;
  const written = typeof barDeparture === 'string' ? barDeparture.trim() : '';
  const departureFact = departureFactOf(written, [numbers.bar, numbers.boldChance, numbers.safeChance]);
  return {
    boldChance: numbers.boldChance,
    bar: numbers.bar,
    clearsBar,
    choseBold,
    departs,
    departureFact,
    unexplained: departs && !departureFact,
  };
}

/** A run's decisions against their bars. */
export interface BarCheckSummary {
  /** Decisions checked: a bar was stated and an offered option chosen. */
  decisions: number;
  /** Of those, the choices the bar gives. */
  followed: number;
  /** Of those, the choices against the bar. */
  departed: number;
  /** Of the departures, the ones whose reply named no fact. */
  departedWithoutFact: number;
}

/** Count a run's bar checks; a decision with no check is not counted. */
export function summarizeBarChecks(checks: ReadonlyArray<BarCheck | undefined>): BarCheckSummary {
  const seen = checks.filter((c): c is BarCheck => !!c);
  return {
    decisions: seen.length,
    followed: seen.filter(c => !c.departs).length,
    departed: seen.filter(c => c.departs).length,
    departedWithoutFact: seen.filter(c => c.unexplained).length,
  };
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
  /** The leader's decision rule for this event (see {@link buildDecisionRule}), or "". */
  decisionRule?: string;
  labels?: Partial<ScenarioLabels>;
}

/**
 * The commander's decision prompt for one event. The heading names the
 * time in the scenario's unit ("TURN 1, Month 1: ..."); it printed the
 * bare number before, and the lab's commanders filled in years.
 *
 * With a decision rule the rule follows the options, and two reasoning
 * points read from it: (2) asks what the reports establish, since they
 * were written without the options, and (4) asks whether the bold option's
 * chance is at least the leader's bar, with both numbers, and says which
 * choice that gives unless a departure fact is written in its field.
 * Without one the points ask whether the reports converge and what risk is
 * accepted.
 */
export function buildCommanderTurnPrompt(a: CommanderTurnPromptArgs): string {
  const w = scenarioWords(a.labels);
  const rule = a.decisionRule?.trim() ? a.decisionRule : '';
  const withBar = rule.includes(BAR_LINE);
  const point2 = rule
    ? 'What do the department reports establish about the problem? They were written without the option list or the odds, so they inform my choice and do not make it.'
    : 'Do the department reports converge or conflict? If they conflict, which voice do I trust given my profile?';
  const point4 = withBar
    ? `Is the bold option's chance at least my bar? Give both numbers and answer yes or no. Yes means the bold option and no means a safe option, unless I depart for a fact these odds do not count and write it in "${BAR_DEPARTURE_FIELD}". Name the trade I accept and the one I refuse.`
    : 'What risk am I accepting vs refusing? My rationale must name the specific trade.';
  const fields = withBar ? `selectedOptionId, ${BAR_DEPARTURE_FIELD}, decision, and rationale` : 'selectedOptionId, decision, and rationale';
  return `TURN ${a.turn}${a.eventLabel}, ${w.TimeUnit} ${a.time}: ${a.title}

${a.description}
${a.trajectoryCue ? `\n${a.trajectoryCue}\n` : ''}
DEPARTMENT REPORTS:
${a.summaries}
${a.toolboxBlock}
State: ${a.stateLine}${a.optionText}${rule ? `\n\n${rule}` : ''}${a.effectsText}

REASONING — populate the "reasoning" field of your JSON response BEFORE committing to selectedOptionId. Numbered list, one point per line:
  (1) What does my personality profile push me toward on this call? Name the specific trait poles at play.
  (2) ${point2}
  (3) Which forged-tool outputs in the toolbox above directly inform this decision? Cite the numeric output if available.
  (4) ${point4}
  (5) Final choice + one-line justification.

Then set ${fields}. The rationale compresses the reasoning into a single paragraph for default UI display; the "reasoning" field stores the full working.`;
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
  // Ages in years; the run counts time in its own unit.
  const yearsPerUnit = kernel.getState().metadata.yearsPerUnit ?? 1;
  const candidateSummaries = open.map(d => {
    const candidates = kernel.getCandidates(d.id as Department, 5);
    return `## ${d.label || d.id} (department id "${d.id}"): Top 5 Candidates:\n${candidates.map(c => {
      const age = Math.floor(ageInYears(c, startTime, yearsPerUnit));
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
