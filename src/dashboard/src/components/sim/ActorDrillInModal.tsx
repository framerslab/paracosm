/**
 * Modal popup for a single actor when the user clicks a node in the
 * Constellation view. Composes <ActorBar> (header chip + HEXACO bars
 * + spark histories) with a vertical timeline of that actor's events
 * grouped by turn, plus a Decisions section derived from
 * `type === 'decision_made'` events.
 *
 * Doesn't reuse <ReportView> because that component is hard-coded to
 * actorIds[0]/actorIds[1] slot rendering — passing it a single-actor
 * filtered state would render an empty B-column.
 *
 * @module paracosm/dashboard/sim/ActorDrillInModal
 */
import * as React from 'react';
import { ActorBar } from '../layout/ActorBar.js';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import type { GameState, ProcessedEvent } from '../../hooks/useGameState.js';
import styles from './ActorDrillInModal.module.scss';

export interface ActorDrillInModalProps {
  actorName: string | null;
  actorIndex: number;
  state: GameState;
  onClose: () => void;
  /**
   * Render mode. `'modal'` (default) is the overlay-style dialog
   * with focus trap and click-outside-to-close — the right shape
   * for pair runs where the user expects a temporary lightbox.
   * `'dock'` is a fixed right-side panel that stays open while the
   * user clicks around the SIM tab — the right shape for 5+ actor
   * runs where the user wants to compare drill-ins quickly without
   * a remount each time. SimView picks based on actor count.
   */
  mode?: 'modal' | 'dock';
}

function eventTitle(e: ProcessedEvent): string {
  const data = e.data ?? {};
  const title = (data.title ?? data.choice ?? data.summary) as string | undefined;
  return title ?? e.type;
}

export function ActorDrillInModal({ actorName, actorIndex, state, onClose, mode = 'modal' }: ActorDrillInModalProps): JSX.Element | null {
  // Focus trap only applies in modal mode. The dock is part of the
  // page flow conceptually — users still need to click around the
  // SIM tab while the dock is open, so trapping Tab inside it would
  // break expected scroll/click behavior.
  const dialogRef = useFocusTrap<HTMLDivElement>(mode === 'modal' && actorName !== null);

  React.useEffect(() => {
    if (actorName === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actorName, onClose]);

  if (actorName === null) return null;
  const side = state.actors[actorName];
  if (!side) return null;

  const events = side.events ?? [];
  const decisions = events.filter((e) => e.type === 'decision_made');
  const grouped = new Map<number, ProcessedEvent[]>();
  for (const e of events) {
    const turn = e.turn ?? 0;
    const list = grouped.get(turn) ?? [];
    list.push(e);
    grouped.set(turn, list);
  }
  const turnNumbers = [...grouped.keys()].sort((a, b) => a - b);

  // Modal: overlay+click-outside-to-close. Dock: fixed right rail
  // that stays open while the user clicks around the SIM tab. Both
  // share the same dialog body — only the wrapper changes.
  const isDock = mode === 'dock';
  const wrapperClass = isDock ? styles.dockOverlay : styles.overlay;
  const innerClass = isDock ? styles.dock : styles.modal;
  const wrapperOnClick = isDock ? undefined : onClose;
  const innerOnClick = isDock ? undefined : (e: React.MouseEvent) => e.stopPropagation();
  const ariaModal = isDock ? undefined : true;

  return (
    <div className={wrapperClass} role="presentation" onClick={wrapperOnClick}>
      <div
        ref={dialogRef}
        className={innerClass}
        role="dialog"
        aria-modal={ariaModal}
        aria-label={`Report for ${actorName}`}
        tabIndex={-1}
        onClick={innerOnClick}
      >
        <header className={styles.head}>
          <div className={styles.actorName}>{actorName}</div>
          <button type="button" aria-label="Close drill-in" className={styles.closeBtn} onClick={onClose}>×</button>
        </header>
        <div className={styles.body}>
          <ActorBar
            actorIndex={actorIndex}
            leader={side.leader}
            popHistory={side.popHistory}
            moraleHistory={side.moraleHistory}
          />

          {decisions.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Decisions ({decisions.length})</h3>
              <ul className={styles.list}>
                {decisions.map((d) => {
                  const choice = (d.data?.choice ?? d.data?.title ?? '<choice>') as string;
                  const rationale = (d.data?.rationale ?? '') as string;
                  return (
                    <li key={d.id} className={styles.decisionItem}>
                      <div className={styles.decisionTitle}>T{d.turn ?? '?'}: {choice}</div>
                      {rationale && <div className={styles.decisionRationale}>{rationale}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Timeline ({events.length} events)</h3>
            {turnNumbers.length === 0 && (
              <p className={styles.empty}>No events captured yet.</p>
            )}
            {turnNumbers.map((turn) => (
              <article key={turn} className={styles.turnArticle}>
                <header className={styles.turnHeader}>Turn {turn}</header>
                <ul className={styles.turnList}>
                  {(grouped.get(turn) ?? []).map((e) => (
                    <li key={e.id} className={styles.turnEvent}>
                      <span className={styles.turnEventType}>{e.type}</span>
                      {' '}
                      {eventTitle(e)}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
