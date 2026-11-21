/**
 * Request on the run's record shows the fields of the attempt on show. A
 * department's first report holds the tool's schema; a re-forge can declare
 * other fields, and its forge_attempt event names them. The tool is the
 * dashboard's own reading of a run's events: the events go through the game
 * state reducer, the registry is built from that state, and the station is
 * rendered as the trace renders it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import type { SimEvent } from '../../../hooks/useSSE';
import { computeGameState } from '../../../hooks/useGameState';
import { buildToolRegistry } from '../../../hooks/toolRegistry.helpers';
import { RequestStation } from './RequestStation';

// The dashboard's components compile with the classic JSX transform under the test runner.
(globalThis as { React?: unknown }).React = React;

const ARIA = 'Aria Chen';
const NAME = 'water_ration_index';
const TEXT = 'Indexes the water ration against the reserve.';
const at = (turn: number) => ({ turn, time: 2035 + (turn - 1) * 8 });
const FIRST_SCHEMA = {
  type: 'object',
  properties: { reserve_litres: { type: 'number', description: 'Water in the reserve.' } },
  required: ['reserve_litres'],
};

/** A forge_attempt event as the orchestrator sends it when a forge ends. */
function forgeEnded(turn: number, approved: boolean, inputFields: string[], second: number): SimEvent {
  return {
    type: 'forge_attempt',
    leader: ARIA,
    data: {
      ...at(turn), eventIndex: 0, department: 'agriculture', name: NAME, description: TEXT, mode: 'sandbox',
      approved, confidence: approved ? 0.91 : 0, inputFields, outputFields: ['ration'],
      timestamp: `2026-11-16T01:52:${String(second).padStart(2, '0')}.000Z`,
    },
  };
}

/** The agriculture department's report in a turn's first event: its start, its forge, and the report listing the tool. */
function report(turn: number, forge: SimEvent, tool: Record<string, unknown>): SimEvent[] {
  return [
    { type: 'specialist_start', leader: ARIA, data: { ...at(turn), department: 'agriculture', eventIndex: 0 } },
    forge,
    {
      type: 'specialist_done',
      leader: ARIA,
      data: { ...at(turn), department: 'agriculture', summary: `agriculture report for turn ${turn}.`, eventIndex: 0, citations: 0, citationList: [], risks: [], forgedTools: [tool], recommendedActions: [] },
    },
  ];
}

/** The tool as a report lists it. */
const listed = (approved: boolean, inputFields: string[], more: Record<string, unknown> = {}) => ({
  name: NAME, description: TEXT, mode: 'sandbox', approved, confidence: approved ? 0.91 : 0,
  inputFields, outputFields: ['ration'], output: JSON.stringify({ ration: 2.5 }),
  department: 'agriculture', isNew: !approved, firstForgedTurn: 1, firstForgedDepartment: 'agriculture', ...more,
});

// Aria Chen forges the tool in turn 1 with one field, and its first report
// holds that field's schema; she forges it again in turn 2 with two other fields.
const entry = buildToolRegistry(computeGameState([
  ...report(1, forgeEnded(1, false, ['reserve_litres'], 10), listed(false, ['reserve_litres'], { inputSchema: FIRST_SCHEMA })),
  ...report(2, forgeEnded(2, true, ['crew_count', 'days_left'], 40), listed(true, ['crew_count', 'days_left'])),
], true)).getEntryFor(0, NAME)!;

const render = (attempt: number) => renderToString(
  <RequestStation
    entry={entry}
    attempt={entry.attempts[attempt - 1]}
    actor={{ label: 'A1', name: ARIA, archetype: 'The Visionary', colour: 'var(--vis)' }}
    onGoToEvent={() => {}}
  />,
);

test('the run holds two forges of the tool, each with its own fields', () => {
  assert.equal(entry.attempts.length, 2);
  assert.deepEqual(entry.attempts.map((a) => a.inputFields), [['reserve_litres'], ['crew_count', 'days_left']]);
});

test('a re-forge that declares other fields shows its own fields, not the first report\'s schema', () => {
  const second = render(2);
  assert.match(second, /crew_count/);
  assert.match(second, /days_left/);
  assert.doesNotMatch(second, /reserve_litres/, 'the first forge\'s field is not the second forge\'s');
});

test('the attempt whose fields the schema declares shows the schema\'s types and descriptions', () => {
  const first = render(1);
  assert.match(first, /reserve_litres/);
  assert.match(first, /Water in the reserve\./);
  assert.doesNotMatch(first, /crew_count/);
});
