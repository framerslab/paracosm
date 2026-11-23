/**
 * The actor picker's search, sort and choices, on a run of 24 actors whose
 * names and archetypes are those of the 24-actor fixture: four hold "strat"
 * (A7 The Strategist, A11 Mira Stratford, A15 The Strategist and A19
 * Tobias Strathmore), and labels run A1 to A24, so A1 and A10 to A19 share
 * a first digit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActorSummary } from '../../hooks/useToolRegistry';
import { matchActors, pickedActors, pickerState, selectShown, sortActors } from './actorPicker.helpers';

const PEOPLE: Array<[string, string]> = [
  ['Aria Chen', 'The Visionary'], ['Dietrich Voss', 'The Engineer'], ['Mei Tanaka', 'The Diplomat'],
  ['Omar Haddad', 'The Pragmatist'], ['Lucia Ferrante', 'The Guardian'], ['Kwame Mensah', 'The Pioneer'],
  ['Ines Duarte', 'The Strategist'], ['Tomas Novak', 'The Steward'], ['Priya Raman', 'The Skeptic'],
  ['Elias Lindqvist', 'The Builder'], ['Mira Stratford', 'The Mediator'], ['Santiago Ruiz', 'The Explorer'],
  ['Hana Kobayashi', 'The Analyst'], ['Farid Rahimi', 'The Caretaker'], ['Jonas Keller', 'The Strategist'],
  ['Amara Okoye', 'The Visionary'], ['Viktor Sokolov', 'The Engineer'], ['Leila Nasser', 'The Diplomat'],
  ['Tobias Strathmore', 'The Pragmatist'], ['Chloe Martin', 'The Guardian'], ['Rafael Costa', 'The Pioneer'],
  ['Sofia Petrova', 'The Steward'], ['Daniel Abebe', 'The Skeptic'], ['Yuki Mori', 'The Builder'],
];

/** Each actor's tools and forges that did not pass: several share a count, so ties fall back to the run's order. */
const TOOLS = [14, 12, 11, 9, 13, 8, 14, 10, 10, 12, 9, 11, 13, 8, 12, 10, 11, 14, 9, 12, 10, 13, 11, 15];
const DID_NOT_PASS = [3, 1, 4, 0, 3, 4, 2, 0, 3, 1, 2, 4, 0, 1, 2, 3, 4, 1, 0, 2, 3, 1, 2, 0];

const ACTORS: ActorSummary[] = PEOPLE.map(([name, archetype], index): ActorSummary => ({
  index,
  label: `A${index + 1}`,
  name,
  archetype,
  counts: {
    tools: TOOLS[index],
    forges: TOOLS[index] + 1,
    reforges: 1,
    passed: TOOLS[index] + 1 - DID_NOT_PASS[index],
    didNotPass: DID_NOT_PASS[index],
  },
  strip: [],
  status: 'done',
  unreadable: false,
}));

const labels = (actors: ActorSummary[]): string[] => actors.map((actor) => actor.label);

test('"strat" finds the names and archetypes that hold it, in any case', () => {
  assert.deepEqual(labels(matchActors(ACTORS, 'strat')), ['A7', 'A11', 'A15', 'A19']);
  assert.deepEqual(labels(matchActors(ACTORS, '  STRAT ')), ['A7', 'A11', 'A15', 'A19']);
  assert.deepEqual(labels(matchActors(ACTORS, '')), labels(ACTORS));
  assert.deepEqual(matchActors(ACTORS, 'zzz'), []);
});

test('a slot label finds that actor alone: "A17" finds A17, and "A1" finds A1 and not A10 to A19', () => {
  assert.deepEqual(labels(matchActors(ACTORS, 'A17')), ['A17']);
  assert.deepEqual(labels(matchActors(ACTORS, 'a1')), ['A1']);
  assert.deepEqual(labels(matchActors(ACTORS, 'A01')), ['A1']);
  assert.deepEqual(matchActors(ACTORS, 'A25'), []);
});

test('Sort: Most forges that did not pass orders by that count, then by the run\'s order', () => {
  const sorted = sortActors(ACTORS, 'didNotPass');
  assert.deepEqual(labels(sorted), ['A3', 'A6', 'A12', 'A17', 'A1', 'A5', 'A9', 'A16', 'A21',
    'A7', 'A11', 'A15', 'A20', 'A23', 'A2', 'A10', 'A14', 'A18', 'A22', 'A4', 'A8', 'A13', 'A19', 'A24']);
  // Most tools, ties in the run's order; Run order puts the list back; the list given is left as it was.
  assert.deepEqual(labels(sortActors(ACTORS, 'tools')).slice(0, 4), ['A24', 'A1', 'A7', 'A18']);
  assert.deepEqual(labels(sortActors(sorted, 'run')), labels(ACTORS));
  assert.equal(ACTORS[0].label, 'A1');
});

test('Select shown checks every actor the search shows, keeps the ones chosen, and stops at a max', () => {
  const shown = matchActors(ACTORS, 'strat');
  assert.deepEqual([...selectShown(new Set([0]), shown)].sort((a, b) => a - b), [0, 6, 10, 14, 18]);
  // In Compare, up to eight chosen in all: the ones shown are added in the order shown until eight are.
  const sixChosen = new Set([0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...selectShown(sixChosen, shown, 8)], [0, 1, 2, 3, 4, 5, 6, 10]);
  // The set given is left as it was.
  assert.equal(sixChosen.size, 6);
});

test('the picker cannot list a run that holds tools and no actor, and a choice narrows only between none and every actor', () => {
  assert.equal(pickerState([], 12), 'error');
  assert.equal(pickerState([], 0), 'ready');
  assert.equal(pickerState(ACTORS, 286), 'ready');
  assert.equal(pickedActors([], 24), null);
  assert.deepEqual(pickedActors([6, 0, 2, 2, 30, -1], 24), [0, 2, 6]);
  assert.equal(pickedActors(ACTORS.map((actor) => actor.index), 24), null);
});
