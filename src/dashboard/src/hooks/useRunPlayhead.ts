import { useEffect, useState } from 'react';
import { createWatchTurnHref, watchTurnFromHref, type WatchTurn } from '../tab-routing';

/** Playback multipliers for frames already in the buffer. */
export const RUN_SPEEDS = [0.5, 1, 2, 4] as const;

/** A supported playback multiplier. */
export type RunSpeed = typeof RUN_SPEEDS[number];
type Mode = 'follow' | 'hold' | 'replay';
type Reached = 'following' | 'latest' | 'key';

interface Cursor {
  identity: string | null;
  mode: Mode;
  position: WatchTurn | null;
  speed: RunSpeed;
  endSeen: boolean;
  reached: Reached;
}

/** One run's shared playback state and actions. */
export interface RunPlayhead {
  mode: Mode;
  selected: WatchTurn | null;
  newest: number | null;
  turns: readonly number[];
  endReady: boolean;
  endSeen: boolean;
  reached: Reached;
  speed: RunSpeed;
  hasBack: boolean;
  hasForward: boolean;
  select: (position: WatchTurn) => void;
  step: (direction: -1 | 1) => void;
  toggle: () => void;
  restart: () => void;
  latest: () => void;
  setSpeed: (speed: RunSpeed) => void;
}

const READING_INTERVAL = 30_000;

function fresh(identity: string | null, position: WatchTurn | null = null): Cursor {
  return { identity, mode: position === null ? 'follow' : 'hold', position, speed: 1, endSeen: false, reached: 'following' };
}

function restore(identity: string): WatchTurn | null {
  const entry = window.history.state?.watchPlayback;
  if (entry && (entry.identity !== identity || entry.mode === 'follow')) return null;
  return watchTurnFromHref(window.location.href);
}

/** Keeps a single playhead above the two views, scoped to the recorded run. */
export function useRunPlayhead(identity: string | null, arrivedTurns: readonly number[], endReady: boolean): RunPlayhead {
  const [started, setStarted] = useState(identity !== null);
  const [cursor, setCursor] = useState(() => fresh(identity, identity ? restore(identity) : null));
  if (cursor.identity !== identity) {
    setCursor(fresh(identity, !started && identity ? restore(identity) : null));
    if (!started && identity) setStarted(true);
  }
  const current = cursor.identity === identity ? cursor : fresh(identity);
  const newest = arrivedTurns.at(-1) ?? null;
  const first = arrivedTurns[0] ?? null;
  const positions: WatchTurn[] = endReady ? [...arrivedTurns, 'end'] : [...arrivedTurns];
  const waitingForAddress = current.position !== null && !positions.includes(current.position)
    && !endReady && (current.position === 'end' || newest === null || current.position > newest);
  const selected = current.mode === 'follow'
    ? (endReady ? 'end' : newest)
    : current.position !== null && positions.includes(current.position)
      ? current.position
      : current.position === null ? first : newest;
  const endSeen = current.endSeen || selected === 'end';
  const index = selected === null ? -1 : positions.indexOf(selected);
  const next = positions[index + 1];
  const previous = positions[index - 1];

  useEffect(() => {
    if (!identity || waitingForAddress) return;
    const url = createWatchTurnHref(window.location.href, selected);
    window.history.replaceState({
      ...window.history.state,
      watchPlayback: { identity, mode: current.mode },
    }, '', url);
  }, [identity, selected, current.mode, waitingForAddress]);

  useEffect(() => {
    if (selected !== 'end' || current.endSeen || !identity) return;
    setCursor(latest => latest.identity === identity ? { ...latest, endSeen: true } : latest);
  }, [identity, selected, current.endSeen]);

  useEffect(() => {
    if (current.mode !== 'replay' || !identity) return;
    if (next === undefined) {
      setCursor(latest => latest.identity === identity && latest.mode === 'replay'
        ? { ...latest, mode: 'follow', position: null } : latest);
      return;
    }
    const timer = window.setTimeout(() => {
      setCursor(latest => latest.identity === identity && latest.mode === 'replay'
        ? { ...latest, position: next } : latest);
    }, READING_INTERVAL / current.speed);
    return () => window.clearTimeout(timer);
  }, [current.mode, current.speed, identity, next, selected]);

  const move = (position: WatchTurn | null, mode: Mode, reached: Reached = 'key') => {
    setCursor(latest => latest.identity === identity
      ? { ...latest, mode, position, reached, endSeen: endSeen || position === 'end' }
      : latest);
  };
  const select = (position: WatchTurn) => {
    if (positions.includes(position)) move(position, 'hold');
  };
  return {
    mode: current.mode,
    selected,
    newest,
    turns: arrivedTurns,
    endReady,
    endSeen,
    reached: current.reached,
    speed: current.speed,
    hasBack: previous !== undefined,
    hasForward: next !== undefined && selected !== null,
    select,
    step: direction => {
      const target = direction === -1 ? previous : next;
      if (target !== undefined && selected !== null) select(target);
    },
    toggle: () => {
      if (selected === 'end') {
        if (first !== null) move(first, 'replay');
      } else if (current.mode !== 'hold') {
        move(selected, 'hold');
      } else {
        move(selected, next === undefined ? 'follow' : 'replay', 'following');
      }
    },
    restart: () => { if (first !== null) move(first, 'replay', 'following'); },
    latest: () => move(null, 'follow', 'latest'),
    setSpeed: speed => setCursor(latest => latest.identity === identity ? { ...latest, speed } : latest),
  };
}
