/**
 * Computes one plain-English sentence per turn describing the largest
 * A-vs-B divergence. Pure function. Deterministic from inputs. The
 * `HighlightStrip` renders the result; SwarmViz wires the inputs from
 * `useVizSnapshots`.
 *
 * Priority order (largest delta wins):
 *   1. Population deaths this turn (mass mortality is the most material
 *      divergence the kernel reports)
 *   2. Morale collapse (≥0.20 absolute gap between A and B)
 *   3. Event-category divergence (different categories on the same turn)
 *   4. "Identical first event" if turn === 1 and categories match
 *   5. Neutral fallback
 *
 * Wording is templated, never LLM-generated; tests pin the substrings
 * each branch produces so a refactor that breaks copy fails loudly.
 *
 * @module viz/viz-highlights
 */
import type { TurnSnapshot } from './viz-types';

/**
 * Per-turn delta input to {@link computeTurnHighlight}. Built from a
 * `(current, prev)` `TurnSnapshot` pair via {@link snapToHighlight}
 * so cumulative `deaths` / `births` fields convert into per-turn
 * counts the highlight templates can read directly.
 */
export interface HighlightInput {
  population: number;
  morale: number;
  deathsThisTurn: number;
  birthsThisTurn: number;
  eventCategories: ReadonlyArray<string>;
  year: number;
}

const MORALE_GAP_THRESHOLD = 0.2;

/**
 * Convert a `TurnSnapshot` (cumulative counters, scenario time-unit) into
 * the {@link HighlightInput} shape (per-turn deltas, surfaced year). When
 * `prev` is undefined the deltas equal the absolute counts on the first
 * turn; the highlight templates handle that case by falling back to the
 * neutral / identical-first-event branches.
 */
export function snapToHighlight(current: TurnSnapshot, prev?: TurnSnapshot): HighlightInput {
  return {
    population: current.population,
    morale: current.morale,
    deathsThisTurn: current.deaths - (prev?.deaths ?? 0),
    birthsThisTurn: current.births - (prev?.births ?? 0),
    eventCategories: current.eventCategories ?? [],
    year: current.time,
  };
}

export function computeTurnHighlight(
  a: HighlightInput | null,
  b: HighlightInput | null,
  turn: number,
): string {
  if (!a || !b) return 'Awaiting first turn snapshot.';
  // `??` instead of `||` so a legitimate year of 0 (synthetic test
  // fixtures, year-zero scenarios) isn't silently overridden by the
  // other side's year.
  const year = a.year ?? b.year;

  // 1. Mass deaths on one side
  if (a.deathsThisTurn !== b.deathsThisTurn) {
    const heavier = a.deathsThisTurn > b.deathsThisTurn ? 'A' : 'B';
    const heavyCount = Math.max(a.deathsThisTurn, b.deathsThisTurn);
    const lightCount = Math.min(a.deathsThisTurn, b.deathsThisTurn);
    const noun = heavyCount === 1 ? 'colonist' : 'colonists';
    return `Turn ${turn}, year ${year}: Leader ${heavier} lost ${heavyCount} ${noun}; the other lost ${lightCount}.`;
  }

  // 2. Morale collapse
  const moraleGap = Math.abs(a.morale - b.morale);
  if (moraleGap >= MORALE_GAP_THRESHOLD) {
    const lower = a.morale < b.morale ? 'A' : 'B';
    const lowerVal = a.morale < b.morale ? a.morale : b.morale;
    const higherVal = a.morale < b.morale ? b.morale : a.morale;
    return `Turn ${turn}, year ${year}: Leader ${lower}'s morale collapsed to ${pct(lowerVal)}; the other held ${pct(higherVal)}.`;
  }

  // 3. Event-category divergence
  const aCats = a.eventCategories.join('|');
  const bCats = b.eventCategories.join('|');
  if (aCats && bCats && aCats !== bCats) {
    return `Turn ${turn}, year ${year}: the leaders faced different events — A: ${a.eventCategories.join(', ')}; B: ${b.eventCategories.join(', ')}.`;
  }

  // 4. Identical first event
  if (turn === 1 && aCats && aCats === bCats) {
    return `Turn 1, year ${year}: identical first event (${a.eventCategories.join(', ')}). Both colonies start from the same state.`;
  }

  // 5. Fallback
  return `Turn ${turn}, year ${year}: A and B tracked closely. See sub-tabs for details.`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
