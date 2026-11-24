import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSim } from '../../src/cli/run-sim.js';
import { fillInstructions } from '../../src/engine/presets/fill-instructions.js';
import type { ActorInput } from '../../src/engine/types.js';
import { GENERAL_AUDIENCE_GUIDANCE } from '../../src/runtime/util/audience.js';
import { WorldModel } from '../../src/runtime/world-model/index.js';
import { openSessionStore } from '../../src/server/stores/session.js';
import { readWireMessages } from '../runtime/helpers/stub-openai-transport.js';
import { modelCalls, setHostKeys, withProviderWire, type WireCall } from './helpers/provider-wire.js';
import { mars, settingsBody, waitFor, withVisitors } from './helpers/run-server.js';
import { applyDemoCaps, DEFAULT_KEY_PERSONNEL, normalizeSimulationConfig, resolveSimulationModels } from '../../src/cli/sim-config.js';
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
      ['Qiao Lanfeng', 'life-support'],
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
    execution: { commanderMaxSteps: 7, departmentMaxSteps: 10, sandboxTimeoutMs: 7500, sandboxMemoryMB: 256 },
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
  // Kept because it is under the server's own limit of 10 seconds
  // (tests/runtime/forged-code-own-context.test.ts holds the limit).
  assert.equal(config.execution.sandboxTimeoutMs, 7500);
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

test('the run path\'s default people are Mars Genesis\'s preset people, in its own departments', () => {
  // `paracosm run` seeds these five into Mars Genesis. Carlos Fernandez was
  // the "Chief Scientist" of a science department Mars does not have,
  // while scenarios/mars.json seats him in engineering as a geologist.
  assert.deepEqual(DEFAULT_KEY_PERSONNEL, marsScenario.presets[0].personnel);
  const departments = new Set(marsScenario.departments.map(d => d.id));
  for (const person of DEFAULT_KEY_PERSONNEL) {
    assert.ok(departments.has(person.department), `${person.name} sits in ${person.department}, which Mars Genesis has`);
    assert.doesNotMatch(person.role, /\b(Chief|Head|Director)\b/, `${person.name} carries no head's title`);
  }
});

const orderTestKey = 'openai-for-order-tests';
const mira = {
  ...leaderA,
  name: 'Mira',
  archetype: 'The Surveyor',
  unit: 'North',
  instructions: undefined,
  description: 'Check the stores.',
};
const miraOrders = 'You are Mira, "The Surveyor." Check the stores. Your HEXACO profile drives your leadership style.';
const writtenMarsLeaders = marsScenario.presets[0].leaders.map((leader, index) => ({
  ...leader,
  unit: index === 0 ? 'North' : 'South',
}));
const commanderBootstraps = (calls: readonly WireCall[]) => modelCalls(calls)
  .filter(call => call.lastUser.includes('You receive department reports and make strategic decisions'));
const promotionReply = (call: WireCall) => call.text.includes('You must promote') ? '{}' : undefined;
const ordersIn = (call: WireCall, orders: string) => call.system.includes(GENERAL_AUDIENCE_GUIDANCE + '\n\n' + orders);

test('the provider observer isolates system orders from the last user message', () => {
  const user = [{ role: 'user', content: '  Keep the stores.\nWait.  ' }];
  const system = [
    { role: 'system', content: '  System.  ' },
    { role: 'developer', content: [{ type: 'input_text', text: '\nDeveloper.' }] },
  ];
  const chat = readWireMessages({ messages: [...system, ...user] });
  assert.equal(chat.lastUser, user[0].content);
  assert.equal(chat.system, '  System.  \n\n\nDeveloper.');
  assert.ok(!chat.system.includes(user[0].content));
  assert.equal(readWireMessages({ instructions: 'Instructions.', input: [...system, ...user] }).system,
    'Instructions.\n\n' + chat.system);
  for (const anthropicSystem of ['Anthropic.', [{ type: 'text', text: 'Anthropic.' }]]) {
    assert.equal(readWireMessages({ system: anthropicSystem, messages: user }).system, 'Anthropic.');
  }
});

