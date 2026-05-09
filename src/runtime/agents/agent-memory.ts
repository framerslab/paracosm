/**
 * Agent Persistent Memory
 *
 * After each turn, agent reactions are distilled into persistent memory entries.
 * Short-term memory holds the last several turns of detail. Older memories
 * consolidate into long-term beliefs. Stances drift based on crisis outcomes.
 * Relationships shift based on shared experiences.
 *
 * Memory is injected into agent reaction prompts so each agent recalls
 * their prior experiences, beliefs, and relationships when reacting to new crises.
 * Works with any scenario type, not just colony simulations.
 */

import type { Agent, AgentMemoryEntry, AgentMemory } from '../../engine/core/state.js';
import type { AgentReaction } from './agent-reactions.js';

const SHORT_TERM_MAX = 15; // Max short-term entries before consolidation
const LONG_TERM_MAX = 10; // Max long-term belief summaries

/**
 * Record an agent's reaction as a persistent memory entry.
 * Called after each turn's reactions are generated.
 */
export function recordReactionMemory(
  agent: Agent,
  reaction: AgentReaction,
  eventTitle: string,
  eventCategory: string,
  outcome: string,
  turn: number,
  time: number,
): void {
  if (!agent.memory) {
    agent.memory = { shortTerm: [], longTerm: [], stances: {}, relationships: {} };
  }

  const entry: AgentMemoryEntry = {
    turn,
    time,
    content: `Event "${eventTitle}": ${reaction.quote}`,
    valence: reaction.mood === 'positive' || reaction.mood === 'hopeful' ? 'positive'
           : reaction.mood === 'neutral' ? 'neutral'
           : 'negative',
    category: eventCategory,
    salience: reaction.intensity,
  };

  agent.memory.shortTerm.push(entry);

  // Update stance on crisis category based on outcome
  updateStance(agent.memory, eventCategory, outcome, reaction.mood);
}

/**
 * Consolidate short-term memories into long-term beliefs.
 * Called when short-term memory exceeds the threshold.
 * Keeps the most salient recent memories and summarizes older ones.
 */
export function consolidateMemory(agent: Agent): void {
  if (!agent.memory) return;
  const mem = agent.memory;

  if (mem.shortTerm.length <= SHORT_TERM_MAX) return;

  // Score each memory by salience + recency. Recent high-salience memories are
  // most worth keeping. A memory from 2 turns ago with 0.8 salience beats a
  // memory from 10 turns ago with 0.9 salience.
  const maxTurn = Math.max(...mem.shortTerm.map(e => e.turn));
  const scored = mem.shortTerm.map(e => {
    const recency = 1 - (maxTurn - e.turn) / Math.max(maxTurn, 1);
    return { entry: e, score: e.salience * 0.6 + recency * 0.4 };
  });
  scored.sort((a, b) => b.score - a.score);
  const keep = scored.slice(0, 5).map(s => s.entry);
  const consolidate = scored.slice(5).map(s => s.entry);

  // Group consolidated memories by category
  const byCategory: Record<string, AgentMemoryEntry[]> = {};
  for (const entry of consolidate) {
    const cat = entry.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(entry);
  }

  // Generate long-term belief summaries
  for (const [category, entries] of Object.entries(byCategory)) {
    const positiveCount = entries.filter(e => e.valence === 'positive').length;
    const negativeCount = entries.filter(e => e.valence === 'negative').length;
    const dominant = positiveCount > negativeCount ? 'positive' : negativeCount > positiveCount ? 'negative' : 'mixed';

    const summary = dominant === 'positive'
      ? `Generally positive experiences with ${category} crises (${entries.length} events).`
      : dominant === 'negative'
        ? `Mostly negative experiences with ${category} crises (${entries.length} events). Tends to be wary.`
        : `Mixed experiences with ${category} crises (${entries.length} events).`;

    mem.longTerm.push(summary);
  }

  // Trim long-term to max
  if (mem.longTerm.length > LONG_TERM_MAX) {
    mem.longTerm = mem.longTerm.slice(-LONG_TERM_MAX);
  }

  mem.shortTerm = keep;
}

/**
 * Update an agent's stance on a topic based on a crisis outcome.
 * Stances range from -1 (strongly against) to 1 (strongly for).
 */
function updateStance(
  mem: AgentMemory,
  category: string,
  outcome: string,
  mood: string,
): void {
  const current = mem.stances[category] ?? 0;
  const isSuccess = outcome.includes('success');
  const isPositiveMood = mood === 'positive' || mood === 'hopeful';

  // Success + positive mood = stance drifts positive (confidence in handling this category)
  // Failure + negative mood = stance drifts negative (fear/wariness of this category)
  const delta = (isSuccess ? 0.1 : -0.1) + (isPositiveMood ? 0.05 : -0.05);
  mem.stances[category] = Math.max(-1, Math.min(1, current + delta));
}

