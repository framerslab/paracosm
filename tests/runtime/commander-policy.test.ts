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
import { CommanderDecisionSchema } from '../../src/runtime/validators/commander.js';
import { buildCommanderBootstrap, buildCommanderTurnPrompt, buildEffectsBlock } from '../../src/runtime/orchestrator/commander-setup.js';
import { applyCommanderPolicy } from '../../src/runtime/orchestrator/commander-policy.js';
import { emptyReport } from '../../src/runtime/util/parsers.js';
import type { CommanderDecision, DepartmentReport } from '../../src/runtime/contracts.js';

const here = dirname(fileURLToPath(import.meta.url));
const atlasLab = loadDiskCustomScenarios(resolve(here, '../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage;

type Effect = { id: string; type: string; description: string; systemDelta: Record<string, number> };

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

function near(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

function step(kernel: SimulationKernel, decision: CommanderDecision, reports: DepartmentReport[]) {
  const lines: string[] = [];
  const applied = applyCommanderPolicy(kernel, decision, reports, 1, kernel.getState().metadata.currentTime, l => lines.push(l));
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
  // 0.03 + 0.02 - 0.01 from medical, 0.03 + 0.01 from engineering.
  near(kernel.getState().metrics.morale, 0.93, 'morale');
  near(deltas.morale, 0.08, 'reported change');
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
  // Dietrich Voss: 0.03 + 0.02 + 0.04 + 0.02.
  near(kernel.getState().metrics.morale, 0.96, 'Voss morale');
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
  }), marcusTurn2());
  near(lab.getState().metrics.morale, before + 0.01, 'Marcus morale');
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
  step(ids, reply({ selectedEffectIds: ['effect_2'] }), ariaTurn1());
  near(ids.getState().metrics.morale, 0.87, 'a bare id reads the first report that holds it');

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
