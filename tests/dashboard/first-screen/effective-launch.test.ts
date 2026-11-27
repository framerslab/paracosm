/**
 * The run the Run tab's first screen launches: who pays, and the turns,
 * people, departments and events a turn its words say and its launch posts.
 *
 * A run on the host's keys (the hosted demo, no key saved) is cut to the
 * host's caps; a run on the visitor's key or on a self-hosted server takes
 * the scenario's own figures and the turns the visitor last launched with on
 * that scenario. Storage that throws or holds corrupt JSON reads as nothing
 * saved, never as a throw. The scenarios are the bundled ones, read from
 * scenarios/*.json.
 *
 * The launch is worked out once (effectiveLaunch), so the words on the
 * screen and the body Start posts come from the same figures: the body is
 * what the launch has always posted, with the run's own turns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalogTurns,
  effectiveDepartments,
  effectiveLaunch,
  effectivePeople,
  effectiveTurns,
  eventsPerTurn,
  figuresLine,
  figuresSpoken,
  formatMinutes,
  keyProviderName,
  minutesForTurns,
  modelNames,
  payer,
  providerName,
  readLaunchSettings,
  type LaunchScenario,
  type LaunchScenarioWithLeaders,
} from '../../../src/dashboard/src/components/quickstart/first-screen/effectiveLaunch.js';
import { startSecondLine, startSpoken } from '../../../src/dashboard/src/components/quickstart/first-screen/words.js';
import { parseAdminConfig, parseRateLimit, type ServerFacts } from '../../../src/dashboard/src/components/quickstart/first-screen/useServerFacts.js';

const scenarioFile = (name: string): LaunchScenarioWithLeaders =>
  JSON.parse(readFileSync(new URL(`../../../scenarios/${name}`, import.meta.url), 'utf-8')) as LaunchScenarioWithLeaders;
const mars = scenarioFile('mars.json');
const lunar = scenarioFile('lunar.json');

/** The server's answers as the hosted demo gives them (caps of 6 turns, 30 people, 3 departments), or as a self-hosted server does. */
function facts(hostedDemo: boolean): ServerFacts {
  return {
    rateLimit: { status: 'ready', refresh: async () => ({ status: 'ready' as const }) },
    adminConfig: { status: 'ready', hostedDemo, demoCaps: { maxTurns: 6, maxPopulation: 30, maxActiveDepartments: 3 } },
    sessions: { status: 'ready', rows: [], refresh: () => {} },
  };
}

const NBSP = '\u00a0';
const withTurns = (scenario: LaunchScenario, turns: number): LaunchScenario => ({ ...scenario, setup: { ...scenario.setup, defaultTurns: turns } });

test('payer: the visitor\'s own key, else the host on the hosted demo, else the server', () => {
  const key = { openai: 'sk-test' };
  assert.equal(payer(facts(true), {}), 'host');
  assert.equal(payer(facts(true), key), 'own');
  assert.equal(payer(facts(false), {}), 'server');
  assert.equal(payer(facts(false), key), 'own');
  // A masked key the page kept is no key to the server, so the host pays.
  assert.equal(payer(facts(true), { openai: 'sk-...' }), 'host');
});

test('readLaunchSettings: storage that throws or holds corrupt JSON reads as nothing saved', () => {
  const throwing = {
    getItem() { throw new Error('The operation is insecure.'); },
    setItem() {},
    removeItem() {},
  } as unknown as Storage;
  assert.deepEqual(readLaunchSettings(throwing), { overrides: {}, lastLaunch: null });

  const corrupt = {
    getItem: (key: string) => (key.startsWith('paracosm:') ? '{"openai": "sk-' : null),
    setItem() {},
    removeItem() {},
  } as unknown as Storage;
  assert.deepEqual(readLaunchSettings(corrupt), { overrides: {}, lastLaunch: null });

  assert.deepEqual(readLaunchSettings(null), { overrides: {}, lastLaunch: null });
});

test('effectiveTurns on the host\'s keys: the smaller of the scenario\'s turns and the cap of 6', () => {
  const none = { overrides: {}, lastLaunch: null };
  assert.equal(mars.setup.defaultTurns, 6);
  assert.equal(effectiveTurns(facts(true), mars, none, 'host'), 6);
  assert.equal(lunar.setup.defaultTurns, 8);
  assert.equal(effectiveTurns(facts(true), lunar, none, 'host'), 6);
  assert.equal(effectiveTurns(facts(true), withTurns(mars, 4), none, 'host'), 4);
  // The last launch does not lift a free run over the cap.
  assert.equal(effectiveTurns(facts(true), mars, { overrides: {}, lastLaunch: { scenarioId: 'mars-genesis', turns: 40 } }, 'host'), 6);
});

