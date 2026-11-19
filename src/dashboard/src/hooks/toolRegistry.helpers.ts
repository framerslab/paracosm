import type { GameState, ProcessedEvent } from './useGameState';
import type {
  ActorSummary,
  ForgeAttemptRecord,
  ForgeCounts,
  RecordOutcome,
  ToolEntry,
  ToolRegistry,
} from './useToolRegistry';

/** A row of a tool's history as the orchestrator sends it in a report's record. */
interface ServerHistoryRow {
  turn: number;
  time: number;
  eventIndex: number;
  eventTitle: string;
  department: string;
  output: string | null;
  isReforge: boolean;
  rejected: boolean;
  confidence?: number;
}

const zeroCounts = (): ForgeCounts => ({ tools: 0, forges: 0, reforges: 0, passed: 0, didNotPass: 0 });

/** The name the registry keys a tool by: trimmed, and never the orchestrator's placeholder. */
function toolName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  return name === 'unnamed' ? '' : name;
}

const fieldList = (raw: unknown): string[] => (Array.isArray(raw) ? (raw as string[]) : []);

/**
 * A department report that lists its tools in a shape the page cannot read:
 * `forgedTools` is present and not a list. The reducer turns such a field into
 * an empty `_filteredTools` and keeps the raw field beside it.
 */
function unreadableReport(evt: ProcessedEvent): boolean {
  if (evt.type !== 'specialist_done') return false;
  const listed = evt.data?.forgedTools;
  return listed !== undefined && listed !== null && !Array.isArray(listed);
}

function newEntry(
  name: string,
  actorIndex: number,
  actorName: string,
  first: {
    description: unknown; mode: unknown; turn: number; department: string;
    confidence: number; approved: boolean; errorReason: string | undefined;
    inputFields: unknown; outputFields: unknown;
  },
): ToolEntry {
  return {
    n: 0,
    name,
    description: String(first.description || name),
    mode: String(first.mode || 'sandbox'),
    firstForgedTurn: first.turn,
    firstForgedDepartment: first.department,
    departments: new Set(),
    actorNames: new Set([actorName]),
    reuseCount: 0,
    reforgeCount: 0,
    rejectedReforges: 0,
    confidence: first.confidence,
    approved: first.approved,
    inputSchema: undefined,
    outputSchema: undefined,
    sampleOutput: null,
    errorReason: first.errorReason,
    inputFields: fieldList(first.inputFields),
    outputFields: fieldList(first.outputFields),
    history: [],
    actorIndex,
    actorName,
    attempts: [],
    outcome: first.approved ? 'passed' : 'did_not_pass',
    sameNameActors: [],
  };
}

/**
 * One actor's tools from its own events, in the order each first appears in
 * its stream (a forge or a report, whichever comes first): every forge_attempt
 * frame is an attempt of its tool, every report's record updates the tool, and
 * a name only forged, never reported, is a tool too. Also returns the actor's
 * forges' outcomes in stream order.
 */
