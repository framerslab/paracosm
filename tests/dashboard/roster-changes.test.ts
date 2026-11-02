/**
 * The swarm grid flares and sounds its births and deaths from the difference
 * between two turn snapshots. A person who left the roster is neither, and a
 * grown hire is not a birth.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterChanges } from '../../src/dashboard/src/components/viz/grid/roster-changes.js';

const cell = (agentId: string, alive = true, age = 40) => ({ agentId, alive, age });

test('a child new to the roster is a birth and a grown hire is not', () => {
  const { born, died } = rosterChanges(
    [cell('a')],
    [cell('a'), cell('newborn', true, 0), cell('hire', true, 34)],
  );
  assert.deepEqual(born.map(c => c.agentId), ['newborn']);
  assert.deepEqual(died, []);
});

test('someone who died is a death and someone who left the roster is not', () => {
  const { born, died } = rosterChanges(
    [cell('stays'), cell('dies'), cell('leaves'), cell('long gone', false)],
    [cell('stays'), cell('dies', false), cell('long gone', false)],
  );
  assert.deepEqual(born, []);
  assert.deepEqual(died.map(c => c.agentId), ['dies']);
});

test('a snapshot with no age reads a new person as a birth, as saved runs always have', () => {
  const { born } = rosterChanges([], [{ agentId: 'x', alive: true }]);
  assert.deepEqual(born.map(c => c.agentId), ['x']);
});