test('effectiveTurns on the visitor\'s key: the last launch on this scenario, else the scenario\'s turns', () => {
  const last = (scenarioId: string, turns: unknown) => ({ overrides: { openai: 'sk-test' }, lastLaunch: { scenarioId, turns } });
  assert.equal(effectiveTurns(facts(true), mars, last('mars-genesis', 40), 'own'), 40);
  assert.equal(effectiveTurns(facts(true), mars, last('lunar-outpost', 40), 'own'), 6);
  // A stored figure outside 1 to 100, or not a whole number, is not a run's turns.
  for (const turns of [0, 101, 2.5, '40', null]) {
    assert.equal(effectiveTurns(facts(false), mars, last('mars-genesis', turns), 'server'), 6, `turns ${JSON.stringify(turns)}`);
  }
});

test('catalogTurns: a row says the turns Start posts once that scenario is loaded', () => {
  // The rows of Other scenarios as GET /scenarios lists them: each scenario's id and its own turns.
  const marsRow = { id: mars.id, turns: mars.setup.defaultTurns };
  const lunarRow = { id: lunar.id, turns: lunar.setup.defaultTurns };
  const saved = { overrides: { openai: 'sk-test' }, lastLaunch: { scenarioId: 'mars-genesis', turns: 12 } };
  // On the visitor's key a saved launch of 12 turns on Mars Genesis is the next run's length, not the scenario's 6.
  assert.equal(catalogTurns(facts(true), marsRow, saved, 'own'), 12);
  assert.equal(catalogTurns(facts(true), marsRow, saved, 'own'), effectiveTurns(facts(true), mars, saved, 'own'));
  // The saved launch belongs to Mars Genesis alone: Lunar Outpost keeps its own 8.
  assert.equal(catalogTurns(facts(true), lunarRow, saved, 'own'), 8);
  assert.equal(catalogTurns(facts(true), lunarRow, saved, 'own'), effectiveTurns(facts(true), lunar, saved, 'own'));
  // On a self-hosted server the same rule holds, under the server's own bound on turns.
  const bounded: ServerFacts = { ...facts(false), adminConfig: { ...facts(false).adminConfig, run: { maxTurns: 10 } } };
  assert.equal(catalogTurns(bounded, marsRow, saved, 'server'), effectiveTurns(bounded, mars, saved, 'server'));
  assert.equal(catalogTurns(bounded, lunarRow, { overrides: {}, lastLaunch: null }, 'server'), 8);
  // On the host's keys the cap of 6 cuts the row and the saved launch does not lift it.
  assert.equal(catalogTurns(facts(true), lunarRow, saved, 'host'), 6);
  assert.equal(catalogTurns(facts(true), marsRow, saved, 'host'), effectiveTurns(facts(true), mars, saved, 'host'));
  // A host cap not yet known, or a row with no turns, says no figure.
  const noCap: ServerFacts = { ...facts(true), adminConfig: { status: 'ready', hostedDemo: true } };
  assert.equal(catalogTurns(noCap, lunarRow, saved, 'host'), undefined);
  assert.equal(catalogTurns(facts(true), { id: 'drafted' }, saved, 'own'), undefined);
});

test('people and departments follow the host\'s caps on a free run and the scenario elsewhere', () => {
  assert.equal(effectivePeople(facts(true), mars, 'host'), 30);
  assert.equal(effectivePeople(facts(true), mars, 'own'), 100);
  assert.equal(effectiveDepartments(facts(true), mars, 'host'), 3);
  assert.equal(effectiveDepartments(facts(false), mars, 'server'), 5);
  assert.equal(effectiveDepartments(facts(true), { ...mars, departments: [] }, 'host'), undefined);
});

test('events a turn: the scenario\'s cap, 2 when it names none, never more than 3', () => {
  assert.equal(eventsPerTurn(mars), 2);
  const { maxEventsPerTurn: _drop, ...noCap } = mars.setup;
  assert.equal(eventsPerTurn({ ...mars, setup: noCap }), 2);
  assert.equal(eventsPerTurn({ ...mars, setup: { ...mars.setup, maxEventsPerTurn: 5 } }), 3);
});