test('normalization fills every roster slot and preserves written orders and units', () => {
  for (const size of [2, 24, 300]) {
    const roster: ActorInput[] = Array.from({ length: size }, (_, index) => ({
      ...mira,
      name: `Mira ${index + 1}`,
      unit: `Unit ${index + 1}`,
      archetype: ' The Pragmatist ',
      description: undefined,
      hexaco: { openness: 0.9 } as ActorInput['hexaco'],
      instructions: index === size - 1 ? ' \t\n' : undefined,
    }));
    if (size > 2) roster.splice(0, 2, ...writtenMarsLeaders);
    const { actors } = normalizeSimulationConfig({ actors: roster }, marsScenario);
    assert.equal(actors.length, size);
    for (const [index, actor] of actors.entries()) {
      assert.equal(actor.name, roster[index].name);
      assert.equal(actor.unit, roster[index].unit);
      assert.equal(actor.instructions, roster[index].instructions?.trim()
        ? roster[index].instructions
        : `You are ${actor.name}, "The Pragmatist." Leads by protocol and evidence. Safety margins first. You look for what this moment makes possible. Your HEXACO profile drives your leadership style.`);
    }
    const again = normalizeSimulationConfig({ actors }, marsScenario).actors;
    for (const [index, actor] of again.entries()) assert.strictEqual(actor, actors[index]);
  }
  assert.deepEqual(normalizeSimulationConfig({ actors: writtenMarsLeaders }, marsScenario).actors, writtenMarsLeaders);
  const forkFrom = { atTurn: 0, parentArtifact: {} } as NonNullable<Parameters<typeof normalizeSimulationConfig>[0]['forkFrom']>;
  const fork = normalizeSimulationConfig({ actors: [mira], forkFrom }, marsScenario);
  assert.equal(fork.actors[0].instructions, miraOrders);
});

test('setup sends generated and authored orders in separate commander system messages', async () => {
  const restore = setHostKeys({ OPENAI_API_KEY: orderTestKey });
  try {
    await withProviderWire(async calls => {
      await withVisitors(async api => {
        const visitor = api.cookied();
        const body = settingsBody(mars);
        const written = body.actors[1].instructions;
        const response = await visitor.post('/setup', {
          ...body, turns: 1, actors: [mira, body.actors[1]],
        });
        assert.equal(response.status, 200);
        await waitFor(async () => (await visitor.json<{ isComplete: boolean }>('/results')).isComplete,
          'the setup run to finish', 120_000);

        const boot = commanderBootstraps(calls);
        const generated = boot.find(call => ordersIn(call, miraOrders));
        const authored = boot.find(call => ordersIn(call, written));
        assert.ok(generated, 'generated orders reached the commander');
        assert.ok(authored, 'authored orders reached the commander');
        assert.notStrictEqual(generated, authored);
        assert.ok(authored.lastUser.includes('You demand evidence and contingency plans before committing'));
      }, {
        env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: orderTestKey },
        extra: {
          getDigitalTwinWorld: async () => null,
          runPairSimulations: undefined,
          sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
          generateText: async () => ({ text: 'A saved run' }),
        },
      });
    }, promotionReply);
  } finally {
    restore();
  }
});

test('setup counts only admitted leaders whose orders need a fill', async t => {
  const messages: string[] = [];
  t.mock.method(console, 'log', (message: unknown) => {
    if (typeof message === 'string' && message.startsWith('[orders]')) messages.push(message);
  });
  const body = settingsBody(mars);
  await withVisitors(async api => {
    const visitor = api.cookied();
    const response = await visitor.post('/setup', {
      ...body, turns: 1,
      actors: [
        mira,
        { ...mira, name: 'Second', instructions: ' '.repeat(400) + 'Keep the reserve.' },
        { ...mira, name: 'Third', instructions: '' },
      ],
    });
    assert.equal(response.status, 200);
    const { config } = await waitFor(() => api.launches[0], 'the admitted pair');
    assert.deepEqual(config.actors.map(actor => actor.name), ['Mira', 'Second']);
    assert.equal(config.actors[1].instructions, 'You are Second, "The Surveyor." Check the stores. Your HEXACO profile drives your leadership style.');
    await visitor.json('/results');
    assert.deepEqual(messages.splice(0), ['[orders] filled empty instructions for 2 leader(s)']);
    assert.equal((await visitor.post('/setup', body)).status, 200);
    assert.deepEqual(messages, []);
    assert.equal((await visitor.post('/setup', { ...body, actors: [mira, mira] })).status, 429);
    assert.deepEqual(messages, []);
  }, {
    maxSimsPerDay: 2,
    env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: orderTestKey },
    extra: { getDigitalTwinWorld: async () => null },
  });
});

test('the library fills orders when setup is skipped and logs one leader', async t => {
  const messages: string[] = [];
  t.mock.method(console, 'log', (message: unknown) => {
    if (typeof message === 'string' && message.startsWith('[orders]')) messages.push(message);
  });
  await withProviderWire(async calls => {
    const world = WorldModel.fromScenario(marsScenario);
    await world.simulate({
      actor: mira, apiKey: orderTestKey, provider: 'openai', maxTurns: 1,
      writeOutputFile: false, keyPersonnel: DEFAULT_KEY_PERSONNEL,
    });
    assert.ok(commanderBootstraps(calls).some(call => ordersIn(call, miraOrders)));
    assert.deepEqual(messages, ['[orders] filled empty instructions for 1 leader(s)']);
  }, promotionReply);
});

