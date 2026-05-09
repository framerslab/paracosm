/**
 * Pure-logic tests for EventLogPanel's filter helpers. Helpers file
 * stays DOM-free so it runs under node:test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from '../../hooks/useSSE';
import {
  applyLogFilters,
  emptyFilters,
  extractAvailableFacets,
  parseFiltersFromUrl,
  serializeFiltersToUrl,
  type LogFilters,
} from './EventLogPanel.helpers.js';

const mk = (
  type: string,
  extras: Partial<SimEvent> & { data?: Record<string, unknown> } = {},
): SimEvent =>
  ({
    type,
    leader: extras.leader,
    turn: extras.turn,
    data: extras.data ?? {},
  }) as unknown as SimEvent;

const sample: SimEvent[] = [
  mk('turn_start', { leader: 'Aria', data: { turn: 1, title: 'Turn 1 founding' } }),
  mk('specialist_done', { leader: 'Aria', data: { turn: 1, department: 'medical', summary: 'food shortage risk' } }),
  mk('decision_made', { leader: 'Aria', data: { turn: 1, title: 'Evacuate zone' } }),
  mk('turn_start', { leader: 'Vik', data: { turn: 1, title: 'Turn 1 founding' } }),
  mk('specialist_done', { leader: 'Vik', data: { turn: 1, department: 'engineering', summary: 'power grid stable' } }),
  mk('turn_done', { leader: 'Aria', data: { turn: 3 } }),
  mk('turn_done', { leader: 'Vik', data: { turn: 6 } }),
  mk('outcome', { data: { turn: 2, name: 'radiation_dose_calculator', forgedTools: [{ name: 'food_buffer' }] } }),
];

// -- emptyFilters ---------------------------------------------------------

test('emptyFilters: canonical empty state matches all events', () => {
  const filters = emptyFilters();
  assert.deepEqual(applyLogFilters(sample, filters), sample);
});

// -- applyLogFilters: query ----------------------------------------------

test('applyLogFilters: query matches title substring', () => {
  const filters = { ...emptyFilters(), query: 'evacuate' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'decision_made');
});

test('applyLogFilters: query matches summary substring (case-insensitive)', () => {
  const filters = { ...emptyFilters(), query: 'FOOD' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].data?.department, 'medical');
});

test('applyLogFilters: query matches type substring', () => {
  const filters = { ...emptyFilters(), query: 'turn_start' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => e.type === 'turn_start'));
});

test('applyLogFilters: query matches tool name', () => {
  const filters = { ...emptyFilters(), query: 'radiation' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'outcome');
});

test('applyLogFilters: empty query matches all', () => {
  const filters = { ...emptyFilters(), query: '' };
  assert.deepEqual(applyLogFilters(sample, filters), sample);
});

// -- applyLogFilters: types ----------------------------------------------

test('applyLogFilters: empty type set means all pass', () => {
  const filters = { ...emptyFilters(), types: new Set<string>() };
  assert.deepEqual(applyLogFilters(sample, filters), sample);
});

test('applyLogFilters: non-empty type set restricts', () => {
  const filters = { ...emptyFilters(), types: new Set(['turn_start', 'turn_done']) };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 4);
  assert.ok(out.every((e) => e.type === 'turn_start' || e.type === 'turn_done'));
});

// -- applyLogFilters: leader ---------------------------------------------

test('applyLogFilters: null leader filter includes all events (with or without leader)', () => {
  const filters = { ...emptyFilters(), leader: null };
  assert.deepEqual(applyLogFilters(sample, filters), sample);
});

test('applyLogFilters: specific leader excludes other leaders + events without leader', () => {
  const filters = { ...emptyFilters(), leader: 'Aria' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 4);
  assert.ok(out.every((e) => e.leader === 'Aria'));
});

// -- applyLogFilters: turn range -----------------------------------------

test('applyLogFilters: null turn range includes all events', () => {
  const filters = { ...emptyFilters(), turnRange: null };
  assert.deepEqual(applyLogFilters(sample, filters), sample);
});

test('applyLogFilters: turn range includes events inside + excludes outside', () => {
  const filters = { ...emptyFilters(), turnRange: [2, 5] as [number, number] };
  const out = applyLogFilters(sample, filters);
  // Only `outcome` (turn 2) and `turn_done` Aria (turn 3) qualify.
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => {
    const t = e.data?.turn as number | undefined;
    return typeof t === 'number' && t >= 2 && t <= 5;
  }));
});

test('applyLogFilters: turn range excludes events without a data.turn when range is set', () => {
  const events: SimEvent[] = [
    mk('status', { data: {} }),
    mk('turn_start', { data: { turn: 1 } }),
  ];
  const filters = { ...emptyFilters(), turnRange: [1, 1] as [number, number] };
  const out = applyLogFilters(events, filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'turn_start');
});

// -- applyLogFilters: tool hash ------------------------------------------

test('applyLogFilters: tool hash substring match on data.name', () => {
  const filters = { ...emptyFilters(), toolHash: 'radiation' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 1);
});

test('applyLogFilters: tool hash substring match on forgedTools entries', () => {
  const filters = { ...emptyFilters(), toolHash: 'food_buffer' };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'outcome');
});

// -- applyLogFilters: combined -------------------------------------------

test('applyLogFilters: combined filters AND together', () => {
  const filters = {
    ...emptyFilters(),
    types: new Set(['specialist_done']),
    leader: 'Aria',
  };
  const out = applyLogFilters(sample, filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].data?.department, 'medical');
});

// -- extractAvailableFacets ----------------------------------------------

test('extractAvailableFacets: empty events -> empty facets + maxTurn 0', () => {
  const f = extractAvailableFacets([]);
  assert.deepEqual(f.types, []);
  assert.deepEqual(f.actors, []);
  assert.equal(f.maxTurn, 0);
});

test('extractAvailableFacets: collects unique types + actors + max turn', () => {
  const f = extractAvailableFacets(sample);
  assert.deepEqual(f.types.sort(), ['decision_made', 'outcome', 'specialist_done', 'turn_done', 'turn_start']);
  assert.deepEqual(f.actors, ['Aria', 'Vik']);
  assert.equal(f.maxTurn, 6);
});

// -- URL round-trip -------------------------------------------------------

test('parseFiltersFromUrl: empty search + hash -> empty filters', () => {
  const f = parseFiltersFromUrl('', '');
  assert.deepEqual(f, emptyFilters());
});

test('parseFiltersFromUrl: populated params -> matching filters', () => {
  const f = parseFiltersFromUrl(
    '?logQuery=food&logTypes=turn_start,specialist_done&logLeader=Aria%20Chen&logTurnMin=2&logTurnMax=5',
    '',
  );
  assert.equal(f.query, 'food');
  assert.deepEqual([...f.types].sort(), ['specialist_done', 'turn_start']);
  assert.equal(f.leader, 'Aria Chen');
  assert.deepEqual(f.turnRange, [2, 5]);
});

test('parseFiltersFromUrl: legacy #log hash is picked up as toolHash', () => {
  const f = parseFiltersFromUrl('', '#log=radiation_calc');
  assert.equal(f.toolHash, 'radiation_calc');
});

test('serializeFiltersToUrl: empty filters -> empty string', () => {
  assert.equal(serializeFiltersToUrl(emptyFilters()), '');
});

test('serializeFiltersToUrl: round-trips via parse', () => {
  const original: LogFilters = {
    query: 'food',
    types: new Set(['turn_start', 'specialist_done']),
    leader: 'Aria Chen',
    turnRange: [2, 5],
    toolHash: '',
  };
  const qs = serializeFiltersToUrl(original);
  const reparsed = parseFiltersFromUrl(qs, '');
  assert.equal(reparsed.query, original.query);
  assert.deepEqual([...reparsed.types].sort(), [...original.types].sort());
  assert.equal(reparsed.leader, original.leader);
  assert.deepEqual(reparsed.turnRange, original.turnRange);
});

test('serializeFiltersToUrl: URL-encodes spaces + unicode', () => {
  const filters: LogFilters = {
    ...emptyFilters(),
    leader: 'Aria Chen',
    query: 'food & water',
  };
  const qs = serializeFiltersToUrl(filters);
  assert.ok(qs.includes('Aria%20Chen') || qs.includes('Aria+Chen'));
  const reparsed = parseFiltersFromUrl(qs, '');
  assert.equal(reparsed.leader, 'Aria Chen');
  assert.equal(reparsed.query, 'food & water');
});
