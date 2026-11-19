/**
 * The stream hook drops a frame whose key it has seen, so a buffer replay
 * after a reconnect does not add an event twice. Two forges of one tool by
 * one actor in one department call and one event are two events: their
 * frames differ only in the time the forge ended.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from './useSSE';
import { eventKey } from './sseEventKey';

function forgeEnded(timestamp: string): SimEvent {
  return {
    type: 'forge_attempt',
    leader: 'Aria Chen',
    data: {
      turn: 1, time: 2035, eventIndex: 0, department: 'agriculture',
      name: 'water_ration_index', description: 'Indexes the water ration against the reserve.',
      approved: false, confidence: 0, timestamp,
    },
  };
}

test('two forges of one tool in one department call keep two keys, and a repeated frame keeps one', () => {
  const first = forgeEnded('2026-11-16T01:52:10.000Z');
  const second = forgeEnded('2026-11-16T01:52:14.000Z');
  assert.notEqual(eventKey(first), eventKey(second));
  assert.equal(eventKey(first), eventKey(structuredClone(first)));
});
