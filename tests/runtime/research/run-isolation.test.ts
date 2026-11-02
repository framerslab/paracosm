/**
 * Two runs side by side in one process each keep their own research.
 *
 * In the live Atlas Lab pair of 2 November 2026 the first leader's run ended
 * at 19:57:00 and closed the research memory while the second ran on to
 * 19:58:16. The second leader's month 6 events then cited Arcadia Planitia and
 * Valles Marineris, Mars facts, in a scenario about an AI lab. These tests hold
 * the scenarios as the server loads them from scenarios/, the real memory store,
 * and no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiskCustomScenarios } from '../../../src/cli/custom-scenarios.js';
import { lunarScenario, marsScenario } from '../../../src/engine/scenarios/index.js';
import type { KnowledgeBundle, ScenarioPackage } from '../../../src/engine/types.js';
import type { CrisisResearchPacket } from '../../../src/runtime/contracts.js';
import { createResearchMemory, researchEmergentEvent, type EmergentEventResearch } from '../../../src/runtime/research/research-memory.js';
import { getResearchFromBundle } from '../../../src/runtime/research/scenario-research.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = loadDiskCustomScenarios(resolve(here, '../../../scenarios'));
const atlasLab = catalog.get('atlas-lab')?.scenario as ScenarioPackage;
assert.ok(atlasLab, 'scenarios/ holds atlas-lab');

/** The second leader's month 6 event in the live pair. */
const ATLAS_EVENT = {
  query: 'Month 6: Checkpoint Forensics Finds Drift. Spec-Gaming Regression Reappears Under New Multimodal Prompt Mix',
  keywords: ['spec gaming', 'checkpoint forensics', 'multimodal'],
  category: 'safety_breach',
};

/** A lunar event the lunar scenario's knowledge speaks to. */
const LUNAR_EVENT = {
  query: 'Regolith dust storm fouls the habitat seals',
  keywords: ['regolith', 'dust'],
  category: 'environmental',
};

function citedIn(bundle: KnowledgeBundle): Set<string> {
  const urls = new Set<string>();
  for (const topic of Object.values(bundle.topics)) {
    for (const f of topic.canonicalFacts ?? []) urls.add(f.url);
    for (const c of topic.counterpoints ?? []) urls.add(c.url);
  }
  return urls;
}

function claims(packet: CrisisResearchPacket): string[] {
  return [...packet.canonicalFacts, ...packet.counterpoints].map(f => f.claim);
}

test('the other leader closing its run leaves a scenario with no citations with none, not Mars facts', async () => {
  assert.equal(citedIn(atlasLab.knowledge).size, 0, 'scenarios/atlas-lab.json holds no citations');
  const first = await createResearchMemory(atlasLab.knowledge);
  const second = await createResearchMemory(atlasLab.knowledge);
  await first.close();
  try {
    const packet = await second.recall(ATLAS_EVENT.query, ATLAS_EVENT.keywords, ATLAS_EVENT.category);
    assert.deepEqual(claims(packet), []);
    assert.deepEqual(packet.departmentNotes, {});
  } finally {
    await second.close();
  }
});

test('the other leader closing its run leaves this run its own citations', async () => {
  const first = await createResearchMemory(lunarScenario.knowledge);
  const second = await createResearchMemory(lunarScenario.knowledge);
  await first.close();
  try {
    const packet = await second.recall(LUNAR_EVENT.query, LUNAR_EVENT.keywords, LUNAR_EVENT.category);
    const lunar = citedIn(lunarScenario.knowledge);
    assert.ok(packet.canonicalFacts.length >= 2, `recalled ${packet.canonicalFacts.length} facts`);
    for (const f of packet.canonicalFacts) assert.ok(lunar.has(f.url), `${f.url} is in the lunar knowledge`);
  } finally {
    await second.close();
  }
});

