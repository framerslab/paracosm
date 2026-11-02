/**
 * Research memory: one per run, made at the run's start and closed at its end.
 *
 * Ingests the citations of a scenario's KnowledgeBundle into an AgentOS memory
 * store of its own. During a run, an event's title and keywords recall the
 * citations they name. Nothing is held at module level: two runs side by side
 * in one process, the two leaders of a pair among them, share no store and no
 * recall cache, and closing one leaves the other untouched.
 *
 * A run whose store cannot open, or a recall after close, reads the run's own
 * bundle by category. A scenario with no citations gets an empty packet.
 */

import type { AgentMemory } from '@framers/agentos';
import type { CrisisResearchPacket } from '../contracts.js';
import type { KnowledgeBundle } from '../../engine/types.js';
import { getResearchFromBundle } from './scenario-research.js';

type Citation = CrisisResearchPacket['canonicalFacts'][number];

/** One run's research. */
export interface ResearchMemory {
  /** The citations an event's words name, with its category's counterpoints and notes. */
  recall(query: string, keywords?: string[], category?: string): Promise<CrisisResearchPacket>;
  /** Close this run's store. Further recalls read this run's bundle. */
  close(): Promise<void>;
}

interface StoredCitation {
  citation: Citation;
  counterpoint: boolean;
  topic: string;
}

/**
 * Each citation in a bundle, keyed by the text the store holds for it: its claim
 * and source. Links stay out of that text, so "mars" in a query does not match
 * every mars.nasa.gov URL.
 */
function citationsByContent(bundle: KnowledgeBundle | undefined): Map<string, StoredCitation> {
  const entries = new Map<string, StoredCitation>();
  const topics: KnowledgeBundle['topics'] = bundle?.topics ?? {};
  const add = (citation: Citation, counterpoint: boolean, topic: string) => {
    entries.set(`${citation.claim} (${citation.source})`, { citation, counterpoint, topic });
  };
  for (const [topic, data] of Object.entries(topics)) {
    for (const f of data.canonicalFacts ?? []) add(f, false, topic);
    for (const c of data.counterpoints ?? []) add(c, true, topic);
  }
  return entries;
}

/**
 * Open a run's research memory from its scenario's knowledge. Never throws:
 * a store that cannot open leaves the run reading its bundle.
 */
export async function createResearchMemory(knowledge?: KnowledgeBundle): Promise<ResearchMemory> {
  const citations = citationsByContent(knowledge);
  let store: AgentMemory | null = null;
  try {
    const { AgentMemory } = await import('@framers/agentos');
    store = await AgentMemory.sqlite({ path: ':memory:' });
    console.log(`  [research-memory] Ingesting ${citations.size} citations from scenario knowledge...`);
    for (const [content, { topic }] of citations) {
      await store.remember(content, { tags: [topic], importance: 0.8 });
    }
    console.log(`  [research-memory] Ready: ${citations.size} citations in memory`);
  } catch (err) {
    console.log(`  [research-memory] Init failed (will read the scenario's bundle): ${err}`);
    if (store) {
      try { await store.close(); } catch { /* a failed store has nothing left to keep */ }
    }
    store = null;
  }

  /**
   * This run's recall results, by `${query}|${keywords}|${category}`: two events
   * with the same words share a packet without another search.
   */
  const recallCache = new Map<string, CrisisResearchPacket>();

  return {
    async recall(query, keywords = [], category = 'infrastructure') {
      if (!store) return getResearchFromBundle(knowledge, category, keywords);

      const cacheKey = `${query}|${keywords.slice(0, 4).join(',')}|${category}`;
      const cached = recallCache.get(cacheKey);
      if (cached) return cached;

      let found: Array<{ content: string }> = [];
      try {
        const result = await store.recall([query, ...keywords.slice(0, 3)].join(' '), { limit: 6 });
        found = result.memories;
      } catch (err) {
        console.log(`  [research-memory] Recall failed (will read the scenario's bundle): ${err}`);
      }

      const fromBundle = getResearchFromBundle(knowledge, category, keywords);
      const facts: Citation[] = [];
      const counterpoints: Citation[] = [];
      for (const memory of found) {
        const entry = citations.get(memory.content);
        if (entry) (entry.counterpoint ? counterpoints : facts).push(entry.citation);
      }
      const recalled = new Set(counterpoints.map(c => c.claim));
      const packet: CrisisResearchPacket = {
        canonicalFacts: facts,
        counterpoints: [...counterpoints, ...fromBundle.counterpoints.filter(c => !recalled.has(c.claim))].slice(0, 3),
        departmentNotes: fromBundle.departmentNotes,
      };
      recallCache.set(cacheKey, packet);
      return packet;
    },

    async close() {
      const closing = store;
      store = null;
      recallCache.clear();
      if (closing) {
        try { await closing.close(); } catch { /* the run is over either way */ }
      }
    },
  };
}
