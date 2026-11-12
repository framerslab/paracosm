/**
 * Every supply a bundled scenario marks as sustaining its people passes
 * the rules a scenario compiled from a prompt keeps its marks under.
 *
 * A scenario marks a field of `world.metrics` or `world.capacities` with
 * `"sustains": true`, and the yearly age and accident rates then read how
 * much of each marked supply the colony holds against day one. A compile
 * from a prompt drops a mark its rules refuse (`sustainsVeto`,
 * src/engine/compiler/seed-draft-world.ts). A scenario written by hand
 * keeps what its author wrote, so `lintSustainsMarks` reads its marks
 * against the same rules and these tests hold every file in scenarios/ to
 * them: the lint reports nothing, and the marks are the ones listed here.
 *
 * A scenario added to scenarios/ needs a line in MARKS, so a new mark is
 * read against the rules before it ships. The last test marks four fields
 * the bundled scenarios leave unmarked, each in a copy, and reads the
 * rule that refuses it: the lint reads these files, and says so when a
 * mark is wrong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSustainsMarks } from '../../../src/engine/compiler/validate.js';
import { lunarScenario, marsScenario } from '../../../src/engine/scenarios/index.js';

type Json = Record<string, any>;

const scenariosDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scenarios');

/** The supplies each bundled scenario marks, by the scenario's id. */
const MARKS: Record<string, string[]> = {
  'mars-genesis': ['powerKw', 'waterLitersPerDay', 'pressurizedVolumeM3', 'infrastructureModules', 'lifeSupportCapacity'],
  'lunar-outpost': ['powerKw', 'waterLitersPerDay', 'pressurizedVolumeM3', 'infrastructureModules', 'lifeSupportCapacity'],
  'deep-ocean-station': ['powerKw', 'oxygenReserveHours'],
  'atlas-lab': [],
  'corporate-quarterly': [],
  'dual-superintelligence-council': [],
  't2d-glp1-protocol': [],
};

/** Every scenario file in scenarios/: all but the knowledge bundles. */
const files = readdirSync(scenariosDir)
  .filter(name => name.endsWith('.json') && !name.endsWith('-knowledge.json'))
  .sort();
const read = (name: string): Json => JSON.parse(readFileSync(resolve(scenariosDir, name), 'utf-8'));

/** The fields a scenario marks, in the order the kernel reads them: metrics, then capacities. */
function marksOf(scenario: Json): string[] {
  return [scenario.world?.metrics, scenario.world?.capacities].flatMap(bag =>
    Object.entries((bag ?? {}) as Record<string, { sustains?: unknown }>)
      .filter(([, field]) => field?.sustains === true)
      .map(([key]) => key));
}

test('every scenario in scenarios/ has its marks listed here', () => {
  const ids = files.map(name => read(name).id as string);
  assert.deepEqual([...ids].sort(), Object.keys(MARKS).sort(), `scenarios/ holds ${JSON.stringify(ids)}`);
  assert.ok(files.length >= 7, `scenarios/ holds ${files.length} scenario files`);
});

for (const name of files) {
  test(`scenarios/${name}: the supplies it marks are the ones expected, and each passes the veto`, () => {
    const scenario = read(name);
    const expected = MARKS[scenario.id];
    assert.ok(expected, `MARKS lists ${scenario.id}`);
    assert.deepEqual(marksOf(scenario).sort(), [...expected].sort(), `the marks of ${scenario.id} (read ${JSON.stringify(marksOf(scenario))})`);
    const findings = lintSustainsMarks(scenario);
    assert.deepEqual(findings, [], `lintSustainsMarks reports nothing for ${scenario.id} (read ${JSON.stringify(findings)})`);
  });
}

test('Mars Genesis and Lunar Outpost as a run loads them, their tables in the array form, pass the same rules', () => {
  for (const scenario of [marsScenario, lunarScenario]) {
    const json = scenario as unknown as Json;
    assert.deepEqual(marksOf(json).sort(), [...MARKS[scenario.id]].sort(), `the marks of ${scenario.id}`);
    assert.deepEqual(lintSustainsMarks(json), [], `lintSustainsMarks reports nothing for ${scenario.id}`);
  }
});

test('a mark the rules refuse is reported with its rule: four fields the bundled scenarios leave unmarked, each marked in a copy', () => {
  const withMark = (name: string, key: string): Json => {
    const scenario = read(name);
    const field = scenario.world.metrics[key];
    assert.ok(field && field.sustains === undefined, `${name} declares ${key} and does not mark it`);
    field.sustains = true;
    return scenario;
  };
  const found = (scenario: Json) => lintSustainsMarks(scenario).map(f => [f.key, f.rule]);

  // Atlas Lab's runway is a plain stock a table moves, in a default run of five months.
  const runway = lintSustainsMarks(withMark('atlas-lab.json', 'runwayMonths'));
  assert.deepEqual(runway.map(f => [f.key, f.rule]), [['runwayMonths', 6]], `read ${JSON.stringify(runway)}`);
  assert.ok(runway[0].reason.includes('the default run spans 0.416667 years, under 5'), `read "${runway[0].reason}"`);

  // Q-Scope Corp's revenue is in USD.
  assert.deepEqual(found(withMark('corporate-quarterly.json', 'revenueArr')), [['revenueArr', 2]]);

  // The station's hull is a percent.
  assert.deepEqual(found(withMark('submarine.json', 'hullIntegrity')), [['hullIntegrity', 2]]);

  // Mars Genesis's food store would be a sixth mark: the sixth in the order
  // the world declares them is the life-support capacity, the one capacity.
  assert.deepEqual(found(withMark('mars.json', 'foodMonthsReserve')), [['lifeSupportCapacity', 7]]);
});
