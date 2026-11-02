/**
 * Research memory: one per run, made at the run's start and closed at its end.
 *
 * Ingests the citations of a scenario's KnowledgeBundle into an AgentOS memory
 * store of its own. During a run, an event's title and keywords recall the
 * citations they name in the event's category. Nothing is held at module level: two runs side by side
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
  /** The citations of an event's category that its words name, with the category's counterpoints and notes. */
  recall(query: string, keywords?: string[], category?: string): Promise<CrisisResearchPacket>;
  /** Close this run's store. Further recalls read this run's bundle. */
  close(): Promise<void>;
}

interface StoredCitation {
  citation: Citation;
  counterpoint: boolean;
  topics: string[];
}

/** How many citations a recall reads before keeping those in the event's category. */
const RECALL_CANDIDATES = 24;
/** How many facts a recalled packet holds. */
const RECALLED_FACTS = 6;

/**
 * Each citation in a bundle, keyed by the text the store holds for it: its claim
 * and source. Links stay out of that text, so "mars" in a query does not match
 * every mars.nasa.gov URL.
 */
function citationsByContent(bundle: KnowledgeBundle | undefined): Map<string, StoredCitation> {
  const entries = new Map<string, StoredCitation>();
  const topics: KnowledgeBundle['topics'] = bundle?.topics ?? {};
  const add = (citation: Citation, counterpoint: boolean, topic: string) => {
    const content = `${citation.claim} (${citation.source})`;
    const held = entries.get(content);
    if (held) held.topics.push(topic);
    else entries.set(content, { citation, counterpoint, topics: [topic] });
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
    for (const [content, { topics }] of citations) {
      await store.remember(content, { tags: topics, importance: 0.8 });
    }
    console.log(`  [research-memory] Ready: ${citations.size} citations in memory`);
  } catch (err) {
    console.log(`  [research-memory] Init failed (will read the scenario's bundle): ${err}`);
    if (store) {
      try { await store.shutdown(); } catch { /* a failed store has nothing left to keep */ }
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
        const result = await store.recall([query, ...keywords.slice(0, 3)].join(' '), { limit: RECALL_CANDIDATES });
        found = result.memories;
      } catch (err) {
        console.log(`  [research-memory] Recall failed (will read the scenario's bundle): ${err}`);
      }

      const fromBundle = getResearchFromBundle(knowledge, category, keywords);
      const facts: Citation[] = [];
      const counterpoints: Citation[] = [];
      // The bundle says which topics an event's category holds. A category it does
      // not map has no such limit, as in the bundle's own search by keywords.
      const categoryTopics = new Set(knowledge?.categoryMapping?.[category] ?? []);
      for (const memory of found) {
        const entry = citations.get(memory.content);
        if (!entry) continue;
        if (categoryTopics.size > 0 && !entry.topics.some(t => categoryTopics.has(t))) continue;
        (entry.counterpoint ? counterpoints : facts).push(entry.citation);
      }
      const recalled = new Set(counterpoints.map(c => c.claim));
      const packet: CrisisResearchPacket = {
        canonicalFacts: facts.slice(0, RECALLED_FACTS),
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
        try { await closing.shutdown(); } catch { /* the run is over either way */ }
      }
    },
  };
}

/** A web search result as the search tool returns it. */
export interface WebSearchResult {
  title?: string;
  snippet?: string;
  url?: string;
}

/** What it takes to choose the research for an emergent event. */
export interface EmergentEventResearch {
  research: ResearchMemory;
  knowledge: KnowledgeBundle | undefined;
  event: { title: string; description: string; category: string; researchKeywords: string[] };
  liveSearch: boolean | undefined;
  /** The run's economics profile's search policy. */
  search?: { mode: 'off' | 'gated' | 'adaptive' | 'aggressive'; maxSearches: number };
  settlementNoun: string;
  webSearch(query: string): Promise<WebSearchResult[]>;
}

/**
 * Choose an emergent event's research. A live search answers when the run's
 * policy asks for one: always on `aggressive`, when recall found fewer than 2
 * facts on `adaptive`, when it found none on `gated`, never on `off`. Otherwise,
 * and when a search finds nothing or fails, the recalled facts answer if there
 * are at least 2, and the scenario's bundle answers if not.
 */
export async function researchEmergentEvent(args: EmergentEventResearch): Promise<CrisisResearchPacket> {
  const { research, knowledge, event, liveSearch, search, settlementNoun, webSearch } = args;
  const memPacket = await research.recall(event.title + ' ' + event.description.slice(0, 100), event.researchKeywords, event.category);
  const recalled = memPacket.canonicalFacts.length;
  const withoutSearch = (): CrisisResearchPacket => {
    if (recalled < 2) return getResearchFromBundle(knowledge, event.category, event.researchKeywords);
    console.log(`  [research] Memory recall: ${recalled} citations`);
    return memPacket;
  };

  const searchMode = search?.mode ?? 'adaptive';
  const allowsSearch =
    liveSearch &&
    event.researchKeywords.length > 0 &&
    (searchMode === 'aggressive' || (searchMode === 'adaptive' && recalled < 2) || (searchMode === 'gated' && recalled === 0));
  if (!allowsSearch) return withoutSearch();

  try {
    const keywordBudget = Math.max(1, Math.min(3, search?.maxSearches ?? 3));
    const query = event.researchKeywords.slice(0, keywordBudget).join(' ') + ' ' + settlementNoun + ' science';
    const results = await webSearch(query);
    if (results.length === 0) return withoutSearch();
    return { canonicalFacts: results.slice(0, 5).map(r => ({ claim: r.snippet || r.title || '', source: r.title || 'web search', url: r.url || '' })), counterpoints: [], departmentNotes: {} };
  } catch (err) {
    console.log(`  [research] Live search failed: ${err}`);
    return withoutSearch();
  }
}
