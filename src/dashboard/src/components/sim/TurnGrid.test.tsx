import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { TurnGrid } from './TurnGrid.js';
import type { GameState, ActorSideState, ProcessedEvent } from '../../hooks/useGameState.js';
import { ScenarioContext } from '../../App.js';

// Minimal stub for the ScenarioContext value. EventCard reads
// `scenario.ui.departmentIcons[dept]` for the dept name prefix; an
// empty object satisfies the access without rendering an icon.
const stubScenario = {
  ui: { departmentIcons: {}, headerMetrics: [] },
  presets: [],
  labels: {},
} as unknown as React.ContextType<typeof ScenarioContext>;

function withScenario(node: React.ReactNode) {
  return <ScenarioContext.Provider value={stubScenario}>{node}</ScenarioContext.Provider>;
}

function side(name: string, events: ProcessedEvent[], pop: number, morale: number): ActorSideState {
  return {
    leader: { name, archetype: 'A', unit: 'U', hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 }, instructions: '', quote: '' },
    metrics: null, prevMetrics: null, event: null, events,
    popHistory: [pop], moraleHistory: [morale],
    deaths: 0, deathCauses: {}, tools: 0, toolNames: new Set(),
    citations: 0, decisions: 0, pendingDecision: '', pendingRationale: '',
    pendingReasoning: '', pendingPolicies: [], outcome: null,
    agentSnapshots: [], currentEvents: [],
  } as ActorSideState;
}

function evt(turn: number, type: string, data: Record<string, unknown> = {}): ProcessedEvent {
  return { id: `${type}-${turn}`, type, turn, data };
}

const baseState = (eventsA: ProcessedEvent[], eventsB: ProcessedEvent[]): GameState => ({
  actors: {
    'A': side('Mayor A', eventsA, 30, 0.86),
    'B': side('Mayor B', eventsB, 30, 0.86),
  },
  actorIds: ['A', 'B'],
  turn: 1,
  maxTurns: 6,
  isRunning: true,
  isComplete: false,
  meta: null,
  cost: null,
} as unknown as GameState);

test('TurnGrid: empty state when neither leader has events', () => {
  const html = renderToString(withScenario(<TurnGrid state={baseState([], [])} />));
  assert.match(html, /No turns yet/);
});

test('TurnGrid: renders one row per past turn', () => {
  // Use only `turn_start` events — they carry a valid turn number for
  // classifyTurn to detect the turn, but TurnRow filters them out
  // before they reach EventCard. This keeps the test off the
  // EventCard render path (EventCard transitively imports many
  // shared components whose React-imports differ per-file). The
  // resulting classification is `pending` for both turns.
  //
  // Leader names used to be asserted here too because TurnGrid carried
  // its own compact-ActorBar sticky header. That header was a duplicate
  // of SimView's `leadersRow` directly above it, so we removed it and
  // SimView now owns the leader strip exclusively. Test asserts only
  // on what TurnGrid still renders: turn rows.
  const a = [evt(1, 'turn_start')];
  const b = [evt(1, 'turn_start')];
  const html = renderToString(withScenario(<TurnGrid state={baseState(a, b)} />));
  assert.match(html, /id="turn-row-1"/);
  assert.ok(!html.includes('id="turn-row-2"'), 'no row for a turn that does not exist yet');
});
