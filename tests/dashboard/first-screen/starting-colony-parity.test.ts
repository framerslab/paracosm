/**
 * The key people the Run tab's shared panel draws are the key people the
 * run starts with.
 *
 * The page works them out from the scenario GET /scenario sends
 * (keyPeopleOf); the server works them out when the run is posted
 * (normalizeSimulationConfig, and applyDemoCaps on a run on the host's
 * keys). For each bundled scenario that names key people, and for both
 * kinds of run, the two lists are the same people in the same order. A
 * scenario with labels longer than the hosted demo's cap pins the page's
 * copy of that cap to the server's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lunarScenario, marsScenario } from '../../../src/engine/scenarios/index.js';
import {
  DEMO_EXECUTION,
  applyDemoCaps,
  normalizeSimulationConfig,
  type SimulationSetupPayload,
} from '../../../src/cli/sim-config.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';
import {
  HOST_PAID_LABEL_CHARS,
  keyPeopleOf,
} from '../../../src/dashboard/src/components/quickstart/first-screen/startingColony.js';
import type { ScenarioClientPayload } from '../../../src/dashboard/src/hooks/useScenario.js';

/** The parts of a scenario the server sends the page that the panel reads (projectScenarioForClient in src/server/server-app.ts sends the presets whole). */
const projectionOf = (scenario: ScenarioPackage): Pick<ScenarioClientPayload, 'id' | 'presets'> =>
  JSON.parse(JSON.stringify({ id: scenario.id, presets: scenario.presets ?? [] })) as Pick<ScenarioClientPayload, 'id' | 'presets'>;

/** The body the Run tab posts for a pair: the scenario's first two written leaders. */
const launchBody = (scenario: ScenarioPackage): SimulationSetupPayload => {
  const preset = (scenario.presets ?? [])[0] as { leaders?: unknown[]; actors?: unknown[] } | undefined;
  const written = preset?.leaders ?? preset?.actors ?? [];
  return { actors: written.slice(0, 2) as SimulationSetupPayload['actors'] };
};

interface Person { name: string; department: string; role: string; specialization: string; age: number; featured: boolean }
const fields = (p: Person): Person =>
  ({ name: p.name, department: p.department, role: p.role, specialization: p.specialization, age: p.age, featured: p.featured });

for (const scenario of [marsScenario, lunarScenario]) {
  const name = scenario.labels.name;
  const defaultPopulation = scenario.setup.defaultPopulation ?? 100;

  test(`${name}: a run on the host's keys starts with the key people the panel draws`, () => {
    const run = applyDemoCaps(normalizeSimulationConfig(launchBody(scenario), scenario));
    const shown = keyPeopleOf(projectionOf(scenario), Math.min(defaultPopulation, DEMO_EXECUTION.maxPopulation), true);
    assert.ok(shown.length > 0, `${name} names key people`);
    assert.deepEqual(shown.map(fields), run.keyPersonnel.map(fields));
  });

  test(`${name}: a run on a key starts with the key people the panel draws`, () => {
    const run = normalizeSimulationConfig(launchBody(scenario), scenario);
    const shown = keyPeopleOf(projectionOf(scenario), defaultPopulation, false);
    assert.ok(shown.length > 0, `${name} names key people`);
    assert.deepEqual(shown.map(fields), run.keyPersonnel.map(fields));
  });
}

test('labels longer than the hosted demo\'s cap are cut on the page as the server cuts them', () => {
  const long = (letter: string) => letter.repeat(HOST_PAID_LABEL_CHARS + 180);
  const presets = (marsScenario.presets ?? []).map((preset, index) => (index === 0
    ? {
        ...preset,
        personnel: (preset.personnel ?? []).map((p, i) => (i === 0 ? { ...p, name: long('N'), role: long('R'), specialization: long('S') } : p)),
      }
    : preset));
  const scenario = { ...marsScenario, presets } as ScenarioPackage;

  const run = applyDemoCaps(normalizeSimulationConfig(launchBody(scenario), scenario));
  const shown = keyPeopleOf(projectionOf(scenario), Math.min(scenario.setup.defaultPopulation ?? 100, DEMO_EXECUTION.maxPopulation), true);
  assert.equal(run.keyPersonnel[0].name.length, HOST_PAID_LABEL_CHARS);
  assert.deepEqual(shown.map(fields), run.keyPersonnel.map(fields));

  // On a key nothing is cut, on the page or on the server.
  const keyedRun = normalizeSimulationConfig(launchBody(scenario), scenario);
  const keyedShown = keyPeopleOf(projectionOf(scenario), scenario.setup.defaultPopulation ?? 100, false);
  assert.equal(keyedRun.keyPersonnel[0].name.length, HOST_PAID_LABEL_CHARS + 180);
  assert.deepEqual(keyedShown.map(fields), keyedRun.keyPersonnel.map(fields));
});
