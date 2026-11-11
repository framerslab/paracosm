/**
 * Wraps the POST /api/v1/library/import call. One hook for both single
 * + bundle. Caller passes whichever shape; the hook posts the right
 * body. Returns { promoteSingle, promoteBundle, busy, lastResult, error }.
 *
 * @module paracosm/dashboard/studio/useStudioPromote
 */
import * as React from 'react';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface PromoteSingleResult {
  kind: 'single';
  runId: string;
  alreadyExisted: boolean;
}

export interface PromoteBundleResult {
  kind: 'bundle';
  bundleId: string;
  runIds: string[];
  alreadyExisted: boolean[];
}

export type PromoteResult = PromoteSingleResult | PromoteBundleResult;

export interface UseStudioPromote {
  promoteSingle: (artifact: RunArtifact) => Promise<PromoteSingleResult | null>;
  promoteBundle: (artifacts: RunArtifact[]) => Promise<PromoteBundleResult | null>;
  busy: boolean;
  lastResult: PromoteResult | null;
  error: string | null;
}

export function useStudioPromote(): UseStudioPromote {
  const [busy, setBusy] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<PromoteResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const promoteSingle = React.useCallback(async (artifact: RunArtifact): Promise<PromoteSingleResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setError(body.error ?? `Promote failed: HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { runId: string; alreadyExisted: boolean };
      const result: PromoteSingleResult = { kind: 'single', ...body };
      setLastResult(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const promoteBundle = React.useCallback(async (artifacts: RunArtifact[]): Promise<PromoteBundleResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/library/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifacts }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setError(body.error ?? `Promote failed: HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { bundleId: string; runIds: string[]; alreadyExisted: boolean[] };
      const result: PromoteBundleResult = { kind: 'bundle', ...body };
      setLastResult(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { promoteSingle, promoteBundle, busy, lastResult, error };
}
