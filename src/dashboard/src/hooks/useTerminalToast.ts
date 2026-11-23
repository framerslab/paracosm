/**
 * Fires a single toast when the run reaches a terminal state:
 * "Simulation complete" on clean finish, "Simulation ended early" on
 * abort. Dedup'd across remounts via sessionStorage fingerprint so a
 * page reload after a completed run doesn't re-toast.
 *
 * Requires a run launched from this page or handed off to it. A cold
 * load can rehydrate an earlier run without announcing its result.
 *
 * Two distinct toasts:
 *   - Terminal toast: completion / abort outcome, with no verdict info.
 *   - Verdict toast: winner name + headline, fired only when the
 *     verdict landed (pair or cohort). Its own fingerprint lets the
 *     verdict and the completion each announce once.
 *
 * Extracted from App.tsx.
 */
import { useEffect } from 'react';
import { useToast } from '../components/shared/Toast';
import type { AbortReasonState } from './useSSE';

const STORAGE_KEY = 'paracosm:terminalToastFingerprint';
const VERDICT_STORAGE_KEY = 'paracosm:verdictToastFingerprint';

export interface UseTerminalToastOptions {
  runKey: string | null;
  isComplete: boolean;
  isAborted: boolean;
  abortReason: AbortReasonState | null;
  resultsCount: number;
  hasVerdict: boolean;
  replayDone: boolean;
  tourActive: boolean;
  /** True when the page launched this run or received its hand-off. */
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
  runKey,
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
    const fingerprint = runKey ?? (isAborted
      ? `aborted:${abortReason?.reason ?? 'unknown'}:${abortReason?.leader ?? ''}:${abortReason?.turn ?? ''}`
      : `complete:${resultsCount}:${hasVerdict ? 'v' : 'nv'}`);
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
  }, [runKey, isComplete, isAborted, abortReason, resultsCount, hasVerdict, replayDone, tourActive, userTriggeredRun, toast]);

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
    // Strict equality on `=== true` instead of Boolean() so a non-boolean
    // truthy payload (legacy clients sending "skipped": "yes" etc.) does
    // not silently flip the banner into the no-verdict state.
    const skipped = (verdict as { skipped?: unknown }).skipped === true;
    if (skipped) {
      // Skipped-verdict toast — explains the missing banner so users
      // don't refresh the page assuming something hung.
      const reason = String((verdict as { reason?: unknown }).reason || 'unknown');
      const fingerprint = runKey ?? `skipped:${reason}`;
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
    const winnerRaw = (verdict as { winner?: unknown }).winner;
    // Treat only null/undefined as absent so a legitimate falsy string
    // payload (impossible per the current schema but cheap to defend
    // against) still flows through to the toast logic. Normalize to a
    // string up front so downstream comparisons don't drift between
    // raw type and the cast.
    if (winnerRaw === null || winnerRaw === undefined) return;
    const winner = String(winnerRaw);
    const headline = String((verdict as { headline?: unknown }).headline || '').trim();
    const mode = (verdict as { mode?: unknown }).mode === 'cohort' ? 'cohort' : 'pair';
    const winnerName = (() => {
      if (mode === 'cohort') return winner;
      if (winner === 'tie') return 'Tie';
      const named = String((verdict as { winnerName?: unknown }).winnerName || '').trim();
      return named || `Leader ${winner}`;
    })();
    const fingerprint = runKey ?? `${mode}:${winner}:${winnerName}:${headline}`;
    try {
      if (sessionStorage.getItem(VERDICT_STORAGE_KEY) === fingerprint) return;
      sessionStorage.setItem(VERDICT_STORAGE_KEY, fingerprint);
    } catch {
      /* silent */
    }
    const isTie = winner === 'tie';
    const title = mode === 'cohort'
      ? (isTie ? 'Cohort tied' : `${winnerName} leads the cohort`)
      : (isTie ? 'Verdict: tie' : `${winnerName} wins`);
    const body = headline || 'Click the verdict banner for the full breakdown.';
    toast('success', title, body);
  }, [runKey, verdict, replayDone, tourActive, userTriggeredRun, toast]);
}
