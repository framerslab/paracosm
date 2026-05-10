/**
 * HTTP handlers for the Compare-runs UI's bundle endpoints. A bundle is
 * a set of RunRecords sharing a `bundleId`, produced by one Quickstart
 * submission. The dashboard's CompareModal fetches:
 *
 *   - GET /api/v1/bundles/:id            -> bundle metadata + member runs
 *   - GET /api/v1/bundles/:id/aggregate  -> server-side rollup (counts, cost)
 *
 * Lazy-loading: members in the listBundle response carry only the
 * RunRecord summary (cost, duration, actorName, summaryTrajectory).
 * Full RunArtifact JSON is fetched per-cell via the existing
 * /api/v1/runs/:id endpoint when a cell is pinned or opened.
 *
 * @module paracosm/cli/bundle-routes
 */
import type { ServerResponse } from 'node:http';
import type { RunHistoryStore } from '../stores/run-history.js';
import type { RunRecord } from '../services/run-record.js';

export interface BundleRoutesDeps {
  runHistoryStore: RunHistoryStore;
}

export async function handleListBundle(
  bundleId: string,
  res: ServerResponse,
  deps: BundleRoutesDeps,
): Promise<void> {
  if (!deps.runHistoryStore.listRunsByBundleId) {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bundle queries not supported by this store' }));
    return;
  }
  const members = await deps.runHistoryStore.listRunsByBundleId(bundleId);
  if (members.length === 0) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Bundle ${bundleId} has no members` }));
    return;
  }
  const scenarioId = members[0].scenarioId;
  const createdAt = members[0].createdAt;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    bundleId,
    scenarioId,
    createdAt,
    memberCount: members.length,
    members,
  }));
}

export interface BundleAggregate {
  bundleId: string;
  count: number;
  costTotalUSD: number;
  meanDurationMs: number;
  outcomeBuckets: Record<string, number>;
}

export async function handleBundleAggregate(
  bundleId: string,
  res: ServerResponse,
  deps: BundleRoutesDeps,
): Promise<void> {
  if (!deps.runHistoryStore.listRunsByBundleId) {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bundle queries not supported' }));
    return;
  }
  const members = await deps.runHistoryStore.listRunsByBundleId(bundleId);
  if (members.length === 0) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Bundle ${bundleId} has no members` }));
    return;
  }
  const aggregate = computeAggregate(bundleId, members);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(aggregate));
}

export function computeAggregate(bundleId: string, members: RunRecord[]): BundleAggregate {
  const costTotalUSD = members.reduce((sum, m) => sum + (m.costUSD ?? 0), 0);
  const durations = members.map(m => m.durationMs ?? 0).filter(d => d > 0);
  const meanDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  // Outcome buckets are populated when the artifact's fingerprint or a
  // dedicated column carries the outcome class. RunRecord alone does
  // not, so v1 returns an empty bucket map -- the AggregateStrip's
  // outcome chart treats empty buckets as "data unavailable" gracefully.
  const outcomeBuckets: Record<string, number> = {};
  return { bundleId, count: members.length, costTotalUSD, meanDurationMs, outcomeBuckets };
}
