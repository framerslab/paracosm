/**
 * Two Mars leaders with opposite profiles read different decision prompts,
 * and a commander that follows the rule its prompt states decides
 * differently for them (#248).
 *
 * Three live Mars Genesis pairs (8 November 2026 at 06:06 UTC, 10 November
 * at 02:32 and at 14:06; seed 950, six turns of eight years, 30 people,
 * three departments) made 41 decisions, and Aria Chen ("The Visionary")
 * and Dietrich Voss ("The Engineer") chose a safe option in 40 of them.
 * For one event, the same reports and the same state, the decision prompt
 * was the same text for both leaders: the profile reached it only through
 * the drift line, and the bold option came with no odds and no stakes.
 * The 41 recorded events are in tests/fixtures/mars-live-decisions-2026-11.json.
 *
 * CI holds no provider key, so the model's own reply is checked on a live
 * pair. Here a reader that sees only the prompt text and follows the rule
 * the prompt states stands in for the model, and its reply goes through the
 * real decision schema, option reading, seeded outcome draw, effects and
 * drift, in the orchestrator's order, on a real Mars kernel.
 *
 * The first live pair with the rule (11 November 2026 at 07:39 UTC, version
 * 0.9.1101, the same body and seed) read it and quoted it, and Aria Chen
 * still took the bold option once in 6 (#250): on 5 events she stated that
 * its chance cleared her bar and chose a safe option, each time for a danger
 * the event described, which the chance and the multiples already count.
 * Her 6 replies and Dietrich Voss's 7 are in the fixture under
 * `ruleReplies`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as setup from '../../src/runtime/orchestrator/commander-setup.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { SeededRng } from '../../src/engine/core/rng.js';
import {
  classifyOutcomeById,
  driftCommanderHexaco,
  outcomeSuccessChance,
  resolveChosenOption,
} from '../../src/engine/core/progression.js';
import { EffectRegistry } from '../../src/engine/registries/effects.js';
import { applyOutcomeEffects } from '../../src/runtime/orchestrator/outcome-effects.js';
import { CommanderDecisionSchema } from '../../src/runtime/validators/commander.js';
import type { HexacoProfile, TurnOutcome, WorldMetrics } from '../../src/engine/core/state.js';
import type { CrisisOption } from '../../src/runtime/contracts.js';
import { normalizeSimulationConfig } from '../../src/cli/sim-config.js';
import { hexacoModel } from '../../src/engine/traits/hexaco.js';

interface RecordedDecision {
  turn: number;
  time: number;
  eventIndex: number;
  title: string;
  description: string;
  category: string;
  options: CrisisOption[];
  riskyOptionId: string;
  riskSuccessProbability: number;
  chosenOptionId: string;
  outcome: TurnOutcome;
  metricsAtTurnStart: { population: number; morale: number; foodMonthsReserve: number };
}
interface RecordedRun {
  pairStartedAt: string;
  leader: string;
  archetype: string;
  hexacoHistory: Array<{ turn: number; hexaco: HexacoProfile }>;
  decisions: RecordedDecision[];
}

/** A decision of the 11 November pair, with the reply the commander wrote. */
interface RecordedReply extends RecordedDecision {
  reply: { selectedOptionId?: string; decision: string; rationale: string; reasoning: string };
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/mars-live-decisions-2026-11.json', import.meta.url), 'utf-8'),
) as {
  seed: number;
  runs: RecordedRun[];
  ruleReplies: { pairStartedAt: string; version: string; runs: Array<Omit<RecordedRun, 'pairStartedAt' | 'decisions'> & { decisions: RecordedReply[] }> };
};
const recorded = fixture.runs.flatMap(r => r.decisions);

const leaders = marsScenario.presets[0].leaders!;
const preset = (name: string) => leaders.find(l => l.name === name)!.hexaco as unknown as HexacoProfile;
const ARIA = 'Aria Chen';
const VOSS = 'Dietrich Voss';

/** The decision rule the commander step builds, or "" where the code has none. */
const ruleFor = (args: { hexaco: HexacoProfile; options: CrisisOption[]; riskSuccessProbability: number; metrics: WorldMetrics; withBar?: boolean }): string => {
  const build = (setup as any).buildDecisionRule;
  return typeof build === 'function' ? build(args) : '';
};

/** The numbers a decision's rule states (the chances and the bar), or undefined where the code reads none. */
const numbersFor = (args: { hexaco: HexacoProfile; options: CrisisOption[]; riskSuccessProbability: number; metrics: WorldMetrics }): unknown => {
  const read = (setup as any).decisionRuleNumbers;
  return typeof read === 'function' ? read(args) : undefined;
};

/** How a decision stands against the bar its prompt stated, or undefined where the code checks none. */
interface BarCheckSeen {
  boldChance: number;
  bar: number;
  clearsBar: boolean;
  choseBold: boolean;
  departs: boolean;
  departureFact: string;
  unexplained: boolean;
}
const checkFor = (numbers: unknown, chosenOptionId: string | null | undefined, barDeparture: unknown): BarCheckSeen | undefined => {
  const check = (setup as any).checkBarDeparture;
  return typeof check === 'function' ? check(numbers, chosenOptionId, barDeparture) : undefined;
};

/** The options block, as the commander step writes it. */
const optionText = (options: CrisisOption[]) => options.length
  ? '\n\nOPTIONS:\n' + options.map(o => `- ${o.id}: ${o.label} — ${o.description}${o.isRisky ? ' [RISKY]' : ''}`).join('\n') + '\n\nYou MUST include "selectedOptionId" in your JSON response.'
  : '';

