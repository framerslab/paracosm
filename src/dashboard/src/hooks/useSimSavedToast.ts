/**
 * Surfaces the server's `sim_saved` SSE event as a toast. Successful
 * saves show the run id so users can see it landed in the cache;
 * failed saves show a concrete reason (never silent); expected skips
 * (`below_min_turns`) are silenced so aborted-too-early runs don't
 * spam the user.
 *
 * The page must have launched this run or received its hand-off.
 * Opening a previous run for playback leaves the notice off.
 *
 * Dedup'd via sessionStorage fingerprint keyed on the run, status, id
 * and reason, so returning to the tab after a reload doesn't re-toast and
 * each run's save is announced, a failed one after another run's included.
 *
 * Extracted from App.tsx.
 */
import { useEffect } from 'react';
import { useToast } from '../components/shared/Toast';
import { saveNoticeFingerprint } from './noticeOwner';
import type { SimEvent } from './useSSE';

const STORAGE_KEY = 'paracosm:simSavedToastFingerprint';

export interface UseSimSavedToastOptions {
  savedEvent: SimEvent | null;
  /** The run the save belongs to: the run the page shows. */
  runKey: string | null;
  /** True when the page launched this run or received its hand-off. */
  userTriggeredRun: boolean;
}

export function useSimSavedToast({ savedEvent, runKey, userTriggeredRun }: UseSimSavedToastOptions): void {
  const { toast } = useToast();
  useEffect(() => {
    if (!userTriggeredRun) return;
    if (!savedEvent) return;
    const d = (savedEvent.data ?? {}) as Record<string, unknown>;
    const status = String(d.status ?? 'unknown');
    const fingerprint = saveNoticeFingerprint(runKey, d);
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === fingerprint) return;
      sessionStorage.setItem(STORAGE_KEY, fingerprint);
    } catch {
      /* silent */
    }
    if (status === 'saved') {
      const id = typeof d.id === 'string' ? d.id.slice(0, 8) : 'run';
      toast('success', 'Saved to cache', `Run ${id}… stored. Open More, then Library, to replay.`);
    } else if (status === 'failed') {
      toast('error', 'Cache save failed', String(d.error ?? 'Unknown error'));
    } else if (status === 'skipped') {
      const reason = String(d.reason ?? 'unknown');
      if (reason !== 'below_min_turns') {
        toast('info', 'Not cached', `Skipped: ${reason.replace(/_/g, ' ')}.`);
      }
    }
  }, [savedEvent, runKey, userTriggeredRun, toast]);
}
