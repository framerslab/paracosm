import { useState, useEffect, useRef, useCallback } from 'react';
import { migrateLegacyEventShape } from './migrateLegacyEventShape';
import type { RunArtifact } from '../../../engine/schema/index.js';

/**
 * Event type strings the dashboard consumes.
 *
 * Superset of the discriminated payload map defined in
 * `src/runtime/orchestrator.ts`, plus two
 * server-synthetic types the HTTP+SSE layer folds into the same stream:
 *
 * - `status`: run-level metadata (effective maxTurns, phase, leaders).
 *   Emitted by server-app.ts at simulation start so the dashboard can
 *   render `T3/6` correctly on demo-capped runs where the post-cap
 *   maxTurns differs from what RunOptions carried.
 * - `sim_saved`: outcome of the server's autoSaveOnComplete pass
 *   (status = saved | skipped | failed, plus id / reason / error).
 *
 * Kept as a literal union rather than `string` so typos fail at
 * compile time. `data` stays loose because dashboard code reads events
 * generically (fingerprinting, filtering, persistence); the narrow
 * per-event payload shapes live in `src/runtime/orchestrator.ts`.
 * If the runtime adds a new event type, add it here too so the
 * dashboard type-check acknowledges it.
 */
export type SimEventType =
  // Mirror of runtime SimEventType (src/runtime/orchestrator.ts):
  | 'turn_start' | 'event_start' | 'specialist_start' | 'specialist_done' | 'forge_attempt'
  | 'decision_pending' | 'decision_made' | 'outcome' | 'personality_drift'
  | 'agent_reactions' | 'bulletin' | 'turn_done' | 'promotion'
  | 'systems_snapshot' | 'provider_error' | 'validation_fallback' | 'sim_aborted'
  // Server-synthetic (not emitted by the runtime itself):
  | 'status' | 'sim_saved';

export interface SimEvent {
  type: SimEventType;
  leader: string;
  turn?: number;
  time?: number;
  data?: Record<string, unknown>;
}

/**
 * Terminal provider error state — set when any leader's simulation hit a
 * quota or auth error that killed the run. Rendered as a persistent banner
 * (not a dismissable toast) because it represents an account-level problem
 * the user must resolve before running another simulation.
 */
export interface ProviderErrorState {
  /** 'quota' = credits exhausted; 'auth' = bad key. Other kinds do not
   *  flip this flag because they are recoverable within the same run. */
  kind: 'quota' | 'auth' | 'rate_limit' | 'network' | 'unknown';
  provider?: string;
  message: string;
  actionUrl?: string;
  /** Which leader hit the error first (useful when one leader's key works
   *  and the other's doesn't — rare but possible). */
  leader?: string;
}

/**
 * Captured detail from the first `sim_aborted` event of the current run.
 * Surfaced so the topbar status pill can explain WHY the sim stopped
 * instead of showing an opaque "Unfinished" badge. Null when the run
 * finished cleanly or is still in flight.
 */
export interface AbortReasonState {
  reason: string;
  turn?: number;
  completedTurns?: number;
  leader?: string;
}

/**
 * One rollup bucket per schema name for validation fallbacks observed
 * during a run. Non-terminal — the sim keeps running with the fallback
 * skeleton — but worth surfacing in the topbar because repeated fallbacks
 * on the same schema mean the model is fighting the output format and
 * whatever data the bucket represents is degraded.
 */
export interface ValidationFallbackBucket {
  schemaName: string;
  count: number;
  /** Most recent call-site tag (e.g. `dept:medical:turn3:event1`). */
  lastSite?: string;
  /** Most recent raw-text preview (first 300 chars of the bad response). */
  lastPreview?: string;
}

