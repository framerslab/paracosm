/**
 * The seed compile, `compileFromSeed`, end to end on a stub model, for the
 * drafts a model returned to the cookbook runs and for the two orchard
 * drafts written by hand: the bare one, and the one that gives each metric
 * its start and range and lists three category tables.
 *
 * The stub (tests/engine/compiler/helpers/stub-model-compile.ts) answers
 * the draft call with a draft from tests/fixtures/compiler/, the seed
 * extraction with extraction-orchard.json, and each code hook with a
 * working function. AgentOS builds every request and checks the draft
 * reply against the draft schema; the compiler runs every stage. No
 * network is reached and nothing is paid.
 *
 * These hold what a compile keeps and what its scenario declares: the
 * draft's ids in order, the extraction's topics, research for the last
 * category the knowledge bundle maps, one draft call and one extraction,
 * and seven hooks; a world that holds every score the draft declares, so a
 * kernel built from the scenario holds each as a number; three category
 * tables or more, with the knowledge bundle's categories the tables' keys
 * and every topic under each; the first four declared scores in the
 * header; the fingerprint and department prompt hooks kept on their first
 * attempt; and nothing for `validateSeedWorld` to report. The death dice
 * and the supply marks are left to the tests of the change that makes
 * them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import { EffectRegistry } from '../../../src/engine/registries/effects.js';
import { validateSeedWorld } from '../../../src/engine/compiler/validate.js';
import { scenarioKeyPersonnel } from '../../../src/cli/sim-config.js';
import { getResearchFromBundle } from '../../../src/runtime/research/scenario-research.js';
import {
  compileSeedOnStub,
  isDraftRequest,
  isExtractionRequest,
  loadCompilerFixture,
} from './helpers/stub-model-compile.js';
import { describeExchanges, isServedPath } from '../../runtime/helpers/stub-openai-transport.js';

interface Draft {
  id: string;
  labels: { name: string };
  setup: { defaultTurns: number; defaultPopulation: number; defaultStartTime: number };
  departments: Array<{ id: string }>;
  metrics: Array<{ id: string; format?: string; initial?: number }>;
  effects?: Array<{ category: string; entries: Array<{ metric: string; change: number }> }>;
}

const HOOKS = [
  'progressionHook',
  'directorInstructions',
  'departmentPromptHook',
  'getMilestoneEvent',
  'fingerprintHook',
  'politicsHook',
  'reactionContextHook',
] as const;

const DRAFTS: Array<[file: string, label: string]> = [
  ['draft-orchard-bare.json', 'the bare orchard draft (written by hand)'],
  ['draft-orchard-with-tables.json', 'the orchard draft with starts and tables (written by hand)'],
  ['recorded-draft-ai-lab.json', 'the AI lab draft a model returned to the cookbook'],
  ['recorded-draft-generation-ship.json', 'the generation ship draft a model returned to the cookbook'],
  ['recorded-draft-pandemic-governor.json', 'the pandemic governor draft a model returned to the cookbook'],
  ['recorded-draft-game-studio.json', 'the game studio draft a model returned to the cookbook'],
];

const extraction = loadCompilerFixture('extraction-orchard.json') as { topics: string[] };

/** A leader with every trait at one half, for the fingerprint hook's third argument. */
const LEADER = {
  name: 'Rowan Hale',
  archetype: 'The Steward',
  unit: 'Orchard One',
  hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
  instructions: 'Lead the settlement through each turn and choose one option for every event.',
};

