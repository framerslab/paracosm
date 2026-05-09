import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { SwarmPanel } from './SwarmPanel.js';
import type { RunArtifact, SwarmAgent } from '../../../../engine/schema/index.js';

const a = (over: Partial<SwarmAgent>): SwarmAgent => ({
  agentId: over.agentId ?? 'a',
  name: over.name ?? 'Agent A',
  department: over.department ?? 'engineering',
  role: over.role ?? 'engineer',
  alive: over.alive ?? true,
  ...over,
});

const baseArtifact: RunArtifact = {
  metadata: {
    runId: 'r1',
    scenario: { id: 's', name: 'Test' },
    seed: 42,
    mode: 'turn-loop',
    startedAt: '2026-05-01T00:00:00.000Z',
    completedAt: '2026-05-01T00:01:00.000Z',
  },
  finalSwarm: {
    turn: 6,
    time: 6,
    population: 3,
    morale: 0.72,
    births: 1,
    deaths: 2,
    agents: [
      a({ agentId: 'a', name: 'Maria Chen', department: 'engineering', role: 'lead-engineer', mood: 'focused' }),
      a({ agentId: 'b', name: 'Jin Park', department: 'engineering', mood: 'anxious' }),
      a({ agentId: 'c', name: 'Ari Vega', department: 'agriculture', mood: 'focused' }),
      a({ agentId: 'd', name: 'Ren Cole', department: 'agriculture', alive: false, mood: 'despair' }),
    ],
  },
} as RunArtifact;

// React SSR splits adjacent text nodes with HTML comments
// (e.g., `T6` becomes `T<!-- -->6`). Match across the marker.
const c = '(<!-- -->)?';

test('SwarmPanel renders the title + population + morale', () => {
  const html = renderToString(<SwarmPanel artifact={baseArtifact} />);
  assert.match(html, /Agent swarm/);
  assert.match(html, new RegExp(`T${c}6`));
  assert.match(html, new RegExp(`3${c} alive`));
  assert.match(html, new RegExp(`72${c}%`));
});

test('SwarmPanel renders mood histogram (alive only)', () => {
  const html = renderToString(<SwarmPanel artifact={baseArtifact} />);
  assert.match(html, /Mood histogram/);
  assert.match(html, /focused/);
  assert.match(html, /anxious/);
  assert.doesNotMatch(html, /despair/, 'dead agents should not contribute to mood histogram');
});

test('SwarmPanel renders department headcount with alive fraction', () => {
  const html = renderToString(<SwarmPanel artifact={baseArtifact} />);
  assert.match(html, /Department headcount/);
  // engineering: 2 alive / 2 total
  assert.match(html, new RegExp(`2${c}/${c}2${c} alive`));
  // agriculture: 1 alive / 2 total (Ren is dead)
  assert.match(html, new RegExp(`1${c}/${c}2${c} alive`));
});

test('SwarmPanel renders the roster with agent names', () => {
  const html = renderToString(<SwarmPanel artifact={baseArtifact} />);
  assert.match(html, /Maria Chen/);
  assert.match(html, /Jin Park/);
  assert.match(html, /Ari Vega/);
  assert.match(html, /Ren Cole/);
  assert.match(html, /deceased/, 'dead agents are tagged "deceased"');
});

test('SwarmPanel returns null when artifact has no finalSwarm', () => {
  const noSwarm: RunArtifact = {
    metadata: {
      runId: 'r2',
      scenario: { id: 's', name: 'Test' },
      seed: 42,
      mode: 'batch-point',
      startedAt: '2026-05-01T00:00:00.000Z',
      completedAt: '2026-05-01T00:01:00.000Z',
    },
  } as RunArtifact;
  const html = renderToString(<SwarmPanel artifact={noSwarm} />);
  assert.equal(html, '', 'panel should render nothing when finalSwarm is missing');
});
