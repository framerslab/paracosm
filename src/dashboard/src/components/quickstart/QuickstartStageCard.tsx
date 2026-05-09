/**
 * Single expandable stage card rendered by the Quickstart progress
 * panel. The card has three regions:
 *   1. Header: status marker + stage label + duration badge + chevron
 *   2. (Optional) summary row with active-actor turn counters for the
 *      running stage, so the card still shows useful state when its
 *      body is collapsed.
 *   3. Body: scrollable log list, type-color coded, mono timestamps.
 *
 * Auto-expands when the stage is active or done so the demo viewer
 * sees the activity stream without having to click. Pending stages
 * stay collapsed (no content yet anyway).
 *
 * @module paracosm/dashboard/quickstart/QuickstartStageCard
 */
import { useEffect, useRef, useState } from 'react';
import type { ActorProgress, Stage, StageStatus } from './QuickstartProgress';
import type { LogLine } from './QuickstartStageLog.helpers';
import styles from './QuickstartStageCard.module.scss';

export interface QuickstartStageCardProps {
  stageId: Stage;
  label: string;
  status: StageStatus;
  /** Already-built log lines for this stage. Empty array → "no events yet". */
  logLines: LogLine[];
  /** Pre-formatted duration badge (e.g. "12.3s"). Empty hides the chip. */
  duration: string;
  /** Per-actor progress, only set for the running stage. Renders the
   *  collapsed-summary row of "Mayor Elena Ward · TURN 4/6" chips. */
  actors?: ActorProgress[];
}

const ACTOR_STATUS_LABEL: Record<ActorProgress['status'], string> = {
  running: 'RUNNING',
  complete: 'COMPLETE',
  error: 'ERROR',
  aborted: 'ABORTED',
};

export function QuickstartStageCard({
  stageId,
  label,
  status,
  logLines,
  duration,
  actors,
}: QuickstartStageCardProps): JSX.Element {
  const [open, setOpen] = useState(status !== 'pending');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  // When the stage flips from pending to active, snap it open so the
  // log feed becomes visible. Once the user has interacted (closing it
  // manually or the hover handler below), we honor their choice.
  useEffect(() => {
    if (status === 'active' || status === 'done') setOpen((prev) => prev || true);
  }, [status]);

  // Keep the log scrolled to the bottom while the user hasn't manually
  // scrolled up — same pin-to-bottom pattern EventLogPanel uses. A 40px
  // tolerance avoids fighting the user when they're 1-2 rows from the
  // bottom.
  const handleScroll = (): void => {
    const el = bodyRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines.length]);

  const marker = status === 'done' ? '✓' : status === 'active' ? '●' : '○';
  const stateClass =
    status === 'done' ? styles.statusDone
      : status === 'active' ? styles.statusActive
        : styles.statusPending;

  const isRunningStage = stageId === 'running';
  const eventCount = logLines.length;

  return (
    <div className={`${styles.card} ${stateClass}`} data-stage={stageId} data-status={status}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        aria-controls={`stage-${stageId}-body`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.marker} aria-hidden="true">{marker}</span>
        <span className={styles.label}>{label}</span>
        {duration && <span className={styles.duration}>{duration}</span>}
        {eventCount > 0 && (
          <span className={styles.count} aria-label={`${eventCount} events`}>
            {eventCount}
          </span>
        )}
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true" />
      </button>

      {/* Per-actor collapsed summary. Only shown for the running stage,
          since that's the only one with multiple parallel sub-tracks
          worth chipping into the header. */}
      {isRunningStage && actors && actors.length > 0 && (
        <div className={styles.actorChips}>
          {actors.map((a) => (
            <span
              key={a.name}
              className={`${styles.actorChip} ${styles[`actor_${a.status}`]}`}
              title={`${a.name} · ${a.archetype}`}
            >
              <span className={styles.actorChipName}>{a.name}</span>
              <span className={styles.actorChipState}>
                {a.status === 'running'
                  ? `T${a.currentTurn}/${a.maxTurns}`
                  : ACTOR_STATUS_LABEL[a.status]}
              </span>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div
          id={`stage-${stageId}-body`}
          className={styles.body}
          ref={bodyRef}
          onScroll={handleScroll}
          role="log"
          aria-live={status === 'active' ? 'polite' : 'off'}
          aria-label={`${label} log`}
        >
          {logLines.length === 0 && (
            <div className={`${styles.line} ${styles.tonePending}`}>
              <span className={styles.lineTs}>—</span>
              <span className={styles.lineGlyph}>·</span>
              <span className={styles.lineBody}>
                {status === 'pending' ? 'Waiting for previous stage…' : 'No events yet.'}
              </span>
            </div>
          )}
          {logLines.map((line, i) => (
            <div
              key={i}
              className={`${styles.line} ${styles[`tone${capitalize(line.tone)}`]}`}
            >
              <span className={styles.lineTs}>{line.ts}</span>
              <span className={styles.lineGlyph}>{line.glyph}</span>
              {line.tag && <span className={styles.lineTag}>{line.tag}</span>}
              {line.actor && <span className={styles.lineActor}>{line.actor}</span>}
              <span className={styles.lineBody}>{line.body}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
