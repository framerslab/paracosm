import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { handlePlatformApiRoute } from '../../src/server/routes/platform-api.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import type { RunRecord } from '../../src/server/services/run-record.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import type { KernelSnapshot } from '../../src/engine/core/snapshot.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: `run_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    scenarioId: 'mars-genesis',
    scenarioVersion: '0.4.88',
    actorConfigHash: 'leaders:abc',
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
    ...overrides,
  };
}

interface CapturedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

function makeRes(captured: CapturedResponse): ServerResponse {
  const res = {
    writeHead(code: number, hdrs: Record<string, string>) {
      captured.statusCode = code;
      captured.headers = hdrs;
    },
    end(payload?: string) {
      captured.body = payload ?? '';
    },
  } as unknown as ServerResponse;
  return res;
}

function makeReq(url: string, method: string = 'GET', body?: string): IncomingMessage {
  if (body) {
    const reqLike = {
      url,
      method,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(body, 'utf-8');
      },
    } as unknown as IncomingMessage;
    return reqLike;
  }
  return { url, method } as IncomingMessage;
}

const ENABLED = {
  paracosmRoutesEnabled: true,
  scenarioLookup: () => undefined,
};

test('GET /api/v1/runs returns { runs, total, hasMore } envelope', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r1', createdAt: '2026-04-24T10:00:00Z' }));
  await store.insertRun(makeRun({ runId: 'r2', createdAt: '2026-04-24T11:00:00Z' }));
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 200);
  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.runs.length, 2);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.hasMore, false);
});

test('GET /api/v1/runs omits server artifactPath from public records', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-public-list', artifactPath: '/tmp/private-list-path.json' }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );

  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.runs[0].artifactPath, undefined);
  assert.doesNotMatch(captured.body, /private-list-path/);
});

test('GET /api/v1/runs respects scenario + sourceMode + leader query params', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'match', scenarioId: 'mars-genesis', sourceMode: 'platform_api', actorConfigHash: 'leaders:abc' }));
  await store.insertRun(makeRun({ runId: 'wrong', scenarioId: 'lunar-outpost', sourceMode: 'platform_api', actorConfigHash: 'leaders:abc' }));
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs?scenario=mars-genesis&sourceMode=platform_api&leader=leaders%3Aabc'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.runs.length, 1);
  assert.equal(parsed.runs[0].runId, 'match');
  assert.equal(parsed.total, 1);
});

test('GET /api/v1/runs filters by simulation mode (?mode=)', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'turn-loop-run', mode: 'turn-loop' }));
  await store.insertRun(makeRun({ runId: 'batch-run', mode: 'batch-trajectory' }));
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs?mode=batch-trajectory'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.runs.length, 1);
  assert.equal(parsed.runs[0].runId, 'batch-run');
});

test('GET /api/v1/runs paginates with limit + offset', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  for (let i = 0; i < 10; i++) {
    await store.insertRun(makeRun({ runId: `r${i.toString().padStart(2, '0')}`, createdAt: `2026-04-24T${i.toString().padStart(2, '0')}:00:00Z` }));
  }
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs?limit=3&offset=2'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.runs.length, 3);
  assert.equal(parsed.total, 10);
  assert.equal(parsed.hasMore, true);
});

test('platform-api routes return 403 when paracosmRoutesEnabled is false', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: false, scenarioLookup: () => undefined },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 403);
  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.error, 'run_history_routes_disabled');
});

test('GET /api/v1/runs/:runId returns 200 with { record, artifact } when artifact exists on disk', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'paracosm-route-test-'));
  const artifactPath = join(tmp, 'a.json');
  const artifact = { metadata: { runId: 'r-detail', scenario: { id: 'mars', name: 'Mars' }, mode: 'turn-loop', startedAt: '2026-04-25T00:00:00.000Z' } };
  writeFileSync(artifactPath, JSON.stringify(artifact));

  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-detail', artifactPath, mode: 'turn-loop' }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-detail'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 200);
  const parsed = JSON.parse(captured.body);
  assert.equal(parsed.record.runId, 'r-detail');
  assert.equal(parsed.record.artifactPath, undefined);
  assert.equal(parsed.artifact.metadata.runId, 'r-detail');
});

