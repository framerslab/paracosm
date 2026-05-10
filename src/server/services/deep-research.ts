/**
 * Quickstart "Ground with citations" stage. Takes a freshly-compiled
 * ScenarioPackage and runs it through a small batch of Serper web
 * searches, returning citations the actor-generation + run prompts
 * can ground against. The goal is "the simulation is informed by real
 * sources" rather than "every claim cites a footnote" — we surface 3-5
 * citations per derived query, deduplicated by URL.
 *
 * Why Serper rather than the wilds-ai deep-research stack: Serper is a
 * plain HTTPS POST + JSON response and has no internal-package
 * dependencies (no Cohere reranker, no Tavily, no Firecrawl). Paracosm
 * already has SERPER_API_KEY in .env, so this works without new deps.
 * The wilds-ai stack is preferable when reranking quality matters
 * (game-design research, lore enrichment), but for a 4-second grounding
 * pass a single search provider is enough — the LLM judge that consumes
 * citations will weight them by reading the snippets.
 *
 * @module paracosm/cli/server/deep-research
 */
import type { ScenarioPackage } from '../../engine/types.js';

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/search';

/** Identifier for the search provider that surfaced a given result.
 *  Lets the UI render a per-source provider chip and lets the
 *  grounding pass dedupe across providers. */
export type SearchProvider = 'serper' | 'tavily' | 'firecrawl';

export interface SerperResult {
  /** Result title from the search provider. */
  title: string;
  /** Canonical URL of the source. */
  link: string;
  /** Free-text snippet, usually 100-200 chars. */
  snippet: string;
  /** Optional date string, present for news-style results. */
  date?: string;
  /** Origin domain (e.g. "wikipedia.org"); derived from `link`. */
  domain: string;
  /** Which provider surfaced this result. Surfaced in the citation
   *  log so the demo viewer sees parallel-provider grounding. */
  provider: SearchProvider;
}

export interface GroundingCitation {
  /** Query that surfaced this result. Useful for showing the user
   *  WHY a particular source was attached. */
  query: string;
  /** Top results for that query (deduplicated by URL across queries). */
  sources: SerperResult[];
}

export interface GroundingProgressEvent {
  /** Phase tag drives the log-line tone in the Quickstart card. */
  kind: 'query_started' | 'query_done' | 'query_failed' | 'complete';
  /** Query string. Populated for query_started/query_done/query_failed. */
  query?: string;
  /** Result count. Populated for query_done/complete. */
  resultCount?: number;
  /** Total citations collected so far. Populated for query_done/complete. */
  totalCitations?: number;
  /** Error message. Populated for query_failed. */
  error?: string;
  /** Wall-clock ms since the grounding pass started. */
  elapsedMs: number;
}

export interface GroundingResult {
  /** Per-query citation buckets. */
  citations: GroundingCitation[];
  /** Total unique sources across all queries. */
  totalSources: number;
  /** Wall-clock duration of the grounding pass in ms. */
  durationMs: number;
  /** Queries that returned 0 results or failed. Used to surface gaps. */
  emptyQueries: string[];
  /** Providers that successfully returned at least one result on at
   *  least one query. Surfaced as a chip row in the Quickstart card so
   *  the demo viewer sees which sources backed the run. */
  providersUsed: SearchProvider[];
  /** Providers that errored out for every query (e.g. Firecrawl when
   *  the account is out of credits). Logged as warn lines so the user
   *  knows why a provider didn't contribute. */
  providersFailed: Array<{ provider: SearchProvider; reason: string }>;
}

/**
 * Derive 3 search queries from the ScenarioPackage. We pick the
 * scenario's primary subject (compiled from the seed text), one
 * department-or-context query, and one crisis-flavored query so the
 * citations cover the world's setting + people + threats. Queries are
 * generic enough that Serper finds Wikipedia/news/research links
 * rather than Twitter or random forums.
 */
export function deriveGroundingQueries(scenario: ScenarioPackage): string[] {
  const queries: string[] = [];
  const subject = scenario.labels?.name || scenario.id || 'simulation scenario';
  queries.push(subject);

  // Department or context query: pick the first department label that
  // looks domain-ish (avoid generic "Operations", "Leadership"). Falls
  // back to the settlement noun + the scenario subject when no
  // departments survive the filter.
  const dept = (scenario.departments ?? [])
    .map((d) => d.label || d.id)
    .find((label) => !!label && label.length > 4 && !/operations|leadership|admin/i.test(label));
  if (dept) {
    queries.push(`${dept} best practices`);
  } else if (scenario.labels?.settlementNoun) {
    queries.push(`${scenario.labels.settlementNoun} ${subject}`);
  }

  // Crisis-flavored query so the run's stress-test events have
  // grounding. EventDefinition is the closest thing to a "crisis" in
  // ScenarioPackage; we pick the first event label that isn't a generic
  // "decision" / "outcome" wrapper.
  const eventLabel = (scenario.events ?? [])
    .map((e) => e.label)
    .find((label) => !!label && !/decision|outcome|notice/i.test(label));
  if (eventLabel) {
    queries.push(`${eventLabel} response strategies`);
  } else {
    queries.push(`${subject} crisis decision making`);
  }

  return [...new Set(queries.filter(Boolean))].slice(0, 3);
}

