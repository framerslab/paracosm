/**
 * The research search both search paths run: the compiler's seed ingestion
 * and the department agents' web_search tool.
 *
 * AgentOS's WebSearchService fans a query out to every provider with a key,
 * merges the results and fuses their ranks. It reranks them only when it is
 * built with a RerankerService and a rerank chain; `search(query, { rerank })`
 * can turn a configured reranker off but never turns one on. So the Cohere
 * reranker is built here whenever a Cohere key is present.
 *
 * @module paracosm/engine/provider/web-search
 */
import type { EnrichedSearchResult, WebSearchConfig } from '@framers/agentos/cognition/web-search';
import type { RerankerService as RerankerServiceType } from '@framers/agentos/cognition/rag/reranking';

/** The resolved keys, after the caller has read its explicit values and env. */
export interface ResolvedSearchKeys {
  firecrawlKey?: string;
  tavilyKey?: string;
  serperKey?: string;
  braveKey?: string;
  cohereKey?: string;
}

/** One search's results and whether Cohere reordered them. */
export interface ResearchSearchResult {
  results: EnrichedSearchResult[];
  /** True only when the Cohere stage ran and returned; a failed rerank leaves the fused order and says false. */
  reranked: boolean;
}

/** Runs one search at a time: a search reads the rerank stages its own call ran. */
export interface ResearchSearch {
  /** True when at least one search provider has a key. */
  hasProviders(): boolean;
  search(query: string, maxResults: number): Promise<ResearchSearchResult>;
}

/**
 * Build the search service for one set of keys. Throws when the AgentOS
 * web-search module cannot load, so callers keep their direct-Serper fallback.
 */
export async function createResearchSearch(keys: ResolvedSearchKeys): Promise<ResearchSearch> {
  const { WebSearchService, FirecrawlProvider, TavilyProvider, SerperProvider, BraveProvider } =
    await import('@framers/agentos/cognition/web-search');

  // The stages the last rerank ran, read from the chunk metadata the
  // RerankerService writes. WebSearchService drops that metadata from its
  // results, and a failed stage hands the fused order back unchanged.
  let lastStages: string[] = [];
  let reranker: WebSearchConfig | undefined;
  if (keys.cohereKey) {
    try {
      const { RerankerService, CohereReranker } = await import('@framers/agentos/cognition/rag/reranking');
      class ReportingReranker extends RerankerService {
        override async rerankChain(...[query, chunks, stages]: Parameters<RerankerServiceType['rerankChain']>) {
          // WebSearchService reranks after slicing to maxResults; each
          // stage keeps every result it is handed, so Cohere reorders and
          // drops nothing (and is never asked for more than it was sent).
          const out = await super.rerankChain(query, chunks, stages.map(stage => ({ ...stage, topK: chunks.length })));
          const ran = out[0]?.metadata?._rerankerChainStages;
          lastStages = typeof ran === 'string' && ran ? ran.split(',') : [];
          return out;
        }
      }
      const cohere = new ReportingReranker({ config: { providers: [{ providerId: 'cohere' }], defaultProviderId: 'cohere' } });
      cohere.registerProvider(new CohereReranker({ providerId: 'cohere', apiKey: keys.cohereKey }));
      // The stage's topK is replaced on each call above.
      reranker = { reranker: cohere, rerankChain: [{ provider: 'cohere', topK: 1 }] };
    } catch (err) {
      console.log(`  [search] Cohere reranker unavailable, searching without it: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const service = new WebSearchService(reranker);
  if (keys.firecrawlKey) service.registerProvider(new FirecrawlProvider(keys.firecrawlKey));
  if (keys.tavilyKey) service.registerProvider(new TavilyProvider(keys.tavilyKey));
  if (keys.serperKey) service.registerProvider(new SerperProvider(keys.serperKey));
  if (keys.braveKey) service.registerProvider(new BraveProvider(keys.braveKey));

  return {
    hasProviders: () => service.hasProviders(),
    async search(query, maxResults) {
      lastStages = [];
      const results = await service.search(query, { maxResults, rerank: !!reranker });
      const reranked = lastStages.includes('cohere');
      if (reranker && !reranked && results.length > 0) {
        console.log(`  [search] Cohere rerank did not run for "${query.slice(0, 80)}"; results keep the fused order`);
      }
      return { results, reranked };
    },
  };
}