test('GET /api/v1/runs/:runId returns 404 for unknown runId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/unknown'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured.statusCode, 404);
  assert.match(captured.body, /not_found/);
});

test('GET /api/v1/runs/:runId returns 410 when artifactPath is missing on the record', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-no-path' }));
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-no-path'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured.statusCode, 410);
  assert.match(captured.body, /artifact_unavailable/);
});

test('GET /api/v1/runs/:runId returns 410 when artifact file is unreadable', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-bad-path', artifactPath: '/tmp/does-not-exist-xyz-test.json' }));
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-bad-path'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured.statusCode, 410);
  assert.match(captured.body, /artifact_unreadable/);
});

test('GET /api/v1/runs/:runId unreadable response does not leak artifactPath', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-hidden-path', artifactPath: '/tmp/secret-run-artifact.json' }));
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-hidden-path'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );

  assert.equal(captured.statusCode, 410);
  assert.doesNotMatch(captured.body, /secret-run-artifact/);
  assert.equal(JSON.parse(captured.body).record, undefined);
});

test('GET /api/v1/runs/aggregate returns sums across all runs', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'a1', costUSD: 0.10, durationMs: 1000, mode: 'turn-loop' }));
  await store.insertRun(makeRun({ runId: 'a2', costUSD: 0.20, durationMs: 2000, mode: 'batch-trajectory' }));
  await store.insertRun(makeRun({ runId: 'a3', costUSD: 0.30, durationMs: 3000, mode: 'batch-trajectory' }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/aggregate'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured.statusCode, 200);
  const body = JSON.parse(captured.body);
  assert.equal(body.totalRuns, 3);
  assert.ok(Math.abs(body.totalCostUSD - 0.60) < 1e-9, `expected 0.60, got ${body.totalCostUSD}`);
  assert.equal(body.totalDurationMs, 6000);
});

test('GET /api/v1/runs/aggregate filters by mode', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'b1', costUSD: 0.10, mode: 'turn-loop' }));
  await store.insertRun(makeRun({ runId: 'b2', costUSD: 0.20, mode: 'batch-trajectory' }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/aggregate?mode=batch-trajectory'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  const body = JSON.parse(captured.body);
  assert.equal(body.totalRuns, 1);
  assert.ok(Math.abs(body.totalCostUSD - 0.20) < 1e-9);
});

test('POST /api/v1/runs/:runId/replay-result increments counters via aggregate', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-replay' }));

  const captured1: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-replay/replay-result', 'POST', JSON.stringify({ matches: true })),
    makeRes(captured1),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured1.statusCode, 204);

  const captured2: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-replay/replay-result', 'POST', JSON.stringify({ matches: false })),
    makeRes(captured2),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured2.statusCode, 204);

  const agg = await store.aggregateStats!();
  assert.equal(agg.replaysAttempted, 2);
  assert.equal(agg.replaysMatched, 1);
});

test('POST /api/v1/runs/:runId/replay-result returns 400 when matches is not a boolean', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-bad-body' }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-bad-body/replay-result', 'POST', JSON.stringify({ matches: 'yes' })),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );
  assert.equal(captured.statusCode, 400);
});

test('POST /api/v1/runs/:runId/replay-result returns 400 for invalid JSON', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-invalid-json' }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-invalid-json/replay-result', 'POST', '{not json'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );

  assert.equal(captured.statusCode, 400);
  assert.match(captured.body, /invalid_json/);
});

test('POST /api/v1/runs/:runId/replay-result returns 404 for unknown runId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  await handlePlatformApiRoute(
    makeReq('/api/v1/runs/missing-run/replay-result', 'POST', JSON.stringify({ matches: true })),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, ...ENABLED },
  );

  assert.equal(captured.statusCode, 404);
  assert.match(captured.body, /not_found/);
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/v1/runs/:runId/replay tests
// Helpers copied from tests/runtime/world-model/replay.test.ts:19-52.
// ─────────────────────────────────────────────────────────────────────