/**
 * Update relationship sentiment between agents after shared crisis experience.
 * Agents who react with similar moods to the same crisis become closer.
 */
export function updateRelationshipsFromReactions(
  agents: Agent[],
  reactions: AgentReaction[],
): void {
  const reactionMap = new Map(reactions.map(r => [r.agentId, r]));

  // All agents track relationships. The relationship update is pure CPU
  // (mood string comparison + map update), not LLM calls. 100 agents x 100
  // reactions = 10,000 iterations of trivial work. The LLM reaction generation
  // that precedes this takes seconds per batch; this takes microseconds total.
  for (const agent of agents) {
    if (!agent.health.alive || !agent.memory) continue;
    const myReaction = reactionMap.get(agent.core.id);
    if (!myReaction) continue;

    for (const [otherId, otherReaction] of reactionMap) {
      if (otherId === agent.core.id) continue;

      const sameMood = myReaction.mood === otherReaction.mood;
      const bothIntense = myReaction.intensity > 0.6 && otherReaction.intensity > 0.6;

      if (sameMood && bothIntense) {
        const current = agent.memory.relationships[otherId] ?? 0;
        agent.memory.relationships[otherId] = Math.min(1, current + 0.1);
      } else if (!sameMood && bothIntense) {
        const current = agent.memory.relationships[otherId] ?? 0;
        agent.memory.relationships[otherId] = Math.max(-1, current - 0.05);
      }
    }

    // Prune weak relationships and cap at 20 strongest to bound memory size
    for (const [id, val] of Object.entries(agent.memory.relationships)) {
      if (Math.abs(val) < 0.05) delete agent.memory.relationships[id];
    }
    const remaining = Object.entries(agent.memory.relationships);
    if (remaining.length > 20) {
      remaining.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      agent.memory.relationships = Object.fromEntries(remaining.slice(0, 20));
    }
  }
}

/**
 * Build memory context lines for a agent's reaction prompt.
 * Returns a string block that gets injected into the prompt.
 */
/**
 * Build memory context lines for a agent's reaction prompt.
 * Returns a string block that gets injected into the prompt.
 *
 * @param agent - The agent whose memory to render
 * @param allColonists - Optional full agent list for resolving relationship names
 */
export function buildMemoryContext(agent: Agent, allColonists?: Agent[], timeUnitNoun?: string): string {
  if (!agent.memory) return '';

  const lines: string[] = [];
  const mem = agent.memory;

  // Build a name lookup from agent IDs if the full list is available
  const nameMap = new Map<string, string>();
  if (allColonists) {
    for (const c of allColonists) nameMap.set(c.core.id, c.core.name);
  }

  // Long-term beliefs
  if (mem.longTerm.length > 0) {
    lines.push('YOUR BELIEFS (from past experience):');
    for (const belief of mem.longTerm.slice(-5)) {
      lines.push(`- ${belief}`);
    }
  }

  // Recent memories (last 3, most recent first)
  const recent = mem.shortTerm.slice(-3).reverse();
  if (recent.length > 0) {
    const timeNounRaw = timeUnitNoun ?? 'tick';
    const TimeNoun = timeNounRaw.charAt(0).toUpperCase() + timeNounRaw.slice(1);
    lines.push('YOUR RECENT MEMORIES:');
    for (const entry of recent) {
      lines.push(`- ${TimeNoun} ${entry.time}: ${entry.content}`);
    }
  }

  // Strong stances
  const strongStances = Object.entries(mem.stances).filter(([, v]) => Math.abs(v) > 0.3);
  if (strongStances.length > 0) {
    lines.push('YOUR STANCES:');
    for (const [topic, value] of strongStances) {
      const label = value > 0.5 ? 'strongly confident' : value > 0 ? 'cautiously optimistic' : value > -0.5 ? 'wary' : 'deeply fearful';
      lines.push(`- ${topic}: ${label}`);
    }
  }

  // Key relationships (resolve names from agent list when available)
  const strongRelationships = Object.entries(mem.relationships)
    .filter(([, v]) => Math.abs(v) > 0.3)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3);
  if (strongRelationships.length > 0) {
    lines.push('YOUR KEY RELATIONSHIPS:');
    for (const [id, value] of strongRelationships) {
      const label = value > 0.5 ? 'close ally' : value > 0 ? 'friendly' : value > -0.5 ? 'tense' : 'adversarial';
      const name = nameMap.get(id) || id.replace('col-', '').replace(/-/g, ' ');
      lines.push(`- ${name}: ${label}`);
    }
  }

  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}
