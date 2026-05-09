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

/**
 * Banner above the grid: turn number, time, event title + category,
 * and one humanized outcome line per leader. Generated from existing
 * events only; no LLM call.
 */
export function TurnBanner({ state, currentTurn }: TurnBannerProps) {
  const firstId = state.actorIds[0];
  const secondId = state.actorIds[1];
  const sideA = firstId ? state.actors[firstId] : null;
  const sideB = secondId ? state.actors[secondId] : null;
  const a = useMemo(() => sideA ? summarize(sideA, currentTurn) : null, [sideA, currentTurn]);
  const b = useMemo(() => sideB ? summarize(sideB, currentTurn) : null, [sideB, currentTurn]);

  const headline = a?.eventTitle || b?.eventTitle || '';
  const category = a?.eventCategory || b?.eventCategory || '';
  const time = a?.time || b?.time || 0;

  if (!headline) return null;

  return (
    <div role="status" aria-label="Current turn narrative" className={styles.banner}>
      <div className={styles.headline}>
        <span className={styles.turnLabel}>T{currentTurn + 1}{time ? ` \u00b7 ${time}` : ''}</span>
        <span className={styles.title}>{headline}</span>
        {category && <span className={styles.categoryPill}>{category}</span>}
      </div>
      {a && <div className={styles.lineA}>A: {humanizeOutcome(a)}</div>}
      {b && <div className={styles.lineB}>B: {humanizeOutcome(b)}</div>}
    </div>
  );
}
