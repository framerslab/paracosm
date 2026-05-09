import * as React from 'react';
import type { RunArtifact } from '../../../../../engine/schema/index.js';
import type { RunRecord } from '../../../../../server/services/run-record.js';

export type ArtifactStatus = 'ok' | 'not_found' | 'unavailable' | 'unreadable' | 'error' | null;

export interface RunArtifactResult {
  record: RunRecord | null;
  artifact: RunArtifact | null;
  loading: boolean;
  error: string | null;
  status: ArtifactStatus;
}

export function useRunArtifact(runId: string | null): RunArtifactResult {
  const [state, setState] = React.useState<RunArtifactResult>({
    record: null, artifact: null, loading: false, error: null, status: null,
  });

  React.useEffect(() => {
    if (!runId || typeof fetch === 'undefined') {
      setState({ record: null, artifact: null, loading: false, error: null, status: null });
      return;
    }
    const ctrl = new AbortController();
    setState(s => ({ ...s, loading: true, error: null }));
    fetch(`/api/v1/runs/${encodeURIComponent(runId)}`, { signal: ctrl.signal })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          setState({ record: body.record, artifact: body.artifact, loading: false, error: null, status: 'ok' });
        } else if (r.status === 404) {
          setState({ record: null, artifact: null, loading: false, error: 'Run not found', status: 'not_found' });
        } else if (r.status === 410) {
          setState({
            record: body.record ?? null,
            artifact: null,
            loading: false,
            error: body.message ?? 'Artifact unavailable',
            status: body.error === 'artifact_unavailable' ? 'unavailable' : 'unreadable',
          });
        } else {
          setState({ record: null, artifact: null, loading: false, error: `HTTP ${r.status}`, status: 'error' });
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setState({ record: null, artifact: null, loading: false, error: err.message, status: 'error' });
        }
      });
    return () => ctrl.abort();
  }, [runId]);

  return state;
}
