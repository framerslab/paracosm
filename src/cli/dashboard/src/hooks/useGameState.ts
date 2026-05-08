import { useMemo } from 'react';
import type { SimEvent } from './useSSE';

export interface AgentSnapshot {
  agentId: string;
  name: string;
  department: string;
  role: string;
  rank: 'junior' | 'senior' | 'lead' | 'chief';
  alive: boolean;
  marsborn: boolean;
  psychScore: number;
  age?: number;
  generation?: number;
  partnerId?: string;
  childrenIds: string[];
  featured: boolean;
  mood: string;
  shortTermMemory: string[];
}

export interface MetricsState {
  population: number;
  morale: number;
  foodMonthsReserve: number;
  waterLitersPerDay: number;
  powerKw: number;
  infrastructureModules: number;
  lifeSupportCapacity: number;
  scienceOutput: number;
  [key: string]: number;
}

export interface LeaderInfo {
  name: string;
  archetype: string;
  unit: string;
  hexaco: Record<string, number>;
  instructions?: string;
  quote?: string;
}

/**
 * Per-turn narrative event projected from the SSE stream. Populated by
 * `turn_start` and `event_start` events. The scenario layer calls these
 * "events" generically; the default label noun is `crisis` (Mars-
 * heritage) but scenarios override via `labels.eventNounSingular`. Field
 * `time` is legacy — tracked in audit F23 (generic time units).
 */
export interface TurnEventInfo {
  turn: number;
  time?: number;
  title: string;
  description?: string;
  category: string;
  emergent: boolean;
  turnSummary?: string;
}

/**
 * Per-leader dashboard projection. Field list identical to the old
 * `SideState`; renamed to domain-agnostic label since a leader isn't
 * conceptually a "side" (side-by-side is a rendering choice, not a
 * state-shape property). The rename sets up P2 arena's N-leader mode
 * without forcing the F2/F3 layout changes into this refactor.
 */
export interface ActorSideState {
  leader: LeaderInfo | null;
  metrics: MetricsState | null;
  prevMetrics: MetricsState | null;
  /**
   * Categorical statuses bag (world.statuses declarations), as of the
   * most recent `turn_done` event. Undefined for Mars-shape scenarios
   * that only declare numeric metrics. Added in the 0.7.x
   * worldSnapshot widening (Phase C).
   */
  statuses?: Record<string, string | boolean>;
  /**
   * Environment bag (world.environment declarations), as of the most
   * recent `turn_done` event. Same emit rule as statuses.
   */
  environment?: Record<string, number | string | boolean>;
  event: TurnEventInfo | null;
  events: ProcessedEvent[];
  popHistory: number[];
  moraleHistory: number[];
  deaths: number;
  /** Accumulated count per attributed death cause across all turns.
   *  Populated from the `turn_done` event's deathCauses field. Lets
   *  the UI render "DEATHS 8 (3 radiation · 2 accident · ...)" instead
   *  of a single faceless number. */
  deathCauses: Record<string, number>;
  tools: number;
  /** Set of unique tool names approved on this leader's side so tools
   *  stat counts unique forges, not per-call invocations. */
  toolNames: Set<string>;
  citations: number;
  decisions: number;
  pendingDecision: string;
  pendingRationale: string;
  /** Full stepwise CoT from the commander's reasoning schema field.
   *  Piped into the outcome event as `_reasoning` so the Reports tab can
   *  render it behind an expand. Empty string when the decision schema
   *  lacked the field (older runs before the Zod migration). */
  pendingReasoning: string;
  pendingPolicies: string[];
  outcome: string | null;
  agentSnapshots: AgentSnapshot[][];
  currentEvents: Array<{ eventIndex: number; totalEvents: number; title: string; category: string }>;
}

export interface ProcessedEvent {
  id: string;
  type: string;
  turn?: number;
  time?: number;
  data: Record<string, unknown>;
}

