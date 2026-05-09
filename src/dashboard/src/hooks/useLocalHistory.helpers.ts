/**
 * Pure helpers for useLocalHistory. Ring operations + event summarizing
 * + legacy-slot migration live here so they can run under node:test
 * without a DOM shim.
 *
 * @module paracosm/cli/dashboard/hooks/useLocalHistory.helpers
 */
import type { SimEvent } from './useSSE';

/** Single localStorage key shared across scenarios. v2 bump (0.8.0)
 * orphans entries written under the v0.7 schema where the summary
 * field was named `leaderNames`; reading those under the new
 * `actorNames` shape crashed RunMenu's `summary.actorNames.join(...)`
 * render path. New entries are written under the v2 key; old data
 * remains in localStorage harmlessly under v1 and is never read. */
export const HISTORY_STORAGE_KEY = 'paracosm-local-history-v2';

/** Default cap on the ring. Older entries are evicted on push. */
export const DEFAULT_HISTORY_CAP = 5;

/** Minimal storage interface so tests pass a `Map`-backed shim. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Summary derived from the event stream + cached at write time. */
export interface LocalHistorySummary {
  actorNames: string[];
  turnCount: number;
  eventCount: number;
  /** Total run cost USD when `_cost.totalCostUSD` was present on the last event. */
  totalCostUSD?: number;
}

/** One ring entry. Stored as a JSON object inside the ring array. */
export interface LocalHistoryEntry {
  /** Stable id (ms timestamp). Used as React key + delete handle. */
  id: number;
  /** ISO datetime the run was cached. Rendered as relative time in the UI. */
  createdAt: string;
  /** Event stream at cache-write time. */
  events: SimEvent[];
  /** Results[] from the run (typically A + B entries). */
  results: unknown[];
  /** End-of-sim verdict payload when present. */
  verdict?: Record<string, unknown> | null;
  /** Scenario short-name so the UI can filter cross-scenario. */
  scenarioShortName: string;
  /** Cached summary — recompute would re-scan every render otherwise. */
  summary: LocalHistorySummary;
}

/**
 * Read the ring from storage. Returns `[]` on missing / malformed /
 * non-array payloads — never throws.
 */
export function readHistory(storage: StorageLike): LocalHistoryEntry[] {
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LocalHistoryEntry[];
  } catch {
    return [];
  }
}

/** Serialize + write the ring. Silently swallows quota errors. */
export function writeHistory(
  storage: StorageLike,
  entries: LocalHistoryEntry[],
): void {
  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // QuotaExceededError or similar — skip. Caller can retry after
    // dropping entries if they care about recovery.
  }
}

/**
 * Prepend `entry` + trim to `maxSize`. Pure — returns a new array,
 * does not mutate the input. Newest-first ordering is enforced; any
 * extras off the tail end are evicted.
 */
export function pushHistoryEntry(
  entries: LocalHistoryEntry[],
  entry: LocalHistoryEntry,
  maxSize: number,
): LocalHistoryEntry[] {
  const next = [entry, ...entries];
  if (next.length <= maxSize) return next;
  return next.slice(0, maxSize);
}

/**
 * Remove the entry with `id` from the ring. Pure — returns a new
 * array. Missing id is a no-op (returns a new array with the same
 * contents).
 */
export function deleteHistoryEntry(
  entries: LocalHistoryEntry[],
  id: number,
): LocalHistoryEntry[] {
  return entries.filter(e => e.id !== id);
}

interface EventLike {
  type?: unknown;
  leader?: unknown;
  turn?: unknown;
  data?: unknown;
}

/**
 * Compute a ring-summary snapshot from the event stream. Same
 * inference rules as F9's `extractPreviewMetadata`: unique leader
 * names in first-seen order, max turn across events, event count,
 * cost from `_cost.totalCostUSD` on the last event that carried it.
 */
export function summarizeEvents(
  events: SimEvent[],
  _results: unknown[],
): LocalHistorySummary {
  const actorNames: string[] = [];
  const seen = new Set<string>();
  let maxTurn = 0;
  let totalCostUSD: number | undefined;

  const list = (events ?? []) as unknown as EventLike[];
  for (const e of list) {
    if (typeof e?.leader === 'string' && e.leader && !seen.has(e.leader)) {
      seen.add(e.leader);
      actorNames.push(e.leader);
    }
    const turn = extractTurn(e);
    if (turn > maxTurn) maxTurn = turn;
    const cost = extractCost(e);
    if (cost !== undefined) totalCostUSD = cost;
  }

  const summary: LocalHistorySummary = {
    actorNames,
    turnCount: maxTurn,
    eventCount: list.length,
  };
  if (totalCostUSD !== undefined) summary.totalCostUSD = totalCostUSD;
  return summary;
}

function extractTurn(e: EventLike): number {
  if (typeof e?.turn === 'number') return e.turn;
  if (e?.data && typeof e.data === 'object') {
    const t = (e.data as Record<string, unknown>).turn;
    if (typeof t === 'number') return t;
  }
  return 0;
}

function extractCost(e: EventLike): number | undefined {
  if (!e?.data || typeof e.data !== 'object') return undefined;
  const cost = (e.data as Record<string, unknown>)._cost;
  if (!cost || typeof cost !== 'object') return undefined;
  const total = (cost as Record<string, unknown>).totalCostUSD;
  return typeof total === 'number' ? total : undefined;
}

/**
 * Convert a pre-F14 legacy single-slot payload into a ring entry.
 * Returns `null` for payloads that don't match the expected shape
 * (no events array, empty events, non-object input).
 */
export function migrateLegacySlot(
  raw: unknown,
  scenarioShortName: string,
): LocalHistoryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const events = Array.isArray(obj.events) ? (obj.events as SimEvent[]) : null;
  if (!events || events.length === 0) return null;
  const results = Array.isArray(obj.results) ? (obj.results as unknown[]) : [];
  const verdict =
    obj.verdict && typeof obj.verdict === 'object'
      ? (obj.verdict as Record<string, unknown>)
      : null;
  const startedAt =
    typeof obj.startedAt === 'string' && obj.startedAt
      ? obj.startedAt
      : new Date().toISOString();
  return {
    id: Date.parse(startedAt) || makeHistoryId(),
    createdAt: startedAt,
    events,
    results,
    verdict,
    scenarioShortName,
    summary: summarizeEvents(events, results),
  };
}

/**
 * Produce a ring entry id. Uses `Date.now()` as the base; a process-
 * level counter monotonizes rapid calls so two pushes within the same
 * millisecond don't collide.
 */
let idCounter = 0;
let lastTs = 0;
export function makeHistoryId(): number {
  const now = Date.now();
  if (now === lastTs) {
    idCounter += 1;
    return now + idCounter / 1000;
  }
  lastTs = now;
  idCounter = 0;
  return now;
}
