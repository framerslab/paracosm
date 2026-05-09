/**
 * POST /api/v1/library/import — accepts a RunArtifact (single) or array
 * of RunArtifacts (bundle) from a Studio drop and inserts the enriched
 * RunRecord(s) into the active run-history store. Lets users persist
 * artifacts that originated outside this server (Studio JSON drops,
 * shared exports, replay clones).
 *
 * @module paracosm/server/routes/library-import
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { RunArtifactSchema } from '../../engine/schema/artifact.js';
import type { RunArtifact } from '../../engine/schema/index.js';
import type { RunHistoryStore } from '../stores/run-history.js';
import type { RunRecord } from '../services/run-record.js';
import { createRunRecord, hashActorConfig } from '../services/run-record.js';
import { enrichRunRecordFromArtifact } from '../services/enrich-run-record.js';
import type { ParacosmServerMode } from '../server-mode.js';

const MAX_BUNDLE_SIZE = 50;

const SingleBodySchema = z.object({ artifact: z.unknown() });
const BundleBodySchema = z.object({ artifacts: z.array(z.unknown()).min(1).max(MAX_BUNDLE_SIZE) });

export interface LibraryImportDeps {
  runHistoryStore: RunHistoryStore;
  sourceMode: ParacosmServerMode;
}

export async function handleLibraryImport(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: LibraryImportDeps,
): Promise<void> {
  // Detect single vs bundle by which key is present.
  const isBundle = !!(body && typeof body === 'object' && 'artifacts' in (body as object));
  const isSingle = !!(body && typeof body === 'object' && 'artifact' in (body as object));

  if (!isBundle && !isSingle) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Body must contain `artifact` (single) or `artifacts` (bundle)' }));
    return;
  }

  if (isBundle) {
    const parsed = BundleBodySchema.safeParse(body);
    if (!parsed.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid bundle', issues: parsed.error.issues.slice(0, 3) }));
      return;
    }
    const artifacts: RunArtifact[] = [];
    for (let i = 0; i < parsed.data.artifacts.length; i += 1) {
      const a = RunArtifactSchema.safeParse(parsed.data.artifacts[i]);
      if (!a.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Bundle item ${i} is not a valid RunArtifact`,
          issues: a.error.issues.slice(0, 3),
        }));
        return;
      }
      // Use the raw input (not the Zod-stripped result) so non-schema
      // top-level fields (`leader`, `cost`) survive into the enrich
      // pass. Zod strips by default; the schema acts only as a gate.
      artifacts.push(parsed.data.artifacts[i] as RunArtifact);
    }
    const bundleId = `bundle_${randomUUID()}`;
    const result: { runIds: string[]; alreadyExisted: boolean[] } = { runIds: [], alreadyExisted: [] };
    for (let i = 0; i < artifacts.length; i += 1) {
      const artifact = artifacts[i];
      try {
        const inserted = await insertOne(artifact, bundleId, deps);
        result.runIds.push(inserted.runId);
        result.alreadyExisted.push(inserted.alreadyExisted);
      } catch (err) {
        // Surface the failing artifact's index + runId so the client
        // can show a partial-success state and retry just the broken
        // one rather than the whole bundle.
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Failed to insert bundle item ${i}: ${message}`,
          bundleId,
          failedRunId: artifact.metadata?.runId,
          insertedSoFar: result,
        }));
        return;
      }
    }
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ bundleId, ...result }));
    return;
  }

  // Single
  const parsed = SingleBodySchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid artifact body', issues: parsed.error.issues.slice(0, 3) }));
    return;
  }
  const a = RunArtifactSchema.safeParse(parsed.data.artifact);
  if (!a.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not a valid RunArtifact',
      issues: a.error.issues.slice(0, 3),
    }));
    return;
  }
  // Same Zod-strip avoidance as the bundle path: forward the raw input
  // so `leader` / `cost` survive into enrichRunRecordFromArtifact.
  try {
    const inserted = await insertOne(parsed.data.artifact as RunArtifact, undefined, deps);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(inserted));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedRunId = (parsed.data.artifact as RunArtifact)?.metadata?.runId;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `Failed to insert artifact: ${message}`,
      failedRunId,
    }));
  }
}

async function insertOne(
  artifact: RunArtifact,
  bundleId: string | undefined,
  deps: LibraryImportDeps,
): Promise<{ runId: string; alreadyExisted: boolean }> {
  // The artifact's metadata.runId is the source of truth — preserves
  // identity across re-imports so duplicate drops collapse to a single
  // Library row.
  const importedRunId = artifact.metadata.runId;

  const existing = await deps.runHistoryStore.getRun(importedRunId);
  if (existing) {
    return { runId: importedRunId, alreadyExisted: true };
  }

  const baseInput: Omit<RunRecord, 'runId' | 'createdAt'> = {
    scenarioId: artifact.metadata.scenario.id,
    scenarioVersion: (artifact.metadata.scenario as { version?: string }).version ?? '1.0.0',
    actorConfigHash: hashActorConfig({
      runId: importedRunId,
      scenario: artifact.metadata.scenario,
    }),
    economicsProfile: 'imported',
    sourceMode: deps.sourceMode,
    createdBy: 'user',
  };
  if (bundleId) baseInput.bundleId = bundleId;

  // Build a record carrying the imported runId rather than a fresh
  // randomUUID — the artifact's identity comes with it.
  const base: RunRecord = {
    ...createRunRecord(baseInput),
    runId: importedRunId,
  };
  const enriched = enrichRunRecordFromArtifact(base, artifact);
  await deps.runHistoryStore.insertRun(enriched);
  return { runId: importedRunId, alreadyExisted: false };
}
