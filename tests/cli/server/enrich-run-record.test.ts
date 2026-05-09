/**
 * TDD tests for enrichRunRecordFromArtifact: a pure helper that takes
 * a base RunRecord (created at run-start with sparse fields) and a
 * RunArtifact (returned at run-end), and produces an enriched RunRecord
 * with artifactPath, costUSD, durationMs, mode, actorName, and
 * actorArchetype populated from the artifact.
 *
 * The Library tab needs these fields to render gallery cards and to
 * load full artifacts via /api/v1/runs/:runId.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichRunRecordFromArtifact } from '../../../src/server/services/enrich-run-record.js';
import type { RunRecord } from '../../../src/server/services/run-record.js';
import type { RunArtifact } from '../../../src/engine/schema/index.js';

function baseRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run_base',
    createdAt: '2026-04-25T00:00:00.000Z',
    scenarioId: 'mars-genesis',
    scenarioVersion: '0.7.0',
    actorConfigHash: 'leaders:abc',
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
    ...overrides,
  };
}

function fullArtifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    metadata: {
      runId: 'art-1',
      scenario: { id: 'mars-genesis', name: 'Mars' },
      mode: 'turn-loop',
      startedAt: '2026-04-25T00:00:00.000Z',
      completedAt: '2026-04-25T00:05:00.000Z',
    },
    leader: {
      name: 'Marcus Reinhardt',
      archetype: 'pragmatist',
      unit: 'Crew',
      hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
      instructions: '',
    },
    cost: { totalUSD: 0.42 },
    scenarioExtensions: { outputPath: '/tmp/run.json' },
    ...overrides,
  } as unknown as RunArtifact;
}

test('enrichRunRecordFromArtifact populates artifactPath from scenarioExtensions.outputPath', () => {
  const enriched = enrichRunRecordFromArtifact(baseRecord(), fullArtifact());
  assert.equal(enriched.artifactPath, '/tmp/run.json');
});

test('enrichRunRecordFromArtifact populates costUSD from artifact.cost.totalUSD', () => {
  const enriched = enrichRunRecordFromArtifact(baseRecord(), fullArtifact());
  assert.equal(enriched.costUSD, 0.42);
});

test('enrichRunRecordFromArtifact computes durationMs from started/completed timestamps', () => {
  const enriched = enrichRunRecordFromArtifact(baseRecord(), fullArtifact());
  assert.equal(enriched.durationMs, 5 * 60 * 1000);
});

test('enrichRunRecordFromArtifact populates mode from artifact.metadata.mode', () => {
  const enriched = enrichRunRecordFromArtifact(baseRecord(), fullArtifact({
    metadata: {
      runId: 'art-2',
      scenario: { id: 'mars-genesis', name: 'Mars' },
      mode: 'batch-trajectory',
      startedAt: '2026-04-25T00:00:00.000Z',
      completedAt: '2026-04-25T00:01:00.000Z',
    },
  } as never));
  assert.equal(enriched.mode, 'batch-trajectory');
});

test('enrichRunRecordFromArtifact populates leader name + archetype from artifact.leader', () => {
  const enriched = enrichRunRecordFromArtifact(baseRecord(), fullArtifact());
  assert.equal(enriched.actorName, 'Marcus Reinhardt');
  assert.equal(enriched.actorArchetype, 'pragmatist');
});

test('enrichRunRecordFromArtifact preserves base record fields verbatim', () => {
  const base = baseRecord({ runId: 'run_specific', createdBy: 'user' });
  const enriched = enrichRunRecordFromArtifact(base, fullArtifact());
  assert.equal(enriched.runId, 'run_specific');
  assert.equal(enriched.createdBy, 'user');
  assert.equal(enriched.scenarioId, 'mars-genesis');
});

test('enrichRunRecordFromArtifact handles missing scenarioExtensions.outputPath gracefully', () => {
  const artifact = fullArtifact({ scenarioExtensions: undefined } as never);
  const enriched = enrichRunRecordFromArtifact(baseRecord(), artifact);
  assert.equal(enriched.artifactPath, undefined);
});

test('enrichRunRecordFromArtifact handles missing cost gracefully', () => {
  const artifact = fullArtifact({ cost: undefined } as never);
  const enriched = enrichRunRecordFromArtifact(baseRecord(), artifact);
  assert.equal(enriched.costUSD, undefined);
});

test('enrichRunRecordFromArtifact handles missing completedAt (run aborted) by leaving durationMs undefined', () => {
  const artifact = fullArtifact({
    metadata: {
      runId: 'art-aborted',
      scenario: { id: 'mars-genesis', name: 'Mars' },
      mode: 'turn-loop',
      startedAt: '2026-04-25T00:00:00.000Z',
    },
  } as never);
  const enriched = enrichRunRecordFromArtifact(baseRecord(), artifact);
  assert.equal(enriched.durationMs, undefined);
});

test('enrichRunRecordFromArtifact handles missing leader gracefully', () => {
  const artifact = fullArtifact({ leader: undefined } as never);
  const enriched = enrichRunRecordFromArtifact(baseRecord(), artifact);
  assert.equal(enriched.actorName, undefined);
  assert.equal(enriched.actorArchetype, undefined);
});
