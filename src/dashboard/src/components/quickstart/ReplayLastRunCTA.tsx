/**
 * Compact "Replay last successful run" affordance shown above the
 * loaded-scenario CTA on the Quickstart input phase. Reads the page's
 * saved-run list (`/sessions`, the auto-saved replayable session ring,
 * shared with Load Prior Run and the Run menu) and surfaces a one-click
 * link to the replay surface (`?replay=<sessionId>`) when there's a
 * recent saved session. The list refreshes when a run's save lands, so a
 * run saved while Quickstart stays mounted shows here without a reload.
 * Renders nothing when there's no eligible session — no visual noise on
 * a fresh install.
 *
 * Why /sessions and not /api/v1/runs: the replay query parameter is
 * resolved against the session store (server-app `/sessions/:id/replay`),
 * not the run-history table. A run-record id is NOT a session id, so an
 * earlier version of this CTA produced "Run replay" clicks that landed
 * on a 404 SSE stream and silently did nothing.
 *
 * Replay infrastructure already exists: `useReplaySessionId` reads the
 * query param, `App.tsx` switches the SSE source to
 * `/sessions/<id>/replay`, and `ReplayBanner` advertises the mode.
 * This component is just the CTA that hands off into it.
 *
 * @module paracosm/dashboard/quickstart/ReplayLastRunCTA
 */
import * as React from 'react';
import { useSessions } from '../../hooks/useSessions';
import { buildReplayHref } from '../layout/LoadMenu.helpers';
import { formatRoster } from '../layout/ReplayBanner';
import styles from './ReplayLastRunCTA.module.scss';

void React;

export function ReplayLastRunCTA() {
  // `sessions` is newest-first, as the server's listSessions returns it.
  const { sessions } = useSessions();
  const session = sessions[0]?.id ? sessions[0] : null;

  if (!session) return null;
  const href = typeof window !== 'undefined'
    ? buildReplayHref(window.location.href, session.id)
    : `?replay=${encodeURIComponent(session.id)}`;
  // Prefer the LLM-generated narrative title; fall back through the
  // scenario name, leader pair, or seed-prompt teaser so the CTA never
  // shows just a UUID. The seed teaser is the most informative fallback
  // for compile-from-seed runs that haven't titled yet.
  const seedTeaser = session.seedText
    ? session.seedText.length > 70
      ? `${session.seedText.slice(0, 70).trim()}…`
      : session.seedText.trim()
    : null;
  // Roster fallback: for 3+ actor runs we want "Aria, Maria, Atlas, +5
  // more" instead of "Aria vs Maria" (which silently dropped the other
  // 7 actors on a 9-leader run). formatRoster handles both shapes plus
  // the +N-more cap. Empty string when neither leaders nor leaderA/B
  // are populated, in which case we fall through to seedTeaser/id.
  const rosterLabel = formatRoster(session, 3);
  const subtitle =
    session.title ||
    session.scenarioName ||
    rosterLabel ||
    seedTeaser ||
    session.id;
  const meta = [
    session.scenarioName && session.scenarioName !== subtitle ? session.scenarioName : null,
    typeof session.eventCount === 'number' ? `${session.eventCount} events` : null,
    typeof session.durationMs === 'number' ? `${Math.round(session.durationMs / 1000)}s` : null,
    typeof session.createdAt === 'number' ? new Date(session.createdAt).toISOString().slice(0, 10) : null,
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' · ');

  return (
    <a className={styles.card} href={href} aria-label={`Replay last run: ${subtitle}`}>
      <span className={styles.eyebrow}>Replay last run</span>
      <span className={styles.row}>
        <span className={styles.actor}>{subtitle}</span>
        <span className={styles.arrow} aria-hidden="true">▶</span>
      </span>
      {meta && <span className={styles.meta}>{meta}</span>}
    </a>
  );
}
