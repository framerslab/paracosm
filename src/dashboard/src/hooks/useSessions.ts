/**
 * @fileoverview React hook for the stored-sessions catalog.
 *
 * Wraps a single GET /sessions fetch with status + refresh semantics so
 * the SettingsPanel and any other consumer can render the saved-runs
 * picker without each managing fetch state independently.
 *
 * Polling is intentionally NOT built in — the catalog changes only when
 * an admin explicitly saves a run, so a one-shot fetch on mount + an
 * exposed refresh() callback is enough. Callers that need to refresh
 * after a save can call refresh() directly.
 *
 * @module paracosm/cli/dashboard/hooks/useSessions
 */
import { useCallback, useEffect, useState } from 'react';

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
  /** Re-fetch the catalog. Caller should invoke after a save. */
  refresh: () => void;
}

/**
 * Fetches the saved-sessions catalog on mount.
 *
 * Returns:
 * - `sessions`: the latest snapshot (newest first per server contract).
 * - `status`: `loading` while in flight, `ready` on success,
 *   `unavailable` when the server returns 503 (session store not
 *   initialized), and `error` on any other failure.
 * - `refresh()`: trigger a re-fetch (e.g. after admin saves a run).
 */
export function useSessions(): SessionsState {
  const [sessions, setSessions] = useState<StoredSessionMeta[]>([]);
  const [status, setStatus] = useState<SessionsStatus>('loading');
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch('/sessions')
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 503) {
          setStatus('unavailable');
          setSessions([]);
          return;
        }
        if (!r.ok) {
          setStatus('error');
          setSessions([]);
          return;
        }
        const json = (await r.json()) as { sessions?: StoredSessionMeta[] };
        if (cancelled) return;
        setSessions(json.sessions ?? []);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
        setSessions([]);
      });
    return () => { cancelled = true; };
  }, [tick]);

  return { sessions, status, refresh };
}
