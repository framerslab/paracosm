/**
 * The colony the Run tab's shared panel draws before a run: the scenario's
 * key people as the grid's turn 0.
 *
 * - Each cell carries the values the engine starts a key person with: alive,
 *   of senior rank, a psych score of 0.8, a neutral mood, no children.
 * - The people are the `default` preset's, else the first preset's; a run on
 *   the host's keys keeps as many as the capped population holds and cuts
 *   each label to 120 characters; a run on a key keeps them as written.
 * - A scenario with no key people gives no cells.
 *
 * The scenario is the bundled Mars Genesis, read from scenarios/mars.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_PAID_LABEL_CHARS,
  keyPeopleOf,
  keyPeopleSnapshot,
  type KeyPerson,
} from '../../../src/dashboard/src/components/quickstart/first-screen/startingColony.js';
import type { ScenarioClientPayload } from '../../../src/dashboard/src/hooks/useScenario.js';

type Presets = Pick<ScenarioClientPayload, 'presets'>;

const mars = JSON.parse(readFileSync(new URL('../../../scenarios/mars.json', import.meta.url), 'utf-8')) as Presets & {
  setup: { defaultStartTime: number; defaultPopulation: number };
};

const person = (name: string, department = 'engineering', featured = true): KeyPerson =>
  ({ name, department, role: 'Senior Engineer', specialization: 'Structures', age: 40, featured });
const preset = (id: string, personnel: KeyPerson[]): Presets['presets'][number] => ({ id, label: id, personnel });

test('Mars Genesis: five key people in four departments, as the scenario writes them', () => {
  const people = keyPeopleOf(mars, 30, true);
  assert.deepEqual(people.map((p) => p.name), ['Dr. Yuki Tanaka', 'Erik Lindqvist', 'Amara Osei', 'Dr. Priya Singh', 'Carlos Fernandez']);
  assert.deepEqual(people.map((p) => p.department), ['medical', 'engineering', 'agriculture', 'psychology', 'engineering']);
  assert.deepEqual(keyPeopleOf(mars, mars.setup.defaultPopulation, false), people);
});

test('the snapshot is turn 0, each cell at the values the engine starts a key person with', () => {
  const people = keyPeopleOf(mars, 30, true);
  const snapshot = keyPeopleSnapshot(people, mars.setup.defaultStartTime);
  assert.equal(snapshot.turn, 0);
  assert.equal(snapshot.time, mars.setup.defaultStartTime);
  assert.equal(snapshot.births, 0);
  assert.equal(snapshot.deaths, 0);
  assert.equal(snapshot.population, people.length);
  assert.equal(snapshot.cells.length, people.length);
  snapshot.cells.forEach((cell, index) => {
    assert.equal(cell.agentId, `key-${index}`);
    assert.equal(cell.name, people[index].name);
    assert.equal(cell.department, people[index].department);
    assert.equal(cell.role, people[index].role);
    assert.equal(cell.age, people[index].age);
    assert.equal(cell.featured, people[index].featured);
    assert.equal(cell.mood, 'neutral');
    assert.equal(cell.rank, 'senior');
    assert.equal(cell.alive, true);
    assert.equal(cell.marsborn, false);
    assert.equal(cell.psychScore, 0.8);
    assert.equal(cell.generation, 0);
    assert.deepEqual(cell.childrenIds, []);
    assert.deepEqual(cell.shortTermMemory, []);
  });
});

test('no key people gives no cells', () => {
  assert.deepEqual(keyPeopleOf({ presets: [] }, 30, true), []);
  assert.deepEqual(keyPeopleOf({ presets: [preset('default', [])] }, 30, true), []);
  assert.deepEqual(keyPeopleOf({ presets: [{ id: 'default', label: 'Default' }] }, 100, false), []);
  const snapshot = keyPeopleSnapshot([], 2035);
  assert.deepEqual(snapshot.cells, []);
  assert.equal(snapshot.population, 0);
  assert.equal(snapshot.turn, 0);
});

test('the people are the default preset\'s, else the first preset\'s', () => {
  const first = preset('first', [person('Ada One')]);
  const named = preset('default', [person('Ben Two'), person('Cy Three')]);
  assert.deepEqual(keyPeopleOf({ presets: [first, named] }, 30, false).map((p) => p.name), ['Ben Two', 'Cy Three']);
  assert.deepEqual(keyPeopleOf({ presets: [first] }, 30, false).map((p) => p.name), ['Ada One']);
});

test('a run on the host\'s keys keeps the capped population\'s people and cuts each label; a run on a key keeps them as written', () => {
  const long = 'N'.repeat(HOST_PAID_LABEL_CHARS + 80);
  const people = [
    { ...person(long), role: long, specialization: long },
    person('Ben Two', 'medical'),
    person('Cy Three', '', false),
  ];
  const scenario = { presets: [preset('default', people)] };

  const hostPaid = keyPeopleOf(scenario, 2, true);
  assert.equal(hostPaid.length, 2);
  assert.equal(hostPaid[0].name.length, HOST_PAID_LABEL_CHARS);
  assert.equal(hostPaid[0].role.length, HOST_PAID_LABEL_CHARS);
  assert.equal(hostPaid[0].specialization.length, HOST_PAID_LABEL_CHARS);
  assert.equal(hostPaid[1].name, 'Ben Two');

  const keyed = keyPeopleOf(scenario, 2, false);
  assert.equal(keyed.length, 3);
  assert.equal(keyed[0].name, long);
  assert.equal(keyPeopleSnapshot(keyed, 0).cells[2].featured, false);
});
