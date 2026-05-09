/**
 * Cohort summary strip that sits above the constellation. At 30+
 * actors the constellation looks like a hairball; the legend tells
 * the user the archetype distribution at a glance and provides
 * click-to-filter targets so they can fade unrelated cohorts on the
 * graph below. v1 is read-only — clicking a cohort emits a callback
 * but the constellation does not yet listen. (Filtering wiring lands
 * in a follow-up.)
 *
 * @module paracosm/dashboard/sim/CohortLegend
 */
import * as React from 'react';
import type { Cohort } from './cohort.helpers';
import styles from './CohortLegend.module.scss';

void React;

export interface CohortLegendProps {
  cohorts: Cohort[];
  /** Optional: id of the currently-focused cohort. Pill renders with
   *  amber highlight when its archetype matches. */
  focusedArchetype?: string | null;
  /** Click handler — receives the cohort archetype string, or null
   *  when the same cohort is clicked twice (toggle off). */
  onFocusChange?: (archetype: string | null) => void;
}

export function CohortLegend({ cohorts, focusedArchetype, onFocusChange }: CohortLegendProps): JSX.Element | null {
  // Below 3 actors the legend adds noise without value — pair runs
  // already show both leader names in the leaders-row above.
  const totalActors = cohorts.reduce((n, c) => n + c.ids.length, 0);
  if (cohorts.length < 2 || totalActors < 3) return null;

  const handleClick = (archetype: string) => {
    if (!onFocusChange) return;
    onFocusChange(focusedArchetype === archetype ? null : archetype);
  };

  return (
    <div className={styles.legend} role="group" aria-label={`Cohort summary: ${cohorts.length} archetypes across ${totalActors} actors`}>
      <span className={styles.heading}>COHORTS</span>
      <div className={styles.pills}>
        {cohorts.map(c => {
          const focused = focusedArchetype === c.archetype && c.archetype !== '';
          const dimmed = focusedArchetype && focusedArchetype !== c.archetype;
          const cls = `${styles.pill} ${focused ? styles.pillFocused : ''} ${dimmed ? styles.pillDimmed : ''}`;
          return (
            <button
              key={c.archetype || '__unknown__'}
              type="button"
              className={cls}
              onClick={() => handleClick(c.archetype)}
              disabled={!onFocusChange}
              aria-pressed={focused}
              aria-label={`${c.label} cohort, ${c.ids.length} actor${c.ids.length === 1 ? '' : 's'}`}
            >
              <span className={styles.pillCount}>{c.ids.length}</span>
              <span className={styles.pillLabel}>{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
