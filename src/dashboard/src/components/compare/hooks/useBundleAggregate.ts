/**
 * Fetch the precomputed aggregate rollup for a bundle. Server-side
 * computes count + cost total + mean duration so the AggregateStrip
 * does not need to fetch all N artifacts to render its tiles.
 *
 * @module paracosm/dashboard/compare/hooks/useBundleAggregate
 */
import * as React from 'react';

export interface BundleAggregate {
  bundleId: string;
  count: number;
  costTotalUSD: number;
  meanDurationMs: number;
  outcomeBuckets: Record<string, number>;
}

export interface UseBundleAggregateResult {
  aggregate: BundleAggregate | null;
  loading: boolean;
  error: string | null;
}

export function useBundleAggregate(bundleId: string | null): UseBundleAggregateResult {
  const [state, setState] = React.useState<UseBundleAggregateResult>({ aggregate: null, loading: false, error: null });
  React.useEffect(() => {
    if (!bundleId) {
      setState({ aggregate: null, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ aggregate: null, loading: true, error: null });
    fetch(`/api/v1/bundles/${encodeURIComponent(bundleId)}/aggregate`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<BundleAggregate>;
      })
      .then((aggregate) => setState({ aggregate, loading: false, error: null }))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setState({ aggregate: null, loading: false, error: String(err.message ?? err) });
      });
    return () => ctrl.abort();
  }, [bundleId]);
  return state;
}
