/**
 * Branches tab state (Tier 2 Spec 2B). Holds the current session's
 * parent run once terminal, plus any forked branches launched from
 * it. All client-side; no server polling.
 *
 * Dispatch sources:
 *
 * 1. SSE terminal result event ({@link RunArtifact} carried in
 *    `useSSE.results[i].artifact` when `captureSnapshots: true`) →
 *    {@link BranchesAction.PARENT_COMPLETE} when the result is the
 *    first non-fork artifact of the session.
 * 2. {@link BranchesAction.BRANCH_OPTIMISTIC} dispatched from
 *    `ForkModal`'s confirm handler the instant the user submits
 *    the fork. Status starts `running`.
 * 3. SSE `turn_start` / `turn_done` events for the fork run update
 *    {@link BranchesAction.BRANCH_TURN_PROGRESS}.
 * 4. SSE terminal result event for the fork run → {@link
 *    BranchesAction.BRANCH_COMPLETE} with the authoritative
 *    artifact (carries `metadata.forkedFrom`, used to match which
 *    optimistic entry to upgrade).
 * 5. SSE `sim_error` / `sim_aborted` → {@link
 *    BranchesAction.BRANCH_ERROR} / {@link
 *    BranchesAction.BRANCH_ABORTED}.
 * 6. {@link BranchesAction.PARENT_RESET} on "new run" to clear the
 *    branch stack so a fresh session starts clean.
 *
 * The reducer is a discriminated union so dispatch sites stay
 * exhaustive.
 *
 * @module branches/BranchesContext
 */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { RunArtifact } from '../../../../engine/schema/index.js';

/**
 * Lifecycle states a branch moves through. Terminal states are
 * `complete`, `aborted`, and `error`; `running` is the only
 * non-terminal state.
 */
export type BranchStatus = 'running' | 'complete' | 'aborted' | 'error';

/**
 * One fork branch entry in the Branches tab. Assembled optimistically
 * on fork-modal confirm; finalized when the fork's terminal SSE
 * result event arrives.
 */
export interface BranchState {
  /**
   * Client-generated stable id, assigned at optimistic insert.
   * Used as the React key and as the reducer-action target id.
   * Remains valid after the server returns a runId; the two
   * coexist because React key stability matters more than runId
   * alignment.
   */
  localId: string;
  /** Turn at which this branch was forked from the parent run. */
  forkedAtTurn: number;
  /** Override leader's name, for the card header. */
  actorName: string;
  /** Override leader's archetype, for the card subtitle. */
  actorArchetype: string;
  /** Current lifecycle status. */
  status: BranchStatus;
  /**
   * Most recent turn the fork reached. Starts at `forkedAtTurn`
   * and advances as `turn_done` events arrive. At terminal, set
   * to the artifact's final timepoint index.
   */
  currentTurn: number;
  /** Authoritative RunArtifact; populated on terminal. */
  artifact?: RunArtifact;
  /** Populated when `status === 'error'`. */
  errorMessage?: string;
}

/**
 * Top-level Branches context shape.
 */
export interface BranchesState {
  /**
   * The parent trunk run, once its SSE terminal result carries a
   * full artifact. Undefined before then. A fork run's artifact
   * never lands here; those go into {@link branches}.
   */
  parent?: RunArtifact;
  /** Forked branches, ordered oldest-first (insertion order). */
  branches: BranchState[];
}

export type BranchesAction =
  | { type: 'PARENT_COMPLETE'; artifact: RunArtifact }
  | { type: 'PARENT_RESET' }
  | { type: 'SET_PARENT'; artifact: RunArtifact }
  | {
      type: 'BRANCH_OPTIMISTIC';
      localId: string;
      forkedAtTurn: number;
      actorName: string;
      actorArchetype: string;
    }
  | { type: 'BRANCH_TURN_PROGRESS'; localId: string; currentTurn: number }
  | { type: 'BRANCH_COMPLETE'; localId: string; artifact: RunArtifact }
  | { type: 'BRANCH_ABORTED'; localId: string }
  | { type: 'BRANCH_ERROR'; localId: string; message: string };

const initialState: BranchesState = { parent: undefined, branches: [] };

/**
 * Pure reducer. All branch updates go through `localId` so the
 * reducer is safe under concurrent optimistic inserts.
 */
export function branchesReducer(state: BranchesState, action: BranchesAction): BranchesState {
  switch (action.type) {
    case 'PARENT_COMPLETE':
      return { ...state, parent: action.artifact };
    case 'PARENT_RESET':
      return { parent: undefined, branches: [] };
    case 'SET_PARENT':
      // Explicit user-initiated parent promotion (Quickstart leader
      // selected as fork root). Clears any existing branches so the
      // Branches tab shows a clean slate under the new parent.
      return { parent: action.artifact, branches: [] };
    case 'BRANCH_OPTIMISTIC':
      return {
        ...state,
        branches: [
          ...state.branches,
          {
            localId: action.localId,
            forkedAtTurn: action.forkedAtTurn,
            actorName: action.actorName,
            actorArchetype: action.actorArchetype,
            status: 'running',
            currentTurn: action.forkedAtTurn,
          },
        ],
      };
    case 'BRANCH_TURN_PROGRESS':
      return {
        ...state,
        branches: state.branches.map(b =>
          b.localId === action.localId ? { ...b, currentTurn: action.currentTurn } : b,
        ),
      };
    case 'BRANCH_COMPLETE': {
      const forkTurn = action.artifact.metadata.forkedFrom?.atTurn ?? 0;
      const finalTurn = forkTurn + (action.artifact.trajectory?.timepoints?.length ?? 0);
      return {
        ...state,
        branches: state.branches.map(b =>
          b.localId === action.localId
            ? { ...b, status: 'complete', artifact: action.artifact, currentTurn: finalTurn }
            : b,
        ),
      };
    }
    case 'BRANCH_ABORTED':
      return {
        ...state,
        branches: state.branches.map(b =>
          b.localId === action.localId ? { ...b, status: 'aborted' } : b,
        ),
      };
    case 'BRANCH_ERROR':
      return {
        ...state,
        branches: state.branches.map(b =>
          b.localId === action.localId ? { ...b, status: 'error', errorMessage: action.message } : b,
        ),
      };
    default:
      return state;
  }
}

interface BranchesContextValue {
  state: BranchesState;
  dispatch: Dispatch<BranchesAction>;
}

const BranchesContext = createContext<BranchesContextValue | null>(null);

/**
 * Provider. Mount once at the dashboard root so every descendant
 * can read branch state via {@link useBranchesContext}.
 */
export function BranchesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(branchesReducer, initialState);
  return (
    <BranchesContext.Provider value={{ state, dispatch }}>
      {children}
    </BranchesContext.Provider>
  );
}

/**
 * Consumer hook. Throws if used outside a {@link BranchesProvider}
 * so mount-site bugs fail loud in dev.
 */
export function useBranchesContext(): BranchesContextValue {
  const ctx = useContext(BranchesContext);
  if (!ctx) throw new Error('useBranchesContext must be used within BranchesProvider');
  return ctx;
}
