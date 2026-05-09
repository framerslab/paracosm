import * as React from 'react';
import styles from './ReplayPanel.module.scss';
import { useReplayRun, type ReplayResult } from './hooks/useReplayRun.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface ReplayPanelProps {
  artifact: RunArtifact | null;
}

export function ReplayPanel(props: ReplayPanelProps): JSX.Element {
  const { artifact } = props;
  const { result, replay } = useReplayRun();

  return (
    <div className={styles.panel}>
      <button
        onClick={() => artifact && void replay(artifact)}
        disabled={!artifact || result.kind === 'inflight'}
        className={styles.replayBtn}
      >
        {result.kind === 'inflight' ? 'Replaying…' : 'Replay'}
      </button>
      <ResultStrip result={result} />
    </div>
  );
}

function ResultStrip({ result }: { result: ReplayResult }): JSX.Element | null {
  switch (result.kind) {
    case 'idle':
    case 'inflight':
      return null;
    case 'match':
      return <span className={[styles.result, styles.match].join(' ')}>✓ Kernel deterministic</span>;
    case 'diverged':
      return <span className={[styles.result, styles.diverged].join(' ')} title={result.divergence}>⚠ Diverged at {result.divergence.length > 60 ? result.divergence.slice(0, 60) + '…' : result.divergence}</span>;
    case 'error':
      return <span className={[styles.result, styles.errResult].join(' ')} title={result.error}>⚠ {result.error.length > 80 ? result.error.slice(0, 80) + '…' : result.error}</span>;
  }
}
