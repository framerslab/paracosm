/**
 * A failed response keeps a harmful effect harmful.
 *
 * The category tables list what an event brings at an ordinary response.
 * Some entries are gains (Atlas Lab's `alignment` raises alignmentBench),
 * and some are what the event costs (its `safety_breach` lowers
 * alignmentBench and raises the spec-gaming rate). The registry used to
 * multiply every entry by the outcome's multiplier, which turns negative on
 * a failure, so a failed safety_breach response raised alignmentBench: the
 * live Atlas Lab pair of 2 November 2026 logged
 * `conservative_failure (safety_breach) effects: {"alignmentBench":0.03, ...}`
 * and the pair of 3 November reproduced it. These tests run the registry the
 * orchestrator builds from the scenarios in scenarios/, and the outcome step
 * it runs, with no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { EffectRegistry, type OutcomeModifiers, type TurnOutcome } from '../../src/engine/registries/effects.js';
import { marsScenario, lunarScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { applyOutcomeEffects } from '../../src/runtime/orchestrator/outcome-effects.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioDir = resolve(here, '../../scenarios');
const catalog = loadDiskCustomScenarios(scenarioDir);
const scenario = (id: string) => {
  const sc = catalog.get(id)?.scenario as ScenarioPackage | undefined;
  assert.ok(sc, `scenarios/ holds ${id}`);
  return sc;
};
const atlasLab = scenario('atlas-lab');
const council = scenario('dual-superintelligence-council');
const corporate = scenario('corporate-quarterly');
const submarine = scenario('deep-ocean-station');
/**
 * The care scenario ships in the draft shape, its `effects` the category
 * table itself; the server compiles it, and the compiler wraps that table as
 * the first effect's `categoryDefaults` (src/engine/compiler/index.ts). The
 * same wrap here, with its metrics as the file declares them.
 */
const glp1Draft = JSON.parse(readFileSync(resolve(scenarioDir, 't2d-glp1-protocol.json'), 'utf8')) as Record<string, unknown>;
const glp1 = {
  ...glp1Draft,
  effects: [{ id: 'category_effects', type: 'category_outcome', label: 'Category Outcome Effects', categoryDefaults: glp1Draft.effects }],
} as unknown as ScenarioPackage;

const PLAIN: OutcomeModifiers = { personalityBonus: 0, noise: 0 };
/** The modifiers that gave the live failure its +0.03 on alignmentBench (-0.04 times -0.75). */
const LIVE: OutcomeModifiers = { personalityBonus: 0.25, noise: 0 };
const OUTCOMES: TurnOutcome[] = ['risky_success', 'conservative_success', 'conservative_failure', 'risky_failure'];

const across = (registry: EffectRegistry, category: string, key: string, modifiers = PLAIN) =>
  OUTCOMES.map(outcome => registry.applyOutcome(category, outcome, modifiers)[key]);

test('a failed safety_breach response lowers alignmentBench, as the live run should have', () => {
  const registry = EffectRegistry.forScenario(atlasLab);
  const failed = registry.applyOutcome('safety_breach', 'conservative_failure', LIVE);
  // The breach costs -0.04 at an ordinary response; the failure costs 2.75 times that.
  assert.equal(failed.alignmentBench, -0.11);
  assert.equal(failed.specGamingRate, 0.03);
  assert.equal(failed.releaseReadiness, -0.22);

  const kernel = new SimulationKernel(atlasLab.setup.defaultSeed ?? 11, 'Marcus Reinhardt', [], {
    startTime: 1, initialPopulation: 30, scenario: atlasLab,
  });
  const before = kernel.getState().metrics;
  const { systemDeltas } = applyOutcomeEffects(kernel, registry, {
    category: 'safety_breach', outcome: 'conservative_failure', modifiers: LIVE, turn: 6, time: 6,
    politicsHook: atlasLab.hooks.politicsHook,
  });
  const after = kernel.getState().metrics;
  assert.equal(systemDeltas.alignmentBench, -0.11);
  assert.ok(Math.abs(after.alignmentBench - (before.alignmentBench - 0.11)) < 1e-9, `alignmentBench ${before.alignmentBench} -> ${after.alignmentBench}`);
  assert.ok(after.specGamingRate > before.specGamingRate, 'the spec-gaming rate rises');
});

