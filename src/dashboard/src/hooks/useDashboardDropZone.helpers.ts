/**
 * Pure helpers for useDashboardDropZone. DOM references kept structural
 * (no direct browser-only imports) so the module runs under node:test.
 *
 * @module paracosm/cli/dashboard/hooks/useDashboardDropZone.helpers
 */

/**
 * Outcome of inspecting a drop's File list.
 *
 * - `empty`: nothing to do (e.g. a non-file drag, or no files in the
 *   event payload).
 * - `ok`: exactly one valid `.json` file present.
 * - `ok-with-extras`: the first file is a valid `.json` but the user
 *   dropped additional files. Consumer typically shows an info toast
 *   and loads the first file only.
 * - `unsupported`: the first file is not a `.json`. Consumer typically
 *   shows an error toast and ignores the drop.
 */
export type DropFilesResult =
  | { kind: 'empty' }
  | { kind: 'ok'; file: File }
  | { kind: 'ok-with-extras'; file: File; totalCount: number }
  | { kind: 'unsupported' };

/**
 * Inspect a list of dropped files and classify the outcome. Uses
 * case-insensitive `.json` extension matching (matches
 * `useGamePersistence`'s file-picker `accept = '.json'` filter).
 */
export function validateDropFiles(files: readonly File[]): DropFilesResult {
  if (!files || files.length === 0) return { kind: 'empty' };
  const first = files[0];
  if (!first || !first.name || !first.name.toLowerCase().endsWith('.json')) {
    return { kind: 'unsupported' };
  }
  if (files.length === 1) return { kind: 'ok', file: first };
  return { kind: 'ok-with-extras', file: first, totalCount: files.length };
}

/**
 * Determine whether a DataTransfer carries file payload. Handles both
 * the DOMStringList-like `types.contains()` form (live DataTransfer from
 * drag events in browsers) and the plain-array form used in tests.
 */
export function hasFilesDragPayload(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  const types = dt.types as unknown as
    | { contains?: (s: string) => boolean; length?: number; [k: number]: string }
    | string[];
  if (Array.isArray(types)) {
    return types.includes('Files');
  }
  if (types && typeof types.contains === 'function') {
    return types.contains('Files');
  }
  return false;
}
