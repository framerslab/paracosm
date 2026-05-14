/**
 * Pure-logic tests for the reference filter helpers. The React surface
 * is exercised by ReferencesSection.tsx in the browser; this file
 * locks down the projection that drives the actor + department
 * dropdowns so cohort runs (3+ actors) don't regress to a flat list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReferenceFilters, collectReferenceFacets } from './ReferencesSection';

type Entry = Parameters<typeof applyReferenceFilters>[0][number];

function mkEntry(n: number, text: string, actors: string[], depts: string[]): Entry {
  return {
    n,
    text,
    url: `https://example.com/${n}`,
    departments: new Set(depts),
    actorNames: new Set(actors),
  };
}

const fixtures: Entry[] = [
  mkEntry(1, 'Generation ship overview', ['Alice', 'Bob', 'Cleo'], ['engineering', 'medical']),
  mkEntry(2, 'Crew minimums paper',     ['Alice', 'Cleo'],         ['medical']),
  mkEntry(3, 'Reactor coolant report',  ['Alice'],                 ['engineering']),
  mkEntry(4, 'Year-18 transit note',    ['Bob'],                   ['engineering']),
];

test('collectReferenceFacets: dedupes + sorts actor and department lists', () => {
  const { actors, departments } = collectReferenceFacets(fixtures);
  assert.deepEqual(actors, ['Alice', 'Bob', 'Cleo']);
  assert.deepEqual(departments, ['engineering', 'medical']);
});

test('applyReferenceFilters: null actor + null dept returns full list', () => {
  const out = applyReferenceFilters(fixtures, null, null);
  assert.equal(out.length, fixtures.length);
});

test('applyReferenceFilters: actor filter narrows to citations naming that actor', () => {
  const out = applyReferenceFilters(fixtures, 'Bob', null);
  assert.deepEqual(out.map(e => e.n), [1, 4]);
});

test('applyReferenceFilters: department filter narrows to citations from that department', () => {
  const out = applyReferenceFilters(fixtures, null, 'medical');
  assert.deepEqual(out.map(e => e.n), [1, 2]);
});

test('applyReferenceFilters: combined filters intersect (AND, not OR)', () => {
  // Alice cited every entry; medical is on entries 1 + 2; intersection is {1, 2}.
  const out = applyReferenceFilters(fixtures, 'Alice', 'medical');
  assert.deepEqual(out.map(e => e.n), [1, 2]);
});

test('applyReferenceFilters: zero matches returns an empty array (component renders empty state)', () => {
  // Cleo cites entries 1 + 2; entry 1 is engineering+medical, entry 2 is medical-only.
  // Filtering by Cleo + engineering keeps only entry 1.
  const out = applyReferenceFilters(fixtures, 'Cleo', 'engineering');
  assert.deepEqual(out.map(e => e.n), [1]);
  // Now a combo with zero intersection: entry 4 is Bob-only / engineering-only;
  // pairing Bob with medical asks for a medical entry naming Bob, of which there
  // are none in the fixture set.
  const empty = applyReferenceFilters([fixtures[3]], 'Bob', 'medical');
  assert.deepEqual(empty, []);
});

test('applyReferenceFilters: unknown actor returns empty (does not throw)', () => {
  const out = applyReferenceFilters(fixtures, 'Nonexistent', null);
  assert.deepEqual(out, []);
});

test('collectReferenceFacets: empty input yields empty facets', () => {
  const { actors, departments } = collectReferenceFacets([]);
  assert.deepEqual(actors, []);
  assert.deepEqual(departments, []);
});