test('figuresLine: each figure kept with its unit, the parts set apart by middle dots', () => {
  assert.equal(
    figuresLine({ people: 30, departments: 3, turns: 6, events: 2 }),
    `30${NBSP}people · 3${NBSP}departments · 6${NBSP}turns · up to 2${NBSP}events a turn`,
  );
  assert.equal(
    figuresSpoken({ people: 30, departments: 3, turns: 6, events: 2 }),
    `30${NBSP}people, 3${NBSP}departments, 6${NBSP}turns, up to 2${NBSP}events a turn`,
  );
  // A scenario with no departments leaves that figure out.
  assert.equal(figuresLine({ people: 1, turns: 1, events: 1 }), `1${NBSP}person · 1${NBSP}turn · up to 1${NBSP}event a turn`);
});

test('effectiveLaunch: the body Start posts on the host\'s keys', () => {
  const none = { overrides: {}, lastLaunch: null };
  const launch = effectiveLaunch(facts(true), lunar, none, 2, 'host');
  // Lunar Outpost runs 8 turns; a run on the host's keys is cut to 6, in the words and in the body alike.
  assert.equal(launch.turns, 6);
  assert.equal(launch.body.turns, effectiveTurns(facts(true), lunar, none, 'host'));
  assert.equal(launch.body.seed, lunar.setup.defaultSeed);
  assert.equal(launch.body.captureSnapshots, true);
  assert.deepEqual(launch.body.quickstart, { scenarioId: 'lunar-outpost' });
  // The scenario's two written leaders, as it wrote them.
  const written = lunar.presets[0].leaders ?? [];
  assert.equal(written.length, 2);
  assert.deepEqual(launch.body.actors, written.map((l) => ({ name: l.name, archetype: l.archetype, hexaco: l.hexaco, instructions: l.instructions })));
  // No key saved, so none is posted; the words name no provider or models.
  assert.equal('apiKey' in launch.body, false);
  assert.equal('anthropicKey' in launch.body, false);
  assert.equal(launch.provider, undefined);
  assert.equal(launch.models, undefined);
  assert.equal(launch.batch, undefined);
  assert.deepEqual(
    { payer: launch.payer, size: launch.size, people: launch.people, departments: launch.departments, events: launch.events },
    { payer: 'host', size: 2, people: 30, departments: 3, events: 2 },
  );
});

test('effectiveLaunch: the visitor\'s keys, provider, models and economics go into the body', () => {
  const settings = {
    overrides: { openai: 'sk-test', anthropic: 'test-anthropic-key', serper: 'serper-key' },
    lastLaunch: {
      scenarioId: 'mars-genesis',
      turns: 12,
      provider: 'anthropic',
      models: { commander: 'model-a', departments: 'model-b', judge: 'model-a' },
      economics: { profileId: 'balanced', batch: { maxConcurrency: 5 } },
    },
  };
  const launch = effectiveLaunch(facts(true), mars, settings, 2, 'own');
  assert.equal(launch.body.apiKey, 'sk-test');
  assert.equal(launch.body.anthropicKey, 'test-anthropic-key');
  assert.equal(launch.body.serperKey, 'serper-key');
  assert.equal(launch.body.provider, 'anthropic');
  assert.deepEqual(launch.body.models, settings.lastLaunch.models);
  assert.deepEqual(launch.body.economics, { profileId: 'balanced', batchConcurrency: 5 });
  assert.equal(launch.body.turns, 12);
  assert.equal(launch.turns, 12);
  assert.equal(launch.body.seed, 950);
  // The words read the same launch.
  assert.equal(launch.provider, 'anthropic');
  assert.deepEqual(launch.models, settings.lastLaunch.models);
  assert.equal(launch.batch, 5);
  assert.equal(providerName(launch.provider ?? ''), 'Anthropic');
  assert.equal(modelNames(launch.models ?? {}), 'model-a, model-b');

  // The same last launch on the host's keys: the body is the same, and the words name no provider or models.
  const hosted = effectiveLaunch(facts(true), mars, { overrides: {}, lastLaunch: settings.lastLaunch }, 2, 'host');
  assert.equal(hosted.provider, undefined);
  assert.equal(hosted.models, undefined);
  assert.equal(hosted.body.turns, 6);

  // No economics, or a batch size that is no whole number above 0: no batch.
  for (const economics of [undefined, {}, { batch: {} }, { batch: { maxConcurrency: 0 } }, { batch: { maxConcurrency: 2.5 } }, { batch: { maxConcurrency: '8' } }]) {
    const last = { ...settings.lastLaunch, economics };
    assert.equal(effectiveLaunch(facts(false), mars, { overrides: {}, lastLaunch: last }, 2, 'server').batch, undefined, JSON.stringify(economics));
  }
});

