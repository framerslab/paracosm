import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { ActorDrillInModal } from './ActorDrillInModal.js';
import type { GameState, ActorSideState, ProcessedEvent } from '../../hooks/useGameState.js';

const flatHexaco = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 };

function makeActor(name: string, events: ProcessedEvent[]): ActorSideState {
  return {
    leader: { name, archetype: 'Visionary', unit: 'Alpha', hexaco: flatHexaco },
    metrics: null, prevMetrics: null, event: null,
    events,
    popHistory: [], moraleHistory: [],
    deaths: 0, deathCauses: {}, tools: 0, toolNames: new Set(),
    citations: 0, decisions: 0,
    pendingDecision: '', pendingRationale: '', pendingReasoning: '', pendingPolicies: [],
    outcome: null, agentSnapshots: [], currentEvents: [],
  };
}

function makeState(byName: Record<string, ActorSideState>): GameState {
  return {
    actors: byName,
    actorIds: Object.keys(byName),
    turn: 0, time: 0, maxTurns: 6, seed: 950,
    isRunning: false, isComplete: false,
    cost: { totalTokens: 0, totalCostUSD: 0, llmCalls: 0 },
    costByActor: {},
  } as unknown as GameState;
}

test('ActorDrillInModal: returns null when actorName is null', () => {
  const html = renderToString(
    <ActorDrillInModal actorName={null} state={makeState({})} actorIndex={0} onClose={() => {}} />,
  );
  assert.equal(html, '');
});

test('ActorDrillInModal: renders actor name in header', () => {
  const state = makeState({ Aria: makeActor('Aria', []) });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} />,
  );
  assert.match(html, /Aria/);
});

test('ActorDrillInModal: only shows the picked actor events, not other actors', () => {
  const ariaEvents: ProcessedEvent[] = [
    { id: 'e1', type: 'turn_start', turn: 1, data: { title: 'Aria T1 event' } },
  ];
  const bobEvents: ProcessedEvent[] = [
    { id: 'e2', type: 'turn_start', turn: 1, data: { title: 'Bob T1 event' } },
  ];
  const state = makeState({
    Aria: makeActor('Aria', ariaEvents),
    Bob: makeActor('Bob', bobEvents),
  });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} />,
  );
  assert.match(html, /Aria T1 event/);
  assert.ok(!html.includes('Bob T1 event'));
});

test('ActorDrillInModal: renders close button', () => {
  const state = makeState({ Aria: makeActor('Aria', []) });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} />,
  );
  assert.match(html, /aria-label="Close drill-in"/);
});

test('ActorDrillInModal: derives a Decisions section from decision_made events', () => {
  const events: ProcessedEvent[] = [
    { id: 'd1', type: 'decision_made', turn: 1, data: { choice: 'Conserve power', rationale: 'Margins first.' } },
    { id: 'e1', type: 'turn_start', turn: 1, data: { title: 'Storm hits' } },
  ];
  const state = makeState({ Aria: makeActor('Aria', events) });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} />,
  );
  assert.match(html, /Conserve power/);
});

test('ActorDrillInModal: dock mode renders dock wrapper class, not modal overlay', () => {
  const state = makeState({ Aria: makeActor('Aria', []) });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} mode="dock" />,
  );
  // Generated class names are hashed in the test stub but contain the
  // source class name as a substring. dockOverlay should appear
  // (fixed right rail), and the standard centered overlay should not.
  assert.match(html, /dockOverlay/, 'dock mode should render dockOverlay wrapper');
});

test('ActorDrillInModal: default mode is modal (centered overlay)', () => {
  const state = makeState({ Aria: makeActor('Aria', []) });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} />,
  );
  assert.match(html, /class="[^"]*overlay/, 'default render should use the centered overlay class, not the dock');
  assert.ok(!/dockOverlay/.test(html), 'default render must not include the dock wrapper');
});

test('ActorDrillInModal: dock mode omits aria-modal=true (dock is not modal)', () => {
  const state = makeState({ Aria: makeActor('Aria', []) });
  const html = renderToString(
    <ActorDrillInModal actorName="Aria" state={state} actorIndex={0} onClose={() => {}} mode="dock" />,
  );
  // aria-modal="true" forces SR users into the dialog; in dock mode
  // the user must still be able to interact with the SIM tab around
  // it, so the attribute is omitted.
  assert.ok(!/aria-modal="true"/.test(html), 'dock mode must not emit aria-modal=true');
});
