/**
 * Forged-tool ledger types + prompt-block builder.
 *
 * The orchestrator keeps a per-tool history of every invocation across
 * a run so the dashboard can show WHEN a tool was first forged, WHICH
 * department invoked it, WHAT each invocation produced, and whether
 * each appearance was a fresh forge, a re-forge, or a pure citation.
 *
 * These shapes + the "ALREADY-FORGED TOOLS" context block builder
 * extracted here are pure data structures and a pure text generator —
 * no IO, no side effects — so they move cleanly out of the
 * turn-loop soup.
 *
 * @module paracosm/runtime/tool-ledger
 */

/** A single invocation of a forged tool, appended to the tool's history. */
export interface ToolUseRecord {
  turn: number;
  time: number;
  eventIndex: number;
  eventTitle: string;
  department: string;
  /** What the tool produced this invocation (string-truncated to 400). */
  output: string | null;
  /** True when the LLM re-invoked forge_tool (vs cited an existing tool). */
  isReforge: boolean;
  /** Set when isReforge=true and the judge rejected the new attempt. */
  rejected: boolean;
  /** Judge confidence on this invocation (only meaningful for forge calls). */
  confidence?: number;
}

/** Per-tool ledger entry. First-forge metadata + full history. */
export interface ForgedToolLedgerEntry {
  firstForgedTurn: number;
  firstForgedDepartment: string;
  firstForgedEventIndex: number;
  firstForgedEventTitle: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  /** Append-only history of every invocation across the run. */
  history: ToolUseRecord[];
}

/** Shorthand alias used across the orchestrator's closures. */
export type ForgedLedger = Map<string, ForgedToolLedgerEntry>;

/**
 * Whether the reviewers approved a tool, from its ledger entry: one of its
 * forges passed. A department that cites a tool without calling forge_tool
 * writes a use that is not rejected, and that use approves nothing: a tool
 * whose every forge was rejected stays rejected however often it is cited.
 * A tool that first appears as such a use is a forge the run did not
 * capture, which a department's report names, and that first use counts.
 */
function ledgerApproved(entry: ForgedToolLedgerEntry): boolean {
  const first = entry.history[0];
  if (first && !first.isReforge && !first.rejected) return true;
  return entry.history.some(h => h.isReforge && !h.rejected);
}

/**
 * Build the ALREADY-FORGED TOOLS block appended to every department's
 * per-turn context. Tells the LLM which tools are available to reuse,
 * shows each tool's last approved output so the LLM can cite a number
 * without re-forging, and enforces a hard rule against re-forging by
 * the same name.
 *
 * Only approved (non-rejected) tools appear. Capped at 20 most recent
 * so the block stays under ~500 tokens even in long runs.
 *
 * Returns an empty string when no tools have been approved yet, so
 * callers can concatenate unconditionally without an empty section
 * appearing in turn 1 prompts.
 */
export function buildAvailableToolsBlock(ledger: ForgedLedger): string {
  type Entry = { name: string; dept: string; title: string; output: string | null };
  const approved: Entry[] = [];
  for (const [name, entry] of ledger.entries()) {
    if (!ledgerApproved(entry)) continue;
    const lastApproved = [...entry.history].reverse().find(h => !h.rejected);
    if (!lastApproved) continue;
    approved.push({
      name,
      dept: entry.firstForgedDepartment,
      title: entry.firstForgedEventTitle || name,
      // Truncate aggressively so the block stays under a few hundred
      // tokens even with 20 tools. 180 chars covers a compact JSON
      // like {"score":42,"warnings":[]} which is what the LLM cites.
      output: lastApproved.output ? lastApproved.output.slice(0, 180) : null,
    });
  }
  if (approved.length === 0) return '';
  const lines = approved.slice(-20).reverse().map(t => {
    const head = `- ${t.name} (${t.dept}): ${t.title}`;
    return t.output ? `${head}\n  last output: ${t.output}` : head;
  }).join('\n');
  return `\n\nALREADY-FORGED TOOLS IN THIS SESSION:\n${lines}\n\nHARD RULE — how to reuse:\n- Preferred: call the tool for real with fresh inputs via call_forged_tool({"name":"<tool_name>","args":{...}}). This produces a new output using the approved, judge-reviewed code. Then cite the tool in "forgedToolsUsed" with the new output.\n- If the analysis is essentially unchanged from last invocation, cite the tool name in "forgedToolsUsed" and reference the last output from the list above in your summary — no tool call needed.\n- Do NOT call forge_tool with a name from this list. Re-forging costs −0.06 outcome bonus and −0.015 morale. Only forge a NEW tool when NO existing one applies. Each reuse (via call_forged_tool or citation) is +0.02 outcome bonus.\n`;
}

/** A forge as a department's forge_tool call captured it. */
export interface CapturedForgeForLedger {
  name: string;
  description: string;
  mode: string;
  approved: boolean;
  confidence: number;
  department: string;
  inputSchema: unknown;
  outputSchema: unknown;
  output: unknown;
}

