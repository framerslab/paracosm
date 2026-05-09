import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { SwarmDiff } from './SwarmDiff.js';
import type { RunArtifact, SwarmAgent } from '../../../../../engine/schema/index.js';

const a = (over: Partial<SwarmAgent>): SwarmAgent => ({
  agentId: over.agentId ?? 'a',
  name: over.name ?? 'Agent A',
  department: over.department ?? 'engineering',
  role: over.role ?? 'engineer',
  alive: over.alive ?? true,
  ...over,
});

const baseMetadata = {
  scenario: { id: 's', name: 'Test' },
  seed: 42,
  mode: 'turn-loop' as const,
  startedAt: '2026-05-01T00:00:00.000Z',
  completedAt: '2026-05-01T00:01:00.000Z',
};

const runA: RunArtifact = {
  metadata: { ...baseMetadata, runId: 'rA' },
  finalSwarm: {
    turn: 6,
    time: 6,
    population: 3,
    morale: 0.72,
    agents: [
      a({ agentId: 'x1', name: 'Maria', department: 'engineering', mood: 'focused' }),
      a({ agentId: 'x2', name: 'Jin', department: 'engineering', mood: 'anxious' }),
      a({ agentId: 'x3', name: 'Ari', department: 'agriculture', mood: 'focused' }),
      a({ agentId: 'x4', name: 'Ren', department: 'agriculture', alive: false, mood: 'despair' }),
    ],
  },
} as RunArtifact;

const runB: RunArtifact = {
  metadata: { ...baseMetadata, runId: 'rB' },
  finalSwarm: {
    turn: 6,
    time: 6,
    population: 3,
    morale: 0.55,
    agents: [
      a({ agentId: 'x1', name: 'Maria', department: 'engineering', mood: 'anxious' }),
      a({ agentId: 'x2', name: 'Jin', department: 'engineering', alive: false }),
      a({ agentId: 'x3', name: 'Ari', department: 'agriculture', mood: 'focused' }),
      a({ agentId: 'x4', name: 'Ren', department: 'agriculture', mood: 'hopeful' }),
    ],
  },
} as RunArtifact;

test('SwarmDiff renders per-run summary cards with alive/dead/morale', () => {
  const html = renderToString(<SwarmDiff artifacts={[runA, runB]} />);
  assert.match(html, /Agent swarm/);
  assert.match(html, /alive/);
  assert.match(html, /dead/);
  assert.match(html, /72/);  // run A morale
  assert.match(html, /55/);  // run B morale
});

test('SwarmDiff surfaces the survivor delta (alive only in this run)', () => {
  const html = renderToString(<SwarmDiff artifacts={[runA, runB]} />);
  assert.match(html, /Survivor delta/);
  // Jin is alive in A but dead in B → should appear in Run A only
  assert.match(html, /Jin/);
  // Ren is alive in B but dead in A → should appear in Run B only
  assert.match(html, /Ren/);
});

test('SwarmDiff surfaces mood divergence for shared alive agents', () => {
  const html = renderToString(<SwarmDiff artifacts={[runA, runB]} />);
  assert.match(html, /Mood divergence/);
  // Maria is alive in both runs with different moods (focused vs anxious)
  assert.match(html, /Maria/);
  assert.match(html, /focused/);
  assert.match(html, /anxious/);
});

test('SwarmDiff renders nothing when no artifact has a swarm', () => {
  const noSwarmA: RunArtifact = { metadata: { ...baseMetadata, runId: 'r1' } } as RunArtifact;
  const noSwarmB: RunArtifact = { metadata: { ...baseMetadata, runId: 'r2', mode: 'batch-point' } } as RunArtifact;
  const html = renderToString(<SwarmDiff artifacts={[noSwarmA, noSwarmB]} />);
  assert.equal(html, '');
});

test('SwarmDiff handles a swarm-less artifact alongside a swarm artifact', () => {
  const noSwarm: RunArtifact = { metadata: { ...baseMetadata, runId: 'rC', mode: 'batch-point' } } as RunArtifact;
  const html = renderToString(<SwarmDiff artifacts={[runA, noSwarm]} />);
  assert.match(html, /Agent swarm/);
  assert.match(html, /No swarm captured/);
});