interface SSEState {
  status: 'connecting' | 'connected' | 'error' | 'replay_not_found';
  events: SimEvent[];
  results: Array<{
    leader: string;
    summary: Record<string, unknown>;
    fingerprint: Record<string, string> | null;
    /**
     * Full RunArtifact from the completed run. Server emits it in
     * the `result` SSE event when `captureSnapshots: true` was set
     * (which the dashboard defaults to for every UI-initiated run)
     * so the BranchesContext can dispatch PARENT_COMPLETE with the
     * real artifact and the ForkModal has access to
     * `scenarioExtensions.kernelSnapshotsPerTurn` for the fork POST.
     * Absent when captureSnapshots was off (rare; programmatic
     * callers that don't need fork capability).
     */
    artifact?: RunArtifact;
    /** For fork results only; mirrors `artifact.metadata.forkedFrom`. */
    forkedFrom?: { parentRunId: string; atTurn: number };
  }>;
  verdict: Record<string, unknown> | null;
  errors: string[];
  isComplete: boolean;
  /**
   * True when the simulation was cancelled mid-run (user navigated
   * away → server disconnect watchdog fired → orchestrator emitted
   * `sim_aborted`). Distinct from isComplete; the dashboard shows this
   * as an "Interrupted" badge with partial results preserved.
   */
  isAborted: boolean;
  /** Detail of the first abort (reason, turn, leader). Null when unset. */
  abortReason: AbortReasonState | null;
  /** Terminal provider error (quota / auth). `null` when the run is healthy. */
  providerError: ProviderErrorState | null;
  /**
   * Rollup of `validation_fallback` SSE events received during the current
   * run. One bucket per schema name (DepartmentReport, CommanderDecision,
   * etc.) with counts + most-recent preview. Empty array when no schema
   * has fallen back. Rendered as a small amber indicator in the topbar
   * (not a full banner — these are soft degradations, the sim keeps
   * running).
   */
  validationFallbacks: ValidationFallbackBucket[];
  /**
   * True once the server has finished flushing its buffered-event replay
   * for the current connection. Events received before this flag flips
   * are historical (the user already saw them, or is reloading the page);
   * events received after are genuinely live and should drive transient
   * UX like toasts. Reset to false on reconnect so reconnect replays are
   * also treated as historical.
   */
  replayDone: boolean;
}

/**
 * Options for the live event-stream subscription.
 *
 * `replaySessionId` switches the underlying EventSource from the live
 * /events feed to a stored session's /sessions/:id/replay endpoint. The
 * dashboard renders the replayed events with the same SSE pipeline used
 * for live runs — same event-key dedupe, same status-event handling —
 * so the rest of the app does not need a "is this live or replay" code
 * path. The optional `replaySpeed` query is forwarded to the server's
 * pacing logic; defaults to 1 (original timing) when omitted.
 */
export interface UseSSEOptions {
  replaySessionId?: string | null;
  replaySpeed?: number;
}

