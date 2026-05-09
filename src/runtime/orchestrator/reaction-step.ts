/**
 * Per-turn agent reaction pass.
 *
 * Pulls the colony's alive agents, picks an eligible subset (full roster
 * on turn 1, ~30 most-relevant on turn 2+ via progressive reactions),
 * fires a batched reaction call, writes the outputs into each agent's
 * memory, computes an aggregate mood summary, and emits two SSE events:
 * `agent_reactions` (detail list for the dashboard roster) and
 * `bulletin` (4 short quotes for the ticker).
 *
 * Extracted from orchestrator.ts so the turn-loop coordinator reads as
 * orchestration instead of a 110-line reaction/memory/bulletin block.
 * All kernel mutations, SSE emits, and cost-tracker calls flow through
 * callbacks supplied by the orchestrator.
 *
 * @module paracosm/runtime/reaction-step
 */

import { generateAgentReactions, type AgentReaction } from '../agents/agent-reactions.js';
import {
  recordReactionMemory,
  consolidateMemory,
  updateRelationshipsFromReactions,
} from '../agents/agent-memory.js';
import { SeededRng } from '../../engine/core/rng.js';
import { DEFAULT_EXECUTION, type SimulationExecutionConfig } from '../../cli/sim-config.js';
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type {
  LlmProvider,
  ScenarioPackage,
  SimulationModelConfig,
} from '../../engine/types.js';
import type { TurnOutcome } from '../../engine/core/state.js';
import type { CallUsage } from '../cost-tracker.js';
import type { SimEventType } from './index.js';

/**
 * Context snapshot passed to generateAgentReactions so each agent's
 * reaction is grounded in the turn's actual events, outcome, and
 * aggregate colony state rather than just the latest event title.
 */
export interface ReactionContext {
  eventTitle: string;
  eventCategory: string;
  outcome: TurnOutcome | null;
  decision: string;
  time: number;
  turn: number;
  colonyMorale: number;
  colonyPopulation: number;
  /**
   * Scenario's time-unit noun (e.g. "year", "quarter", "day", "tick").
   * Threaded into the shared reaction-batch system prompt so each
   * agent reads "Turn N, Quarter T" instead of the pre-F23 hardcoded
   * "Year" for scenarios where year-based phrasing is wrong
   * (corporate-quarterly, submarine-daily, benchmark-tick).
   */
  timeUnitNoun?: string;
}

export interface RunReactionStepArgs {
  kernel: SimulationKernel;
  scenario: ScenarioPackage;
  turn: number;
  time: number;
  seed: number;
  turnEvents: Array<{ relevantDepartments?: string[] }>;
  turnEventTitles: string[];
  lastEventCategory: string;
  lastOutcome: TurnOutcome | null;
  provider: LlmProvider;
  /** Explicit provider API key for this run. */
  apiKey?: string;
  modelConfig: SimulationModelConfig;
  execution?: Partial<SimulationExecutionConfig>;
  trackUsage: (result: { usage?: CallUsage }, site?: 'reactions') => void;
  reportProviderError: (err: unknown, site: string) => void;
  /** Record schema retry attempts for the reactions batch. */
  recordSchemaAttempt?: (schemaName: string, attempts: number, fellBack: boolean) => void;
  emit: (type: SimEventType, data?: Record<string, unknown>) => void;
}

export interface ReactionStepResult {
  /** Full reaction list produced this turn. Empty when generation failed. */
  reactions: AgentReaction[];
  /** Human-readable mood summary to surface in the next turn's UI header. */
  moodSummary: string | null;
}

/**
 * Run the full reaction step for the current turn and return the
 * reactions + an aggregate mood summary. Side effects: memory writes
 * into every reacting agent, relationship-sentiment updates across the
 * roster, and two SSE emits (`agent_reactions`, `bulletin`).
 *
 * Returning the reactions array lets the turn-loop caller append into
 * allAgentReactions and fold the mood summary into the next
 * DirectorContext.
 */
