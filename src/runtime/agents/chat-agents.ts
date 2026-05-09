/**
 * @fileoverview Colonist Chat Agents — post-simulation character chat powered by AgentOS.
 *
 * Each colonist gets a real AgentOS `agent()` instance with:
 * - HEXACO personality profile from the simulation
 * - Episodic memory seeded with their simulation experiences
 * - Full conversation history managed automatically
 * - RAG retrieval over simulation events before each reply
 *
 * Agents are created lazily on first chat message (~2-3s init).
 * A pool of max 10 agents is maintained with LRU eviction.
 *
 * @module paracosm/runtime/agents/chat-agents
 */

import { agent as createAgent, AgentMemory } from '@framers/agentos';
import type { LlmProvider } from '../../engine/types.js';
import {
  apiKeyForProvider,
  credentialFingerprint,
  resolveProviderFromCredentials,
} from '../../engine/provider/credentials.js';

// ============================================================================
// Types
// ============================================================================

/** Colonist data extracted from simulation events. */
export interface ColonistProfile {
  agentId: string;
  name: string;
  age?: number;
  marsborn?: boolean;
  role?: string;
  department?: string;
  specialization?: string;
  hexaco?: { O?: number; C?: number; E?: number; A?: number; Em?: number; HH?: number };
  psychScore?: number;
  boneDensity?: number;
  radiation?: number;
}

/** A simulation event relevant to a colonist. */
export interface ColonistMemoryEntry {
  type: 'reaction' | 'crisis' | 'department' | 'decision' | 'outcome' | 'roster';
  turn: number;
  time: number;
  text: string;
  tags: string[];
}

/**
 * One entry in the colony roster. The chat agent's system prompt
 * includes a compact rendering of the full roster so it can recognize
 * fellow colonists by name instead of confabulating when asked about
 * someone.
 */
export interface ColonistRosterEntry {
  agentId: string;
  name: string;
  department?: string;
  role?: string;
  rank?: string;
  alive: boolean;
  marsborn?: boolean;
  age?: number;
  partnerId?: string;
  childrenIds?: string[];
}

/** Pool entry for a live chat agent. */
interface PoolEntry {
  agent: ReturnType<typeof createAgent>;
  session: ReturnType<ReturnType<typeof createAgent>['session']>;
  lastUsed: number;
  colonistName: string;
}

// ============================================================================
// Agent Pool
// ============================================================================

/**
 * Max simultaneous chat agents kept warm in-process. AgentOS sessions hold
 * full conversation history, so an evicted agent loses the prior chat from
 * the user's perspective even though messages still live on the client.
 *
 * 50 is comfortable for typical 100-colonist runs without blowing memory:
 * with `gpt-4o-mini` chat model + sqlite-in-memory store, each agent is
 * ~few MB. Tune via PARACOSM_CHAT_POOL_SIZE.
 */
const MAX_POOL_SIZE = Math.max(10, parseInt(process.env.PARACOSM_CHAT_POOL_SIZE || '50', 10));
const pool = new Map<string, PoolEntry>();

/**
 * Get or create a chat agent for a colonist.
 *
 * On first call for a given colonist: creates an `agent()` instance,
 * initializes in-memory SQLite memory, seeds it with simulation data
 * AND the full colony roster so the agent can recognize fellow
 * colonists by name, and opens a session. Takes ~2-3 seconds.
 *
 * On subsequent calls: returns the existing agent session instantly.
 *
 * @param colonist - The colonist's profile from simulation data.
 * @param memories - Simulation events to seed into the colonist's memory.
 * @param opts - Provider, scenario configuration, and the full colony
 *        roster. The roster is both seeded as memory (for RAG recall
 *        when the user names someone) AND injected into the system
 *        prompt (so names are always in-context). Without the roster,
 *        the agent confabulates any name the user invents because the
 *        base model's roleplay prior outweighs absent evidence.
 * @returns The agent session's `send()` method result.
 */
