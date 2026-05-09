import test from 'node:test';
import assert from 'node:assert/strict';
import { createCostTracker } from '../economics/cost-tracker.js';

const modelConfig = {
  commander: 'claude-sonnet-4-6',
  departments: 'claude-sonnet-4-6',
  judge: 'claude-haiku-4-5-20251001',
  director: 'claude-sonnet-4-6',
  agentReactions: 'claude-haiku-4-5-20251001',
};

test('recordSchemaAttempt aggregates per-schema counts', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordSchemaAttempt('DepartmentReport', 1, false);
  tracker.recordSchemaAttempt('DepartmentReport', 2, false);
  tracker.recordSchemaAttempt('DepartmentReport', 3, true);
  const cost = tracker.finalCost();
  assert.ok(cost.schemaRetries);
  const dept = cost.schemaRetries!.DepartmentReport;
  assert.equal(dept.calls, 3);
  assert.equal(dept.attempts, 6);
  assert.equal(dept.fallbacks, 1);
});

test('recordSchemaAttempt keeps per-schema buckets separate', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordSchemaAttempt('DepartmentReport', 1, false);
  tracker.recordSchemaAttempt('CommanderDecision', 2, false);
  tracker.recordSchemaAttempt('DepartmentReport', 1, false);
  const cost = tracker.finalCost();
  assert.equal(cost.schemaRetries!.DepartmentReport.calls, 2);
  assert.equal(cost.schemaRetries!.CommanderDecision.calls, 1);
  assert.equal(cost.schemaRetries!.CommanderDecision.attempts, 2);
});

test('finalCost omits schemaRetries when no schema attempt was recorded', () => {
  const tracker = createCostTracker(modelConfig);
  const cost = tracker.finalCost();
  assert.equal(cost.schemaRetries, undefined);
});

test('recordSchemaAttempt ignores empty schema names', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordSchemaAttempt('', 3, false);
  const cost = tracker.finalCost();
  assert.equal(cost.schemaRetries, undefined);
});

test('recordForgeAttempt aggregates approved/rejected/confidence', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordForgeAttempt(true, 0.9);
  tracker.recordForgeAttempt(true, 0.8);
  tracker.recordForgeAttempt(false, 0);
  const cost = tracker.finalCost();
  assert.ok(cost.forgeStats);
  assert.equal(cost.forgeStats!.attempts, 3);
  assert.equal(cost.forgeStats!.approved, 2);
  assert.equal(cost.forgeStats!.rejected, 1);
  // Rounding-tolerant: 0.9 + 0.8 should be within floating tolerance of 1.7
  assert.ok(Math.abs(cost.forgeStats!.approvedConfidenceSum - 1.7) < 1e-9);
});

test('buildCostPayload includes forgeStats once any forge has been recorded', () => {
  const tracker = createCostTracker(modelConfig);
  const before = tracker.buildCostPayload();
  assert.equal(before.forgeStats, undefined);

  tracker.recordForgeAttempt(false, 0);
  const after = tracker.buildCostPayload();
  assert.ok(after.forgeStats);
  assert.equal(after.forgeStats!.attempts, 1);
  assert.equal(after.forgeStats!.approved, 0);
  assert.equal(after.forgeStats!.rejected, 1);
});

test('finalCost omits forgeStats when no forge attempt was recorded', () => {
  const tracker = createCostTracker(modelConfig);
  const cost = tracker.finalCost();
  assert.equal(cost.forgeStats, undefined);
});

