/**
 * Static viewer for a stored turn-loop RunArtifact.
 *
 * The existing <ReportView> component is shaped around the live-streaming
 * GameState (936 lines, side-by-side leader-A-vs-leader-B). For the
 * Library tab we render a compact alternative directly from the
 * artifact's per-turn data. Visual parity with the live ReportView is
 * a v2 goal; v1 is a minimal turn-by-turn list.
 *
 * @module paracosm/dashboard/reports/ReportViewAdapter
 */
import * as React from 'react';
import styles from './ReportViewAdapter.module.scss';
import type { Decision, RunArtifact } from '../../../../engine/schema/index.js';

export interface ReportViewAdapterProps {
  artifact: RunArtifact;
}

type StoredDecision = Omit<Decision, 'choice' | 'time'> & {
  choice?: string;
  label?: string;
  time?: number;
};

function DecisionText({ decision }: { decision: StoredDecision }): JSX.Element | null {
  const choice = decision.choice ?? decision.label;
  if (!choice && !decision.rationale) return null;
  return (
    <>
      {choice && <p className={styles.decision}><strong>Decision:</strong> {choice}</p>}
      {decision.rationale && <p className={styles.decision}><strong>Rationale:</strong> {decision.rationale}</p>}
    </>
  );
}

export function ReportViewAdapter({ artifact }: ReportViewAdapterProps): JSX.Element {
  const turns = artifact.trajectory?.timepoints ?? [];
  const decisions: StoredDecision[] = artifact.decisions ?? [];
  const byTime = new Map<number, StoredDecision[]>();
  const unmatched: StoredDecision[] = [];
  const times = new Set(turns.map(turn => turn.time));
  decisions.forEach((decision, index) => {
    const time = decision.time ?? turns[index]?.time;
    if (time === undefined || !times.has(time)) {
      unmatched.push(decision);
      return;
    }
    const group = byTime.get(time) ?? [];
    group.push(decision);
    byTime.set(time, group);
  });

  if (turns.length === 0 && decisions.length === 0) {
    return <div className={styles.empty}>No turns recorded for this run.</div>;
  }

  return (
    <div className={styles.list}>
      {turns.map((tp, i) => {
        const metrics = tp.worldSnapshot?.metrics ?? {};
        const turn = (tp as { t?: number }).t ?? tp.time ?? i + 1;
        return (
          <article key={i} className={styles.turn}>
            <header className={styles.turnHead}>Turn {turn}</header>
            {Object.keys(metrics).length > 0 && (
              <pre className={styles.metrics}>{JSON.stringify(metrics, null, 2)}</pre>
            )}
            {byTime.get(tp.time)?.map((decision, index) => <DecisionText key={index} decision={decision} />)}
          </article>
        );
      })}
      {unmatched.map((decision, index) => (
        <article key={index} className={styles.turn}>
          <header className={styles.turnHead}>Turn {decision.time ?? index + 1}</header>
          <DecisionText decision={decision} />
        </article>
      ))}
    </div>
  );
}