/** Extract the registrable domain (host minus leading "www.") from a URL. */
function urlDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface SerperRawResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

interface FirecrawlRawResult {
  title?: string;
  url?: string;
  description?: string;
}

/**
 * One Serper search. Returns up to `maxResults` results. Throws on
 * network/parse errors so the caller can mark the query as failed
 * in its progress log; never returns null/undefined.
 */
export async function searchSerper(
  query: string,
  apiKey: string,
  maxResults = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<SerperResult[]> {
  const res = await fetchImpl(SERPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: maxResults }),
  });
  if (!res.ok) {
    throw new Error(`Serper HTTP ${res.status}: ${await res.text().catch(() => '<no body>')}`);
  }
  const body = (await res.json()) as { organic?: SerperRawResult[] };
  const organic = body.organic ?? [];
  return organic
    .filter((r): r is SerperRawResult & { title: string; link: string } =>
      typeof r.title === 'string' && typeof r.link === 'string')
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title,
      link: r.link,
      snippet: typeof r.snippet === 'string' ? r.snippet : '',
      date: typeof r.date === 'string' ? r.date : undefined,
      domain: urlDomain(r.link),
      provider: 'serper' as const,
    }));
}

/**
 * One Tavily search. Tavily ships its own AI-summarized results so
 * the snippets are denser than Serper's. Auth is body-based
 * (api_key field) rather than header — we use the modern body shape.
 */
export async function searchTavily(
  query: string,
  apiKey: string,
  maxResults = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<SerperResult[]> {
  const res = await fetchImpl(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });
  if (!res.ok) {
    throw new Error(`Tavily HTTP ${res.status}: ${await res.text().catch(() => '<no body>')}`);
  }
  const body = (await res.json()) as { results?: TavilyRawResult[] };
  const results = body.results ?? [];
  return results
    .filter((r): r is TavilyRawResult & { title: string; url: string } =>
      typeof r.title === 'string' && typeof r.url === 'string')
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title,
      link: r.url,
      snippet: typeof r.content === 'string' ? r.content : '',
      date: typeof r.published_date === 'string' ? r.published_date : undefined,
      domain: urlDomain(r.url),
      provider: 'tavily' as const,
    }));
}

/**
 * One Firecrawl search. Currently disabled in the grounding pass
 * because the production account is out of credits (HTTP 402). Kept
 * for completeness so the grounding helper can light up Firecrawl
 * automatically once credits are topped up — no code change required.
 */
export async function searchFirecrawl(
  query: string,
  apiKey: string,
  maxResults = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<SerperResult[]> {
  const res = await fetchImpl(FIRECRAWL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit: maxResults }),
  });
  if (!res.ok) {
    throw new Error(`Firecrawl HTTP ${res.status}: ${await res.text().catch(() => '<no body>')}`);
  }
  const body = (await res.json()) as { data?: FirecrawlRawResult[] };
  const data = body.data ?? [];
  return data
    .filter((r): r is FirecrawlRawResult & { title: string; url: string } =>
      typeof r.title === 'string' && typeof r.url === 'string')
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title,
      link: r.url,
      snippet: typeof r.description === 'string' ? r.description : '',
      domain: urlDomain(r.url),
      provider: 'firecrawl' as const,
    }));
}

/**
 * Run the grounding pass for a scenario. For each derived query, fans
 * out to every configured search provider (Serper, Tavily, Firecrawl)
 * in parallel, dedupes by URL across providers + queries, and emits
 * progress callbacks for the Quickstart UI.
 *
 * Provider selection: every provider whose API key is non-empty is
 * tried. A provider that fails on every query (e.g. Firecrawl HTTP 402
 * when out of credits) is reported in `providersFailed` rather than
 * crashing the whole pass — the run continues with whatever providers
 * are healthy.
 *
 * Returns null only when ALL providers are missing API keys; otherwise
 * returns a result that may be partially-populated.
 */
