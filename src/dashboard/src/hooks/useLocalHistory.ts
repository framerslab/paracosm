/**
 * React wrapper over the local-history ring. Reads the ring on mount,
 * runs the legacy-slot migration once, exposes push / remove / clear /
 * restore operations. All persistence logic lives in the sibling
 * helpers file; this module is pure React wiring.
 *
 * @module paracosm/cli/dashboard/hooks/useLocalHistory
 */
import { useCallback, useEffect, useState } from 'react';
import type { SimEvent } from './useSSE';
import {
  DEFAULT_HISTORY_CAP,
  deleteHistoryEntry,
  makeHistoryId,
  migrateLegacySlot,
  pushHistoryEntry,
  readHistory,
  summarizeEvents,
  writeHistory,
  type LocalHistoryEntry,
  type StorageLike,
} from './useLocalHistory.helpers';

/** Legacy single-slot key pattern from pre-F14 useGamePersistence. */
function legacySlotKey(scenarioShortName: string): string {
  return `${scenarioShortName}-game-data`;
}

export interface UseLocalHistoryOptions {
  scenarioShortName: string;
  /** Cap on the ring size. Defaults to {@link DEFAULT_HISTORY_CAP}. */
  maxSize?: number;
  /** DI hook for tests; production callers omit to use `window.localStorage`. */
  storage?: StorageLike;
}

export interface UseLocalHistoryApi {
  /** Current ring snapshot, newest-first. Re-reads on every mutation. */
  entries: LocalHistoryEntry[];
  /** Cache a completed run. `verdict` is optional. */
  push(params: {
    events: SimEvent[];
    results: unknown[];
    verdict?: Record<string, unknown> | null;
  }): void;
  /** Drop a specific entry by id. No-op if id is missing. */
  remove(id: number): void;
  /** Empty the ring entirely. */
  clear(): void;
  /**
   * Restore an entry's events into the live SSE state. Caller supplies
   * the dispatch function so this module stays agnostic of useSSE.
   */
  restore(
    entry: LocalHistoryEntry,
    loadEvents: (
      events: SimEvent[],
      results?: unknown[],
      verdict?: Record<string, unknown> | null,
    ) => void,
  ): void;
}

export function useLocalHistory(
  opts: UseLocalHistoryOptions,
): UseLocalHistoryApi {
  const storage: StorageLike =
    opts.storage ??
    (typeof window !== 'undefined'
      ? window.localStorage
      : { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const maxSize = opts.maxSize ?? DEFAULT_HISTORY_CAP;

  const [entries, setEntries] = useState<LocalHistoryEntry[]>(() =>
    readHistory(storage),
  );

  // One-time legacy migration. Runs on mount per scenario; safe to
  // re-run because migrateLegacySlot returns null when the key is
  // empty or absent (and we remove it after the first successful pull).
  useEffect(() => {
    const raw = storage.getItem(legacySlotKey(opts.scenarioShortName));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const entry = migrateLegacySlot(parsed, opts.scenarioShortName);
      if (entry) {
        setEntries((current) => {
          const next = pushHistoryEntry(current, entry, maxSize);
          writeHistory(storage, next);
          return next;
        });
      }
    } catch {
      // Malformed legacy payload — drop it below.
    }
    storage.removeItem(legacySlotKey(opts.scenarioShortName));
  }, [opts.scenarioShortName, maxSize, storage]);

  const push = useCallback(
    (params: {
      events: SimEvent[];
      results: unknown[];
      verdict?: Record<string, unknown> | null;
    }) => {
      if (!params.events || params.events.length === 0) return;
      const entry: LocalHistoryEntry = {
        id: makeHistoryId(),
        createdAt: new Date().toISOString(),
        events: params.events,
        results: params.results,
        verdict: params.verdict ?? null,
        scenarioShortName: opts.scenarioShortName,
        summary: summarizeEvents(params.events, params.results),
      };
      setEntries((current) => {
        const next = pushHistoryEntry(current, entry, maxSize);
        writeHistory(storage, next);
        return next;
      });
    },
    [opts.scenarioShortName, maxSize, storage],
  );

  const remove = useCallback(
    (id: number) => {
      setEntries((current) => {
        const next = deleteHistoryEntry(current, id);
        writeHistory(storage, next);
        return next;
      });
    },
    [storage],
  );

  const clear = useCallback(() => {
    setEntries([]);
    writeHistory(storage, []);
  }, [storage]);

  const restore = useCallback(
    (
      entry: LocalHistoryEntry,
      loadEvents: (
        events: SimEvent[],
        results?: unknown[],
        verdict?: Record<string, unknown> | null,
      ) => void,
    ) => {
      loadEvents(entry.events, entry.results, entry.verdict ?? null);
    },
    [],
  );

  return { entries, push, remove, clear, restore };
}
