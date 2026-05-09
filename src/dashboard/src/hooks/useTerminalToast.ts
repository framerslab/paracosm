/**
 * Fires a single toast when the run reaches a terminal state:
 * "Simulation complete" on clean finish, "Simulation ended early" on
 * abort. Dedup'd across remounts via sessionStorage fingerprint so a
 * page reload after a completed run doesn't re-toast.
 *
 * Cold-load gate: requires `userTriggeredRun` (the user clicked Run
 * during this session). A page that loads with the run already
 * complete via server event-buffer replay or local persistence cache
 * does NOT toast — the user wasn't watching it finish, so announcing
 * it is noise.
 *
 * Extracted from App.tsx.
 */
import { useEffect } from 'react';
import { useToast } from '../components/shared/Toast';
import type { AbortReasonState } from './useSSE';

const STORAGE_KEY = 'paracosm:terminalToastFingerprint';

export interface UseTerminalToastOptions {
  isComplete: boolean;
  isAborted: boolean;
  abortReason: AbortReasonState | null;
  resultsCount: number;
  hasVerdict: boolean;
  replayDone: boolean;
  tourActive: boolean;
  /** True only after the user clicked Run during this session. */
  userTriggeredRun: boolean;
}

export function useTerminalToast({
  isComplete,
  isAborted,
  abortReason,
  resultsCount,
  hasVerdict,
  replayDone,
  tourActive,
  userTriggeredRun,
}: UseTerminalToastOptions): void {
  const { toast } = useToast();
  useEffect(() => {
    if (tourActive) return;
    if (!userTriggeredRun) return;
    if (!isComplete && !isAborted) return;
    if (!replayDone) return;
    const fingerprint = isAborted
      ? `aborted:${abortReason?.reason ?? 'unknown'}:${abortReason?.leader ?? ''}:${abortReason?.turn ?? ''}`
      : `complete:${resultsCount}:${hasVerdict ? 'v' : 'nv'}`;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === fingerprint) return;
      sessionStorage.setItem(STORAGE_KEY, fingerprint);
    } catch {
      /* silent — fall through and toast once per mount */
    }
    if (isAborted) {
      toast('info', 'Simulation ended early', 'Partial results saved. Reload to resume from the abort point.');
    } else {
      toast('success', 'Simulation complete', 'Open the Reports tab for the verdict + full breakdown.');
    }
  }, [isComplete, isAborted, abortReason, resultsCount, hasVerdict, replayDone, tourActive, userTriggeredRun, toast]);
}
