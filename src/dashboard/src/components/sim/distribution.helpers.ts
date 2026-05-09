/**
 * Distribution helpers for the SIM tab. Replaces pairwise A-vs-B
 * thinking with N-way "where does the variance live across actors."
 * Per-turn quantiles (min / Q1 / median / Q3 / max) for any numeric
 * series an actor records (popHistory, moraleHistory, deaths over
 * time, etc). Pure: no React, no DOM — node:test exercises every
 * branch.
 *
 * @module paracosm/dashboard/sim/distribution-helpers
 */

import type { ActorSideState, GameState } from '../../hooks/useGameState';

export interface QuantileBand {
  /** Turn index (1-based). */
  turn: number;
  /** Number of actors that had a value at this turn. */
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export type SeriesPicker = (actor: ActorSideState) => number[];

/**
 * Return v[p] under linear interpolation per the standard
 * "type-7" quantile convention (R default; numpy default). v MUST be
 * already sorted ascending. p in [0,1].
 */
export function linearQuantile(v: number[], p: number): number {
  if (v.length === 0) return 0;
  if (v.length === 1) return v[0];
  const clamped = Math.max(0, Math.min(1, p));
  const idx = clamped * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return v[lo];
  const frac = idx - lo;
  return v[lo] * (1 - frac) + v[hi] * frac;
}

/**
 * Build per-turn quantile bands for the named series across all
 * actors in `state`. Returns one entry per turn that at least one
 * actor reached. Stragglers are not back-filled — `n` carries the
 * count of actors who actually recorded a value at that turn so the
 * caller can render confidence (`n=2` looks different from `n=30`).
 */
export function projectQuantileBands(state: GameState, pick: SeriesPicker): QuantileBand[] {
  // Collect each actor's series, then walk by turn index across them.
  const allSeries: number[][] = state.actorIds
    .map(id => state.actors[id])
    .filter((a): a is ActorSideState => !!a)
    .map(a => pick(a));

  if (allSeries.length === 0) return [];

  const maxTurns = allSeries.reduce((m, s) => Math.max(m, s.length), 0);
  const bands: QuantileBand[] = [];
  for (let t = 0; t < maxTurns; t++) {
    // Gather every actor's value at turn t (skip actors who didn't
    // reach this turn yet — that's how stragglers stay out of the
    // quantile until they catch up).
    const slice: number[] = [];
    for (const s of allSeries) {
      if (s.length > t) slice.push(s[t]);
    }
    if (slice.length === 0) continue;
    const sorted = [...slice].sort((a, b) => a - b);
    bands.push({
      turn: t + 1,
      n: sorted.length,
      min: sorted[0],
      q1: linearQuantile(sorted, 0.25),
      median: linearQuantile(sorted, 0.5),
      q3: linearQuantile(sorted, 0.75),
      max: sorted[sorted.length - 1],
    });
  }
  return bands;
}

/** Convenience pickers for the two series the dashboard renders. */
export const popSeries: SeriesPicker = (a) => a.popHistory;
export const moraleSeries: SeriesPicker = (a) => a.moraleHistory;

/**
 * Map a quantile band to viewport-relative ratios. Caller supplies
 * the y-axis range (lo/hi); helper returns each quantile as a [0,1]
 * fraction so the SVG can scale without knowing the data range.
 */
export interface NormalizedBand {
  turn: number;
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export function normalizeBand(b: QuantileBand, lo: number, hi: number): NormalizedBand {
  const span = hi - lo;
  const frac = (v: number) => (span <= 0 ? 0.5 : (v - lo) / span);
  return {
    turn: b.turn,
    n: b.n,
    min: frac(b.min),
    q1: frac(b.q1),
    median: frac(b.median),
    q3: frac(b.q3),
    max: frac(b.max),
  };
}

/** Find the lo/hi y-axis range across an entire band series. */
export function bandRange(bands: QuantileBand[]): { lo: number; hi: number } {
  if (bands.length === 0) return { lo: 0, hi: 1 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bands) {
    if (b.min < lo) lo = b.min;
    if (b.max > hi) hi = b.max;
  }
  if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 };
  if (lo === hi) {
    // All points equal — pad ±1 so the band has visible height.
    return { lo: lo - 1, hi: hi + 1 };
  }
  return { lo, hi };
}
