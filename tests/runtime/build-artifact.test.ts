import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunArtifact } from '../../src/runtime/io/build-artifact.js';
import { RunArtifactSchema } from '../../src/engine/schema/index.js';

const baseInputs = {
  runId: 'run-001',
  scenarioId: 'mars',
  scenarioName: 'Mars Genesis',
  seed: 42,
  startedAt: '2026-04-22T10:00:00.000Z',
  completedAt: '2026-04-22T10:05:00.000Z',
  timeUnit: { singular: 'year', plural: 'years' },
  turnArtifacts: [],
  commanderDecisions: [],
  forgedToolbox: [],
  citationCatalog: [],
  agentReactions: [],
  finalState: { metrics: { population: 100, morale: 0.7 }, metadata: {} },
  fingerprint: { resilience: 0.8 },
  cost: { totalUSD: 0.32, llmCalls: 85 },
  providerError: null,
  aborted: false,
};

test('buildRunArtifact produces schema-valid turn-loop artifact', () => {
  const artifact = buildRunArtifact({ ...baseInputs, mode: 'turn-loop' });
  const result = RunArtifactSchema.safeParse(artifact);
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues, null, 2));
  assert.equal(artifact.metadata.mode, 'turn-loop');
  assert.equal(artifact.metadata.runId, 'run-001');
});

test('buildRunArtifact maps turnArtifacts to trajectory.timepoints', () => {
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    turnArtifacts: [
      {
        turn: 1,
        time: 2035,
        stateSnapshotAfter: { metrics: { population: 100, morale: 0.7 } },
        departmentReports: [
          { department: 'medical', summary: 'Stable', confidence: 0.8, risks: [], opportunities: [], citations: [], recommendedActions: [], openQuestions: [] },
        ],
        commanderDecision: { decision: 'Hold course', rationale: 'Stable.', reasoning: '', selectedPolicies: [] },
        policyEffectsApplied: [],
      },
    ],
  };
  const artifact = buildRunArtifact(inputs);
  assert.equal(artifact.trajectory?.timepoints?.length, 1);
  assert.equal(artifact.trajectory?.timepoints?.[0].time, 2035);
  assert.equal(artifact.specialistNotes?.length, 1);
  assert.equal(artifact.specialistNotes?.[0].domain, 'medical');
});

test('buildRunArtifact: per-timepoint worldSnapshot carries all five world bags', () => {
  // Regression test for the 0.7.x per-timepoint worldSnapshot
  // widening: when the orchestrator emits a turn artifact whose
  // stateSnapshotAfter populates capacities / statuses / politics /
  // environment (in addition to the required metrics bag), every
  // Timepoint in the returned artifact should surface all five bags
  // on its worldSnapshot, not just metrics.
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    turnArtifacts: [
      {
        turn: 1,
        time: 1,
        stateSnapshotAfter: {
          metrics: { revenue: 100, headcount: 50 },
          capacities: { runwayMonths: 18 },
          statuses: { fundingRound: 'seed', publicListed: false as boolean },
          politics: { boardConfidence: 0.7 },
          environment: { marketGrowthPct: 12 },
        },
        departmentReports: [],
        commanderDecision: { decision: 'X', rationale: 'because', reasoning: '', selectedPolicies: [] },
        policyEffectsApplied: [],
      },
    ],
  };
  const artifact = buildRunArtifact(inputs);
  const tp = artifact.trajectory?.timepoints?.[0];
  assert.ok(tp, 'timepoint should exist');
  assert.deepEqual(tp!.worldSnapshot?.metrics, { revenue: 100, headcount: 50 });
  assert.deepEqual(tp!.worldSnapshot?.capacities, { runwayMonths: 18 });
  assert.deepEqual(tp!.worldSnapshot?.statuses, { fundingRound: 'seed', publicListed: false });
  assert.deepEqual(tp!.worldSnapshot?.politics, { boardConfidence: 0.7 });
  assert.deepEqual(tp!.worldSnapshot?.environment, { marketGrowthPct: 12 });
  // points[] stays lightweight (metrics only).
  assert.deepEqual(artifact.trajectory?.points?.[0].metrics, { revenue: 100, headcount: 50 });
});

test('buildRunArtifact: timepoint worldSnapshot omits empty optional bags', () => {
  // Scenarios that declare no statuses / politics / environment (the
  // Mars baseline) should NOT emit noisy `statuses: {}` entries on
  // every timepoint. Empty bags fall through the conditional spread.
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    turnArtifacts: [
      {
        turn: 1,
        time: 1,
        stateSnapshotAfter: { metrics: { x: 1 } },
        departmentReports: [],
        commanderDecision: { decision: 'Y', rationale: '', reasoning: '', selectedPolicies: [] },
        policyEffectsApplied: [],
      },
    ],
  };
  const artifact = buildRunArtifact(inputs);
  const tp = artifact.trajectory?.timepoints?.[0];
  assert.ok(tp, 'timepoint should exist');
  assert.deepEqual(tp!.worldSnapshot?.metrics, { x: 1 });
  assert.equal(tp!.worldSnapshot?.statuses, undefined);
  assert.equal(tp!.worldSnapshot?.politics, undefined);
  assert.equal(tp!.worldSnapshot?.environment, undefined);
  assert.equal(tp!.worldSnapshot?.capacities, undefined);
});

