/**
 * Pure helper that enriches a base RunRecord with artifact-derived fields.
 *
 * server-app creates a sparse RunRecord at run-start (with the runId,
 * scenarioId, and leader hash already known). When the simulation
 * completes and the artifact is available, this helper populates the
 * Library-tab fields (artifactPath, costUSD, durationMs, mode,
 * actorName, actorArchetype) so the dashboard can render gallery
 * cards and load full artifacts via /api/v1/runs/:runId.
 *
 * artifactPath comes from `artifact.scenarioExtensions.outputPath`,
 * which the orchestrator stashes after writeRunOutput returns the
 * absolute path of the on-disk JSON. If outputPath is missing (legacy
 * artifacts or test fixtures), the field is left undefined and the
 * Library-tab "Open" action returns 410 Gone for that record.
 *
 * @module paracosm/cli/server/enrich-run-record
 */
import type { RunRecord } from './run-record.js';
import type { RunArtifact } from '../../engine/schema/index.js';
import { extractSummaryTrajectory } from './run-summary-trajectory.js';

export function enrichRunRecordFromArtifact(base: RunRecord, artifact: RunArtifact): RunRecord {
  const ext = artifact.scenarioExtensions as
    | {
        outputPath?: string;
        paracosmInternal?: {
          leader?: { name?: string; archetype?: string };
        };
      }
    | undefined;
  const meta = artifact.metadata;
  // Leader metadata lives at `scenarioExtensions.paracosmInternal.leader`
  // (where the orchestrator stashes the resolved actor config). Older
  // call paths checked the top-level `artifact.leader` key, which the
  // engine has never populated — that's why the Library tab shows
  // "names not recorded" on every run before this fix. Fall through to
  // the top-level slot only as a last-resort for synthetic test
  // artifacts that hand-roll the shape.
  const leader =
    ext?.paracosmInternal?.leader ??
    (artifact as { leader?: { name?: string; archetype?: string } }).leader;
  const cost = (artifact as { cost?: { totalUSD?: number } }).cost;

  const startedAt = meta?.startedAt;
  const completedAt = (meta as { completedAt?: string } | undefined)?.completedAt;
  const durationMs = startedAt && completedAt
    ? Date.parse(completedAt) - Date.parse(startedAt)
    : undefined;

  const enriched: RunRecord = { ...base };
  if (ext?.outputPath) enriched.artifactPath = ext.outputPath;
  if (typeof cost?.totalUSD === 'number') enriched.costUSD = cost.totalUSD;
  if (durationMs !== undefined && Number.isFinite(durationMs)) enriched.durationMs = durationMs;
  if (meta?.mode === 'turn-loop' || meta?.mode === 'batch-trajectory' || meta?.mode === 'batch-point') {
    enriched.mode = meta.mode;
  }
  if (leader?.name) enriched.actorName = leader.name;
  if (leader?.archetype) enriched.actorArchetype = leader.archetype;

  // Sample 8 trajectory points for the Compare view's cell sparkline so
  // the SmallMultiplesGrid can render without fetching the full artifact.
  const summary = extractSummaryTrajectory(artifact, 8);
  if (summary.length > 0) enriched.summaryTrajectory = summary;

  return enriched;
}
