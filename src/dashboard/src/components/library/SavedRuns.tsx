import * as React from 'react';
import { useId } from 'react';
import { useSessions, type StoredSessionMeta } from '../../hooks/useSessions';
import type { LocalHistoryEntry } from '../../hooks/useLocalHistory.helpers';
import { buildReplayHref } from '../layout/LoadMenu.helpers';
import { formatRoster } from '../layout/ReplayBanner';
import { CLEAR_LIST, LOCAL_RUNS, NO_SAVED_RUNS, CLEAR_LIST_QUESTION, REPLACE_RUN, RESTORE_RUN, RESTORE_WAITS, SAVED_RUNS } from '../layout/frameWords';
import { SAVED_RUNS_NOT_LOADED, TRY_AGAIN, trying } from '../quickstart/first-screen/words';
import styles from './SavedRuns.module.scss';
void React;

/** The browser's history and the actions that use it. */
export interface SavedRunsProps {
  history: LocalHistoryEntry[];
  onRestore: (entry: LocalHistoryEntry) => void;
  onClear: () => void;
  runOpen: boolean;
  /**
   * A run is starting or running: its live events would join a restored
   * run's, so Restore waits until it ends.
   */
  runLive?: boolean;
}

function turnsLabel(turns?: number) {
  return turns == null ? '' : `${turns} turn${turns === 1 ? '' : 's'}`;
}

function sessionDetails(session: StoredSessionMeta) {
  const seconds = Math.round((session.durationMs ?? 0) / 1000);
  const duration = seconds > 0 ? (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`) : '';
  const usd = session.totalCostUSD;
  const cost = usd == null ? '' : usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`;
  return [new Date(session.createdAt).toLocaleString(), duration, cost].filter(Boolean).join(' · ');
}

/** Offers links to server replays and restores runs kept in this browser. */
export function SavedRuns({ history, onRestore, onClear, runOpen, runLive = false }: SavedRunsProps) {
  const { sessions, status, refresh } = useSessions();
  const waitsId = useId();
  return (
    <>
      <section className={styles.section} aria-label={SAVED_RUNS}>
        <h3>{SAVED_RUNS}</h3>
        {status === 'loading' && <p role="status">{trying}</p>}
        {status === 'ready' && !sessions.length && <p>{NO_SAVED_RUNS}</p>}
        {(status === 'error' || status === 'unavailable') && (
          <div className={styles.row}>
            <p role="status">{SAVED_RUNS_NOT_LOADED}</p>
            <button type="button" onClick={refresh}>{TRY_AGAIN}</button>
          </div>
        )}
        {sessions.length > 0 && <ul className={styles.list}>
          {sessions.map(session => (
            <li key={session.id}>
              <a className={styles.savedRun} href={buildReplayHref(window.location.href, session.id)}>
                <strong>{session.title || formatRoster(session) || session.scenarioName || SAVED_RUNS}</strong>
                <span>{[
                  session.title ? formatRoster(session) : '',
                  session.scenarioName,
                  turnsLabel(session.turnCount),
                ].filter(Boolean).join(' · ')}</span>
                <span>{sessionDetails(session)}</span>
              </a>
            </li>
          ))}
        </ul>}
      </section>
      {history.length > 0 && (
        <section className={styles.section} aria-label={LOCAL_RUNS}>
          <h3>{LOCAL_RUNS}</h3>
          {runLive && <p id={waitsId}>{RESTORE_WAITS}</p>}
          <ul className={styles.list}>
            {history.map(entry => (
              <li key={entry.id} className={styles.row}>
                <div>
                  <strong>{(entry.summary.actorNames ?? []).join(' vs ') || entry.scenarioShortName}</strong>
                  <p>{[turnsLabel(entry.summary.turnCount), new Date(entry.createdAt).toLocaleString()].filter(Boolean).join(' · ')}</p>
                </div>
                <button type="button" disabled={runLive} aria-describedby={runLive ? waitsId : undefined} onClick={() => {
                  if (!runOpen || window.confirm(REPLACE_RUN)) onRestore(entry);
                }}>{RESTORE_RUN}</button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => { if (window.confirm(CLEAR_LIST_QUESTION)) onClear(); }}>{CLEAR_LIST}</button>
        </section>
      )}
    </>
  );
}