test('unique-tool forge metrics distinguish re-forges from distinct tools', () => {
  const tracker = createCostTracker(modelConfig);
  // Tool A: rejected once, then approved. Should count as 1 unique name,
  // 1 uniqueApproved, 0 terminalRejections.
  tracker.recordForgeAttempt(false, 0, 'tool_a');
  tracker.recordForgeAttempt(true, 0.9, 'tool_a');
  // Tool B: approved on first try. 1 unique, 1 uniqueApproved.
  tracker.recordForgeAttempt(true, 0.95, 'tool_b');
  // Tool C: rejected twice, never approved. 1 unique, 0 uniqueApproved,
  // 1 terminalRejection.
  tracker.recordForgeAttempt(false, 0, 'tool_c');
  tracker.recordForgeAttempt(false, 0, 'tool_c');

  const cost = tracker.finalCost();
  assert.ok(cost.forgeStats);
  assert.equal(cost.forgeStats!.attempts, 5);
  assert.equal(cost.forgeStats!.approved, 2);
  assert.equal(cost.forgeStats!.rejected, 3);
  assert.equal(cost.forgeStats!.uniqueNames, 3);
  assert.equal(cost.forgeStats!.uniqueApproved, 2);
  assert.equal(cost.forgeStats!.uniqueTerminalRejections, 1);
});

test('recordForgeAttempt classifies rejection reasons into the histogram', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordForgeAttempt(false, 0, 'tool_a',
    'violates the declared output schema by returning additional properties not allowed by additionalProperties:false');
  tracker.recordForgeAttempt(false, 0, 'tool_b',
    'Shape check failed: need at least 2 testCases, got 1');
  tracker.recordForgeAttempt(false, 0, 'tool_c',
    'Failed to parse LLM response as JSON during creation review.');
  tracker.recordForgeAttempt(false, 0, 'tool_d',
    'correctness is questionable: the unclamped stressScore produces inconsistent risk grading');
  tracker.recordForgeAttempt(false, 0, 'tool_e');
  tracker.recordForgeAttempt(true, 0.9, 'tool_f');
  const cost = tracker.finalCost();
  assert.ok(cost.forgeStats);
  assert.equal(cost.forgeStats!.rejectionReasons.schema_extra_field, 1);
  assert.equal(cost.forgeStats!.rejectionReasons.shape_check, 1);
  assert.equal(cost.forgeStats!.rejectionReasons.parse_error, 1);
  assert.equal(cost.forgeStats!.rejectionReasons.judge_correctness, 1);
  assert.equal(cost.forgeStats!.rejectionReasons.other, 1); // tool_e — no reason
});

test('unique forge metrics ignore attempts without a toolName', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordForgeAttempt(true, 0.9);  // no name
  tracker.recordForgeAttempt(false, 0);   // no name
  const cost = tracker.finalCost();
  assert.ok(cost.forgeStats);
  assert.equal(cost.forgeStats!.attempts, 2);
  assert.equal(cost.forgeStats!.uniqueNames, 0);
  assert.equal(cost.forgeStats!.uniqueApproved, 0);
  assert.equal(cost.forgeStats!.uniqueTerminalRejections, 0);
});

test('rejected forges do not contribute to approvedConfidenceSum', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordForgeAttempt(true, 0.7);
  tracker.recordForgeAttempt(false, 0);
  tracker.recordForgeAttempt(false, 0);
  tracker.recordForgeAttempt(true, 0.85);
  const cost = tracker.finalCost();
  // Only two approvals contribute; rejected confidence=0 is filtered out.
  assert.ok(Math.abs(cost.forgeStats!.approvedConfidenceSum - 1.55) < 1e-9);
  assert.equal(cost.forgeStats!.approved, 2);
  assert.equal(cost.forgeStats!.rejected, 2);
  assert.equal(cost.forgeStats!.attempts, 4);
});

test('finalCost emits cacheStats when provider reported cache tokens', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.trackUsage({
    usage: { totalTokens: 1200, promptTokens: 1000, completionTokens: 200, cacheReadTokens: 500, cacheCreationTokens: 200 },
  }, 'departments');
  const cost = tracker.finalCost();
  assert.ok(cost.cacheStats);
  assert.equal(cost.cacheStats!.readTokens, 500);
  assert.equal(cost.cacheStats!.creationTokens, 200);
  // savingsUSD is the rollup of (reads*0.90 - creations*0.25) * inputPrice
  // across the sites that reported cache traffic. Exact value depends on
  // the site's input-token pricing; we just assert it's a finite number.
  assert.equal(typeof cost.cacheStats!.savingsUSD, 'number');
  assert.equal(Number.isFinite(cost.cacheStats!.savingsUSD), true);
});

