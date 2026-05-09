/**
 * Pure helpers for useLoadPreview. DOM / React imports forbidden here so
 * the module can run under node:test without a browser shim. The hook
 * file (useLoadPreview.ts) consumes these; the component consumes only
 * what the hook exposes.
 *
 * @module paracosm/cli/dashboard/hooks/useLoadPreview.helpers
 */

/**
 * Comparison outcome between a file's declared/inferred scenario and the
 * dashboard's active scenario. Populated only when the caller passes a
 * `currentScenario` to {@link extractPreviewMetadata}.
 */
export type ScenarioMatchState = 'match' | 'mismatch' | 'unknown';

export interface ScenarioMatch {
  state: ScenarioMatchState;
  fileScenarioName: string;
  currentScenarioName: string;
}

/**
 * Normalized metadata the LoadPreviewModal renders. Every field is
 * display-ready; `schemaVersion` is either a number (canonical) or the
 * literal string `'legacy'` when the file predates the 0.5.0 schema
 * bump (no `schemaVersion` field written).
 */
export interface PreviewMetadata {
  /** Scenario display name, inferred in priority order from the file. */
  scenarioName: string;
  /** Saved schema version or `'legacy'` for pre-0.5 files. */
  schemaVersion: number | 'legacy';
  /** Deduplicated list of leader names seen in the event stream. */
  actorNames: string[];
  /** Highest turn number observed across all events. */
  turnCount: number;
  /** Number of events in the stream. */
  eventCount: number;
  /** ISO datetime the run started at, or `null` when absent. */
  startedAt: string | null;
  /** `true` when the saved file carries a verdict object. */
  hasVerdict: boolean;
  /** Selected file's name, or `''` when no file argument was passed. */
  fileName: string;
  /** Human-readable size string (e.g. `'142 KB'`), or `''` when absent. */
  fileSize: string;
  /**
   * Scenario match outcome vs the dashboard's active scenario. Only
   * present when a `currentScenario` was supplied.
   */
  scenarioMatch?: ScenarioMatch;
}

/** Identity extracted from a saved file for match comparison. */
export interface ScenarioIdentity {
  id?: string;
  name?: string;
  /**
   * - `'declared'`: the file carries a top-level `scenario: { id, ... }`
   *   stamp (F9 save format and later).
   * - `'inferred'`: only event-level `data.scenario.name`/`id` were
   *   present; identity was extracted from there.
   * - `'unknown'`: no scenario signals anywhere in the file.
   */
  source: 'declared' | 'inferred' | 'unknown';
}

/** Dashboard's active-scenario context, used for match computation. */
export interface CurrentScenarioContext {
  id: string;
  name: string;
}

interface EventLike {
  type?: unknown;
  leader?: unknown;
  turn?: unknown;
  data?: unknown;
}

interface FileInfo {
  name: string;
  size: number;
}

/**
 * Extract a display-ready metadata snapshot from parsed save-file JSON.
 *
 * Returns `null` for input that can't reasonably preview: non-object
 * inputs, empty events, or missing events. Otherwise best-effort
 * inference fills every field so the modal never renders a blank row.
 *
 * @param data Raw parsed JSON (unknown because the reader hands us raw
 *   FileReader output; we do the shape narrowing here).
 * @param file Optional File-shape descriptor for the name/size row.
 */
export function extractPreviewMetadata(
  data: unknown,
  file?: FileInfo,
  currentScenario?: CurrentScenarioContext,
): PreviewMetadata | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  const events = Array.isArray(obj.events) ? (obj.events as EventLike[]) : null;
  if (!events || events.length === 0) return null;

  const actorNames: string[] = [];
  const seenLeaders = new Set<string>();
  let maxTurn = 0;
  for (const e of events) {
    if (typeof e?.leader === 'string' && e.leader && !seenLeaders.has(e.leader)) {
      seenLeaders.add(e.leader);
      actorNames.push(e.leader);
    }
    const turn = extractTurn(e);
    if (turn > maxTurn) maxTurn = turn;
  }

  const schemaVersion =
    typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 'legacy';

  const hasVerdict = obj.verdict !== null && obj.verdict !== undefined;

  const startedAt =
    typeof obj.startedAt === 'string' && obj.startedAt ? obj.startedAt : null;

  const scenarioName = inferScenarioName(obj, events);

  let scenarioMatch: ScenarioMatch | undefined;
  if (currentScenario) {
    const identity = inferScenarioIdentity(data);
    scenarioMatch = {
      state: computeMatchState(identity, currentScenario),
      fileScenarioName: scenarioName,
      currentScenarioName: currentScenario.name,
    };
  }

  return {
    scenarioName,
    schemaVersion,
    actorNames,
    turnCount: maxTurn,
    eventCount: events.length,
    startedAt,
    hasVerdict,
    fileName: file?.name ?? '',
    fileSize: file ? formatFileSize(file.size) : '',
    ...(scenarioMatch ? { scenarioMatch } : {}),
  };
}

/**
 * Extract a scenario identity from parsed save data. Priority:
 *   1. Top-level `scenario: { id, shortName }` (F9 save format)
 *   2. First event's `data.scenario.{id, name}` (director-emitted)
 *   3. Fall through to `source: 'unknown'`
 *
 * The `source` field distinguishes trusted declarations from heuristic
 * inference so the UI can decide how strongly to warn on mismatch.
 */