/** The same reports for both leaders. */
const SUMMARIES = '## MEDICAL (conf: 0.8)\nThe crew is stable.\nRisks: [medium] exposure\nRecs: monitor\n\n## ENGINEERING (conf: 0.8)\nSystems hold.\nRisks: none\nRecs: inspect';

/** One leader's decision prompt for one event, as the commander step builds it. */
function promptFor(hexaco: HexacoProfile, e: Pick<RecordedDecision, 'turn' | 'time' | 'title' | 'description' | 'options' | 'riskSuccessProbability'>, metrics: WorldMetrics): string {
  return setup.buildCommanderTurnPrompt({
    turn: e.turn,
    time: e.time,
    eventLabel: '',
    title: e.title,
    description: e.description,
    summaries: SUMMARIES,
    toolboxBlock: '',
    stateLine: 'Population 30 | Morale 85%',
    optionText: optionText(e.options),
    effectsText: '',
    labels: marsScenario.labels,
    decisionRule: ruleFor({ hexaco, options: e.options, riskSuccessProbability: e.riskSuccessProbability, metrics }),
  } as any);
}

const asMetrics = (m: RecordedDecision['metricsAtTurnStart']) => m as unknown as WorldMetrics;

/** The three numbers a decision prompt states, or undefined for each it does not state. */
function statedNumbers(prompt: string) {
  const bold = /(\S+) is the bold option\. It succeeds about (\d+) times in 100\./.exec(prompt);
  const safe = /(?:is the safe option\. It|are the safe options\. Each) succeeds about (\d+) times in 100\./.exec(prompt);
  const bar = /you take the bold option when it succeeds at least (\d+) times in 100\./.exec(prompt);
  return {
    boldId: bold?.[1],
    bold: bold ? Number(bold[2]) : undefined,
    safe: safe ? Number(safe[1]) : undefined,
    bar: bar ? Number(bar[1]) : undefined,
  };
}

/**
 * The bar for the bold option written out here from its definition: the
 * mean of openness, one minus conscientiousness and one minus emotionality
 * is the appetite; the bar is the chance where the bold and a safe option
 * gain the same on average under the multipliers 2.5, -2, 1 and -1 (4/7),
 * moved by 0.8 times (0.5 minus the appetite), held within 0.1 and 0.9.
 */
function barOf(h: HexacoProfile): number {
  const appetite = (h.openness + (1 - h.conscientiousness) + (1 - h.emotionality)) / 3;
  const [rs, rf, cs, cf] = [2.5, -2, 1, -1];
  const breakEven = ((cs + cf) / 2 - rf) / (rs - rf - (cs - cf) / 2);
  return Math.max(0.1, Math.min(0.9, breakEven + 0.8 * (0.5 - appetite)));
}

/**
 * What a decision prompt says a gain and a cost are multiplied by on a bold
 * success, a bold failure, a safe success and a safe failure, and the
 * chances at which the bold and a safe option come out even on each.
 */
function statedStakes(prompt: string) {
  const four = (re: RegExp) => re.exec(prompt)?.slice(1, 5).map(Number);
  const even = /where the two paths gain the same on average\. On what the event costs they are even at (\d+) in 100\./.exec(prompt);
  const gainEven = /takes it at (\d+) in 100, where the two paths gain the same on average/.exec(prompt);
  return {
    gain: four(/What this kind of event gains is multiplied by (\S+) on a bold success and (\S+) on a bold failure, against (\S+) and (\S+) on a safe success and a safe failure\./),
    cost: four(/What it costs is multiplied by (\S+) on a bold success and (\S+) on a bold failure, against (\S+) and (\S+) on a safe success and a safe failure\./),
    gainEven: gainEven ? Number(gainEven[1]) : undefined,
    costEven: even ? Number(even[1]) : undefined,
  };
}

/**
 * What the outcome step multiplies a gain and a cost by, read from Atlas
 * Lab's own tables through the effect registry a run applies, at no
 * modifier: board confidence is a gain in a press event (+4) and a cost in
 * a safety breach (-8). In that order: bold success, bold failure, safe
 * success, safe failure.
 */
