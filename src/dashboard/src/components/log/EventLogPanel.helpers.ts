/**
 * Pure helpers for EventLogPanel filtering. DOM / React imports
 * forbidden so the module runs under node:test without a shim.
 *
 * @module paracosm/cli/dashboard/components/log/EventLogPanel.helpers
 */
import type { SimEvent } from '../../hooks/useSSE';

/**
 * Filter state owned by EventLogPanel. Every axis is independently
 * optional; the empty value for each means "do not filter on this
 * axis". {@link applyLogFilters} applies them conjunctively.
 */
export interface LogFilters {
  /** Free-text substring, lower-cased on compare. `''` = no filter. */
  query: string;
  /** Types allowed through. Empty set = all types pass. */
  types: Set<string>;
  /** Specific leader name. `null` = all leaders (and events without a leader). */
  leader: string | null;
  /** Inclusive `[min, max]` turn range. `null` = no range filter. */
  turnRange: [number, number] | null;
  /** Legacy `#log=<substring>` hash filter (tool-name substring). */
  toolHash: string;
}

/** Canonical empty filter — matches every event. */
export function emptyFilters(): LogFilters {
  return {
    query: '',
    types: new Set<string>(),
    leader: null,
    turnRange: null,
    toolHash: '',
  };
}

/**
 * Apply the filter set to the event stream. Returns a new array
 * preserving order. Axes are AND'd together: an event must pass
 * every active filter.
 */
export function applyLogFilters(
  events: SimEvent[],
  filters: LogFilters,
): SimEvent[] {
  const q = filters.query.toLowerCase();
  const typesActive = filters.types.size > 0;
  const hasRange = filters.turnRange !== null;
  const range = filters.turnRange;
  const hash = filters.toolHash.toLowerCase();

  return events.filter((e) => {
    if (typesActive && !filters.types.has(e.type)) return false;

    if (filters.leader !== null) {
      if (e.leader !== filters.leader) return false;
    }

    if (hasRange && range) {
      const t = extractTurn(e);
      if (t === undefined || t < range[0] || t > range[1]) return false;
    }

    if (hash && !matchesToolHash(e, hash)) return false;

    if (q && !matchesQuery(e, q)) return false;

    return true;
  });
}

function extractTurn(e: SimEvent): number | undefined {
  const t = (e.data as Record<string, unknown> | undefined)?.turn;
  return typeof t === 'number' ? t : undefined;
}

function matchesQuery(e: SimEvent, query: string): boolean {
  if (e.type.toLowerCase().includes(query)) return true;
  if (typeof e.leader === 'string' && e.leader.toLowerCase().includes(query)) return true;
  const d = (e.data ?? {}) as Record<string, unknown>;
  for (const key of ['title', 'summary', 'department', 'name'] as const) {
    const v = d[key];
    if (typeof v === 'string' && v.toLowerCase().includes(query)) return true;
  }
  return false;
}

function matchesToolHash(e: SimEvent, substring: string): boolean {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const name = typeof d.name === 'string' ? d.name.toLowerCase() : '';
  if (name && name.includes(substring)) return true;
  const tools = Array.isArray(d.forgedTools) ? d.forgedTools : [];
  for (const t of tools) {
    const tn =
      t && typeof t === 'object' && typeof (t as Record<string, unknown>).name === 'string'
        ? ((t as Record<string, unknown>).name as string).toLowerCase()
        : '';
    if (tn && tn.includes(substring)) return true;
  }
  return false;
}

/**
 * Derive the universe of filter facets from the events currently in
 * view. Used to populate the checkbox list, leader dropdown, and
 * turn-range slider bounds.
 */
export function extractAvailableFacets(events: SimEvent[]): {
  types: string[];
  actors: string[];
  maxTurn: number;
} {
  const types = new Set<string>();
  const actors: string[] = [];
  const seenActors = new Set<string>();
  let maxTurn = 0;
  for (const e of events) {
    if (e.type) types.add(e.type);
    if (typeof e.leader === 'string' && e.leader && !seenActors.has(e.leader)) {
      seenActors.add(e.leader);
      actors.push(e.leader);
    }
    const t = extractTurn(e);
    if (t !== undefined && t > maxTurn) maxTurn = t;
  }
  return {
    types: [...types].sort(),
    actors,
    maxTurn,
  };
}

/**
 * Serialize active filters into a `?key=value&...` query string (no
 * leading `?`). Empty axes are omitted. Values URL-encoded via
 * URLSearchParams. Returns `''` when every axis is empty.
 */
export function serializeFiltersToUrl(filters: LogFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('logQuery', filters.query);
  if (filters.types.size > 0) {
    params.set('logTypes', [...filters.types].join(','));
  }
  if (filters.leader !== null) params.set('logLeader', filters.leader);
  if (filters.turnRange) {
    params.set('logTurnMin', String(filters.turnRange[0]));
    params.set('logTurnMax', String(filters.turnRange[1]));
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

/**
 * Parse filters out of a URL search + hash pair. `search` can include
 * or omit the leading `?`. Hash can include or omit the leading `#`.
 * Returns {@link emptyFilters} when everything is absent.
 */
export function parseFiltersFromUrl(
  search: string,
  hash: string,
): LogFilters {
  const filters = emptyFilters();
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const query = params.get('logQuery');
  if (query) filters.query = query;
  const types = params.get('logTypes');
  if (types) {
    const list = types.split(',').map((s) => s.trim()).filter(Boolean);
    filters.types = new Set(list);
  }
  const leader = params.get('logLeader');
  if (leader) filters.leader = leader;
  const tMin = params.get('logTurnMin');
  const tMax = params.get('logTurnMax');
  if (tMin !== null && tMax !== null) {
    const min = Number(tMin);
    const max = Number(tMax);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      // Normalize so an inverted URL (tMin > tMax) doesn't silently
      // exclude every event — swap into [low, high] order.
      filters.turnRange = [Math.min(min, max), Math.max(min, max)];
    }
  }
  const hashBody = hash.startsWith('#') ? hash.slice(1) : hash;
  const hashMatch = hashBody.match(/(?:^|&)log=([^&]+)/);
  if (hashMatch) {
    try {
      filters.toolHash = decodeURIComponent(hashMatch[1]);
    } catch {
      filters.toolHash = hashMatch[1];
    }
  }
  return filters;
}
