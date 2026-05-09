/**
 * Surfaces the server's `sim_saved` SSE event as a toast. Successful
 * saves show the run id so users can see it landed in the cache;
 * failed saves show a concrete reason (never silent); expected skips
 * (`below_min_turns`) are silenced so aborted-too-early runs don't
 * spam the user.
 *
 * Cold-load gate: requires `userTriggeredRun` (the user clicked Run
 * during this session). A page that loads with `sim_saved` already
 * present in the rehydrated event buffer does NOT toast — the cache
 * write happened on a previous session.
 *
 * Dedup'd via sessionStorage fingerprint keyed on status + id + reason
 * so returning to the tab after a reload doesn't re-toast.
 *
 * Extracted from App.tsx.
 */
import { useEffect } from 'react';
import { useToast } from '../components/shared/Toast';
import type { SimEvent } from './useSSE';

const STORAGE_KEY = 'paracosm:simSavedToastFingerprint';

export interface UseSimSavedToastOptions {
  events: SimEvent[];
  tourActive: boolean;
  /** True only after the user clicked Run during this session. */
  userTriggeredRun: boolean;
}

export function useSimSavedToast({ events, tourActive, userTriggeredRun }: UseSimSavedToastOptions): void {
  const { toast } = useToast();
  useEffect(() => {
    if (tourActive) return;
    if (!userTriggeredRun) return;
    const savedEvent = events.find((e) => e.type === 'sim_saved');
    if (!savedEvent) return;
    const d = (savedEvent.data ?? {}) as Record<string, unknown>;
    const status = String(d.status ?? 'unknown');
    const fingerprint = `sim_saved:${status}:${d.id ?? ''}:${d.reason ?? ''}`;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === fingerprint) return;
      sessionStorage.setItem(STORAGE_KEY, fingerprint);
    } catch {
      /* silent */
    }
    if (status === 'saved') {
      const id = typeof d.id === 'string' ? d.id.slice(0, 8) : 'run';
      toast('success', 'Saved to cache', `Run ${id}… stored. Open LOAD to replay.`);
    } else if (status === 'failed') {
      toast('error', 'Cache save failed', String(d.error ?? 'Unknown error'));
    } else if (status === 'skipped') {
      const reason = String(d.reason ?? 'unknown');
      if (reason !== 'below_min_turns') {
        toast('info', 'Not cached', `Skipped: ${reason.replace(/_/g, ' ')}.`);
      }
    }
  }, [events, tourActive, userTriggeredRun, toast]);
}
