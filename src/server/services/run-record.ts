import { createHash, randomUUID } from 'node:crypto';
import type { ParacosmServerMode } from '../server-mode.js';

export interface RunRecord {
  runId: string;
  createdAt: string;
  scenarioId: string;
  scenarioVersion: string;
  actorConfigHash: string;
  economicsProfile: string;
  sourceMode: ParacosmServerMode;
  createdBy: 'anonymous' | 'user' | 'service';
  /** Absolute path to the on-disk RunArtifact JSON. Undefined for legacy
   *  runs whose path was not preserved. New runs always populate this. */
  artifactPath?: string;
  /** Total cost in USD captured from artifact.cost.totalUSD at insert time. */
  costUSD?: number;
  /** Wall-clock duration of the run in milliseconds. */
  durationMs?: number;
  /** Simulation mode captured from artifact.metadata.mode. */
  mode?: 'turn-loop' | 'batch-trajectory' | 'batch-point';
  /** Captured leader display name for the gallery card. */
  actorName?: string;
  /** Captured leader archetype for the gallery card. */
  actorArchetype?: string;
  /** UUID shared by all runs from one Quickstart submission. Set when the
   *  /setup handler dispatches to runBatchSimulations or when an explicit
   *  Quickstart `quickstart.bundleId` is passed. Older runs persisted
   *  before this column was added are bundle-less and render as solo
   *  cards in the LIBRARY. */
  bundleId?: string;
  /** Sampled trajectory values (typically 8 points) for the
   *  SmallMultiplesGrid cell sparkline in the Compare view. Computed
   *  from `artifact.trajectory.points` at insert time via
   *  `extractSummaryTrajectory`. Empty for batch-point runs. */
  summaryTrajectory?: number[];
}

export function createRunRecord(input: Omit<RunRecord, 'runId' | 'createdAt'>): RunRecord {
  return {
    runId: `run_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...input,
  };
}

export function hashActorConfig(input: unknown): string {
  return `leaders:${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12)}`;
}