/**
 * Per-call-site spend within a run. Keys are pipeline-stage labels the
 * orchestrator tags (director, commander, departments, judge, reactions,
 * other). Empty when the run hasn't reported any calls yet.
 *
 * cacheReadTokens / cacheCreationTokens are present when a stage used
 * Anthropic prompt caching.
 */
export type CostSiteBreakdown = Record<
  string,
  {
    totalTokens: number;
    totalCostUSD: number;
    calls: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    /** USD saved by caching on this site vs a no-cache hypothetical. */
    cacheSavingsUSD?: number;
  }
>;

export interface CostBreakdown {
  totalTokens: number;
  totalCostUSD: number;
  llmCalls: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cacheSavingsUSD?: number;
  breakdown?: CostSiteBreakdown;
  schemaRetries?: Record<string, { attempts: number; calls: number; fallbacks: number }>;
  forgeStats?: { attempts: number; approved: number; rejected: number; approvedConfidenceSum: number };
}

export interface GameState {
  /** Per-actor state, keyed by `actor.name` (matches SimEvent.leader). */
  actors: Record<string, ActorSideState>;
  /** Launch order. actorIds[0] renders in the first column, actorIds[1] second.
   *  F2/F3 will generalize to N-column rendering against the full list. */
  actorIds: string[];
  turn: number;
  time: number;
  maxTurns: number;
  seed: number;
  isRunning: boolean;
  isComplete: boolean;
  /** True when any actor in the run hit `sim_aborted` (server cancelled
   *  the run, watchdog tripped, etc.). Distinct from `isComplete`: an
   *  aborted run is also complete (no more events coming) but the UI
   *  should label per-turn empty cells as "interrupted" rather than
   *  "catching up", which implies the LLM is still working. */
  isAborted: boolean;
  /** Combined cost across all actors. */
  cost: CostBreakdown;
  /** Per-actor cost. Keyed by actor name so N-actor arena mode (P2)
   *  inherits per-actor accounting without another refactor. */
  costByActor: Record<string, CostBreakdown>;
}

/**
 * Map a leader index to its CSS color custom property. Index 0 is the
 * "visionary" palette, index 1 is "engineer". Indices 2+ fall back to
 * amber for now; F2/F3 extends the palette when N>2 rendering ships.
 */
export function getActorColorVar(index: number): string {
  if (index === 0) return 'var(--vis)';
  if (index === 1) return 'var(--eng)';
  return 'var(--amber)';
}

/**
 * Construct a fresh per-leader state. Exported so tests and future
 * reducers can initialize new leaders without replicating the field list.
 */
export function createEmptyActorSideState(): ActorSideState {
  return {
    leader: null, metrics: null, prevMetrics: null, event: null,
    events: [], popHistory: [], moraleHistory: [],
    deaths: 0, deathCauses: {}, tools: 0, toolNames: new Set<string>(), citations: 0, decisions: 0,
    pendingDecision: '', pendingRationale: '', pendingReasoning: '', pendingPolicies: [],
    outcome: null, agentSnapshots: [], currentEvents: [],
  };
}

function emptyCost(): CostBreakdown {
  return { totalTokens: 0, totalCostUSD: 0, llmCalls: 0 };
}

/**
 * Pure reducer: turn an SSE event list into the full GameState. Wrapped
 * in useMemo by the hook below; exported here for direct unit testing
 * without a React render context (matches the useRetryStats pattern).
 */
