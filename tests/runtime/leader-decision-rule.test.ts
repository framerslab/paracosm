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

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/mars-live-decisions-2026-11.json', import.meta.url), 'utf-8'),
) as { seed: number; runs: RecordedRun[] };
const recorded = fixture.runs.flatMap(r => r.decisions);

const leaders = marsScenario.presets[0].leaders!;
const preset = (name: string) => leaders.find(l => l.name === name)!.hexaco as unknown as HexacoProfile;
const ARIA = 'Aria Chen';
const VOSS = 'Dietrich Voss';

/** The decision rule the commander step builds, or "" where the code has none. */
const ruleFor = (args: { hexaco: HexacoProfile; options: CrisisOption[]; riskSuccessProbability: number; metrics: WorldMetrics }): string => {
  const build = (setup as any).buildDecisionRule;
  return typeof build === 'function' ? build(args) : '';
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
 * bring the same on average under the multipliers 2.5, -2, 1 and -1 (4/7),
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
  assert.match(prompt, /Choose by your bar\. Depart from it only for a reason that belongs to this event/);
  assert.match(prompt, /\(2\) What do the department reports establish about the problem\?/);
  assert.match(prompt, /\(4\) The bold option's chance against my bar/);
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
  let prevTime = 2035;
  for (const turn of turns) {
    const turnEvents = events.filter(e => e.turn === turn).sort((a, b) => a.eventIndex - b.eventIndex);
    const time = turnEvents[0].time;
    kernel.advanceTurn(turn, time, marsScenario.hooks.progressionHook);
    let lastOutcome: TurnOutcome = 'conservative_success';
    for (const e of turnEvents) {
      const ei = e.eventIndex;
      const prompt = promptFor(live, e, kernel.getState().metrics);
      const decision = CommanderDecisionSchema.parse(JSON.parse(followTheStatedRule(prompt)));
      const resolved = resolveChosenOption(decision.selectedOptionId, decision.decision, e.options);
      assert.ok(resolved, `${name}, "${e.title}": the reply names an option the event offers`);
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
  return { chosen, outcomes, live, history };
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
  assert.ok(differ >= 5, `the two leaders' choices differ on ${differ} of 7 events`);
  assert.ok(bold(aria.outcomes) >= 5, `Aria Chen took the bold option on ${bold(aria.outcomes)} of 7`);
  assert.equal(bold(voss.outcomes), 0, `Dietrich Voss took the bold option on ${bold(voss.outcomes)} of 7`);
  assert.ok(gap >= 0.15, `after turn 6 Aria Chen's bar is ${gap.toFixed(3)} under Dietrich Voss's`);
  assert.ok(aria.live.conscientiousness <= 0.65, `Aria Chen's conscientiousness after turn 6 is ${aria.live.conscientiousness}`);
});

test('the commander step builds the rule from the live profile and passes it to the decision prompt', () => {
  const src = readFileSync(new URL('../../src/runtime/orchestrator/index.ts', import.meta.url), 'utf-8');
  assert.match(src, /buildDecisionRule\(\{\s*hexaco: commanderHexacoLive,/);
  assert.match(src, /buildCommanderTurnPrompt\(\{[^}]*\bdecisionRule\b[^}]*\}\)/);
});

test('the opening cues fire at the poles the two presets were written at', () => {
  const aria = setup.buildPersonalityCue(preset(ARIA));
  const voss = setup.buildPersonalityCue(preset(VOSS));
  assert.match(aria, /You accept casualties for strategic gain/, 'Aria Chen, emotionality 0.30');
  assert.match(voss, /You weigh human cost heavily/, 'Dietrich Voss, emotionality 0.70');
  assert.match(voss, /You work through technical channels/, 'Dietrich Voss, extraversion 0.30');
});