function actorTools(
  events: ProcessedEvent[],
  actorIndex: number,
  actorName: string,
): { entries: ToolEntry[]; strip: RecordOutcome[] } {
  const titles = new Map<string, string>();
  for (const evt of events) {
    if (evt.type !== 'event_start') continue;
    const key = `${Number(evt.data?.turn ?? evt.turn ?? 0)}:${Number(evt.data?.eventIndex ?? 0)}`;
    if (!titles.has(key)) titles.set(key, String(evt.data?.title ?? ''));
  }

  const byName = new Map<string, ToolEntry>();
  const entries: ToolEntry[] = [];
  /** Each reported tool's latest report: whether it listed the tool as approved. */
  const reported = new Map<ToolEntry, boolean>();
  const strip: RecordOutcome[] = [];

  for (const evt of events) {
    const d: Record<string, unknown> = evt.data ?? {};

    if (evt.type === 'forge_attempt') {
      const name = toolName(d.name);
      if (!name) continue;
      const turn = Number(d.turn ?? evt.turn ?? 0);
      const eventIndex = Number(d.eventIndex ?? 0);
      const department = String(d.department ?? '');
      const approved = d.approved === true;
      const confidence = typeof d.confidence === 'number' ? d.confidence : null;
      const errorReason = typeof d.errorReason === 'string' && d.errorReason ? d.errorReason : null;

      let entry = byName.get(name);
      if (!entry) {
        entry = newEntry(name, actorIndex, actorName, {
          description: d.description, mode: d.mode, turn, department,
          confidence: confidence ?? 0, approved, errorReason: errorReason ?? undefined,
          inputFields: d.inputFields, outputFields: d.outputFields,
        });
        byName.set(name, entry);
        entries.push(entry);
      }
      const attempt: ForgeAttemptRecord = {
        attempt: entry.attempts.length + 1,
        turn,
        time: Number(d.time ?? 0),
        eventIndex,
        department,
        eventTitle: titles.get(`${turn}:${eventIndex}`) ?? '',
        approved,
        confidence,
        errorReason,
        description: String(d.description ?? ''),
        inputFields: fieldList(d.inputFields),
        outputFields: fieldList(d.outputFields),
        eventId: evt.id,
      };
      entry.attempts.push(attempt);
      if (department) entry.departments.add(department);
      if (confidence !== null && confidence > entry.confidence) entry.confidence = confidence;
      if (approved) {
        entry.approved = true;
        entry.errorReason = undefined;
      } else if (!entry.approved && errorReason) {
        entry.errorReason = errorReason;
      }
      strip.push(approved ? 'passed' : 'did_not_pass');
      continue;
    }

    if (evt.type !== 'specialist_done') continue;
    const tools = Array.isArray(d._filteredTools) ? (d._filteredTools as Array<Record<string, unknown>>) : [];
    const dept = String(d.department || '');
    for (const t of tools) {
      const name = toolName(t.name);
      if (!name) continue;
      const listedApproved = t.approved !== false;

      let entry = byName.get(name);
      if (!entry) {
        entry = newEntry(name, actorIndex, actorName, {
          description: t.description, mode: t.mode,
          turn: typeof t.firstForgedTurn === 'number' ? t.firstForgedTurn : (evt.turn ?? 0),
          department: String(t.firstForgedDepartment || dept),
          confidence: typeof t.confidence === 'number' ? t.confidence : (listedApproved ? 0.85 : 0),
          approved: listedApproved,
          errorReason: typeof t.errorReason === 'string' ? t.errorReason : undefined,
          inputFields: t.inputFields, outputFields: t.outputFields,
        });
        byName.set(name, entry);
        entries.push(entry);
      } else {
        if (!reported.has(entry)) {
          // The report is the registry's own record of the tool: its first one
          // names where the tool was first forged and what it takes and returns.
          if (typeof t.description === 'string' && t.description) entry.description = t.description;
          if (typeof t.mode === 'string' && t.mode) entry.mode = t.mode;
          if (typeof t.firstForgedTurn === 'number') entry.firstForgedTurn = t.firstForgedTurn;
          if (typeof t.firstForgedDepartment === 'string' && t.firstForgedDepartment) entry.firstForgedDepartment = t.firstForgedDepartment;
          if (Array.isArray(t.inputFields)) entry.inputFields = t.inputFields as string[];
          if (Array.isArray(t.outputFields)) entry.outputFields = t.outputFields as string[];
        }
        if (typeof t.confidence === 'number' && t.confidence > entry.confidence) entry.confidence = t.confidence;
        if (listedApproved) entry.approved = true;
        if (entry.approved) {
          entry.errorReason = undefined;
        } else if (typeof t.errorReason === 'string' && t.errorReason) {
          entry.errorReason = t.errorReason;
        }
      }
      if (typeof t.output === 'string' && (t.output || entry.sampleOutput === null)) entry.sampleOutput = t.output;
      if (!entry.inputSchema && t.inputSchema) entry.inputSchema = t.inputSchema;
      if (!entry.outputSchema && t.outputSchema) entry.outputSchema = t.outputSchema;
      if (dept) entry.departments.add(dept);
      reported.set(entry, listedApproved);

      // The report's history is the actor's own registry's: every forge and use of this tool so far.
      if (Array.isArray(t.history)) {
        const serverHistory = t.history as ServerHistoryRow[];
        entry.history = serverHistory.map(h => ({ ...h, actorName }));
        entry.reuseCount = Math.max(0, serverHistory.length - 1);
        entry.reforgeCount = serverHistory.filter(h => h.isReforge).length;
        entry.rejectedReforges = serverHistory.filter(h => h.isReforge && h.rejected).length;
      }
    }
  }

  for (const entry of entries) {
    if (!reported.has(entry)) {
      // Only forged, never reported: its forges are its history, and nothing used it.
      entry.history = entry.attempts.map((a, i) => ({
        turn: a.turn,
        time: a.time,
        eventIndex: a.eventIndex,
        eventTitle: a.eventTitle,
        department: a.department,
        output: null,
        isReforge: i > 0,
        rejected: !a.approved,
        confidence: a.confidence ?? undefined,
        actorName,
      }));
      entry.reforgeCount = Math.max(0, entry.attempts.length - 1);
      entry.rejectedReforges = entry.attempts.filter(a => !a.approved).length;
    }
    const last = entry.attempts[entry.attempts.length - 1];
    const passed = last ? last.approved : reported.get(entry) !== false;
    entry.outcome = passed ? 'passed' : 'did_not_pass';
  }

  return { entries, strip };
}

