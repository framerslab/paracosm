/**
 * Research lookup in a scenario's own KnowledgeBundle.
 */

import type { CrisisResearchPacket } from '../contracts.js';
import type { KnowledgeBundle } from '../../engine/types.js';

/**
 * Get research citations from a scenario's knowledge bundle for a given crisis category.
 * Uses the bundle's categoryMapping to find relevant topics, then merges citations.
 * A scenario with no knowledge gets an empty packet.
 */
export function getResearchFromBundle(
  bundle: KnowledgeBundle | undefined,
  category: string,
  keywords: string[] = [],
): CrisisResearchPacket {
  const topics: KnowledgeBundle['topics'] = bundle?.topics ?? {};
  const topicIds = bundle?.categoryMapping?.[category] ?? [];
  const facts: CrisisResearchPacket['canonicalFacts'] = [];
  const counters: CrisisResearchPacket['counterpoints'] = [];
  const notes: CrisisResearchPacket['departmentNotes'] = {};
  const seen = new Set<string>();

  for (const topicId of topicIds) {
    const topic = topics[topicId];
    if (!topic) continue;

    // Defensive defaults: topics from compileFromSeed-generated bundles
    // sometimes omit canonicalFacts / counterpoints / departmentNotes
    // entirely. Iterating a missing field used to throw "X is not
    // iterable" mid-run, which propagated up through orchestrator.ts
    // and surfaced as an HTTP 502 in the dashboard. Treat missing
    // fields as empty so the lookup degrades gracefully instead.
    for (const f of topic.canonicalFacts ?? []) {
      if (!seen.has(f.claim)) {
        seen.add(f.claim);
        facts.push(f);
      }
    }
    for (const c of topic.counterpoints ?? []) {
      if (!seen.has(c.claim)) {
        seen.add(c.claim);
        counters.push(c);
      }
    }
    for (const [dept, note] of Object.entries(topic.departmentNotes ?? {})) {
      if (note && !notes[dept as keyof typeof notes]) {
        (notes as any)[dept] = note;
      }
    }
  }

  // If category mapping yielded nothing, try keyword matching across all topics
  if (facts.length === 0 && keywords.length > 0) {
    const kwLower = keywords.map(k => k.toLowerCase());
    for (const topic of Object.values(topics)) {
      for (const f of topic.canonicalFacts ?? []) {
        if (seen.has(f.claim)) continue;
        if (kwLower.some(kw => f.claim.toLowerCase().includes(kw) || f.source.toLowerCase().includes(kw))) {
          seen.add(f.claim);
          facts.push(f);
        }
      }
    }
  }

  return {
    canonicalFacts: facts.slice(0, 6),
    counterpoints: counters.slice(0, 3),
    departmentNotes: notes,
  };
}
