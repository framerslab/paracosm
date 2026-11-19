/**
 * The forge's line on a run's record. Each tool here is the dashboard's own
 * reading of a run's events: the events go through the game state reducer,
 * the registry is built from that state, and the line is read from the
 * registry's entry, as the trace and the toolbox read it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from '../../hooks/useSSE';
import { computeGameState } from '../../hooks/useGameState';
import { buildToolRegistry } from '../../hooks/toolRegistry.helpers';
import { STATIONS, forgeLineModel, lineColour } from './forgeLine';

const ARIA = 'Aria Chen';
const at = (turn: number) => ({ turn, time: 2035 + (turn - 1) * 8 });

/** A forge_attempt event as the orchestrator sends it when a forge ends. */
function forgeEnded(turn: number, department: string, name: string, approved: boolean, second: number): SimEvent {
  return {
    type: 'forge_attempt',
    leader: ARIA,
    data: {
      ...at(turn), eventIndex: 0, department, name,
      description: `Forged by ${department}.`, mode: 'sandbox',
      approved, confidence: approved ? 0.95 : 0,
      inputFields: ['reserve_litres'], outputFields: ['index'],
      timestamp: `2026-11-16T01:52:${String(second).padStart(2, '0')}.000Z`,
      ...(approved ? {} : { errorReason: 'Forged code here is synchronous: define a plain `function execute(input) { ... }` that returns its result directly.' }),
    },
  };
}

/** A department's report in a turn's first event: its start, its forges, and the report listing its tools. */
function departmentReport(turn: number, department: string, forges: SimEvent[], tools: Array<Record<string, unknown>>): SimEvent[] {
  return [
    { type: 'specialist_start', leader: ARIA, data: { ...at(turn), department, eventIndex: 0 } },
    ...forges,
    {
      type: 'specialist_done',
      leader: ARIA,
      data: { ...at(turn), department, summary: `${department} report for turn ${turn}.`, eventIndex: 0, citations: 0, citationList: [], risks: [], forgedTools: tools, recommendedActions: [] },
    },
  ];
}

/** A tool as a report lists it. */
const listed = (name: string, department: string, firstForgedTurn: number, approved: boolean) => ({
  name, description: `Forged by ${department}.`, mode: 'sandbox', approved, confidence: approved ? 0.95 : 0,
  inputFields: ['reserve_litres'], outputFields: ['index'], output: JSON.stringify({ index: 0.7 }),
  department, isNew: firstForgedTurn === 1, firstForgedTurn, firstForgedDepartment: department,
});

// Aria Chen's run: a tool that passed on its one forge, a tool whose one forge
// did not pass and that no report lists, and a tool that did not pass in turn 1
// and passed when it was forged again in turn 2.
const run = buildToolRegistry(computeGameState([
  ...departmentReport(1, 'engineering', [forgeEnded(1, 'engineering', 'mars_landing_site_score', true, 10)], [listed('mars_landing_site_score', 'engineering', 1, true)]),
  ...departmentReport(1, 'agriculture', [forgeEnded(1, 'agriculture', 'water_ration_index', false, 20)], []),
  ...departmentReport(2, 'engineering', [forgeEnded(2, 'engineering', 'dust_storm_shelter_plan', false, 30)], []),
  ...departmentReport(2, 'agriculture', [forgeEnded(2, 'agriculture', 'water_ration_index', true, 40)], [listed('water_ration_index', 'agriculture', 1, true)]),
], true));

const passedOnce = run.getEntryFor(0, 'mars_landing_site_score')!;
const didNotPassOnce = run.getEntryFor(0, 'dust_storm_shelter_plan')!;
const reforged = run.getEntryFor(0, 'water_ration_index')!;

test('an approved forge of a run with no trace fills five stations and opens Judge', () => {
  const m = forgeLineModel(passedOnce, 1);
  assert.deepEqual(STATIONS.map((s) => m.stations[s]), ['reached', 'reached', 'reached', 'reached', 'reached']);
  assert.equal(m.stop, null);
  assert.equal(m.deciding, 'judge');
  assert.deepEqual([m.spurs, m.branch], [[], null]);
});

test('a forge that did not pass reads Request reached, three unknown and Added not reached', () => {
  const m = forgeLineModel(didNotPassOnce, 1);
  assert.deepEqual(STATIONS.map((s) => m.stations[s]), ['reached', 'unknown', 'unknown', 'unknown', 'notReached']);
  assert.equal(m.stop, null);
  assert.equal(m.deciding, 'request');
});

test('the latest attempt of a re-forged tool carries a spur after Request for the attempt before it', () => {
  assert.equal(reforged.attempts.length, 2);
  const latest = forgeLineModel(reforged, 2);
  assert.deepEqual(latest.spurs, [{ attempt: 1, station: 'request', outcome: 'did_not_pass' }]);
  assert.equal(latest.branch, null);
  assert.equal(latest.deciding, 'judge');
  const first = forgeLineModel(reforged, 1);
  assert.deepEqual(first.branch, { attempt: 2, station: 'request', outcome: 'passed' });
  assert.deepEqual(first.spurs, []);
  assert.deepEqual(STATIONS.map((s) => first.stations[s]), ['reached', 'unknown', 'unknown', 'unknown', 'notReached']);
  // An attempt number the tool does not hold, kept in an old address, reads as the nearest one it does.
  assert.deepEqual(forgeLineModel(reforged, 9), latest);
});

test('a report-only tool reads from its report', () => {
  // A run saved before forge events were sent: the tool is in its department's report alone.
  const reportOnly = buildToolRegistry(computeGameState(
    departmentReport(1, 'engineering', [], [listed('mars_landing_site_score', 'engineering', 1, true)]),
    true,
  )).getEntryFor(0, 'mars_landing_site_score')!;
  assert.deepEqual(reportOnly.attempts, []);
  const m = forgeLineModel(reportOnly, 1);
  assert.deepEqual(STATIONS.map((s) => m.stations[s]), ['reached', 'reached', 'reached', 'reached', 'reached']);
  assert.equal(m.deciding, 'judge');
  assert.deepEqual([m.spurs, m.branch], [[], null]);
});

test('the line takes the run colour on a pair and the quiet tone from three actors', () => {
  assert.equal(lineColour(0, 2), 'var(--vis)');
  assert.equal(lineColour(1, 2), 'var(--eng)');
  assert.equal(lineColour(2, 24), 'var(--forge-quiet)');
  assert.equal(lineColour(299, 300), 'var(--forge-quiet)');
});