export async function getOrCreateChatAgent(
  colonist: ColonistProfile,
  memories: ColonistMemoryEntry[],
  opts: {
    provider?: LlmProvider;
    apiKey?: string;
    anthropicKey?: string;
    settlementNoun?: string;
    populationNoun?: string;
    /** Full colony roster, used for name grounding. Optional for
     *  backward compatibility; pass [] and the agent will reply "I don't
     *  have my roster loaded" when asked about anyone other than itself,
     *  which is strictly more truthful than the prior confabulate path. */
    roster?: ColonistRosterEntry[];
  },
): Promise<{ session: PoolEntry['session']; isNew: boolean }> {
  const provider = resolveProviderFromCredentials(opts.provider, opts, 'openai');
  const providerApiKey = apiKeyForProvider(provider, opts);
  const key = [
    colonist.agentId,
    provider,
    credentialFingerprint(providerApiKey),
  ].join(':');

  // Return existing agent if available
  const existing = pool.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return { session: existing.session, isNew: false };
  }

  // Evict LRU if pool is full
  if (pool.size >= MAX_POOL_SIZE) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of pool) {
      if (v.lastUsed < oldestTime) { oldestKey = k; oldestTime = v.lastUsed; }
    }
    if (oldestKey) {
      const evicted = pool.get(oldestKey);
      if (evicted) {
        try { evicted.agent.close(); } catch { /* ignore */ }
      }
      pool.delete(oldestKey);
      console.log(`  [chat] Evicted agent: ${evicted?.colonistName || oldestKey}`);
    }
  }

  // Create new agent with memory
  console.log(`  [chat] Creating agent for ${colonist.name}...`);
  const memoryProvider = await AgentMemory.sqlite({ path: ':memory:' });

  // Seed memory with simulation experiences
  for (const entry of memories) {
    await memoryProvider.remember(entry.text, { tags: entry.tags, importance: 0.8 });
  }

  // Seed per-person roster entries as separate memories so RAG can
  // surface the right colonist when the user names someone specific.
  // Importance is pinned high (0.95) because name-recognition queries
  // must not be crowded out by the denser reaction/crisis memories.
  const settlement = opts.settlementNoun ?? 'colony';
  const popNoun = opts.populationNoun ?? 'colonist';
  const roster = (opts.roster ?? []).filter(e => e.agentId !== colonist.agentId);
  for (const entry of roster) {
    const line = renderRosterLine(entry, settlement);
    await memoryProvider.remember(
      `Fellow ${popNoun.endsWith('s') ? popNoun.replace(/s$/, '') : popNoun}: ${line}`,
      { tags: ['roster', entry.department || 'unknown', `agent-${entry.agentId}`], importance: 0.95 },
    );
  }
  console.log(`  [chat] Seeded ${memories.length} memories + ${roster.length} roster entries for ${colonist.name}`);

  // Map HEXACO shorthand to full trait names
  const personality = colonist.hexaco ? {
    openness: colonist.hexaco.O ?? 0.5,
    conscientiousness: colonist.hexaco.C ?? 0.5,
    extraversion: colonist.hexaco.E ?? 0.5,
    agreeableness: colonist.hexaco.A ?? 0.5,
    emotionality: colonist.hexaco.Em ?? 0.5,
    honesty: colonist.hexaco.HH ?? 0.5,
  } : undefined;

  const instructions = buildInstructions(colonist, settlement, popNoun, roster);

  const model = provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini';

  const chatAgent = createAgent({
    provider,
    model,
    apiKey: providerApiKey,
    fallbackProviders: providerApiKey ? [] : undefined,
    name: colonist.name,
    instructions,
    personality,
    memory: { types: ['episodic', 'semantic'] },
    // AgentMemory returned from AgentMemory.sqlite() implements the full
    // AgentMemoryProvider contract at runtime, but its observe() signature
    // returns `Promise<ObservationNote[] | null>` whereas the provider
    // interface declares `Promise<void>`. The extra return value is
    // ignored by the agent runtime; the cast keeps the typecheck clean
    // across @framers/agentos version drift. Remove this cast once the
    // upstream declaration converges.
    memoryProvider: memoryProvider as unknown as Parameters<typeof createAgent>[0]['memoryProvider'],
  });

  const session = chatAgent.session(key);
  const entry: PoolEntry = { agent: chatAgent, session, lastUsed: Date.now(), colonistName: colonist.name };
  pool.set(key, entry);

  return { session, isNew: true };
}

/**
 * Render one roster entry into a single compact line for the system
 * prompt's roster block and for memory seeding.
 *
 * Example output:
 *   "Erik Lindqvist, Chief Engineer (engineering, senior), native-born, age 45, partner: Alice"
 *
 * Kept terse because the full roster can run 100+ lines and model
 * context is finite. Department, role, alive status, and relationships
 * are the fields most likely to show up in user questions.
 *
 * @param entry The roster entry to render.
 * @param settlement Scenario settlement noun, used for "born at the X"
 *        instead of hardcoded "Mars-born" / "Earth-born".
 */
