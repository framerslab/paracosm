/**
 * Alias legacy pre-0.5.0 event/result field names to their 0.5.0
 * equivalents on read. Pure function, never mutates input structure
 * beyond the aliasing (input events are shallow-cloned; their `data`
 * object gets a shallow copy and then new keys added).
 *
 * Migration rules:
 *   - event.type 'colony_snapshot'  rewrites to 'systems_snapshot'
 *   - event.data.colony             aliases to event.data.metrics
 *   - event.data.colonyDeltas       aliases to event.data.systemDeltas
 *   - result.leader.colony          aliases to result.leader.unit
 *
 * Never clobbers a new-key value with an old-key value. A consumer
 * that writes both keys gets the new one preserved.
 *
 * @module paracosm/dashboard/hooks/migrateLegacyEventShape
 */

interface LooseEvent {
  type: string;
  leader?: string;
  turn?: number;
  time?: number;
  data?: Record<string, unknown>;
}

interface LooseResult {
  leader?: {
    name?: string;
    archetype?: string;
    colony?: string;
    unit?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

interface MigrationOutput {
  events: LooseEvent[];
  results?: LooseResult[];
}

/**
 * Migrate a legacy (pre-0.5.0) event stream + results array to the
 * 0.5.0 shape. Safe to call on already-migrated data — no-op when no
 * legacy keys are found.
 */
export function migrateLegacyEventShape(
  events: LooseEvent[],
  results?: LooseResult[],
): MigrationOutput {
  const migratedEvents: LooseEvent[] = events.map((e) => {
    const type = e.type === 'colony_snapshot' ? 'systems_snapshot' : e.type;
    if (!e.data) return { ...e, type };
    const data: Record<string, unknown> = { ...e.data };
    if (data.colony !== undefined && data.metrics === undefined) {
      data.metrics = data.colony;
    }
    if (data.colonyDeltas !== undefined && data.systemDeltas === undefined) {
      data.systemDeltas = data.colonyDeltas;
    }
    return { ...e, type, data };
  });

  const migratedResults: LooseResult[] | undefined = results?.map((r) => {
    if (!r.leader) return r;
    if (r.leader.colony !== undefined && r.leader.unit === undefined) {
      return { ...r, leader: { ...r.leader, unit: r.leader.colony } };
    }
    return r;
  });

  return {
    events: migratedEvents,
    ...(migratedResults !== undefined ? { results: migratedResults } : {}),
  };
}
