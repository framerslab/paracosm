/**
 * Real-World Seed Ingestion
 *
 * Accepts a document (text, markdown, or URL) and uses it to enrich
 * a scenario's knowledge bundle via:
 *
 * 1. LLM extraction: extract entities, facts, and domain knowledge from the seed
 * 2. Optional web search: use AgentOS WebSearchService (Tavily, Firecrawl, Serper, Brave),
 *    reranked by Cohere when COHERE_API_KEY is set, to find real citations grounding the seed material
 * 3. Knowledge bundle assembly: structure extracted + searched knowledge into
 *    KnowledgeBundle format compatible with the ScenarioPackage
 *
 * The web search is emergent: the LLM decides what to search for based on
 * the seed content, not hardcoded queries.
 */

import { fetchPublicUrl, htmlToText } from './public-url-fetch.js';
import type { KnowledgeBundle, KnowledgeCitation, KnowledgeTopic } from '../types.js';
import type { GenerateTextFn } from './types.js';
import {
  searchCredential,
  type SearchCredentialOptions,
} from '../provider/credentials.js';
import { createResearchSearch } from '../provider/web-search.js';

export interface SeedIngestionOptions extends SearchCredentialOptions {
  /** LLM generateText function */
  generateText: GenerateTextFn;
  /** Enable live web search to enrich with real citations. Requires search API keys in env. */
  webSearch?: boolean;
  /** Maximum number of web searches to perform. Default: 5. */
  maxSearches?: number;
  /** Progress callback */
  onProgress?: (step: string, status: 'start' | 'done') => void;
}

interface ExtractedKnowledge {
  /** Domain topics identified in the seed */
  topics: string[];
  /** Key facts extracted */
  facts: Array<{ topic: string; claim: string }>;
  /** Suggested search queries for grounding */
  searchQueries: string[];
  /** Crisis categories relevant to this domain */
  crisisCategories: string[];
}

/**
 * Extract knowledge structure from seed text via LLM.
 */
async function extractFromSeed(seedText: string, generateText: GenerateTextFn): Promise<ExtractedKnowledge> {
  const prompt = `You are analyzing a document to extract domain knowledge for a simulation engine.

DOCUMENT:
${seedText.slice(0, 8000)}

Extract the following as JSON:
{
  "topics": ["list of 3-8 domain topics/themes in this document"],
  "facts": [{"topic": "topic name", "claim": "specific factual claim from the document"}],
  "searchQueries": ["5 web search queries that would find real scientific/technical citations supporting or expanding on this document's claims"],
  "crisisCategories": ["3-6 categories of crises or challenges relevant to this domain"]
}

Focus on extractable, verifiable facts. Search queries should target academic papers, technical reports, and authoritative sources. Return JSON only.`;

  const text = await generateText(prompt);
  let cleaned = text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { topics: [], facts: [], searchQueries: [], crisisCategories: [] };
  }
}

/**
 * Perform web searches using AgentOS WebSearchService.
 * Returns citations organized by query.
 */
async function searchForCitations(
  queries: string[],
  maxSearches: number,
  credentials: SearchCredentialOptions = {},
): Promise<Array<{ query: string; results: Array<{ title: string; url: string; snippet: string }> }>> {
  const searchResults: Array<{ query: string; results: Array<{ title: string; url: string; snippet: string }> }> = [];
  const firecrawlKey = searchCredential(credentials.firecrawlKey, 'FIRECRAWL_API_KEY');
  const tavilyKey = searchCredential(credentials.tavilyKey, 'TAVILY_API_KEY');
  const serperKey = searchCredential(credentials.serperKey, 'SERPER_API_KEY');
  const braveKey = searchCredential(credentials.braveKey, 'BRAVE_API_KEY');

  try {
    const cohereKey = searchCredential(credentials.cohereKey, 'COHERE_API_KEY');
    const service = await createResearchSearch({ firecrawlKey, tavilyKey, serperKey, braveKey, cohereKey });

    if (!service.hasProviders()) {
      console.log('  [seed] No search API keys configured. Skipping web search enrichment.');
      return [];
    }

    const queriesToRun = queries.slice(0, maxSearches);

    for (const query of queriesToRun) {
      try {
        const { results } = await service.search(query, 3);
        searchResults.push({
          query,
          results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
        });
      } catch (err) {
        console.log(`  [seed] Search failed for "${query}": ${err}`);
      }
    }
  } catch {
    // AgentOS web-search module not available, try direct Serper fallback
    if (!serperKey) return [];

    for (const query of queries.slice(0, maxSearches)) {
      try {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 3 }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          searchResults.push({
            query,
            results: (data.organic || []).slice(0, 3).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet })),
          });
        }
      } catch {}
    }
  }

  return searchResults;
}

/**
 * Assemble extracted facts and search results into a KnowledgeBundle.
 */
