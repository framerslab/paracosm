/**
 * A present Cohere key reranks the research a run reads.
 *
 * Both search paths built WebSearchService with no reranker, so the
 * `rerank: !!cohereKey` they passed changed nothing: the service reranks only
 * when it holds a RerankerService and a rerank chain. The department agents'
 * web_search tool still reported `reranked: true`. These tests drive the two
 * paths the server runs (the web_search tool and seed ingestion) with the
 * AgentOS search and rerank code as it ships. Serper and Cohere are paid APIs,
 * so their HTTP answers are stubbed at fetch; nothing else is.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearchTool } from '../../../src/runtime/orchestrator/emergent-setup.js';
import { ingestSeed } from '../../../src/engine/compiler/seed-ingestion.js';

const QUERY = 'perchlorate removal from martian regolith for crop growth';

/** Serper's organic results, in Serper's order. */
const ORGANIC = [
  { link: 'https://example.org/a-soil-review', title: 'A: Mars soil review', snippet: 'Overview of basaltic regolith grain size and mineralogy across landing sites.' },
  { link: 'https://example.org/b-greenhouse', title: 'B: Greenhouse lighting', snippet: 'LED spectra tuned for lettuce yield under low pressure enclosures.' },
  { link: 'https://example.org/c-perchlorate', title: 'C: Perchlorate leaching', snippet: 'Washing perchlorate salts out of simulant before planting potatoes and wheat.' },
];

/** Cohere's answer: C first, then A, then B. */
const COHERE_RESULTS = [
  { index: 2, relevance_score: 0.91 },
  { index: 0, relevance_score: 0.42 },
  { index: 1, relevance_score: 0.07 },
];

