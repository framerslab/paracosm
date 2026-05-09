/**
 * Pin/unpin run ids in the Compare view's small-multiples grid. Caps at
 * 3 simultaneously pinned via LRU eviction so the PinnedDiffPanel never
 * has to render more than 3 columns. Pure local state — survives
 * neither tab change nor page reload (no localStorage v1).
 *
 * The pin-mutation logic is split into pure helpers (`applyPin`,
 * `applyUnpin`, `applyTogglePin`) so the LRU + dedupe semantics can
 * be unit-tested without React Testing Library.
 *
 * @module paracosm/dashboard/compare/hooks/usePinnedRuns
 */
import * as React from 'react';

export const PIN_LIMIT = 3;

export function applyPin(prev: readonly string[], runId: string, limit = PIN_LIMIT): string[] {
  if (prev.includes(runId)) return [...prev];
  const next = [...prev, runId];
  while (next.length > limit) next.shift();
  return next;
}

export function applyUnpin(prev: readonly string[], runId: string): string[] {
  return prev.filter((id) => id !== runId);
}

export function applyTogglePin(prev: readonly string[], runId: string, limit = PIN_LIMIT): string[] {
  return prev.includes(runId) ? applyUnpin(prev, runId) : applyPin(prev, runId, limit);
}

export interface PinnedRunsState {
  pinned: string[];
  pin: (runId: string) => void;
  unpin: (runId: string) => void;
  togglePin: (runId: string) => void;
  isPinned: (runId: string) => boolean;
}

export function usePinnedRuns(): PinnedRunsState {
  const [pinned, setPinned] = React.useState<string[]>([]);

  const pin = React.useCallback((runId: string) => {
    setPinned((prev) => applyPin(prev, runId));
  }, []);

  const unpin = React.useCallback((runId: string) => {
    setPinned((prev) => applyUnpin(prev, runId));
  }, []);

  const togglePin = React.useCallback((runId: string) => {
    setPinned((prev) => applyTogglePin(prev, runId));
  }, []);

  const isPinned = React.useCallback(
    (runId: string) => pinned.includes(runId),
    [pinned],
  );

  return { pinned, pin, unpin, togglePin, isPinned };
}