export function useSSE(options: UseSSEOptions = {}) {
  const replaySessionId = options.replaySessionId ?? null;
  const replaySpeed = options.replaySpeed;
  const [state, setState] = useState<SSEState>({
    status: 'connecting',
    events: [],
    results: [],
    verdict: null,
    errors: [],
    isComplete: false,
    isAborted: false,
    abortReason: null,
    providerError: null,
    validationFallbacks: [],
    replayDone: false,
  });
  const esRef = useRef<EventSource | null>(null);
  // Dedupe set used by the connection effect. Lifted to a ref so reset()
  // can clear it — otherwise the same events that we just nuked locally
  // would be filtered out on the server's buffer replay (or its absence
  // would still leave the set populated forever).
  const seenEventKeysRef = useRef<Set<string>>(new Set());

  /**
   * Clear all client-side SSE state AND tell the server to drop its
   * event buffer so the next reconnect doesn't replay the same events
   * we just cleared. Status stays 'connected' because the EventSource
   * itself is still open — we only nuke the data.
   */
  const reset = useCallback(async () => {
    seenEventKeysRef.current.clear();
    setState(prev => ({
      // Preserve current connection status so the UI doesn't flash
      // "Connecting..." just because the user pressed Clear.
      status: prev.status,
      events: [], results: [], verdict: null, errors: [], isComplete: false,
      isAborted: false,
      abortReason: null,
      // Clear provider error on manual reset. If the underlying problem
      // still exists (key still bad / still no credits), the next run's
      // first LLM call will re-fire the `provider_error` event within
      // seconds, which is the right UX: let the user try.
      providerError: null,
      validationFallbacks: [],
      // After a manual clear the buffer is empty, so the next events we
      // receive are live by definition.
      replayDone: true,
    }));
    try {
      await fetch('/clear', { method: 'POST' });
    } catch {
      // Server unreachable — local state is still cleared so the user
      // sees the empty state regardless.
    }
  }, []);

  const loadEvents = useCallback((events: SimEvent[], results?: unknown[], verdict?: Record<string, unknown> | null) => {
    // Scan loaded events for any previously-persisted provider_error so
    // a reload after a failed run restores the banner state, not just
    // the viz/reports tabs.
    const errEvent = events.find(e => e.type === 'provider_error');
    const restoredProviderError: ProviderErrorState | null = errEvent
      ? {
          kind: (errEvent.data?.kind as ProviderErrorState['kind']) ?? 'unknown',
          provider: errEvent.data?.provider as string | undefined,
          message: String(errEvent.data?.message ?? 'Provider error'),
          actionUrl: errEvent.data?.actionUrl as string | undefined,
          leader: errEvent.leader,
        }
      : null;
    // Restore isAborted from the loaded events so a saved "Interrupted"
    // run doesn't reappear as "Complete" when the user reloads the file.
    const firstAborted = events.find(e => e.type === 'sim_aborted');
    const restoredAborted = !!firstAborted;
    const restoredAbortReason: AbortReasonState | null = firstAborted
      ? {
          reason: String(firstAborted.data?.reason ?? 'unknown'),
          turn: firstAborted.data?.turn as number | undefined,
          completedTurns: firstAborted.data?.completedTurns as number | undefined,
          leader: firstAborted.leader,
        }
      : null;
    // Rebuild validation_fallback rollup from loaded events so a reload
    // after a run with fallbacks preserves the topbar indicator.
    const restoredFallbacks = rollupValidationFallbacks(events);
    setState({
      status: 'connected',
      events,
      results: (results || []) as SSEState['results'],
      verdict: verdict || null,
      errors: [],
      isComplete: true,
      isAborted: restoredAborted,
      abortReason: restoredAbortReason,
      providerError: restoredProviderError,
      validationFallbacks: restoredFallbacks,
      // Loading events from a saved file is historical by definition, so
      // downstream toast gating should treat the replay as finished.
      replayDone: true,
    });
  }, []);

/**
 * Fold a list of SSE events into per-schema validation-fallback buckets.
 * Pure helper so reload-from-file, live stream, and tests can share the
 * same shape of rollup.
 */
function rollupValidationFallbacks(events: SimEvent[]): ValidationFallbackBucket[] {
  const bySchema = new Map<string, ValidationFallbackBucket>();
  for (const e of events) {
    if (e.type !== 'validation_fallback' || !e.data) continue;
    const d = e.data as Record<string, unknown>;
    const schemaName = typeof d.schemaName === 'string' && d.schemaName.length > 0
      ? d.schemaName
      : 'unknown';
    const existing = bySchema.get(schemaName);
    bySchema.set(schemaName, {
      schemaName,
      count: (existing?.count ?? 0) + 1,
      lastSite: typeof d.site === 'string' ? d.site : existing?.lastSite,
      lastPreview: typeof d.rawTextPreview === 'string' ? d.rawTextPreview : existing?.lastPreview,
    });
  }
  return [...bySchema.values()].sort((a, b) => b.count - a.count);
}

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    /**
     * Open a fresh EventSource and re-attach listeners. The server replays
     * its full event buffer on reconnect, so resumed clients catch up
     * automatically. Backoff caps at 10s; reset on successful 'connected'.
     */
    let connectCount = 0;
    // The dedupe set is owned by seenEventKeysRef so reset() can clear it.
    // Tracks event identity so we can dedupe across reconnects without
    // wiping state.events (which would lose the user's view of completed
    // simulations after a transient browser-managed reconnect).
    const seenEventKeys = seenEventKeysRef.current;
    // Build a dedup key that uniquely identifies a logical event.
    //
    // IMPORTANT: the orchestrator emits events with turn nested in
    // `e.data.turn`, not the top-level `e.turn` field. Earlier versions
    // of this key only looked at `e.turn` (always undefined in practice)
    // and relied on eventIndex/department/title as the real
    // discriminators. That silently ate every turn after turn 1 for
    // event types that have no other discriminator in their payload:
    // systems_snapshot, turn_done, personality_drift, bulletin, agent_reactions.
    //
    // The user-visible symptom was the viz tab stuck showing T1 while
    // the sim tab correctly counted up to T3+ (because the only
    // replacement systems_snapshot events for T2/T3 were filtered as
    // "already seen"). Falling back to `e.data?.turn` when the top-level
    // field is missing restores a monotonic key across turns for every
    // emit path.
    const eventKey = (e: SimEvent): string => {
      const turnId = (e.turn ?? (e.data?.turn as number | undefined) ?? '');
      const eventIndex = (e.data?.eventIndex ?? '');
      const department = (e.data?.department ?? '');
      const title = (e.data?.title ?? '');
      // Some per-agent / per-tool payloads need extra discriminators
      // too, so they don't collapse across different agents/tools in
      // the same turn. Forge attempts carry `name`; agent reactions
      // roll up into a single per-turn event so the turn suffices.
      const forgeName = (e.data?.name ?? '');
      return `${e.type}|${e.leader || ''}|${turnId}|${eventIndex}|${department}|${title}|${forgeName}`;
    };

    const open = async () => {
      if (cancelled) return;
      // For replay mode, pre-check that the session exists via a
      // lightweight GET /sessions/:id. A bogus ?replay=X URL would
      // otherwise enter an invisible SSE reconnect loop as the
      // server returned 404s the EventSource layer can't expose.
      if (replaySessionId) {
        try {
          const probe = await fetch(`/sessions/${encodeURIComponent(replaySessionId)}`);
          if (cancelled) return;
          if (probe.status === 404) {
            setState(prev => ({ ...prev, status: 'replay_not_found' }));
            return;
          }
          if (!probe.ok) {
            setState(prev => ({ ...prev, status: 'error' }));
            attempt += 1;
            const delay = Math.min(10_000, 500 * Math.pow(2, attempt - 1));
            reconnectTimer = setTimeout(() => { void open(); }, delay);
            return;
          }
        } catch {
          // Network-level failure (offline / CORS). Fall through to
          // EventSource open which will retry with backoff.
        }
      }
      // Switch the EventSource between live (/events) and replay
      // (/sessions/:id/replay) based on whether a replay session was
      // requested. Replay mode uses the same event format so the rest
      // of the pipeline is unchanged; only the data source flips.
      const sourceUrl = replaySessionId
        ? `/sessions/${encodeURIComponent(replaySessionId)}/replay${
            replaySpeed != null ? `?speed=${encodeURIComponent(String(replaySpeed))}` : ''
          }`
        : '/events';
      const es = new EventSource(sourceUrl);
      esRef.current = es;

      es.addEventListener('connected', () => {
        attempt = 0;
        connectCount += 1;
        // On the FIRST connect we want a clean slate (the server replays
        // its full buffer right after 'connected'). On reconnects we keep
        // existing events so a browser-managed reconnect after the sim
        // finishes doesn't wipe the user's view of viz/reports/chat.
        // The dedupe Set below handles any duplicates from buffer replay.
        //
        // `replayDone` flips back to false for both paths: the server is
        // about to re-send its buffered events, and the client should
        // treat that stream as historical (seed the toast dedupe set but
        // do not fire transient notifications). The server emits a
        // trailing `replay_done` SSE event once the buffer flush is
        // complete; the listener below flips the flag true again so
        // subsequent truly-live events can toast.
        if (connectCount === 1) {
          seenEventKeys.clear();
          setState(prev => ({ ...prev, status: 'connected', events: [], replayDone: false }));
        } else {
          setState(prev => ({ ...prev, status: 'connected', replayDone: false }));
        }
      });

      es.addEventListener('replay_done', () => {
        setState(prev => ({ ...prev, replayDone: true }));
      });

      // Status events carry run-wide metadata: the effective maxTurns
      // (post demo-cap), the phase, and the leader roster at parallel
      // launch. Without a listener they never reach the client and
      // `gameState.maxTurns` stays at its default of 6, producing
      // mislabeled progress like "T3/6" on a demo-capped 3-turn run.
      // Normalize into a SimEvent so useGameState's existing `status`
      // branch at line 235 picks it up without another code path.
      es.addEventListener('status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const evt: SimEvent = { type: 'status', leader: '', data };
          const key = eventKey(evt);
          if (seenEventKeys.has(key)) return;
          seenEventKeys.add(key);
          setState(prev => ({ ...prev, events: [...prev.events, evt] }));
        } catch {}
      });

      es.addEventListener('sim', (e: MessageEvent) => {
        try {
          const rawData = JSON.parse(e.data) as SimEvent;
          // Pre-0.5.0 session replays emit events with legacy field
          // names (data.colony, colonyDeltas, 'colony_snapshot'). The
          // migration helper aliases them to the new shape on read so
          // the rest of the dashboard pipeline doesn't need a legacy
          // code path. Live 0.5.0+ events already have the new keys,
          // so this is a no-op for them.
          const data = migrateLegacyEventShape([rawData as never])
            .events[0] as SimEvent;
          const key = eventKey(data);
          if (seenEventKeys.has(key)) return; // skip duplicate from buffer replay
          seenEventKeys.add(key);
          // Intercept `provider_error` sim events and hoist them into a
          // dedicated state slot for the persistent banner. We still keep
          // them in `events` for audit / reload-restoration purposes.
          if (data.type === 'provider_error' && data.data) {
            const d = data.data as Record<string, unknown>;
            setState(prev => ({
              ...prev,
              events: [...prev.events, data],
              // If we already have a providerError set (e.g. leader A's
              // error arrived first), do not overwrite: keep the first one
              // because that is the root cause the user will act on.
              providerError: prev.providerError ?? {
                kind: (d.kind as ProviderErrorState['kind']) ?? 'unknown',
                provider: d.provider as string | undefined,
                message: String(d.message ?? 'Provider error'),
                actionUrl: d.actionUrl as string | undefined,
                leader: data.leader,
              },
            }));
            return;
          }
          // Intercept `validation_fallback` so the topbar indicator picks
          // it up incrementally. The event still lands in `events` for
          // audit + save/reload restoration.
          if (data.type === 'validation_fallback' && data.data) {
            const d = data.data as Record<string, unknown>;
            const schemaName = typeof d.schemaName === 'string' && d.schemaName.length > 0
              ? d.schemaName
              : 'unknown';
            setState(prev => {
              const buckets = [...prev.validationFallbacks];
              const idx = buckets.findIndex(b => b.schemaName === schemaName);
              const updated: ValidationFallbackBucket = idx === -1
                ? { schemaName, count: 1, lastSite: d.site as string | undefined, lastPreview: d.rawTextPreview as string | undefined }
                : {
                    ...buckets[idx],
                    count: buckets[idx].count + 1,
                    lastSite: (d.site as string | undefined) ?? buckets[idx].lastSite,
                    lastPreview: (d.rawTextPreview as string | undefined) ?? buckets[idx].lastPreview,
                  };
              if (idx === -1) buckets.push(updated);
              else buckets[idx] = updated;
              buckets.sort((a, b) => b.count - a.count);
              return { ...prev, events: [...prev.events, data], validationFallbacks: buckets };
            });
            return;
          }
          // sim_aborted: orchestrator emits this when the run was
          // cancelled by the server's disconnect watchdog. Flip
          // isAborted so the topbar badge switches to "Interrupted".
          // Set isComplete too so the run is treated as a finished
          // (just not happily) state — downstream components that
          // gate on isComplete (chat, reports) still activate.
          if (data.type === 'sim_aborted') {
            const payload = (data.data ?? {}) as Record<string, unknown>;
            const firstAbort: AbortReasonState = {
              reason: String(payload.reason ?? 'unknown'),
              turn: typeof payload.turn === 'number' ? payload.turn : undefined,
              completedTurns: typeof payload.completedTurns === 'number' ? payload.completedTurns : undefined,
              leader: typeof data.leader === 'string' ? data.leader : undefined,
            };
            setState(prev => ({
              ...prev,
              events: [...prev.events, data],
              isAborted: true,
              isComplete: true,
              // Keep only the earliest reason so both leaders firing
              // the same disconnect cause don't overwrite it with the
              // second fire.
              abortReason: prev.abortReason ?? firstAbort,
            }));
            return;
          }
          setState(prev => ({ ...prev, events: [...prev.events, data] }));
        } catch {}
      });

      es.addEventListener('result', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setState(prev => ({ ...prev, results: [...prev.results, data] }));
        } catch {}
      });

      es.addEventListener('verdict', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          // Tag the pair-mode shape so VerdictBanner can branch
          // cleanly between pair and cohort rendering instead of
          // sniffing the payload shape.
          setState(prev => ({ ...prev, verdict: { ...data, mode: 'pair' } }));
        } catch {}
      });

      es.addEventListener('cohort_verdict', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          setState(prev => ({ ...prev, verdict: { ...data, mode: 'cohort' } }));
        } catch {}
      });

      es.addEventListener('complete', (e: MessageEvent) => {
        // pair-runner emits `complete` with an optional `aborted: true`
        // flag when either leader was cancelled. Fold that into
        // isAborted here too, so the Interrupted badge shows up even if
        // the sim_aborted SSE event got lost (older server versions
        // might not emit it).
        let wasAborted = false;
        try {
          const data = e.data ? JSON.parse(e.data) : null;
          wasAborted = !!(data && data.aborted);
        } catch { /* payload optional */ }
        setState(prev => ({
          ...prev,
          isComplete: true,
          isAborted: prev.isAborted || wasAborted,
          // When pair-runner reports aborted without an earlier
          // sim_aborted event (older server or race), leave a generic
          // marker so the pill still explains itself.
          abortReason: prev.abortReason ?? (wasAborted ? { reason: 'unknown' } : null),
        }));
      });

      es.addEventListener('sim_error', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const msg = String(data.error || 'Unknown simulation error');
          console.error('[SSE] Simulation error:', msg);
          setState(prev => ({ ...prev, errors: [...prev.errors, msg] }));
        } catch {}
      });

      // `sim_saved` reports the outcome of the server's
      // autoSaveOnComplete pass (saved / skipped / failed + detail).
      // Fold into the events stream as a synthetic SimEvent so the
      // App-level toast effect can pick it up with the rest of the
      // pipeline. Dedupe keyed on status+id so buffer replay after
      // reconnect doesn't double-toast the same save.
      es.addEventListener('sim_saved', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const evt: SimEvent = { type: 'sim_saved', leader: '', data };
          const key = `sim_saved|${data.status ?? ''}|${data.id ?? ''}|${data.reason ?? ''}`;
          if (seenEventKeys.has(key)) return;
          seenEventKeys.add(key);
          setState(prev => ({ ...prev, events: [...prev.events, evt] }));
        } catch {}
      });

      es.onerror = () => {
        // Browser EventSource auto-reconnects in some failure modes but
        // not all (e.g., 5xx, redeploys). Force a backoff reconnect to
        // recover without a manual page refresh.
        setState(prev => ({ ...prev, status: 'error' }));
        try { es.close(); } catch {}
        esRef.current = null;
        if (cancelled) return;
        attempt += 1;
        const delay = Math.min(10_000, 500 * Math.pow(2, attempt - 1));
        reconnectTimer = setTimeout(() => { void open(); }, delay);
      };
    };

    void open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const es = esRef.current;
      if (es) { try { es.close(); } catch {} }
      esRef.current = null;
    };
    // Re-subscribe whenever the source URL changes (live <-> replay,
    // or one replay session to another). Without these deps the hook
    // would silently keep the original /events EventSource open even
    // when the caller passed a replay id.
  }, [replaySessionId, replaySpeed]);

  return { ...state, reset, loadEvents };
}
