/**
 * A compiled politics hook cannot raise a declared score's per-decision
 * limit in a scenario that declares no politics keys.
 *
 * The turn loop bounds what one decision's adopted effects move by the
 * largest entry each key has in the category tables or in the politics
 * table, and it reads the politics table by calling the politics hook for
 * every category and outcome (`policyEffectLimits`). Any key the hook
 * returns raises that key's limit, whatever the key. At an outcome, the
 * kernel drops a politics key the run does not hold, so in a world with no
 * politics the hook's numbers act through the limit alone. A hook that
 * returns `{ 'soil-health': 100 }` would let one decision move a score that
 * starts at 50 by 100.
 *
 * Each case compiles real scenario JSON through `compileScenario` with a
 * stand-in model that answers the politics prompt with the hook under test
 * on every attempt and every other prompt with text that is not a hook, and
 * reads the compiled package, the compile's telemetry and the limits the
 * turn loop builds from the package (`src/runtime/orchestrator/index.ts`,
 * the `policyTables` of a run).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import { writeCache } from '../../../src/engine/compiler/cache.js';
import { createCompilerTelemetry } from '../../../src/engine/compiler/telemetry.js';
import type { GenerateTextFn } from '../../../src/engine/compiler/types.js';
import { EffectRegistry } from '../../../src/engine/registries/effects.js';
import { policyEffectLimits, policyEffectTablesFor } from '../../../src/runtime/orchestrator/commander-policy.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const marsJson = JSON.parse(readFileSync(resolve(__dirname, '../../../scenarios/mars.json'), 'utf-8'));

const OUTCOMES = ['risky_success', 'risky_failure', 'conservative_success', 'conservative_failure'];
const NO_POLITICS_REASON = 'This scenario declares no politics keys; the hook must return null';

/** The category tables of the farm, the same in either form of `effects`. */
const FARM_TABLES = {
  infrastructure: { harvest: 5, 'soil-health': 2.5 },
  resource: { harvest: 5, 'soil-health': 2.5 },
  psychological: { harvest: 5, 'soil-health': 2.5, morale: 0.05 },
};

/** The limits the farm's tables give, with no politics table above them. */
const FARM_TABLE_LIMITS = { harvest: 5, 'soil-health': 2.5, morale: 0.05 };

/** A scenario that declares two scores and no politics keys, with `effects` in the given form. */
function farmScenario(effectsForm: 'object' | 'array'): Record<string, unknown> {
  return {
    id: 'politics-hook-farm',
    version: '1.0.0',
    labels: { name: 'Hill Farm', shortName: 'farm', populationNoun: 'farmers', settlementNoun: 'farm', currency: 'credits' },
    departments: [{ id: 'agronomy', label: 'Agronomy', role: 'Agronomist', icon: '', defaultModel: 'test', instructions: 'Read the soil.' }],
    world: {
      metrics: {
        harvest: { id: 'harvest', label: 'Harvest', unit: '', type: 'number', initial: 100, min: 0, category: 'metric' },
        'soil-health': { id: 'soil-health', label: 'Soil health', unit: '%', type: 'number', initial: 50, min: 0, max: 100, category: 'metric' },
      },
      capacities: {},
      statuses: {},
      politics: {},
      environment: {},
    },
    effects: effectsForm === 'object'
      ? FARM_TABLES
      : [{ id: 'category_effects', type: 'category_outcome', label: 'Category Outcome Effects', categoryDefaults: FARM_TABLES }],
  };
}

/** A model that answers the politics prompt with `politicsSource` on every attempt, and anything else with text that is not a hook. */
function standInModel(politicsSource: string): GenerateTextFn {
  const generateText = async (args: { system?: Array<{ text: string }>; prompt: string }): Promise<string> => {
    const system = (args.system ?? []).map(block => block.text).join('\n');
    return system.includes('You are generating a politics hook') ? politicsSource : 'not a hook';
  };
  return generateText as unknown as GenerateTextFn;
}

async function compileWithPoliticsHook(scenarioJson: Record<string, unknown>, politicsSource: string) {
  const telemetry = createCompilerTelemetry();
  const pkg = await compileScenario(scenarioJson, {
    cache: false,
    generateText: standInModel(politicsSource),
    telemetry,
  }) as ScenarioPackage;
  const snapshot = telemetry.snapshot();
  return {
    pkg,
    politics: snapshot.schemaRetries['compile:politics'],
    politicsFallback: snapshot.fallbacks.find(f => f.hookName === 'politics'),
  };
}

