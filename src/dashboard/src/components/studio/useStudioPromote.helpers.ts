/**
 * The run as the Studio tab posts it to `/api/v1/library/import`.
 *
 * @module paracosm/dashboard/studio/useStudioPromote.helpers
 */

/** The run as the import posts it. */
export function artifactForImport<T extends { scenarioExtensions?: unknown }>(artifact: T): T {
  return artifact;
}