function captureMarsSnapshots(turns: number, seed = 42): KernelSnapshot[] {
  const kernel = new SimulationKernel(seed, 'leader-a', [], {
    startTime: marsScenario.setup.defaultStartTime,
    scenario: marsScenario,
  });
  const snapshots: KernelSnapshot[] = [kernel.toSnapshot(marsScenario.id)];
  for (let t = 1; t <= turns; t++) {
    kernel.advanceTurn(t, marsScenario.setup.defaultStartTime + t, marsScenario.hooks?.progressionHook);
    snapshots.push(kernel.toSnapshot(marsScenario.id));
  }
  return snapshots;
}

function syntheticReplayArtifact(snaps: KernelSnapshot[], scenarioId = marsScenario.id): RunArtifact {
  return {
    metadata: {
      runId: 'replay-test-run',
      scenario: { id: scenarioId, name: marsScenario.labels.name },
      mode: 'turn-loop',
      startedAt: '2026-04-26T00:00:00.000Z',
      seed: 42,
    },
    decisions: snaps.slice(0, -1).map((_, i) => ({
      id: `dec-${i}`,
      turn: i + 1,
      label: `Test decision turn ${i + 1}`,
      chosenOptionId: 'safe',
      reasoning: 'test',
    })),
    scenarioExtensions: {
      kernelSnapshotsPerTurn: snaps,
    },
  } as unknown as RunArtifact;
}

function writeArtifactToTemp(artifact: RunArtifact): string {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-replay-test-'));
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'artifact.json');
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  return path;
}

function lookupReturning(scenario: ScenarioPackage | undefined): (id: string) => ScenarioPackage | undefined {
  return () => scenario;
}

