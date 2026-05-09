import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { DivergenceRail } from './DivergenceRail.js';
import type { GameState, ActorSideState, ProcessedEvent } from '../../hooks/useGameState';

function side(name: string, events: ProcessedEvent[]): ActorSideState {
  return {
    leader: { name, archetype: 'A', unit: 'U', hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 }, instructions: '', quote: '' },
    metrics: null, prevMetrics: null, event: null, events,
    popHistory: [], moraleHistory: [],
    deaths: 0, deathCauses: {}, tools: 0, toolNames: new Set(),
    citations: 0, decisions: 0, pendingDecision: '', pendingRationale: '',
    pendingReasoning: '', pendingPolicies: [], outcome: null,
    agentSnapshots: [], currentEvents: [],
  } as ActorSideState;
}

function evt(turn: number, type: string, data: Record<string, unknown> = {}): ProcessedEvent {
  return { id: `${type}-${turn}`, type, turn, data };
}

const mkState = (a: ProcessedEvent[], b: ProcessedEvent[]): GameState => ({
  actors: { 'A': side('Mayor A', a), 'B': side('Mayor B', b) },
  actorIds: ['A', 'B'],
  turn: 1, maxTurns: 6, isRunning: true, isComplete: false,
  meta: null, cost: null,
} as unknown as GameState);

test('DivergenceRail: renders one pill per past turn with classification-driven aria-label', () => {
  const a = [
    evt(1, 'event_start', { title: 'T1' }), evt(1, 'outcome', { outcome: 'risky_success' }),
    evt(2, 'event_start', { title: 'T2A' }), evt(2, 'outcome', { outcome: 'risky_success' }),
  ];
  const b = [
    evt(1, 'event_start', { title: 'T1' }), evt(1, 'outcome', { outcome: 'risky_success' }),
    evt(2, 'event_start', { title: 'T2B' }), evt(2, 'outcome', { outcome: 'conservative_failure' }),
  ];
  const html = renderToString(<DivergenceRail state={mkState(a, b)} />);
  assert.match(html, /Jump to turn 1 — Same event, same outcome/);
  assert.match(html, /Jump to turn 2 — Different events/);
  assert.match(html, /T<!-- -->1/);
  assert.match(html, /T<!-- -->2/);
});

test('DivergenceRail: renders nothing when neither leader has events', () => {
  const html = renderToString(<DivergenceRail state={mkState([], [])} />);
  assert.equal(html, '');
});

test('DivergenceRail: pending classification renders dashed pill with running label', () => {
  const a = [evt(1, 'event_start', { title: 'T1' })];
  const b = [evt(1, 'event_start', { title: 'T1' })];
  const html = renderToString(<DivergenceRail state={mkState(a, b)} />);
  assert.match(html, /Jump to turn 1 — Turn is still running/);
});
