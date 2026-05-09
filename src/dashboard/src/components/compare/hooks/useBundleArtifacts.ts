/**
 * Lazy fetch RunArtifacts by runId. Pass an array of currently-needed
 * runIds (typically pinned cells); the hook fetches each id once and
 * caches the result. Cache survives the lifetime of the CompareModal
 * mount; re-rendering the modal with the same ids is a no-op.
 *
 * @module paracosm/dashboard/compare/hooks/useBundleArtifacts
 */
import * as React from 'react';
import type { RunArtifact } from '../../../../../engine/schema/index.js';

export interface UseBundleArtifactsResult {
  artifacts: Record<string, RunArtifact | undefined>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
}

export function useBundleArtifacts(runIds: string[]): UseBundleArtifactsResult {
  const [artifacts, setArtifacts] = React.useState<Record<string, RunArtifact | undefined>>({});
  const [loading, setLoading] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});

  // Stable string key from runIds so the effect re-runs when the SET
  // of needed ids changes (additions or removals), not on every parent
  // render. The set ordering matters for the dependency comparison.
  const idsKey = JSON.stringify([...runIds].sort());

  React.useEffect(() => {
    const ctrls: AbortController[] = [];
    for (const id of runIds) {
      // Bail if we already have it or are already fetching.
      if (artifacts[id] !== undefined || loading[id]) continue;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      setLoading((prev) => ({ ...prev, [id]: true }));
      fetch(`/api/v1/runs/${encodeURIComponent(id)}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<RunArtifact>;
        })
        .then((artifact) => {
          setArtifacts((prev) => ({ ...prev, [id]: artifact }));
          setLoading((prev) => ({ ...prev, [id]: false }));
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setErrors((prev) => ({ ...prev, [id]: String(err?.message ?? err) }));
          setLoading((prev) => ({ ...prev, [id]: false }));
        });
    }
    return () => { ctrls.forEach((c) => c.abort()); };
    // We intentionally key on `idsKey` only; reading artifacts/loading
    // inside is guarded by the conditional above so stale reads cannot
    // cause double-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return { artifacts, loading, errors };
}
