/**
 * Launching-state side effects: auto-clear once the sim is running or
 * complete, and a 30-second safety timeout that fires a "Launch
 * Stalled" toast when /setup succeeded but no SSE events arrived.
 *
 * The `launching` state itself stays in the caller (App.tsx) because
 * it's threaded through as a prop to TopBar + SimView. This hook
 * centralizes the two useEffects that used to live inline.
 *
 * Extracted from App.tsx.
 */
import { useEffect } from 'react';
import { useToast } from '../components/shared/Toast';

export interface UseLaunchStateOptions {
  launching: boolean;
  setLaunching: (value: boolean) => void;
  isRunning: boolean;
  isComplete: boolean;
  sseStatus: string;
  eventsCount: number;
}

export function useLaunchState({
  launching,
  setLaunching,
  isRunning,
  isComplete,
  sseStatus,
  eventsCount,
}: UseLaunchStateOptions): void {
  const { toast } = useToast();

  // Auto-clear launching once the sim actually starts running, is
  // complete, or the connection errored. Gating on isRunning (not
  // on any SSE event arriving) closes a UX gap where the empty-state
  // briefly flashed during Turn 0 dept promotions.
  useEffect(() => {
    if (!launching) return;
    if (isRunning || isComplete || sseStatus === 'error') {
      setLaunching(false);
    }
  }, [launching, isRunning, isComplete, sseStatus, setLaunching]);

  // Drop the cross-page localStorage handoff flag set by Quickstart's
  // window.location.href flip once the launching state resolves. Without
  // this, a subsequent /sim reload or hot-mount would re-hydrate
  // launching=true even though no fresh launch is pending.
  //
  // Guard the removeItem call with a getItem === '1' check so the no-op
  // first-mount case (no flag set, launching=false default) doesn't fire
  // a write, and so a multi-tab race (tab A pinned the flag, tab B's
  // SimView mounts already-running and would otherwise clear it) leaves
  // tab A's pending flag intact.
  useEffect(() => {
    if (launching) return;
    try {
      if (window.localStorage.getItem('paracosm:launchPending') === '1') {
        window.localStorage.removeItem('paracosm:launchPending');
      }
    } catch { /* private mode */ }
  }, [launching]);

  // Safety timeout: if /setup succeeded but no events arrived in 30s,
  // give up on the spinner. Only toast when we really saw nothing —
  // if SSE events arrived, the sim is alive and the user does not
  // need a "Launch Stalled" message scaring them while they watch
  // events stream in.
  useEffect(() => {
    if (!launching) return;
    const timer = setTimeout(() => {
      setLaunching(false);
      const hasSignal = eventsCount > 0 || isRunning || isComplete;
      if (!hasSignal) {
        toast('error', 'Launch Stalled', 'No events received within 30 seconds. The simulation may still complete in the background.');
      }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [launching, toast, eventsCount, isComplete, isRunning, setLaunching]);
}
