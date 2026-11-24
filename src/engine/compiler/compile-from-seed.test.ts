import test from 'node:test';
import assert from 'node:assert/strict';

import { compileFromSeed, DraftScenarioSchema } from './compile-from-seed.js';
import { isDraftRequest, isExtractionRequest, loadCompilerFixture, ORCHARD_SEED_TEXT } from '../../../tests/engine/compiler/helpers/stub-model-compile.js';
import { withStubOpenAi, type StubReply } from '../../../tests/runtime/helpers/stub-openai-transport.js';

test('DraftScenarioSchema: accepts a well-formed draft', () => {
  const draft = {
    id: 'submarine-habitat',
    labels: {
      name: 'Deep Ocean Habitat',
      populationNoun: 'crew',
      settlementNoun: 'habitat',
      timeUnitNoun: 'day',
      currency: 'credits',
    },
    setup: { defaultTurns: 6, defaultPopulation: 50, defaultStartTime: 2040 },
    departments: [
      { id: 'life-support', label: 'Life Support', role: 'Chief Life Support Officer', instructions: 'Analyze O2 levels and water recycling.' },
      { id: 'engineering', label: 'Engineering', role: 'Chief Engineer', instructions: 'Analyze hull integrity and pressure.' },
    ],
    metrics: [
      { id: 'population', format: 'number' },
      { id: 'morale', format: 'percent' },
    ],
  };
  const legacy = DraftScenarioSchema.parse(draft);
  assert.equal(Object.hasOwn(legacy.labels, 'summary'), false);
  assert.equal(Object.hasOwn(legacy.labels, 'fictionNote'), false);

  const extra = DraftScenarioSchema.parse({
    ...draft,
    labels: { ...draft.labels, summary: 'Model summary.', fictionNote: 'Model note.' },
  });
  assert.equal(Object.hasOwn(extra.labels, 'summary'), false);
  assert.equal(Object.hasOwn(extra.labels, 'fictionNote'), false);
});

test('compileFromSeed preserves authored labels from the input package', async () => {
  const draft = loadCompilerFixture('draft-orchard-bare.json');
  const extraction = loadCompilerFixture('extraction-orchard.json');
  const reply: StubReply = request => {
    if (isDraftRequest(request)) return JSON.stringify(draft);
    if (isExtractionRequest(request)) return JSON.stringify(extraction);
    return '{}';
  };
  const labels = { summary: 'A family tends an orchard.', fictionNote: 'Fictional orchard.' };
  await withStubOpenAi(reply, async () => {
    const input = { seedText: ORCHARD_SEED_TEXT, labels };
    const scenario = await compileFromSeed(input, {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'placeholder-key-for-a-test',
      cache: false,
      webSearch: false,
    });
    assert.equal(scenario.labels.summary, labels.summary);
    assert.equal(scenario.labels.fictionNote, labels.fictionNote);
  });
});

test('DraftScenarioSchema: rejects non-kebab-case id', () => {
  const result = DraftScenarioSchema.safeParse({
    id: 'Submarine Habitat',
    labels: { name: 'X', populationNoun: 'crew', settlementNoun: 'habitat', timeUnitNoun: 'day' },
    setup: { defaultTurns: 6, defaultPopulation: 50, defaultStartTime: 2040 },
    departments: [
      { id: 'a', label: 'A', role: 'R', instructions: 'x'.repeat(10) },
      { id: 'b', label: 'B', role: 'R', instructions: 'x'.repeat(10) },
    ],
    metrics: [{ id: 'm', format: 'number' }, { id: 'n', format: 'number' }],
  });
  assert.equal(result.success, false);
});

test('DraftScenarioSchema: rejects < 2 departments', () => {
  const result = DraftScenarioSchema.safeParse({
    id: 'x-scenario',
    labels: { name: 'X', populationNoun: 'crew', settlementNoun: 'habitat', timeUnitNoun: 'day' },
    setup: { defaultTurns: 6, defaultPopulation: 50, defaultStartTime: 2040 },
    departments: [{ id: 'a', label: 'A', role: 'R', instructions: 'x'.repeat(10) }],
    metrics: [{ id: 'm', format: 'number' }, { id: 'n', format: 'number' }],
  });
  assert.equal(result.success, false);
});

test('DraftScenarioSchema: rejects defaultTurns out of bounds', () => {
  const result = DraftScenarioSchema.safeParse({
    id: 'x-scenario',
    labels: { name: 'X', populationNoun: 'crew', settlementNoun: 'habitat', timeUnitNoun: 'day' },
    setup: { defaultTurns: 24, defaultPopulation: 50, defaultStartTime: 2040 },
    departments: [
      { id: 'a', label: 'A', role: 'R', instructions: 'x'.repeat(10) },
      { id: 'b', label: 'B', role: 'R', instructions: 'x'.repeat(10) },
    ],
    metrics: [{ id: 'm', format: 'number' }, { id: 'n', format: 'number' }],
  });
  assert.equal(result.success, false);
});

test('DraftScenarioSchema: rejects defaultPopulation above 1000', () => {
  const result = DraftScenarioSchema.safeParse({
    id: 'x-scenario',
    labels: { name: 'X', populationNoun: 'crew', settlementNoun: 'habitat', timeUnitNoun: 'day' },
    setup: { defaultTurns: 6, defaultPopulation: 10000, defaultStartTime: 2040 },
    departments: [
      { id: 'a', label: 'A', role: 'R', instructions: 'x'.repeat(10) },
      { id: 'b', label: 'B', role: 'R', instructions: 'x'.repeat(10) },
    ],
    metrics: [{ id: 'm', format: 'number' }, { id: 'n', format: 'number' }],
  });
  assert.equal(result.success, false, 'defaultPopulation > 1000 should reject');
});
