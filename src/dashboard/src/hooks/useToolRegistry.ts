import { useMemo, createContext, useContext } from 'react';
import type { GameState } from './useGameState';

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
  /** Stable index for [N] referencing in EventCards / Toolbox section. */
  n: number;
  name: string;
  description: string;
  mode: string;
  /** First turn this tool was forged in the simulation. */
  firstForgedTurn: number;
  firstForgedDepartment: string;
  /** All departments that referenced this tool across the run. */
  departments: Set<string>;
  /** Leaders (by name) that referenced it, for divergence display. */
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
}

export interface ToolRegistry {
  /** Look up the global number for a tool by name. Returns 0 if unknown. */
  getNumber: (name: string) => number;
  getEntry: (name: string) => ToolEntry | undefined;
  /** Full list ordered by first-forge turn, then department. */
  list: ToolEntry[];
}

const EMPTY_REGISTRY: ToolRegistry = {
  getNumber: () => 0,
  getEntry: () => undefined,
  list: [],
};

/**
 * Build the per-simulation tool ledger from SSE specialist_done events. Tools
 * dedupe by name; the entry remembers when it was first forged, every
 * department that used it, and how many times it was reused.
 *
 * Schema fields (`inputSchema`, `outputSchema`) are populated by the
 * orchestrator from the EmergentToolRegistry when the tool first appears,
 * so the same registry that drives the engine drives the UI provenance.
 */
export function useToolRegistry(state: GameState): ToolRegistry {
  return useMemo(() => {
    const byName = new Map<string, ToolEntry>();
    const list: ToolEntry[] = [];
    let next = 1;

    for (const actorName of state.actorIds) {
      const sideState = state.actors[actorName];
      if (!sideState) continue;
      for (const evt of sideState.events) {
        if (evt.type !== 'specialist_done') continue;
        const tools = (evt.data?._filteredTools as Array<Record<string, unknown>>) || [];
        const dept = String(evt.data?.department || '');
        for (const t of tools) {
          const name = String(t.name || '').trim();
          if (!name || name === 'unnamed') continue;

          let entry = byName.get(name);
          if (!entry) {
            entry = {
              n: next++,
              name,
              description: String(t.description || name),
              mode: String(t.mode || 'sandbox'),
              firstForgedTurn: typeof t.firstForgedTurn === 'number' ? (t.firstForgedTurn as number) : (evt.turn ?? 0),
              firstForgedDepartment: String(t.firstForgedDepartment || dept),
              departments: new Set(),
              actorNames: new Set(),
              reuseCount: 0,
              reforgeCount: 0,
              rejectedReforges: 0,
              confidence: typeof t.confidence === 'number'
                ? (t.confidence as number)
                : (t.approved !== false ? 0.85 : 0),
              approved: t.approved !== false,
              inputSchema: t.inputSchema,
              outputSchema: t.outputSchema,
              sampleOutput: typeof t.output === 'string' ? (t.output as string) : null,
              errorReason: typeof t.errorReason === 'string' ? (t.errorReason as string) : undefined,
              inputFields: Array.isArray(t.inputFields) ? (t.inputFields as string[]) : [],
              outputFields: Array.isArray(t.outputFields) ? (t.outputFields as string[]) : [],
              history: [],
            };
            byName.set(name, entry);
            list.push(entry);
          } else {
            if (typeof t.output === 'string' && t.output) entry.sampleOutput = t.output as string;
            if (typeof t.confidence === 'number' && (t.confidence as number) > entry.confidence) {
              entry.confidence = t.confidence as number;
            }
            if (t.approved !== false) {
              entry.approved = true;
            }
            if (!entry.inputSchema && t.inputSchema) entry.inputSchema = t.inputSchema;
            if (!entry.outputSchema && t.outputSchema) entry.outputSchema = t.outputSchema;
            if (entry.approved) {
              entry.errorReason = undefined;
            } else if (typeof t.errorReason === 'string' && t.errorReason) {
              entry.errorReason = t.errorReason as string;
            }
          }
          if (dept) entry.departments.add(dept);
          entry.actorNames.add(actorName);

          const serverHistory = (t.history as Array<{
            turn: number; time: number; eventIndex: number; eventTitle: string;
            department: string; output: string | null;
            isReforge: boolean; rejected: boolean; confidence?: number;
          }>) || null;
          if (Array.isArray(serverHistory)) {
            entry.history = serverHistory.map(h => ({ ...h, actorName }));
            entry.reuseCount = Math.max(0, serverHistory.length - 1);
            entry.reforgeCount = serverHistory.filter(h => h.isReforge).length;
            entry.rejectedReforges = serverHistory.filter(h => h.isReforge && h.rejected).length;
          }
        }
      }
    }

    // Failsafe pass: scan forge_attempt events directly and include any
    // tool name that ONLY ever appeared as rejected (never made it into
    // a specialist_done summary with an approved record). Covers the edge case
    // where a forge fails and the dept bails on that tool entirely —
    // those attempts wouldn't land in specialist_done.forgedTools but ARE in
    // the live forge_attempt stream, and users need to see terminal
    // failures in the toolbox to understand what was tried.
    for (const actorName of state.actorIds) {
      const sideState = state.actors[actorName];
      if (!sideState) continue;
      for (const evt of sideState.events) {
        if (evt.type !== 'forge_attempt') continue;
        const d = (evt.data as Record<string, unknown>) || {};
        const name = String(d.name || '').trim();
        if (!name || name === 'unnamed') continue;
        if (byName.has(name)) continue;
        if (d.approved === true) continue;
        const failEntry: ToolEntry = {
          n: next++,
          name,
          description: String(d.description || name),
          mode: String(d.mode || 'sandbox'),
          firstForgedTurn: Number(d.turn ?? evt.turn ?? 0),
          firstForgedDepartment: String(d.department || ''),
          departments: new Set<string>(
            typeof d.department === 'string' && d.department ? [d.department] : [],
          ),
          actorNames: new Set<string>([actorName]),
          reuseCount: 0,
          reforgeCount: 0,
          rejectedReforges: 1,
          confidence: typeof d.confidence === 'number' ? (d.confidence as number) : 0,
          approved: false,
          inputSchema: undefined,
          outputSchema: undefined,
          sampleOutput: null,
          errorReason: typeof d.errorReason === 'string' ? (d.errorReason as string) : undefined,
          inputFields: Array.isArray(d.inputFields) ? (d.inputFields as string[]) : [],
          outputFields: Array.isArray(d.outputFields) ? (d.outputFields as string[]) : [],
          history: [
            {
              turn: Number(d.turn ?? evt.turn ?? 0),
              time: Number(d.time ?? 0),
              eventIndex: Number(d.eventIndex ?? 0),
              eventTitle: '',
              department: String(d.department || ''),
              output: null,
              isReforge: false,
              rejected: true,
              confidence:
                typeof d.confidence === 'number' ? (d.confidence as number) : undefined,
              actorName,
            },
          ],
        };
        byName.set(name, failEntry);
        list.push(failEntry);
      }
    }

    return {
      getNumber: (name: string) => byName.get(name)?.n ?? 0,
      getEntry: (name: string) => byName.get(name),
      list,
    };
  }, [state]);
}

export const ToolRegistryContext = createContext<ToolRegistry>(EMPTY_REGISTRY);

export function useToolContext(): ToolRegistry {
  return useContext(ToolRegistryContext);
}
