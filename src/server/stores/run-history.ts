import type { RunRecord } from '../services/run-record.js';
import type { ParacosmServerMode } from '../server-mode.js';

export interface ListRunsFilters {
  /** Filter by simulation mode (artifact.metadata.mode). For server-mode
   *  filtering use {@link sourceMode} instead. */
  mode?: 'turn-loop' | 'batch-trajectory' | 'batch-point';
  /** Filter by server mode (source_mode column). Distinct from the
   *  simulation mode above; renamed from the previous `mode` field to
   *  free up that name for the more user-relevant simulation mode. */
  sourceMode?: ParacosmServerMode;
  scenarioId?: string;
  actorConfigHash?: string;
  /** Free-text search across scenario, leader name, leader archetype. */
  q?: string;
  /** Filter to runs sharing a bundle (one Quickstart submission). */
  bundleId?: string;
  limit?: number;
  offset?: number;
}

export interface RunsAggregate {
  totalRuns: number;
  totalCostUSD: number;
  totalDurationMs: number;
  replaysAttempted: number;
  replaysMatched: number;
}

export interface RunHistoryStore {
  insertRun(run: RunRecord): Promise<void>;
  listRuns(filters?: ListRunsFilters): Promise<RunRecord[]>;
  getRun(runId: string): Promise<RunRecord | null>;
  /** Optional: list all runs sharing a bundleId. Used by the Compare
   *  view to fetch a Quickstart bundle's members in one query. Returns
   *  members ordered by `created_at ASC` so the first leader is first. */
  listRunsByBundleId?(bundleId: string): Promise<RunRecord[]>;
  countRuns?(filters?: Pick<ListRunsFilters, 'mode' | 'sourceMode' | 'scenarioId' | 'actorConfigHash' | 'q'>): Promise<number>;
  aggregateStats?(filters?: Pick<ListRunsFilters, 'mode' | 'sourceMode' | 'scenarioId' | 'actorConfigHash'>): Promise<RunsAggregate>;
  recordReplayResult?(runId: string, matches: boolean): Promise<void>;
  /**
   * Destructive: delete every row in the runs table. Used by the
   * `/admin/data/wipe` endpoint and CLI `paracosm wipe-data` for
   * one-shot cleanups. Returns the count of deleted rows.
   */
  wipeAll?(): Promise<number>;
}

export function createNoopRunHistoryStore(): RunHistoryStore {
  return {
    async insertRun() {},
    async listRuns() { return []; },
    async listRunsByBundleId() { return []; },
    async getRun() { return null; },
    async countRuns() { return 0; },
    async aggregateStats() {
      return { totalRuns: 0, totalCostUSD: 0, totalDurationMs: 0, replaysAttempted: 0, replaysMatched: 0 };
    },
    async recordReplayResult() {},
    async wipeAll() { return 0; },
  };
}