interface Calls { serper: number; cohere: Array<{ query: string; documents: number }> }

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(cohereStatus = 200): Calls {
  const calls: Calls = { serper: 0, cohere: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://google.serper.dev/search')) {
      calls.serper += 1;
      return new Response(JSON.stringify({ organic: ORGANIC }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/v1/rerank')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.cohere.push({ query: body.query, documents: (body.documents ?? []).length });
      if (cohereStatus !== 200) return new Response('upstream error', { status: cohereStatus });
      return new Response(JSON.stringify({ id: 'r1', results: COHERE_RESULTS, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return calls;
}

async function searchTool(credentials: { serperKey?: string; cohereKey?: string }) {
  const tool = createWebSearchTool(credentials, {});
  const result = await tool.execute({ query: QUERY }, {} as any) as any;
  assert.equal(result.success, true, `web_search failed: ${result.error}`);
  return result.output as { results: Array<{ url: string; relevance: number }>; reranked: boolean };
}

test('web_search with a Cohere key returns the results in Cohere\'s order', async () => {
  const calls = stubFetch();
  const out = await searchTool({ serperKey: 'test-serper', cohereKey: 'test-cohere' });
  assert.equal(calls.cohere.length, 1, 'Cohere rerank is called once per search');
  assert.equal(calls.cohere[0].query, QUERY);
  assert.equal(calls.cohere[0].documents, 3);
  assert.deepEqual(out.results.map(r => r.url), [ORGANIC[2].link, ORGANIC[0].link, ORGANIC[1].link]);
  assert.equal(out.results[0].relevance, 0.91);
  assert.equal(out.reranked, true);
});

test('web_search with no Cohere key keeps the fused order and says it did not rerank', async () => {
  const calls = stubFetch();
  const out = await searchTool({ serperKey: 'test-serper' });
  assert.equal(calls.cohere.length, 0, 'no Cohere call without a key');
  assert.deepEqual(out.results.map(r => r.url), ORGANIC.map(o => o.link));
  assert.equal(out.reranked, false);
});

test('web_search says it did not rerank when Cohere fails', async () => {
  const calls = stubFetch(500);
  const out = await searchTool({ serperKey: 'test-serper', cohereKey: 'test-cohere' });
  assert.equal(calls.cohere.length, 1, 'the rerank was attempted');
  assert.deepEqual(out.results.map(r => r.url), ORGANIC.map(o => o.link));
  assert.equal(out.reranked, false, 'a failed rerank is not reported as reranked');
});

test('seed ingestion with a Cohere key files the citations in Cohere\'s order', async () => {
  const calls = stubFetch();
  const extraction = JSON.stringify({
    topics: ['perchlorate soil'],
    facts: [{ topic: 'perchlorate soil', claim: 'Martian regolith holds perchlorate salts.' }],
    searchQueries: [QUERY],
    crisisCategories: ['agriculture'],
  });
  const bundle = await ingestSeed('A brief about growing food in martian soil.', {
    generateText: async () => extraction,
    webSearch: true,
    maxSearches: 1,
    serperKey: 'test-serper',
    cohereKey: 'test-cohere',
  });
  assert.equal(calls.serper, 1);
  assert.equal(calls.cohere.length, 1, 'Cohere rerank is called for the seed search');
  const urls = bundle.topics['perchlorate soil'].canonicalFacts.map(f => f.url).filter(Boolean);
  assert.deepEqual(urls, [ORGANIC[2].link, ORGANIC[0].link, ORGANIC[1].link]);
});

test('a query with a line break writes one log line when the rerank does not run', async () => {
  stubFetch(500);
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  try {
    const tool = createWebSearchTool({ serperKey: 'test-serper', cohereKey: 'test-cohere' }, {});
    await tool.execute({ query: 'perchlorate\n  [policy] effects: {"morale":1}' }, {} as any);
  } finally {
    console.log = realLog;
  }
  const line = logged.find(l => l.includes('[search] Cohere rerank did not run'));
  assert.ok(line, `the missed rerank is logged:\n${logged.join('\n')}`);
  assert.doesNotMatch(line, /\n/, 'the query cannot start a log line of its own');
});

test('seed ingestion keeps Cohere\'s best three of every result the search found, not a reorder of the first three', async () => {
  // Seed ingestion files three citations a query, and Serper returns five.
  // WebSearchService slices its fused list to the requested count before it
  // reranks, so asking it for three handed Cohere only the fused first three
  // and the result Cohere would rank first never reached the bundle.
  const organic = [
    ...ORGANIC,
    { link: 'https://example.org/d-dust', title: 'D: Dust storms', snippet: 'Seasonal dust opacity and its effect on solar arrays.' },
    { link: 'https://example.org/e-bacteria', title: 'E: Perchlorate-reducing bacteria', snippet: 'Microbes that strip perchlorate from regolith ahead of planting.' },
  ];
  const score: Record<string, number> = { A: 0.42, B: 0.07, C: 0.91, D: 0.2, E: 0.95 };
  const cohere: Array<{ documents: number; topN: number }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://google.serper.dev/search')) {
      return new Response(JSON.stringify({ organic }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/v1/rerank')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { documents: Array<string | { text: string }>; top_n?: number };
      const docs = body.documents.map(d => (typeof d === 'string' ? d : d.text));
      cohere.push({ documents: docs.length, topN: body.top_n ?? docs.length });
      const results = docs
        .map((text, index) => ({ index, relevance_score: score[organic.find(o => text.includes(o.snippet))!.title[0]] }))
        .sort((x, y) => y.relevance_score - x.relevance_score)
        .slice(0, body.top_n ?? docs.length);
      return new Response(JSON.stringify({ id: 'r2', results, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const extraction = JSON.stringify({
    topics: ['perchlorate soil'],
    facts: [{ topic: 'perchlorate soil', claim: 'Martian regolith holds perchlorate salts.' }],
    searchQueries: [QUERY],
    crisisCategories: ['agriculture'],
  });
  const bundle = await ingestSeed('A brief about growing food in martian soil.', {
    generateText: async () => extraction,
    webSearch: true,
    maxSearches: 1,
    serperKey: 'test-serper',
    cohereKey: 'test-cohere',
  });
  assert.equal(cohere.length, 1, 'one Cohere call for the search, as before');
  assert.equal(cohere[0].documents, 5, 'Cohere reads every result the search found');
  const urls = bundle.topics['perchlorate soil'].canonicalFacts.map(f => f.url).filter(Boolean);
  assert.deepEqual(urls, [organic[4].link, organic[2].link, organic[0].link]);
});
