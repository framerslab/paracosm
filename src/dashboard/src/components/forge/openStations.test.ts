/**
 * The stations a trace opens with, and the set a visitor opened, kept on this
 * device for each run. The tools are the dashboard's own reading of a run's
 * events: the events go through the game state reducer, the registry is built
 * from that state, and each tool's line is read from its entry, as the trace
 * reads it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from '../../hooks/useSSE';
import { computeGameState } from '../../hooks/useGameState';
import { buildToolRegistry } from '../../hooks/toolRegistry.helpers';
import { forgeLineModel } from './forgeLine';
import {
  OPEN_STATIONS_KEY,
  initialOpen,
  keepStations,
  readKeptStations,
  recordEvidence,
  runKeyOf,
} from './openStations';

/** The device's storage, as the page holds it, for one test. */
function deviceStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => { items.delete(key); },
    setItem: (key: string, value: string) => { items.set(key, String(value)); },
  };
}

const ARIA = 'Aria Chen';
const at = (turn: number) => ({ turn, time: 2035 + (turn - 1) * 8 });

/** A department's report in turn 1: its start, the forge of one tool, and the report listing it. */
function forgedAndReported(department: string, name: string, approved: boolean, second: number): SimEvent[] {
  return [
    { type: 'specialist_start', leader: ARIA, data: { ...at(1), department, eventIndex: 0 } },
    {
      type: 'forge_attempt',
      leader: ARIA,
      data: {
        ...at(1), eventIndex: 0, department, name, description: `Forged by ${department}.`, mode: 'sandbox',
        approved, confidence: approved ? 0.95 : 0, inputFields: ['reserve_litres'], outputFields: ['index'],
        timestamp: `2026-11-16T01:52:${String(second).padStart(2, '0')}.000Z`,
        ...(approved ? {} : { errorReason: 'The output did not match the declared output schema.' }),
      },
    },
    {
      type: 'specialist_done',
      leader: ARIA,
      data: {
        ...at(1), department, summary: `${department} report for turn 1.`, eventIndex: 0, citations: 0, citationList: [], risks: [],
        forgedTools: [{
          name, description: `Forged by ${department}.`, mode: 'sandbox', approved, confidence: approved ? 0.95 : 0,
          inputFields: ['reserve_litres'], outputFields: ['index'], output: approved ? JSON.stringify({ index: 0.7 }) : null,
          department, isNew: true, firstForgedTurn: 1, firstForgedDepartment: department,
        }],
        recommendedActions: [],
      },
    },
  ];
}

const run = buildToolRegistry(computeGameState([
  ...forgedAndReported('engineering', 'mars_landing_site_score', true, 10),
  ...forgedAndReported('medical', 'radiation_dose_budget', false, 20),
], true));

const passed = run.getEntryFor(0, 'mars_landing_site_score')!;
const didNotPass = run.getEntryFor(0, 'radiation_dose_budget')!;
const opening = (entry: typeof passed, kept: Parameters<typeof initialOpen>[1]) =>
  [...initialOpen(forgeLineModel(entry, Number.NaN), kept, recordEvidence(entry.outcome === 'passed'))].sort();

test('the stations kept on this run open beside the station that decided the outcome', () => {
  const storage = deviceStorage();
  keepStations(storage, 'session-1', ['request', 'added']);
  const kept = readKeptStations(storage, 'session-1');
  assert.deepEqual(kept, ['request', 'added']);
  // Judge decided the passed tool, and the two kept stations open beside it.
  assert.deepEqual(opening(passed, kept), ['added', 'judge', 'request']);
  // With nothing kept, the trace opens on Judge alone.
  assert.deepEqual(opening(passed, []), ['judge']);
});

test('a kept station with no evidence on this tool stays closed', () => {
  const storage = deviceStorage();
  keepStations(storage, 'session-1', ['judge', 'added', 'code']);
  // The tool that did not pass opens on Request; its Judge and Added hold nothing, and no tool's Code holds anything.
  assert.deepEqual(opening(didNotPass, readKeptStations(storage, 'session-1')), ['request']);
  assert.deepEqual(opening(passed, readKeptStations(storage, 'session-1')), ['added', 'judge']);
});

test('a 21st run drops the oldest run\'s set', () => {
  const storage = deviceStorage();
  for (let n = 1; n <= 21; n++) keepStations(storage, `session-${n}`, ['request']);
  assert.deepEqual(readKeptStations(storage, 'session-1'), []);
  assert.deepEqual(readKeptStations(storage, 'session-2'), ['request']);
  assert.deepEqual(readKeptStations(storage, 'session-21'), ['request']);
  assert.equal(Object.keys(JSON.parse(storage.getItem(OPEN_STATIONS_KEY)!)).length, 20);
  // Writing a run again makes it the newest, so the next run drops the one after it.
  keepStations(storage, 'session-2', ['added']);
  keepStations(storage, 'session-22', ['judge']);
  assert.deepEqual(readKeptStations(storage, 'session-2'), ['added']);
  assert.deepEqual(readKeptStations(storage, 'session-3'), []);
});

test('a stored value that is not JSON reads as no set, and the next write replaces it', () => {
  const storage = deviceStorage();
  storage.setItem(OPEN_STATIONS_KEY, '{not json');
  assert.deepEqual(readKeptStations(storage, 'session-1'), []);
  assert.deepEqual(opening(passed, readKeptStations(storage, 'session-1')), ['judge']);
  // A set holding names that are not stations keeps the stations alone, in the line's order.
  storage.setItem(OPEN_STATIONS_KEY, JSON.stringify({ 'session-1': ['added', 'record', 7, 'request', 'added'] }));
  assert.deepEqual(readKeptStations(storage, 'session-1'), ['request', 'added']);
  keepStations(storage, 'session-1', ['judge']);
  assert.deepEqual(JSON.parse(storage.getItem(OPEN_STATIONS_KEY)!), { 'session-1': ['judge'] });
});

test('two live runs with different run keys keep two sets', () => {
  const storage = deviceStorage();
  // A live run has no replay id in its address, so its run key names it.
  const first = runKeyOf('https://paracosm.agentos.sh/sim?tab=sim', 'run-a');
  const second = runKeyOf('https://paracosm.agentos.sh/sim?tab=sim', 'run-b');
  assert.deepEqual([first, second], ['run-a', 'run-b']);
  keepStations(storage, first, ['request']);
  keepStations(storage, second, ['added']);
  assert.deepEqual(readKeptStations(storage, first), ['request']);
  assert.deepEqual(readKeptStations(storage, second), ['added']);
  // A replay is named by its session's id, and a page with neither by 'live'.
  assert.equal(runKeyOf('https://paracosm.agentos.sh/sim?replay=5f0c&tab=sim', 'run-a'), '5f0c');
  assert.equal(runKeyOf('https://paracosm.agentos.sh/sim', null), 'live');
});
