import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { TurnRow } from './TurnRow.js';
import { computeTurnDiff } from './turn-diff.js';
import type { GameState, ProcessedEvent } from '../../hooks/useGameState.js';
import styles from './TurnGrid.module.scss';

void React;

interface TurnGridProps {
  state: GameState;
}

/**
 * Replaces the SIM tab's two-column scroll. Sticky compact ActorBar
 * for each leader at the top, then per-turn rows aligned across both
 * leaders. One scroll container at the grid level (the per-leader
 * scroll-and-pin behavior used to live inside `LeaderColumn`).
 */
export function TurnGrid({ state }: TurnGridProps) {
  const firstId = state.actorIds[0];
  const secondId = state.actorIds[1];
  const sideA = firstId ? state.actors[firstId] : null;
  const sideB = secondId ? state.actors[secondId] : null;

  const eventsA = sideA?.events ?? [];
  const eventsB = sideB?.events ?? [];

  const diffMap = useMemo(() => computeTurnDiff(eventsA, eventsB), [eventsA, eventsB]);
  const turns = useMemo(() => [...diffMap.keys()], [diffMap]);

  const turnsToEventsA = useMemo(() => groupByTurn(eventsA), [eventsA]);
  const turnsToEventsB = useMemo(() => groupByTurn(eventsB), [eventsB]);

  // Scroll-pin behavior. Threshold 60px is slightly larger than the
  // per-column 40px LeaderColumn used; rows are taller now.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [eventsA.length, eventsB.length]);

  // The compact-ActorBar sticky header that used to live here was a
  // visible duplicate of the full ActorBars rendered by SimView's
  // `leadersRow` directly above the grid — both rendered immediately,
  // not lazily on scroll, so the user saw "name + POP + morale + event"
  // twice in a row. SimView owns the leader strip; TurnGrid is just the
  // per-turn rows now. (The N-actor MultiActorTurnGrid keeps its own
  // sticky header because SimView intentionally skips leadersRow at 3+
  // actors — there's no duplicate to remove there.)
  return (
    <div className={`sim-columns ${styles.grid}`}>
      <div ref={scrollRef} onScroll={onScroll} className={styles.scroll}>
        {turns.length === 0 ? (
          <div className={styles.empty}>No turns yet — events will appear as the run progresses.</div>
        ) : (
          turns.map(t => {
            const entry = diffMap.get(t)!;
            return (
              <TurnRow
                key={t}
                entry={entry}
                eventsA={turnsToEventsA.get(t) ?? []}
                eventsB={turnsToEventsB.get(t) ?? []}
                runTerminal={state.isComplete || state.isAborted}
                runAborted={state.isAborted}
              />
            );
          })
        )}
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
