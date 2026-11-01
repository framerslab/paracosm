/**
 * The scenario's header scores as the verdict broadcast carries them in
 * `finalStats.metrics` (one row per score, both leaders' final values).
 * Shared by the verdict card and the report scoreboard so both show the
 * same scores the scenario puts in its dashboard header.
 *
 * @module paracosm/dashboard/sim/verdict-stats
 */

export interface ScenarioStatRow {
  id: string;
  label: string;
  format: 'number' | 'percent' | 'currency' | 'duration';
  better?: 'higher' | 'lower';
  a?: number;
  b?: number;
}

/** The scenario score rows of a pair verdict, or null for a verdict saved before they were sent. */
export function scenarioStatRows(finalStats: unknown): ScenarioStatRow[] | null {
  const rows = (finalStats as { metrics?: unknown } | null | undefined)?.metrics;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const valid = rows.filter((r): r is ScenarioStatRow =>
    typeof r === 'object' && r !== null && typeof (r as ScenarioStatRow).id === 'string');
  return valid.length > 0 ? valid : null;
}

/** A final value in the score's format; a percent score is a fraction shown as a percentage. */
export function formatScenarioStat(v: number | undefined, format: ScenarioStatRow['format']): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'n/a';
  if (format === 'percent') return `${Math.round(v * 1000) / 10}%`;
  if (Number.isInteger(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 0.1) return v.toFixed(2);
  return v.toFixed(3);
}

/** Which side leads on a score, reading the scenario's direction (higher is better by default). */
export function statLeader(a: number, b: number, better?: 'higher' | 'lower'): 'a' | 'b' | null {
  if (a === b) return null;
  const aHigher = a > b;
  return (better === 'lower' ? !aHigher : aHigher) ? 'a' : 'b';
}

/** The stats block title in the scenario's word for the settlement. */
export function finalStatsTitle(settlementNoun: unknown): string {
  const noun = typeof settlementNoun === 'string' && settlementNoun.trim() ? settlementNoun.trim() : 'colony';
  return `FINAL ${noun.toUpperCase()} STATS`;
}