/** The per-decision limits a run of `pkg` reads, from the tables the turn loop builds (`policyEffectTablesFor`). */
function runLimits(pkg: ScenarioPackage): Readonly<Record<string, number>> {
  return policyEffectLimits(policyEffectTablesFor(pkg, EffectRegistry.forScenario(pkg)));
}

test('a politics hook that names a score is refused where the scenario declares no politics keys, and the score keeps its table limit', async () => {
  const hook = "(category, outcome) => (outcome.startsWith('risky') ? { 'soil-health': 100, morale: 5 } : null)";
  const { pkg, politics, politicsFallback } = await compileWithPoliticsHook(farmScenario('object'), hook);

  assert.deepEqual(
    politics,
    { calls: 1, attempts: 3, fallbacks: 1 },
    `compile:politics read ${JSON.stringify(politics)}: the hook must be retried twice and end as the fallback`,
  );
  assert.equal(
    politicsFallback?.reason,
    NO_POLITICS_REASON,
    `the politics fallback's reason read ${JSON.stringify(politicsFallback?.reason)}`,
  );
  for (const category of ['political', ...Object.keys(FARM_TABLES)]) {
    for (const outcome of OUTCOMES) {
      const entry = pkg.hooks.politicsHook!(category, outcome);
      assert.equal(entry, null, `the compiled politics hook returned ${JSON.stringify(entry)} for ${category} ${outcome}`);
    }
  }
  const limits = runLimits(pkg);
  assert.deepEqual(
    { ...limits },
    FARM_TABLE_LIMITS,
    `a run's per-decision limits read ${JSON.stringify(limits)}: soil-health must stay at its table's 2.5 and morale at 0.05`,
  );
});

test('the check reads the categories of a saved compile, whose effects are in the array form', async () => {
  const hook = "(category, outcome) => (category === 'resource' ? { 'soil-health': 40 } : null)";
  const { pkg, politics, politicsFallback } = await compileWithPoliticsHook(farmScenario('array'), hook);

  assert.deepEqual(
    politics,
    { calls: 1, attempts: 3, fallbacks: 1 },
    `compile:politics read ${JSON.stringify(politics)}: a hook that names a key for resource alone must end as the fallback`,
  );
  assert.equal(
    politicsFallback?.reason,
    NO_POLITICS_REASON,
    `the politics fallback's reason read ${JSON.stringify(politicsFallback?.reason)}`,
  );
  for (const outcome of OUTCOMES) {
    const entry = pkg.hooks.politicsHook!('resource', outcome);
    assert.equal(entry, null, `the compiled politics hook returned ${JSON.stringify(entry)} for resource ${outcome}`);
  }
  const limits = runLimits(pkg);
  assert.deepEqual(
    { ...limits },
    FARM_TABLE_LIMITS,
    `a run's per-decision limits read ${JSON.stringify(limits)}: soil-health must stay at its table's 2.5`,
  );
});

test('a politics hook that names no key is kept on its first attempt where the scenario declares no politics keys', async () => {
  for (const hook of ['(category, outcome) => null', '(category, outcome) => ({})']) {
    const { politics, politicsFallback } = await compileWithPoliticsHook(farmScenario('object'), hook);
    assert.deepEqual(
      politics,
      { calls: 1, attempts: 1, fallbacks: 0 },
      `compile:politics read ${JSON.stringify(politics)} for the hook ${hook}`,
    );
    assert.equal(politicsFallback, undefined, `the hook ${hook} fell back: ${JSON.stringify(politicsFallback?.reason)}`);
  }
});

