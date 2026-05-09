import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { TurnRow } from './TurnRow.js';
import type { TurnDiffEntry } from './turn-diff.js';
import type { ProcessedEvent } from '../../hooks/useGameState.js';

const sameEntry: TurnDiffEntry = {
  turn: 1,
  classification: 'same',
  titleA: 'Hurricane',
  titleB: 'Hurricane',
  outcomeA: 'risky_success',
  outcomeB: 'risky_success',
};

const diffEventEntry: TurnDiffEntry = {
  turn: 4,
  classification: 'different-event',
  titleA: 'Levee Overtopping',
  titleB: 'Phase-2 Demand Spike',
  outcomeA: 'conservative_failure',
  outcomeB: 'risky_success',
};

const noEvents: ProcessedEvent[] = [];

test('TurnRow: same → no row tint, single shared title, ✓ SAME badge', () => {
  const html = renderToString(<TurnRow entry={sameEntry} eventsA={noEvents} eventsB={noEvents} />);
  assert.match(html, /id="turn-row-1"/);
  // React SSR inserts <!-- --> between adjacent text+variable expressions
  // (e.g. `T{entry.turn}`), so the rendered HTML is `T<!-- -->1`.
  // Match the headerTurn span content directly instead of the bare `T1`.
  assert.match(html, /class="headerTurn">T<!-- -->1/);
  assert.match(html, /✓ SAME/);
  assert.match(html, /Hurricane/);
  assert.ok(!html.includes('differentOutcome'));
  assert.ok(!html.includes('differentEvent'));
});

test('TurnRow: different-event → split per-side titles, ⚠ DIFFERENT EVENT badge', () => {
  const html = renderToString(<TurnRow entry={diffEventEntry} eventsA={noEvents} eventsB={noEvents} />);
  assert.match(html, /id="turn-row-4"/);
  assert.match(html, /⚠ DIFFERENT EVENT/);
  assert.match(html, /Levee Overtopping/);
  assert.match(html, /Phase-2 Demand Spike/);
});

test('TurnRow: empty cell renders the placeholder text', () => {
  const html = renderToString(<TurnRow entry={sameEntry} eventsA={noEvents} eventsB={noEvents} />);
  const matches = html.match(/\(no events yet\)/g) ?? [];
  assert.equal(matches.length, 2);
});

test('TurnRow: empty cell on a one-sided row reads "Catching up to turn N…" not "(no events yet)"', () => {
  // Reproduces the production sync-bug-that-isn't, take two: Side B has
  // zero events for T6 because Side A reached T6 first in parallel.
  // The DiffBadge already shows "··· waiting" on the row header;
  // the empty cell should match that copy instead of suggesting the
  // run has stopped.
  const oneSidedEntry: TurnDiffEntry = {
    turn: 6,
    classification: 'one-sided',
    titleA: 'Legacy Assessment',
    titleB: '',
    outcomeA: 'pending',
    outcomeB: '',
  };
  // Side A's events go through PENDING_TYPES filter (specialist_start
  // alone), so the renderable list is empty and TurnRow shows the
  // in-flight summary for Side A — no EventCard is mounted, no
  // ScenarioContext is needed. We're only verifying Side B's branch
  // here, so this keeps the test isolated to the placeholder logic.
  const sideAEvents: ProcessedEvent[] = [
    { id: 'e-1', type: 'specialist_start', turn: 6, time: 0, data: { department: 'engineering' } },
  ];
  const html = renderToString(<TurnRow entry={oneSidedEntry} eventsA={sideAEvents} eventsB={noEvents} />);
  assert.match(html, /Catching up to turn (?:<!-- -->)?6/);
  assert.ok(!html.match(/<div [^>]*cellEmpty[^>]*>\(no events yet\)/), 'should not show "(no events yet)" for one-sided rows');
});

test('TurnRow: cell with only specialist_start + decision_pending shows in-flight summary, not blank', () => {
  // Reproduces the production sync-bug-that-isn't: parallel runs where
  // Side A is still mid-turn (departments analyzing, decision pending)
  // while Side B has finished. Without the pending-summary placeholder
  // the cell rendered empty whitespace beside Side B's full event list,
  // which the user reported as "WTF is wrong with the syncing of events".
  const pendingEvents: ProcessedEvent[] = [
    { id: 'evt-1', type: 'specialist_start', turn: 1, time: 0, data: { department: 'engineering' } },
    { id: 'evt-2', type: 'specialist_start', turn: 1, time: 0, data: { department: 'medical' } },
    { id: 'evt-3', type: 'decision_pending', turn: 1, time: 0, data: {} },
  ];
  const html = renderToString(<TurnRow entry={sameEntry} eventsA={pendingEvents} eventsB={noEvents} />);
  // Side A: in-flight summary visible.
  assert.match(html, /engineering, medical analyzing/);
  assert.match(html, /awaiting decision/);
  // Side B: still empty placeholder (control: only Side A is mid-flight).
  assert.match(html, /\(no events yet\)/);
  // Spinner element renders.
  assert.match(html, /spinner/);
});
