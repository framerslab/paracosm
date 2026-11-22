import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameState, ActorSideState } from '../../hooks/useGameState.js';
import { humanizeOutcome } from './humanize-outcome.js';
import styles from './TurnBanner.module.scss';

interface TurnBannerProps {
  state: GameState;
  currentTurn: number;
  /**
   * Where the per-actor lines stand when not in the banner: on a phone, an
   * element below the living grid inside the grid's own scroll window, so
   * opening the lines never shrinks the grid's window. The banner keeps the
   * headline and the key that folds the lines.
   */
  linesTarget?: HTMLElement | null;
  /**
   * Whether the cohort grid is on screen, so the "+N more" line can point to
   * it; when it is not (the Focus pair view of a larger run), the line names
   * the view that shows every actor.
   */
  cohortGridShown?: boolean;
}

interface LeaderTurnSummary {
  actorName: string;
  decision: string;
  outcome: string;
  deaths: number;
  dominantCause: string | null;
  /** The deaths under `dominantCause` alone, when the turn names its causes. */
  dominantDeaths?: number;
  moraleDelta: number;
  eventTitle: string;
  eventCategory: string;
  time: number;
}

/**
 * One commander's line for a turn, from what the engine sends: the page folds
 * each `decision_made` into the `outcome` after it as `_decision`, the
 * outcome's `systemDeltas.morale` is the morale its decision moved, and the
 * turn's `turn_done` names the causes of its deaths (`deathCauses`), with
 * `systems_snapshot.deaths` as the count when no cause is named. The line
 * carries the total and, beside the largest cause, that cause's own count.
 */
function summarize(side: ActorSideState, turn: number): LeaderTurnSummary | null {
  const actorName = side.leader?.name ?? '';
  if (!actorName) return null;

  let decision = '';
  let outcome = '';
  let causes: Record<string, number> | null = null;
  let snapshotDeaths = 0;
  let moraleDelta = 0;
  let eventTitle = '';
  let eventCategory = '';
  let time = 0;

  for (const evt of side.events) {
    const t = (evt.data?.turn as number | undefined) ?? -1;
    if (t !== turn + 1) continue;
    if (evt.type === 'turn_start' || evt.type === 'event_start') {
      eventTitle = String(evt.data?.title ?? eventTitle);
      eventCategory = String(evt.data?.category ?? eventCategory);
      time = Number(evt.data?.time ?? time);
    }
    if (evt.type === 'outcome') {
      outcome = String(evt.data?.outcome ?? outcome);
      const folded = evt.data?._decision;
      if (typeof folded === 'string' && folded.length > 0) decision = folded;
      const morale = (evt.data?.systemDeltas as Record<string, unknown> | undefined)?.morale;
      if (typeof morale === 'number' && Number.isFinite(morale)) moraleDelta += morale;
    }
    if (evt.type === 'turn_done') {
      const named = evt.data?.deathCauses;
      if (named && typeof named === 'object') causes = named as Record<string, number>;
    }
    if (evt.type === 'systems_snapshot') {
      snapshotDeaths = Number(evt.data?.deaths) || 0;
    }
  }

  // The cause with the most deaths, the first named on a tie, and how many
  // of the turn's deaths are its own: a turn often has several causes.
  let deaths = snapshotDeaths;
  let dominantCause: string | null = null;
  let dominantDeaths: number | undefined;
  if (causes) {
    let named = 0;
    let most = 0;
    for (const [cause, n] of Object.entries(causes)) {
      if (typeof n !== 'number' || n <= 0) continue;
      named += n;
      if (n > most) { most = n; dominantCause = cause; }
    }
    if (named > 0) {
      deaths = named;
      dominantDeaths = most;
    }
  }

  return { actorName, decision, outcome, deaths, dominantCause, dominantDeaths, moraleDelta, eventTitle, eventCategory, time };
}

/**
 * The title the banner leads with on a turn: the first actor's, in run
 * order, whose turn names one. The banner is drawn only when there is one,
 * so the play controls know whether the turn's time stands above them.
 */
