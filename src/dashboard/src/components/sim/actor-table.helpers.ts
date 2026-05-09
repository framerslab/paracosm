/**
 * Pure helpers for the ActorTable: row projection from GameState +
 * sort comparator. Kept outside the React component so node:test can
 * exercise the logic without a DOM. The sort surface is what makes
 * 30+ actor runs legible — the user wants to filter by "morale", "
 * deaths", "forges", or "divergence from median" and click into the
 * outliers, not eyeball a horizontal card strip.
 *
 * @module paracosm/dashboard/sim/actor-table-helpers
 */

import type { ActorSideState, GameState } from '../../hooks/useGameState';

export type SortKey =
  | 'name'
  | 'archetype'
  | 'population'
  | 'morale'
  | 'deaths'
  | 'tools'
  | 'turn';

export type SortDir = 'asc' | 'desc';

export interface ActorRow {
  id: string;
  name: string;
  archetype: string;
  population: number;
  morale: number;
  deaths: number;
  tools: number;
  turn: number;
  pending: boolean;
}

/** Pull the most recent value of a numeric history series. */
function lastOf(series: number[]): number {
  return series.length > 0 ? series[series.length - 1] : 0;
}

/**
 * Project a single actor's state into a flat row for the table. The
 * `turn` column is derived from popHistory.length so it reads
 * "current turn the actor has reached" — the diff vs other actors'
 * turn columns surfaces stragglers in batch runs.
 */
export function projectActorRow(id: string, actor: ActorSideState): ActorRow {
  return {
    id,
    name: actor.leader?.name ?? id,
    archetype: actor.leader?.archetype ?? '',
    population: lastOf(actor.popHistory),
    morale: lastOf(actor.moraleHistory),
    deaths: actor.deaths,
    tools: actor.toolNames?.size ?? actor.tools ?? 0,
    turn: actor.popHistory.length,
    pending: !!actor.pendingDecision,
  };
}

export function projectActorRows(state: GameState): ActorRow[] {
  return state.actorIds
    .map((id) => {
      const actor = state.actors[id];
      if (!actor) return null;
      return projectActorRow(id, actor);
    })
    .filter((r): r is ActorRow => r !== null);
}

/**
 * Default sort direction per column. Numeric columns where "more is
 * better" (population, morale, tools, turn) start descending. Numeric
 * columns where "less is better" (deaths) start ascending. Strings
 * start ascending alphabetically.
 */
export function defaultSortDir(key: SortKey): SortDir {
  switch (key) {
    case 'name':
    case 'archetype':
      return 'asc';
    case 'deaths':
      return 'asc';
    case 'population':
    case 'morale':
    case 'tools':
    case 'turn':
      return 'desc';
  }
}

/** Stable comparator. Falls back to actor name to break ties so the
 *  table never reorders on equal values during live SSE updates. */
export function compareRows(a: ActorRow, b: ActorRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  let primary: number;
  switch (key) {
    case 'name':
      primary = a.name.localeCompare(b.name);
      break;
    case 'archetype':
      primary = a.archetype.localeCompare(b.archetype);
      break;
    case 'population':
      primary = a.population - b.population;
      break;
    case 'morale':
      primary = a.morale - b.morale;
      break;
    case 'deaths':
      primary = a.deaths - b.deaths;
      break;
    case 'tools':
      primary = a.tools - b.tools;
      break;
    case 'turn':
      primary = a.turn - b.turn;
      break;
  }
  if (primary !== 0) return primary * sign;
  // Stable tiebreak — always alphabetical by name regardless of dir.
  return a.name.localeCompare(b.name);
}

export function sortRows(rows: ActorRow[], key: SortKey, dir: SortDir): ActorRow[] {
  // Slice before sort so the caller's array (often a useMemo result)
  // is not mutated. ~30 rows max in practice; copy is cheap.
  return [...rows].sort((a, b) => compareRows(a, b, key, dir));
}
