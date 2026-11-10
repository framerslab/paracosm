/**
 * The effects a commander selects reach the state.
 *
 * The commander is told to return `selectedPolicies` and is shown each
 * effect under a `<department>/<id>` key. The live Mars Genesis and Atlas
 * Lab pairs of 3 November 2026 wrote those keys in `selectedPolicies`, bare
 * and with a suffix ("medical/effect_1 (risk_mitigation)", "governance/
 * effect_1 (risk_mitigation): Shift a small slice ..."), while the policy
 * step read only `selectedEffectIds`, which no prompt asks for; no
 * `[policy] effects` line appeared in 33 decisions. The department reports
 * and the selections below are the ones the saved runs of those pairs hold.
 * These tests run the commander's prompt, its response schema, the policy
 * step the orchestrator runs and the kernel, with no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { EffectRegistry } from '../../src/engine/registries/effects.js';
import { CommanderDecisionSchema } from '../../src/runtime/validators/commander.js';
import { buildCommanderBootstrap, buildCommanderTurnPrompt, buildEffectsBlock } from '../../src/runtime/orchestrator/commander-setup.js';
import { applyCommanderPolicy } from '../../src/runtime/orchestrator/commander-policy.js';
import { emptyReport } from '../../src/runtime/util/parsers.js';
import type { CommanderDecision, DepartmentReport } from '../../src/runtime/contracts.js';

const here = dirname(fileURLToPath(import.meta.url));
const atlasLab = loadDiskCustomScenarios(resolve(here, '../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage;

/** The outcome tables a run of the scenario bounds its decisions by, as the orchestrator passes them. */
function tablesOf(scenario: ScenarioPackage) {
  return {
    registry: EffectRegistry.forScenario(scenario),
    politicsHook: scenario.hooks.politicsHook,
    categories: Object.keys(scenario.knowledge?.categoryMapping ?? {}),
  };
}
const marsTables = tablesOf(marsScenario);

type Effect = { id: string; type: string; description: string; systemDelta?: Record<string, number>; politicsDelta?: Record<string, number> };

function report(department: string, recommendedEffects: Effect[]): DepartmentReport {
  return { ...emptyReport(department), recommendedEffects } as unknown as DepartmentReport;
}

/** Aria Chen's turn 1 reports in the Mars Genesis pair (Year 2035, the landing site). */
const ariaTurn1 = (): DepartmentReport[] => [
  report('medical', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Adopt Arcadia Planitia-style low-slope, ice-rich site criteria for the first landing and habitat footprint.', systemDelta: { morale: 0.03 } },
    { id: 'effect_2', type: 'capacity_expansion', description: 'Front-load shielded water extraction and bermed habitat construction to reduce radiation and contingency risk.', systemDelta: { morale: 0.02 } },
    { id: 'effect_3', type: 'research_bet', description: 'Defer Valles Marineris mineral science to a later mission phase after the colony has redundancy and surface mobility.', systemDelta: { morale: -0.01 } },
  ]),
  report('engineering', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Site selection away from steep terrain and toward subsurface ice lowers construction and water-risk exposure.', systemDelta: { morale: 0.03 } },
    { id: 'effect_2', type: 'resource_shift', description: 'Settlement siting near ice deposits reduces water transport overhead and preserves reserves.', systemDelta: { morale: 0.01 } },
  ]),
];

/** Dietrich Voss's turn 1 reports in the same pair. */
const vossTurn1 = (): DepartmentReport[] => [
  report('medical', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Choose a low-slope, ice-accessible landing site and immediately implement regolith shielding and storm refuge capacity.', systemDelta: { morale: 0.03 } },
    { id: 'effect_2', type: 'capacity_expansion', description: 'Use nearby ice to reduce water import dependence and preserve power for construction and life support.', systemDelta: { morale: 0.02 } },
    { id: 'effect_3', type: 'research_bet', description: 'Defer steep-terrain science objectives until a second-phase expedition with better construction capacity.', systemDelta: { morale: 0.01 } },
  ]),
  report('engineering', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Select Arcadia Planitia as the initial landing and settlement site to reduce construction and water-supply risk.', systemDelta: { morale: 0.04 } },
    { id: 'effect_2', type: 'resource_shift', description: 'Shift early engineering effort toward ice extraction, water processing, and shielding upgrades rather than high-risk terrain works.', systemDelta: { morale: 0.02 } },
  ]),
];