export function turnHeadline(state: GameState, currentTurn: number): string {
  for (const actorId of state.actorIds) {
    const side = state.actors[actorId];
    const title = side ? summarize(side, currentTurn)?.eventTitle : '';
    if (title) return title;
  }
  return '';
}

// Cap on inline humanized lines in the banner. Past this many actors
// the per-actor lines fall off and we render a "+N more" footer that points
// to the rest instead, keeping the banner under one screen.
const MAX_INLINE_OUTCOMES = 6;

/**
 * Banner above the grid: turn number, time, event title + category,
 * and one humanized outcome line per leader. Generated from existing
 * events only; no LLM call. Scales to N actors: pair runs render the
 * original two-line layout, cohort runs render up to
 * `MAX_INLINE_OUTCOMES` lines and trail with a count chip for the rest
 * so the banner stays under a screen on large cohort runs.
 */
export function TurnBanner({ state, currentTurn, linesTarget, cohortGridShown = true }: TurnBannerProps) {
  // Cohort runs (3+ actors) render all per-actor outcome lines which
  // can eat 6+ rows of vertical space on the viz tab, squeezing the
  // cohort grid below to just its column headers with the bodies
  // clipped. Default the per-actor block to collapsed for cohort runs
  // so the headline stays visible without crowding the grid; pair runs
  // keep the expanded default since two lines never crowd the layout.
  const isCohortDefault = state.actorIds.length > 2;
  const [collapsed, setCollapsed] = useState(isCohortDefault);

  const summaries = useMemo(() => {
    const out: Array<{ actorId: string; summary: LeaderTurnSummary | null }> = [];
    for (const actorId of state.actorIds) {
      const side = state.actors[actorId];
      out.push({ actorId, summary: side ? summarize(side, currentTurn) : null });
    }
    return out;
  }, [state.actorIds, state.actors, currentTurn]);

  const populated = summaries.filter((entry): entry is { actorId: string; summary: LeaderTurnSummary } => entry.summary !== null);
  const headline = populated.find(p => p.summary.eventTitle)?.summary.eventTitle || '';
  const category = populated.find(p => p.summary.eventCategory)?.summary.eventCategory || '';
  const time = populated.find(p => p.summary.time)?.summary.time || 0;

  if (!headline) return null;

  const visible = populated.slice(0, MAX_INLINE_OUTCOMES);
  const hidden = populated.length - visible.length;
  const showLines = !collapsed;
  const canCollapse = populated.length > 0;

  const lines = showLines ? (
    <>
      {visible.map((entry, idx) => (
        <div
          key={entry.actorId}
          // For 2-actor pair runs, keep the legacy `.lineA` / `.lineB`
          // class names so the existing SCSS gradient/color rules still
          // apply. Cohort runs use the generic `.line` class which
          // styles with --actor-color (set by the per-row chip below).
          className={populated.length <= 2 ? (idx === 0 ? styles.lineA : styles.lineB) : styles.line}
        >
          <span className={styles.lineLabel}>
            {populated.length <= 2 ? (idx === 0 ? 'A' : 'B') : entry.summary.actorName}
          </span>
          <span className={styles.lineBody}>: {humanizeOutcome(entry.summary)}</span>
        </div>
      ))}
      {hidden > 0 && (
        <div className={styles.lineMore}>
          +{hidden} more {'\u00b7'} {cohortGridShown
            ? `see cohort grid ${linesTarget ? 'above' : 'below'} for the rest`
            : `open All ${state.actorIds.length} actors for the rest`}
        </div>
      )}
    </>
  ) : null;

  return (
    <div role="status" aria-label="Current turn narrative" className={styles.banner}>
      <div className={styles.headline}>
        <span className={styles.turnLabel}>T{currentTurn + 1}{time ? ` \u00b7 ${time}` : ''}</span>
        <span className={styles.title}>{headline}</span>
        {category && <span className={styles.categoryPill}>{category}</span>}
        {canCollapse && (
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand per-actor outcomes' : 'Collapse per-actor outcomes'}
            className={styles.collapseBtn}
          >
            {collapsed ? `\u25be ${populated.length} actors` : '\u25b4 hide'}
          </button>
        )}
      </div>
      {lines && (linesTarget ? createPortal(lines, linesTarget) : lines)}
    </div>
  );
}
