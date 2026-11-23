/**
 * The innovation bonus counts the run's tools, and a forge the reviewers
 * rejected is none.
 *
 * The outcome step adds `log(1 + totalToolsForRun) * 0.03` to the effect of
 * every outcome. These tests hold the run's ledger and forge attempts as the
 * department step records them, hand them to the function the orchestrator
 * builds an event's tool modifiers with, and apply the outcome with the
 * registry the orchestrator builds from Atlas Lab's scenario in scenarios/.
 * No model call: runSimulation has no seam for one, and the ledger and the
 * forge attempts are all the modifiers read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EffectRegistry } from '../../src/engine/registries/effects.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { eventToolModifiers, forgedToolNames, type ForgedLedger, type ForgeCaptureForToolbox } from '../../src/runtime/orchestrator/tool-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const atlasLab = loadDiskCustomScenarios(resolve(here, '../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage | undefined;
assert.ok(atlasLab, 'scenarios/ holds atlas-lab');
const registry = EffectRegistry.forScenario(atlasLab);

/** A turn-1 forge of `risk_score` by governance, as the department step records it. */
function turnOneForge(approved: boolean): { ledger: ForgedLedger; allForges: ForgeCaptureForToolbox[] } {
  const ledger: ForgedLedger = new Map([[
    'risk_score',
    {
      firstForgedTurn: 1,
      firstForgedDepartment: 'governance',
      firstForgedEventIndex: 0,
      firstForgedEventTitle: 'Refusal regression',
      history: [{ turn: 1, time: 1, eventIndex: 0, eventTitle: 'Refusal regression', department: 'governance', output: null, isReforge: true, rejected: !approved, confidence: approved ? 0.9 : 0.3 }],
    },
  ]]);
  const allForges = [{ name: 'risk_score', description: 'Scores a release risk', mode: 'sandbox', approved, confidence: approved ? 0.9 : 0.3 }];
  return { ledger, allForges };
}

test('a run whose only forge was rejected gets no innovation bonus on a later outcome', () => {
  const { ledger, allForges } = turnOneForge(false);
  assert.equal(forgedToolNames(ledger, allForges).length, 0, 'the run has no tool');

  // Turn 1: the rejected forge is the event's failed forge.
  assert.deepEqual(eventToolModifiers(allForges, ledger, allForges, 1), {
    newToolsThisEvent: 0, reuseCountThisEvent: 0, forgeFailures: 1, totalToolsForRun: 0,
  });

  // Turn 2: no department forges, and the outcome is the one a run that
  // never forged gets.
  const turnTwo = eventToolModifiers([], ledger, allForges, 2);
  assert.equal(turnTwo.totalToolsForRun, 0);
  const plain = { personalityBonus: 0, noise: 0 };
  const neverForged = registry.applyOutcome('press', 'conservative_success', { ...plain, toolModifiers: { newToolsThisEvent: 0, reuseCountThisEvent: 0, forgeFailures: 0, totalToolsForRun: 0 } });
  assert.deepEqual(registry.applyOutcome('press', 'conservative_success', { ...plain, toolModifiers: turnTwo }), neverForged);
  assert.deepEqual(registry.applyOutcome('talent', 'risky_success', { ...plain, toolModifiers: turnTwo }), registry.applyOutcome('talent', 'risky_success', plain));
});

test('the innovation bonus counts each approved tool once, as the stream and the verdict do', () => {
  const { ledger, allForges } = turnOneForge(true);
  // A second tool, rejected on its only forge in turn 2.
  ledger.set('burn_projection', {
    firstForgedTurn: 2,
    firstForgedDepartment: 'finance',
    firstForgedEventIndex: 0,
    firstForgedEventTitle: 'Bridge round',
    history: [{ turn: 2, time: 2, eventIndex: 0, eventTitle: 'Bridge round', department: 'finance', output: null, isReforge: true, rejected: true, confidence: 0.2 }],
  });
  allForges.push({ name: 'burn_projection', description: 'Projects the burn', mode: 'sandbox', approved: false, confidence: 0.2 });
  // risk_score is cited by two departments in turn 2, without a forge.
  for (const department of ['governance', 'alignment_research']) {
    ledger.get('risk_score')!.history.push({ turn: 2, time: 2, eventIndex: 0, eventTitle: 'Bridge round', department, output: '{"risk":0.4}', isReforge: false, rejected: false, confidence: 0.9 });
  }

  const modifiers = eventToolModifiers([allForges[1]], ledger, allForges, 2);
  assert.equal(modifiers.forgeFailures, 1);
  assert.equal(modifiers.totalToolsForRun, 1);
  assert.equal(modifiers.totalToolsForRun, forgedToolNames(ledger, allForges).length);
});