/** The event a run's forges were made in. */
export interface ForgeEvent {
  turn: number;
  time: number;
  eventIndex: number;
  eventTitle: string;
}

/**
 * Take one event's captured forges into the run, in the order captured:
 * each joins `allForges` with the event's turn, time and index.
 */
export function recordEventForges<F extends CapturedForgeForLedger>(
  eventForges: readonly F[],
  event: ForgeEvent,
  ledger: ForgedLedger,
  allForges: Array<F & { turn: number; time: number; eventIndex: number }>,
): void {
  for (const forge of eventForges) {
    allForges.push({ ...forge, turn: event.turn, time: event.time, eventIndex: event.eventIndex });
  }
}

/** One entry in the canonical Forged Toolbox that ships in the run output. */
export interface ForgedToolboxEntry {
  name: string;
  description: string;
  mode: string;
  firstForgedTurn: number;
  firstForgedDepartment: string;
  firstForgedEventTitle: string;
  departments: string[];
  /** Total uses minus the original forge. */
  reuseCount: number;
  /** Total uses including the original forge. */
  totalUses: number;
  /** How many of those uses were re-forge attempts. */
  reforgeCount: number;
  /** Re-forge attempts that the judge rejected. */
  rejectedReforges: number;
  approved: boolean;
  confidence: number;
  inputSchema: unknown;
  outputSchema: unknown;
  sampleOutput: unknown;
  history: ToolUseRecord[];
}

/** Minimal shape of a captured forge event needed to hydrate toolbox entries. */
export interface ForgeCaptureForToolbox {
  name: string;
  description: string;
  mode: string;
  approved: boolean;
  confidence: number;
}

/**
 * Build the canonical Forged Toolbox from a completed run's ledger.
 * Deduplicates by tool name, preserves first-forge metadata, and rolls
 * up reuse/reforge/rejection counts from the full invocation history.
 * Pure function — takes the ledger + the raw stream of captured forge
 * events and returns a sorted, enriched array ready for serialization.
 */
export function buildForgedToolbox(
  ledger: ForgedLedger,
  allForges: readonly ForgeCaptureForToolbox[],
): ForgedToolboxEntry[] {
  const out: ForgedToolboxEntry[] = [];
  for (const [name, entry] of ledger) {
    const firstForge = allForges.find(f => f.name === name);
    const departments = new Set<string>();
    let maxConfidence = 0;
    let maxForgeConfidence = 0;
    let sampleOutput: string | null = null;
    let reforgeCount = 0;
    let rejectedReforges = 0;
    for (const h of entry.history) {
      departments.add(h.department);
      if (typeof h.confidence === 'number' && h.confidence > maxConfidence) maxConfidence = h.confidence;
      if (h.output) sampleOutput = h.output;
      if (h.isReforge) {
        reforgeCount++;
        if (h.rejected) rejectedReforges++;
        if (typeof h.confidence === 'number' && h.confidence > maxForgeConfidence) maxForgeConfidence = h.confidence;
      }
    }
    const approved = ledgerApproved(entry) || (firstForge?.approved ?? false);
    const totalUses = entry.history.length;
    out.push({
      name,
      description: firstForge?.description || name,
      mode: firstForge?.mode || 'sandbox',
      firstForgedTurn: entry.firstForgedTurn,
      firstForgedDepartment: entry.firstForgedDepartment,
      firstForgedEventTitle: entry.firstForgedEventTitle,
      departments: [...departments],
      reuseCount: Math.max(0, totalUses - 1),
      totalUses,
      reforgeCount,
      rejectedReforges,
      approved,
      // Highest judge confidence across this tool's invocations. When
      // no approval ever landed, confidence is 0 — never fabricate a
      // default that misrepresents rejected tools as borderline. A
      // rejected tool keeps its forges' confidence: the confidence a
      // department wrote when it cited the tool is not the judge's.
      confidence: approved
        ? maxConfidence || (firstForge?.approved ? firstForge.confidence : 0)
        : maxForgeConfidence,
      inputSchema: entry.inputSchema,
      outputSchema: entry.outputSchema,
      sampleOutput,
      history: entry.history.slice(),
    });
  }
  return out.sort((a, b) => a.firstForgedTurn - b.firstForgedTurn);
}

/**
 * The tools a run has forged so far, one name each: the approved entries of
 * the toolbox `buildForgedToolbox` builds from the same ledger, which is what
 * the run's artifact ships as `forgedTools` and what the verdict counts. A
 * tool used by three departments is one tool, and a forge attempt the
 * reviewers rejected is none, also when a department cites it later. The
 * stream's `toolsForged` and the director's "Tools forged so far" read this.
 */
export function forgedToolNames(
  ledger: ForgedLedger,
  allForges: readonly ForgeCaptureForToolbox[],
): string[] {
  return buildForgedToolbox(ledger, allForges).filter(tool => tool.approved).map(tool => tool.name);
}
