/**
 * One row inside `MultiActorTurnGrid`. Shows a header strip with the
 * turn number + each actor's event title for that turn, followed by a
 * row of N cells (one per actor) holding their event cards.
 *
 * The 2-actor `TurnRow` pairs this with diff-classification badging
 * (`computeTurnDiff`); for N>=3 the diff classification stops being
 * meaningful, so this component just renders the header without it.
 *
 * @module paracosm/dashboard/sim/MultiActorTurnRow
 */
import * as React from 'react';
import type { CSSProperties } from 'react';
import { EventCard } from './EventCard.js';
import { getActorColorVar } from '../../hooks/useGameState.js';
import type { ProcessedEvent } from '../../hooks/useGameState.js';
import styles from './MultiActorTurnRow.module.scss';

void React;

/** Same set as `TurnRow`. Pending events get summarised into a
 *  "Working…" placeholder rather than rendered as cards. */
const PENDING_TYPES = new Set(['turn_start', 'specialist_start', 'decision_pending']);

function summarizePending(events: ProcessedEvent[]): string {
  const depts = new Set<string>();
  let waitingDecision = false;
  for (const e of events) {
    if (e.type === 'specialist_start') {
      const dept = (e.data as { department?: string })?.department;
      if (typeof dept === 'string' && dept.length > 0) depts.add(dept);
    } else if (e.type === 'decision_pending') {
      waitingDecision = true;
    }
  }
  const parts: string[] = [];
  if (depts.size > 0) parts.push(`${[...depts].join(', ')} analyzing`);
  if (waitingDecision) parts.push('awaiting decision');
  return parts.length > 0 ? parts.join(' · ') + '…' : 'Working on this turn…';
}

/** Pull the user-facing event title from a turn's event list. Mirrors
 *  the logic in `turn-diff.ts` so the per-actor titles in this row's
 *  header match what the 2-actor TurnRow shows. */
function titleFor(events: ProcessedEvent[]): string {
  for (const e of events) {
    if (e.type === 'event' || e.type === 'turn_done') {
      const title = (e.data as { title?: string })?.title;
      if (typeof title === 'string' && title.length > 0) return title;
    }
  }
  return '';
}

interface MultiActorTurnRowProps {
  turn: number;
  actorIds: string[];
  /** Per-actor event list for THIS turn. Index matches `actorIds`. */
  eventsByActor: ProcessedEvent[][];
  /** True once the run reached a terminal state (complete OR aborted).
   *  Empty cells should stop spinning at this point because no further
   *  events are coming for this turn from any actor. */
  runTerminal?: boolean;
  /** True specifically for the aborted variant of terminal. Drives the
   *  "this actor did not reach turn N before the run was interrupted"
   *  copy versus the cleaner "no event recorded" copy for natural
   *  completion. */
  runAborted?: boolean;
}

export function MultiActorTurnRow({ turn, actorIds, eventsByActor, runTerminal, runAborted }: MultiActorTurnRowProps) {
  // Determine if EVERY actor with events has the same title for this
  // turn. When yes, render a single shared title; when no, render a
  // per-actor strip below the turn label.
  const titles = eventsByActor.map(titleFor);
  const nonEmptyTitles = titles.filter((t) => t.length > 0);
  const allSame =
    nonEmptyTitles.length > 0 && nonEmptyTitles.every((t) => t === nonEmptyTitles[0]);
  const sharedTitle = allSame ? nonEmptyTitles[0] : '';

  return (
    <section
      id={`turn-row-${turn}`}
      className={styles.row}
      aria-labelledby={`turn-row-${turn}-h`}
    >
      <h3 id={`turn-row-${turn}-h`} className={styles.header}>
        <span className={styles.headerTurn}>T{turn}</span>
        {sharedTitle ? (
          <span className={styles.headerTitle}>{sharedTitle}</span>
        ) : (
          <span className={styles.headerTitleSplit}>
            {titles.map((title, idx) => (
              <span
                key={actorIds[idx]}
                className={styles.headerTitlePerActor}
                style={{ ['--cell-color' as string]: getActorColorVar(idx) } as CSSProperties}
              >
                {title || '—'}
              </span>
            ))}
          </span>
        )}
      </h3>

      <div className={styles.cells}>
        {actorIds.map((id, idx) => {
          const cellEvents = eventsByActor[idx] ?? [];
          const renderable = cellEvents.filter((e) => !PENDING_TYPES.has(e.type));
          const allPending = cellEvents.length > 0 && renderable.length === 0;
          // For N actors there's no diff classification (that's pair-
          // only), so an empty cell is always treated as "catching up"
          // because parallel runs drift turn-to-turn — the other
          // actor(s) reached this turn first while this one is still
          // mid-LLM-call. The 2-actor TurnRow has both branches
          // because it can distinguish "one-sided" from "neither side
          // started", which only matters when comparing two columns.
          return (
            <div
              key={id}
              className={styles.cell}
              style={{ ['--cell-color' as string]: getActorColorVar(idx) } as CSSProperties}
              aria-label={`Events for actor ${idx + 1} on turn ${turn}`}
            >
              <span className={styles.cellBand} aria-hidden="true" />
              {cellEvents.length === 0 ? (
                runTerminal ? (
                  // Run is over (clean finish OR aborted). The spinner
                  // copy implies "still working" — wrong here. Show the
                  // terminal-state copy instead so the user can read the
                  // empty cell as "this actor never reached turn N"
                  // rather than "the dashboard is hung".
                  <div
                    className={styles.cellEmpty}
                    title={runAborted
                      ? 'Run was interrupted before this actor reached this turn.'
                      : 'No event recorded for this actor on this turn.'}
                  >
                    {runAborted
                      ? `Stopped before T${turn}`
                      : `No event for T${turn}`}
                  </div>
                ) : (
                  <div className={styles.cellPending} aria-live="polite" title="Parallel runs can drift turn-to-turn — events arrive whenever this actor's LLM calls finish.">
                    <span className={`spinner ${styles.cellPendingSpinner}`} aria-hidden="true" />
                    Catching up to turn {turn}…
                  </div>
                )
              ) : allPending ? (
                runTerminal ? (
                  <div
                    className={styles.cellEmpty}
                    title={runAborted
                      ? 'Run was interrupted while this turn was still processing.'
                      : 'No outcome recorded for this actor on this turn.'}
                  >
                    {runAborted
                      ? `Stopped during T${turn}`
                      : `T${turn} ended without an outcome`}
                  </div>
                ) : (
                  <div className={styles.cellPending} aria-live="polite">
                    <span className={`spinner ${styles.cellPendingSpinner}`} />
                    {summarizePending(cellEvents)}
                  </div>
                )
              ) : (
                renderable.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    actorIndex={(idx % 2) as 0 | 1}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