test('effectiveLaunch: the words name the last launch\'s provider and models only when the saved key runs on that provider', () => {
  const last = { scenarioId: 'mars-genesis', provider: 'openai', models: { commander: 'model-a', departments: 'model-b' } };
  // One saved key decides the provider the server runs on (inferProviderFromKeys in src/cli/sim-config.ts), whatever the last launch named.
  const other = effectiveLaunch(facts(true), mars, { overrides: { anthropic: 'test-anthropic-key' }, lastLaunch: last }, 24, 'own');
  assert.equal(other.provider, undefined);
  assert.equal(other.models, undefined);
  // The body is the one the launch has always posted: the server works the provider out from it.
  assert.equal(other.body.provider, 'openai');
  assert.equal(other.body.anthropicKey, 'test-anthropic-key');
  assert.deepEqual(other.body.models, last.models);

  // The saved key is the last launch's provider's: both are named.
  const same = effectiveLaunch(facts(true), mars, { overrides: { openai: 'sk-test' }, lastLaunch: last }, 24, 'own');
  assert.equal(same.provider, 'openai');
  assert.deepEqual(same.models, last.models);
  // A key for each provider: the last launch's provider decides, on the page as on the server.
  const both = effectiveLaunch(facts(true), mars, { overrides: { openai: 'sk-test', anthropic: 'test-anthropic-key' }, lastLaunch: { ...last, provider: 'anthropic' } }, 24, 'own');
  assert.equal(both.provider, 'anthropic');
  assert.deepEqual(both.models, last.models);
});

test('effectiveLaunch: a run larger than the written leaders posts none, so the launch writes them', () => {
  const settings = { overrides: { openai: 'sk-test' }, lastLaunch: null };
  const three = effectiveLaunch(facts(true), mars, settings, 3, 'own');
  assert.equal(three.size, 3);
  assert.equal('actors' in three.body, false);
  assert.deepEqual(three.body, { apiKey: 'sk-test', turns: 6, seed: 950, captureSnapshots: true, quickstart: { scenarioId: 'mars-genesis' } });
  // A scenario that writes no leaders posts none at a pair either.
  const unwritten = effectiveLaunch(facts(true), { ...mars, presets: [] }, settings, 2, 'own');
  assert.equal('actors' in unwritten.body, false);
});

test('keyProviderName: the provider whose key is saved, where the saved keys tell which', () => {
  assert.equal(keyProviderName({ overrides: { openai: 'sk-test' }, lastLaunch: null }), 'OpenAI');
  assert.equal(keyProviderName({ overrides: { anthropic: 'test-anthropic-key' }, lastLaunch: null }), 'Anthropic');
  assert.equal(keyProviderName({ overrides: { openai: 'sk-test', anthropic: 'test-anthropic-key' }, lastLaunch: null }), undefined);
  assert.equal(keyProviderName({ overrides: { openai: 'sk-test', anthropic: 'test-anthropic-key' }, lastLaunch: { provider: 'anthropic' } }), 'Anthropic');
  assert.equal(keyProviderName({ overrides: {}, lastLaunch: null }), undefined);
});

test('minutesForTurns and formatMinutes: 34 seconds a turn, to the nearest half minute', () => {
  assert.equal(minutesForTurns(6), 3.5);
  assert.equal(minutesForTurns(8), 4.5);
  assert.equal(minutesForTurns(12), 7);
  assert.equal(formatMinutes(3.5), '3½');
  assert.equal(formatMinutes(4), '4');
  assert.equal(formatMinutes(0.5), '½');
});

test('Start\'s second line and spoken name follow who pays and the run\'s size', () => {
  const free = { who: 'host' as const, size: 2, turns: 6, minutes: minutesForTurns(6) };
  assert.equal(startSecondLine(free), `6${NBSP}turns, about 3½${NBSP}minutes`);
  assert.equal(startSpoken({ ...free, scenario: 'Mars Genesis' }), 'Start Mars Genesis: 6 turns, about 3 and a half minutes');
  assert.equal(startSpoken({ ...free, turns: 7, minutes: minutesForTurns(7), scenario: 'Mars Genesis' }), 'Start Mars Genesis: 7 turns, about 4 minutes');
  assert.equal(startSecondLine({ who: 'host', size: 2, turns: 1, minutes: minutesForTurns(1) }), `1${NBSP}turn, about ½${NBSP}minute`);
  assert.equal(startSpoken({ who: 'host', size: 2, turns: 1, minutes: minutesForTurns(1), scenario: 'Mars Genesis' }), 'Start Mars Genesis: 1 turn, about half a minute');

  const own = { who: 'own' as const, size: 2, turns: 6, minutes: 0 };
  assert.equal(startSecondLine(own), `6${NBSP}turns, on your own API key`);
  assert.equal(startSecondLine({ ...own, size: 24 }), `24${NBSP}leaders, 6${NBSP}turns, on your own API key`);
  assert.equal(startSpoken({ ...own, size: 24, scenario: 'Mars Genesis' }), 'Start Mars Genesis: 24 leaders, 6 turns, on your own API key');
  assert.equal(startSecondLine({ ...own, who: 'server', size: 300 }), `300${NBSP}leaders, 6${NBSP}turns, on this server’s API keys`);
  assert.equal(startSpoken({ ...own, who: 'server', scenario: 'Mars Genesis' }), 'Start Mars Genesis: 6 turns, on this server’s API keys');
});

