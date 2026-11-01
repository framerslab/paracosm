import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDemoCaps, normalizeSimulationConfig, resolveSimulationModels } from '../../src/cli/sim-config.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';

const leaderA = {
  name: 'A',
  archetype: 'One',
  unit: 'Alpha',
  hexaco: {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    emotionality: 0.5,
    honestyHumility: 0.5,
  },
  instructions: 'Leader A',
};

const leaderB = {
  name: 'B',
  archetype: 'Two',
  unit: 'Beta',
  hexaco: {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    emotionality: 0.5,
    honestyHumility: 0.5,
  },
  instructions: 'Leader B',
};

test('normalizeSimulationConfig applies defaults for omitted optional fields', () => {
  // With no scenario given, the omitted setup comes from Mars Genesis's
  // own data (scenarios/mars.json), the scenario the CLI runs by default.
  const config = normalizeSimulationConfig({ actors: [leaderA, leaderB] });

  assert.equal(config.turns, marsScenario.setup.defaultTurns);
  assert.equal(config.turns, 6);
  assert.equal(config.seed, 950);
  assert.equal(config.startTime, 2035);
  assert.equal(config.timePerTurn, 8);
  assert.equal(config.initialPopulation, 100);
  assert.equal(config.liveSearch, false);
  assert.deepEqual(config.activeDepartments, ['medical', 'engineering', 'agriculture', 'psychology', 'governance']);
  // Omitted resources and politics are left to the engine's base values
  // and the scenario's own declarations (the kernel layers them), so no
  // Mars number from the normalizer can overwrite what a scenario declares.
  assert.deepEqual(config.startingResources, {});
  assert.deepEqual(config.startingPolitics, {});
  assert.equal(config.execution.commanderMaxSteps, 5);
  assert.equal(config.execution.departmentMaxSteps, 4);
  assert.equal(config.models.commander, 'gpt-4o');
  assert.equal(config.models.departments, 'gpt-5.4');
  assert.equal(config.models.judge, 'gpt-5.4-mini');
  assert.equal(config.models.director, 'gpt-5.4-mini');
  assert.equal(config.models.agentReactions, 'gpt-5.4-nano');
  assert.equal(config.economics.id, 'balanced');
  assert.equal(config.economics.verdict.mode, 'balanced');
  assert.deepEqual(
    config.keyPersonnel.map(p => p.name),
    ['Dr. Yuki Tanaka', 'Erik Lindqvist', 'Amara Osei', 'Dr. Priya Singh', 'Carlos Fernandez'],
    'the Mars colonists come from the default preset of scenarios/mars.json',
  );
});

test('normalizeSimulationConfig takes omitted setup values and people from the scenario it is given', () => {
  // Lunar Outpost (scenarios/lunar.json) declares its own setup and five
  // crew members; none of its numbers is a Mars number.
  const config = normalizeSimulationConfig({ actors: [leaderA, leaderB] }, lunarScenario);

  assert.equal(config.turns, 8);
  assert.equal(config.seed, 1200);
  assert.equal(config.startTime, 2030);
  assert.equal(config.timePerTurn, undefined, 'lunar.json declares no defaultTimePerTurn; the orchestrator falls back to 1');
  assert.equal(config.initialPopulation, 50);
  assert.deepEqual(config.activeDepartments, lunarScenario.departments.map(d => d.id));
  assert.deepEqual(
    config.keyPersonnel.map(p => [p.name, p.department]),
    [
      ['Dr. Sarah Anderson', 'medical'],
      ['James Mueller', 'engineering'],
      ['Dr. Yuki Nakamura', 'mining'],
      ['Chen Wei', 'life-support'],
      ['Maria Santos', 'communications'],
    ],
  );

  // An explicit value in the payload still wins over the scenario.
  const explicit = normalizeSimulationConfig({ actors: [leaderA, leaderB], startTime: 2042, population: 12 }, lunarScenario);
  assert.equal(explicit.startTime, 2042);
  assert.equal(explicit.initialPopulation, 12);
});

test('normalizeSimulationConfig gives a whole config for a scenario with a partial setup', () => {
  // compile-from-seed drafts carry no defaultSeed, and POST /compile takes
  // an uploaded scenario's setup as written. Under the hosted demo's caps
  // Math.min(undefined, 30) is NaN, and the kernel builds nobody from NaN.
  const partial = { ...lunarScenario, setup: { defaultStartTime: 2040 } } as unknown as typeof lunarScenario;
  const config = applyDemoCaps(normalizeSimulationConfig({ actors: [leaderA, leaderB] }, partial));

  assert.equal(config.startTime, 2040);
  assert.equal(config.turns, 6, '12 from the engine, capped to the demo\'s 6');
  assert.equal(config.initialPopulation, 30, '100 from the engine, capped to the demo\'s 30');
  assert.equal(config.seed, 42);

  const none = normalizeSimulationConfig({ actors: [leaderA, leaderB] }, { ...lunarScenario, setup: {} } as unknown as typeof lunarScenario);
  assert.equal(none.startTime, 0);
});

