/** The fields of a turn snapshot's cell that say who is on the roster. */
export interface RosterCell {
  agentId: string;
  alive: boolean;
  /** Age at the snapshot's turn. Older saved runs may not carry it. */
  age?: number;
}

/**
 * Who was born and who died between two turn snapshots. A person new to
 * the roster is a birth only as a child (a grown one was hired), and a
 * person gone from the roster left: a death stays on it, marked not alive.
 */
export function rosterChanges<T extends RosterCell>(
  prev: readonly T[],
  curr: readonly T[],
): { born: T[]; died: T[] } {
  const before = new Map(prev.map(c => [c.agentId, c]));
  const born = curr.filter(c => !before.has(c.agentId) && c.alive && !((c.age ?? 0) >= 18));
  const died = curr.filter(c => before.get(c.agentId)?.alive === true && !c.alive);
  return { born, died };
}
