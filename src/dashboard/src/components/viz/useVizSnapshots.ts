import { useMemo } from 'react';
import type { GameState } from '../../hooks/useGameState';
import type { TurnSnapshot, CellSnapshot } from './viz-types';

/**
 * Extract per-turn TurnSnapshot arrays from GameState, keyed by leader
 * name. Pulls systems_snapshot events for the spatial cells data and
 * joins event_start / turn_start events to surface category flashes
 * per turn. Population, morale, food and each turn's own births and
 * deaths come from the snapshot payload; water, power and pressurized
 * volume, which a snapshot does not carry, come from the same turn's
 * `turn_done` metrics, so ECOLOGY can draw them on a live run and a
 * replay alike.
 *
 * Return shape is `Record<actorName, TurnSnapshot[]>` — F1 (arena-
 * ready refactor) generalized this away from the old `{ a, b }` pair.
 * Consumers read `snaps[actorIds[0]]` / `snaps[actorIds[1]]` for
 * the current 2-column dashboard; P2's N-column mode uses the full
 * map.
 */
export function useVizSnapshots(state: GameState): Record<string, TurnSnapshot[]> {
  return useMemo(() => buildVizSnapshots(state), [state]);
}

/**
 * The pure body of {@link useVizSnapshots}. The reducer appends one roster
 * to `agentSnapshots` for each `systems_snapshot` event, in order, so the
 * i-th roster pairs with the i-th `systems_snapshot`; its turn number then
 * finds the turn's `turn_done`. A fork resumed after turn k numbers its
 * first snapshot k + 1, which an index-based turn lookup would miss.
 */
export function buildVizSnapshots(state: GameState): Record<string, TurnSnapshot[]> {
  const result: Record<string, TurnSnapshot[]> = {};

  for (const actorName of state.actorIds) {
    const s = state.actors[actorName];
    if (!s) continue;
    result[actorName] = [];

    const categoriesByTurn = new Map<number, string[]>();
    for (const e of s.events) {
      if ((e.type === 'event_start' || e.type === 'turn_start') && e.turn != null) {
        const cat = e.data?.category;
        if (typeof cat === 'string' && cat.length > 0) {
          const list = categoriesByTurn.get(e.turn) ?? [];
          if (!list.includes(cat)) list.push(cat);
          categoriesByTurn.set(e.turn, list);
        }
      }
    }

    const snapshotEvents = s.events.filter(e => e.type === 'systems_snapshot');
    for (let i = 0; i < s.agentSnapshots.length; i++) {
      const agents = s.agentSnapshots[i];
      const turnEvent = snapshotEvents[i];
      const dd = turnEvent?.data || {};
      const turnNum = (dd.turn as number) || i + 1;
      const turnDone = s.events.find(e => e.type === 'turn_done' && e.data?.turn === turnNum);
      const metrics = (turnDone?.data?.metrics ?? {}) as Record<string, unknown>;
      const reading = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

      const cells: CellSnapshot[] = agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        department: a.department,
        role: a.role,
        rank: a.rank,
        alive: a.alive,
        marsborn: a.marsborn,
        psychScore: a.psychScore,
        age: a.age,
        generation: a.generation,
        partnerId: a.partnerId,
        childrenIds: a.childrenIds || [],
        featured: a.featured,
        mood: a.mood,
        shortTermMemory: a.shortTermMemory || [],
      }));

      result[actorName].push({
        turn: turnNum,
        time: (dd.time as number) || 0,
        cells,
        population: (dd.population as number) || cells.filter(c => c.alive).length,
        morale: (dd.morale as number) || 0,
        foodReserve: typeof dd.foodReserve === 'number' ? dd.foodReserve : reading(metrics.foodMonthsReserve),
        waterLitersPerDay: reading(metrics.waterLitersPerDay),
        powerKw: reading(metrics.powerKw),
        pressurizedVolumeM3: reading(metrics.pressurizedVolumeM3),
        deaths: (dd.deaths as number) || 0,
        births: (dd.births as number) || 0,
        eventCategories: categoriesByTurn.get(turnNum) ?? [],
      });
    }
  }

  return result;
}
