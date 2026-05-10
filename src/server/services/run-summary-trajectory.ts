/**
 * Sample a small number array from a RunArtifact's trajectory so the
 * SmallMultiplesGrid cell can render a sparkline without fetching the
 * full artifact. Persisted to the runs table at insert time.
 *
 * Each TrajectoryPoint carries `{ time, metrics: Record<string, number> }`,
 * not a single value. We pick one representative metric (preferring
 * "population", then "morale", then the first key seen in any point)
 * and sample its values evenly across the trajectory.
 *
 * @module paracosm/cli/server/run-summary-trajectory
 */
import type { RunArtifact } from '../../engine/schema/index.js';

const PREFERRED_METRICS = ['population', 'morale', 'crew', 'health'] as const;

export function extractSummaryTrajectory(artifact: Partial<RunArtifact>, n = 8): number[] {
  const points = artifact?.trajectory?.points;
  if (!Array.isArray(points) || points.length === 0) return [];
  const metricId = pickRepresentativeMetric(points);
  if (!metricId) return [];
  if (points.length <= n) {
    return points.map(p => readMetric(p?.metrics, metricId));
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / (n - 1)) * (points.length - 1));
    out.push(readMetric(points[idx]?.metrics, metricId));
  }
  return out;
}

/** Look across all points for a metric to plot. Prefers semantic ids,
 *  falls back to the first numeric key found. */
function pickRepresentativeMetric(
  points: Array<{ metrics?: Record<string, number> }>,
): string | null {
  const seen = new Set<string>();
  for (const p of points) {
    if (!p?.metrics) continue;
    for (const k of Object.keys(p.metrics)) {
      seen.add(k);
    }
  }
  for (const id of PREFERRED_METRICS) {
    if (seen.has(id)) return id;
  }
  const first = [...seen][0];
  return first ?? null;
}

function readMetric(metrics: Record<string, number> | undefined, id: string): number {
  const v = metrics?.[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
