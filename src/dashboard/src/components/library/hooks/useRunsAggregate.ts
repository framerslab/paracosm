import * as React from 'react';

export interface RunsAggregate {
  totalRuns: number;
  totalCostUSD: number;
  totalDurationMs: number;
  replaysAttempted: number;
  replaysMatched: number;
}

/**
 * The Library's run totals and replay counters from GET /api/v1/runs/aggregate,
 * read again when the filters change and when `refreshKey` changes (the
 * Library moves it after each replay the server counts).
 */
export function useRunsAggregate(filters: { mode?: string; scenario?: string; leader?: string } = {}, refreshKey = 0): {
  stats: RunsAggregate | null;
  loading: boolean;
  error: string | null;
} {
  const [stats, setStats] = React.useState<RunsAggregate | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const queryKey = JSON.stringify(filters);

  React.useEffect(() => {
    if (typeof fetch === 'undefined') return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (filters.mode) qs.set('mode', filters.mode);
    if (filters.scenario) qs.set('scenario', filters.scenario);
    if (filters.leader) qs.set('leader', filters.leader);
    fetch('/api/v1/runs/aggregate?' + qs.toString(), { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: RunsAggregate) => { setStats(data); setLoading(false); })
      .catch(err => { if (err.name !== 'AbortError') { setError(err.message); setLoading(false); } });
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, refreshKey]);

  return { stats, loading, error };
}
