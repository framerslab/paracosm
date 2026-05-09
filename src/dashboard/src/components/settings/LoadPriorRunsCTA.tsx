import { useMemo, useRef } from 'react';
import { useSessions } from '../../hooks/useSessions';
import styles from './LoadPriorRunsCTA.module.scss';

interface LoadPriorRunsCTAProps {
  /** Hide entirely when the session store is unavailable (server flag
   *  off, 503). Default true — caller can set false to keep showing the
   *  explanatory empty state even then. */
  hideWhenUnavailable?: boolean;
}

/**
 * Prominent call-to-action at the top of the Settings (setup) page and
 * the SIM empty state that surfaces prior saved runs. Users can watch
 * any completed run back turn-by-turn without spending API credits.
 */
export function LoadPriorRunsCTA({ hideWhenUnavailable = true }: LoadPriorRunsCTAProps = {}) {
  const { sessions, status, refresh } = useSessions();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const recent = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, 3),
    [sessions],
  );

  if (status === 'loading') return null;
  if (status === 'unavailable' && hideWhenUnavailable) return null;

  const handleOpen = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('replay', id);
    url.searchParams.set('tab', 'sim');
    url.hash = '';
    window.location.assign(url.toString());
  };

  const formatCreatedAt = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const isEmpty = sessions.length === 0;
  const cardCls = [styles.card, isEmpty ? styles.empty : ''].filter(Boolean).join(' ');
  const kickerCls = [styles.kicker, isEmpty ? styles.empty : ''].filter(Boolean).join(' ');
  const leadCls = [styles.lead, isEmpty ? styles.empty : ''].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={cardCls}>
      <div className={styles.headerRow}>
        <div>
          <div className={kickerCls}>
            ▶ {isEmpty ? 'Replay from cache' : 'Watch a prior run'}
          </div>
          {isEmpty ? (
            <div className={leadCls}>
              No saved runs yet.{' '}
              <span className={styles.leadMuted}>
                Once any simulation completes it{"'"}s auto-cached here, so you can replay the
                full turn-by-turn playback — every decision, tool forge, and divergence —
                without re-spending credits.
              </span>
            </div>
          ) : (
            <div className={leadCls}>
              Don{"'"}t want to spend credits?{' '}
              <span className={styles.leadMuted}>
                Replay any of <strong className={styles.leadCount}>{sessions.length}</strong>{' '}
                cached simulation{sessions.length === 1 ? '' : 's'} turn-by-turn, complete with
                every decision, tool forge, and divergence.
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh prior runs list"
          title="Refresh list"
          className={styles.refreshBtn}
        >
          ↻ Refresh
        </button>
      </div>
      {!isEmpty && (
        <div className={styles.grid}>
          {recent.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleOpen(s.id)}
              aria-label={`Replay ${s.title || s.scenarioName || s.scenarioId || s.id}`}
              className={styles.tile}
            >
              <span className={styles.tileTitle}>
                {s.title || s.scenarioName || s.scenarioId || 'Simulation'}
              </span>
              <span className={styles.tileMeta}>
                {s.title && s.scenarioName ? `${s.scenarioName} · ` : ''}
                {typeof s.turnCount === 'number' ? `${s.turnCount} turns · ` : ''}
                {s.leaderA && s.leaderB ? `${s.leaderA} vs ${s.leaderB} · ` : ''}
                {formatCreatedAt(s.createdAt)}
              </span>
              {typeof s.totalCostUSD === 'number' && s.totalCostUSD > 0 && (
                <span className={styles.tileCost}>${s.totalCostUSD.toFixed(2)}</span>
              )}
              <span className={styles.tileCta}>Replay →</span>
            </button>
          ))}
        </div>
      )}
      {!isEmpty && sessions.length > 3 && (
        <div className={styles.moreNote}>
          + {sessions.length - 3} more — use the <strong>LOAD</strong> button in the top bar to
          browse the full list.
        </div>
      )}
    </div>
  );
}
