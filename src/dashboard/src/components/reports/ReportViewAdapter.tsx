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
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface ReportViewAdapterProps {
  artifact: RunArtifact;
}

export function ReportViewAdapter({ artifact }: ReportViewAdapterProps): JSX.Element {
  const turns = artifact.trajectory?.timepoints ?? [];
  const decisions = artifact.decisions ?? [];

  if (turns.length === 0) {
    return <div className={styles.empty}>No turns recorded for this run.</div>;
  }

  return (
    <div className={styles.list}>
      {turns.map((tp, i) => {
        const metrics = (tp as { worldSnapshot?: { metrics?: Record<string, number> } }).worldSnapshot?.metrics ?? {};
        const decision = decisions[i] as { label?: string } | undefined;
        const turnIdx = (tp as { t?: number; time?: number }).t ?? (tp as { time?: number }).time ?? i + 1;
        return (
          <article key={i} className={styles.turn}>
            <header className={styles.turnHead}>Turn {turnIdx}</header>
            {Object.keys(metrics).length > 0 && (
              <pre className={styles.metrics}>{JSON.stringify(metrics, null, 2)}</pre>
            )}
            {decision?.label && (
              <p className={styles.decision}><strong>Decision:</strong> {decision.label}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