function appliedStakes() {
  const atlas = JSON.parse(readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8'));
  // The compiler's shape: the category tables under one effect (src/engine/compiler/index.ts).
  const registry = EffectRegistry.forScenario({ effects: [{ categoryDefaults: atlas.effects }], metrics: atlas.metrics } as any);
  const order: TurnOutcome[] = ['risky_success', 'risky_failure', 'conservative_success', 'conservative_failure'];
  const scale = (category: string, key: string) => order.map(outcome => {
    const base = atlas.effects[category][key] as number;
    const moved = registry.applyOutcome(category, outcome, { personalityBonus: 0, noise: 0 })[key];
    // A cost is a fall in board confidence: its multiple is the fall over the table's fall.
    return Math.round((moved / base) * 100) / 100 + 0;
  });
  assert.ok(atlas.effects.press.boardConfidence > 0 && atlas.effects.safety_breach.boardConfidence < 0);
  return { gain: scale('press', 'boardConfidence'), cost: scale('safety_breach', 'boardConfidence') };
}

/** The bold option's chance at which it and a safe option come out even, for one outcome's multiples: a safe option's chance is (1 + p) / 2. */
function evenChance([rs, rf, cs, cf]: number[]): number {
  return ((cs + cf) / 2 - rf) / (rs - rf - (cs - cf) / 2);
}

test('the 41 recorded decisions are in the fixture, 40 of them safe', () => {
  assert.equal(recorded.length, 41);
  assert.equal(recorded.filter(d => d.options.find(o => o.id === d.chosenOptionId)?.isRisky).length, 1);
});

test('for one event, the same reports and the same state, the two Mars leaders read different decision prompts', () => {
  const alike = recorded.filter(d => {
    const metrics = asMetrics(d.metricsAtTurnStart);
    return promptFor(preset(ARIA), d, metrics) === promptFor(preset(VOSS), d, metrics);
  });
  assert.equal(alike.length, 0, `the two leaders read the same prompt on ${alike.length} of ${recorded.length} events, for example "${alike[0]?.title}"`);
});

test('the prompt states the bold option\'s chance, the safe options\' chance and the leader\'s bar, and the chances are the outcome step\'s', () => {
  for (const name of [ARIA, VOSS]) {
    for (const d of recorded) {
      const metrics = asMetrics(d.metricsAtTurnStart);
      const n = statedNumbers(promptFor(preset(name), d, metrics));
      assert.equal(n.boldId, d.riskyOptionId, `${name}, "${d.title}": the bold option named`);
      assert.equal(n.bold, Math.round(100 * outcomeSuccessChance(true, d.riskSuccessProbability, metrics)), `${name}, "${d.title}": the bold option's chance`);
      assert.equal(n.safe, Math.round(100 * outcomeSuccessChance(false, d.riskSuccessProbability, metrics)), `${name}, "${d.title}": the safe options' chance`);
      assert.equal(n.bar, Math.round(100 * barOf(preset(name))), `${name}, "${d.title}": the bar`);
    }
  }
  const landfall = recorded[0];
  assert.equal(statedNumbers(promptFor(preset(ARIA), landfall, asMetrics(landfall.metricsAtTurnStart))).bar, 36);
  assert.equal(statedNumbers(promptFor(preset(VOSS), landfall, asMetrics(landfall.metricsAtTurnStart))).bar, 82);
  const prompt = promptFor(preset(ARIA), landfall, asMetrics(landfall.metricsAtTurnStart));
  const stakes = statedStakes(prompt);
  assert.deepEqual(stakes.gain, [2.5, -2, 1, -1], 'what a gain is multiplied by on a bold success and failure, a safe success and failure');
  assert.match(prompt, /The departments wrote their reports without this option list or these odds/);
  assert.match(prompt, /\(2\) What do the department reports establish about the problem\?/);
  assert.doesNotMatch(prompt, /Do the department reports converge or conflict/);
});

test('the prompt states what a gain and what a cost are multiplied by as the outcome step applies them, and where each comes out even', () => {
  // The outcome step multiplies a gain by 2.5, -2, 1 and -1, and a cost by
  // 0, 4, 1 and 3 (a cost stays a cost: a bold success removes it, a bold
  // failure takes it four times). On a cost the two paths come out even at
  // 2 in 3, not 4 in 7: at a 60 in 100 bold chance a safety breach costs
  // 1.6 times its table on the bold path and 1.4 on the safe one, and a
  // prompt that gave the gain multiples alone called the bold path the
  // better one there.
  const applied = appliedStakes();
  const landfall = recorded[0];
  for (const name of [ARIA, VOSS]) {
    const stakes = statedStakes(promptFor(preset(name), landfall, asMetrics(landfall.metricsAtTurnStart)));
    assert.deepEqual(stakes.gain, applied.gain, `${name}: what a gain is multiplied by`);
    assert.deepEqual(stakes.cost, applied.cost, `${name}: what a cost is multiplied by`);
    assert.equal(stakes.gainEven, Math.round(100 * evenChance(applied.gain)), `${name}: where the gains come out even`);
    assert.equal(stakes.costEven, Math.round(100 * evenChance(applied.cost)), `${name}: where the costs come out even`);
  }
  assert.deepEqual(applied.cost, [0, 4, 1, 3]);
  assert.equal(Math.round(100 * evenChance(applied.cost)), 67);
});

test('by the stated numbers the Visionary\'s bar is under the bold option\'s chance on all 41 recorded events, and the Engineer\'s is over it on all 41', () => {
  let ariaUnder = 0;
  let vossOver = 0;
  for (const d of recorded) {
    const metrics = asMetrics(d.metricsAtTurnStart);
    const a = statedNumbers(promptFor(preset(ARIA), d, metrics));
    const v = statedNumbers(promptFor(preset(VOSS), d, metrics));
    if (a.bold !== undefined && a.bar !== undefined && a.bold >= a.bar) ariaUnder++;
    if (v.bold !== undefined && v.bar !== undefined && v.bold < v.bar) vossOver++;
  }
  assert.equal(ariaUnder, 41, `Aria Chen's bar is under the bold option's chance on ${ariaUnder} of 41`);
  assert.equal(vossOver, 41, `Dietrich Voss's bar is over the bold option's chance on ${vossOver} of 41`);
});

/**
 * A reader that sees only the prompt text: the bold option when the chance
 * the prompt states is at least the bar it states, else the first option
 * not marked risky. It answers as a commander does, in JSON.
 */
function followTheStatedRule(prompt: string): string {
  const n = statedNumbers(prompt);
  const optionLines = [...prompt.matchAll(/^- ([\w-]+): .*$/gm)];
  const firstSafe = optionLines.find(m => !m[0].endsWith('[RISKY]'))?.[1];
  const choice = n.boldId && n.bold !== undefined && n.bar !== undefined && n.bold >= n.bar ? n.boldId : firstSafe;
  return JSON.stringify({
    selectedOptionId: choice,
    barDeparture: '',
    decision: `${choice}, by the rule the prompt states.`,
    rationale: '',
    reasoning: `(4) chance ${n.bold ?? 'not stated'} against bar ${n.bar ?? 'not stated'}`,
    selectedPolicies: [],
    rejectedPolicies: [],
    expectedTradeoffs: [],
    watchMetricsNextTurn: [],
  });
}

/** One leader through the recorded events, in the orchestrator's order, with the reader in place of the model. */
function runLeader(name: string, events: RecordedDecision[]) {
  const seed = fixture.seed;
  const kernel = new SimulationKernel(seed, name, [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
  const registry = EffectRegistry.forScenario(marsScenario);
  const live: HexacoProfile = { ...preset(name) };
  const history: Array<{ turn: number; time: number; hexaco: HexacoProfile }> = [{ turn: 0, time: 2035, hexaco: { ...live } }];
  const turns = [...new Set(events.map(e => e.turn))].sort((a, b) => a - b);
  const chosen: string[] = [];
  const outcomes: TurnOutcome[] = [];
  const checks: unknown[] = [];
  let prevTime = 2035;
  for (const turn of turns) {
    const turnEvents = events.filter(e => e.turn === turn).sort((a, b) => a.eventIndex - b.eventIndex);
    const time = turnEvents[0].time;
    kernel.advanceTurn(turn, time, marsScenario.hooks.progressionHook);
    let lastOutcome: TurnOutcome = 'conservative_success';
    for (const e of turnEvents) {
      const ei = e.eventIndex;
      const prompt = promptFor(live, e, kernel.getState().metrics);
      const numbers = numbersFor({ hexaco: live, options: e.options, riskSuccessProbability: e.riskSuccessProbability, metrics: kernel.getState().metrics });
      const decision = CommanderDecisionSchema.parse(JSON.parse(followTheStatedRule(prompt)));
      const resolved = resolveChosenOption(decision.selectedOptionId, decision.decision, e.options);
      assert.ok(resolved, `${name}, "${e.title}": the reply names an option the event offers`);
      checks.push(checkFor(numbers, resolved, (decision as { barDeparture?: unknown }).barDeparture));
      const outcome = classifyOutcomeById(resolved!, e.options, e.riskSuccessProbability, kernel.getState().metrics, new SeededRng(seed).turnSeed(turn * 100 + ei));
      const isRiskyChoice = resolved === e.riskyOptionId;
      const personalityBonus =
        (live.openness - 0.5) * 0.20 +
        (live.conscientiousness - 0.5) * 0.12 +
        (isRiskyChoice ? (live.openness - 0.5) : (live.conscientiousness - 0.5)) * 0.10;
      applyOutcomeEffects(kernel, registry, {
        category: e.category,
        outcome,
        modifiers: { personalityBonus, noise: new SeededRng(seed).turnSeed(turn * 100 + ei + 50).next() * 0.2 - 0.1 },
        turn,
        time,
        politicsHook: marsScenario.hooks.politicsHook,
      });
      chosen.push(resolved!);
      outcomes.push(outcome);
      lastOutcome = outcome;
    }
    // The orchestrator's turn length: the landing turn counts as 1.
    const timeDelta = Math.max(1, time - prevTime);
    driftCommanderHexaco(live, lastOutcome, timeDelta, turn, time, history);
    prevTime = time;
  }
  return { chosen, outcomes, live, history, checks };
}

test('a reader that follows the stated rule decides differently for the two leaders on the same events, and the outcome step and the drift keep them apart', (t) => {
  const run = fixture.runs.find(r => r.pairStartedAt === '2026-11-10T14:06Z' && r.leader === ARIA)!;
  assert.equal(run.decisions.length, 7);
  const aria = runLeader(ARIA, run.decisions);
  const voss = runLeader(VOSS, run.decisions);
  const differ = aria.chosen.filter((id, i) => id !== voss.chosen[i]).length;
  const bold = (o: TurnOutcome[]) => o.filter(x => x.startsWith('risky_')).length;
  const gap = barOf(voss.live) - barOf(aria.live);
  t.diagnostic(`choices differ on ${differ} of 7; Aria Chen: ${aria.chosen.join(', ')} -> ${aria.outcomes.join(', ')}; Dietrich Voss: ${voss.chosen.join(', ')} -> ${voss.outcomes.join(', ')}`);
  t.diagnostic(`after turn 6: Aria Chen's bar ${barOf(aria.live).toFixed(3)}, conscientiousness ${aria.live.conscientiousness.toFixed(3)}; Dietrich Voss's bar ${barOf(voss.live).toFixed(3)}; gap ${gap.toFixed(3)}`);
  // The run is deterministic (seeded draws, a reader in place of the
  // model), so the values are pinned as the head's CI run printed them
  // (run 42975714106): choices differ on 7 of 7, Aria Chen bold on 7,
  // Dietrich Voss on 0, a bar gap of 0.400 and her conscientiousness 0.450.
  assert.equal(differ, 7, `the two leaders' choices differ on ${differ} of 7 events`);
  assert.equal(bold(aria.outcomes), 7, `Aria Chen took the bold option on ${bold(aria.outcomes)} of 7`);
  assert.equal(bold(voss.outcomes), 0, `Dietrich Voss took the bold option on ${bold(voss.outcomes)} of 7`);
  assert.equal(gap.toFixed(3), '0.400', `after turn 6 Aria Chen's bar is ${gap.toFixed(3)} under Dietrich Voss's`);
  assert.equal(aria.live.conscientiousness.toFixed(3), '0.450', `Aria Chen's conscientiousness after turn 6 is ${aria.live.conscientiousness}`);
});

test('a /setup leader whose profile leaves traits out or empty gets the trait model\'s neutral value for each, one log line names them, and the leader decides', (t) => {
  // A /setup body is not checked trait by trait, and a profile with
  // openness alone reached the decision rule with five traits undefined:
  // the rule threw at the first one it printed, and the event loop skipped
  // every decision of the run. A JSON body cannot carry NaN, so an empty
  // trait arrives as null.
  const warn = t.mock.method(console, 'warn', () => {});
  const body = JSON.parse(JSON.stringify({
    actors: [
      { name: 'Partial Lead', archetype: 'The Visionary', hexaco: { openness: 0.9 }, instructions: '' },
      { name: VOSS, archetype: 'The Engineer', hexaco: { ...preset(VOSS), emotionality: null }, instructions: '' },
    ],
    turns: 1,
  }));
  const config = normalizeSimulationConfig(body, marsScenario);
  const neutral = (trait: string) => hexacoModel.defaults[trait] ?? 0.5;
  const landfall = recorded[0];
  for (const actor of config.actors) {
    const hexaco = actor.hexaco as HexacoProfile;
    const prompt = promptFor(hexaco, landfall, asMetrics(landfall.metricsAtTurnStart));
    assert.doesNotMatch(prompt, /NaN/, `${actor.name}: the rule block prints a number for every trait`);
    assert.equal(statedNumbers(prompt).bar, Math.round(100 * barOf(hexaco)), `${actor.name}: the bar`);
    const decision = CommanderDecisionSchema.parse(JSON.parse(followTheStatedRule(prompt)));
    assert.ok(resolveChosenOption(decision.selectedOptionId, decision.decision, landfall.options), `${actor.name}: a decision is made`);
  }
  const [partial, voss] = config.actors.map(a => a.hexaco as HexacoProfile);
  assert.deepEqual(partial, {
    openness: 0.9,
    conscientiousness: neutral('conscientiousness'),
    extraversion: neutral('extraversion'),
    agreeableness: neutral('agreeableness'),
    emotionality: neutral('emotionality'),
    honestyHumility: neutral('honestyHumility'),
  });
  assert.deepEqual(voss, { ...preset(VOSS), emotionality: neutral('emotionality') });
  const lines = warn.mock.calls.map(c => c.arguments.map(String).join(' '));
  assert.equal(lines.length, 2, `one line for each leader with a trait filled: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /Partial Lead/);
  for (const trait of ['conscientiousness', 'extraversion', 'agreeableness', 'emotionality', 'honestyHumility']) {
    assert.match(lines[0], new RegExp(`\\b${trait}\\b`), `the first line names ${trait}`);
  }
  assert.doesNotMatch(lines[0], /\bopenness\b/);
  assert.match(lines[1], /Dietrich Voss/);
  assert.match(lines[1], /\bemotionality\b/);
  assert.doesNotMatch(lines[1], /\bconscientiousness\b/);
});

test('the commander step builds the rule from the live profile, passes it to the decision prompt, checks the reply against the bar it stated and keeps the check in the artifact', () => {
  const src = readFileSync(new URL('../../src/runtime/orchestrator/index.ts', import.meta.url), 'utf-8');
  assert.match(src, /const ruleArgs\b[^=]*= \{\s*hexaco: commanderHexacoLive,/, 'one set of arguments, from the live profile');
  assert.match(src, /const decisionRule = buildDecisionRule\(ruleArgs\);/);
  assert.match(src, /const ruleNumbers = decisionRuleNumbers\(ruleArgs\);/, 'the numbers the rule states, read before the reply');
  assert.match(src, /buildCommanderTurnPrompt\(\{[^}]*\bdecisionRule\b[^}]*\}\)/);
  assert.match(src, /const barCheck = checkBarDeparture\(ruleNumbers, resolvedOptionId, decision\.barDeparture\);/, 'the reply checked against the option it chose');
  assert.match(src, /allCommanderDecisions\.push\(\{[^}]*\bbarCheck\b/, 'the check kept in the decision record');
  assert.match(src, /barChecks: summarizeBarChecks\(allCommanderDecisions\.map\(/, 'the run counts the checks in its artifact');
});

/** One recorded reply of the 11 November pair, read as the commander step reads it, and checked against the bar its prompt stated. */
function checkRecordedReply(run: { hexacoHistory: Array<{ turn: number; hexaco: HexacoProfile }> }, d: RecordedReply, reply: Record<string, unknown> = d.reply) {
  // The profile a decision reads is the one after the turn before.
  const hexaco = run.hexacoHistory.find(h => h.turn === d.turn - 1)!.hexaco;
  const metrics = asMetrics(d.metricsAtTurnStart);
  const decision = CommanderDecisionSchema.parse(reply);
  const resolved = resolveChosenOption(decision.selectedOptionId, decision.decision, d.options);
  const numbers = numbersFor({ hexaco, options: d.options, riskSuccessProbability: d.riskSuccessProbability, metrics });
  return { hexaco, metrics, decision, resolved, check: checkFor(numbers, resolved, (decision as { barDeparture?: unknown }).barDeparture) };
}

const ariaReplies = fixture.ruleReplies.runs.find(r => r.leader === ARIA)!;
const vossReplies = fixture.ruleReplies.runs.find(r => r.leader === VOSS)!;

test('the rule says the chances and multiples already count the dangers the event describes, what following the bar means, and that a departure names a fact the odds do not count in its own field', () => {
  // On 11 November Aria Chen quoted her bar under the bold option's chance on
  // every event and departed on 5 of 6 for the event's own dangers ("toxicity
  // already manifesting", "a large downside tail", "the downside is
  // systemic", "the downside tail is unacceptable"): the departure line let
  // any danger the event describes count as "a reason that belongs to this
  // event", though a bold failure is that danger and its chance and cost
  // multiple are stated beside it.
  const applied = appliedStakes();
  for (const run of [ariaReplies, vossReplies]) {
    for (const d of run.decisions) {
      const hexaco = run.hexacoHistory.find(h => h.turn === d.turn - 1)!.hexaco;
      const prompt = promptFor(hexaco, d, asMetrics(d.metricsAtTurnStart));
      const where = `${run.leader}, turn ${d.turn}, "${d.title}"`;
      assert.match(prompt, /The chances and multiples above already include the dangers this event describes\./, `${where}: the odds include the event's dangers`);
      const failure = /what the event gains is multiplied by (\S+) against (\S+) for a safe failure, and what it costs by (\S+) against (\S+)\./.exec(prompt);
      assert.deepEqual(failure?.slice(1, 5).map(Number), [applied.gain[1], applied.gain[3], applied.cost[1], applied.cost[3]], `${where}: what a failure multiplies a gain and a cost by, as the outcome step applies them`);
      assert.match(prompt, /A danger the event describes is not a reason to depart from your bar/, `${where}: a described danger is no reason to depart`);
      assert.match(prompt, /when the bold option's chance is at least your bar, following it means choosing the bold option; when it is under, a safe option\./, `${where}: what following the bar means`);
      assert.match(prompt, /Depart from it only for a fact these odds do not count/, `${where}: what a departure must name`);
      assert.match(prompt, /Write that fact in "barDeparture"; leave "barDeparture" empty when you follow your bar\./, `${where}: the departure's own field`);
      assert.doesNotMatch(prompt, /a reason that belongs to this event/, `${where}: the old departure line is gone`);
      assert.match(prompt, /\(4\) Is the bold option's chance at least my bar\? Give both numbers and answer yes or no\./, `${where}: point (4) asks for the comparison first`);
      assert.match(prompt, /Then set selectedOptionId, barDeparture, decision, and rationale\./, `${where}: the reply's fields`);
    }
  }
  // Mars's tables hold gains only, so on these 13 events a bold failure
  // moves every entry by the gain multiple of a failure and no entry by a
  // cost multiple: the line must state the gain multiple, not the cost
  // multiple alone. The registry is the one the run builds
  // (EffectRegistry.forScenario(sc) in orchestrator/index.ts).
  const marsRegistry = EffectRegistry.forScenario(marsScenario as any);
  for (const d of [...ariaReplies.decisions, ...vossReplies.decisions]) {
    const table = marsRegistry.getBaseEffect(d.category);
    assert.ok(Object.keys(table).length > 0, `Mars "${d.category}": a table`);
    const failed = marsRegistry.applyOutcome(d.category, 'risky_failure', { personalityBonus: 0, noise: 0 });
    for (const [key, v] of Object.entries(table)) {
      assert.equal(Math.round((failed[key] / v) * 100) / 100, applied.gain[1], `Mars "${d.category}" ${key}: a bold failure moves it by the gain multiple`);
    }
  }
  // A leader on another trait model has no bar, so nothing to depart from.
  const landfall = ariaReplies.decisions[0];
  const noBar = setup.buildCommanderTurnPrompt({
    turn: 1, time: 2035, eventLabel: '', title: landfall.title, description: landfall.description,
    summaries: SUMMARIES, toolboxBlock: '', stateLine: 'Population 30 | Morale 85%', optionText: optionText(landfall.options), effectsText: '', labels: marsScenario.labels,
    decisionRule: ruleFor({ hexaco: preset(ARIA), options: landfall.options, riskSuccessProbability: landfall.riskSuccessProbability, metrics: asMetrics(landfall.metricsAtTurnStart), withBar: false }),
  } as any);
  assert.match(noBar, /is the bold option\. It succeeds about \d+ times in 100\./, 'the chances still stated');
  assert.doesNotMatch(noBar, /barDeparture|your bar/, 'no bar and no departure field without a bar');
  assert.match(noBar, /Then set selectedOptionId, decision, and rationale\./);
});

test('a reply that clears the bar, chooses a safe option and names no fact is flagged in its decision record and counted, and a reply that names one is kept with it', () => {
  // The 13 replies of 11 November, as the commander wrote them.
  assert.equal(ariaReplies.decisions.length, 6);
  assert.equal(vossReplies.decisions.length, 7);
  const flagged = (run: typeof ariaReplies) => run.decisions.filter(d => checkRecordedReply(run, d).check?.unexplained).map(d => d.turn);
  const followed = (run: typeof ariaReplies) => run.decisions.filter(d => checkRecordedReply(run, d).check?.departs === false).map(d => d.turn);
  // Aria Chen: the bold option's chance cleared her bar on all 6; she took it on Landfall only.
  assert.deepEqual(flagged(ariaReplies), [2, 3, 4, 5, 6], 'Aria Chen\'s replies flagged as departures with no fact named, by turn');
  assert.deepEqual(followed(ariaReplies), [1], 'Aria Chen followed her bar on Landfall');
  // Dietrich Voss: the chance was under his bar on all 7, and he chose safe on all 7.
  assert.deepEqual(flagged(vossReplies), [], 'none of Dietrich Voss\'s replies flagged');
  assert.deepEqual(followed(vossReplies), [1, 2, 3, 4, 4, 5, 6], 'Dietrich Voss followed his bar on every event');
  for (const [run, d] of [...ariaReplies.decisions.map(d => [ariaReplies, d] as const), ...vossReplies.decisions.map(d => [vossReplies, d] as const)]) {
    const { hexaco, metrics, check, decision } = checkRecordedReply(run, d);
    assert.equal(decision.barDeparture, '', `${run.leader}, turn ${d.turn}: a reply written before the field reads as naming no fact`);
    assert.equal(check?.boldChance, Math.round(100 * outcomeSuccessChance(true, d.riskSuccessProbability, metrics)), `${run.leader}, turn ${d.turn}: the bold chance the prompt stated`);
    assert.equal(check?.bar, Math.round(100 * barOf(hexaco)), `${run.leader}, turn ${d.turn}: the bar the prompt stated`);
  }

  // Counted for the run.
  const summarize = (setup as any).summarizeBarChecks;
  const all = [...ariaReplies.decisions.map(d => checkRecordedReply(ariaReplies, d).check), ...vossReplies.decisions.map(d => checkRecordedReply(vossReplies, d).check)];
  assert.deepEqual(typeof summarize === 'function' ? summarize(all) : undefined, { decisions: 13, followed: 8, departed: 5, departedWithoutFact: 5 });

  // The same turn 5 reply with a fact named: a departure, kept with its fact, not flagged.
  const turn5 = ariaReplies.decisions.find(d => d.turn === 5)!;
  const fact = 'lifeSupportCapacity 120.75 against a population of 38';
  const named = checkRecordedReply(ariaReplies, turn5, { ...turn5.reply, barDeparture: fact });
  assert.equal(named.decision.barDeparture, fact, 'the schema keeps the field');
  assert.equal(named.check?.departs, true);
  assert.equal(named.check?.unexplained, false);
  assert.equal(named.check?.departureFact, fact);
  // "none" and null name no fact, and neither costs a retry.
  for (const empty of ['none', 'N/A', null]) {
    const parsed = CommanderDecisionSchema.safeParse({ ...turn5.reply, barDeparture: empty });
    assert.equal(parsed.success, true, `barDeparture ${JSON.stringify(empty)} parses`);
    assert.equal(checkRecordedReply(ariaReplies, turn5, { ...turn5.reply, barDeparture: empty }).check?.unexplained, true, `barDeparture ${JSON.stringify(empty)} names no fact`);
  }
});

test('the reader that follows the stated rule is never flagged, and its decisions all count as followed', () => {
  const run = fixture.runs.find(r => r.pairStartedAt === '2026-11-10T14:06Z' && r.leader === ARIA)!;
  for (const name of [ARIA, VOSS]) {
    const { checks } = runLeader(name, run.decisions);
    const seen = checks as Array<BarCheckSeen | undefined>;
    assert.equal(seen.filter(c => c && !c.departs).length, 7, `${name}: the bar check reads 7 of 7 decisions as following the bar`);
    assert.equal(seen.filter(c => c?.unexplained).length, 0, `${name}: none flagged`);
  }
});

test('a departure field that says the bar is followed, or puts a placeholder before other words, names no fact', () => {
  // Aria Chen's turn 6 reply ("Legacy Assessment"): the bold option's chance
  // cleared her bar, she chose the safe option, and her point (4) says "I
  // follow my bar for truth". Words like those in the field are no fact the
  // odds do not count, so the departure stays flagged and counted.
  const turn6 = ariaReplies.decisions.find(d => d.turn === 6)!;
  for (const said of ['None, I follow my bar', 'N/A - following the bar', 'Nothing; following my bar.', 'none (I follow my bar)', 'I follow my bar', 'Following my bar for truth', 'No departure.']) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: said });
    assert.equal(check?.departs, true, `"${said}": the reply departs from the bar`);
    assert.equal(check?.departureFact, '', `"${said}": no fact kept`);
    assert.equal(check?.unexplained, true, `"${said}": flagged as naming no fact`);
  }
  // A value that is not text and holds nothing reads as empty, costs no
  // retry, and names no fact; one that holds something is kept as its JSON.
  for (const empty of [false, true, 0, {}, []]) {
    const { decision, check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: empty });
    assert.equal(decision.barDeparture, '', `${JSON.stringify(empty)}: reads as empty`);
    assert.equal(check?.unexplained, true, `${JSON.stringify(empty)}: flagged as naming no fact`);
  }
  const structured = { foodMonthsReserve: 69.9, people: 39 };
  const kept = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: structured });
  assert.equal(kept.check?.departureFact, JSON.stringify(structured), 'an object that holds a fact is kept as its JSON');
  assert.equal(kept.check?.unexplained, false);
  // A fact that opens with a placeholder word, or names a number, is kept.
  for (const fact of ['None of the 39 colonists has the training option_b needs', 'foodMonthsReserve 69.9 with 39 people to feed']) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: fact });
    assert.equal(check?.departureFact, fact, `"${fact}": kept as the fact`);
    assert.equal(check?.unexplained, false, `"${fact}": not flagged`);
  }
});