export async function groundScenario(
  scenario: ScenarioPackage,
  options: {
    serperApiKey?: string;
    tavilyApiKey?: string;
    firecrawlApiKey?: string;
    maxResultsPerQuery?: number;
    onProgress?: (event: GroundingProgressEvent) => void;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<GroundingResult | null> {
  const serperKey = options.serperApiKey ?? process.env.SERPER_API_KEY ?? '';
  const tavilyKey = options.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? '';
  const firecrawlKey = options.firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY ?? '';
  if (!serperKey && !tavilyKey && !firecrawlKey) return null;

  const maxPerQuery = options.maxResultsPerQuery ?? 4;
  const fetchImpl = options.fetchImpl ?? fetch;

  const t0 = Date.now();
  const queries = deriveGroundingQueries(scenario);
  const seenUrls = new Set<string>();
  const citations: GroundingCitation[] = [];
  const emptyQueries: string[] = [];

  // Track per-provider success/failure across all queries so we can
  // surface providersUsed / providersFailed at the end. We treat a
  // provider as "used" when it returned at least one result for any
  // query, "failed" when it errored on every query that asked it.
  const providerSucceededAtLeastOnce = new Set<SearchProvider>();
  const providerFailureMessages = new Map<SearchProvider, string>();
  const providerCallCount = new Map<SearchProvider, number>();
  const providerFailureCount = new Map<SearchProvider, number>();

  type ProviderCall = {
    provider: SearchProvider;
    fn: () => Promise<SerperResult[]>;
  };

  const providersForQuery = (q: string): ProviderCall[] => {
    const calls: ProviderCall[] = [];
    if (serperKey) {
      calls.push({ provider: 'serper', fn: () => searchSerper(q, serperKey, maxPerQuery, fetchImpl) });
    }
    if (tavilyKey) {
      calls.push({ provider: 'tavily', fn: () => searchTavily(q, tavilyKey, maxPerQuery, fetchImpl) });
    }
    if (firecrawlKey) {
      calls.push({ provider: 'firecrawl', fn: () => searchFirecrawl(q, firecrawlKey, maxPerQuery, fetchImpl) });
    }
    return calls;
  };

  await Promise.all(
    queries.map(async (q) => {
      options.onProgress?.({
        kind: 'query_started',
        query: q,
        elapsedMs: Date.now() - t0,
      });
      const calls = providersForQuery(q);
      const settled = await Promise.allSettled(calls.map((c) => c.fn()));
      const merged: SerperResult[] = [];
      for (let i = 0; i < calls.length; i += 1) {
        const { provider } = calls[i];
        const result = settled[i];
        providerCallCount.set(provider, (providerCallCount.get(provider) ?? 0) + 1);
        if (result.status === 'fulfilled') {
          if (result.value.length > 0) providerSucceededAtLeastOnce.add(provider);
          merged.push(...result.value);
        } else {
          providerFailureCount.set(provider, (providerFailureCount.get(provider) ?? 0) + 1);
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          providerFailureMessages.set(provider, msg);
        }
      }
      // Dedup by URL across providers and prior queries so a Wikipedia
      // hit that appears on both Serper + Tavily is shown once. The
      // surviving copy is the first one we saw; later copies could
      // theoretically merge metadata but the simple-first-wins rule
      // is what the UI expects.
      const deduped = merged.filter((r) => {
        if (seenUrls.has(r.link)) return false;
        seenUrls.add(r.link);
        return true;
      });
      if (deduped.length === 0) emptyQueries.push(q);
      citations.push({ query: q, sources: deduped });
      options.onProgress?.({
        kind: 'query_done',
        query: q,
        resultCount: deduped.length,
        totalCitations: seenUrls.size,
        elapsedMs: Date.now() - t0,
      });
    }),
  );

  // A provider is "failed" iff it was called for every query and
  // failed every call. A provider that hit credits-exhausted on the
  // first query and was therefore tried again on the second / third
  // (and failed there too) gets reported. A provider that succeeded
  // even once goes into providersUsed instead.
  const providersFailed: Array<{ provider: SearchProvider; reason: string }> = [];
  for (const [provider, fails] of providerFailureCount.entries()) {
    if (providerSucceededAtLeastOnce.has(provider)) continue;
    const calls = providerCallCount.get(provider) ?? 0;
    if (calls > 0 && fails === calls) {
      providersFailed.push({
        provider,
        reason: providerFailureMessages.get(provider) ?? 'unknown',
      });
    }
  }

  const result: GroundingResult = {
    citations,
    totalSources: seenUrls.size,
    durationMs: Date.now() - t0,
    emptyQueries,
    providersUsed: [...providerSucceededAtLeastOnce],
    providersFailed,
  };
  options.onProgress?.({
    kind: 'complete',
    totalCitations: seenUrls.size,
    elapsedMs: result.durationMs,
  });
  return result;
}