export function computeGameState(sseEvents: SimEvent[], isComplete: boolean): GameState {
  const state: GameState = {
    actors: {},
    actorIds: [],
    turn: 0, time: 0, maxTurns: 6, seed: 950,
    isRunning: false, isComplete, isAborted: false,
    cost: emptyCost(),
    costByActor: {},
  };

  /**
   * Resolve (or lazily create) per-leader state. First-seen order drives
   * actorIds so the dashboard's leader-column ordering is stable and
   * deterministic. Returns null only if the event's leader field is
   * empty (server-synthetic events like sim_saved).
   */
  const getActorSide = (actorName: string): ActorSideState | null => {
    if (!actorName) return null;
    let s = state.actors[actorName];
    if (!s) {
      s = createEmptyActorSideState();
      state.actors[actorName] = s;
      state.actorIds.push(actorName);
    }
    return s;
  };

  for (let i = 0; i < sseEvents.length; i++) {
    const evt = sseEvents[i];
    const dd = evt.data || {};
    const actorName = evt.leader || '';

    // Per-leader cost tracking. Each event's _cost payload is the
    // CUMULATIVE spend for that leader, so we overwrite the slot rather
    // than accumulate. Combined totals get recomputed below.
    const evtCost = dd._cost as {
      totalTokens?: number;
      totalCostUSD?: number;
      llmCalls?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      cacheSavingsUSD?: number;
      breakdown?: CostSiteBreakdown;
      schemaRetries?: Record<string, { attempts: number; calls: number; fallbacks: number }>;
      forgeStats?: { attempts: number; approved: number; rejected: number; approvedConfidenceSum: number };
    } | undefined;

    if (evtCost && actorName) {
      // Guarantee the leader exists in the map so cost tracking
      // stays consistent even if no state-shaping event has landed yet
      // for this leader (rare but possible on cost-before-turn ordering).
      getActorSide(actorName);
      state.costByActor[actorName] = {
        totalTokens: evtCost.totalTokens ?? 0,
        totalCostUSD: evtCost.totalCostUSD ?? 0,
        llmCalls: evtCost.llmCalls ?? 0,
        cacheReadTokens: evtCost.cacheReadTokens ?? 0,
        cacheCreationTokens: evtCost.cacheCreationTokens ?? 0,
        cacheSavingsUSD: evtCost.cacheSavingsUSD ?? 0,
        breakdown: evtCost.breakdown,
        schemaRetries: evtCost.schemaRetries,
        forgeStats: evtCost.forgeStats,
      };

      // Recompute combined totals across ALL leaders. The old hook only
      // merged 2; this generalization folds in every entry in the map,
      // so N-leader arena runs get correct totals with no extra work.
      const leaderCosts = Object.values(state.costByActor);

      const mergedBreakdown: CostSiteBreakdown = {};
      for (const c of leaderCosts) {
        if (!c.breakdown) continue;
        for (const [siteKey, bucket] of Object.entries(c.breakdown)) {
          const existing = mergedBreakdown[siteKey] ?? {
            totalTokens: 0, totalCostUSD: 0, calls: 0,
            cacheReadTokens: 0, cacheCreationTokens: 0, cacheSavingsUSD: 0,
          };
          mergedBreakdown[siteKey] = {
            totalTokens: existing.totalTokens + (bucket?.totalTokens ?? 0),
            totalCostUSD: Math.round((existing.totalCostUSD + (bucket?.totalCostUSD ?? 0)) * 10000) / 10000,
            calls: existing.calls + (bucket?.calls ?? 0),
            cacheReadTokens: (existing.cacheReadTokens ?? 0) + (bucket?.cacheReadTokens ?? 0),
            cacheCreationTokens: (existing.cacheCreationTokens ?? 0) + (bucket?.cacheCreationTokens ?? 0),
            cacheSavingsUSD: Math.round(((existing.cacheSavingsUSD ?? 0) + (bucket?.cacheSavingsUSD ?? 0)) * 10000) / 10000,
          };
        }
      }

      const mergedSchemaRetries: Record<string, { attempts: number; calls: number; fallbacks: number }> = {};
      for (const c of leaderCosts) {
        if (!c.schemaRetries) continue;
        for (const [schemaName, bucket] of Object.entries(c.schemaRetries)) {
          const existing = mergedSchemaRetries[schemaName] ?? { attempts: 0, calls: 0, fallbacks: 0 };
          mergedSchemaRetries[schemaName] = {
            attempts: existing.attempts + bucket.attempts,
            calls: existing.calls + bucket.calls,
            fallbacks: existing.fallbacks + bucket.fallbacks,
          };
        }
      }

      const mergedForgeStats = (() => {
        const stats = leaderCosts.map(c => c.forgeStats).filter((x): x is NonNullable<typeof x> => !!x);
        if (stats.length === 0) return undefined;
        return stats.reduce(
          (acc, s) => ({
            attempts: acc.attempts + s.attempts,
            approved: acc.approved + s.approved,
            rejected: acc.rejected + s.rejected,
            approvedConfidenceSum: acc.approvedConfidenceSum + s.approvedConfidenceSum,
          }),
          { attempts: 0, approved: 0, rejected: 0, approvedConfidenceSum: 0 },
        );
      })();

      state.cost = {
        totalTokens: leaderCosts.reduce((sum, c) => sum + c.totalTokens, 0),
        totalCostUSD: Math.round(leaderCosts.reduce((sum, c) => sum + c.totalCostUSD, 0) * 10000) / 10000,
        llmCalls: leaderCosts.reduce((sum, c) => sum + c.llmCalls, 0),
        cacheReadTokens: leaderCosts.reduce((sum, c) => sum + (c.cacheReadTokens ?? 0), 0),
        cacheCreationTokens: leaderCosts.reduce((sum, c) => sum + (c.cacheCreationTokens ?? 0), 0),
        cacheSavingsUSD: Math.round(leaderCosts.reduce((sum, c) => sum + (c.cacheSavingsUSD ?? 0), 0) * 10000) / 10000,
        breakdown: Object.keys(mergedBreakdown).length > 0 ? mergedBreakdown : undefined,
        schemaRetries: Object.keys(mergedSchemaRetries).length > 0 ? mergedSchemaRetries : undefined,
        forgeStats: mergedForgeStats,
      };
    }

    // Status events carry run-wide metadata + actor roster. They're
    // actor-less at the SimEvent layer (leader = '') so they don't
    // create per-actor state; the actor roster payload explicitly
    // populates actors for every entry it carries.
    if (evt.type === 'status') {
      if (dd.maxTurns) state.maxTurns = dd.maxTurns as number;
      if (dd.phase === 'parallel' && Array.isArray(dd.actors)) {
        const actors = dd.actors as LeaderInfo[];
        for (const actorInfo of actors) {
          if (!actorInfo?.name) continue;
          const s = getActorSide(actorInfo.name);
          if (s) s.leader = actorInfo;
        }
        state.isRunning = true;
      }
      continue;
    }

    const s = getActorSide(actorName);
    if (!s) continue;

    const processed: ProcessedEvent = {
      id: `${i}-${evt.type}`,
      type: evt.type,
      turn: dd.turn as number | undefined,
      time: dd.time as number | undefined,
      data: dd,
    };

    switch (evt.type) {
      case 'event_start': {
        const info = {
          eventIndex: Number(dd.eventIndex ?? 0),
          totalEvents: Number(dd.totalEvents ?? 1),
          title: String(dd.title || ''),
          category: String(dd.category || ''),
        };
        s.currentEvents.push(info);
        if (info.totalEvents > 1) {
          s.event = {
            turn: dd.turn as number,
            time: dd.time as number,
            title: `${info.eventIndex + 1}/${info.totalEvents}: ${info.title}`,
            description: dd.description as string || '',
            category: info.category,
            emergent: dd.emergent as boolean || false,
            turnSummary: dd.turnSummary as string || '',
          };
        }
        s.events.push(processed);
        break;
      }

      case 'turn_start':
        s.currentEvents = [];
        if (dd.turn) state.turn = dd.turn as number;
        if (dd.time) state.time = dd.time as number;
        if (dd.title && dd.title !== 'Director generating...') {
          s.event = {
            turn: dd.turn as number,
            time: dd.time as number,
            title: dd.title as string,
            description: dd.crisis as string || '',
            category: dd.category as string || '',
            emergent: dd.emergent as boolean || false,
            turnSummary: dd.turnSummary as string || '',
          };
        }
        if (dd.metrics) {
          s.prevMetrics = s.metrics ? { ...s.metrics } : null;
          s.metrics = dd.metrics as MetricsState;
          s.popHistory.push((dd.metrics as MetricsState).population || 0);
          s.moraleHistory.push(Math.round(((dd.metrics as MetricsState).morale || 0) * 100));
        }
        if (dd.deaths) s.deaths += Number(dd.deaths) || 0;
        s.events.push(processed);
        break;

      case 'promotion':
      case 'specialist_start':
      case 'forge_attempt':
        // forge_attempt: orchestrator streams these as tools get invented.
        // Do NOT increment s.tools here; specialist_done is the authoritative
        // dedup source for the unique-tool count.
      case 'decision_pending':
      case 'personality_drift':
      case 'agent_reactions':
      case 'bulletin':
        s.events.push(processed);
        break;

      case 'specialist_done': {
        // Keep every named forge in _filteredTools (approved + rejected)
        // so the Toolbox can render "attempted but failed" cards, but
        // only count APPROVED tools toward the TOOLS stat.
        const allTools = Array.isArray(dd.forgedTools) ? dd.forgedTools.filter((t: any) => t?.name && t.name !== 'unnamed') : [];
        for (const t of allTools) {
          const name = String(t.name || '').trim();
          if (!name) continue;
          if (t.approved !== false && !s.toolNames.has(name)) {
            s.toolNames.add(name);
          }
        }
        s.tools = s.toolNames.size;
        s.citations += Number(dd.citations) || 0;
        s.events.push({ ...processed, data: { ...dd, _filteredTools: allTools } });
        break;
      }

      case 'decision_made':
        s.pendingDecision = dd.decision as string || '';
        s.pendingRationale = dd.rationale as string || '';
        s.pendingReasoning = dd.reasoning as string || '';
        s.pendingPolicies = (dd.selectedPolicies as string[]) || [];
        break;

      case 'outcome': {
        const outcome = dd.outcome as string || '';
        s.outcome = outcome;
        s.decisions++;
        s.events.push({
          ...processed,
          data: {
            ...dd,
            _decision: s.pendingDecision,
            _rationale: s.pendingRationale,
            _reasoning: s.pendingReasoning,
            _policies: s.pendingPolicies,
          },
        });
        break;
      }

      case 'systems_snapshot':
        s.agentSnapshots.push((dd.agents as AgentSnapshot[]) || []);
        s.events.push(processed);
        break;

      case 'turn_done':
        if (dd.metrics) {
          s.prevMetrics = s.metrics ? { ...s.metrics } : null;
          s.metrics = dd.metrics as MetricsState;
        }
        if (dd.statuses && typeof dd.statuses === 'object') {
          s.statuses = { ...dd.statuses as Record<string, string | boolean> };
        }
        if (dd.environment && typeof dd.environment === 'object') {
          s.environment = { ...dd.environment as Record<string, number | string | boolean> };
        }
        if (dd.deathCauses && typeof dd.deathCauses === 'object') {
          for (const [cause, n] of Object.entries(dd.deathCauses as Record<string, number>)) {
            if (typeof n !== 'number' || n <= 0) continue;
            s.deathCauses[cause] = (s.deathCauses[cause] ?? 0) + n;
          }
        }
        s.events.push(processed);
        break;
    }
  }

  // Reconciliation: once the run reached a terminal state, isRunning
  // stays false even if an earlier status event tried to flip it true.
  // Without this, reloading a page with a completed/aborted run in the
  // event buffer would leave isRunning stuck at true forever.
  const aborted = sseEvents.some(e => e.type === 'sim_aborted');
  state.isAborted = aborted;
  if (state.isComplete || aborted) {
    state.isRunning = false;
  }

  return state;
}

export function useGameState(sseEvents: SimEvent[], isComplete: boolean): GameState {
  return useMemo(() => computeGameState(sseEvents, isComplete), [sseEvents, isComplete]);
}
