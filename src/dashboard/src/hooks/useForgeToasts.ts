/**
 * Fires per-forge_attempt toasts with three layers of gating so toasts
 * never flash all at once on launch / load / replay.
 *
 * Three layers:
 *
 * 1. **sessionStorage** (`paracosm:seenForgeToasts`): per-tab key-set so a
 *    page reload does not replay every historical forge as a fresh
 *    toast. Keys are `leader|name|timestamp|approved` — stable per
 *    forge event across reconnects and buffer replays.
 *
 * 2. **In-memory watermark** (`liveStartIndexRef`): records the index in
 *    the events array at the moment the run transitioned to live
 *    (replayDone flipped true). Any forge at a position < watermark is
 *    historical — seed into the seen-set silently, never toast. Critical
 *    fix for "all toasts flash at once": React 18 batches the N sim
 *    setStates and the trailing replay_done setState into ONE commit, so
 *    without the watermark the effect would run with events=[N forges]
 *    AND replayDone=true and fire N toasts at once. Same pathology hits
 *    `loadEvents()`.
 *
 * 3. **In-memory toasted key set** (`toastedForgeKeysRef`): prevents the
 *    same forge from toasting twice within one tab session, even if
 *    sessionStorage clears or a re-render re-enters the effect.
 *
 * Extracted from App.tsx to keep the shell small and the gating logic
 * testable in isolation.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '../components/shared/Toast';
import type { SimEvent } from './useSSE';

const FORGE_SEEN_STORAGE_KEY = 'paracosm:seenForgeToasts';

function forgeKey(ev: SimEvent): string {
  const d = ev.data as Record<string, unknown>;
  return `${ev.leader || ''}|${d?.name || ''}|${d?.timestamp || ''}|${d?.approved}`;
}

export interface UseForgeToastsOptions {
  /** Event stream to scan for `forge_attempt` entries. */
  events: SimEvent[];
  /** True when the server has finished the SSE buffer replay on this
   *  connection. Toasts only fire for events received after this flips. */
  replayDone: boolean;
  /** True while the guided tour is showing demo events; suppresses the
   *  live-toast gate (demo events are canned and user already expects
   *  them to fire as the tour advances). */
  tourActive: boolean;
}

/**
 * localStorage flag for power-users who want the per-forge toast
 * stream. Off by default — every forge_attempt already renders an
 * inline PASS/FAIL pill on its EventCard in the live SIM panel, and
 * a parallel toast for every approval + every rejection produced an
 * overwhelming pop-up cascade that read as "the system is broken"
 * to first-time viewers.
 *
 * Set with: `localStorage.setItem('paracosm:forgeToasts', '1')`.
 */
const FORGE_TOASTS_ENABLED_KEY = 'paracosm:forgeToasts';

function forgeToastsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FORGE_TOASTS_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useForgeToasts({ events, replayDone, tourActive }: UseForgeToastsOptions): void {
  // Power-user opt-in. The default-off behavior keeps the SIM panel
  // legible for first-time viewers; the inline PASS/FAIL pill on each
  // forge EventCard still surfaces every outcome where forge activity
  // is actually relevant.
  const enabled = forgeToastsEnabled();
  const readSeen = useCallback((): Set<string> => {
    try {
      const raw = sessionStorage.getItem(FORGE_SEEN_STORAGE_KEY);
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  }, []);
  const writeSeen = useCallback((s: Set<string>) => {
    try {
      sessionStorage.setItem(FORGE_SEEN_STORAGE_KEY, JSON.stringify([...s].slice(-500)));
    } catch {
      /* silent */
    }
  }, []);

  const { toast } = useToast();

  /** Index at which the currently-streamed run became live. Events at
   *  positions before this index are historical (buffer replay, loaded
   *  file, replay session, or post-reset backfill) and must never toast.
   *  Null until the replay phase completes. */
  const liveStartIndexRef = useRef<number | null>(null);
  /** Every forge key already surfaced as a toast in this tab session. */
  const toastedForgeKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const done = tourActive ? true : replayDone;
    if (!done) return;
    // `reset()` shrinks events back to zero. Realign the watermark so
    // the next stream is treated as live — without this the watermark
    // could stay at, say, 120 from the prior run and suppress every
    // new forge on the new run.
    if (liveStartIndexRef.current === null || liveStartIndexRef.current > events.length) {
      liveStartIndexRef.current = events.length;
    }
  }, [replayDone, events.length, tourActive]);

  useEffect(() => {
    if (!enabled) return;
    const seen = readSeen();
    const alreadyToasted = toastedForgeKeysRef.current;
    const done = tourActive ? true : replayDone;
    // If replay hasn't finished yet OR the live-start watermark is still
    // unset, ALL current events are historical. Otherwise only events at
    // index >= watermark count as live.
    const liveStart = done ? (liveStartIndexRef.current ?? Infinity) : Infinity;

    // Stagger live toasts so a burst of forges in one commit doesn't
    // flash simultaneously. 450ms between pops reads as a sequence
    // without feeling sluggish.
    let stagger = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type !== 'forge_attempt') continue;
      const key = forgeKey(ev);
      if (seen.has(key) || alreadyToasted.has(key)) continue;
      seen.add(key);
      const isHistorical = i < liveStart;
      if (isHistorical) continue;
      alreadyToasted.add(key);
      const d = ev.data as Record<string, unknown>;
      const name = String(d?.name || 'unnamed tool');
      const dept = String(d?.department || ev.leader || '').toUpperCase();
      const approved = d?.approved === true;
      const confidence = typeof d?.confidence === 'number' ? d.confidence : null;
      const reason = String(d?.errorReason || '').slice(0, 220);
      const delay = stagger;
      stagger += 450;
      setTimeout(() => {
        if (approved) {
          const confStr = confidence != null ? ` · conf ${confidence.toFixed(2)}` : '';
          toast(
            'success',
            `${dept ? `${dept} · ` : ''}forged ${name}`,
            `Judge approved${confStr}`,
          );
        } else {
          toast(
            'error',
            `${dept ? `${dept} · ` : ''}rejected ${name}`,
            reason || 'Judge rejected (no reason provided)',
          );
        }
      }, delay);
    }
    writeSeen(seen);
  }, [enabled, events, toast, replayDone, tourActive, readSeen, writeSeen]);
}
