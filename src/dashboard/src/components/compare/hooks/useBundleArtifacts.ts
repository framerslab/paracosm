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
  // Reads in flight, by run id. A read outlives a change to the pinned set,
  // so pinning a second run never cancels the first run's read; reads are
  // cancelled only when the hook unmounts.
  const reads = React.useRef(new Map<string, AbortController>());

  // Stable string key from runIds so the effect re-runs when the SET
  // of needed ids changes (additions or removals), not on every parent
  // render. The set ordering matters for the dependency comparison.
  const idsKey = JSON.stringify([...runIds].sort());

  React.useEffect(() => {
    for (const id of runIds) {
      // Bail if we already have it or are already fetching.
      if (artifacts[id] !== undefined || reads.current.has(id)) continue;
      const ctrl = new AbortController();
      reads.current.set(id, ctrl);
      setLoading((prev) => ({ ...prev, [id]: true }));
      // A run pinned again after a failed read starts without the old error.
      setErrors((prev) => ({ ...prev, [id]: undefined }));
      fetch(`/api/v1/runs/${encodeURIComponent(id)}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const detail = await res.json() as { artifact?: RunArtifact } | null;
          const artifact = detail?.artifact;
          if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
            throw new Error('Run artifact missing or invalid');
          }
          return artifact;
        })
        .then((artifact) => {
          setArtifacts((prev) => ({ ...prev, [id]: artifact }));
          setErrors((prev) => ({ ...prev, [id]: undefined }));
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setErrors((prev) => ({ ...prev, [id]: String(err?.message ?? err) }));
        })
        .finally(() => {
          if (ctrl.signal.aborted) return;
          if (reads.current.get(id) === ctrl) reads.current.delete(id);
          setLoading((prev) => ({ ...prev, [id]: false }));
        });
    }
    // We intentionally key on `idsKey` only; reading `artifacts` inside is
    // guarded by the conditional above, and `reads` holds the reads in
    // flight, so stale reads cannot cause double-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  React.useEffect(() => {
    const open = reads.current;
    return () => {
      open.forEach((ctrl) => ctrl.abort());
      open.clear();
    };
  }, []);

  return { artifacts, loading, errors };
}