test('a number the prompt itself stated names no fact in a departure field that says the bar is followed, and a number after a placeholder names one', () => {
  // Review of #251: "I follow my bar (41)" was kept as a named fact because
  // it holds a digit, though 41 is only the bar its prompt stated; and
  // "None: 0 spare cartridges" was read as naming none because it opens
  // with a placeholder, though it names a supply and its number. The rule
  // block prints 0 as a cost multiple, so the supply here is 9.
  const turn6 = ariaReplies.decisions.find(d => d.turn === 6)!;
  const stated = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: '' }).check!;
  const { bar, boldChance } = stated;
  assert.equal(stated.departs, true, 'Aria Chen\'s turn 6 reply departs from her bar');
  for (const said of [
    `I follow my bar (${bar})`,
    `None, I follow my bar of ${bar}`,
    `Following my bar: ${boldChance} in 100 against ${bar} in 100`,
    `No departure (${boldChance}/100 >= ${bar}/100)`,
  ]) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: said });
    assert.equal(check?.departureFact, '', `"${said}": the prompt's own numbers name no fact`);
    assert.equal(check?.unexplained, true, `"${said}": flagged as naming no fact`);
  }
  for (const fact of [
    'None: 9 spare cartridges',
    'N/A - 9 spare filter cartridges for option_b',
    `I follow my bar of ${bar}, but foodMonthsReserve is 3 with 39 people to feed`,
  ]) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: fact });
    assert.equal(check?.departureFact, fact, `"${fact}": kept as the fact`);
    assert.equal(check?.unexplained, false, `"${fact}": not flagged`);
  }
});