test('POST /api/v1/runs/:runId/replay returns 200 + matches=true on equal-snapshot replay', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const snaps = captureMarsSnapshots(3);
  const artifact = syntheticReplayArtifact(snaps);
  const artifactPath = writeArtifactToTemp(artifact);
  await store.insertRun(makeRun({ runId: 'r-replay-match', scenarioId: marsScenario.id, artifactPath }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-replay-match/replay', 'POST'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: lookupReturning(marsScenario) },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 200);
  const body = JSON.parse(captured.body);
  assert.equal(body.matches, true, `expected matches=true; divergence: ${body.divergence}`);
  assert.equal(body.divergence, '');
});

test('POST /api/v1/runs/:runId/replay returns 200 + matches=false with divergence on tampered snapshots', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const snaps = captureMarsSnapshots(3);
  const tampered = JSON.parse(JSON.stringify(snaps)) as KernelSnapshot[];
  (tampered[2].state as unknown as { metrics: Record<string, number> }).metrics.morale = 0.123456789;
  const artifact = syntheticReplayArtifact(tampered);
  const artifactPath = writeArtifactToTemp(artifact);
  await store.insertRun(makeRun({ runId: 'r-replay-diverge', scenarioId: marsScenario.id, artifactPath }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-replay-diverge/replay', 'POST'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: lookupReturning(marsScenario) },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 200);
  const body = JSON.parse(captured.body);
  assert.equal(body.matches, false);
  assert.ok(body.divergence.length > 0 && body.divergence.startsWith('/'), `divergence must start with /, got: ${body.divergence}`);
});

test('POST /api/v1/runs/:runId/replay returns 404 for unknown runId', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-missing/replay', 'POST'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: () => undefined },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 404);
  const body = JSON.parse(captured.body);
  assert.equal(body.error, 'not_found');
  assert.equal(body.runId, 'r-missing');
});

test('POST /api/v1/runs/:runId/replay returns 410 artifact_unavailable when artifactPath missing', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  await store.insertRun(makeRun({ runId: 'r-no-path', scenarioId: marsScenario.id }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-no-path/replay', 'POST'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: lookupReturning(marsScenario) },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 410);
  const body = JSON.parse(captured.body);
  assert.equal(body.error, 'artifact_unavailable');
  assert.equal(body.runId, 'r-no-path');
  assert.equal(body.record, undefined, 'must not leak full record');
});

test('POST /api/v1/runs/:runId/replay returns 410 scenario_unavailable when scenario not in catalog', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const snaps = captureMarsSnapshots(2);
  const artifact = syntheticReplayArtifact(snaps, 'unknown-scenario-xyz');
  const artifactPath = writeArtifactToTemp(artifact);
  await store.insertRun(makeRun({ runId: 'r-no-scenario', scenarioId: 'unknown-scenario-xyz', artifactPath }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-no-scenario/replay', 'POST'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: () => undefined },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 410);
  const body = JSON.parse(captured.body);
  assert.equal(body.error, 'scenario_unavailable');
  assert.equal(body.scenarioId, 'unknown-scenario-xyz');
});

test('POST /api/v1/runs/:runId/replay returns 422 when artifact missing kernelSnapshotsPerTurn', async () => {
  const store = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const artifactNoSnaps = {
    metadata: {
      runId: 'no-snaps',
      scenario: { id: marsScenario.id, name: 'Mars' },
      mode: 'turn-loop',
      startedAt: '2026-04-26T00:00:00.000Z',
    },
    decisions: [{ id: 'd', turn: 1, label: 'x', chosenOptionId: 'a' }],
  } as unknown as RunArtifact;
  const artifactPath = writeArtifactToTemp(artifactNoSnaps);
  await store.insertRun(makeRun({ runId: 'r-no-snaps', scenarioId: marsScenario.id, artifactPath }));

  const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
  const handled = await handlePlatformApiRoute(
    makeReq('/api/v1/runs/r-no-snaps/replay', 'POST'),
    makeRes(captured),
    { runHistoryStore: store, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: lookupReturning(marsScenario) },
  );
  assert.equal(handled, true);
  assert.equal(captured.statusCode, 422);
  const body = JSON.parse(captured.body);
  assert.equal(body.error, 'replay_preconditions_unmet');
  assert.match(body.message, /per-turn kernel snapshots/);
});

test('POST /api/v1/runs/:runId/replay calls recordReplayResult with the right argument on each attempt', async () => {
  const baseStore = createSqliteRunHistoryStore({ dbPath: ':memory:' });
  const calls: Array<[string, boolean]> = [];
  const wrapStore = {
    ...baseStore,
    recordReplayResult: async (runId: string, matches: boolean) => {
      calls.push([runId, matches]);
      await baseStore.recordReplayResult?.(runId, matches);
    },
  };

  const snapsMatch = captureMarsSnapshots(2);
  const matchArtifact = syntheticReplayArtifact(snapsMatch);
  const matchPath = writeArtifactToTemp(matchArtifact);
  await wrapStore.insertRun(makeRun({ runId: 'r-counter-match', scenarioId: marsScenario.id, artifactPath: matchPath }));

  const snapsDiverge = JSON.parse(JSON.stringify(captureMarsSnapshots(2))) as KernelSnapshot[];
  (snapsDiverge[1].state as unknown as { metrics: Record<string, number> }).metrics.morale = 0.987654321;
  const divergeArtifact = syntheticReplayArtifact(snapsDiverge);
  const divergePath = writeArtifactToTemp(divergeArtifact);
  await wrapStore.insertRun(makeRun({ runId: 'r-counter-diverge', scenarioId: marsScenario.id, artifactPath: divergePath }));

  for (const runId of ['r-counter-match', 'r-counter-diverge']) {
    const captured: CapturedResponse = { statusCode: 0, body: '', headers: {} };
    await handlePlatformApiRoute(
      makeReq(`/api/v1/runs/${runId}/replay`, 'POST'),
      makeRes(captured),
      { runHistoryStore: wrapStore, corsHeaders: {}, paracosmRoutesEnabled: true, scenarioLookup: lookupReturning(marsScenario) },
    );
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['r-counter-match', true]);
  assert.deepEqual(calls[1], ['r-counter-diverge', false]);
});
