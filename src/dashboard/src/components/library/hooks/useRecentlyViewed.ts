import * as React from 'react';
import type { RunRecord } from '../../../../../server/services/run-record.js';

const STORAGE_KEY = 'paracosm-library-recent';
const MAX_RECENT = 5;

export function useRecentlyViewed(): {
  records: RunRecord[];
  push: (record: RunRecord) => void;
  remove: (runId: string) => void;
  clear: () => void;
} {
  const [records, setRecords] = React.useState<RunRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as RunRecord[]) : [];
    } catch {
      return [];
    }
  });

  // On mount, validate every cached id against /api/v1/runs/:id. Anything
  // the server no longer recognizes (Wipe All on the server side, TTL
  // eviction, manual deletion via admin tooling) is dropped from the
  // strip so a stale localStorage cache stops surfacing dead cards that
  // 404 on click. The validation runs in parallel and silently swallows
  // network-level failures — offline or transient errors should NOT
  // prune the strip, only authoritative 404s.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (records.length === 0) return;
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        records.map(async (r) => {
          try {
            const res = await fetch(`/api/v1/runs/${encodeURIComponent(r.runId)}`, { method: 'HEAD' });
            // 404 is the only authoritative "this run is gone" signal.
            // 5xx / network errors leave the card in place — the user
            // can still click into it and see the friendlier
            // RunDetailDrawer error UI, and the next mount retries.
            if (res.status === 404) return { id: r.runId, alive: false };
            return { id: r.runId, alive: true };
          } catch {
            return { id: r.runId, alive: true };
          }
        }),
      );
      if (cancelled) return;
      const dead = new Set(checks.filter(c => !c.alive).map(c => c.id));
      if (dead.size === 0) return;
      setRecords((prev) => {
        const filtered = prev.filter(r => !dead.has(r.runId));
        try {
          if (filtered.length === 0) {
            window.localStorage.removeItem(STORAGE_KEY);
          } else {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
          }
        } catch { /* quota */ }
        return filtered;
      });
    })();
    return () => { cancelled = true; };
    // Validate exactly once per mount; per-id retries happen on the
    // next dashboard load, not on every state churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const push = React.useCallback((record: RunRecord) => {
    setRecords(prev => {
      const filtered = prev.filter(r => r.runId !== record.runId);
      const next = [record, ...filtered].slice(0, MAX_RECENT);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  /**
   * Drop a single id from the strip. Called by RunDetailDrawer when the
   * backing artifact 404s on open so a click on a ghost card both
   * reports the not-found state AND prunes the cache, instead of leaving
   * the card hanging around for the next click.
   */
  const remove = React.useCallback((runId: string) => {
    setRecords(prev => {
      const filtered = prev.filter(r => r.runId !== runId);
      if (filtered.length === prev.length) return prev;
      try {
        if (filtered.length === 0) {
          window.localStorage.removeItem(STORAGE_KEY);
        } else {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        }
      } catch { /* quota */ }
      return filtered;
    });
  }, []);

  const clear = React.useCallback(() => {
    setRecords([]);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  return { records, push, remove, clear };
}