test('a departure field after a placeholder names a fact with a decimal written without its leading zero, or a negative number the size of the bar', () => {
  // Review of #253: ".5" was read as no number, and "-41" as the bar 41.
  // The rule block prints conscientiousness 0.50 on this turn, so the
  // decimal here is .2.
  const turn6 = ariaReplies.decisions.find(d => d.turn === 6)!;
  const { bar, boldChance } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: '' }).check!;
  for (const fact of [
    'None: .2 months of food left',
    `None: a power margin of -${bar} kW against a bold failure's draw`,
  ]) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: fact });
    assert.equal(check?.departureFact, fact, `"${fact}": kept as the fact`);
    assert.equal(check?.unexplained, false, `"${fact}": not flagged`);
  }
  // A hyphen between two of the prompt's numbers is no minus sign.
  const said = `No departure (bar and chance ${bar}-${boldChance})`;
  const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: said });
  assert.equal(check?.departureFact, '', `"${said}": the prompt's own numbers name no fact`);
  assert.equal(check?.unexplained, true, `"${said}": flagged as naming no fact`);
});

test('a range of the prompt\'s own numbers written on the scale "/100", "in 100" or "%" names no fact', () => {
  // Review of #253: once the scale was taken out, "41/100-72/100" read as 41
  // and -72, so the hyphen between them counted as a minus sign and -72 as a
  // number the prompt did not state.
  const turn6 = ariaReplies.decisions.find(d => d.turn === 6)!;
  const { bar, boldChance } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: '' }).check!;
  for (const said of [
    `No departure (bar and chance ${bar}/100-${boldChance}/100)`,
    `No departure (bar and chance ${bar} in 100-${boldChance} in 100)`,
    `No departure (bar and chance ${bar}%-${boldChance}%)`,
  ]) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: said });
    assert.equal(check?.departureFact, '', `"${said}": the prompt's own numbers name no fact`);
    assert.equal(check?.unexplained, true, `"${said}": flagged as naming no fact`);
  }
  // A minus sign after a space still opens a negative number, after the scale too.
  const fact = `None: ${bar}/100 against a power margin of -${boldChance} kW`;
  const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: fact });
  assert.equal(check?.departureFact, fact, `"${fact}": kept as the fact`);
  assert.equal(check?.unexplained, false, `"${fact}": not flagged`);
});

