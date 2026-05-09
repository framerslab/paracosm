/**
 * Per-turn diff classification for the SIM tab's side-by-side TurnGrid.
 * Reads existing `ActorSideState.events` arrays and decides whether a
 * given turn is identical, divergent on outcome, divergent on event,
 * still pending, or only-one-sided across the two leaders.
 *
 * Rules mirror the in-banner classification that DivergenceRail uses
 * today; this helper extends that single-turn snapshot to a per-turn
 * map across the full run history.
 *
 * @module paracosm/dashboard/sim/turn-diff
 */
import type { ProcessedEvent } from '../../hooks/useGameState.js';

export type TurnDiffClass =
  | 'same'                   // both leaders: same title, same outcome
  | 'different-outcome'      // both leaders: same title, different outcome
  | 'different-event'        // both leaders: different title
  | 'pending'                // both leaders have entered the turn but at
                             // least one side has no `outcome` yet
  | 'one-sided';             // exactly one leader has events for this turn

export interface TurnDiffEntry {
  turn: number;
  classification: TurnDiffClass;
  /** Title from the most-recent `event_start` for leader A, empty when
   *  leader A has no events for this turn. */
  titleA: string;
  titleB: string;
  /** Outcome string from the `outcome` event, empty when not yet set. */
  outcomeA: string;
  outcomeB: string;
}

export function classifyTurn(
  eventsA: ProcessedEvent[],
  eventsB: ProcessedEvent[],
  turn: number,
): TurnDiffEntry | null {
  const aEvents = eventsA.filter(e => e.turn === turn);
  const bEvents = eventsB.filter(e => e.turn === turn);
  if (aEvents.length === 0 && bEvents.length === 0) return null;

  const lastEventStartA = [...aEvents].reverse().find(e => e.type === 'event_start');
  const lastEventStartB = [...bEvents].reverse().find(e => e.type === 'event_start');
  const titleA = String(lastEventStartA?.data?.title ?? '');
  const titleB = String(lastEventStartB?.data?.title ?? '');
  const outcomeA = String(aEvents.find(e => e.type === 'outcome')?.data?.outcome ?? '');
  const outcomeB = String(bEvents.find(e => e.type === 'outcome')?.data?.outcome ?? '');

  if (aEvents.length === 0 || bEvents.length === 0) {
    return { turn, classification: 'one-sided', titleA, titleB, outcomeA, outcomeB };
  }
  if (!outcomeA || !outcomeB) {
    return { turn, classification: 'pending', titleA, titleB, outcomeA, outcomeB };
  }
  if (titleA !== titleB) {
    return { turn, classification: 'different-event', titleA, titleB, outcomeA, outcomeB };
  }
  if (outcomeA !== outcomeB) {
    return { turn, classification: 'different-outcome', titleA, titleB, outcomeA, outcomeB };
  }
  return { turn, classification: 'same', titleA, titleB, outcomeA, outcomeB };
}

export function computeTurnDiff(
  eventsA: ProcessedEvent[],
  eventsB: ProcessedEvent[],
): Map<number, TurnDiffEntry> {
  const turns = new Set<number>();
  for (const e of eventsA) if (typeof e.turn === 'number') turns.add(e.turn);
  for (const e of eventsB) if (typeof e.turn === 'number') turns.add(e.turn);
  const sorted = [...turns].sort((x, y) => x - y);
  const out = new Map<number, TurnDiffEntry>();
  for (const t of sorted) {
    const entry = classifyTurn(eventsA, eventsB, t);
    if (entry) out.set(t, entry);
  }
  return out;
}
