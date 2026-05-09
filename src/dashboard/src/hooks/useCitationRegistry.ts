import { useMemo, createContext, useContext } from 'react';
import type { GameState } from './useGameState';

export interface CitationEntry {
  n: number;
  text: string;
  url: string;
  doi?: string;
  /** Departments that referenced this citation. */
  departments: Set<string>;
  /** Leaders (by name) that referenced it, used for divergence display. */
  actorNames: Set<string>;
}

export interface CitationRegistry {
  /** Look up the global number for a citation URL. Returns 0 if unknown. */
  getNumber: (url: string) => number;
  /** Lookup the entry directly. */
  getEntry: (url: string) => CitationEntry | undefined;
  /** Full list ordered by first-seen. */
  list: CitationEntry[];
}

const EMPTY_REGISTRY: CitationRegistry = {
  getNumber: () => 0,
  getEntry: () => undefined,
  list: [],
};

/**
 * Build a deduplicated, numbered citation registry from the simulation
 * SSE events. Citations from specialist_done payloads are keyed by URL (or by
 * text if URL is missing). Earlier-seen citations get lower numbers.
 *
 * The same registry is consumed by:
 *   1. Inline citation pills inside EventCard / specialist_done — render as `[N]`
 *   2. The References section at the bottom of SimView / ReportView
 *
 * This keeps inline density low while still giving readers a single place
 * to scan all sources at the end of the report.
 */
export function useCitationRegistry(state: GameState): CitationRegistry {
  return useMemo(() => {
    const byKey = new Map<string, CitationEntry>();
    const list: CitationEntry[] = [];
    let next = 1;

    for (const actorName of state.actorIds) {
      const sideState = state.actors[actorName];
      if (!sideState) continue;
      for (const evt of sideState.events) {
        if (evt.type !== 'specialist_done') continue;
        const dept = String(evt.data?.department || '');
        const cites = (evt.data?.citationList as Array<{ text?: string; url?: string; doi?: string }>) || [];
        for (const c of cites) {
          const url = (c.url || '').trim();
          const text = (c.text || '').trim();
          if (!url && !text) continue;
          if (!url && text === 'Seed document') continue;
          const key = url || `text:${text}`;
          let entry = byKey.get(key);
          if (!entry) {
            entry = {
              n: next++,
              text: text || url,
              url,
              doi: c.doi,
              departments: new Set(),
              actorNames: new Set(),
            };
            byKey.set(key, entry);
            list.push(entry);
          }
          if (dept) entry.departments.add(dept);
          entry.actorNames.add(actorName);
          if (!entry.doi && c.doi) entry.doi = c.doi;
        }
      }
    }

    return {
      getNumber: (url: string) => {
        if (!url) return 0;
        const entry = byKey.get(url) || byKey.get(`text:${url}`);
        return entry?.n ?? 0;
      },
      getEntry: (url: string) => byKey.get(url) || byKey.get(`text:${url}`),
      list,
    };
  }, [state]);
}

export const CitationRegistryContext = createContext<CitationRegistry>(EMPTY_REGISTRY);

export function useCitationContext(): CitationRegistry {
  return useContext(CitationRegistryContext);
}