test('effectiveLaunch preserves written orders and omits blank orders for both preset aliases', () => {
  const preset = mars.presets[0];
  const written = preset.leaders ?? [];
  assert.equal(written.length, 2);
  const instructions = '  Keep the reserve.\nWait.  ';
  const leaders = [
    { ...written[0], description: 'Check the stores.', instructions: ' \t\n' },
    { ...written[1], instructions },
  ];
  for (const alias of ['leaders', 'actors'] as const) {
    const scenario = { ...mars, presets: [{ id: preset.id, label: preset.label, [alias]: leaders }] };
    const launch = effectiveLaunch(facts(false), scenario, { overrides: {}, lastLaunch: null }, 2, 'server');
    const posted = JSON.parse(JSON.stringify(launch.body));
    assert.deepEqual(posted.actors.map((actor: { name: string }) => actor.name), written.map(leader => leader.name));
    assert.equal(Object.hasOwn(posted.actors[0], 'instructions'), false, alias);
    assert.equal(posted.actors[0].description, 'Check the stores.', alias);
    assert.equal(posted.actors[1].instructions, instructions, alias);
  }
});

test('effectiveLaunch omits orders a hand-written scenario gives as something other than text', () => {
  const preset = mars.presets[0];
  const written = preset.leaders ?? [];
  // A scenario file is read as JSON without a check on its preset leaders.
  const scenario = JSON.parse(JSON.stringify({
    ...mars,
    presets: [{ id: preset.id, label: preset.label, leaders: [
      { ...written[0], instructions: 42 },
      { ...written[1], instructions: ['Keep the reserve.'] },
    ] }],
  })) as typeof mars;
  const launch = effectiveLaunch(facts(false), scenario, { overrides: {}, lastLaunch: null }, 2, 'server');
  const posted = JSON.parse(JSON.stringify(launch.body));
  assert.deepEqual(posted.actors.map((actor: { name: string }) => actor.name), written.map(leader => leader.name));
  for (const actor of posted.actors) assert.equal(Object.hasOwn(actor, 'instructions'), false, actor.name);
});

test('the rate policy and run settings bound the turns sent by Start', () => {
  const server = facts(true);
  Object.assign(server.rateLimit, parseRateLimit({ allowed: true, remaining: 1, limit: 1, resetAt: 1, turns: 5 }));
  server.adminConfig = parseAdminConfig({ hostedDemo: true, demoCaps: { maxTurns: 6 }, run: { maxTurns: 7 } });
  const settings = { overrides: {}, lastLaunch: null };
  assert.equal(effectiveLaunch(server, lunar, settings, 2, 'host').body.turns, 5);
  const short = { ...lunar, setup: { ...lunar.setup, defaultTurns: 4 } };
  assert.equal(effectiveLaunch(server, short, settings, 2, 'host').body.turns, 4);
  assert.equal(effectiveLaunch(server, lunar, settings, 2, 'own').body.turns, 7);
});

test('batch uses the explicit request, saved resolution or default for the selected profile', () => {
  const server = facts(true);
  server.adminConfig = parseAdminConfig({ hostedDemo: true, batch: { maxConcurrency: 5 } });
  for (const [economics, batch, posted] of [
    [undefined, 5, undefined],
    [{ profileId: 'quality' }, undefined, { profileId: 'quality' }],
    [{ profileId: 'quality', batch: { maxConcurrency: 4 } }, 4, { profileId: 'quality', batchConcurrency: 4 }],
    [{ profileId: 'quality', batch: { maxConcurrency: 4 }, batchConcurrency: 3 }, 3, { profileId: 'quality', batchConcurrency: 3 }],
    [{ batchConcurrency: 1.5 }, 5, {}],
  ] as const) {
    const launch = effectiveLaunch(server, mars, { overrides: {}, lastLaunch: { economics } }, 24, 'own');
    assert.equal(launch.batch, batch);
    assert.deepEqual(launch.body.economics, posted);
  }
});