test('the CLI name override keeps file orders and fills blanks using the new name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-cli-orders-'));
  const file = join(dir, 'actors.json');
  const oldOutput = process.env.PARACOSM_OUTPUT_DIR;
  const restore = setHostKeys({ OPENAI_API_KEY: orderTestKey });
  process.env.PARACOSM_OUTPUT_DIR = dir;
  try {
    const written = 'Keep both reserves.\nCheck the stores again.';
    for (const [instructions, expected] of [
      [written, written],
      ['  \t', 'You are Ren, "The Surveyor." Check the stores. Your HEXACO profile drives your leadership style.'],
    ]) {
      writeFileSync(file, JSON.stringify({ actors: [{ ...mira, instructions }] }));
      await withProviderWire(async calls => {
        assert.equal(await runSim(['1', '--actors', file, '--name', 'Ren', '--provider', 'openai']), 0);
        assert.ok(commanderBootstraps(calls).some(call => ordersIn(call, expected)));
      }, promotionReply);
    }
  } finally {
    restore();
    if (oldOutput !== undefined) process.env.PARACOSM_OUTPUT_DIR = oldOutput;
    else delete process.env.PARACOSM_OUTPUT_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI name override puts the new name where the shipped orders name the old leader', async () => {
  const shippedPath = fileURLToPath(new URL('../../config/actors.json', import.meta.url));
  const [shipped] = (JSON.parse(readFileSync(shippedPath, 'utf-8')) as { actors: ActorInput[] }).actors;
  const shippedOrders = shipped.instructions ?? '';
  assert.equal(shipped.name, 'Aria Chen');
  assert.ok(shippedOrders.includes('Aria Chen'), 'the shipped orders name their leader');
  const expected = shippedOrders.split('Aria Chen').join('Ren');
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-cli-rename-'));
  const oldOutput = process.env.PARACOSM_OUTPUT_DIR;
  const restore = setHostKeys({ OPENAI_API_KEY: orderTestKey });
  process.env.PARACOSM_OUTPUT_DIR = dir;
  try {
    await withProviderWire(async calls => {
      assert.equal(await runSim(['1', '--actors', shippedPath, '--name', 'Ren', '--provider', 'openai']), 0);
      const boot = commanderBootstraps(calls);
      assert.ok(boot.length > 0, 'the commander was started');
      assert.ok(boot.some(call => ordersIn(call, expected)), 'the renamed orders reached the commander');
      for (const call of boot) assert.ok(!call.system.includes('Aria Chen'), 'no commander call names the old leader');
    }, promotionReply);

    // Only the name itself changes: a longer word that starts with it stays.
    const file = join(dir, 'actors.json');
    writeFileSync(file, JSON.stringify({ actors: [{ ...mira, name: 'Will', instructions: 'You are Will. Ask William to check the reserve.' }] }));
    await withProviderWire(async calls => {
      assert.equal(await runSim(['1', '--actors', file, '--name', 'Ren', '--provider', 'openai']), 0);
      assert.ok(commanderBootstraps(calls).some(call => ordersIn(call, 'You are Ren. Ask William to check the reserve.')),
        'the orders keep the longer word');
    }, promotionReply);

    // An empty --instructions asks for orders filled for the new name.
    const filledForRen = fillInstructions({ ...shipped, name: 'Ren', instructions: undefined }).instructions;
    assert.ok(filledForRen.startsWith('You are Ren, "The Visionary."'));
    await withProviderWire(async calls => {
      assert.equal(await runSim(['1', '--actors', shippedPath, '--name', 'Ren', '--instructions', '', '--provider', 'openai']), 0);
      const boot = commanderBootstraps(calls);
      assert.ok(boot.some(call => ordersIn(call, filledForRen)), 'the filled orders reached the commander');
      for (const call of boot) assert.ok(!call.system.includes('Commander Ren'), 'the file orders were not sent');
    }, promotionReply);
  } finally {
    restore();
    if (oldOutput !== undefined) process.env.PARACOSM_OUTPUT_DIR = oldOutput;
    else delete process.env.PARACOSM_OUTPUT_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup fills orders for a leader whose description is not text', async () => {
  const body = settingsBody(mars);
  await withVisitors(async api => {
    const visitor = api.cookied();
    const response = await visitor.post('/setup', {
      ...body, turns: 1, actors: [{ ...mira, description: 5 }, body.actors[1]],
    });
    assert.equal(response.status, 200);
    const { config } = await waitFor(() => api.launches[0], 'the launch');
    assert.equal(config.actors[0].instructions,
      'You are Mira, "The Surveyor." Your HEXACO profile drives your leadership style.');
    await visitor.json('/results');
  }, {
    maxSimsPerDay: 2,
    env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: orderTestKey },
    extra: { getDigitalTwinWorld: async () => null },
  });
});