test('normalizeSimulationConfig preserves explicit setup overrides', () => {
  const config = normalizeSimulationConfig({
    actors: [leaderA, leaderB],
    turns: 6,
    seed: 4242,
    startTime: 2042,
    population: 140,
    liveSearch: true,
    activeDepartments: ['medical', 'engineering', 'psychology'],
    startingResources: {
      food: 22,
      water: 900,
      power: 520,
      morale: 78,
      pressurizedVolumeM3: 4500,
      lifeSupportCapacity: 180,
      infrastructureModules: 6,
      scienceOutput: 12,
    },
    startingPolitics: { earthDependencyPct: 72 },
    execution: { commanderMaxSteps: 7, departmentMaxSteps: 10, sandboxTimeoutMs: 15000, sandboxMemoryMB: 256 },
    customEvents: [{ turn: 2, title: 'Comms blackout', description: 'Solar flare disrupts Earth comms.' }],
    models: { commander: 'gpt-5.4', departments: 'gpt-5.4-mini', judge: 'gpt-5.4' },
    keyPersonnel: [
      { name: 'Custom Chief', department: 'medical', role: 'Chief Medical Officer', specialization: 'Emergency Medicine', age: 39, featured: true },
    ],
  });

  assert.equal(config.turns, 6);
  assert.equal(config.seed, 4242);
  assert.equal(config.startTime, 2042);
  assert.equal(config.initialPopulation, 140);
  assert.equal(config.liveSearch, true);
  assert.deepEqual(config.activeDepartments, ['medical', 'engineering', 'psychology']);
  assert.equal(config.startingResources.foodMonthsReserve, 22);
  assert.equal(config.startingResources.waterLitersPerDay, 900);
  assert.equal(config.startingResources.powerKw, 520);
  assert.equal(config.startingResources.morale, 0.78);
  assert.equal(config.startingResources.pressurizedVolumeM3, 4500);
  assert.equal(config.startingResources.lifeSupportCapacity, 180);
  assert.equal(config.startingResources.infrastructureModules, 6);
  assert.equal(config.startingResources.scienceOutput, 12);
  assert.equal(config.startingPolitics.earthDependencyPct, 72);
  assert.equal(config.execution.commanderMaxSteps, 7);
  assert.equal(config.execution.departmentMaxSteps, 10);
  assert.equal(config.execution.sandboxTimeoutMs, 15000);
  assert.equal(config.execution.sandboxMemoryMB, 256);
  assert.equal(config.customEvents.length, 1);
  assert.equal(config.customEvents[0].title, 'Comms blackout');
  assert.equal(config.keyPersonnel[0].name, 'Custom Chief');
});

test('normalizeSimulationConfig honors anthropic provider defaults and rejects mismatched model family by coercion', () => {
  const config = normalizeSimulationConfig({
    actors: [leaderA, leaderB],
    provider: 'anthropic',
    models: {
      commander: 'gpt-5.4',
      departments: 'gpt-5.4-mini',
      judge: 'gpt-5.4',
    },
  });

  assert.equal(config.provider, 'anthropic');
  assert.equal(config.models.commander, 'claude-haiku-4-5-20251001');
  assert.equal(config.models.departments, 'claude-sonnet-4-6');
  assert.equal(config.models.judge, 'claude-haiku-4-5-20251001');
  assert.equal(config.models.director, 'claude-haiku-4-5-20251001');
});

test('normalizeSimulationConfig infers provider from selected model family when provider is omitted', () => {
  const config = normalizeSimulationConfig({
    actors: [leaderA, leaderB],
    models: {
      commander: 'claude-sonnet-4-6',
      departments: 'claude-sonnet-4-6',
      judge: 'claude-sonnet-4-6',
    },
  });

  assert.equal(config.provider, 'anthropic');
});

test('normalizeSimulationConfig keeps medical and engineering active even if omitted', () => {
  const config = normalizeSimulationConfig({
    actors: [leaderA, leaderB],
    activeDepartments: ['governance'],
  });

  assert.deepEqual(config.activeDepartments, ['medical', 'engineering', 'governance']);
});

test('resolveSimulationModels uses provider defaults when models are omitted for standalone runs', () => {
  const anthropicModels = resolveSimulationModels('anthropic');
  assert.equal(anthropicModels.commander, 'claude-haiku-4-5-20251001');
  assert.equal(anthropicModels.departments, 'claude-sonnet-4-6');
  assert.equal(anthropicModels.judge, 'claude-haiku-4-5-20251001');
  assert.equal(anthropicModels.director, 'claude-haiku-4-5-20251001');
  assert.equal(anthropicModels.agentReactions, 'claude-haiku-4-5-20251001');
});

test('normalizeSimulationConfig resolves explicit economics profiles', () => {
  const config = normalizeSimulationConfig({
    actors: [leaderA, leaderB],
    economics: { profileId: 'economy', batchConcurrency: 3 },
  });

  assert.equal(config.economics.id, 'economy');
  assert.equal(config.economics.verdict.mode, 'cheap');
  assert.equal(config.economics.batch.maxConcurrency, 3);
  assert.equal(config.models.commander, 'gpt-5.4-nano');
  assert.equal(config.models.departments, 'gpt-5.4-mini');
});
