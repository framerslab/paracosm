/**
 * The run as the Studio tab posts it to `/api/v1/library/import`.
 *
 * @module paracosm/dashboard/studio/useStudioPromote.helpers
 */

/**
 * The kernel snapshots a saved run holds: the end of each turn, the start
 * of the run and the state after each between-turn step (#235). The import
 * keeps none of them.
 */
const KERNEL_SNAPSHOTS = new Set(['kernelSnapshotsPerTurn', 'kernelSnapshotAtStart', 'kernelSnapshotsAfterProgression']);

/**
 * The run as the import posts it: without its kernel snapshots. The import
 * stores a run record built from the run's metadata, leader, cost and
 * trajectory, and the server refuses a request body over its limit (5 MiB
 * unless `MAX_REQUEST_BODY_BYTES` sets another), which a bundle of whole
 * runs can pass. The run the page holds keeps them.
 */
export function artifactForImport<T extends { scenarioExtensions?: unknown }>(artifact: T): T {
  const ext = artifact.scenarioExtensions;
  if (!ext || typeof ext !== 'object') return artifact;
  const kept = Object.fromEntries(Object.entries(ext as Record<string, unknown>).filter(([key]) => !KERNEL_SNAPSHOTS.has(key)));
  return { ...artifact, scenarioExtensions: kept };
}