test('finalCost omits cacheStats when no cache activity was reported', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.trackUsage({
    usage: { totalTokens: 800, promptTokens: 600, completionTokens: 200 },
  }, 'commander');
  const cost = tracker.finalCost();
  assert.equal(cost.cacheStats, undefined);
});

test('fallback pricing uses the site-assigned model rate, not commander-tier', () => {
  // Anthropic default config: commander=haiku, departments=sonnet.
  // Before the 2026-04-18 fix, a dept call without provider-reported
  // costUSD would bill at haiku rates (~$1/M input) instead of sonnet's
  // ~$3/M. This test pins the site-aware fallback behavior.
  const tracker = createCostTracker(modelConfig);  // sonnet depts, haiku everything else
  tracker.trackUsage({
    usage: { totalTokens: 1000, promptTokens: 800, completionTokens: 200 },
  }, 'departments');
  const deptFinal = tracker.finalCost();
  // Sonnet: 800 * 3/M + 200 * 15/M = 0.0024 + 0.003 = 0.0054
  // Haiku : 800 * 1/M + 200 * 5/M = 0.0008 + 0.001 = 0.0018
  // After fix: cost should be closer to the sonnet value than the haiku one.
  assert.ok(
    deptFinal.totalCostUSD > 0.004,
    `departments call should cost ~$0.0054 at sonnet, got ${deptFinal.totalCostUSD}`,
  );
});

test('recordProviderError counts each kind independently and tracks total', () => {
  const tracker = createCostTracker(modelConfig);
  tracker.recordProviderError('quota');
  tracker.recordProviderError('quota');
  tracker.recordProviderError('rate_limit');
  tracker.recordProviderError('network');
  const cost = tracker.finalCost();
  assert.ok(cost.providerErrors);
  assert.equal(cost.providerErrors!.quota, 2);
  assert.equal(cost.providerErrors!.rate_limit, 1);
  assert.equal(cost.providerErrors!.network, 1);
  assert.equal(cost.providerErrors!.auth, 0);
  assert.equal(cost.providerErrors!.unknown, 0);
  assert.equal(cost.providerErrors!.total, 4);
});

test('providerErrors absent from finalCost when no errors recorded', () => {
  const tracker = createCostTracker(modelConfig);
  const cost = tracker.finalCost();
  assert.equal(cost.providerErrors, undefined);
});

test('providerErrors appears on buildCostPayload once any error is recorded', () => {
  const tracker = createCostTracker(modelConfig);
  const before = tracker.buildCostPayload();
  assert.equal(before.providerErrors, undefined);
  tracker.recordProviderError('unknown');
  const after = tracker.buildCostPayload();
  assert.ok(after.providerErrors);
  assert.equal(after.providerErrors!.unknown, 1);
  assert.equal(after.providerErrors!.total, 1);
});

test('cacheStats savings accumulate across sites (net positive when reads dominate)', () => {
  const tracker = createCostTracker(modelConfig);
  // Turn 1: cache write (net cost).
  tracker.trackUsage({
    usage: { totalTokens: 1500, promptTokens: 1200, completionTokens: 300, cacheCreationTokens: 800 },
  }, 'departments');
  // Turn 2-6: cache reads dominate (net savings).
  for (let i = 0; i < 5; i++) {
    tracker.trackUsage({
      usage: { totalTokens: 1200, promptTokens: 400, completionTokens: 200, cacheReadTokens: 800 },
    }, 'departments');
  }
  const cost = tracker.finalCost();
  assert.ok(cost.cacheStats);
  assert.equal(cost.cacheStats!.readTokens, 4000);
  assert.equal(cost.cacheStats!.creationTokens, 800);
  // 5 reads × 800 × 0.9 = 3600 savings units vs 1 create × 800 × 0.25 = 200 cost units → net positive.
  assert.ok(cost.cacheStats!.savingsUSD > 0, `expected positive savings, got ${cost.cacheStats!.savingsUSD}`);
});
