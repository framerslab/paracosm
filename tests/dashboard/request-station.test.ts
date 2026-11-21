/**
 * Request on the run's record shows the fields of the attempt on show. A
 * department's first report holds the tool's schema; a re-forge can declare
 * other fields, and its forge_attempt frame names them. Each state is the
 * dashboard's own reading of the frames, and the station is rendered as the
 * trace renders it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { buildToolRegistry } from '../../src/dashboard/src/hooks/toolRegistry.helpers.js';
import { computeGameState } from '../../src/dashboard/src/hooks/useGameState.js';
import { RequestStation } from '../../src/dashboard/src/components/forge/stations/RequestStation.js';
import { forge, frame, framesToSimEvents, leaderTurn, tool } from '../../tests-e2e/support/run-frames.js';
import { ARIA, DIETRICH } from '../../tests-e2e/support/pair-run.js';

// The dashboard's components compile with the classic JSX transform under the test runner.
(globalThis as { React?: unknown }).React = React;

const NAME = 'water_ration_index';
const TEXT = 'Indexes the water ration against the reserve.';
const FIRST_SCHEMA = {
  type: 'object',
  properties: { reserve_litres: { type: 'number', description: 'Water in the reserve.' } },
  required: ['reserve_litres'],
};

/** Aria Chen forges the tool in turn 1 with one field, and forges it again in turn 2 with another. */
function reforgedWithOtherFields() {
  const state = computeGameState(framesToSimEvents([
    frame('status', { phase: 'starting', maxTurns: 2, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),
    ...leaderTurn(ARIA.name, 1, 'agriculture',
      [forge(ARIA.name, 1, 2035, 'agriculture', NAME, TEXT, 0, { approved: false, inputFields: ['reserve_litres'], outputFields: ['ration'] })],
      [tool(NAME, TEXT, 'agriculture', 1, true, 0, { approved: false, inputFields: ['reserve_litres'], outputFields: ['ration'], inputSchema: FIRST_SCHEMA })]),
    ...leaderTurn(ARIA.name, 2, 'agriculture',
      [forge(ARIA.name, 2, 2043, 'agriculture', NAME, TEXT, 0.91, { inputFields: ['crew_count', 'days_left'], outputFields: ['ration'] })],
      [tool(NAME, TEXT, 'agriculture', 1, false, 0.91, { inputFields: ['crew_count', 'days_left'], outputFields: ['ration'] })]),
    frame('complete', { timestamp: '2026-11-16T01:55:39.000Z' }),
  ]), true);
  const entry = buildToolRegistry(state).getEntryFor(0, NAME);
  assert.ok(entry, 'Aria Chen holds the tool');
  assert.equal(entry.attempts.length, 2);
  return entry;
}

const render = (entry: ReturnType<typeof reforgedWithOtherFields>, attempt: number) => renderToString(React.createElement(RequestStation, {
  entry,
  attempt: entry.attempts[attempt - 1],
  actor: { label: 'A1', name: ARIA.name, archetype: ARIA.archetype, colour: 'var(--vis)' },
  onGoToEvent: () => {},
}));

test('a re-forge that declares other fields shows its own fields, not the first report\'s schema', () => {
  const entry = reforgedWithOtherFields();
  const second = render(entry, 2);
  assert.match(second, /crew_count/);
  assert.match(second, /days_left/);
  assert.doesNotMatch(second, /reserve_litres/, 'the first forge\'s field is not the second forge\'s');
});

test('the attempt the schema came from shows the schema\'s types', () => {
  const entry = reforgedWithOtherFields();
  const first = render(entry, 1);
  assert.match(first, /reserve_litres/);
  assert.match(first, /Water in the reserve\./);
  assert.doesNotMatch(first, /crew_count/);
});
