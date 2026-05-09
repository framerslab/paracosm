import * as React from 'react';
import styles from './RunTable.module.scss';
import type { RunRecord } from '../../../../server/services/run-record.js';

export interface RunTableProps {
  runs: RunRecord[];
  onOpen: (runId: string) => void;
  onReplay: (runId: string) => void;
}

export function RunTable(props: RunTableProps): JSX.Element {
  const { runs, onOpen, onReplay } = props;
  return (
    <div className={styles.wrapper} role="region" aria-label="Runs table" tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Mode</th>
            <th>Leader</th>
            <th>Cost</th>
            <th>Time</th>
            <th>Started</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr
              key={r.runId}
              onClick={() => onOpen(r.runId)}
              tabIndex={0}
              data-run-card
              data-run-id={r.runId}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(r.runId);
                }
              }}
            >
              <td data-label="Scenario">{r.scenarioId}</td>
              <td data-label="Mode">
                <span data-mode={r.mode ?? 'unknown'} className={styles.modeCell}>{r.mode ?? '-'}</span>
              </td>
              <td data-label="Leader">{r.actorName ?? '-'}</td>
              <td data-label="Cost">{r.costUSD != null ? `$${r.costUSD.toFixed(2)}` : '-'}</td>
              <td data-label="Time">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(0)}s` : '-'}</td>
              <td data-label="Started">{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
              <td data-label="Actions" className={styles.actionsCell}>
                <button onClick={(e) => { e.stopPropagation(); onOpen(r.runId); }}>Open</button>
                <button onClick={(e) => { e.stopPropagation(); onReplay(r.runId); }} aria-label="Replay">Replay</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
