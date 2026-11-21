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
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  effectiveDepartments,
  effectivePeople,
  effectiveTurns,
  eventsPerTurn,
  figuresLine,
  figuresSpoken,
  payer,
  readLaunchSettings,
  type LaunchScenario,
} from '../../../src/dashboard/src/components/quickstart/first-screen/effectiveLaunch.js';
import type { ServerFacts } from '../../../src/dashboard/src/components/quickstart/first-screen/useServerFacts.js';

const scenarioFile = (name: string): LaunchScenario =>
  JSON.parse(readFileSync(new URL(`../../../scenarios/${name}`, import.meta.url), 'utf-8')) as LaunchScenario;
const mars = scenarioFile('mars.json');
const lunar = scenarioFile('lunar.json');

/** The server's answers as the hosted demo gives them (caps of 6 turns, 30 people, 3 departments), or as a self-hosted server does. */
function facts(hostedDemo: boolean): ServerFacts {
  return {
    rateLimit: { status: 'ready', refresh: async () => {} },
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
