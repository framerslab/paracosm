/**
 * The colony a run starts from, as far as the page knows it before the run:
 * the scenario's key people, who are in every run, at the values the engine
 * gives each of them at turn 0.
 *
 * The page holds the key people already: GET /scenario sends the scenario's
 * presets whole. Every run starts with them: the server takes the `default`
 * preset's personnel, or the first preset's, and on a run on the host's keys
 * keeps as many as the capped population holds and cuts each name, role and
 * specialization to 120 characters. The engine then creates each alive, not
 * born in the settlement, of senior rank, with a psych score of 0.8, no
 * children and a neutral mood. Only their traits are drawn at random, and a
 * grid cell carries none. So each cell here carries the run's own starting
 * values, and nothing is invented.
 *
 * The rest of the colony (the run's population less the key people) is
 * generated when the run starts, so it is not drawn here.
 *
 * @module paracosm/dashboard/quickstart/first-screen/startingColony
 */
import type { ScenarioClientPayload } from '../../../hooks/useScenario.js';
import type { CellSnapshot, TurnSnapshot } from '../../viz/viz-types.js';

/**
 * The most characters of a key person's name, role and specialization on a
 * run on the host's keys: the hosted demo's label cap, DEMO_MAX_LABEL_CHARS
 * in src/cli/sim-config.ts. The parity test pins this copy to the server's.
 */
export const HOST_PAID_LABEL_CHARS = 120;

/** A key person as the scenario writes one. */
export interface KeyPerson {
  name: string;
  department: string;
  role: string;
  specialization: string;
  age: number;
  featured: boolean;
}

const cut = (value: string): string => value.slice(0, HOST_PAID_LABEL_CHARS);

/**
 * The key people a run of this scenario starts with: the personnel of the
 * preset named `default`, else of the first preset. On a run on the host's
 * keys, the first `population` of them, each name, role and specialization
 * cut to 120 characters, as the server cuts them; on a visitor's key or a
 * self-hosted server, all of them as written.
 */
export function keyPeopleOf(scenario: Pick<ScenarioClientPayload, 'presets'>, population: number, hostPaid: boolean): KeyPerson[] {
  const presets = scenario.presets ?? [];
  const preset = presets.find((p) => p.id === 'default') ?? presets[0];
  const people: KeyPerson[] = (preset?.personnel ?? []).map((p) => ({
    name: p.name,
    department: p.department,
    role: p.role,
    specialization: p.specialization,
    age: p.age,
    featured: p.featured,
  }));
  if (!hostPaid) return people;
  return people.slice(0, Math.max(0, population)).map((p) => ({
    ...p,
    name: typeof p.name === 'string' ? cut(p.name) : p.name,
    role: typeof p.role === 'string' ? cut(p.role) : p.role,
    specialization: typeof p.specialization === 'string' ? cut(p.specialization) : p.specialization,
  }));
}

/**
 * The key people as the grid's turn 0: one cell a person, each at the values
 * the engine starts a key person with. `startTime` is the scenario's own
 * start; no one has been born or has died, and morale has no reading yet.
 */
export function keyPeopleSnapshot(people: readonly KeyPerson[], startTime: number): TurnSnapshot {
  const cells: CellSnapshot[] = people.map((person, index) => ({
    agentId: `key-${index}`,
    name: person.name,
    department: person.department,
    role: person.role,
    rank: 'senior',
    alive: true,
    marsborn: false,
    psychScore: 0.8,
    age: person.age,
    generation: 0,
    childrenIds: [],
    featured: person.featured === true,
    mood: 'neutral',
    shortTermMemory: [],
  }));
  return { turn: 0, time: startTime, cells, population: cells.length, morale: 0, births: 0, deaths: 0 };
}