function add(into: ForgeCounts, more: ForgeCounts): void {
  into.tools += more.tools;
  into.forges += more.forges;
  into.reforges += more.reforges;
  into.passed += more.passed;
  into.didNotPass += more.didNotPass;
}

/**
 * The run's forged tools, one entry for each actor's tool. Each actor runs its
 * own simulation with its own tool registry (src/cli/pair-runner.ts), so a name
 * two actors forged is two entries, each with its own uses and attempts, and
 * each naming the other actors that hold a tool of that name.
 *
 * Entries run actor by actor in launch order (`state.actorIds`), each actor's
 * in the order its tools first appear in its stream; `n` is the position plus
 * 1. Forges are counted from the forge_attempt frames, so a tool known only
 * from a report (a run saved before those frames) adds a tool and no forge.
 * An actor with a report whose tools cannot be read is marked unreadable, adds
 * no tool (its forge_attempt frames included) and counts zero.
 */
export function buildToolRegistry(state: GameState): ToolRegistry {
  const list: ToolEntry[] = [];
  const actors: ActorSummary[] = [];
  const counts = zeroCounts();
  const byActorAndName = new Map<string, ToolEntry>();
  const byName = new Map<string, ToolEntry[]>();
  const keyOf = (actorIndex: number, name: string): string => `${actorIndex}\u0000${name}`;

  state.actorIds.forEach((actorName, actorIndex) => {
    const side = state.actors[actorName];
    const events = side?.events ?? [];
    const unreadable = events.some(unreadableReport);
    const { entries, strip }: { entries: ToolEntry[]; strip: RecordOutcome[] } = unreadable
      ? { entries: [], strip: [] }
      : actorTools(events, actorIndex, actorName);

    const actorCounts = zeroCounts();
    for (const entry of entries) {
      entry.n = list.length + 1;
      list.push(entry);
      byActorAndName.set(keyOf(actorIndex, entry.name), entry);
      const same = byName.get(entry.name);
      if (same) same.push(entry);
      else byName.set(entry.name, [entry]);

      const passed = entry.attempts.filter(a => a.approved).length;
      add(actorCounts, {
        tools: 1,
        forges: entry.attempts.length,
        reforges: Math.max(0, entry.attempts.length - 1),
        passed,
        didNotPass: entry.attempts.length - passed,
      });
    }
    add(counts, actorCounts);

    actors.push({
      index: actorIndex,
      label: `A${actorIndex + 1}`,
      name: actorName,
      archetype: side?.leader?.archetype ?? '',
      counts: actorCounts,
      strip,
      status: state.isComplete ? 'done' : events.length === 0 ? 'waiting' : 'running',
      unreadable,
    });
  });

  for (const entries of byName.values()) {
    for (const entry of entries) {
      entry.sameNameActors = entries.filter(other => other !== entry).map(other => other.actorIndex);
    }
  }

  return {
    getNumber: (name: string) => byName.get(name.trim())?.[0]?.n ?? 0,
    getEntry: (name: string) => byName.get(name.trim())?.[0],
    getEntryFor: (actorIndex: number, name: string) => byActorAndName.get(keyOf(actorIndex, name.trim())),
    getEntryByNumber: (n: number) => (Number.isInteger(n) && n >= 1 ? list[n - 1] : undefined),
    list,
    actors,
    counts,
  };
}