test('every number the rule block prints for a decision, and its chances written as fractions, name no fact after a placeholder', () => {
  // Review of #253: the prompt also states the break-even chances (57 and
  // 67 in 100), the multiples (2.5, -2, 1 and -1; 0, 4, 1 and 3) and the
  // leader's trait values, and a reply restating one of them, or a chance
  // as a fraction ("0.65 >= 0.41"), was read as naming a fact. The numbers
  // are read here from the rule block this decision's prompt carries.
  const turn6 = ariaReplies.decisions.find(d => d.turn === 6)!;
  const hexaco = ariaReplies.hexacoHistory.find(h => h.turn === turn6.turn - 1)!.hexaco;
  const block = ruleFor({ hexaco, options: turn6.options, riskSuccessProbability: turn6.riskSuccessProbability, metrics: asMetrics(turn6.metricsAtTurnStart) });
  const { check: stated } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: '' });
  const { bar, boldChance } = stated!;
  assert.equal(stated!.departs, true, 'Aria Chen\'s turn 6 reply departs from her bar');
  const printed = [...block.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g)].map(m => m[0]).filter(x => x !== '100');
  const onTheScale = [...block.matchAll(/(?<![\w.])(\d+) (?:times )?in 100\b/g)].map(m => Number(m[1]));
  const noLean = /takes it at (\d+) in 100/.exec(block)?.[1];
  const evenOnCosts = /even at (\d+) in 100/.exec(block)?.[1];
  assert.ok(noLean && evenOnCosts, 'the block states both break-even chances');
  for (const x of [String(bar), String(boldChance), noLean!, evenOnCosts!, '2.5', '-2', '-1', '0', '4', '3', hexaco.openness.toFixed(2)]) {
    assert.ok(printed.includes(x), `the block prints ${x}`);
  }
  for (const said of [
    `None, I follow my bar; a leader with no lean takes it at ${noLean} in 100`,
    `None (${(boldChance / 100).toFixed(2)} >= ${(bar / 100).toFixed(2)})`,
    `None: even at ${(Number(evenOnCosts) / 100).toFixed(2)} on what it costs`,
    ...printed.map(x => `None, I follow my bar; the rule states ${x}`),
    ...onTheScale.map(x => `None, I follow my bar; the rule states ${(x / 100).toFixed(2)}`),
  ]) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: said });
    assert.equal(check?.departureFact, '', `"${said}": the rule block's own numbers name no fact`);
    assert.equal(check?.unexplained, true, `"${said}": flagged as naming no fact`);
  }
  // A number the block does not print still names a fact.
  for (const fact of ['None: 9 spare cartridges', `None: ${(bar + 1) / 100} of the water reserve left`]) {
    const { check } = checkRecordedReply(ariaReplies, turn6, { ...turn6.reply, barDeparture: fact });
    assert.equal(check?.departureFact, fact, `"${fact}": kept as the fact`);
    assert.equal(check?.unexplained, false, `"${fact}": not flagged`);
  }
});

test('the opening cues fire at the poles the two presets were written at', () => {
  const aria = setup.buildPersonalityCue(preset(ARIA));
  const voss = setup.buildPersonalityCue(preset(VOSS));
  assert.match(aria, /You accept casualties for strategic gain/, 'Aria Chen, emotionality 0.30');
  assert.match(voss, /You weigh human cost heavily/, 'Dietrich Voss, emotionality 0.70');
  assert.match(voss, /You work through technical channels/, 'Dietrich Voss, extraversion 0.30');
});
