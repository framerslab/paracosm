import * as React from 'react';
import styles from './ReplayPanel.module.scss';
import { useReplayRun, type ReplayResult } from './hooks/useReplayRun.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface ReplayPanelProps {
  artifact: RunArtifact | null;
  /**
   * Called once a replay the server answered with a match or a divergence
   * has been counted in the run's replay counters, so a page that shows
   * them can read them again. It is called when the server answers, also
   * when this panel is gone by then.
   */
  onReplayed?: () => void;
}

export function ReplayPanel(props: ReplayPanelProps): JSX.Element {
  const { artifact, onReplayed } = props;
  const { result, replay } = useReplayRun(onReplayed);

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

/**
 * What the replay came to, in full: the divergence names the step, the
 * field and both values, and a cannot-verify reason says what the run
 * lacks and what to do, so neither is cut.
 */
function ResultStrip({ result }: { result: ReplayResult }): JSX.Element | null {
  switch (result.kind) {
    case 'idle':
    case 'inflight':
      return null;
    case 'match':
      return <p role="status" className={[styles.result, styles.match].join(' ')}>✓ Kernel deterministic</p>;
    case 'diverged':
      return <p role="status" className={[styles.result, styles.diverged].join(' ')}>⚠ Diverged at {result.divergence}</p>;
    case 'error':
      return <p role="status" className={[styles.result, styles.errResult].join(' ')}>⚠ {result.error}</p>;
  }
}
