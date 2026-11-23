import { createHash, randomUUID } from 'node:crypto';
import { resolveSimulationRouting } from '../../cli/sim-config.js';
import { ProviderKeyMissingError } from '../../engine/provider/resolver.js';
import { makeRunProvenance, RunProvenanceSchema, type RunArtifact, type RunProvenance } from '../../engine/schema/index.js';
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
  /**
   * Session-store id the run's events were saved under by the
   * broadcast handler's autoSaveOnComplete pass. Populated
   * asynchronously after insert via `linkSessionId` because the
   * sessionStore.saveSession call lives outside this insert handler.
   * Undefined for legacy runs that predate the link wire-up, runs
   * whose save failed or was skipped (below-min-turns), and runs
   * inserted by code paths that bypass the broadcast handler
   * entirely (CLI batch runs, replay-only flows). Surfaces on the
   * Library row's "Copy viz share link" button — enabled when set.
   */
  sessionId?: string;
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

/** Returns a public copy of a run record without its server file path. */
export function publicRunRecord(record: RunRecord): Omit<RunRecord, 'artifactPath'> {
  const { artifactPath, ...publicRecord } = record;
  void artifactPath;
  return publicRecord;
}

/** Returns an artifact copy without its output path, preserving the original for recording. */
export function withoutOutputPath(artifact: RunArtifact): RunArtifact {
  const ext = artifact.scenarioExtensions as Record<string, unknown> | undefined;
  if (!ext || typeof ext !== 'object') return { ...artifact };
  const { outputPath, ...rest } = ext;
  void outputPath;
  return { ...artifact, scenarioExtensions: rest as RunArtifact['scenarioExtensions'] };
}

/** Resolve the same assignments as the runner without exposing its credentials. */
export function resolveRunProvenance(
  options: Parameters<typeof resolveSimulationRouting>[0],
  env: NodeJS.ProcessEnv,
): RunProvenance {
  try {
    return makeRunProvenance({ ...resolveSimulationRouting(options, env, true).models });
  } catch (error) {
    // Keep admitting runs as before. A missing key is reported by the runner.
    if (error instanceof ProviderKeyMissingError) return makeRunProvenance({});
    throw error;
  }
}

/** Read a validated mark from recorded metadata. */
export function readRunProvenance(value: unknown): RunProvenance | undefined {
  return RunProvenanceSchema.safeParse(value).data;
}

/** Derive provenance from a recorded frame or the assignments it retained. */
export function recordedFrameProvenance(data: unknown): RunProvenance | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const frame = data as { provenance?: unknown; artifact?: { provenance?: unknown }; config?: { models?: Record<string, unknown> } };
  const known = readRunProvenance(frame.provenance) ?? readRunProvenance(frame.artifact?.provenance);
  if (known) return known;

  const models: Record<string, string> = {};
  for (const role of ['commander', 'departments', 'judge', 'director', 'agentReactions']) {
    const value = frame.config?.models?.[role];
    if (typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value)) models[role] = value;
  }
  return Object.keys(models).length > 0 ? makeRunProvenance(models) : undefined;
}

/** The provenance preserved in a stored sequence, when it recorded any. */
export function recordedRunProvenance(frames: Iterable<string>): RunProvenance | undefined {
  for (const frame of frames) {
    const line = frame.split('\n', 2)[1];
    if (!line?.startsWith('data: ')) continue;
    try {
      const provenance = recordedFrameProvenance(JSON.parse(line.slice(6)));
      if (provenance) return provenance;
    } catch { /* Historical frame has no readable payload. */ }
  }
  return undefined;
}

/** Add provenance without changing the SSE event name or frame delimiters. */
export function withRunProvenance(frame: string, provenance: RunProvenance): string {
  return frame.replace(/^data: ([^\r\n]*)/m, (line, raw: string) => {
    try {
      const data: unknown = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return `data: ${JSON.stringify({ ...data, provenance })}`;
      }
    } catch { /* Keep unreadable historical frames as stored. */ }
    return line;
  });
}

/** Projects the artifact in a stored result frame before it is sent to a caller. */
export function publicResultFrame(frame: string): string {
  if (!frame.startsWith('event: result\n')) return frame;
  return frame.split('\n').map(line => {
    if (!line.startsWith('data: ')) return line;
    try {
      const data = JSON.parse(line.slice(6));
      if (!data?.artifact || typeof data.artifact !== 'object') return line;
      return `data: ${JSON.stringify({ ...data, artifact: withoutOutputPath(data.artifact) })}`;
    } catch {
      return line;
    }
  }).join('\n');
}

/**
 * A stored `active_scenario` frame without the brief (`seedText`) the run
 * was compiled from; any other frame as it is.
 */
export function withoutBrief(frame: string): string {
  if (!frame.startsWith('event: active_scenario\n')) return frame;
  return frame.split('\n').map(line => {
    if (!line.startsWith('data: ')) return line;
    try {
      const data = JSON.parse(line.slice(6));
      if (!data || typeof data !== 'object' || !('seedText' in data)) return line;
      return `data: ${JSON.stringify({ ...data, seedText: null })}`;
    } catch {
      return line;
    }
  }).join('\n');
}

/**
 * Run records with the session link (`sessionId`) left out where the
 * session store no longer holds that session, so no record offers a replay
 * link that answers 404. Without `savedSessionIds` the records are as given.
 */
export async function withSavedSessionLinks<T extends { sessionId?: string }>(
  records: readonly T[],
  savedSessionIds: ((ids: readonly string[]) => Promise<ReadonlySet<string>>) | undefined,
): Promise<T[]> {
  if (!savedSessionIds) return [...records];
  const linked = records.map(r => r.sessionId).filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (linked.length === 0) return [...records];
  const saved = await savedSessionIds(linked);
  return records.map(record => {
    if (!record.sessionId || saved.has(record.sessionId)) return record;
    const { sessionId, ...rest } = record;
    void sessionId;
    return rest as unknown as T;
  });
}
