/**
 * Cohort-grouping helpers for the constellation view. At 3 actors a
 * pairwise edge graph is legible; at 30+ the constellation becomes a
 * hairball of O(N²) edges. Grouping actors by archetype (the
 * coarsest, fastest cluster signal — a leader's `archetype` is a
 * single string set at construction time) lets the user read the
 * distribution at a glance: "8 visionary, 12 engineer, 10
 * pragmatist" instead of staring at 30 indistinguishable nodes.
 *
 * Pure helpers so the projection + counting logic is unit-testable
 * without a DOM.
 *
 * @module paracosm/dashboard/sim/cohort-helpers
 */

import type { GameState } from '../../hooks/useGameState';

export interface Cohort {
  /** Archetype string, normalized (trimmed, no internal collapse). */
  archetype: string;
  /** Display label — defaults to the archetype itself; "Unknown" when
   *  the leader info hasn't arrived from SSE yet. */
  label: string;
  /** Actor IDs in this cohort, in their original actorIds order. */
  ids: string[];
  /** First-seen index — used to keep the cohort order stable across
   *  SSE re-renders. The cohort whose first actor is earliest in
   *  actorIds renders first in the legend. */
  firstIndex: number;
}

const UNKNOWN_LABEL = 'Unknown';

function normalizeArchetype(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.trim();
}

/**
 * Group actors into cohorts by their leader's archetype. Cohorts are
 * returned in first-seen order (cohort containing actorIds[0] first,
 * etc) so the legend doesn't flip on every SSE event.
 */
export function projectCohorts(state: GameState): Cohort[] {
  const cohortByKey = new Map<string, Cohort>();
  state.actorIds.forEach((id, idx) => {
    const actor = state.actors[id];
    const raw = normalizeArchetype(actor?.leader?.archetype);
    const key = raw || '__unknown__';
    const label = raw || UNKNOWN_LABEL;
    const existing = cohortByKey.get(key);
    if (existing) {
      existing.ids.push(id);
    } else {
      cohortByKey.set(key, {
        archetype: raw,
        label,
        ids: [id],
        firstIndex: idx,
      });
    }
  });
  return [...cohortByKey.values()].sort((a, b) => a.firstIndex - b.firstIndex);
}

/**
 * Reorder actor IDs so cohort-mates sit adjacent on the constellation
 * perimeter. Pure: returns a new array; does not mutate input. Useful
 * for the constellation's circular layout — adjacent same-archetype
 * nodes give the eye a chunked visual rhythm at high N. Within each
 * cohort the original actorIds order is preserved (so cohort 0's
 * nodes still appear first, then cohort 1's, etc).
 */
export function reorderByCohort(state: GameState): string[] {
  const cohorts = projectCohorts(state);
  const reordered: string[] = [];
  for (const c of cohorts) reordered.push(...c.ids);
  return reordered;
}

/** Render-friendly summary line: "8 Visionary · 12 Engineer · 10 Pragmatist" */
export function describeCohorts(cohorts: Cohort[]): string {
  return cohorts.map(c => `${c.ids.length} ${c.label}`).join(' · ');
}
