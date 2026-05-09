/**
 * Pure helpers used by the Reports tab components. Kept React-free and
 * DOM-free so they can be exercised under node:test without a browser.
 *
 * @module paracosm/dashboard/reports/shared
 */
import type { GameState } from '../../hooks/useGameState';

export type OutcomeKey =
  | 'conservative_success'
  | 'conservative_failure'
  | 'risky_success'
  | 'risky_failure';

/** Four known outcome keys map to matching Badge colors; unknown falls back. */
export function outcomeColor(outcome: string | undefined): string {
  switch (outcome) {
    case 'conservative_success': return 'var(--green)';
    case 'risky_success':        return 'var(--amber)';
    case 'conservative_failure': return 'var(--rust-dim, var(--rust))';
    case 'risky_failure':        return 'var(--rust)';
    default:                     return 'var(--text-3)';
  }
}

/** Shared when both sides ran the same first event title, divergent otherwise. */
export function classifyTurn(
  aFirstTitle: string | undefined,
  bFirstTitle: string | undefined,
): 'shared' | 'divergent' {
  if (!aFirstTitle || !bFirstTitle) return 'divergent';
  return aFirstTitle === bFirstTitle ? 'shared' : 'divergent';
}

/** Series shape consumed by MetricSparklines. */
export interface MetricSeries {
  id: 'population' | 'morale' | 'foodMonthsReserve' | 'powerKw' | 'infrastructureModules' | 'scienceOutput';
  label: string;
  unit?: string;
  a: Array<{ turn: number; value: number }>;
  b: Array<{ turn: number; value: number }>;
}

const METRIC_DEFS: Array<{ id: MetricSeries['id']; label: string; unit?: string }> = [
  { id: 'population',             label: 'Population' },
  { id: 'morale',                 label: 'Morale' },
  { id: 'foodMonthsReserve',      label: 'Food',    unit: 'mo' },
  { id: 'powerKw',                label: 'Power',   unit: 'kW' },
  { id: 'infrastructureModules',  label: 'Modules' },
  { id: 'scienceOutput',          label: 'Science' },
];

/** Walk events for one side, pulling (turn, value) pairs for one metric. */
function seriesForSide(
  events: Array<{ turn?: number; data: Record<string, unknown> }>,
  metricId: MetricSeries['id'],
): Array<{ turn: number; value: number }> {
  const out: Array<{ turn: number; value: number }> = [];
  const seenTurn = new Set<number>();
  for (const ev of events) {
    const metrics = ev.data?.metrics as Record<string, number> | undefined;
    if (!metrics || typeof ev.turn !== 'number') continue;
    const value = metrics[metricId];
    if (typeof value !== 'number') continue;
    if (seenTurn.has(ev.turn)) {
      // Latest snapshot for the turn wins (turn_done overwrites turn_start).
      const idx = out.findIndex(p => p.turn === ev.turn);
      if (idx >= 0) out[idx] = { turn: ev.turn, value };
      continue;
    }
    seenTurn.add(ev.turn);
    out.push({ turn: ev.turn, value });
  }
  return out;
}

/**
 * Build the six-metric series for the chosen pair of actors. The
 * ReportView pair-picker (3+ actor runs) drives `aId` / `bId`; for
 * 2-actor runs the caller passes actorIds[0] / actorIds[1] directly so
 * the legacy callsite shape doesn't change.
 */
export function collectMetricSeries(
  state: GameState,
  aId?: string | null,
  bId?: string | null,
): MetricSeries[] {
  const firstId = aId ?? state.actorIds[0];
  const secondId = bId ?? state.actorIds[1];
  const aEvents = (firstId ? state.actors[firstId]?.events : undefined) as Array<{ turn?: number; data: Record<string, unknown> }> | undefined;
  const bEvents = (secondId ? state.actors[secondId]?.events : undefined) as Array<{ turn?: number; data: Record<string, unknown> }> | undefined;
  return METRIC_DEFS.map(def => ({
    id: def.id,
    label: def.label,
    unit: def.unit,
    a: aEvents ? seriesForSide(aEvents, def.id) : [],
    b: bEvents ? seriesForSide(bEvents, def.id) : [],
  }));
}

export interface RunStripCell {
  turn: number;
  time?: number;
  diverged: boolean;
  a: { title?: string; outcome?: string; category?: string };
  b: { title?: string; outcome?: string; category?: string };
}

/** Build a cell per turn from the existing `turns` map ReportView already derives. */
export function collectRunStripData(
  turns: Array<[number, {
    a: { time?: number; events: Map<number, { title?: string; outcome?: string; category?: string }> };
    b: { time?: number; events: Map<number, { title?: string; outcome?: string; category?: string }> };
  }]>,
): RunStripCell[] {
  return turns.map(([turnNum, sides]) => {
    const aFirst = sides.a.events.get(0);
    const bFirst = sides.b.events.get(0);
    return {
      turn: turnNum,
      time: sides.a.time ?? sides.b.time,
      diverged: classifyTurn(aFirst?.title, bFirst?.title) === 'divergent',
      a: { title: aFirst?.title, outcome: aFirst?.outcome, category: aFirst?.category },
      b: { title: bFirst?.title, outcome: bFirst?.outcome, category: bFirst?.category },
    };
  });
}