for (const [file, label] of DRAFTS) {
  test(`${label} compiles through compileFromSeed on a stub model, keeping its ids and the extraction's research and holding the scores it declares`, async (t) => {
    const draft = loadCompilerFixture(file) as Draft;
    const { scenario, telemetry, seen } = await compileSeedOnStub({ draft, hooks: 'working' });
    const requests = `\nThe stub model's requests:\n${describeExchanges(seen)}`;

    assert.equal(scenario.id, draft.id, `the scenario's id is the draft's (read ${scenario.id})`);
    assert.equal(scenario.labels?.name, draft.labels.name, `the scenario's name is the draft's (read ${scenario.labels?.name})`);
    assert.deepEqual(
      (scenario.departments ?? []).map(d => d.id),
      draft.departments.map(d => d.id),
      'the department ids, in order, are the draft\'s',
    );
    const declared = draft.metrics.map(m => m.id);
    assert.deepEqual(
      (scenario.metrics ?? []).map(m => m.id),
      declared,
      'the metric ids, in order, are the draft\'s',
    );

    const knowledge = scenario.knowledge;
    assert.deepEqual(Object.keys(knowledge?.topics ?? {}), extraction.topics, 'the knowledge topics are the extraction\'s three');
    const mapping = knowledge?.categoryMapping ?? {};
    const categories = Object.keys(mapping);
    assert.ok(categories.length > 0, `the knowledge bundle maps a category (read ${JSON.stringify(mapping)})`);
    const last = categories[categories.length - 1];
    const research = getResearchFromBundle(knowledge, last, []);
    assert.ok(
      research.canonicalFacts.length >= 1,
      `research for "${last}", the last category the bundle maps, holds a fact (read ${JSON.stringify(mapping)})`,
    );

    assert.equal(seen.filter(isDraftRequest).length, 1, `the stub saw one draft request${requests}`);
    assert.equal(seen.filter(isExtractionRequest).length, 1, `the stub saw one extraction request${requests}`);
    const unserved = seen.filter(e => !isServedPath(e.path) || e.status !== 200);
    assert.deepEqual(unserved.map(e => `${e.status} ${e.url}`), [], `every request went to a route the stub answers${requests}`);

    for (const name of HOOKS) {
      assert.equal(typeof scenario.hooks?.[name], 'function', `the compiled scenario's ${name} is a function`);
    }

    // How the draft call asked for its JSON: the provider holds the reply to the draft schema.
    const draftBody = seen.find(isDraftRequest)?.body ?? {};
    const format = (draftBody.response_format ?? (draftBody.text as { format?: unknown } | undefined)?.format) as
      | { type?: string; strict?: boolean; json_schema?: { strict?: boolean } }
      | undefined;
    const strict = format?.json_schema?.strict ?? format?.strict;
    const fellBack = telemetry.fallbacks.map(f => f.hookName);
    t.diagnostic(
      `${label}: the draft request's response_format type ${format?.type ?? 'absent'}, strict ${String(strict ?? 'absent')}; `
      + `hooks that fell back: ${fellBack.length > 0 ? fellBack.join(', ') : 'none'}`,
    );
    assert.deepEqual(
      [format?.type, strict],
      ['json_schema', true],
      `the draft request asks for a strict json_schema reply (read type ${format?.type ?? 'absent'}, strict ${String(strict ?? 'absent')})`,
    );

    // A run of the scenario holds every score its draft declares.
    const kernel = new SimulationKernel(950, 'Leader', scenarioKeyPersonnel(scenario), {
      startTime: scenario.setup?.defaultStartTime ?? 1,
      initialPopulation: Math.min(scenario.setup?.defaultPopulation ?? 30, 30),
      scenario,
    });
    const state = kernel.getState();
    const held = state.metrics as unknown as Record<string, unknown>;
    assert.deepEqual(
      declared.filter(id => typeof held[id] !== 'number' || !Number.isFinite(held[id] as number)),
      [],
      `a kernel built from the compiled scenario holds every declared score as a number (it holds ${JSON.stringify(held)})`,
    );

    // Its events have tables, and the director is offered the tables' keys.
    const registry = EffectRegistry.forScenario(scenario);
    const tables = registry.categories();
    assert.ok(tables.length >= 3, `the compiled scenario has three category tables or more (read ${JSON.stringify(tables)})`);
    assert.deepEqual(
      categories,
      tables,
      `the categories the knowledge bundle maps are the category tables' keys, in order (the bundle maps ${JSON.stringify(categories)}, the tables are ${JSON.stringify(tables)})`,
    );
    for (const category of categories) {
      assert.deepEqual(
        mapping[category],
        extraction.topics,
        `"${category}" lists the extraction's three topics in order (read ${JSON.stringify(mapping[category])})`,
      );
    }

    // The header shows the first four declared scores other than the head count and morale.
    const header = (scenario.ui?.headerMetrics ?? []).map(h => [h.id, h.format]);
    assert.deepEqual(
      header,
      draft.metrics.filter(m => m.id !== 'population' && m.id !== 'morale').slice(0, 4).map(m => [m.id, m.format ?? 'number']),
      `ui.headerMetrics names the first four declared scores with their formats (read ${JSON.stringify(scenario.ui?.headerMetrics)})`,
    );

    // The two hooks that read the state are the generated ones, kept on their first attempt.
    for (const hook of ['compile:fingerprint', 'compile:prompts']) {
      assert.deepEqual(
        telemetry.schemaRetries[hook],
        { calls: 1, attempts: 1, fallbacks: 0 },
        `${hook} took one attempt and did not fall back (read ${JSON.stringify(telemetry.schemaRetries[hook])})`,
      );
    }
    // The stub's fingerprint function counts the values the state holds (helpers/stub-model-compile.ts).
    const fingerprint = scenario.hooks?.fingerprintHook?.(state, [], LEADER as never, {}, draft.setup.defaultTurns);
    const counted = Number(/\((\d+) scores held\)/.exec(String(fingerprint?.summary))?.[1]);
    assert.ok(
      counted > 2,
      `the compiled fingerprint hook, given that kernel's state, counts more than the head count and morale (read summary ${JSON.stringify(fingerprint?.summary)})`,
    );

    // The compiled package keeps the seed path's rules: starts inside their bounds, every
    // declared score in a table and in the first or the last, every entry inside its bounds.
    assert.deepEqual(
      validateSeedWorld(scenario as unknown as Record<string, unknown>).errors,
      [],
      'validateSeedWorld reports nothing for the compiled package',
    );

    if (draft.effects) {
      // A draft that writes its starts and tables inside their bounds keeps them as written.
      for (const metric of draft.metrics) {
        assert.equal(held[metric.id], metric.initial, `${metric.id} stands at the draft's start (read ${String(held[metric.id])})`);
      }
      assert.deepEqual(tables, draft.effects.map(table => table.category), 'the category tables are the draft\'s, in order');
      assert.deepEqual(
        scenario.effects?.[0]?.categoryDefaults,
        Object.fromEntries(draft.effects.map(table => [table.category, Object.fromEntries(table.entries.map(e => [e.metric, e.change]))])),
        `the compiled tables are the draft's as written (read ${JSON.stringify(scenario.effects?.[0]?.categoryDefaults)})`,
      );
    }
  });
}
