/**
 * Cohort-aware verdict helpers. The single-winner verdict is the wrong
 * shape for 3+ actor runs — the user wants to know which actors are
 * top quartile vs bottom quartile, which actors aren't dominated by
 * anyone (the pareto front), and how much each actor deviates from
 * the cohort median across multiple metrics.
 *
 * Three pure analyses, kept outside the React component so the math
 * is unit-testable without a DOM:
 *
 * - quartileRanking: split actors into Q4 (top 25%) / Q2-Q3 (middle
 *   50%) / Q1 (bottom 25%) on a single metric, with direction-aware
 *   "better is more" / "better is less" semantics.
 * - paretoFront: actors not dominated by any other across the supplied
 *   metric vector. An actor dominates another if it is at-least-as-
 *   good on every metric AND strictly better on at least one.
 * - medianBenchmark: the cohort median for a metric plus the signed
 *   per-actor delta from that median.
 *
 * @module paracosm/dashboard/reports/cohort-verdict-helpers
 */

import type { ActorRow } from '../sim/actor-table.helpers';

export type Direction = 'higher' | 'lower';

export type Metric = 'morale' | 'population' | 'deaths' | 'tools' | 'turn';

/** Whether a higher or lower value is "better" per metric. */
export const METRIC_DIRECTION: Record<Metric, Direction> = {
  morale: 'higher',
  population: 'higher',
  deaths: 'lower',
  tools: 'higher',
  turn: 'higher',
};

export interface QuartileRanking {
  metric: Metric;
  direction: Direction;
  /** Rows that landed in the top 25% (Q4 if direction=higher; Q1 if
   *  direction=lower). The pill label says "top quartile" either way
   *  — direction handles the comparator. */
  top: ActorRow[];
  /** Middle 50% — interquartile range. */
  middle: ActorRow[];
  /** Rows in the worst 25%. */
  bottom: ActorRow[];
  /** Median value (Type-7 quantile, p=0.5). */
  median: number;
}

/** Type-7 quantile — same convention as numpy / R default. v MUST be
 *  sorted ascending. */
function quantile(v: number[], p: number): number {
  if (v.length === 0) return 0;
  if (v.length === 1) return v[0];
  const idx = Math.max(0, Math.min(1, p)) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return v[lo];
  const frac = idx - lo;
  return v[lo] * (1 - frac) + v[hi] * frac;
}

function metricValue(row: ActorRow, m: Metric): number {
  switch (m) {
    case 'morale':     return row.morale;
    case 'population': return row.population;
    case 'deaths':     return row.deaths;
    case 'tools':      return row.tools;
    case 'turn':       return row.turn;
  }
}

/**
 * Bucket actors into top / middle / bottom quartiles for a metric.
 * `direction='higher'` puts the highest values into `top`;
 * `'lower'` puts the lowest into `top` (e.g. fewest deaths).
 */
export function quartileRanking(rows: ActorRow[], metric: Metric, direction?: Direction): QuartileRanking {
  const dir: Direction = direction ?? METRIC_DIRECTION[metric];
  if (rows.length === 0) {
    return { metric, direction: dir, top: [], middle: [], bottom: [], median: 0 };
  }
  const values = rows.map(r => metricValue(r, metric));
  const sortedAsc = [...values].sort((a, b) => a - b);
  const q1 = quantile(sortedAsc, 0.25);
  const q3 = quantile(sortedAsc, 0.75);
  const median = quantile(sortedAsc, 0.5);
  const top: ActorRow[] = [];
  const middle: ActorRow[] = [];
  const bottom: ActorRow[] = [];
  // Degenerate case: q1 === q3 means there's no spread (every actor
  // tied, or only 1 distinct value above/below the median). Without
  // this guard the inclusive comparisons below would put every
  // actor in BOTH top AND bottom — meaningless. Treat as no clear
  // ranking and bucket everyone into middle.
  const noSpread = q1 === q3;
  for (const r of rows) {
    if (noSpread) { middle.push(r); continue; }
    const v = metricValue(r, metric);
    if (dir === 'higher') {
      // Strict comparators on the boundaries: only values STRICTLY
      // beyond q3 land in top, STRICTLY below q1 in bottom. Boundary
      // values (v === q3 or v === q1) sit in middle. This avoids
      // double-counting when multiple actors tie at the threshold.
      if (v > q3)      top.push(r);
      else if (v < q1) bottom.push(r);
      else             middle.push(r);
    } else {
      if (v < q1)      top.push(r);
      else if (v > q3) bottom.push(r);
      else             middle.push(r);
    }
  }
  return { metric, direction: dir, top, middle, bottom, median };
}

