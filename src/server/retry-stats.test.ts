import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateSchemaRetries,
  aggregateForgeStats,
  aggregateCacheStats,
  aggregateProviderErrors,
  type PerRunSchemaRetries,
  type PerRunForgeStats,
  type PerRunCacheStats,
  type PerRunProviderErrors,
} from './retry-stats.js';

const emptyRun: PerRunSchemaRetries = {};

test('aggregateSchemaRetries returns empty rollup on no runs', () => {
  const agg = aggregateSchemaRetries([]);
  assert.deepEqual(agg, { runCount: 0, schemas: {} });
});

test('aggregateSchemaRetries sums calls / attempts / fallbacks across runs', () => {
  const runs: PerRunSchemaRetries[] = [
    {
      DepartmentReport: { attempts: 12, calls: 10, fallbacks: 0 },
      CommanderDecision: { attempts: 8, calls: 8, fallbacks: 0 },
    },
    {
      DepartmentReport: { attempts: 15, calls: 10, fallbacks: 1 },
      CommanderDecision: { attempts: 10, calls: 8, fallbacks: 0 },
    },
  ];
  const agg = aggregateSchemaRetries(runs);
  assert.equal(agg.runCount, 2);
  assert.equal(agg.schemas.DepartmentReport.calls, 20);
  assert.equal(agg.schemas.DepartmentReport.attempts, 27);
  assert.equal(agg.schemas.DepartmentReport.fallbacks, 1);
  assert.equal(agg.schemas.CommanderDecision.calls, 16);
});

test('aggregateSchemaRetries computes avgAttempts (attempts/calls) per schema', () => {
  const runs: PerRunSchemaRetries[] = [
    { DepartmentReport: { attempts: 27, calls: 20, fallbacks: 1 } },
  ];
  const agg = aggregateSchemaRetries(runs);
  assert.equal(agg.schemas.DepartmentReport.avgAttempts, 1.35);
});

test('aggregateSchemaRetries computes fallbackRate per schema', () => {
  const runs: PerRunSchemaRetries[] = [
    { DepartmentReport: { attempts: 27, calls: 20, fallbacks: 1 } },
  ];
  const agg = aggregateSchemaRetries(runs);
  assert.equal(agg.schemas.DepartmentReport.fallbackRate, 0.05);
});

test('aggregateSchemaRetries skips empty / missing run entries gracefully', () => {
  const runs: PerRunSchemaRetries[] = [
    emptyRun,
    { DepartmentReport: { attempts: 10, calls: 10, fallbacks: 0 } },
    emptyRun,
  ];
  const agg = aggregateSchemaRetries(runs);
  assert.equal(agg.runCount, 3);
  assert.equal(agg.schemas.DepartmentReport.calls, 10);
});

test('aggregateSchemaRetries handles schema appearing in only some runs', () => {
  const runs: PerRunSchemaRetries[] = [
    { DepartmentReport: { attempts: 10, calls: 10, fallbacks: 0 } },
    { CommanderDecision: { attempts: 8, calls: 8, fallbacks: 0 } },
  ];
  const agg = aggregateSchemaRetries(runs);
  assert.equal(agg.schemas.DepartmentReport.runsPresent, 1);
  assert.equal(agg.schemas.CommanderDecision.runsPresent, 1);
});

// -----------------------------------------------------------------------
// aggregateForgeStats
// -----------------------------------------------------------------------

test('aggregateForgeStats returns zero rollup on empty runs array', () => {
  const agg = aggregateForgeStats([]);
  assert.deepEqual(agg, {
    totalAttempts: 0,
    approved: 0,
    rejected: 0,
    approvalRate: 0,
    avgApprovedConfidence: 0,
    totalUniqueNames: 0,
    totalUniqueApproved: 0,
    totalUniqueTerminalRejections: 0,
    uniqueApprovalRate: 0,
    rejectionReasons: {
      schema_extra_field: 0,
      shape_check: 0,
      parse_error: 0,
      judge_correctness: 0,
      other: 0,
    },
    runsPresent: 0,
  });
});