test('two runs in two scenarios each recall from their own knowledge', async () => {
  const atlas = await createResearchMemory(atlasLab.knowledge);
  const lunar = await createResearchMemory(lunarScenario.knowledge);
  try {
    const lunarPacket = await lunar.recall(LUNAR_EVENT.query, LUNAR_EVENT.keywords, LUNAR_EVENT.category);
    const atlasPacket = await atlas.recall(LUNAR_EVENT.query, LUNAR_EVENT.keywords, LUNAR_EVENT.category);
    assert.ok(lunarPacket.canonicalFacts.length >= 2, `the lunar run recalled ${lunarPacket.canonicalFacts.length} facts`);
    assert.deepEqual(claims(atlasPacket), [], 'the same question in the other run finds nothing of the lunar run');
  } finally {
    await atlas.close();
    await lunar.close();
  }
});

test('a recalled packet holds what the department prompt reads: facts, counterpoints and notes', async () => {
  const run = await createResearchMemory(lunarScenario.knowledge);
  try {
    const packet = await run.recall(LUNAR_EVENT.query, LUNAR_EVENT.keywords, LUNAR_EVENT.category);
    const regolith = lunarScenario.knowledge.topics.regolith;
    assert.ok(packet.canonicalFacts.some(f => /regolith/i.test(f.claim)), 'the store finds a regolith fact by its words');
    assert.ok(packet.counterpoints.length > 0, 'counterpoints reach the department prompt');
    assert.equal(packet.departmentNotes.medical, regolith.departmentNotes?.medical);
    const facts = new Set(packet.canonicalFacts.map(f => f.claim));
    for (const c of packet.counterpoints) assert.ok(!facts.has(c.claim), `"${c.claim}" is a counterpoint and not a fact`);
  } finally {
    await run.close();
  }
});

test('a run that closed its own store reads its own bundle', async () => {
  const run = await createResearchMemory(lunarScenario.knowledge);
  await run.close();
  const packet = await run.recall(LUNAR_EVENT.query, LUNAR_EVENT.keywords, LUNAR_EVENT.category);
  const lunar = citedIn(lunarScenario.knowledge);
  assert.ok(packet.canonicalFacts.length > 0);
  for (const f of packet.canonicalFacts) assert.ok(lunar.has(f.url), `${f.url} is in the lunar knowledge`);
});

test('a scenario with no knowledge at all gets an empty packet, not Mars facts', async () => {
  const run = await createResearchMemory(undefined);
  try {
    const packet = await run.recall(ATLAS_EVENT.query, ATLAS_EVENT.keywords, ATLAS_EVENT.category);
    assert.deepEqual(claims(packet), []);
    assert.deepEqual(packet.departmentNotes, {});
  } finally {
    await run.close();
  }
  assert.deepEqual(claims(getResearchFromBundle(undefined, 'infrastructure', ['ice'])), []);
});

for (const scenario of [marsScenario, lunarScenario]) {
  test(`${scenario.labels.name}: both milestone categories find facts in the scenario's own knowledge`, () => {
    // runSimulation forces turn 1 to the first categoryMapping key and the
    // final turn to the last.
    const keys = Object.keys(scenario.knowledge.categoryMapping);
    for (const category of [keys[0], keys[keys.length - 1]]) {
      const packet = getResearchFromBundle(scenario.knowledge, category);
      assert.ok(packet.canonicalFacts.length > 0, `${category} finds facts`);
    }
  });
}

/** Every citation a category's topics hold in a bundle. */
function claimsInCategory(bundle: KnowledgeBundle, category: string): Set<string> {
  const out = new Set<string>();
  for (const topicId of bundle.categoryMapping[category] ?? []) {
    const topic = bundle.topics[topicId];
    for (const f of topic?.canonicalFacts ?? []) out.add(f.claim);
    for (const c of topic?.counterpoints ?? []) out.add(c.claim);
  }
  return out;
}

test('a recall keeps to the topics of the event\'s category', async () => {
  // Mars maps psychological events to psychology, isolation and generational.
  // These words name the radiation topic's facts, which that category does not hold.
  const run = await createResearchMemory(marsScenario.knowledge);
  try {
    const packet = await run.recall('Radiation dose fears after the solar event', ['radiation', 'dose'], 'psychological');
    const inCategory = claimsInCategory(marsScenario.knowledge, 'psychological');
    for (const f of packet.canonicalFacts) assert.ok(inCategory.has(f.claim), `"${f.claim}" is outside the psychological topics`);
  } finally {
    await run.close();
  }
});