test('buildRunArtifact maps commanderDecisions to decisions[]', () => {
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    commanderDecisions: [
      { turn: 1, time: 2036, actor: 'Captain Reyes', decision: 'Reinforce', rationale: 'Safety.', reasoning: '1. ...', outcome: 'conservative_success' as const },
    ],
  };
  const artifact = buildRunArtifact(inputs);
  assert.equal(artifact.decisions?.length, 1);
  assert.equal(artifact.decisions?.[0].actor, 'Captain Reyes');
  assert.equal(artifact.decisions?.[0].choice, 'Reinforce');
  assert.equal(artifact.decisions?.[0].outcome, 'conservative_success');
});

test('buildRunArtifact maps forgedToolbox to forgedTools[]', () => {
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    forgedToolbox: [{ name: 'radiation_calc', department: 'medical', description: 'Calc dose', approved: true, confidence: 0.9 }],
  };
  const artifact = buildRunArtifact(inputs);
  assert.equal(artifact.forgedTools?.length, 1);
  assert.equal(artifact.forgedTools?.[0].name, 'radiation_calc');
});

test('buildRunArtifact maps citationCatalog to citations[]', () => {
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    citationCatalog: [{ text: 'NASA', url: 'https://x.example', context: 'dose study' }],
  };
  const artifact = buildRunArtifact(inputs);
  assert.equal(artifact.citations?.length, 1);
  assert.equal(artifact.citations?.[0].text, 'NASA');
});

test('buildRunArtifact stashes agentReactions under scenarioExtensions', () => {
  const inputs = {
    ...baseInputs,
    mode: 'turn-loop' as const,
    agentReactions: [{ agentId: 'a1', mood: 'hopeful', quote: 'We can do this.' }],
  };
  const artifact = buildRunArtifact(inputs);
  const ext = artifact.scenarioExtensions as { reactions?: unknown[] } | undefined;
  assert.ok(Array.isArray(ext?.reactions));
  assert.equal(ext?.reactions?.length, 1);
});

test('buildRunArtifact produces valid batch-trajectory artifact without commanderDecisions', () => {
  const artifact = buildRunArtifact({
    ...baseInputs,
    mode: 'batch-trajectory',
    commanderDecisions: [],
    turnArtifacts: [],
  });
  assert.equal(RunArtifactSchema.safeParse(artifact).success, true);
  assert.equal(artifact.metadata.mode, 'batch-trajectory');
});

test('buildRunArtifact produces valid batch-point artifact without trajectory', () => {
  const artifact = buildRunArtifact({
    ...baseInputs,
    mode: 'batch-point',
    commanderDecisions: [],
    turnArtifacts: [],
    finalState: undefined,
    fingerprint: undefined,
  });
  assert.equal(RunArtifactSchema.safeParse(artifact).success, true);
  assert.equal(artifact.trajectory, undefined);
});

test('buildRunArtifact assigns subject + intervention onto returned artifact', () => {
  const subject = { id: 'subj-1', name: 'Alice' };
  const intervention = { id: 'intv-1', name: 'Protocol A', description: 'Test.' };
  const artifact = buildRunArtifact({
    ...baseInputs,
    mode: 'turn-loop',
    subject,
    intervention,
  });
  assert.equal(artifact.subject?.id, 'subj-1');
  assert.equal(artifact.subject?.name, 'Alice');
  assert.equal(artifact.intervention?.id, 'intv-1');
  assert.equal(artifact.intervention?.description, 'Test.');
});

test('buildRunArtifact leaves subject + intervention undefined when not passed', () => {
  const artifact = buildRunArtifact({ ...baseInputs, mode: 'turn-loop' });
  assert.equal(artifact.subject, undefined);
  assert.equal(artifact.intervention, undefined);
});

test('buildRunArtifact: finalState carries all world snapshot bags', () => {
  const artifact = buildRunArtifact({
    ...baseInputs,
    mode: 'turn-loop',
    finalState: {
      metrics: { revenueArr: 6_500_000, morale: 0.82 },
      capacities: { runwayMonths: 18 },
      politics: { boardConfidence: 80 },
      statuses: { fundingRound: 'series-c' },
      environment: { marketGrowthPct: 22 },
      metadata: { startTime: 1, currentTime: 3, currentTurn: 2 },
    },
  });
  assert.ok(artifact.finalState);
  assert.equal(artifact.finalState!.metrics?.revenueArr, 6_500_000);
  assert.equal(artifact.finalState!.capacities?.runwayMonths, 18);
  assert.equal((artifact.finalState!.politics as Record<string, number>)?.boardConfidence, 80);
  assert.equal((artifact.finalState!.statuses as Record<string, string>)?.fundingRound, 'series-c');
  assert.equal((artifact.finalState!.environment as Record<string, number>)?.marketGrowthPct, 22);
});

test('buildRunArtifact: finalState.politics/statuses/environment undefined when input omits them (legacy inputs)', () => {
  const artifact = buildRunArtifact({
    ...baseInputs,
    mode: 'turn-loop',
    finalState: { metrics: { population: 100 }, metadata: {} },
  });
  assert.ok(artifact.finalState);
  assert.equal(artifact.finalState!.capacities, undefined);
  assert.equal(artifact.finalState!.politics, undefined);
  assert.equal(artifact.finalState!.statuses, undefined);
  assert.equal(artifact.finalState!.environment, undefined);
});
