/**
 * The seed compile, `compileFromSeed`, end to end on a stub model, for the
 * drafts a model returned to the cookbook runs and for the bare orchard
 * draft.
 *
 * The stub (tests/engine/compiler/helpers/stub-model-compile.ts) answers
 * the draft call with a draft from tests/fixtures/compiler/, the seed
 * extraction with extraction-orchard.json, and each code hook with a
 * working function. AgentOS builds every request and checks the draft
 * reply against the draft schema; the compiler runs every stage. No
 * network is reached and nothing is paid.
 *
 * These hold what the compile keeps whatever the draft schema asks of the
 * model: the draft's ids in order, the extraction's topics, research for
 * the last category the knowledge bundle maps, one draft call and one
 * extraction, and seven hooks. Whether two hooks fell back, what the
 * politics hook returns, the world's keys, the category tables, the
 * mapping's keys, the death dice and the supply marks are left to the
 * tests of the changes that make them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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
  departments: Array<{ id: string }>;
  metrics: Array<{ id: string }>;
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
  ['recorded-draft-ai-lab.json', 'the AI lab draft a model returned to the cookbook'],
  ['recorded-draft-generation-ship.json', 'the generation ship draft a model returned to the cookbook'],
  ['recorded-draft-pandemic-governor.json', 'the pandemic governor draft a model returned to the cookbook'],
  ['recorded-draft-game-studio.json', 'the game studio draft a model returned to the cookbook'],
];

const extraction = loadCompilerFixture('extraction-orchard.json') as { topics: string[] };

for (const [file, label] of DRAFTS) {
  test(`${label} compiles through compileFromSeed on a stub model, keeping its ids and the extraction's research`, async (t) => {
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
    assert.deepEqual(
      (scenario.metrics ?? []).map(m => m.id),
      draft.metrics.map(m => m.id),
      'the metric ids, in order, are the draft\'s',
    );

    const knowledge = scenario.knowledge;
    assert.deepEqual(Object.keys(knowledge?.topics ?? {}), extraction.topics, 'the knowledge topics are the extraction\'s three');
    const categories = Object.keys(knowledge?.categoryMapping ?? {});
    assert.ok(categories.length > 0, `the knowledge bundle maps a category (read ${JSON.stringify(knowledge?.categoryMapping)})`);
    const last = categories[categories.length - 1];
    const research = getResearchFromBundle(knowledge, last, []);
    assert.ok(
      research.canonicalFacts.length >= 1,
      `research for "${last}", the last category the bundle maps, holds a fact (read ${JSON.stringify(knowledge?.categoryMapping)})`,
    );

    assert.equal(seen.filter(isDraftRequest).length, 1, `the stub saw one draft request${requests}`);
    assert.equal(seen.filter(isExtractionRequest).length, 1, `the stub saw one extraction request${requests}`);
    const unserved = seen.filter(e => !isServedPath(e.path) || e.status !== 200);
    assert.deepEqual(unserved.map(e => `${e.status} ${e.url}`), [], `every request went to a route the stub answers${requests}`);

    for (const name of HOOKS) {
      assert.equal(typeof scenario.hooks?.[name], 'function', `the compiled scenario's ${name} is a function`);
    }

    // For the change to the draft schema to read: how the draft call asked for its JSON.
    const draftBody = seen.find(isDraftRequest)?.body ?? {};
    const format = (draftBody.response_format ?? (draftBody.text as { format?: unknown } | undefined)?.format) as
      | { type?: string; strict?: boolean; json_schema?: { strict?: boolean } }
      | undefined;
    const fellBack = telemetry.fallbacks.map(f => f.hookName);
    t.diagnostic(
      `${label}: the draft request's response_format type ${format?.type ?? 'absent'}, strict ${String(format?.json_schema?.strict ?? format?.strict ?? 'absent')}; `
      + `hooks that fell back: ${fellBack.length > 0 ? fellBack.join(', ') : 'none'}`,
    );
  });
}
