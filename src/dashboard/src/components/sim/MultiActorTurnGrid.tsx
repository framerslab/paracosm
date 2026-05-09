/**
 * Side-by-side TurnGrid generalised to N actors. Mirrors `TurnGrid`
 * (the pair-mode grid) but skips the pairwise diff classification —
 * which only makes sense for two columns — and renders the per-turn
 * rows in a horizontally scrolling track when more than 4 actors are
 * present. The user-facing intent is full feature parity with the
 * 2-actor view: every actor still gets a sticky compact ActorBar, and
 * every turn still gets one cell per actor with that actor's events.
 *
 * Sticky vertical pin on the scroll container keeps the latest events
 * visible during a live run; the user can scroll up to inspect earlier
 * turns and the pin disengages until they scroll back to the bottom.
 *
 * @module paracosm/dashboard/sim/MultiActorTurnGrid
 */
import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { ActorBar } from '../layout/ActorBar.js';
import { MultiActorTurnRow } from './MultiActorTurnRow.js';
import type { GameState, ProcessedEvent } from '../../hooks/useGameState.js';
import styles from './MultiActorTurnGrid.module.scss';

void React;

interface MultiActorTurnGridProps {
  state: GameState;
}

/** Width per actor cell in the horizontally-scrolling track. Picked
 *  to match the 2-actor TurnGrid feel (each cell is roughly half the
 *  viewport at 1280px) while keeping enough breathing room for event
 *  cards. Adjust here if EventCard width changes. */
const CELL_MIN_WIDTH_PX = 360;

export function MultiActorTurnGrid({ state }: MultiActorTurnGridProps) {
  const actorIds = state.actorIds;

  // Build a per-actor turn-grouped event map so each row pulls its
  // cells in O(1) instead of re-filtering on every render. The outer
  // array index matches `actorIds[i]`.
  const perActorTurnEvents = useMemo(() => {
    return actorIds.map((id) => groupByTurn(state.actors[id]?.events ?? []));
  }, [actorIds, state.actors]);

  // Union of all turn numbers across actors so a row appears even if
  // only one actor has reached that turn. Sorted ascending.
  const turns = useMemo(() => {
    const seen = new Set<number>();
    for (const m of perActorTurnEvents) {
      for (const k of m.keys()) seen.add(k);
    }
    return [...seen].sort((a, b) => a - b);
  }, [perActorTurnEvents]);

  // Vertical scroll pin for live runs (matches TurnGrid's behaviour).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  // Pin when any actor's event count grows. Stringify so the deps
  // array sees a stable primitive (React shallow-compares array refs;
  // a fresh `actorIds.map(...)` would re-fire every render).
  const eventCountFingerprint = useMemo(
    () => actorIds.map((id) => state.actors[id]?.events.length ?? 0).join(','),
    [actorIds, state.actors],
  );
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [eventCountFingerprint]);

  // Horizontal track width: enough to fit every cell at min-width.
  // CSS handles the actual scroll; this just sets the inline-grid
  // template so columns line up across the sticky header and the
  // per-turn rows.
  const trackStyle = {
    ['--cell-min-width' as string]: `${CELL_MIN_WIDTH_PX}px`,
    ['--cell-count' as string]: String(actorIds.length),
  } as React.CSSProperties;

  return (
    <div className={styles.grid} style={trackStyle}>
      <div className={styles.scrollX}>
        <header className={styles.stickyHeader}>
          {actorIds.map((id, idx) => {
            const actor = state.actors[id];
            return (
              <div key={id} className={styles.headerCell}>
                <ActorBar
                  compact
                  actorIndex={idx}
                  leader={actor?.leader ?? null}
                  // Fall back to the actor id (the orchestrator-side
                  // actor name) so the header renders the real name
                  // even if the `status: parallel` payload hasn't yet
                  // arrived. Without this the bar showed generic
                  // "Leader A/B/C" until the status event landed.
                  nameFallback={id}
                  popHistory={actor?.popHistory ?? []}
                  moraleHistory={actor?.moraleHistory ?? []}
                  event={actor?.event}
                  pendingDecision={actor?.pendingDecision}
                />
              </div>
            );
          })}
        </header>

        <div ref={scrollRef} onScroll={onScroll} className={styles.scrollY}>
          {turns.length === 0 ? (
            <div className={styles.empty}>No turns yet — events will appear as the run progresses.</div>
          ) : (
            turns.map((t) => (
              <MultiActorTurnRow
                key={t}
                turn={t}
                actorIds={actorIds}
                eventsByActor={perActorTurnEvents.map((m) => m.get(t) ?? [])}
                runTerminal={state.isComplete || state.isAborted}
                runAborted={state.isAborted}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function groupByTurn(events: ProcessedEvent[]): Map<number, ProcessedEvent[]> {
  const out = new Map<number, ProcessedEvent[]>();
  for (const e of events) {
    if (typeof e.turn !== 'number') continue;
    const arr = out.get(e.turn) ?? [];
    arr.push(e);
    out.set(e.turn, arr);
  }
  return out;
}
