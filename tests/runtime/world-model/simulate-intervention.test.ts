/**
 * Tests for `WorldModel.intervene` (v0.9; renamed from
 * `simulateIntervention`). Verifies the method is a thin pass-through
 * over `simulate()` that forwards subject + intervention onto the
 * underlying RunOptions, with the rest of the options preserved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel } from '../../../src/runtime/world-model/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';
import type { ActorConfig } from '../../../src/runtime/orchestrator/index.js';
import type { SubjectConfig, InterventionConfig, RunArtifact } from '../../../src/engine/schema/index.js';
import type { SimulateOptions } from '../../../src/api/types.js';

const LEADER: ActorConfig = {
  name: 'Intervention Leader',
  archetype: 'Tester',
  unit: 'Test Unit',
  hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
  instructions: '',
};

const SUBJECT: SubjectConfig = {
  id: 'subject-1',
  kind: 'organization',
  attributes: { headcount: 100, runwayMonths: 18 },
} as unknown as SubjectConfig;

const INTERVENTION: InterventionConfig = {
  id: 'layoff-25pct',
  kind: 'policy',
  description: '25% reduction in force across all departments',
  parameters: { percent: 25 },
} as unknown as InterventionConfig;

test('WorldModel.intervene forwards subject and intervention into simulate options', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  let captured: SimulateOptions | null = null;
  (wm as unknown as { simulate: (o: SimulateOptions) => Promise<RunArtifact> }).simulate = async (opts) => {
    captured = opts;
    return {
      metadata: { runId: 'r1', scenario: { id: marsScenario.id, name: 'Mars' }, mode: 'turn-loop', startedAt: '2026-04-25T00:00:00.000Z' },
    } as unknown as RunArtifact;
  };

  await wm.intervene({ subject: SUBJECT, intervention: INTERVENTION, actor: LEADER, maxTurns: 3 });

  assert.ok(captured, 'simulate was not called');
  assert.deepEqual(captured!.subject, SUBJECT);
  assert.deepEqual(captured!.intervention, INTERVENTION);
});

test('WorldModel.intervene preserves additional simulate options', async () => {
  const wm = WorldModel.fromScenario(marsScenario);
  let captured: SimulateOptions | null = null;
  (wm as unknown as { simulate: (o: SimulateOptions) => Promise<RunArtifact> }).simulate = async (opts) => {
    captured = opts;
    return { metadata: { runId: 'r2', scenario: { id: marsScenario.id, name: 'Mars' }, mode: 'turn-loop', startedAt: '2026-04-25T00:00:00.000Z' } } as unknown as RunArtifact;
  };

  await wm.intervene({ subject: SUBJECT, intervention: INTERVENTION, actor: LEADER, maxTurns: 5, seed: 7, captureSnapshots: true });

  assert.ok(captured);
  assert.equal(captured!.maxTurns, 5);
  assert.equal(captured!.seed, 7);
  assert.equal(captured!.captureSnapshots, true);
});
