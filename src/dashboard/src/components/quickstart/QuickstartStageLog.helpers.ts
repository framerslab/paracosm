/**
 * Helpers that turn the Quickstart phase + SSE event stream into the
 * per-stage log lines rendered by QuickstartStageCard.
 *
 * - Compile / Research / Actors: synthesized lines anchored to phase
 *   transitions, since those stages run server-side without streaming
 *   progress today. Each line carries a stable timestamp and a tone
 *   (info / done / pending) used for color coding.
 * - Running: real SSE events from the orchestrator, grouped by actor
 *   and tagged with the type-color the dashboard uses elsewhere.
 *
 * Kept as pure functions so the rendering component stays declarative
 * and helpers can be unit-tested in isolation.
 *
 * @module paracosm/dashboard/quickstart/QuickstartStageLog.helpers
 */
import type { SimEvent } from '../../hooks/useSSE';
import type { Stage } from './QuickstartProgress';

export interface LogLine {
  /** Mono timestamp displayed in the leftmost column (e.g. "0:12.3"). */
  ts: string;
  /** Single-character glyph: → (in-flight), ✓ (done), ⚠ (warn), · (info). */
  glyph: string;
  /** Short uppercase tag rendered as the colored type pill (e.g. "DECISION"). */
  tag?: string;
  /** Free-form message body for the line. */
  body: string;
  /** Tone drives the row's text color. */
  tone: 'pending' | 'info' | 'active' | 'done' | 'warn' | 'error';
  /** Optional actor name to group running-phase events under. */
  actor?: string;
}

/**
 * Format a ms-since-start offset as a `M:SS.t` mono timestamp. Used as
 * the leftmost column of every log row so the viewer can see the cadence
 * of compile + sim work without mental arithmetic.
 */
