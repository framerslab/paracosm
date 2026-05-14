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
 * Two distinct toasts:
 *   - Terminal toast: completion / abort outcome, with no verdict info.
 *   - Verdict toast: winner name + headline, fired only when the
 *     verdict landed (pair or cohort). Independent fingerprint so a
 *     cold-loaded run that already had a verdict announces both.
 *
 * Extracted from App.tsx.
 */
import { useEffect } from 'react';
import { useToast } from '../components/shared/Toast';
import type { AbortReasonState } from './useSSE';

const STORAGE_KEY = 'paracosm:terminalToastFingerprint';
const VERDICT_STORAGE_KEY = 'paracosm:verdictToastFingerprint';

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
  /**
   * Full verdict payload — null while pending. Used to render the
   * winner-specific toast that follows the terminal one. Carries
   * either the pair shape (`winner: 'A'|'B'|'tie'`, `winnerName`)
   * or the cohort shape (`winner: string`, `winnerIndex`).
   */
  verdict?: Record<string, unknown> | null;
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
  verdict,
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

  // Verdict toast — separate effect so the winner announcement fires
  // even when the verdict arrives a beat AFTER the terminal toast
  // (cohort verdicts are an extra LLM call after every actor finishes
  // so the gap can be 5-30s). Fingerprinted independently so the two
  // toasts don't clobber each other's dedup.
  useEffect(() => {
    if (tourActive) return;
    if (!userTriggeredRun) return;
    if (!verdict || typeof verdict !== 'object') return;
    if (!replayDone) return;
    const skipped = Boolean((verdict as { skipped?: unknown }).skipped);
    if (skipped) {
      // Skipped-verdict toast — explains the missing banner so users
      // don't refresh the page assuming something hung.
      const reason = String((verdict as { reason?: unknown }).reason || 'unknown');
      const fingerprint = `skipped:${reason}`;
      try {
        if (sessionStorage.getItem(VERDICT_STORAGE_KEY) === fingerprint) return;
        sessionStorage.setItem(VERDICT_STORAGE_KEY, fingerprint);
      } catch { /* silent */ }
      const body = (() => {
        switch (reason) {
          case 'generation_failed': return 'The verdict LLM call failed. Reports tab has the raw stats.';
          case 'cohort_too_large': return 'Cohort size exceeded the verdict cap. Reports tab has the breakdown.';
          case 'economics_skip': return 'Verdicts off in your economics profile. Reports tab has the run summary.';
          default: return 'Verdict unavailable for this run. See Reports for the breakdown.';
        }
      })();
      toast('info', 'Run finished — no verdict', body);
      return;
    }
    const winner = (verdict as { winner?: unknown }).winner;
    if (!winner) return;
    const headline = String((verdict as { headline?: unknown }).headline || '').trim();
    const mode = (verdict as { mode?: unknown }).mode === 'cohort' ? 'cohort' : 'pair';
    const winnerName = (() => {
      if (mode === 'cohort') return String(winner);
      if (winner === 'tie') return 'Tie';
      const named = String((verdict as { winnerName?: unknown }).winnerName || '').trim();
      return named || `Leader ${String(winner)}`;
    })();
    const fingerprint = `${mode}:${String(winner)}:${winnerName}:${headline}`;
    try {
      if (sessionStorage.getItem(VERDICT_STORAGE_KEY) === fingerprint) return;
      sessionStorage.setItem(VERDICT_STORAGE_KEY, fingerprint);
    } catch {
      /* silent */
    }
    const title = mode === 'cohort'
      ? (winner === 'tie' ? 'Cohort tied' : `${winnerName} leads the cohort`)
      : (winner === 'tie' ? 'Verdict: tie' : `${winnerName} wins`);
    const body = headline || 'Click the verdict banner for the full breakdown.';
    toast('success', title, body);
  }, [verdict, replayDone, tourActive, userTriggeredRun, toast]);
}
