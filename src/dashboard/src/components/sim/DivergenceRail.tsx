import * as React from 'react';
import type { GameState } from '../../hooks/useGameState';
import { computeTurnDiff, type TurnDiffClass } from './turn-diff.js';
import styles from './DivergenceRail.module.scss';

void React;

interface DivergenceRailProps {
  state: GameState;
}

const PILL_LABEL: Record<TurnDiffClass, string> = {
  'same': 'Same event, same outcome',
  'different-outcome': 'Same event, different outcome',
  'different-event': 'Different events',
  'pending': 'Turn is still running',
  'one-sided': 'Only one leader has reached this turn',
};

const PILL_GLYPH: Record<TurnDiffClass, string> = {
  'same': '✓',
  'different-outcome': '⚠',
  'different-event': '⚠',
  'pending': '…',
  'one-sided': '·',
};

const PILL_CLASS: Record<TurnDiffClass, keyof typeof styles> = {
  'same': 'same',
  'different-outcome': 'differentOutcome',
  'different-event': 'differentEvent',
  'pending': 'pending',
  'one-sided': 'oneSided',
};

/**
 * Per-turn divergence mini-map. One pill per past turn, color-keyed
 * to the diff classification, click to smooth-scroll the TurnGrid to
 * that row. Replaces the previous single-current-turn banner.
 */
export function DivergenceRail({ state }: DivergenceRailProps) {
  const firstId = state.actorIds[0];
  const secondId = state.actorIds[1];
  const a = firstId ? state.actors[firstId] : null;
  const b = secondId ? state.actors[secondId] : null;
  if (!a || !b) return null;

  const diffMap = computeTurnDiff(a.events, b.events);
  if (diffMap.size === 0) return null;
  const turns = [...diffMap.keys()];

  const handlePillClick = (turn: number) => {
    const el = document.getElementById(`turn-row-${turn}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div aria-label="Per-turn divergence map" className={styles.rail}>
      <span className={styles.heading}>DIVERGENCE</span>
      <div className={styles.pills}>
        {turns.map(t => {
          const entry = diffMap.get(t)!;
          const cls = PILL_CLASS[entry.classification];
          return (
            <button
              key={t}
              type="button"
              className={`${styles.pill} ${styles[cls]}`}
              onClick={() => handlePillClick(t)}
              aria-label={`Jump to turn ${t} — ${PILL_LABEL[entry.classification]}`}
              title={PILL_LABEL[entry.classification]}
            >
              <span className={styles.pillGlyph} aria-hidden="true">{PILL_GLYPH[entry.classification]}</span>
              <span className={styles.pillTurn}>T{t}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