export function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const tenths = Math.floor((totalSec * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}

/**
 * Type → tone map for SSE events. Mirrors EventLogPanel's TYPE_COLORS
 * but reduces it to the 6-tone palette QuickstartStageCard renders.
 * Anything unknown maps to `info` so unrecognized events still surface
 * (better to show them than to silently drop).
 */
function toneForEventType(type: string): LogLine['tone'] {
  if (type === 'turn_start' || type === 'turn_done') return 'active';
  if (type === 'specialist_done' || type === 'sim_complete' || type === 'agent_reactions') return 'done';
  if (type === 'decision_pending' || type === 'decision_made' || type === 'outcome') return 'info';
  if (type === 'sim_aborted' || type === 'provider_error' || type === 'validation_fallback') return 'warn';
  return 'info';
}

/**
 * Map SSE event types to short uppercase tags rendered as a colored
 * pill at the head of each log row. Keeps the row scannable when the
 * panel is dense — the eye lands on the colored tag first.
 */
function tagForEventType(type: string): string {
  switch (type) {
    case 'turn_start': return 'TURN';
    case 'turn_done': return 'TURN';
    case 'specialist_start': return 'SPEC';
    case 'specialist_done': return 'SPEC';
    case 'decision_pending': return 'DEC';
    case 'decision_made': return 'DEC';
    case 'outcome': return 'OUT';
    case 'agent_reactions': return 'REACT';
    case 'bulletin': return 'NEWS';
    case 'promotion': return 'PROMO';
    case 'systems_snapshot': return 'SNAP';
    case 'drift': return 'DRIFT';
    case 'personality_drift': return 'DRIFT';
    case 'sim_aborted': return 'ABORT';
    case 'provider_error': return 'ERR';
    case 'validation_fallback': return 'FALLBACK';
    case 'sim_complete': return 'DONE';
    default: return type.toUpperCase().slice(0, 8);
  }
}

/**
 * Best-effort one-line summary of a SimEvent's `data` payload. The
 * orchestrator already includes a free-form `summary` on most events
 * — we prefer that, then fall back to the next-most-specific field
 * (department, title, decision, etc.) so every line carries something
 * useful. Empty string only when we genuinely have no signal.
 */
function summarizeEventData(e: SimEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const summary = typeof d.summary === 'string' ? d.summary : '';
  if (summary) return summary;
  if (typeof d.department === 'string') return d.department;
  if (typeof d.title === 'string') return d.title;
  if (typeof d.decision === 'string') return d.decision;
  if (typeof d.outcome === 'string') return d.outcome;
  if (typeof d.eventType === 'string') return d.eventType;
  if (typeof d.tool === 'string') return d.tool;
  return '';
}

/**
 * Convert a single SSE event into a LogLine. SimEvent has no wall-clock
 * timestamp on it, so the leftmost column shows the per-actor turn the
 * event belongs to (T0..T6) — that's the meaningful unit at this layer
 * anyway. Returns `null` for the synthetic `status` events the SSE hook
 * injects, since those are connection state, not orchestrator events.
 */
function eventToLogLine(e: SimEvent): LogLine | null {
  if (e.type === 'status') return null;
  const turn = e.turn ?? (e.data as { turn?: number } | null | undefined)?.turn;
  const actor = e.leader || (e.data as { actor?: string } | null | undefined)?.actor;
  const summary = summarizeEventData(e);
  const body = summary || `${e.type} fired`;
  // Use the in-sim turn number as the leftmost mono "timestamp" column.
  // Falls back to "—" for events that aren't turn-scoped (e.g. validation
  // fallbacks emitted between turns).
  const ts = typeof turn === 'number' ? `T${turn}` : '—';
  return {
    ts,
    glyph: e.type === 'turn_done' ? '✓' : e.type === 'turn_start' ? '→' : '·',
    tag: tagForEventType(e.type),
    body,
    tone: toneForEventType(e.type),
    actor: typeof actor === 'string' ? actor : undefined,
  };
}

export interface GroundingSummaryForLog {
  skipped?: boolean;
  reason?: string;
  citations?: Array<{
    query: string;
    sources: Array<{ title: string; link: string; domain: string; provider?: string }>;
  }>;
  totalSources?: number;
  durationMs?: number;
  providersUsed?: string[];
  providersFailed?: Array<{ provider: string; reason: string }>;
}

export interface BuildLogContext {
  /** Currently-active stage. Drives synthesized lines for compile/etc. */
  stage: Stage;
  /** Wall-clock ms when the user clicked Generate; used as the t=0 anchor. */
  startMs: number;
  /** Wall-clock ms each phase transition fired; missing entries mean the
   *  phase hasn't completed yet. */
  phaseTransitionMs: Partial<Record<Stage, number>>;
  /** Number of actors the run was configured for (drives the "Generate N
   *  actors" line copy). */
  actorCount: number;
  /** Live SSE event buffer from useSSE. Sourced verbatim for the running
   *  stage. */
  events: SimEvent[];
  /** Result of the deep-research grounding pass, surfaced as citation
   *  log lines on the Research stage card. Null/undefined → fall back
   *  to the legacy "folded into compile" line. */
  groundingSummary?: GroundingSummaryForLog | null;
}

/**
 * Build the LogLine list for the COMPILE stage. Three lines: the
 * dispatch line, the validated-ScenarioPackage line (when research has
 * fired), and a final timing line once we hand off to actors.
 */
export function buildCompileLog(ctx: BuildLogContext): LogLine[] {
  const { stage, startMs, phaseTransitionMs } = ctx;
  const lines: LogLine[] = [];
  const compileStart = phaseTransitionMs?.compile ?? startMs;
  lines.push({
    ts: formatTs(compileStart - startMs),
    glyph: '→',
    tag: 'POST',
    body: '/api/quickstart/compile-from-seed',
    tone: stage === 'compile' ? 'active' : 'info',
  });
  const researchAt = phaseTransitionMs?.research;
  if (researchAt) {
    lines.push({
      ts: formatTs(researchAt - startMs),
      glyph: '✓',
      tag: 'OK',
      body: 'ScenarioPackage validated · departments + crisis templates derived',
      tone: 'done',
    });
  }
  return lines;
}

/**
 * RESEARCH stage. Three modes:
 *  - groundingSummary present + has citations → render real per-citation
 *    lines (one per source, grouped under their query).
 *  - groundingSummary present + skipped → render a single "skipped:
 *    no SERPER_API_KEY" line tagged WARN.
 *  - groundingSummary absent → fall back to the legacy "folded into
 *    compile" placeholder so a server without the new endpoint still
 *    renders a sensible card.
 */
export function buildResearchLog(ctx: BuildLogContext): LogLine[] {
  const { stage, startMs, phaseTransitionMs, groundingSummary } = ctx;
  const lines: LogLine[] = [];
  const researchStart = phaseTransitionMs?.research;
  if (!researchStart) return lines;
  const baseTs = formatTs(researchStart - startMs);

  if (groundingSummary?.skipped) {
    lines.push({
      ts: baseTs,
      glyph: '⚠',
      tag: 'SKIP',
      body: `Deep research skipped: ${groundingSummary.reason ?? 'unknown'}`,
      tone: 'warn',
    });
    return lines;
  }

  if (groundingSummary?.citations && groundingSummary.citations.length > 0) {
    const providerList = groundingSummary.providersUsed?.length
      ? ` · providers: ${groundingSummary.providersUsed.join(' + ')}`
      : '';
    lines.push({
      ts: baseTs,
      glyph: '→',
      tag: 'POST',
      body: `/api/quickstart/ground-scenario · ${groundingSummary.citations.length} queries${providerList}`,
      tone: stage === 'research' ? 'active' : 'info',
    });
    // Surface failed providers as warn lines (e.g. Firecrawl 402) so
    // the viewer sees WHY a provider didn't contribute rather than
    // wondering why one of the configured search sources is missing.
    for (const fail of groundingSummary.providersFailed ?? []) {
      lines.push({
        ts: baseTs,
        glyph: '⚠',
        tag: fail.provider.toUpperCase().slice(0, 8),
        body: `provider unavailable: ${fail.reason.slice(0, 120)}`,
        tone: 'warn',
      });
    }
    for (const bucket of groundingSummary.citations) {
      lines.push({
        ts: baseTs,
        glyph: '·',
        tag: 'QUERY',
        body: `"${bucket.query}" → ${bucket.sources.length} source${bucket.sources.length === 1 ? '' : 's'}`,
        tone: 'info',
      });
      for (const src of bucket.sources.slice(0, 3)) {
        // Tag with the provider name when present (SERPER / TAVILY /
        // FIRECRAWL); fall back to the source domain otherwise.
        const tag = (src.provider ?? '').toUpperCase()
          || src.domain.toUpperCase().slice(0, 16)
          || 'SRC';
        lines.push({
          ts: baseTs,
          glyph: '·',
          tag,
          body: src.title,
          tone: 'done',
        });
      }
    }
    if (typeof groundingSummary.totalSources === 'number') {
      const dur = typeof groundingSummary.durationMs === 'number'
        ? ` · ${(groundingSummary.durationMs / 1000).toFixed(1)}s`
        : '';
      lines.push({
        ts: baseTs,
        glyph: '✓',
        tag: 'OK',
        body: `${groundingSummary.totalSources} unique sources attached to ScenarioPackage${dur}`,
        tone: 'done',
      });
    }
    return lines;
  }

  // Fallback: server doesn't have the new endpoint, OR the response
  // is still in flight. Emit the legacy placeholder so the card isn't
  // empty — but tone=info so it doesn't read as a green confirmation.
  lines.push({
    ts: baseTs,
    glyph: '·',
    tag: 'NOTE',
    body: 'Grounding scenario with web research…',
    tone: stage === 'research' ? 'active' : 'info',
  });
  const actorsAt = phaseTransitionMs?.actors;
  if (actorsAt) {
    lines.push({
      ts: formatTs(actorsAt - startMs),
      glyph: '✓',
      tag: 'OK',
      body: 'Citations attached to ScenarioPackage',
      tone: 'done',
    });
  }
  return lines;
}

/**
 * ACTORS stage. Two synthesized lines: the dispatch + the validated
 * actor list (with HEXACO + archetype) once the response lands.
 */
export function buildActorsLog(ctx: BuildLogContext): LogLine[] {
  const { stage, startMs, phaseTransitionMs, actorCount } = ctx;
  const lines: LogLine[] = [];
  const actorsStart = phaseTransitionMs?.actors;
  if (!actorsStart) return lines;
  lines.push({
    ts: formatTs(actorsStart - startMs),
    glyph: '→',
    tag: 'POST',
    body: `/api/quickstart/generate-actors · count=${actorCount}`,
    tone: stage === 'actors' ? 'active' : 'info',
  });
  const runningAt = phaseTransitionMs?.running;
  if (runningAt) {
    lines.push({
      ts: formatTs(runningAt - startMs),
      glyph: '✓',
      tag: 'OK',
      body: `${actorCount} actor${actorCount === 1 ? '' : 's'} generated · HEXACO traits + archetypes validated`,
      tone: 'done',
    });
  }
  return lines;
}

/**
 * RUNNING stage. Real SSE events from the orchestrator, oldest-first,
 * each rendered with the actor name + turn prefix + type-color tag.
 * Drops the synthetic `status` events (connection state) and any event
 * we can't extract a useful summary for.
 */
export function buildRunningLog(ctx: BuildLogContext): LogLine[] {
  return ctx.events
    .map((e) => eventToLogLine(e))
    .filter((l): l is LogLine => !!l);
}

export function buildLogForStage(stageId: Stage, ctx: BuildLogContext): LogLine[] {
  switch (stageId) {
    case 'compile': return buildCompileLog(ctx);
    case 'research': return buildResearchLog(ctx);
    case 'actors': return buildActorsLog(ctx);
    case 'running': return buildRunningLog(ctx);
    case 'done': return [];
  }
}

/**
 * Format a stage's elapsed-time badge. Returns an empty string while
 * the stage is still pending so the badge slot collapses cleanly.
 */
export function formatStageDuration(stageId: Stage, ctx: BuildLogContext): string {
  const order: Stage[] = ['compile', 'research', 'actors', 'running', 'done'];
  const stageIdx = order.indexOf(stageId);
  const startTransition = ctx.phaseTransitionMs?.[stageId];
  const next = order[stageIdx + 1];
  const endTransition = next ? ctx.phaseTransitionMs?.[next] : undefined;
  if (!startTransition) return '';
  const end = endTransition ?? Date.now();
  const sec = (end - startTransition) / 1000;
  if (sec < 1) return `${Math.max(1, Math.round(sec * 1000))}ms`;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  return `${Math.round(sec)}s`;
}
