import { AiWritten, isAiWrittenPassage } from '../../shared/AiWritten';
import * as React from 'react';
import styles from './diff.module.scss';
import type { RunArtifact } from '../../../../../engine/schema/index.js';

export interface DecisionRationaleDiffProps {
  artifacts: RunArtifact[];
}

interface DecisionEntry {
  turn: number;
  decision: string;
  rationale: string;
  choiceAuthored: boolean;
  rationaleAuthored: boolean;
}

export function DecisionRationaleDiff({ artifacts }: DecisionRationaleDiffProps): JSX.Element {
  const refs = React.useRef<Array<HTMLDivElement | null>>([]);
  const onScroll = React.useCallback((idx: number) => (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    refs.current.forEach((el, i) => {
      if (i !== idx && el && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
    });
  }, []);
  const columns = artifacts.map(extractDecisions);
  if (columns.every((c) => c.length === 0)) {
    return (
      <section className={styles.diffSection} aria-label="Decision rationale comparison">
        <header className={styles.diffHead}>
          <h5 className={styles.diffTitle}>Decision rationale</h5>
        </header>
        <p className={styles.diffEmpty}>No decisions recorded (batch-point mode or no commander turns).</p>
      </section>
    );
  }
  const cssVars = { gridTemplateColumns: `repeat(${artifacts.length}, 1fr)` } as React.CSSProperties;
  return (
    <section className={styles.diffSection} aria-label="Decision rationale comparison">
      <header className={styles.diffHead}>
        <h5 className={styles.diffTitle}>Decision rationale</h5>
      </header>
      <div className={styles.rationaleGrid} style={cssVars}>
        {columns.map((entries, idx) => (
          <div
            key={idx}
            className={styles.rationaleColumn}
            ref={(el) => { refs.current[idx] = el; }}
            onScroll={onScroll(idx)}
          >
            {entries.length === 0 && <p className={styles.diffEmpty}>—</p>}
            {entries.map((e, i) => (
              <div key={i} className={styles.rationaleEntry}>
                <span className={styles.rationaleTurn}>Turn {e.turn}</span>
                <AiWritten as="p" className={styles.rationaleDecision} authored={e.choiceAuthored}>{e.decision}</AiWritten>
                <AiWritten as="p" className={styles.rationaleText} authored={Boolean(e.rationale) && e.rationaleAuthored}>{e.rationale}</AiWritten>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function extractDecisions(artifact: RunArtifact): DecisionEntry[] {
  const ds = artifact.decisions ?? [];
  // Schema: Decision has `time`, `choice`, `rationale`, `reasoning`.
  // We render `turn` (== time, rounded for display) + the choice text +
  // rationale (preferring rationale over reasoning when both present).
  return ds
    .map((d) => ({
      choiceAuthored: isAiWrittenPassage(d, 'choice', d.choice),
      rationaleAuthored: typeof d.rationale === 'string'
        ? isAiWrittenPassage(d, 'rationale', d.rationale)
        : isAiWrittenPassage(d, 'reasoning', d.reasoning),
      turn: typeof d.time === 'number' ? Math.round(d.time) : 0,
      decision: typeof d.choice === 'string' ? d.choice : '—',
      rationale: typeof d.rationale === 'string'
        ? d.rationale
        : typeof d.reasoning === 'string'
          ? d.reasoning
          : '',
    }))
    .sort((a, b) => a.turn - b.turn);
}