test('aggregateForgeStats sums rejectionReasons histograms across runs', () => {
  const runs: PerRunForgeStats[] = [
    {
      attempts: 3, approved: 1, rejected: 2, approvedConfidenceSum: 0.9,
      rejectionReasons: { schema_extra_field: 2, shape_check: 0, parse_error: 0, judge_correctness: 0, other: 0 },
    },
    {
      attempts: 4, approved: 2, rejected: 2, approvedConfidenceSum: 1.8,
      rejectionReasons: { schema_extra_field: 1, shape_check: 1, parse_error: 0, judge_correctness: 0, other: 0 },
    },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.rejectionReasons.schema_extra_field, 3);
  assert.equal(agg.rejectionReasons.shape_check, 1);
  assert.equal(agg.rejectionReasons.parse_error, 0);
});

test('aggregateForgeStats treats v4 entries without rejectionReasons as zero', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 3, approved: 1, rejected: 2, approvedConfidenceSum: 0.9 },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.rejectionReasons.schema_extra_field, 0);
});

test('aggregateForgeStats sums unique-tool metrics across runs', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 5, approved: 3, rejected: 2, approvedConfidenceSum: 2.7, uniqueNames: 3, uniqueApproved: 3, uniqueTerminalRejections: 0 },
    { attempts: 6, approved: 3, rejected: 3, approvedConfidenceSum: 2.4, uniqueNames: 4, uniqueApproved: 3, uniqueTerminalRejections: 1 },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.totalUniqueNames, 7);
  assert.equal(agg.totalUniqueApproved, 6);
  assert.equal(agg.totalUniqueTerminalRejections, 1);
  // 6 / 7 = 0.8571...
  assert.equal(agg.uniqueApprovalRate, 0.8571);
});

test('aggregateForgeStats treats v2 entries without unique-tool fields as zero', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 4, approved: 2, rejected: 2, approvedConfidenceSum: 1.7 },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.totalUniqueNames, 0);
  assert.equal(agg.uniqueApprovalRate, 0);
});

test('aggregateForgeStats sums attempts / approved / rejected across runs', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 5, approved: 4, rejected: 1, approvedConfidenceSum: 3.2 },
    { attempts: 4, approved: 3, rejected: 1, approvedConfidenceSum: 2.4 },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.totalAttempts, 9);
  assert.equal(agg.approved, 7);
  assert.equal(agg.rejected, 2);
  assert.equal(agg.runsPresent, 2);
});

test('aggregateForgeStats computes approvalRate rounded to 4 decimals', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 7, approved: 5, rejected: 2, approvedConfidenceSum: 4.0 },
  ];
  const agg = aggregateForgeStats(runs);
  // 5/7 = 0.714285... → rounds to 0.7143
  assert.equal(agg.approvalRate, 0.7143);
});

test('aggregateForgeStats computes avgApprovedConfidence rounded to 2 decimals', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 4, approved: 2, rejected: 2, approvedConfidenceSum: 1.7 },
  ];
  const agg = aggregateForgeStats(runs);
  // 1.7 / 2 = 0.85
  assert.equal(agg.avgApprovedConfidence, 0.85);
});

test('aggregateForgeStats skips runs with zero attempts (runsPresent excludes them)', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 0, approved: 0, rejected: 0, approvedConfidenceSum: 0 },
    { attempts: 3, approved: 2, rejected: 1, approvedConfidenceSum: 1.6 },
    { attempts: 0, approved: 0, rejected: 0, approvedConfidenceSum: 0 },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.runsPresent, 1);
  assert.equal(agg.totalAttempts, 3);
});

test('aggregateForgeStats returns approvalRate:0 when no approvals exist', () => {
  const runs: PerRunForgeStats[] = [
    { attempts: 3, approved: 0, rejected: 3, approvedConfidenceSum: 0 },
  ];
  const agg = aggregateForgeStats(runs);
  assert.equal(agg.approvalRate, 0);
  assert.equal(agg.avgApprovedConfidence, 0);
});

