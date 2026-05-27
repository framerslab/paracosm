/**
 * Helpers for building shareable dashboard URLs and reading the
 * current run's session id off the live SSE event stream.
 *
 * Two surfaces consume these:
 *
 * - **TopBar overflow menu** — "Share viz link" item. Reads the latest
 *   `sim_saved` server event from `sse.events`, builds a deep link
 *   targeting the viz tab, writes it to the clipboard.
 * - **QuickstartResults actor cards** — per-actor "Copy viz link"
 *   button. Same URL contract, different invocation point. The
 *   Quickstart pipeline supplies the session id directly so the
 *   `findLatestSavedSessionId` helper isn't needed there.
 *
 * Pure functions, no DOM / React imports — runs under node:test
 * without a browser shim, matching the dashboard pattern.
 *
 * @module paracosm/cli/dashboard/hooks/shareUrl.helpers
 */
import type { SimEvent } from './useSSE';

/**
 * Tabs that the dashboard router accepts as a share-link landing
 * target. Mirrors `DashboardTab` from tab-routing without importing it
 * here — keeps the helper file React-free so node:test can load it
 * without a CSS shim. The viz, sim, reports, chat, library, settings,
 * and studio tabs all make sense for a loaded run; `quickstart` is
 * included for the legacy Quickstart pipeline; `about` is intentionally
 * excluded because landing there discards the loaded sim.
 */
export type ShareTargetTab =
  | 'sim'
  | 'viz'
  | 'reports'
  | 'chat'
  | 'library'
  | 'settings'
  | 'studio'
  | 'quickstart';

/**
 * Build a `?replay=<sessionId>&tab=<tab>` deep link for a stored
 * dashboard session. The URL hits the public `/sessions/:id/replay`
 * SSE endpoint on mount; combined with `?tab=` the viewer lands on the
 * requested tab with the run streaming behind it.
 *
 * Used by the TopBar "Share viz link" handler and the Quickstart
 * actor-card share button. `tab` defaults to `'viz'` because that's
 * the most visually compelling landing target for social shares
 * (r/dataisbeautiful, r/internetisbeautiful); callers that need a
 * different tab override explicitly.
 */
export function buildReplayShareUrl(
  origin: string,
  sessionId: string,
  tab: ShareTargetTab = 'viz',
): string {
  const url = new URL('/sim', origin);
  url.searchParams.set('replay', sessionId);
  url.searchParams.set('tab', tab);
  return url.toString();
}

/**
 * Find the latest `sim_saved` server event with `status === 'saved'`
 * and return its session id. Returns `null` when no successful save
 * has landed yet (sim still running, save failed, run was skipped for
 * being below the min-turns threshold).
 *
 * The event flow:
 *
 * 1. Server's `autoSaveOnComplete` pass writes the run to the session
 *    store and emits `sim_saved` with `{ status: 'saved', id: '<uuid>' }`.
 * 2. `useSSE` appends the event to the in-memory buffer.
 * 3. This helper reads the latest matching event so TopBar can decide
 *    whether the Share menu item is enabled.
 *
 * Iterates from the end of the buffer so the freshest save wins when
 * a single dashboard tab has run multiple sims in a session.
 */
export function findLatestSavedSessionId(events: readonly SimEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i];
    if (evt.type !== 'sim_saved') continue;
    const data = (evt.data ?? {}) as Record<string, unknown>;
    if (data.status !== 'saved') continue;
    const id = data.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}