export function inferScenarioIdentity(data: unknown): ScenarioIdentity {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { source: 'unknown' };
  }
  const obj = data as Record<string, unknown>;

  const topScenario = obj.scenario;
  if (topScenario && typeof topScenario === 'object') {
    const rec = topScenario as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : undefined;
    const shortName = typeof rec.shortName === 'string' ? rec.shortName : undefined;
    if (id || shortName) {
      return { id, name: shortName, source: 'declared' };
    }
  }

  const events = Array.isArray(obj.events) ? (obj.events as EventLike[]) : [];
  for (const e of events) {
    if (!e?.data || typeof e.data !== 'object') continue;
    const scenarioRec = (e.data as Record<string, unknown>).scenario;
    if (scenarioRec && typeof scenarioRec === 'object') {
      const rec = scenarioRec as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id : undefined;
      const name = typeof rec.name === 'string' ? rec.name : undefined;
      if (id || name) return { id, name, source: 'inferred' };
    }
  }

  return { source: 'unknown' };
}

/**
 * Compare a file's extracted identity to the dashboard's active
 * scenario. Primary match is by `id`; falls back to `name` when the
 * file only carried a name-level signal. Returns `'unknown'` when the
 * file's source is `'unknown'`.
 */
export function computeMatchState(
  file: ScenarioIdentity,
  current: CurrentScenarioContext,
): ScenarioMatchState {
  if (file.source === 'unknown') return 'unknown';
  if (file.id && file.id === current.id) return 'match';
  if (!file.id && file.name && file.name === current.name) return 'match';
  return 'mismatch';
}

/**
 * Read the turn number from an event in either the top-level
 * `event.turn` or nested `event.data.turn` position.
 */
function extractTurn(e: EventLike): number {
  if (typeof e?.turn === 'number') return e.turn;
  if (e?.data && typeof e.data === 'object') {
    const t = (e.data as Record<string, unknown>).turn;
    if (typeof t === 'number') return t;
  }
  return 0;
}

/**
 * Inference priority:
 *   1. First event whose `data.scenario.name` is set (emitted by the
 *      director on turn 1).
 *   2. Top-level `data.scenario.shortName` (written by save() as of F9).
 *   3. The literal string `'unknown'`.
 */
function inferScenarioName(
  obj: Record<string, unknown>,
  events: EventLike[],
): string {
  for (const e of events) {
    if (!e?.data || typeof e.data !== 'object') continue;
    const eventScenario = (e.data as Record<string, unknown>).scenario;
    if (eventScenario && typeof eventScenario === 'object') {
      const name = (eventScenario as Record<string, unknown>).name;
      if (typeof name === 'string' && name) return name;
    }
  }

  const topScenario = obj.scenario;
  if (topScenario && typeof topScenario === 'object') {
    const shortName = (topScenario as Record<string, unknown>).shortName;
    if (typeof shortName === 'string' && shortName) return shortName;
    const id = (topScenario as Record<string, unknown>).id;
    if (typeof id === 'string' && id) return id;
  }

  return 'unknown';
}

/**
 * State machine for the load-preview flow.
 *
 *   idle --[open-started]--> parsing
 *   parsing --[open-succeeded]--> preview
 *   parsing --[open-failed]--> idle
 *   preview --[cancel]--> idle
 *   preview --[confirm]--> dispatching
 *   dispatching --[confirm-complete]--> idle
 *
 * Any other transition is a no-op (returns the same state reference so
 * React state comparison sees no change).
 */
export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'preview'; metadata: PreviewMetadata; data: unknown }
  | { kind: 'dispatching'; data: unknown };

export type PreviewAction =
  | { type: 'open-started' }
  | { type: 'open-succeeded'; metadata: PreviewMetadata; data: unknown }
  | { type: 'open-failed' }
  | { type: 'cancel' }
  | { type: 'confirm' }
  | { type: 'confirm-complete' };

/**
 * Pure reducer. Rejecting an action returns the exact same state
 * reference so React's bailout logic short-circuits re-renders.
 */
export function reducePreviewState(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  if (state.kind === 'idle' && action.type === 'open-started') {
    return { kind: 'parsing' };
  }
  if (state.kind === 'parsing' && action.type === 'open-succeeded') {
    return { kind: 'preview', metadata: action.metadata, data: action.data };
  }
  if (state.kind === 'parsing' && action.type === 'open-failed') {
    return { kind: 'idle' };
  }
  if (state.kind === 'preview' && action.type === 'cancel') {
    return { kind: 'idle' };
  }
  if (state.kind === 'preview' && action.type === 'confirm') {
    return { kind: 'dispatching', data: state.data };
  }
  if (state.kind === 'dispatching' && action.type === 'confirm-complete') {
    return { kind: 'idle' };
  }
  return state;
}

/**
 * Human-readable file size. Bytes for sub-KB, whole KB for < 1 MB,
 * one-decimal MB otherwise. Trailing `.0` is stripped so `1.0 MB`
 * renders as `1 MB`.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  const rounded = Math.round(mb * 10) / 10;
  const fixed = rounded.toFixed(1);
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed} MB`;
}