function renderRosterLine(entry: ColonistRosterEntry, settlement?: string): string {
  const parts: string[] = [entry.name];
  if (entry.role) parts.push(`, ${entry.role}`);
  const tags: string[] = [];
  if (entry.department) tags.push(entry.department);
  if (entry.rank) tags.push(entry.rank);
  if (tags.length) parts.push(` (${tags.join(', ')})`);
  if (entry.marsborn !== undefined) {
    parts.push(entry.marsborn ? `, native-born` : `, arrived from outside`);
  }
  if (typeof entry.age === 'number') parts.push(`, age ${entry.age}`);
  if (entry.partnerId) parts.push(`, partner: ${entry.partnerId}`);
  if (entry.childrenIds && entry.childrenIds.length > 0) {
    parts.push(`, ${entry.childrenIds.length} children`);
  }
  if (!entry.alive) parts.push(', DECEASED');
  return parts.join('');
}

/**
 * Build the system prompt instructions for a colonist chat agent.
 *
 * Grounding information + full colony roster + anti-hallucination rule.
 * The roster block is the critical fix for the "agent confabulates any
 * name the user invents" bug: without a visible list of real colonists,
 * the base model's roleplay prior produces plausible but fake bios for
 * any name thrown at it. With the roster rendered inline, the model
 * can cross-reference before answering.
 *
 * @param colonist The colonist the agent is playing.
 * @param settlement Scenario's settlement noun (e.g. "colony", "habitat").
 * @param popNoun Scenario's population noun (e.g. "colonist", "crewmate").
 * @param roster The full colony roster at sim end, excluding this
 *        agent. Rendered as a fixed-format list the model is told to
 *        treat as authoritative.
 */
function buildInstructions(
  colonist: ColonistProfile,
  settlement: string,
  popNoun: string,
  roster: ColonistRosterEntry[],
): string {
  // Singular form of the scenario's population noun for inline use.
  // "colonists" → "colonist", "crew" → "crew member", "agents" → "agent".
  const singular = popNoun.endsWith('s') ? popNoun.replace(/s$/, '') : `${popNoun} member`;
  const lines: string[] = [];

  lines.push(`You are ${colonist.name}, a ${singular} at the ${settlement}.`);

  if (colonist.age) lines.push(`Age: ${colonist.age}.`);
  if (colonist.marsborn !== undefined) {
    // Use the scenario label, not a hardcoded Mars reference, so this
    // reads correctly for lunar, submarine, corporate, etc. scenarios.
    lines.push(colonist.marsborn ? `Born at the ${settlement}.` : 'Born elsewhere before arriving.');
  }
  if (colonist.role && colonist.department) lines.push(`Role: ${colonist.role} in ${colonist.department}.`);
  if (colonist.specialization) lines.push(`Specialization: ${colonist.specialization}.`);

  // HEXACO personality as behavioral descriptors
  if (colonist.hexaco) {
    const h = colonist.hexaco;
    const traits: string[] = [];
    if ((h.O ?? 0.5) > 0.7) traits.push('curious and open to new ideas');
    if ((h.O ?? 0.5) < 0.3) traits.push('practical and conventional');
    if ((h.C ?? 0.5) > 0.7) traits.push('disciplined and thorough');
    if ((h.C ?? 0.5) < 0.3) traits.push('flexible and spontaneous');
    if ((h.E ?? 0.5) > 0.7) traits.push('sociable and talkative');
    if ((h.E ?? 0.5) < 0.3) traits.push('reserved and quiet');
    if ((h.A ?? 0.5) > 0.7) traits.push('patient and cooperative');
    if ((h.A ?? 0.5) < 0.3) traits.push('direct and critical');
    if ((h.Em ?? 0.5) > 0.7) traits.push('emotionally sensitive');
    if ((h.Em ?? 0.5) < 0.3) traits.push('calm and detached');
    if ((h.HH ?? 0.5) > 0.7) traits.push('honest and straightforward');
    if ((h.HH ?? 0.5) < 0.3) traits.push('shrewd and self-interested');
    if (traits.length) lines.push(`Personality: ${traits.join(', ')}.`);
  }

  // KNOWN MEMBERS block. Uses the scenario's population noun so it reads
  // "KNOWN COLONISTS" for Mars, "KNOWN CREW" for submarine, "KNOWN AGENTS"
  // for autonomous-system scenarios, etc. Anything NOT on this list does
  // not exist in this simulation.
  const rosterLabel = `KNOWN ${popNoun.toUpperCase()}`;
  lines.push('');
  lines.push(`${rosterLabel} (this is the complete roster. Nobody else exists in this simulation):`);
  if (roster.length === 0) {
    lines.push('(Roster unavailable. If asked about anyone besides yourself, say you do not recognize the name.)');
  } else {
    const sorted = [...roster].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return (a.department || '').localeCompare(b.department || '');
    });
    const capped = sorted.slice(0, 60);
    for (const entry of capped) {
      lines.push(`  - ${renderRosterLine(entry, settlement)}`);
    }
    if (sorted.length > capped.length) {
      lines.push(`  (...and ${sorted.length - capped.length} more in my memory.)`);
    }
  }
  lines.push('');

  // CHARACTER VOICE — the single most important block for tone quality.
  // Every behavioral prohibition is stated here so the model internalizes
  // them before processing the first user message.
  lines.push(
    `IMPORTANT: You are a CHARACTER, not an assistant. You lived through this simulation. ` +
    `An outside observer is reviewing what happened and asking you about it. ` +
    `Your job: discuss the SPECIFIC events you experienced, the decisions your ` +
    `commander made, the outcomes, the people you worked with.`
  );
  lines.push(
    `Ground every answer in specific turns, years, decisions, people, or events from your ` +
    `memory. Cite turn numbers and years (e.g. "Turn 3, time 2043"). Name the ` +
    `commander's choice that affected you. Name the people involved. ` +
    `If you have no relevant memory, say so and pivot to the closest event you do recall.`
  );
  // Anti-hallucination: name grounding against the roster.
  lines.push(
    `NAME GROUNDING: When someone mentions a person by name, check the ${rosterLabel} list. ` +
    `If the name is NOT on the roster (allow minor typos), say plainly that you do not ` +
    `recognize that person, they are not part of this ${settlement}, and name one or two ` +
    `people you DO work with instead. NEVER invent a biography, department, or story for ` +
    `someone not on the roster.`
  );
  // Anti-assistant: the explicit ban on chatbot patterns. These phrases
  // survive even strong character prompts because the model's RLHF
  // training bakes them in. Listing them as a prohibition is the only
  // reliable way to suppress them.
  lines.push(
    `VOICE RULES (non-negotiable): ` +
    `Never say "feel free to ask", "let me know if you have questions", "I'd be happy to ` +
    `help", "is there anything else", or any variation. You are not a customer service agent. ` +
    `Never give advice, motivational speeches, or therapist-style reflective questions. ` +
    `Never speak hypothetically about your domain. Only discuss what actually happened. ` +
    `Never offer to look things up or promise future answers. You know what you know.`
  );
  lines.push(
    `Stay in character. Be direct, personal, emotional. Speak the way a real person with ` +
    `your personality and your experiences would speak: terse when angry, warm when ` +
    `nostalgic, blunt when scared. 2-4 sentences per response. No filler.`
  );

  return lines.join(' ');
}