export async function runReactionStep(args: RunReactionStepArgs): Promise<ReactionStepResult> {
  const {
    kernel, scenario, turn, time, seed,
    turnEvents, turnEventTitles, lastEventCategory, lastOutcome,
    provider, apiKey, modelConfig, execution,
    trackUsage, reportProviderError, recordSchemaAttempt, emit,
  } = args;

  const reactionCtx: ReactionContext = {
    eventTitle: turnEventTitles.join(' / '),
    eventCategory: turnEvents.map(e => (e as { category?: string }).category || '').filter(Boolean).join(', '),
    outcome: lastOutcome,
    decision: turnEventTitles.join('. '),
    time, turn,
    colonyMorale: kernel.getState().metrics.morale,
    colonyPopulation: kernel.getState().metrics.population,
    timeUnitNoun: scenario.labels?.timeUnitNoun,
  };

  // Progressive reactions: turn 1 always runs the full colony so
  // baseline personalities + memories get established. Turns 2+ pick
  // only agents who materially experienced this turn's events
  // (featured + promoted heads + anyone in a relevantDepartments for
  // the turn), capped at ~30. This cuts ~70% of reaction calls after
  // turn 1 with minor memory-sparsity tradeoff.
  const progressiveReactions = execution?.progressiveReactions ?? DEFAULT_EXECUTION.progressiveReactions;
  const reactionBatchSize = execution?.reactionBatchSize ?? DEFAULT_EXECUTION.reactionBatchSize;
  const allAlive = kernel.getState().agents.filter(a => a.health.alive);
  const eligibleAgents = (() => {
    if (!progressiveReactions || turn === 1) return allAlive;
    const relevantDepts = new Set<string>();
    for (const ev of turnEvents) {
      for (const d of ev.relevantDepartments || []) relevantDepts.add(String(d));
    }
    const picked = new Map<string, typeof allAlive[number]>();
    const add = (a: typeof allAlive[number]) => { if (!picked.has(a.core.id)) picked.set(a.core.id, a); };
    // Featured: always react. These are the colonists users see in
    // the bulletin and care about narratively.
    for (const a of allAlive) if (a.narrative.featured) add(a);
    // Promoted department heads: always react. They shape next turn's
    // analysis so their psych state matters.
    for (const a of allAlive) if (a.promotion) add(a);
    // Department-affected agents: up to 6 per relevant dept, priority
    // by absolute deviation from neutral psych (dramatic reactors
    // first) so the bulletin stays textured with in-crisis voices.
    for (const dept of relevantDepts) {
      const candidates = allAlive
        .filter(a => a.core.department === dept && !picked.has(a.core.id))
        .sort((a, b) => Math.abs(b.health.psychScore - 0.5) - Math.abs(a.health.psychScore - 0.5))
        .slice(0, 6);
      for (const a of candidates) add(a);
    }
    // Hard cap so a scenario with many relevant departments can't
    // blow past budget by accident.
    return Array.from(picked.values()).slice(0, 30);
  })();
  if (progressiveReactions && turn > 1) {
    console.log(`  [agents] Progressive: ${eligibleAgents.length}/${allAlive.length} react this turn`);
  }

  let reactions: AgentReaction[] = [];
  try {
    reactions = await generateAgentReactions(
      eligibleAgents, reactionCtx,
      {
        provider,
        apiKey,
        model: modelConfig.agentReactions || 'gpt-4o-mini',
        maxConcurrent: 25,
        reactionContextHook: scenario.hooks.reactionContextHook,
        batchSize: reactionBatchSize,
        onUsage: (result) => trackUsage(result, 'reactions'),
        onProviderError: (err) => reportProviderError(err, 'reactions'),
        onSchemaAttempt: (attempts, fellBack) => recordSchemaAttempt?.('ReactionBatch', attempts, fellBack),
      },
    );
  } catch (err) {
    console.log(`  [agents] Reaction generation failed: ${err}`);
  }

  if (reactions.length === 0) return { reactions, moodSummary: null };

  const agentMap = new Map(kernel.getState().agents.map(c => [c.core.id, c]));

  emit('agent_reactions', {
    turn, time,
    reactions: reactions.slice(0, 8).map(r => {
      const agent = agentMap.get(r.agentId);
      const mem = agent?.memory;
      return {
        name: r.name, age: r.age, department: r.department, role: r.role,
        specialization: r.specialization, marsborn: r.marsborn,
        quote: r.quote, mood: r.mood, intensity: r.intensity,
        hexaco: r.hexaco, psychScore: r.psychScore, boneDensity: r.boneDensity, radiation: r.radiation,
        agentId: r.agentId,
        memory: mem ? {
          recentMemories: mem.shortTerm.slice(-3).map(m => ({ time: m.time, content: m.content, valence: m.valence })),
          beliefs: mem.longTerm.slice(-3),
          stances: Object.entries(mem.stances).filter(([, v]) => Math.abs(v) > 0.2).map(([k, v]) => ({ topic: k, value: v })),
          relationships: Object.entries(mem.relationships).filter(([, v]) => Math.abs(v) > 0.2).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([id, v]) => ({ name: agentMap.get(id)?.core.name || id, sentiment: v })),
        } : null,
      };
    }),
    totalReactions: reactions.length,
  });

  // Memory + relationship updates for every reactor, then consolidate
  // the shortTerm/longTerm split for the whole alive roster (even
  // non-reactors drift; they just don't have a fresh personal reaction
  // memory this turn).
  // recordReactionMemory takes `outcome: string` (not nullable) so coerce
  // the TurnOutcome|null into a stable placeholder when the turn ended
  // before the outcome roll (e.g. director batch produced zero events).
  const outcomeLabel: string = lastOutcome ?? 'unknown';
  for (const r of reactions) {
    const c = agentMap.get(r.agentId);
    if (c) recordReactionMemory(c, r, turnEventTitles.join(' / '), lastEventCategory, outcomeLabel, turn, time);
  }
  updateRelationshipsFromReactions(kernel.getState().agents, reactions);
  for (const c of kernel.getState().agents) if (c.health.alive) consolidateMemory(c);

  const moodCounts: Record<string, number> = {};
  for (const r of reactions) moodCounts[r.mood] = (moodCounts[r.mood] || 0) + 1;
  const moodParts = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([m, c]) => `${Math.round(c / reactions.length * 100)}% ${m}`);
  const moodSummary = `${reactions.length} colonists: ${moodParts.join(', ')}`;

  // Bulletin: 4 quotes sampled via a seeded RNG so the same run always
  // produces the same bulletin on replay. Turn-offset so turn N doesn't
  // repeat turn N+1's sample.
  const bulletinRng = new SeededRng(seed).turnSeed(turn + 3000);
  const bulletinPosts = reactions.slice(0, 4).map(r => ({
    name: r.name, department: r.department, role: r.role, marsborn: r.marsborn, age: r.age,
    post: r.quote.length > 140 ? r.quote.slice(0, 137) + '...' : r.quote,
    mood: r.mood, intensity: r.intensity,
    likes: Math.floor(r.intensity * 20 + bulletinRng.next() * 10),
    replies: Math.floor(r.intensity * 5 + bulletinRng.next() * 3),
  }));
  emit('bulletin', { turn, time, posts: bulletinPosts });

  return { reactions, moodSummary };
}
