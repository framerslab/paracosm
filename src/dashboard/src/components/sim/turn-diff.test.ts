import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTurn, computeTurnDiff, type TurnDiffEntry } from './turn-diff.js';
import type { ProcessedEvent } from '../../hooks/useGameState.js';

function evtStart(turn: number, title: string): ProcessedEvent {
  return { id: `s-${turn}`, type: 'event_start', turn, data: { title, eventIndex: 0, totalEvents: 1, category: 'cat' } };
}

function evtOutcome(turn: number, outcome: string): ProcessedEvent {
  return { id: `o-${turn}`, type: 'outcome', turn, data: { outcome, _decision: 'd', turn } };
}

test('classifyTurn: same title + same outcome → same', () => {
  const a = [evtStart(1, 'Hurricane'), evtOutcome(1, 'risky_success')];
  const b = [evtStart(1, 'Hurricane'), evtOutcome(1, 'risky_success')];
  const e = classifyTurn(a, b, 1) as TurnDiffEntry;
  assert.equal(e.classification, 'same');
  assert.equal(e.titleA, 'Hurricane');
  assert.equal(e.titleB, 'Hurricane');
  assert.equal(e.outcomeA, 'risky_success');
  assert.equal(e.outcomeB, 'risky_success');
});

test('classifyTurn: same title + different outcome → different-outcome', () => {
  const a = [evtStart(1, 'Hurricane'), evtOutcome(1, 'risky_success')];
  const b = [evtStart(1, 'Hurricane'), evtOutcome(1, 'conservative_failure')];
  const e = classifyTurn(a, b, 1) as TurnDiffEntry;
  assert.equal(e.classification, 'different-outcome');
});

test('classifyTurn: different titles → different-event', () => {
  const a = [evtStart(1, 'Hurricane'), evtOutcome(1, 'risky_success')];
  const b = [evtStart(1, 'Levee Failure'), evtOutcome(1, 'risky_success')];
  const e = classifyTurn(a, b, 1) as TurnDiffEntry;
  assert.equal(e.classification, 'different-event');
});

test('classifyTurn: both started, neither has outcome → pending', () => {
  const a = [evtStart(2, 'Hurricane')];
  const b = [evtStart(2, 'Hurricane')];
  const e = classifyTurn(a, b, 2) as TurnDiffEntry;
  assert.equal(e.classification, 'pending');
  assert.equal(e.outcomeA, '');
  assert.equal(e.outcomeB, '');
});

test('classifyTurn: only one side has outcome → pending', () => {
  const a = [evtStart(2, 'Hurricane'), evtOutcome(2, 'risky_success')];
  const b = [evtStart(2, 'Hurricane')];
  const e = classifyTurn(a, b, 2) as TurnDiffEntry;
  assert.equal(e.classification, 'pending');
});

test('classifyTurn: only A has events for the turn → one-sided', () => {
  const a = [evtStart(3, 'Hurricane'), evtOutcome(3, 'risky_success')];
  const b: ProcessedEvent[] = [];
  const e = classifyTurn(a, b, 3) as TurnDiffEntry;
  assert.equal(e.classification, 'one-sided');
  assert.equal(e.titleA, 'Hurricane');
  assert.equal(e.titleB, '');
});

test('classifyTurn: neither side has events for the turn → null', () => {
  const a = [evtStart(1, 'X')];
  const b = [evtStart(1, 'X')];
  const e = classifyTurn(a, b, 99);
  assert.equal(e, null);
});

test('computeTurnDiff: walks all turns present in either side, returns sorted Map', () => {
  const a = [
    evtStart(1, 'T1A'), evtOutcome(1, 'risky_success'),
    evtStart(2, 'T2A'),
    evtStart(3, 'T3'), evtOutcome(3, 'risky_success'),
  ];
  const b = [
    evtStart(1, 'T1A'), evtOutcome(1, 'risky_success'),
    evtStart(2, 'T2B'), evtOutcome(2, 'risky_success'),
    evtStart(3, 'T3'), evtOutcome(3, 'conservative_failure'),
  ];
  const m = computeTurnDiff(a, b);
  const turns = [...m.keys()];
  assert.deepEqual(turns, [1, 2, 3]);
  assert.equal(m.get(1)?.classification, 'same');
  assert.equal(m.get(2)?.classification, 'pending');
  assert.equal(m.get(3)?.classification, 'different-outcome');
});