function assembleKnowledgeBundle(
  extracted: ExtractedKnowledge,
  searchResults: Array<{ query: string; results: Array<{ title: string; url: string; snippet: string }> }>,
): KnowledgeBundle {
  const topics: Record<string, KnowledgeTopic> = {};

  // Group extracted facts by topic
  for (const topicName of extracted.topics) {
    const topicFacts = extracted.facts.filter(f => f.topic === topicName);
    const citations: KnowledgeCitation[] = topicFacts.map(f => ({
      claim: f.claim,
      source: 'Seed document',
      url: '',
    }));

    topics[topicName] = {
      canonicalFacts: citations,
      counterpoints: [],
      departmentNotes: {},
    };
  }

  // Enrich with web search results by matching queries to topics via word overlap
  for (const sr of searchResults) {
    const queryWords = new Set(sr.query.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let bestTopic = extracted.topics[0] || 'general';
    let bestOverlap = 0;
    for (const t of extracted.topics) {
      const topicWords = t.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = topicWords.filter(w => queryWords.has(w)).length;
      // Also check if any query word is a substring of the topic or vice versa
      const substringBonus = topicWords.some(tw => [...queryWords].some(qw => tw.includes(qw) || qw.includes(tw))) ? 1 : 0;
      const score = overlap + substringBonus;
      if (score > bestOverlap) { bestOverlap = score; bestTopic = t; }
    }
    const matchingTopic = bestTopic;

    if (!topics[matchingTopic]) {
      topics[matchingTopic] = { canonicalFacts: [], counterpoints: [], departmentNotes: {} };
    }

    for (const result of sr.results) {
      topics[matchingTopic].canonicalFacts.push({
        claim: result.snippet,
        source: result.title,
        url: result.url,
      });
    }
  }

  // Build category mapping: associate each crisis category with topics that
  // share facts or have overlapping terminology
  const categoryMapping: Record<string, string[]> = {};
  for (const category of extracted.crisisCategories) {
    // Find topics whose facts mention the crisis category, or whose names overlap
    const catLower = category.toLowerCase();
    const relevant = extracted.topics.filter(t => {
      const tLower = t.toLowerCase();
      // Direct name overlap
      if (catLower.includes(tLower) || tLower.includes(catLower)) return true;
      // Topic has facts that mention the category
      return extracted.facts.some(f => f.topic === t && f.claim.toLowerCase().includes(catLower));
    });
    // Fall back to first 2 topics if no specific match
    categoryMapping[category] = relevant.length > 0 ? relevant : extracted.topics.slice(0, 2);
  }

  return { topics, categoryMapping };
}

/**
 * Ingest prompt, brief, or document text and produce a KnowledgeBundle for a scenario.
 *
 * @param seedText - The raw text content of the prompt, brief, or document
 * @param options - Ingestion options (LLM function, web search toggle)
 * @returns A KnowledgeBundle ready to merge into a ScenarioPackage
 */
export async function ingestSeed(
  seedText: string,
  options: SeedIngestionOptions,
): Promise<KnowledgeBundle> {
  const { generateText, webSearch = true, maxSearches = 5, onProgress } = options;

  // Step 1: Extract knowledge from seed
  onProgress?.('extract', 'start');
  const extracted = await extractFromSeed(seedText, generateText);
  onProgress?.('extract', 'done');
  console.log(`  [seed] Extracted ${extracted.topics.length} topics, ${extracted.facts.length} facts, ${extracted.searchQueries.length} search queries`);

  // Step 2: Optional web search enrichment
  let searchResults: Array<{ query: string; results: Array<{ title: string; url: string; snippet: string }> }> = [];
  if (webSearch && extracted.searchQueries.length > 0) {
    onProgress?.('search', 'start');
    searchResults = await searchForCitations(extracted.searchQueries, maxSearches, options);
    onProgress?.('search', 'done');
    const totalCitations = searchResults.reduce((sum, sr) => sum + sr.results.length, 0);
    console.log(`  [seed] Web search found ${totalCitations} citations from ${searchResults.length} queries`);
  }

  // Step 3: Assemble knowledge bundle
  onProgress?.('assemble', 'start');
  const bundle = assembleKnowledgeBundle(extracted, searchResults);
  onProgress?.('assemble', 'done');

  return bundle;
}

/**
 * Ingest from a URL by fetching and extracting content.
 */
export async function ingestFromUrl(
  url: string,
  options: SeedIngestionOptions,
): Promise<KnowledgeBundle> {
  let content: string;

  // Try Firecrawl first for clean markdown extraction
  try {
    const key = searchCredential(options.firecrawlKey, 'FIRECRAWL_API_KEY');
    if (key) {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        content = data.data?.markdown || data.data?.content || '';
        if (content) {
          console.log(`  [seed] Fetched ${content.length} chars from ${url} via Firecrawl`);
          return ingestSeed(content, options);
        }
      }
    }
  } catch {}

  // Fallback to a direct fetch: public addresses only, 15 s and 2 MiB,
  // with the HTML stripped in linear time (public-url-fetch).
  const res = await fetchPublicUrl(url);
  content = htmlToText(res.text);
  console.log(`  [seed] Fetched ${content.length} chars from ${url} via plain fetch`);

  return ingestSeed(content, options);
}
