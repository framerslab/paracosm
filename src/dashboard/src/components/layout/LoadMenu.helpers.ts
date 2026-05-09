/**
 * Pure helpers extracted from LoadMenu for unit testing. The React
 * component wires these to UI state; helpers are kept free of
 * DOM/React dependencies so they can run under node:test.
 *
 * @module paracosm/cli/dashboard/components/layout/LoadMenu.helpers
 */
import type { SessionsStatus, StoredSessionMeta } from '../../hooks/useSessions';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** `Apr 18 · 14:32` in the viewer's local timezone. */
export function formatExplicit(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()} · ${hh}:${mm}`;
}

/** Hide the cache row when the server ring is unavailable or errored. */
export function shouldShowCacheRow(status: SessionsStatus): boolean {
  // Also show error / unavailable so the user gets a clear hint
  // instead of just seeing an empty-ish menu. Previously these
  // states hid the row entirely, making it impossible to
  // distinguish "no saved runs" from "server is down."
  return status === 'loading' || status === 'ready' || status === 'error' || status === 'unavailable';
}

/** Which body to render when the cache row is expanded. */
export function cacheExpandedBody(
  status: SessionsStatus,
  sessions: readonly StoredSessionMeta[],
): 'loading' | 'empty' | 'cards' | 'error' | 'unavailable' {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  if (status === 'unavailable') return 'unavailable';
  if (sessions.length === 0) return 'empty';
  return 'cards';
}

/**
 * Build a replay href that preserves the current origin + path and
 * forces the SIM tab. Without `tab=sim`, clicking "Replay last run"
 * from the QUICKSTART tab kept the user on QUICKSTART with `?replay=`
 * dangling — the replay SSE stream connected and the top banner
 * showed REPLAYING, but the page content was still the seed-input
 * form and nothing visibly happened. Forcing tab=sim lands the user
 * on the surface that actually renders the replay (SimView).
 */
export function buildReplayHref(base: string, id: string): string {
  const url = new URL(base);
  url.searchParams.set('replay', id);
  url.searchParams.set('tab', 'sim');
  return url.toString();
}
