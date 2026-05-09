/**
 * Fetch + URL-param state for the Library tab's run list.
 * Filters live in the URL; component state is hydrated from window.location
 * on mount and written back on every change.
 */
import * as React from 'react';
import type { RunRecord } from '../../../../../server/services/run-record.js';

export interface RunsListFilters {
  q?: string;
  mode?: 'turn-loop' | 'batch-trajectory' | 'batch-point';
  scenarioId?: string;
  actorConfigHash?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 24;

function readFiltersFromUrl(): RunsListFilters {
  const p = new URLSearchParams(window.location.search);
  const modeRaw = p.get('mode');
  const mode = (modeRaw === 'turn-loop' || modeRaw === 'batch-trajectory' || modeRaw === 'batch-point')
    ? modeRaw
    : undefined;
  return {
    q: p.get('q') ?? undefined,
    mode,
    scenarioId: p.get('scenario') ?? undefined,
    actorConfigHash: p.get('leader') ?? undefined,
    limit: Number(p.get('limit')) || DEFAULT_LIMIT,
    offset: Number(p.get('offset')) || 0,
  };
}

function buildQueryString(f: RunsListFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.mode) p.set('mode', f.mode);
  if (f.scenarioId) p.set('scenario', f.scenarioId);
  if (f.actorConfigHash) p.set('leader', f.actorConfigHash);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  if (f.offset !== undefined) p.set('offset', String(f.offset));
  return p.toString();
}

export function useRunsList(): {
  filters: RunsListFilters;
  setFilters: (f: RunsListFilters) => void;
  runs: RunRecord[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [filters, setFiltersState] = React.useState<RunsListFilters>(readFiltersFromUrl);
  const [runs, setRuns] = React.useState<RunRecord[]>([]);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (typeof fetch === 'undefined') return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch('/api/v1/runs?' + buildQueryString(filters), { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { runs: RunRecord[]; total: number; hasMore: boolean }) => {
        setRuns(data.runs);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [filters, version]);

  const setFilters = React.useCallback((next: RunsListFilters) => {
    setFiltersState(next);
    const qs = buildQueryString({ ...next, limit: next.limit ?? DEFAULT_LIMIT, offset: next.offset ?? 0 });
    const url = new URL(window.location.href);
    const tab = url.searchParams.get('tab');
    const runId = url.searchParams.get('runId');
    const view = url.searchParams.get('view');
    url.search = qs;
    if (tab) url.searchParams.set('tab', tab);
    if (runId) url.searchParams.set('runId', runId);
    if (view) url.searchParams.set('view', view);
    window.history.replaceState({}, '', url.toString());
  }, []);

  return {
    filters,
    setFilters,
    runs,
    total,
    hasMore,
    loading,
    error,
    refetch: () => setVersion(v => v + 1),
  };
}