test('what each outcome does to a helpful and to a harmful entry', () => {
  const registry = EffectRegistry.forScenario(atlasLab);
  // A gain (alignment: alignmentBench +0.02) scales by the outcome: 2.5, 1, -1, -2.
  assert.deepEqual(across(registry, 'alignment', 'alignmentBench'), [0.05, 0.02, -0.02, -0.04]);
  // A cost (safety_breach: alignmentBench -0.04, spec gaming +0.012, a lower-is-better
  // rate) shrinks as the response goes better and grows as it goes worse: 0, 1, 3, 4.
  assert.deepEqual(across(registry, 'safety_breach', 'alignmentBench'), [0, -0.04, -0.12, -0.16]);
  assert.deepEqual(across(registry, 'safety_breach', 'specGamingRate'), [0, 0.01, 0.04, 0.05]);
  // Atlas Lab's financial event: the runway it costs grows on a failure, and the burn
  // cut (a gain, burnRate is lower-is-better) is lost on one.
  assert.deepEqual(across(registry, 'financial', 'runwayMonths'), [0, -1, -3, -4]);
  assert.deepEqual(across(registry, 'financial', 'burnRate'), [-375000, -150000, 150000, 300000]);
  // The people a talent event brings carry their payroll: the burn follows the head count.
  assert.deepEqual(across(registry, 'talent', 'population'), [20, 8, -8, -16]);
  assert.deepEqual(across(registry, 'talent', 'burnRate'), [500000, 200000, -200000, -400000]);
});

test('no harmful entry of any scenario turns helpful when the response fails', () => {
  const lower = (sc: ScenarioPackage) => new Set((sc.metrics ?? []).filter(m => m.better === 'lower').map(m => (m.source || m.id).split('.').pop()));
  for (const sc of [atlasLab, council, corporate, submarine, glp1, marsScenario, lunarScenario]) {
    const registry = EffectRegistry.forScenario(sc);
    const lowerIsBetter = lower(sc);
    for (const [category, table] of Object.entries(sc.effects[0]?.categoryDefaults ?? {})) {
      if ((table.population ?? 0) > 0) continue; // the payroll of the people it adds follows them
      for (const [key, value] of Object.entries(table)) {
        const harmful = lowerIsBetter.has(key) ? value > 0 : value < 0;
        if (!harmful) continue;
        for (const outcome of ['conservative_failure', 'risky_failure'] as TurnOutcome[]) {
          for (const modifiers of [PLAIN, LIVE, { personalityBonus: -0.2, noise: 0.1 }]) {
            const moved = registry.applyOutcome(category, outcome, modifiers)[key];
            const success = registry.applyOutcome(category, 'conservative_success', modifiers)[key];
            const label = `${sc.id} ${category} ${key} ${outcome} ${JSON.stringify(modifiers)}: ${moved}`;
            assert.ok(Math.sign(moved) === Math.sign(value) || moved === 0, label);
            assert.ok(Math.abs(moved) >= Math.abs(success), `${label} against a success's ${success}`);
          }
        }
      }
    }
  }
});

test('the corporate, council and care scenarios\' costs stay costs', () => {
  const failed = (sc: ScenarioPackage, category: string) => EffectRegistry.forScenario(sc).applyOutcome(category, 'conservative_failure', PLAIN);
  assert.deepEqual(failed(corporate, 'competitive'), { marketShare: -0.06, morale: -0.15, revenueArr: -600000 });
  assert.equal(failed(council, 'safety_breach').alignmentScore, -0.15);
  assert.equal(failed(council, 'safety_breach').deploymentRisk, 0.3);
  // A compact under pressure costs cohesion whatever the response; the risk it cuts is lost on a failure.
  assert.equal(failed(council, 'compact_pressure').councilCohesion, -15);
  assert.equal(failed(council, 'compact_pressure').deploymentRisk, 0.05);
  assert.deepEqual(failed(glp1, 'cardio_event'), { mortalityRisk: 0.09, qualityOfLife: -0.18, cardioFitness: -0.12 });
  assert.deepEqual(failed(glp1, 'side_effect'), { sideEffectBurden: 0.18, qualityOfLife: -0.12, exerciseAdherence: -0.15 });
  // Mars lists only gains, so a Mars run moves as it did.
  assert.deepEqual(failed(marsScenario, 'resource'), { foodMonthsReserve: -4, waterLitersPerDay: -100, morale: -0.05 });
});