test('a scenario that declares politics keys is checked as before: Mars Genesis keeps a hook that moves its Earth dependency', async () => {
  assert.ok(
    Object.keys(marsJson.world?.politics ?? {}).includes('earthDependencyPct'),
    `scenarios/mars.json declares the politics keys ${JSON.stringify(Object.keys(marsJson.world?.politics ?? {}))}`,
  );
  const hook = "(category, outcome) => (category === 'political' ? { earthDependencyPct: 2 } : null)";
  const { pkg, politics, politicsFallback } = await compileWithPoliticsHook(marsJson, hook);

  assert.deepEqual(
    politics,
    { calls: 1, attempts: 1, fallbacks: 0 },
    `compile:politics read ${JSON.stringify(politics)}: a scenario with politics keys must keep the hook on its first attempt`,
  );
  assert.equal(politicsFallback, undefined, `the hook fell back: ${JSON.stringify(politicsFallback?.reason)}`);
  assert.deepEqual(
    pkg.hooks.politicsHook!('political', 'risky_success'),
    { earthDependencyPct: 2 },
    'the compiled hook must be the one the model wrote',
  );
});

/** The seed extraction a stand-in model returns: two crisis categories the farm's `effects` do not name. */
const ORCHARD_EXTRACTION = JSON.parse(
  readFileSync(resolve(__dirname, '../../fixtures/compiler/extraction-orchard.json'), 'utf-8'),
) as { crisisCategories: string[] };

test('a category the seed adds after the hooks are generated cannot raise a limit where the scenario declares no politics keys', async () => {
  // The compiler generates the hooks from the draft, then merges the seed's
  // knowledge, whose crisis categories become `knowledge.categoryMapping`
  // keys. The turn loop reads the politics hook for those categories too,
  // so a hook that names a key for `Late frost` alone passes the smoke test.
  const lateFrost = 'Late frost';
  assert.equal(ORCHARD_EXTRACTION.crisisCategories[0], lateFrost, 'the extraction fixture\'s first crisis category');
  const hook = "(category, outcome) => (category === 'Late frost' ? { 'soil-health': 100, morale: 5 } : null)";
  const generateText = async (args: string | { system?: Array<{ text: string }>; prompt: string }): Promise<string> => {
    if (typeof args === 'string') {
      return args.includes('You are analyzing a document to extract domain knowledge') ? JSON.stringify(ORCHARD_EXTRACTION) : '{}';
    }
    const system = (args.system ?? []).map(block => block.text).join('\n');
    return system.includes('You are generating a politics hook') ? hook : 'not a hook';
  };
  const pkg = await compileScenario(farmScenario('object'), {
    cache: false,
    generateText: generateText as unknown as GenerateTextFn,
    seedText: 'A family orchard on a hillside grows apples through four seasons a year.',
    webSearch: false,
    telemetry: createCompilerTelemetry(),
  }) as ScenarioPackage;

  assert.ok(
    Object.keys(pkg.knowledge.categoryMapping).includes(lateFrost),
    `the compiled knowledge maps the categories ${JSON.stringify(Object.keys(pkg.knowledge.categoryMapping))}`,
  );
  const limits = runLimits(pkg);
  assert.deepEqual(
    { ...limits },
    FARM_TABLE_LIMITS,
    `a run's per-decision limits read ${JSON.stringify(limits)}: soil-health must stay at its table's 2.5 and morale at 0.05`,
  );
});

test('a politics hook restored from the hook cache cannot raise a limit where the scenario declares no politics keys', async () => {
  // A hook cached before the compiler checked politics hooks this way is
  // restored without its smoke test (the cache key holds the scenario JSON
  // and the compile schema version, neither of which changed).
  const cacheDir = mkdtempSync(join(tmpdir(), 'paracosm-politics-cache-'));
  try {
    const scenarioJson = farmScenario('object');
    const model = 'stand-in-model';
    writeCache(scenarioJson, 'politics', "(category, outcome) => (outcome.startsWith('risky') ? { 'soil-health': 100, morale: 5 } : null)", model, cacheDir);
    const pkg = await compileScenario(scenarioJson, {
      cache: true,
      cacheDir,
      model,
      generateText: standInModel('(category, outcome) => null'),
      telemetry: createCompilerTelemetry(),
    }) as ScenarioPackage;

    assert.deepEqual(
      pkg.hooks.politicsHook!('resource', 'risky_success'),
      { 'soil-health': 100, morale: 5 },
      'the compile must restore the cached politics hook',
    );
    const limits = runLimits(pkg);
    assert.deepEqual(
      { ...limits },
      FARM_TABLE_LIMITS,
      `a run's per-decision limits read ${JSON.stringify(limits)}: soil-health must stay at its table's 2.5 and morale at 0.05`,
    );
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
