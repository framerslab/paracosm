/**
 * Replay invocation hook for the Library tab.
 *
 * The dashboard cannot construct a WorldModel client-side because the
 * runtime layer imports `@framers/agentos`, which has server-only
 * dependencies (irc-framework, node:crypto, http, fs/promises) that
 * vite cannot bundle for the browser. So replay runs on the server
 * (POST /api/v1/runs/:runId/replay, see docs/HTTP_API.md) and this
 * hook is the dashboard-side dispatcher.
 *
 * @module paracosm/dashboard/library/hooks/useReplayRun
 */
import * as React from 'react';
import type { RunArtifact } from '../../../../../engine/schema/index.js';

export type ReplayResult =
  | { kind: 'idle' }
  | { kind: 'inflight' }
  | { kind: 'match' }
  | { kind: 'diverged'; divergence: string }
  | { kind: 'error'; error: string };

/**
 * `onCounted` is called once for each replay the server answered with a
 * match or a divergence: it counts those in the run's replay counters
 * before it answers. The call comes from the request itself, so it still
 * arrives when the panel that started the replay is gone by then (the
 * drawer was closed while the server replayed).
 */
export function useReplayRun(onCounted?: () => void): {
  result: ReplayResult;
  replay: (artifact: RunArtifact) => Promise<void>;
  reset: () => void;
} {
  const [result, setResult] = React.useState<ReplayResult>({ kind: 'idle' });
  // The newest callback, read when a request answers.
  const onCountedRef = React.useRef(onCounted);
  onCountedRef.current = onCounted;

  const replay = React.useCallback(async (artifact: RunArtifact) => {
    setResult({ kind: 'inflight' });
    try {
      const runId = artifact.metadata?.runId;
      if (!runId) {
        setResult({ kind: 'error', error: 'Artifact has no runId.' });
        return;
      }
      // The server re-executes the kernel against the stored artifact
      // and answers { matches, divergence }, which the result strip shows.
      const res = typeof fetch !== 'undefined'
        ? await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/replay`, { method: 'POST' })
        : null;
      if (!res) {
        setResult({ kind: 'error', error: 'fetch is not available in this environment.' });
        return;
      }
      if (res.status === 404) {
        setResult({ kind: 'error', error: 'The server has no stored run with this id, so there is nothing to replay.' });
        return;
      }
      if (res.status === 422) {
        // The run lacks what replay needs, a run saved before replay could
        // verify it among them (#235): the server's message says which.
        const body = await res.json().catch(() => ({})) as { message?: string };
        setResult({ kind: 'error', error: body.message || 'Replay cannot verify this run (HTTP 422).' });
        return;
      }
      if (!res.ok) {
        setResult({ kind: 'error', error: `Replay request failed (HTTP ${res.status}).` });
        return;
      }
      const body = await res.json() as { matches: boolean; divergence?: string };
      onCountedRef.current?.();
      if (body.matches) {
        setResult({ kind: 'match' });
      } else {
        setResult({ kind: 'diverged', divergence: body.divergence ?? 'unknown' });
      }
    } catch (err) {
      setResult({ kind: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const reset = React.useCallback(() => setResult({ kind: 'idle' }), []);

  return { result, replay, reset };
}
