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
 * Each toast is recorded under the run it belongs to: the run the page
 * held when that finish, or that verdict, arrived (noticeOwner.ts). A
 * fork brings a key of its own while the page keeps its parent's finish
 * and verdict, and announces neither again.
 *
 * Extracted from App.tsx.
 */
import { useEffect, useRef } from 'react';
import { useToast } from '../components/shared/Toast';
import { finishSignal, noticeOwner, type NoticeOwner } from './noticeOwner';
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
  userTriggeredRun,
  verdict,
}: UseTerminalToastOptions): void {
  const { toast } = useToast();
  // The run each notice belongs to. Kept by the first effect, so the
  // notices below read this render's owners: effects run in the order they
  // are written.
  const finishOwnerRef = useRef<NoticeOwner<string> | null>(null);
  const verdictOwnerRef = useRef<NoticeOwner<Record<string, unknown> | null> | null>(null);
  const finish = finishSignal(isComplete, isAborted, resultsCount);
  const heldVerdict = verdict ?? null;
  useEffect(() => {
    finishOwnerRef.current = noticeOwner(finishOwnerRef.current, finish, runKey);
    verdictOwnerRef.current = noticeOwner(verdictOwnerRef.current, heldVerdict, runKey);
  }, [finish, heldVerdict, runKey]);

  useEffect(() => {
    if (!userTriggeredRun) return;
    if (!isComplete && !isAborted) return;
    if (!replayDone) return;
    const finishedRunKey = finishOwnerRef.current ? finishOwnerRef.current.runKey : runKey;
    const fingerprint = finishedRunKey ?? (isAborted
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
  }, [runKey, isComplete, isAborted, abortReason, resultsCount, hasVerdict, replayDone, userTriggeredRun, toast]);

  // Verdict toast — separate effect so the winner announcement fires
  // even when the verdict arrives a beat AFTER the terminal toast
  // (cohort verdicts are an extra LLM call after every actor finishes
  // so the gap can be 5-30s). Fingerprinted independently so the two
  // toasts don't clobber each other's dedup.
  useEffect(() => {
    if (!userTriggeredRun) return;
    if (!verdict || typeof verdict !== 'object') return;
    if (!replayDone) return;
    const judgedRunKey = verdictOwnerRef.current ? verdictOwnerRef.current.runKey : runKey;
    // Strict equality on `=== true` instead of Boolean() so a non-boolean
    // truthy payload (legacy clients sending "skipped": "yes" etc.) does
    // not silently flip the banner into the no-verdict state.
    const skipped = (verdict as { skipped?: unknown }).skipped === true;
    if (skipped) {
      // Skipped-verdict toast — explains the missing banner so users
      // don't refresh the page assuming something hung.
      const reason = String((verdict as { reason?: unknown }).reason || 'unknown');
      const fingerprint = judgedRunKey ?? `skipped:${reason}`;
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
    const fingerprint = judgedRunKey ?? `${mode}:${winner}:${winnerName}:${headline}`;
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
  }, [runKey, verdict, replayDone, userTriggeredRun, toast]);
}
