import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ListRunsFilters, RunHistoryStore } from '../stores/run-history.js';
import type { RunRecord } from '../services/run-record.js';
import type { ParacosmServerMode } from '../server-mode.js';
import type { ScenarioPackage } from '../../engine/types.js';
import { WorldModel, WorldModelReplayError } from '../../runtime/world-model/index.js';
import type { RunArtifact } from '../../engine/schema/index.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clampLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function clampOffset(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function publicRunRecord(record: RunRecord): Omit<RunRecord, 'artifactPath'> {
  const { artifactPath, ...publicRecord } = record;
  void artifactPath;
  return publicRecord;
}

export interface HandlePlatformApiOptions {
  runHistoryStore: RunHistoryStore;
  corsHeaders: Record<string, string>;
  /**
   * When false, every /api/v1/runs* route returns 403. When true, the
   * routes serve normally. Configured at server-app caller via
   * PARACOSM_ENABLE_RUN_HISTORY_ROUTES env var; default true except in
   * hosted_demo (where the public-demo billing surface should not expose
   * run-history without explicit opt-in).
   */
  paracosmRoutesEnabled: boolean;
  /**
   * Resolves a scenarioId to its compiled ScenarioPackage. The route
   * handler uses this to construct a WorldModel for replay. Returns
   * undefined when the id is not in the catalog (built-in or custom).
   * Wired by server-app.ts as `(id) => customScenarioCatalog.get(id)?.scenario`.
   */
  scenarioLookup: (scenarioId: string) => ScenarioPackage | undefined;
}

