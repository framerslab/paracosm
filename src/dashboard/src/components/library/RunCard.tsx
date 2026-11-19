import * as React from 'react';
import styles from './RunCard.module.scss';
import type { RunRecord } from '../../../../server/services/run-record.js';
import { buildReplayShareUrl } from '../../hooks/shareUrl.helpers';
import { useShareLink } from '../../hooks/useShareLink';
import { ShareLinkNote } from '../shared/ShareLinkNote';

export interface RunCardProps {
  record: RunRecord;
  onOpen: () => void;
  onReplay: () => void;
  variant?: 'gallery' | 'compact';
}

export function RunCard(props: RunCardProps): JSX.Element {
  const { record, onOpen, onReplay, variant = 'gallery' } = props;
  // Share button is enabled only when the server's autoSaveOnComplete
  // pass populated session_id via linkSessionId. Legacy rows + runs
  // whose broadcast save failed render with the button hidden (no UI
  // affordance suggesting a feature that wouldn't actually work).
  // The press shows the share note the run drawer and the run actions menu
  // show: the link, what became of the copy, and who can open the link.
  const shareLink = useShareLink();
  const canShare = !!record.sessionId;
  const handleShare = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!record.sessionId) return;
    shareLink.share(buildReplayShareUrl(window.location.origin, record.sessionId, 'viz'));
  };

  return (
    <article
      className={[styles.card, variant === 'compact' ? styles.compact : ''].filter(Boolean).join(' ')}
      // Pointer ergonomics: clicking anywhere on the card opens the
      // run. Keyboard / screen-reader users land on the inner Open
      // and Replay buttons (see below) which are the explicit
      // affordances. The previous setup gave the article a tabIndex
      // and key handler too, which axe flagged as nested-interactive.
      aria-label={`Run ${record.scenarioId} by ${record.actorName ?? 'unknown leader'}`}
      data-run-card
      data-run-id={record.runId}
      onClick={onOpen}
    >
      <header className={styles.head}>
        <span className={styles.modeBadge} data-mode={record.mode ?? 'unknown'}>{record.mode ?? 'unknown'}</span>
        <span className={styles.cost}>{record.costUSD != null ? `$${record.costUSD.toFixed(2)}` : '-'}</span>
        <span className={styles.time}>{relativeTime(record.createdAt)}</span>
      </header>
      <h3 className={styles.scenario}>{record.scenarioId}</h3>
      <p className={styles.leader}>
        {record.actorName ?? 'Unknown'}
        {record.actorArchetype ? ` · ${record.actorArchetype}` : ''}
      </p>
      <div className={styles.actions}>
        <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className={styles.actionBtn}>Open</button>
        <button onClick={(e) => { e.stopPropagation(); onReplay(); }} className={styles.actionBtn} aria-label="Replay">Replay</button>
        {canShare && (
          <button
            onClick={handleShare}
            className={styles.actionBtn}
            aria-label="Copy a deep link that opens this run on the visualization tab"
            title="Copy viz share link"
          >
            Share
          </button>
        )}
        {/* Compare lives at the bundle level (BundleCard). Solo runs only get Open + Replay (+ Share when sessionId is set). */}
      </div>
      {shareLink.shared && (
        // A press inside the note (its field, its Close key) stays in the
        // note and does not open the run.
        <div onClick={(e) => e.stopPropagation()}>
          <ShareLinkNote shared={shareLink.shared} onClose={shareLink.clear} />
        </div>
      )}
    </article>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '-';
  const s = ms / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return iso.slice(0, 10);
}