// -----------------------------------------------------------------------
// aggregateCacheStats
// -----------------------------------------------------------------------

test('aggregateCacheStats returns zero rollup on empty runs', () => {
  const agg = aggregateCacheStats([]);
  assert.deepEqual(agg, {
    totalReadTokens: 0,
    totalCreationTokens: 0,
    totalSavingsUSD: 0,
    readRatio: 0,
    runsPresent: 0,
  });
});

test('aggregateCacheStats sums readTokens + creationTokens + savings across runs', () => {
  const runs: PerRunCacheStats[] = [
    { readTokens: 8000, creationTokens: 2000, savingsUSD: 0.15 },
    { readTokens: 6000, creationTokens: 1500, savingsUSD: 0.11 },
  ];
  const agg = aggregateCacheStats(runs);
  assert.equal(agg.totalReadTokens, 14000);
  assert.equal(agg.totalCreationTokens, 3500);
  assert.equal(agg.totalSavingsUSD, 0.26);
  assert.equal(agg.runsPresent, 2);
});

test('aggregateCacheStats computes readRatio as reads / (reads + creations)', () => {
  const runs: PerRunCacheStats[] = [
    { readTokens: 7000, creationTokens: 3000, savingsUSD: 0.1 },
  ];
  const agg = aggregateCacheStats(runs);
  assert.equal(agg.readRatio, 0.7);
});

test('aggregateCacheStats skips runs with zero cache activity', () => {
  const runs: PerRunCacheStats[] = [
    { readTokens: 0, creationTokens: 0, savingsUSD: 0 },
    { readTokens: 5000, creationTokens: 1000, savingsUSD: 0.08 },
    { readTokens: 0, creationTokens: 0, savingsUSD: 0 },
  ];
  const agg = aggregateCacheStats(runs);
  assert.equal(agg.runsPresent, 1);
  assert.equal(agg.totalReadTokens, 5000);
});

test('aggregateCacheStats returns readRatio:0 when no cache activity at all', () => {
  const agg = aggregateCacheStats([]);
  assert.equal(agg.readRatio, 0);
});

// -----------------------------------------------------------------------
// aggregateProviderErrors
// -----------------------------------------------------------------------

test('aggregateProviderErrors returns zero rollup on empty runs', () => {
  const agg = aggregateProviderErrors([]);
  assert.deepEqual(agg, {
    auth: 0, quota: 0, rate_limit: 0, network: 0, unknown: 0, total: 0, runsPresent: 0,
  });
});

test('aggregateProviderErrors sums each kind across runs', () => {
  const runs: PerRunProviderErrors[] = [
    { auth: 0, quota: 3, rate_limit: 1, network: 0, unknown: 0, total: 4 },
    { auth: 1, quota: 0, rate_limit: 2, network: 1, unknown: 1, total: 5 },
  ];
  const agg = aggregateProviderErrors(runs);
  assert.equal(agg.auth, 1);
  assert.equal(agg.quota, 3);
  assert.equal(agg.rate_limit, 3);
  assert.equal(agg.network, 1);
  assert.equal(agg.unknown, 1);
  assert.equal(agg.total, 9);
  assert.equal(agg.runsPresent, 2);
});

test('aggregateProviderErrors skips runs with zero total', () => {
  const runs: PerRunProviderErrors[] = [
    { auth: 0, quota: 0, rate_limit: 0, network: 0, unknown: 0, total: 0 },
    { auth: 0, quota: 1, rate_limit: 0, network: 0, unknown: 0, total: 1 },
    { auth: 0, quota: 0, rate_limit: 0, network: 0, unknown: 0, total: 0 },
  ];
  const agg = aggregateProviderErrors(runs);
  assert.equal(agg.runsPresent, 1);
  assert.equal(agg.total, 1);
  assert.equal(agg.quota, 1);
});