export async function handlePlatformApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: HandlePlatformApiOptions,
): Promise<boolean> {
  const url = req.url ? new URL(req.url, 'http://localhost') : null;
  if (!url || !url.pathname.startsWith('/api/v1/')) return false;
  if (url.pathname === '/api/v1/demo/status') return false;

  if (!options.paracosmRoutesEnabled) {
    res.writeHead(403, {
      'Content-Type': 'application/json',
      ...options.corsHeaders,
    });
    res.end(JSON.stringify({ error: 'run_history_routes_disabled' }));
    return true;
  }

  try {
    // GET /api/v1/runs — list with filters + pagination
    if (url.pathname === '/api/v1/runs' && req.method === 'GET') {
      const modeParam = url.searchParams.get('mode');
      const sourceModeParam = url.searchParams.get('sourceMode');
      const filters: ListRunsFilters = {
        mode: (modeParam === 'turn-loop' || modeParam === 'batch-trajectory' || modeParam === 'batch-point')
          ? modeParam
          : undefined,
        sourceMode: sourceModeParam ? (sourceModeParam as ParacosmServerMode) : undefined,
        scenarioId: url.searchParams.get('scenario') ?? undefined,
        actorConfigHash: url.searchParams.get('leader') ?? undefined,
        q: url.searchParams.get('q') ?? undefined,
        // Filter by Quickstart bundle. The CompareModal uses
        // /api/v1/bundles/:id directly; this filter is for Library tab
        // breadcrumbs and ad-hoc URLs that scope a list to one bundle.
        bundleId: url.searchParams.get('bundleId') ?? undefined,
        limit: clampLimit(url.searchParams.get('limit')),
        offset: clampOffset(url.searchParams.get('offset')),
      };
      const runs = await options.runHistoryStore.listRuns(filters);
      const countFilters = {
        mode: filters.mode,
        sourceMode: filters.sourceMode,
        scenarioId: filters.scenarioId,
        actorConfigHash: filters.actorConfigHash,
        q: filters.q,
      };
      const total = options.runHistoryStore.countRuns
        ? await options.runHistoryStore.countRuns(countFilters)
        : runs.length;
      const hasMore = (filters.offset ?? 0) + runs.length < total;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...options.corsHeaders,
      });
      res.end(JSON.stringify({ runs: runs.map(publicRunRecord), total, hasMore }));
      return true;
    }

    // GET /api/v1/runs/aggregate — must precede the :runId match below.
    if (url.pathname === '/api/v1/runs/aggregate' && req.method === 'GET') {
      const modeParam = url.searchParams.get('mode');
      const sourceModeParam = url.searchParams.get('sourceMode');
      const aggFilters = {
        mode: (modeParam === 'turn-loop' || modeParam === 'batch-trajectory' || modeParam === 'batch-point')
          ? (modeParam as 'turn-loop' | 'batch-trajectory' | 'batch-point')
          : undefined,
        sourceMode: sourceModeParam ? (sourceModeParam as ParacosmServerMode) : undefined,
        scenarioId: url.searchParams.get('scenario') ?? undefined,
        actorConfigHash: url.searchParams.get('leader') ?? undefined,
      };
      const stats = options.runHistoryStore.aggregateStats
        ? await options.runHistoryStore.aggregateStats(aggFilters)
        : { totalRuns: 0, totalCostUSD: 0, totalDurationMs: 0, replaysAttempted: 0, replaysMatched: 0 };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...options.corsHeaders,
      });
      res.end(JSON.stringify(stats));
      return true;
    }

    // POST /api/v1/runs/:runId/replay-result — increment counters
    const replayMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/replay-result$/);
    if (replayMatch && req.method === 'POST') {
      const runId = decodeURIComponent(replayMatch[1]);
      let body: { matches?: unknown };
      try {
        body = JSON.parse(await readBody(req)) as { matches?: unknown };
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return true;
      }
      if (typeof body?.matches !== 'boolean') {
        res.writeHead(400, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'matches must be a boolean' }));
        return true;
      }
      const record = await options.runHistoryStore.getRun(runId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'not_found', runId }));
        return true;
      }
      await options.runHistoryStore.recordReplayResult?.(runId, body.matches);
      res.writeHead(204, options.corsHeaders);
      res.end();
      return true;
    }

    // POST /api/v1/runs/:runId/replay — re-execute kernel progression
    // against the stored artifact and report match/divergence. The
    // outcome is persisted to the run-history store so the
    // /api/v1/runs/aggregate counters reflect every attempt.
    const replayRunMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/replay$/);
    if (replayRunMatch && req.method === 'POST') {
      const runId = decodeURIComponent(replayRunMatch[1]);
      const record = await options.runHistoryStore.getRun(runId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'not_found', runId }));
        return true;
      }
      if (!record.artifactPath) {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'artifact_unavailable', runId }));
        return true;
      }

      let artifact: RunArtifact;
      try {
        const fs = await import('node:fs/promises');
        artifact = JSON.parse(await fs.readFile(record.artifactPath, 'utf-8')) as RunArtifact;
      } catch {
        console.warn('[run-history] artifact unreadable for replay:', runId);
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'artifact_unreadable', runId, message: 'Artifact file unreadable' }));
        return true;
      }

      const scenarioId = artifact.metadata.scenario.id;
      const scenario = options.scenarioLookup(scenarioId);
      if (!scenario) {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'scenario_unavailable', scenarioId }));
        return true;
      }

      try {
        const wm = WorldModel.fromScenario(scenario);
        const result = await wm.replay(artifact);
        await options.runHistoryStore.recordReplayResult?.(runId, result.matches);
        res.writeHead(200, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ matches: result.matches, divergence: result.divergence }));
        return true;
      } catch (err) {
        if (err instanceof WorldModelReplayError) {
          res.writeHead(422, { 'Content-Type': 'application/json', ...options.corsHeaders });
          res.end(JSON.stringify({ error: 'replay_preconditions_unmet', message: err.message }));
          return true;
        }
        throw err;
      }
    }

    // GET /api/v1/runs/:runId/swarm — return only the agent-swarm
    // snapshot. Lighter payload than the full artifact when the consumer
    // (e.g., a swarm-network visualization) only needs the roster.
    const swarmMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/swarm$/);
    if (swarmMatch && req.method === 'GET') {
      const runId = decodeURIComponent(swarmMatch[1]);
      const record = await options.runHistoryStore.getRun(runId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'not_found', runId }));
        return true;
      }
      if (!record.artifactPath) {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'artifact_unavailable', runId }));
        return true;
      }
      try {
        const fs = await import('node:fs/promises');
        const artifact = JSON.parse(await fs.readFile(record.artifactPath, 'utf-8')) as { finalSwarm?: unknown };
        const swarm = artifact.finalSwarm;
        if (!swarm) {
          res.writeHead(404, { 'Content-Type': 'application/json', ...options.corsHeaders });
          res.end(JSON.stringify({ error: 'swarm_not_captured', runId, message: 'This run did not produce a swarm snapshot (e.g., batch-point mode).' }));
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ runId, swarm }));
        return true;
      } catch {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'artifact_unreadable', runId }));
        return true;
      }
    }

    // HEAD /api/v1/runs/:runId — lightweight existence check without
    // pulling the artifact file off disk. Used by the dashboard's
    // recently-viewed strip to prune ghost cards left behind by Wipe All
    // / TTL / manual deletion. Returns the same 404 / 410 / 200 shape
    // as the GET variant so callers can branch on status alone.
    const detailMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
    if (detailMatch && req.method === 'HEAD') {
      const runId = decodeURIComponent(detailMatch[1]);
      const record = await options.runHistoryStore.getRun(runId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end();
        return true;
      }
      if (!record.artifactPath) {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end();
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...options.corsHeaders });
      res.end();
      return true;
    }
    // GET /api/v1/runs/:runId — load full RunArtifact via record.artifactPath
    if (detailMatch && req.method === 'GET') {
      const runId = decodeURIComponent(detailMatch[1]);
      const record = await options.runHistoryStore.getRun(runId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'not_found', runId }));
        return true;
      }
      if (!record.artifactPath) {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'artifact_unavailable', runId }));
        return true;
      }
      let artifact: unknown;
      try {
        const fs = await import('node:fs/promises');
        artifact = JSON.parse(await fs.readFile(record.artifactPath, 'utf-8'));
      } catch {
        res.writeHead(410, { 'Content-Type': 'application/json', ...options.corsHeaders });
        res.end(JSON.stringify({ error: 'artifact_unreadable', runId, message: 'Artifact file unreadable' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...options.corsHeaders });
      res.end(JSON.stringify({ record: publicRunRecord(record), artifact }));
      return true;
    }
  } catch (error) {
    res.writeHead(500, {
      'Content-Type': 'application/json',
      ...options.corsHeaders,
    });
    res.end(JSON.stringify({ error: String(error) }));
    return true;
  }

  res.writeHead(404, {
    'Content-Type': 'application/json',
    ...options.corsHeaders,
  });
  res.end(JSON.stringify({ error: 'unknown_platform_route', path: url.pathname }));
  return true;
}
