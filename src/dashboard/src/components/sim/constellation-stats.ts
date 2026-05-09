/**
 * Per-actor stats for the SIM tab's ConstellationView overlay.
 * Walks an actor's events once + reads pre-counted state fields so
 * a 50-actor sim re-rendering at SSE cadence stays under 16ms.
 *
 * @module paracosm/dashboard/sim/constellation-stats
 */
import type { GameState } from '../../hooks/useGameState.js';

export type LatestOutcome = 'success' | 'failure' | 'pending';

export interface NodeStats {
  pop: number | null;
  morale: number | null;
  decisions: number;
  tools: number;
  deaths: number;
  /** Outcome class derived from the most recent `outcome` event. */
  latestOutcome: LatestOutcome;
}

export function extractNodeStats(state: GameState, actorId: string): NodeStats {
  const actor = state.actors[actorId];
  if (!actor) {
    return { pop: null, morale: null, decisions: 0, tools: 0, deaths: 0, latestOutcome: 'pending' };
  }

  // Latest outcome — walk events backwards to find the most recent
  // `outcome` event. Events are appended in turn order, so the last
  // outcome in the array is the most recent.
  let latestOutcome: LatestOutcome = 'pending';
  for (let i = actor.events.length - 1; i >= 0; i--) {
    const e = actor.events[i];
    if (e.type !== 'outcome') continue;
    const raw = String(e.data?.outcome ?? '');
    if (raw.includes('success')) {
      latestOutcome = 'success';
    } else if (raw.includes('failure')) {
      latestOutcome = 'failure';
    }
    // Treat unrecognized outcome strings as pending so the glyph does
    // not assert a verdict the model didn't actually emit.
    break;
  }

  const pop = actor.popHistory.length > 0 ? actor.popHistory[actor.popHistory.length - 1] : null;
  const morale = actor.moraleHistory.length > 0 ? actor.moraleHistory[actor.moraleHistory.length - 1] : null;

  return {
    pop,
    morale,
    decisions: actor.decisions ?? 0,
    tools: actor.tools ?? 0,
    deaths: actor.deaths ?? 0,
    latestOutcome,
  };
}