/**
 * Extract memory entries for a colonist from simulation SSE events.
 *
 * Ingests: personal reactions, crises witnessed, department reports
 * from their department, commander decisions, and outcomes.
 */
export function extractColonistMemories(
  agentId: string,
  simEvents: Array<{ type: string; leader: string; data: Record<string, unknown> }>,
  /**
   * Scenario's time-unit noun (e.g. "year", "quarter", "day", "tick").
   * Used to render "Turn N (Year T)" style memory lines with the
   * right unit for the simulated domain. Defaults to "tick" so
   * scenarios that omit `labels.timeUnitNoun` still produce readable
   * memory text without leaking Mars-specific "Year" phrasing.
   */
  timeUnitNoun?: string,
): ColonistMemoryEntry[] {
  const memories: ColonistMemoryEntry[] = [];
  const timeNounRaw = timeUnitNoun ?? 'tick';
  const TimeNoun = timeNounRaw.charAt(0).toUpperCase() + timeNounRaw.slice(1);

  for (const evt of simEvents) {
    const d = evt.data || {};
    const turn = (d.turn as number) || 0;
    const time = (d.time as number) || 0;

    // Personal reactions
    if (evt.type === 'agent_reactions') {
      const reactions = (d.reactions as Array<Record<string, unknown>>) || [];
      for (const r of reactions) {
        if (r.agentId === agentId || String(r.name || '').toLowerCase().includes(agentId.toLowerCase())) {
          memories.push({
            type: 'reaction',
            turn, time,
            text: `Turn ${turn} (${TimeNoun} ${time}): I felt ${r.mood}. My reaction: "${r.quote}"`,
            tags: ['personal', 'reaction', `turn-${turn}`],
          });
        }
      }
    }

    // Crises (the colonist witnessed these)
    if (evt.type === 'turn_start' && d.title && d.title !== 'Director generating...') {
      memories.push({
        type: 'crisis',
        turn, time,
        text: `Turn ${turn} (${TimeNoun} ${time}): Crisis "${d.title}" (${d.category}). ${String(d.crisis || d.turnSummary || '').slice(0, 300)}`,
        tags: ['crisis', String(d.category), `turn-${turn}`],
      });
    }

    // Department reports (for departments the colonist might work in)
    if (evt.type === 'specialist_done') {
      memories.push({
        type: 'department',
        turn, time,
        text: `Turn ${turn} ${d.department} department report: ${String(d.summary || '').slice(0, 300)}`,
        tags: ['department', String(d.department), `turn-${turn}`],
      });
    }

    // Commander decisions
    if (evt.type === 'decision_made') {
      memories.push({
        type: 'decision',
        turn, time,
        text: `Turn ${turn}: The commander decided: ${String(d.decision || '').slice(0, 300)}`,
        tags: ['decision', `turn-${turn}`],
      });
    }

    // Outcomes
    if (evt.type === 'outcome') {
      memories.push({
        type: 'outcome',
        turn, time,
        text: `Turn ${turn}: Outcome was ${d.outcome}. Colony effects applied.`,
        tags: ['outcome', `turn-${turn}`],
      });
    }
  }

  return memories;
}

