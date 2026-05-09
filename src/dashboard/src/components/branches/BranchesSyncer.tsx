/**
 * Glue between `useSSE` state and {@link BranchesContext} (Tier 2
 * Spec 2B). Reads new results + turn events on every sse tick and
 * dispatches the right reducer action. Mount once inside
 * {@link BranchesProvider}; renders nothing.
 *
 * Dispatch mapping:
 *
 * - First sse.result with an `artifact` and no `forkedFrom` →
 *   `PARENT_COMPLETE` (the trunk run).
 * - sse.result with an `artifact` and a `forkedFrom.atTurn` that
 *   matches a currently-running branch's `forkedAtTurn` →
 *   `BRANCH_COMPLETE` for that branch.
 * - Latest `turn_done` sim event while a branch is running →
 *   `BRANCH_TURN_PROGRESS` advancing that branch's `currentTurn`.
 * - sse.isAborted becoming true while a branch is running →
 *   `BRANCH_ABORTED` for that branch.
 * - Any sse.errors arriving while a branch is running →
 *   `BRANCH_ERROR` for that branch with the latest error message.
 *
 * Works because the orchestrator serves one simulation at a time:
 * whichever branch is currently `running` is the one the SSE
 * stream is delivering events for.
 */
import { useEffect, useRef } from 'react';
import { useBranchesContext } from './BranchesContext';

/** Minimal sse-shape the syncer reads. Accepts any object with the
 *  listed fields so tests can pass a bare object in place of the full
 *  useSSE() return value. */
export interface BranchesSyncerSSEShape {
  events: Array<{ type: string; data?: unknown }>;
  results: Array<{
    leader: string;
    summary: Record<string, unknown>;
    fingerprint: Record<string, string> | null;
    artifact?: import('../../../../engine/schema/index.js').RunArtifact;
    forkedFrom?: { parentRunId: string; atTurn: number };
  }>;
  isComplete: boolean;
  isAborted: boolean;
  errors: string[];
}

export function BranchesSyncer({ sse }: { sse: BranchesSyncerSSEShape }) {
  const { state, dispatch } = useBranchesContext();
  const lastResultIndex = useRef(-1);
  const lastErrorCount = useRef(0);
  const lastAborted = useRef(false);
  const lastTurnByLocalId = useRef<Record<string, number>>({});

  // useSSE.reset() clears events + results before a new parent run.
  // Mirror that boundary into BranchesContext so stale branches from
  // the prior run do not remain visible against the new parent.
  useEffect(() => {
    if (
      sse.events.length === 0 &&
      sse.results.length === 0 &&
      (state.parent || state.branches.length > 0)
    ) {
      lastResultIndex.current = -1;
      lastErrorCount.current = 0;
      lastAborted.current = false;
      lastTurnByLocalId.current = {};
      dispatch({ type: 'PARENT_RESET' });
    }
  }, [sse.events.length, sse.results.length, state.parent, state.branches.length, dispatch]);

  // Walk new result events. PARENT_COMPLETE fires once per session
  // (the first non-fork result with an artifact); BRANCH_COMPLETE
  // targets the running branch matching `forkedFrom.atTurn`.
  useEffect(() => {
    const results = sse.results;
    if (results.length - 1 <= lastResultIndex.current) return;
    for (let i = lastResultIndex.current + 1; i < results.length; i++) {
      const r = results[i];
      if (!r.artifact) continue;
      if (r.forkedFrom) {
        const match = state.branches.find(
          b => b.status === 'running' && b.forkedAtTurn === r.forkedFrom!.atTurn,
        );
        if (match) {
          dispatch({ type: 'BRANCH_COMPLETE', localId: match.localId, artifact: r.artifact });
        }
      } else if (!state.parent) {
        dispatch({ type: 'PARENT_COMPLETE', artifact: r.artifact });
      }
    }
    lastResultIndex.current = results.length - 1;
  }, [sse.results, state.branches, state.parent, dispatch]);

  // While a branch is running, keep its currentTurn in sync with the
  // latest `turn_done` / `turn_start` SSE sim event. The orchestrator
  // serves one run at a time; if a branch is running, this event is
  // about it (not the trunk).
  useEffect(() => {
    const runningBranch = state.branches.find(b => b.status === 'running');
    if (!runningBranch) return;
    let latestTurn = 0;
    for (const e of sse.events) {
      if (e.type === 'turn_done' || e.type === 'turn_start') {
        const t = (e.data as { turn?: number } | null | undefined)?.turn;
        if (typeof t === 'number' && t > latestTurn) latestTurn = t;
      }
    }
    if (latestTurn > (lastTurnByLocalId.current[runningBranch.localId] ?? 0)) {
      lastTurnByLocalId.current[runningBranch.localId] = latestTurn;
      if (latestTurn > runningBranch.currentTurn) {
        dispatch({ type: 'BRANCH_TURN_PROGRESS', localId: runningBranch.localId, currentTurn: latestTurn });
      }
    }
  }, [sse.events, state.branches, dispatch]);

  // Abort / error propagation for the currently-running branch.
  useEffect(() => {
    const runningBranch = state.branches.find(b => b.status === 'running');
    if (!runningBranch) {
      lastAborted.current = sse.isAborted;
      lastErrorCount.current = sse.errors.length;
      return;
    }
    if (sse.isAborted && !lastAborted.current) {
      dispatch({ type: 'BRANCH_ABORTED', localId: runningBranch.localId });
    }
    if (sse.errors.length > lastErrorCount.current) {
      dispatch({
        type: 'BRANCH_ERROR',
        localId: runningBranch.localId,
        message: sse.errors[sse.errors.length - 1],
      });
    }
    lastAborted.current = sse.isAborted;
    lastErrorCount.current = sse.errors.length;
  }, [sse.isAborted, sse.errors, state.branches, dispatch]);

  return null;
}
