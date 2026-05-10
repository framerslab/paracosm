/**
 * Fetch the bundle metadata + member RunRecords for a given bundleId.
 * Used by CompareModal as the entry-point fetch; full RunArtifacts
 * are loaded per-cell on demand via useBundleArtifacts.
 *
 * @module paracosm/dashboard/compare/hooks/useBundle
 */
import * as React from 'react';
import type { RunRecord } from '../../../../../server/services/run-record.js';

export interface BundlePayload {
  bundleId: string;
  scenarioId: string;
  createdAt: string;
  memberCount: number;
  members: RunRecord[];
}

export interface UseBundleResult {
  bundle: BundlePayload | null;
  loading: boolean;
  error: string | null;
}

export function useBundle(bundleId: string | null): UseBundleResult {
  const [state, setState] = React.useState<UseBundleResult>({ bundle: null, loading: false, error: null });
  React.useEffect(() => {
    if (!bundleId) {
      setState({ bundle: null, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ bundle: null, loading: true, error: null });
    fetch(`/api/v1/bundles/${encodeURIComponent(bundleId)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
        return res.json() as Promise<BundlePayload>;
      })
      .then((bundle) => setState({ bundle, loading: false, error: null }))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setState({ bundle: null, loading: false, error: String(err.message ?? err) });
      });
    return () => ctrl.abort();
  }, [bundleId]);
  return state;
}
