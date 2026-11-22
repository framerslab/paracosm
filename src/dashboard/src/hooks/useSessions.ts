/**
 * @fileoverview The saved-run list (GET /sessions) every picker reads.
 *
 * One list for the page: Quickstart's "Replay last run" link, Load Prior
 * Run, the Run menu and the Load menu read the same snapshot. A picker
 * fetches it when it mounts and when it opens, and a `sim_saved` event
 * that reports a save or a title fetches it again
 * ({@link refreshOnSimSaved}), so a run saved while a picker stays mounted
 * shows up in every picker without a reload.
 *
 * @module paracosm/cli/dashboard/hooks/useSessions
 */
import { useEffect, useSyncExternalStore } from 'react';

/** Mirror of the server-side SessionMeta returned by GET /sessions. */
export interface StoredSessionMeta {
  id: string;
  createdAt: number;
  scenarioId?: string;
  scenarioName?: string;
  leaderA?: string;
  leaderB?: string;
  turnCount?: number;
  eventCount: number;
  durationMs?: number;
  totalCostUSD?: number;
  /** LLM-generated narrative title, e.g. "Aria's Cautious Descent".
   *  Populated asynchronously after the save lands; may be absent on
   *  rows from pre-titling deploys or where the title LLM call failed. */
  title?: string;
  /** Original seed prompt the user submitted to compile this scenario.
   *  Truncated to 1000 chars server-side. Absent on preset/Mars-Genesis
   *  runs and on rows saved before the seed-text plumbing landed. */
  seedText?: string;
  /** Full actor roster for 3+ actor runs. Absent on pair runs (n=2)
   *  and on rows saved before the multi-actor leaders column landed —
   *  consumers should fall back to leaderA / leaderB in that case. */
  leaders?: string[];
}

export type SessionsStatus = 'loading' | 'ready' | 'unavailable' | 'error';

export interface SessionsState {
  sessions: StoredSessionMeta[];
  status: SessionsStatus;
  /** Re-fetch the list for every picker on the page. */
  refresh: () => void;
}

/** What the shared list holds: the sessions (newest first, as the server lists them) and the fetch's state. */
export interface SavedSessionsSnapshot {
  sessions: StoredSessionMeta[];
  status: SessionsStatus;
}

/** A saved-run list several pickers read and any of them can refresh. */
export interface SavedSessionsStore {
  getSnapshot: () => SavedSessionsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Fetches the list; the answer to the newest fetch wins. */
  refresh: () => Promise<void>;
}

/**
 * A saved-run list over `load` (a GET /sessions). `unavailable` is the
 * server's 503 (no session store); `error` is any other failure.
 */
export function createSavedSessionsStore(load: () => Promise<Response>): SavedSessionsStore {
  let snapshot: SavedSessionsSnapshot = { sessions: [], status: 'loading' };
  const listeners = new Set<() => void>();
  let latest = 0;
  const set = (next: SavedSessionsSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh() {
      const request = ++latest;
      try {
        const res = await load();
        if (request !== latest) return;
        if (res.status === 503) return set({ sessions: [], status: 'unavailable' });
        if (!res.ok) return set({ sessions: [], status: 'error' });
        const json = (await res.json()) as { sessions?: StoredSessionMeta[] };
        if (request !== latest) return;
        set({ sessions: json.sessions ?? [], status: 'ready' });
      } catch {
        if (request !== latest) return;
        set({ sessions: [], status: 'error' });
      }
    },
  };
}

/**
 * Refreshes `store` when a `sim_saved` event reports a save that landed
 * (`saved`) or its title (`titled`); a skipped or failed save changes no
 * list.
 */
export async function refreshOnSimSaved(store: SavedSessionsStore, data: unknown): Promise<void> {
  const status = data && typeof data === 'object' ? (data as { status?: unknown }).status : undefined;
  if (status === 'saved' || status === 'titled') await store.refresh();
}

/** The page's saved-run list. */
export const savedSessions = createSavedSessionsStore(() => fetch('/sessions'));

/**
 * The page's saved-run list, fetched when the calling picker mounts.
 *
 * - `sessions`: newest first, per the server.
 * - `status`: `loading` before the first answer, `ready` on success,
 *   `unavailable` when the server returns 503 (session store not
 *   initialized), and `error` on any other failure.
 * - `refresh()`: fetch it again for every picker (e.g. when a menu opens).
 */
export function useSessions(): SessionsState {
  const snapshot = useSyncExternalStore(savedSessions.subscribe, savedSessions.getSnapshot, savedSessions.getSnapshot);
  useEffect(() => {
    void savedSessions.refresh();
  }, []);
  return { sessions: snapshot.sessions, status: snapshot.status, refresh: refreshSavedSessions };
}

/** Fetches the page's saved-run list again for every picker. */
export function refreshSavedSessions(): void {
  void savedSessions.refresh();
}
