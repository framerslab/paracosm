/**
 * The actor picker's pure parts: which actors a search finds, the order a
 * sort puts them in, whether the run's actors could be read, and what
 * Select shown and a choice leave chosen.
 *
 * Pure functions: no DOM and no React, so they run under node:test.
 */
import type { ActorSummary } from '../../hooks/useToolRegistry';

/** The picker's three orders: the run's launch order, most tools first, most forges that did not pass first. */
export type PickerSort = 'run' | 'tools' | 'didNotPass';

export const PICKER_SORTS: readonly PickerSort[] = ['run', 'tools', 'didNotPass'];

/** A slot label as typed: "A" and digits, in any case. */
const SLOT_QUERY = /^a(\d+)$/i;

/**
 * The actors a search finds, in the order given. A query of "A" and digits
 * matches that slot label exactly, so "A1" finds A1 and not A10 to A19; any
 * other query matches a name or an archetype that holds it, ignoring case.
 * An empty query finds every actor.
 */
export function matchActors(actors: ActorSummary[], query: string): ActorSummary[] {
  const q = query.trim();
  if (q === '') return actors;
  const slot = SLOT_QUERY.exec(q);
  if (slot) {
    const label = `A${Number.parseInt(slot[1], 10)}`;
    return actors.filter((actor) => actor.label === label);
  }
  const lower = q.toLowerCase();
  return actors.filter((actor) => actor.name.toLowerCase().includes(lower) || actor.archetype.toLowerCase().includes(lower));
}

/**
 * The actors in a sort's order: the run's launch order, or the most tools or
 * the most forges that did not pass first, actors with the same count in
 * launch order. Returns a new list.
 */
export function sortActors(actors: ActorSummary[], sort: PickerSort): ActorSummary[] {
  const byRun = (a: ActorSummary, b: ActorSummary): number => a.index - b.index;
  const sorted = [...actors];
  if (sort === 'tools') return sorted.sort((a, b) => b.counts.tools - a.counts.tools || byRun(a, b));
  if (sort === 'didNotPass') return sorted.sort((a, b) => b.counts.didNotPass - a.counts.didNotPass || byRun(a, b));
  return sorted.sort(byRun);
}

/** Whether the picker can list the run's actors: a run that holds tools but no actor could not be read. */
export function pickerState(actors: ActorSummary[], tools: number): 'ready' | 'error' {
  return tools > 0 && actors.length === 0 ? 'error' : 'ready';
}

/**
 * Select shown: the actors chosen, with every actor the search shows added
 * in the order shown, up to `max` chosen in all when a max is given.
 */
export function selectShown(chosen: ReadonlySet<number>, shown: readonly ActorSummary[], max?: number): Set<number> {
  const next = new Set(chosen);
  for (const actor of shown) {
    if (max !== undefined && next.size >= max) break;
    next.add(actor.index);
  }
  return next;
}

/**
 * The actors a choice narrows the toolbox to, by launch index in launch
 * order, or null when it narrows nothing: no actor chosen, or every actor
 * of the run. Indexes the run lacks are left out.
 */
export function pickedActors(chosen: readonly number[], actorCount: number): number[] | null {
  const picked = [...new Set(chosen)].filter((i) => Number.isInteger(i) && i >= 0 && i < actorCount).sort((a, b) => a - b);
  return picked.length === 0 || picked.length >= actorCount ? null : picked;
}