/** Marcus Reinhardt's turn 2 reports in the Atlas Lab pair (Month 2). */
const marcusTurn2 = (): DepartmentReport[] => [
  report('alignment_research', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Schedule one more focused alignment pass for the explanation head before release.', systemDelta: { morale: -0.01 } },
    { id: 'effect_2', type: 'resource_shift', description: 'Shift red-team time toward mixed-modality prompt coverage and away from lower-yield general canary repetition.', systemDelta: { morale: 0.02 } },
  ]),
  report('governance', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Shift a small engineering slice from general capability work into explanation-head suppression and mixed-modality red-teaming.', systemDelta: { morale: -0.01 } },
  ]),
];

/** The commander's reply, as the turn loop validates it. */
function reply(fields: Record<string, unknown>): CommanderDecision {
  return CommanderDecisionSchema.parse({
    selectedOptionId: 'option_a',
    decision: 'Select Arcadia Planitia as the first permanent settlement landing site.',
    rationale: '',
    reasoning: '1) ...',
    rejectedPolicies: [],
    expectedTradeoffs: [],
    watchMetricsNextTurn: [],
    ...fields,
  }) as unknown as CommanderDecision;
}

function marsKernel(): SimulationKernel {
  return new SimulationKernel(marsScenario.setup.defaultSeed ?? 11, 'Aria Chen', [], {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
}

/** The Mars Genesis run of the live pair of 6 November 2026: seed 950, 30 people. */
function mars950(): SimulationKernel {
  return new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
}

function near(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

/**
 * Morale after a gain whose part above 0.9 is `above`: a gain adds in full
 * up to 0.9 and that part closes `1 - e^(-above / 0.1)` of the 0.1 left to
 * 1 (`moraleAfterGain`).
 */
function eased(above: number): number {
  return 1 - 0.1 * Math.exp(-above / 0.1);
}

/** Run the policy step the orchestrator runs after a decision, with the outcome tables it passes, and keep its log. */
function step(kernel: SimulationKernel, decision: CommanderDecision, reports: DepartmentReport[], tables: Parameters<typeof applyCommanderPolicy>[6] = marsTables) {
  const lines: string[] = [];
  const applied = applyCommanderPolicy(kernel, decision, reports, 1, kernel.getState().metadata.currentTime, l => lines.push(l), tables);
  return { ...applied, lines };
}

test('the commander is asked for the keys it is shown, in selectedPolicies', () => {
  assert.match(buildCommanderBootstrap(''), /selectedPolicies/);
  const block = buildEffectsBlock(ariaTurn1());
  assert.match(block, /- medical\/effect_1 \(risk_mitigation\): Adopt Arcadia/);
  assert.match(block, /- engineering\/effect_2 \(resource_shift\)/);
  const prompt = buildCommanderTurnPrompt({
    turn: 1, time: 2035, eventLabel: '', title: 'Landfall', description: 'Choose the landing site.',
    summaries: '', toolboxBlock: '', stateLine: 'morale 85%', optionText: '', effectsText: block,
  });
  assert.match(prompt, /AVAILABLE POLICY EFFECTS/);
  assert.match(prompt, /key[^\n]*"selectedPolicies"[^\n]*medical\/effect_1/i, 'the prompt says the keys go in selectedPolicies');
  assert.equal(buildEffectsBlock([report('medical', [])]), '', 'no effects, no block');
});

test('Aria Chen\'s turn 1 selection moves morale through the kernel and logs it', () => {
  const kernel = marsKernel();
  assert.equal(kernel.getState().metrics.morale, 0.85);
  const { deltas, lines, unmatched } = step(kernel, reply({
    selectedPolicies: ['medical/effect_1', 'medical/effect_2', 'medical/effect_3', 'engineering/effect_1', 'engineering/effect_2'],
  }), ariaTurn1());
  // 0.03 + 0.02 - 0.01 from medical, 0.03 + 0.01 from engineering: 0.08
  // asked from 0.85, and the 0.03 of it above 0.9 eases.
  near(kernel.getState().metrics.morale, eased(0.03), 'morale');
  near(deltas.morale, 0.075918, 'reported change');
  assert.deepEqual(unmatched, []);
  assert.equal(lines.filter(l => l.includes('[policy] effects')).length, 1, lines.join('\n'));

  const one = marsKernel();
  step(one, reply({ selectedPolicies: ['medical/effect_1'] }), ariaTurn1());
  near(one.getState().metrics.morale, 0.88, 'medical/effect_1 alone');
});

test('a key with the type or the description after it still reads', () => {
  const kernel = marsKernel();
  const { unmatched } = step(kernel, reply({
    selectedPolicies: ['medical/effect_1 (risk_mitigation)', 'medical/effect_2 (capacity_expansion)', 'engineering/effect_1 (risk_mitigation)', 'engineering/effect_2 (resource_shift)'],
  }), vossTurn1());
  // Dietrich Voss: 0.03 + 0.02 + 0.04 + 0.02 asked from 0.85, and the
  // 0.06 of it above 0.9 eases.
  near(kernel.getState().metrics.morale, eased(0.06), 'Voss morale');
  assert.deepEqual(unmatched, []);

  assert.ok(atlasLab, 'scenarios/ holds atlas-lab');
  const lab = new SimulationKernel(atlasLab.setup.defaultSeed ?? 11, 'Marcus Reinhardt', [], {
    startTime: 2, initialPopulation: 30, scenario: atlasLab,
  });
  const before = lab.getState().metrics.morale;
  step(lab, reply({
    selectedPolicies: [
      'alignment_research/effect_2 (resource_shift): Shift red-team time toward mixed-modality prompt coverage and away from lower-yield general canary repetition.',
      'governance/effect_1 (risk_mitigation): Shift a small engineering slice from general capability work into explanation-head suppression and mixed-modality red-teaming.',
    ],
  }), marcusTurn2(), tablesOf(atlasLab));
  near(lab.getState().metrics.morale, before + 0.01, 'Marcus morale');
});

test('one decision moves a key at most what one ordinary event outcome brings, and the log names what was asked', () => {
  // #214: the policy step summed any number a report wrote. An engineering
  // effect of ten habitat modules took Mars Genesis from 3 modules to 13 in
  // one decision; the outcome tables bring 2 at most (infrastructure).
  const reports = [
    report('engineering', [
      { id: 'effect_1', type: 'capacity_expansion', description: 'Build two habitat modules.', systemDelta: { infrastructureModules: 10 } },
    ]),
    report('medical', [
      { id: 'effect_1', type: 'social_investment', description: 'Rest rotation for the whole crew.', systemDelta: { morale: 0.5 } },
    ]),
    report('governance', [
      { id: 'effect_1', type: 'governance_change', description: 'Local water and air accounts.', politicsDelta: { earthDependencyPct: -20 } },
    ]),
  ];
  const kernel = mars950();
  assert.equal(kernel.getState().metrics.infrastructureModules, 3);
  assert.equal(kernel.getState().metrics.morale, 0.85);
  const { deltas, lines, ...applied } = step(kernel, reply({
    selectedPolicies: ['engineering/effect_1', 'medical/effect_1', 'governance/effect_1'],
  }), reports);
  const state = kernel.getState();
  assert.equal(state.metrics.infrastructureModules, 5, 'the infrastructure table brings 2 modules');
  // The bound holds morale's 0.5 at 0.15, and the 0.1 of that above 0.9 eases.
  near(state.metrics.morale, eased(0.1), 'morale: the psychological table brings 0.15');
  assert.equal(state.politics.earthDependencyPct, 92, 'the politics table brings 3 points');
  assert.deepEqual(deltas, { infrastructureModules: 2, morale: 0.113212, earthDependencyPct: -3 });
  const line = lines.find(l => l.includes('[policy] effects'));
  assert.ok(line, lines.join('\n'));
  assert.match(line, /asked: \{"infrastructureModules":10,"morale":0\.5,"earthDependencyPct":-20\}/);
  assert.deepEqual((applied as Record<string, unknown>).limited, {
    infrastructureModules: { asked: 10, applied: 2 },
    morale: { asked: 0.5, applied: 0.113212 },
    earthDependencyPct: { asked: -20, applied: -3 },
  });

  // A fall is bounded the same way, and well inside the ceiling.
  const down = mars950();
  step(down, reply({ selectedPolicies: ['medical/effect_1'] }), [report('medical', [
    { id: 'effect_1', type: 'resource_shift', description: 'Cut the rest rotation.', systemDelta: { morale: -0.5 } },
  ])]);
  near(down.getState().metrics.morale, 0.7, 'morale -0.5 asked, -0.15 applied');

  // Two effects on one key add up before the bound.
  const two = mars950();
  step(two, reply({ selectedPolicies: ['engineering/effect_1', 'engineering/effect_2'] }), [report('engineering', [
    { id: 'effect_1', type: 'capacity_expansion', description: 'One module.', systemDelta: { infrastructureModules: 1.5 } },
    { id: 'effect_2', type: 'capacity_expansion', description: 'Another.', systemDelta: { infrastructureModules: 1.5 } },
  ])]);
  assert.equal(two.getState().metrics.infrastructureModules, 5);
});

test('a choice the easing holds or a floor stops is logged with what it asked, and one that moved as asked is not', () => {
  const kernel = mars950();
  const raise = (delta: number) => step(kernel, reply({ selectedPolicies: ['psychology/effect_1'] }), [report('psychology', [
    { id: 'effect_1', type: 'social_investment', description: 'Crew festival.', systemDelta: { morale: delta } },
  ])]);
  // 0.85 + 0.05 ends at 0.9, so it moves as asked.
  const first = raise(0.05);
  near(kernel.getState().metrics.morale, 0.9, 'first');
  assert.ok(!first.lines.some(l => l.includes('asked')), first.lines.join('\n'));
  assert.deepEqual((first as Record<string, unknown>).limited, {});

  // From 0.9 a gain of 0.1 closes 1 - e^-1 of the gap to 1.
  const second = raise(0.1);
  near(kernel.getState().metrics.morale, eased(0.1), 'second');
  const line = second.lines.find(l => l.includes('[policy] effects'));
  assert.ok(line, second.lines.join('\n'));
  assert.match(line, /\[policy\] effects: \{"morale":0\.063212\} asked: \{"morale":0\.1\}/);
  assert.deepEqual((second as Record<string, unknown>).limited, { morale: { asked: 0.1, applied: 0.063212 } });

  // No gain reaches 1, so the next one still moves morale: two gains of
  // 0.1 land where one of 0.2 lands.
  const third = raise(0.1);
  near(kernel.getState().metrics.morale, eased(0.2), 'third');
  assert.deepEqual(third.deltas, { morale: 0.023254 });
  assert.match(third.lines.join('\n'), /asked: \{"morale":0\.1\}/);

  // A floor still stops a choice outright: with no power left, a cut
  // moves nothing, and the record says so.
  const dark = mars950();
  dark.applySystemDeltas({ powerKw: -400 });
  assert.equal(dark.getState().metrics.powerKw, 0);
  const cut = step(dark, reply({ selectedPolicies: ['engineering/effect_1'] }), [report('engineering', [
    { id: 'effect_1', type: 'resource_shift', description: 'Shed load.', systemDelta: { powerKw: -10 } },
  ])]);
  assert.deepEqual(cut.deltas, { powerKw: 0 }, 'the choice moved nothing');
  assert.match(cut.lines.join('\n'), /\[policy\] effects: \{"powerKw":0\} asked: \{"powerKw":-10\}/);
  assert.deepEqual((cut as Record<string, unknown>).limited, { powerKw: { asked: -10, applied: 0 } });
});

test('a key no outcome table names moves at most a tenth of its value, or 1 from zero', () => {
  assert.ok(atlasLab, 'scenarios/ holds atlas-lab');
  const lab = new SimulationKernel(950, 'Marcus Reinhardt', [], { startTime: 1, initialPopulation: 30, scenario: atlasLab });
  assert.equal(lab.getState().metrics.trainingRunsPerMonth, 4);
  const runs = step(lab, reply({ selectedPolicies: ['alignment_research/effect_1'] }), [report('alignment_research', [
    { id: 'effect_1', type: 'capacity_expansion', description: 'Three more training runs a month.', systemDelta: { trainingRunsPerMonth: 3 } },
  ])], tablesOf(atlasLab));
  near(lab.getState().metrics.trainingRunsPerMonth, 4.4, 'a tenth of 4');
  assert.match(runs.lines.join('\n'), /asked: \{"trainingRunsPerMonth":3\}/);

  lab.applySystemDeltas({ redTeamPassesPerMonth: -6 });
  assert.equal(lab.getState().metrics.redTeamPassesPerMonth, 0);
  step(lab, reply({ selectedPolicies: ['governance/effect_1'] }), [report('governance', [
    { id: 'effect_1', type: 'capacity_expansion', description: 'Five red-team passes a month.', systemDelta: { redTeamPassesPerMonth: 5 } },
  ])], tablesOf(atlasLab));
  assert.equal(lab.getState().metrics.redTeamPassesPerMonth, 1, '1 from zero');

  // A key the tables name keeps its table's bound: talent brings 8 people.
  const hires = step(lab, reply({ selectedPolicies: ['governance/effect_1'] }), [report('governance', [
    { id: 'effect_1', type: 'population_intake', description: 'Hire forty researchers.', systemDelta: { population: 40 } },
  ])], tablesOf(atlasLab));
  assert.equal(hires.deltas.population, 8);
});

test('every difference between asked and applied is recorded, and a sum alone never reads as one', () => {
  // A request a hair over the bound is held at the bound, and the record
  // says so. The requests here are losses, which move in full: a gain that
  // ends above 0.9 eases, and that difference is recorded too.
  const over = mars950();
  const held = step(over, reply({ selectedPolicies: ['psychology/effect_1'] }), [report('psychology', [
    { id: 'effect_1', type: 'resource_shift', description: 'Cut the rest rotation.', systemDelta: { morale: -0.1500000005 } },
  ])]);
  assert.deepEqual(held.deltas, { morale: -0.15 });
  assert.deepEqual((held as Record<string, unknown>).limited, { morale: { asked: -0.1500000005, applied: -0.15 } });
  assert.match(held.lines.join('\n'), /asked: \{"morale":-0\.1500000005\}/);

  // Effects naming one key in both fields add up as the kernel adds them,
  // so a change that moved as asked records nothing.
  const both = mars950();
  const summed = step(both, reply({ selectedPolicies: ['psychology/effect_1', 'psychology/effect_2'] }), [report('psychology', [
    { id: 'effect_1', type: 'resource_shift', description: 'Longer shifts.', systemDelta: { morale: -0.01 }, politicsDelta: { morale: -0.03 } },
    { id: 'effect_2', type: 'resource_shift', description: 'No letters home this month.', systemDelta: { morale: -0.06 } },
  ])]);
  assert.deepEqual((summed as Record<string, unknown>).limited, {});
  assert.ok(!summed.lines.some(l => l.includes('asked')), summed.lines.join('\n'));
});

test('a head count moves whole people within the bound', () => {
  // No Mars table names population, so a decision moves at most a tenth of
  // the roster: 2.5 of 25 people. The kernel moves whole people, and 2.5
  // rounds to 3, so the bound counts whole people: 2.
  const kernel = new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 25, scenario: marsScenario });
  const { deltas, lines } = step(kernel, reply({ selectedPolicies: ['governance/effect_1'] }), [report('governance', [
    { id: 'effect_1', type: 'population_intake', description: 'Bring three settlers on the next ship.', systemDelta: { population: 3 } },
  ])]);
  assert.equal(deltas.population, 2);
  assert.equal(kernel.getState().metrics.population, 27);
  assert.match(lines.join('\n'), /asked: \{"population":3\}/);
});

test('a key a table names only with 0 does not move, since one event brings nothing on it', () => {
  const tables = { registry: new EffectRegistry({ drill: { morale: 0, foodMonthsReserve: 2 } }) };
  const kernel = mars950();
  step(kernel, reply({ selectedPolicies: ['psychology/effect_1'] }), [report('psychology', [
    { id: 'effect_1', type: 'social_investment', description: 'Crew festival.', systemDelta: { morale: 0.1, foodMonthsReserve: 3 } },
  ])], tables);
  assert.equal(kernel.getState().metrics.morale, 0.85);
  assert.equal(kernel.getState().metrics.foodMonthsReserve, 20);
});

test('a run reads its politics table for the bound once, not at every decision', () => {
  // A compiled politics hook runs in a sandbox of its own at each call.
  let calls = 0;
  const hook = marsScenario.hooks.politicsHook!;
  const tables = { ...marsTables, politicsHook: (category: string, outcome: string) => { calls += 1; return hook(category, outcome); } };
  const kernel = mars950();
  const reports = [report('governance', [
    { id: 'effect_1', type: 'governance_change', description: 'Local water and air accounts.', politicsDelta: { earthDependencyPct: -20 } },
  ])];
  step(kernel, reply({ selectedPolicies: ['governance/effect_1'] }), reports, tables);
  const first = calls;
  assert.ok(first > 0);
  step(kernel, reply({ selectedPolicies: ['governance/effect_1'] }), reports, tables);
  assert.equal(calls, first, 'the second decision read the table again');
  assert.equal(kernel.getState().politics.earthDependencyPct, 89, 'both decisions are bounded at 3');
});

test('a selection that names no effect moves nothing and is reported in the log', () => {
  const kernel = marsKernel();
  const { unmatched, lines } = step(kernel, reply({
    selectedPolicies: ['medical/effect_1', 'medical/effect_9', 'expand_solar', 'medical/effect_10'],
  }), ariaTurn1());
  near(kernel.getState().metrics.morale, 0.88, 'only medical/effect_1 moved');
  assert.deepEqual(unmatched, ['medical/effect_9', 'expand_solar', 'medical/effect_10']);
  const report = lines.find(l => l.includes('[policy]') && l.includes('medical/effect_9'));
  assert.ok(report, `the log names the selection that matched nothing:\n${lines.join('\n')}`);
  assert.match(report, /expand_solar/);
});

test('selectedEffectIds still reads, and an effect named in both fields counts once', () => {
  const ids = marsKernel();
  step(ids, reply({ selectedEffectIds: ['effect_3'] }), ariaTurn1());
  near(ids.getState().metrics.morale, 0.84, 'a bare id one report holds reads that report');

  const both = marsKernel();
  const { unmatched } = step(both, reply({
    selectedEffectIds: ['medical/effect_1'],
    selectedPolicies: ['medical/effect_1', 'medical/effect_1 (risk_mitigation)', 'Medical/Effect_1'],
  }), ariaTurn1());
  near(both.getState().metrics.morale, 0.88, 'once');
  assert.deepEqual(unmatched, []);
});

test('a decision with no selection moves nothing and logs nothing', () => {
  const kernel = marsKernel();
  const { deltas, lines } = step(kernel, reply({}), ariaTurn1());
  assert.equal(kernel.getState().metrics.morale, 0.85);
  assert.deepEqual(deltas, {});
  assert.deepEqual(lines, []);
});

test('two keys written in one selection both apply, and a comma inside a description adds nothing', () => {
  const kernel = marsKernel();
  const { unmatched } = step(kernel, reply({ selectedPolicies: ['medical/effect_1, engineering/effect_1'] }), ariaTurn1());
  // 0.85 + 0.03 + 0.03, where the second key was dropped before; the
  // 0.01 above 0.9 eases.
  near(kernel.getState().metrics.morale, eased(0.01), 'both keys');
  assert.deepEqual(unmatched, []);

  const described = marsKernel();
  step(described, reply({
    selectedPolicies: ['medical/effect_2 (capacity_expansion): front-load shielded water extraction, bermed habitat construction'],
  }), ariaTurn1());
  near(described.getState().metrics.morale, 0.87, 'medical/effect_2 alone');
});

test('a key that names two effects, by case or twice, applies neither and is reported', () => {
  const reports = [report('medical', [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Shielded berms.', systemDelta: { morale: 0.03 } },
    { id: 'Effect_1', type: 'research_bet', description: 'Deep drilling.', systemDelta: { morale: -0.05 } },
    { id: 'effect_2', type: 'risk_mitigation', description: 'Storm refuge.', systemDelta: { morale: 0.02 } },
    { id: 'effect_2', type: 'resource_shift', description: 'Water import cut.', systemDelta: { morale: -0.04 } },
  ])];
  // The key as shown, case and all, names one effect.
  const exact = marsKernel();
  step(exact, reply({ selectedPolicies: ['medical/Effect_1'] }), reports);
  near(exact.getState().metrics.morale, 0.80, 'medical/Effect_1 is the drilling effect');

  // A key in another case that two effects share, or a key two effects carry, names neither.
  const kernel = marsKernel();
  const { unmatched, ambiguous, lines } = step(kernel, reply({ selectedPolicies: ['MEDICAL/EFFECT_1', 'medical/effect_2'] }), reports);
  assert.equal(kernel.getState().metrics.morale, 0.85);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(ambiguous, ['MEDICAL/EFFECT_1', 'medical/effect_2']);
  assert.ok(lines.some(l => l.includes('[policy]') && l.includes('MEDICAL/EFFECT_1') && l.includes('medical/effect_2')), lines.join('\n'));
});

test('a bare id that two departments hold names neither, and an id one department holds still reads', () => {
  // Every department numbers its effects from effect_1, so in Aria Chen's
  // turn 1 a bare effect_1 or effect_2 is a medical effect and an
  // engineering one at once. The decision schema carries selectedEffectIds,
  // where a model writes bare ids; reading the first report that holds one
  // applied medical's effect whichever department was meant.
  const shared = marsKernel();
  const { ambiguous, unmatched, lines } = step(shared, reply({
    selectedEffectIds: ['effect_1'],
    selectedPolicies: ['effect_2 (capacity_expansion)'],
  }), ariaTurn1());
  assert.equal(shared.getState().metrics.morale, 0.85, 'neither department\'s effect_1 or effect_2 moved morale');
  assert.deepEqual(unmatched, []);
  assert.deepEqual(ambiguous, ['effect_1', 'effect_2 (capacity_expansion)']);
  assert.ok(lines.some(l => l.includes('more than one effect named by') && l.includes('"effect_1"')), lines.join('\n'));

  // effect_3 is medical's alone.
  const only = marsKernel();
  step(only, reply({ selectedEffectIds: ['effect_3'] }), ariaTurn1());
  near(only.getState().metrics.morale, 0.84, 'effect_3');
});

test('a selected effect key the run does not hold is reported and dropped, and the held keys still move', () => {
  // Aria Chen's turn 2 in the Mars Genesis pair of 6 November 2026
  // (seed 950): engineering effect_3 and agriculture effect_1 named keys
  // the run holds in neither its metrics nor its politics, and the run
  // log printed only `[policy] effects: {"morale":0.01}`.
  const reports = [
    report('engineering', [
      { id: 'effect_1', type: 'risk_mitigation', description: 'Stage a controlled perchlorate flush.', systemDelta: { morale: 0.02 } },
      { id: 'effect_3', type: 'resource_shift', description: 'Shift power to the filter train.', systemDelta: { power: -0.05, water: 0.03 } },
    ]),
    report('agriculture', [
      { id: 'effect_1', type: 'risk_mitigation', description: 'Second water loop for the grow beds.', systemDelta: { waterReliability: 0.08, power: -0.03 } },
    ]),
  ];
  const kernel = marsKernel();
  const before = kernel.getState().metrics;
  const { lines, ...applied } = step(kernel, reply({
    selectedPolicies: ['engineering/effect_1', 'engineering/effect_3', 'agriculture/effect_1'],
  }), reports);
  near(kernel.getState().metrics.morale, 0.87, 'engineering/effect_1 still moves morale');
  assert.equal(kernel.getState().metrics.powerKw, before.powerKw, 'powerKw is not "power"');
  const dropped = lines.find(l => l.includes('[policy] effect keys not held, dropped:'));
  assert.ok(dropped, `the log names the keys that moved nothing:\n${lines.join('\n')}`);
  assert.match(dropped, /dropped: power, water, waterReliability\b/);
  assert.match(dropped, /infrastructureModules/, 'the line names the keys the run holds');
  assert.deepEqual((applied as Record<string, unknown>).notHeld, ['power', 'water', 'waterReliability']);
});

test('a decision whose effects name only held keys logs no drop', () => {
  const kernel = marsKernel();
  const { lines, ...applied } = step(kernel, reply({ selectedPolicies: ['medical/effect_1'] }), ariaTurn1());
  assert.ok(!lines.some(l => l.includes('not held')), lines.join('\n'));
  assert.deepEqual((applied as Record<string, unknown>).notHeld ?? [], []);
});

/**
 * Aria Chen's turn 1 medical report in the live Mars Genesis pair of 8
 * November 2026 (seed 950, Year 2035), as its saved turn artifact holds
 * it: its `proposedPatches` are policy notes in words, as every patch of
 * that pair's reports was.
 */
const ariaMedical8Nov = (): DepartmentReport => ({
  ...emptyReport('medical'),
  summary: 'For first landfall, an Arcadia Planitia-like ice-rich plain is the healthiest and safest option for the first permanent settlement.',
  risks: [{ severity: 'high', description: 'Mars surface radiation remains a chronic hazard; without robust shielding, cancer risk and cumulative dose will grow over time.' }],
  proposedPatches: {
    siteSelectionPolicy: 'Default first settlement landing to the lowest-slope confirmed ice-access site available unless radiation shielding is demonstrably worse than alternatives.',
    medicalPolicy: 'Require storm-shelter access within minutes for all habitation modules and prioritize regolith shielding before expanding science footprint.',
  },
  recommendedEffects: [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Land on an ice-rich plain site and immediately allocate construction to shielding and storm-shelter readiness.', systemDelta: { powerKw: 0, foodMonthsReserve: 0, lifeSupportCapacity: 0 }, politicsDelta: { earthDependencyPct: 0 } },
    { id: 'effect_2', type: 'capacity_expansion', description: 'Use the flatter site to accelerate habitat deployment and reduce early construction delays.', systemDelta: { pressurizedVolumeM3: 300, lifeSupportCapacity: 20, infrastructureModules: 1 }, politicsDelta: { earthDependencyPct: 0 } },
    { id: 'effect_3', type: 'social_investment', description: 'Preserve morale by avoiding a high-risk terrain choice for the first settlement and by visibly prioritizing crew safety.', systemDelta: { morale: 0.05 }, politicsDelta: { independencePressure: 0.02 } },
  ],
} as unknown as DepartmentReport);

test('a department\'s patch moves nothing, whether or not the commander picks from its report, and the log says what it asked', () => {
  // The report schema takes `proposedPatches` as any record. The policy
  // step wrote a patch's metrics outright from every report, outside the
  // bound of one decision: 13 modules from 3, morale to its ceiling.
  const kernel = mars950();
  const before = kernel.getState();
  assert.equal(before.metrics.infrastructureModules, 3);
  assert.equal(before.metrics.morale, 0.85);
  const person = before.agents[0];
  const psychBefore = person.health.psychScore;
  const reports = [
    ariaMedical8Nov(),
    { ...emptyReport('engineering'), summary: 'Build out.', proposedPatches: { metrics: { infrastructureModules: 13 }, politics: { earthDependencyPct: 0 } } } as unknown as DepartmentReport,
    { ...emptyReport('psychology'), summary: 'Hold the crew together.', proposedPatches: { metrics: { morale: 1 }, agentUpdates: [{ agentId: person.core.id, health: { psychScore: 0 } }] } } as unknown as DepartmentReport,
  ];
  const { deltas, lines } = step(kernel, reply({ selectedPolicies: ['medical/effect_3'] }), reports);

  const after = kernel.getState();
  assert.equal(after.metrics.infrastructureModules, 3, 'no selected effect names the modules');
  near(after.metrics.morale, 0.9, 'morale moves by medical/effect_3 alone');
  assert.equal(after.politics.earthDependencyPct, before.politics.earthDependencyPct);
  assert.equal(after.agents.find(a => a.core.id === person.core.id)!.health.psychScore, psychBefore);
  assert.equal(deltas.infrastructureModules, undefined, 'the policy step reports no change to the modules');

  const patchLine = lines.find(l => l.includes('[policy] department patches'));
  assert.ok(patchLine, `the log names the patches that moved nothing:\n${lines.join('\n')}`);
  assert.match(patchLine, /engineering asked \{"metrics":\{"infrastructureModules":13\},"politics":\{"earthDependencyPct":0\}\}/);
  assert.match(patchLine, /psychology asked \{"metrics":\{"morale":1\},"agentUpdates":/);
  assert.doesNotMatch(patchLine, /siteSelectionPolicy|medical asked/, 'a note in words is not a patch of the state');
});

test('a report whose patch holds only notes in words logs no patch line', () => {
  const kernel = mars950();
  const { lines } = step(kernel, reply({ selectedPolicies: ['medical/effect_3'] }), [ariaMedical8Nov()]);
  assert.ok(!lines.some(l => l.includes('[policy] department patches')), lines.join('\n'));
  near(kernel.getState().metrics.morale, 0.9, 'morale');
});

test('a department name a model wrote with a line break stays on the one patch line', () => {
  // The report schema takes any nonempty department string, and the policy
  // step logs it on the run's stdout. A raw line break in it would print a
  // second line that reads as the policy step's own.
  const kernel = mars950();
  const forged = 'engineering\n  [policy] effects: {"infrastructureModules":2}';
  const { lines } = step(kernel, reply({ selectedPolicies: ['medical/effect_3'] }), [
    ariaMedical8Nov(),
    { ...emptyReport('engineering'), department: forged, summary: 'Build out.', proposedPatches: { metrics: { infrastructureModules: 13 } } } as unknown as DepartmentReport,
  ]);
  const patchLine = lines.find(l => l.includes('[policy] department patches'));
  assert.ok(patchLine, lines.join('\n'));
  assert.ok(!/[\r\n]/.test(patchLine), `one line: ${JSON.stringify(patchLine)}`);
  assert.ok(patchLine.includes('engineering\\n  [policy] effects: {\\"infrastructureModules\\":2} asked {"metrics":{"infrastructureModules":13}}'), patchLine);
  assert.equal(kernel.getState().metrics.infrastructureModules, 3);
});