/**
 * Compute the pareto front across a vector of metrics. Each metric
 * carries its own direction. Actor A dominates actor B iff A is at
 * least as good on every metric AND strictly better on at least one.
 * The pareto front is the set of actors not dominated by any other.
 *
 * Returns `{ frontIds, dominationCount }` where frontIds are the
 * row IDs on the front (no duplicates, original order preserved) and
 * dominationCount[id] is how many other actors a given row dominates
 * (a quick "depth" signal — higher = more clearly winning).
 */
export interface ParetoResult {
  frontIds: string[];
  dominationCount: Record<string, number>;
}

export function paretoFront(rows: ActorRow[], metrics: Metric[]): ParetoResult {
  if (rows.length === 0 || metrics.length === 0) {
    return { frontIds: [], dominationCount: {} };
  }
  // Direction-aware "is A at least as good as B" comparator per metric.
  const aleAB = (a: ActorRow, b: ActorRow, m: Metric): boolean => {
    const va = metricValue(a, m);
    const vb = metricValue(b, m);
    return METRIC_DIRECTION[m] === 'higher' ? va >= vb : va <= vb;
  };
  const strictlyBetter = (a: ActorRow, b: ActorRow, m: Metric): boolean => {
    const va = metricValue(a, m);
    const vb = metricValue(b, m);
    return METRIC_DIRECTION[m] === 'higher' ? va > vb : va < vb;
  };
  const dominates = (a: ActorRow, b: ActorRow): boolean => {
    let anyStrict = false;
    for (const m of metrics) {
      if (!aleAB(a, b, m)) return false;
      if (strictlyBetter(a, b, m)) anyStrict = true;
    }
    return anyStrict;
  };
  const dominationCount: Record<string, number> = {};
  for (const r of rows) dominationCount[r.id] = 0;
  for (const a of rows) {
    for (const b of rows) {
      if (a.id === b.id) continue;
      if (dominates(a, b)) dominationCount[a.id]++;
    }
  }
  // Pareto front: actors NOT dominated by any other.
  const frontIds: string[] = [];
  for (const a of rows) {
    let dominated = false;
    for (const b of rows) {
      if (a.id === b.id) continue;
      if (dominates(b, a)) { dominated = true; break; }
    }
    if (!dominated) frontIds.push(a.id);
  }
  return { frontIds, dominationCount };
}

/**
 * Median benchmark: the cohort median of a metric and per-actor
 * signed delta-from-median. `direction` reverses the sign so a
 * positive delta always reads as "better than median" — for
 * deaths (lower is better), an actor with fewer deaths than the
 * median has a positive delta in the returned table.
 */
export interface MedianBenchmark {
  metric: Metric;
  median: number;
  /** Per-actor signed delta-from-median where positive = better
   *  than median. Indexed by row.id. */
  deltas: Record<string, number>;
}

export function medianBenchmark(rows: ActorRow[], metric: Metric): MedianBenchmark {
  if (rows.length === 0) return { metric, median: 0, deltas: {} };
  const values = rows.map(r => metricValue(r, metric));
  const sortedAsc = [...values].sort((a, b) => a - b);
  const median = quantile(sortedAsc, 0.5);
  const deltas: Record<string, number> = {};
  const sign = METRIC_DIRECTION[metric] === 'higher' ? 1 : -1;
  for (const r of rows) {
    // Add 0 to normalize -0 → 0. JS leaves -0 as the result of any
    // signed multiply by 0 (e.g. (5 - 5) * -1), and assert.equal
    // treats -0 / 0 as different values via Object.is. The visible
    // formatting collapses both to "±0" but the underlying data
    // shouldn't carry the negative-zero through to consumers.
    const delta = (metricValue(r, metric) - median) * sign;
    deltas[r.id] = delta + 0;
  }
  return { metric, median, deltas };
}

/** Format a delta for display: `+12` / `-3` / `±0`. */
export function formatDelta(d: number, decimals = 0): string {
  if (Math.abs(d) < 0.5 / Math.pow(10, decimals)) return '±0';
  const fixed = d.toFixed(decimals);
  return d > 0 ? `+${fixed}` : fixed;
}