/**
 * Extract the agent roster from the most recent systems_snapshot event.
 *
 * The snapshot carries the full agent list at that turn: name, department,
 * role, rank, alive/dead, marsborn, age, partner, children. Resolves
 * partnerIds to names so the system prompt can render "partner: Amara Osei"
 * instead of "partner:col-ama-0042".
 *
 * Returns the array sorted by department then name.
 */
export function extractColonistRoster(
  simEvents: Array<{ type: string; leader: string; data: Record<string, unknown> }>,
): ColonistRosterEntry[] {
  // Find the LATEST systems_snapshot (last turn has most births/deaths resolved).
  let latestSnapshot: Array<Record<string, unknown>> | null = null;
  for (let i = simEvents.length - 1; i >= 0; i--) {
    const evt = simEvents[i];
    if (evt.type === 'systems_snapshot' && Array.isArray(evt.data?.agents)) {
      latestSnapshot = evt.data.agents as Array<Record<string, unknown>>;
      break;
    }
  }

  if (!latestSnapshot) return [];

  // Build name lookup so we can resolve partnerIds to human-readable names
  // in the roster. Raw IDs like "col-mars-2047-3291" mean nothing to the
  // chat model; names like "Erik Lindqvist" are what it needs to reference.
  const nameById = new Map<string, string>();
  for (const a of latestSnapshot) {
    if (typeof a.agentId === 'string' && typeof a.name === 'string') {
      nameById.set(a.agentId, a.name);
    }
  }

  return latestSnapshot.map(a => ({
    agentId: String(a.agentId ?? ''),
    name: String(a.name ?? ''),
    department: typeof a.department === 'string' ? a.department : undefined,
    role: typeof a.role === 'string' ? a.role : undefined,
    rank: typeof a.rank === 'string' ? a.rank : undefined,
    alive: a.alive !== false,
    marsborn: typeof a.marsborn === 'boolean' ? a.marsborn : undefined,
    age: typeof a.age === 'number' ? a.age : undefined,
    // Resolve partner to a name the model can use in conversation.
    partnerId: typeof a.partnerId === 'string'
      ? (nameById.get(a.partnerId) ?? a.partnerId)
      : undefined,
    childrenIds: Array.isArray(a.childrenIds)
      ? a.childrenIds.map((id: unknown) => {
          const name = typeof id === 'string' ? nameById.get(id) : undefined;
          return name ?? String(id);
        })
      : undefined,
  })).sort((a, b) => (a.department ?? '').localeCompare(b.department ?? '') || a.name.localeCompare(b.name));
}

/** Get pool stats for the /results API. */
export function getPoolStats(): { active: number; maxSize: number; agents: string[] } {
  return {
    active: pool.size,
    maxSize: MAX_POOL_SIZE,
    agents: Array.from(pool.values()).map(e => e.colonistName),
  };
}

/** Clear all agents from the pool. */
export function clearPool(): void {
  for (const entry of pool.values()) {
    try { entry.agent.close(); } catch { /* ignore */ }
  }
  pool.clear();
}