test('a recall for a category the scenario does not map still finds citations by their words', async () => {
  const run = await createResearchMemory(lunarScenario.knowledge);
  try {
    const packet = await run.recall(LUNAR_EVENT.query, LUNAR_EVENT.keywords, 'not_a_mapped_category');
    assert.ok(packet.canonicalFacts.some(f => /regolith/i.test(f.claim)));
  } finally {
    await run.close();
  }
});

/** The emergent-event research of a lunar run, with the web search stubbed and counted. */
async function lunarEventResearch(
  overrides: Partial<EmergentEventResearch>,
  results: Awaited<ReturnType<EmergentEventResearch['webSearch']>> | Error = [{ title: 'Web source', snippet: 'A web finding', url: 'https://example.org/finding' }],
) {
  const research = await createResearchMemory(lunarScenario.knowledge);
  const queries: string[] = [];
  try {
    const packet = await researchEmergentEvent({
      research,
      knowledge: lunarScenario.knowledge,
      event: { title: LUNAR_EVENT.query, description: '', category: LUNAR_EVENT.category, researchKeywords: LUNAR_EVENT.keywords },
      liveSearch: true,
      search: { mode: 'adaptive', maxSearches: 3 },
      settlementNoun: 'outpost',
      webSearch: async query => {
        queries.push(query);
        if (results instanceof Error) throw results;
        return results;
      },
      ...overrides,
    });
    return { packet, queries };
  } finally {
    await research.close();
  }
}

test('the aggressive search policy searches even when recall found enough', async () => {
  const { packet, queries } = await lunarEventResearch({ search: { mode: 'aggressive', maxSearches: 5 } });
  assert.equal(queries.length, 1);
  assert.deepEqual(packet.canonicalFacts.map(f => f.url), ['https://example.org/finding']);
});

test('the aggressive search policy keeps the recalled facts when the search finds nothing', async () => {
  const { packet, queries } = await lunarEventResearch({ search: { mode: 'aggressive', maxSearches: 5 } }, []);
  assert.equal(queries.length, 1);
  assert.ok(packet.canonicalFacts.some(f => /regolith/i.test(f.claim)));
});

test('the adaptive and gated policies do not search when recall found enough', async () => {
  for (const mode of ['adaptive', 'gated'] as const) {
    const { packet, queries } = await lunarEventResearch({ search: { mode, maxSearches: 3 } });
    assert.equal(queries.length, 0, mode);
    assert.ok(packet.canonicalFacts.some(f => /regolith/i.test(f.claim)), mode);
  }
});

test('no policy searches with live search off or with the off policy', async () => {
  for (const overrides of [
    { liveSearch: false, search: { mode: 'aggressive', maxSearches: 5 } },
    { search: { mode: 'off', maxSearches: 0 } },
  ] satisfies Array<Partial<EmergentEventResearch>>) {
    const { packet, queries } = await lunarEventResearch(overrides);
    assert.equal(queries.length, 0);
    assert.ok(packet.canonicalFacts.length > 0);
  }
});

/** Words no citation holds: recall finds nothing, the category still has facts. */
const UNMATCHED = { title: 'Zzqv', description: '', category: LUNAR_EVENT.category, researchKeywords: ['xxqq'] };

test('a search that finds nothing, or fails, falls back to the category in the scenario\'s bundle', async () => {
  for (const results of [[], new Error('No search API keys configured')]) {
    const { packet, queries } = await lunarEventResearch({ event: UNMATCHED }, results);
    assert.equal(queries.length, 1);
    assert.ok(packet.canonicalFacts.length > 0, 'the bundle holds facts for this category');
  }
});

test('a search that finds something answers when recall found too little', async () => {
  const { packet, queries } = await lunarEventResearch({ event: UNMATCHED });
  assert.deepEqual(queries, ['xxqq outpost science']);
  assert.deepEqual(packet.canonicalFacts, [{ claim: 'A web finding', source: 'Web source', url: 'https://example.org/finding' }]);
});
