/**
 * Replay-mode banners that sit above the TopBar when ?replay=<id> is
 * active: one when the session exists (REPLAYING SAVED DEMO) and one
 * when it's gone (REPLAY NOT FOUND). Both offer an exit back to live
 * mode.
 *
 * The active banner is INFO, not error. Earlier versions reused the
 * rust accent (`var(--accent)`) for the background, which made the
 * banner read as a warning even though it just announces "you're
 * watching a cached run". The palette here uses the elevated-surface
 * neutral background and AA-compliant token colors for muted text.
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import type { StoredSessionMeta } from '../../hooks/useSessions';
import styles from './ReplayBanner.module.scss';

void React; // dashboard SSR tests run without the automatic JSX runtime

interface ReplayBannerProps {
  replaySessionId: string;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Render the actor roster as a compact label.
 * - 3+ actors → first `headLimit` names + "+N more" (e.g. "Aria, Maria,
 *   Atlas, Reyes, +5 more"). Keeps the banner one-line on big runs.
 * - Pair runs → "Aria vs Maria" (legacy leaderA / leaderB only).
 * - Solo or unknown → empty string (caller skips the slot).
 *
 * Exported for unit tests; also used inside ReplayBanner.
 */
export function formatRoster(
  meta: Pick<StoredSessionMeta, 'leaders' | 'leaderA' | 'leaderB'> | null | undefined,
  headLimit = 4,
): string {
  if (!meta) return '';
  const roster = meta.leaders;
  if (Array.isArray(roster) && roster.length >= 3) {
    if (roster.length <= headLimit) return roster.join(', ');
    const head = roster.slice(0, headLimit).join(', ');
    const rest = roster.length - headLimit;
    return `${head}, +${rest} more`;
  }
  if (meta.leaderA && meta.leaderB) return `${meta.leaderA} vs ${meta.leaderB}`;
  if (meta.leaderA) return meta.leaderA;
  if (meta.leaderB) return meta.leaderB;
  return '';
}

/** Shown when the replay session was resolved and the stored event
 *  stream is playing back. Fetches /sessions/:id on mount so the
 *  banner can name which run is replaying instead of just saying
 *  "REPLAYING SAVED DEMO" — viewers were ending up on a replay with
 *  no idea which scenario / leaders / date they were watching. */
export function ReplayBanner({ replaySessionId }: ReplayBannerProps) {
  const [meta, setMeta] = useState<StoredSessionMeta | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/sessions/${encodeURIComponent(replaySessionId)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { meta?: StoredSessionMeta };
        if (!cancelled && data?.meta) setMeta(data.meta);
      } catch {
        /* network blip — leave meta null and show the generic banner. */
      }
    })();
    return () => { cancelled = true; };
  }, [replaySessionId]);

  const headline = meta?.title || meta?.scenarioName || 'saved run';
  const subline: string[] = [];
  if (meta) {
    if (meta.scenarioName) subline.push(meta.scenarioName);
    // Roster slot: "Aria, Maria, Atlas, Reyes, +5 more" for n>=3,
    // "Aria vs Maria" for pair runs, nothing when neither is known.
    // The +N-more cap keeps the banner one-line on a 30-actor run.
    const rosterLabel = formatRoster(meta);
    if (rosterLabel) subline.push(rosterLabel);
    if (typeof meta.turnCount === 'number' && meta.turnCount > 0) subline.push(`${meta.turnCount} turns`);
    if (typeof meta.totalCostUSD === 'number' && meta.totalCostUSD > 0) subline.push(`$${meta.totalCostUSD.toFixed(2)}`);
    if (typeof meta.eventCount === 'number' && meta.eventCount > 0) subline.push(`${meta.eventCount} events`);
    if (meta.createdAt) subline.push(formatTimestamp(meta.createdAt));
  }
  // Seed prompt teaser — first ~140 chars on its own line so the user
  // can see WHAT they prompted, not just "saved run · 292 events". Only
  // populated when the run came out of compile-from-seed.
  const seedTeaser = meta?.seedText
    ? meta.seedText.length > 140
      ? `${meta.seedText.slice(0, 140).trim()}…`
      : meta.seedText.trim()
    : null;
  return (
    <div role="status" className={styles.activeBanner}>
      <span>
        <strong className={styles.activeBannerHeadline}>REPLAYING</strong>
        <span className={styles.activeBannerSubline}>· {headline}</span>
        {subline.length > 0 && (
          <span className={styles.activeBannerSubline}> · {subline.join(' · ')}</span>
        )}
        <span className={styles.activeBannerCacheTag}>· cached playback (no new LLM cost)</span>
        {seedTeaser && (
          <span className={styles.activeBannerSeed}>
            “{seedTeaser}”
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => {
          // Drop the ?replay= query, return to live mode. Preserves
          // the rest of the URL (tab, etc) so users return to where
          // they were; the popstate handler in useReplaySessionId
          // re-reads the param and useSSE re-subscribes to /events.
          const url = new URL(window.location.href);
          url.searchParams.delete('replay');
          window.history.pushState({}, '', url.toString());
          window.dispatchEvent(new PopStateEvent('popstate'));
        }}
        className={styles.exitButton}
      >
        EXIT REPLAY
      </button>
    </div>
  );
}

/** Shown when the ?replay= id no longer exists in the 10-run server
 *  cache (evicted, or URL was mistyped). Clicking "Back to live mode"
 *  drops the query param and reloads into the live /events feed. */
export function ReplayNotFoundBanner({ replaySessionId }: ReplayBannerProps) {
  return (
    <div role="alert" className={styles.notFoundBanner}>
      <span>
        <strong className={styles.notFoundLabel}>REPLAY NOT FOUND</strong>{' '}
        · The saved run <code>{replaySessionId}</code> no longer exists. It may have been evicted from the 10-run cache, or the URL was mistyped.
      </span>
      <button
        type="button"
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('replay');
          window.history.replaceState({}, '', url.toString());
          window.location.reload();
        }}
        className={styles.returnButton}
      >
        ← Back to live mode
      </button>
    </div>
  );
}
