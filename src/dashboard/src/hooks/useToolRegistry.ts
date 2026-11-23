import { useMemo, createContext, useContext } from 'react';
import type { GameState } from './useGameState';
import { buildToolRegistry } from './toolRegistry.helpers';

/** What the record says of a forge: the judge passed it, or it did not pass. */
export type RecordOutcome = 'passed' | 'did_not_pass';

/** One forge of one actor's tool, read from its forge_attempt frame. */
export interface ForgeAttemptRecord {
  /** 1-based, in stream order, within one actor's tool. */
  attempt: number;
  turn: number;
  time: number;
  eventIndex: number;
  department: string;
  /** The title of that turn's event at eventIndex (its event_start frame), '' when absent. */
  eventTitle: string;
  approved: boolean;
  confidence: number | null;
  /** The record's text as sent (240 characters at most). */
  errorReason: string | null;
  description: string;
  inputFields: string[];
  outputFields: string[];
  /** The ProcessedEvent id of its forge_attempt frame. */
  eventId: string;
}

/** Tools, forges and their outcomes. Forges are the forge_attempt frames; passed and didNotPass add up to them. */
export interface ForgeCounts {
  tools: number;
  forges: number;
  /** Forges after a tool's first. */
  reforges: number;
  passed: number;
  didNotPass: number;
}

/** One actor of the run, in launch order, with its own registry's counts. */
export interface ActorSummary {
  index: number;
  /** 'A1'..'A300' (index + 1). */
  label: string;
  name: string;
  archetype: string;
  counts: ForgeCounts;
  /** One entry a forge, in turn order. */
  strip: RecordOutcome[];
  status: 'waiting' | 'running' | 'done';
  /** A department report of this actor listed its tools in a shape the page cannot read. */
  unreadable: boolean;
}

export interface ToolUseEvent {
  /** Which leader used the tool here (by name, the dedup key across
   *  the SSE event stream). Was `side: 'a' | 'b'` pre-F1. */
  actorName: string;
  turn: number;
  time: number;
  eventIndex: number;
  eventTitle: string;
  department: string;
  output: string | null;
  /** True if the LLM re-invoked forge_tool here (vs cited an existing one). */
  isReforge: boolean;
  /** Set when a re-forge attempt was rejected by the judge. */
  rejected: boolean;
  confidence?: number;
}

export interface ToolEntry {
  /** Stable index for [N] referencing in EventCards / Toolbox section: the entry's place in `list`, plus 1. */
  n: number;
  name: string;
  description: string;
  mode: string;
  /** First turn this tool was forged in the simulation. */
  firstForgedTurn: number;
  firstForgedDepartment: string;
  /** All departments of this actor that forged or referenced this tool. */
  departments: Set<string>;
  /** The actor that holds it, by name: one name, since each actor's tool is its own entry. */
  actorNames: Set<string>;
  /** Number of times reused after the first forge (across all events). */
  reuseCount: number;
  /** Of the reuses, how many were re-forge attempts (vs pure citations). */
  reforgeCount: number;
  /** Re-forge attempts that the judge rejected. */
  rejectedReforges: number;
  /** Maximum confidence reported by the LLM judge. */
  confidence: number;
  /** Whether the tool ever passed the judge (any non-failed mention). */
  approved: boolean;
  /** Latest input/output schema seen for this tool. */
  inputSchema?: unknown;
  outputSchema?: unknown;
  /** Latest sample output for this tool. */
  sampleOutput?: string | null;
  /**
   * The judge's stated reason the tool was REJECTED, when `approved` is
   * false. Undefined when the tool passed or when the orchestrator did
   * not capture a reason (older payloads). Rendered in the forge-verdict
   * tooltip so users can see WHY a forge failed, not just that it failed.
   */
  errorReason?: string;
  inputFields: string[];
  outputFields: string[];
  /** Full per-invocation history. Empty when the orchestrator hasn't
   *  attached one yet (older sim payloads); falls back to the count
   *  fields for display. */
  history: ToolUseEvent[];
  /** The actor whose registry holds this tool: its launch index and name. */
  actorIndex: number;
  actorName: string;
  /** Every forge of this tool by this actor, in stream order. Empty on a run whose stream holds no forge_attempt frame. */
  attempts: ForgeAttemptRecord[];
  /** The latest attempt's outcome; the latest report's `approved` when there is no attempt. */
  outcome: RecordOutcome;
  /** Launch indexes of the other actors that hold a tool of this name. */
  sameNameActors: number[];
}

export interface ToolRegistry {
  /** The number of the lowest-numbered entry of this name. Returns 0 if unknown. */
  getNumber: (name: string) => number;
  /** The lowest-numbered entry of this name. */
  getEntry: (name: string) => ToolEntry | undefined;
  /** One actor's tool of this name. */
  getEntryFor: (actorIndex: number, name: string) => ToolEntry | undefined;
  /** The entry numbered n (1-based). */
  getEntryByNumber: (n: number) => ToolEntry | undefined;
  /** Every entry in actor order, and within an actor in the order its tools first appear in its stream; `n` is the position plus 1. */
  list: ToolEntry[];
  /** Every actor of the run, in launch order. */
  actors: ActorSummary[];
  /** The whole run. */
  counts: ForgeCounts;
}

const EMPTY_REGISTRY: ToolRegistry = {
  getNumber: () => 0,
  getEntry: () => undefined,
  getEntryFor: () => undefined,
  getEntryByNumber: () => undefined,
  list: [],
  actors: [],
  counts: { tools: 0, forges: 0, reforges: 0, passed: 0, didNotPass: 0 },
};

/**
 * The run's forged tools, one entry for each actor's tool: each actor runs
 * its own simulation with its own tool registry, so a name two actors forged
 * is two entries, each with its own uses and attempts. Built by the pure
 * `buildToolRegistry` (toolRegistry.helpers.ts).
 *
 * Schema fields (`inputSchema`, `outputSchema`) are populated by the
 * orchestrator from the EmergentToolRegistry when the tool first appears,
 * so the same registry that drives the engine drives the UI provenance.
 */
export function useToolRegistry(state: GameState): ToolRegistry {
  return useMemo(() => buildToolRegistry(state), [state]);
}

export const ToolRegistryContext = createContext<ToolRegistry>(EMPTY_REGISTRY);

export function useToolContext(): ToolRegistry {
  return useContext(ToolRegistryContext);
}
