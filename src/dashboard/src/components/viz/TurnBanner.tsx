import { useMemo } from 'react';
import type { GameState, ActorSideState } from '../../hooks/useGameState.js';
import { humanizeOutcome } from './humanize-outcome.js';
import styles from './TurnBanner.module.scss';

interface TurnBannerProps {
  state: GameState;
  currentTurn: number;
}

interface LeaderTurnSummary {
  actorName: string;
  decision: string;
  outcome: string;
  deaths: number;
  dominantCause: string | null;
  moraleDelta: number;
  eventTitle: string;
  eventCategory: string;
  time: number;
}

function summarize(side: ActorSideState, turn: number): LeaderTurnSummary | null {
  const actorName = side.leader?.name ?? '';
  if (!actorName) return null;

  let decision = '';
  let outcome = '';
  let deaths = 0;
  let dominantCause: string | null = null;
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
    if (evt.type === 'decision_made') {
      decision = String(evt.data?.decision ?? decision);
    }
    if (evt.type === 'outcome') {
      outcome = String(evt.data?.outcome ?? outcome);
      deaths = Number(evt.data?.deaths ?? deaths);
      dominantCause = (evt.data?.dominantCause as string | undefined) ?? dominantCause;
      moraleDelta = Number(evt.data?.moraleDelta ?? moraleDelta);
    }
  }

  return { actorName, decision, outcome, deaths, dominantCause, moraleDelta, eventTitle, eventCategory, time };
}

// Cap on inline humanized lines in the banner. Past this many actors
// the per-actor lines fall off and we render a "+N more \u2014 see cohort
// grid below" footer instead, keeping the banner under one screen.
const MAX_INLINE_OUTCOMES = 6;

/**
 * Banner above the grid: turn number, time, event title + category,
 * and one humanized outcome line per leader. Generated from existing
 * events only; no LLM call. Scales to N actors: pair runs render the
 * original two-line layout, cohort runs render up to
 * `MAX_INLINE_OUTCOMES` lines and trail with a count chip for the rest
 * so the banner stays under a screen on large cohort runs.
 */
export function TurnBanner({ state, currentTurn }: TurnBannerProps) {
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

  return (
    <div role="status" aria-label="Current turn narrative" className={styles.banner}>
      <div className={styles.headline}>
        <span className={styles.turnLabel}>T{currentTurn + 1}{time ? ` \u00b7 ${time}` : ''}</span>
        <span className={styles.title}>{headline}</span>
        {category && <span className={styles.categoryPill}>{category}</span>}
      </div>
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
          +{hidden} more \u00b7 see cohort grid below for the rest
        </div>
      )}
    </div>
  );
}
