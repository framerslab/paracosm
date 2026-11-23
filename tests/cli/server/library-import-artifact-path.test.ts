/**
 * The artifact file behind a run record is the server's own. An import
 * never takes a file path from the request body: the imported artifact
 * is written under the runs directory and the record points there. A
 * record that points outside the runs directory (one stored before
 * this rule) is refused, never read.
 *
 * Runs the real import handler and the real run-history routes over one
 * store, with the Studio fixtures as the imported artifacts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleLibraryImport } from '../../../src/server/routes/library-import.js';
import { handlePlatformApiRoute } from '../../../src/server/routes/platform-api.js';
import { createSqliteRunHistoryStore } from '../../../src/server/stores/sqlite-run-history.js';
import type { RunHistoryStore } from '../../../src/server/stores/run-history.js';
import type { RunRecord } from '../../../src/server/services/run-record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../../fixtures');
const turnLoopArtifact = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-turn-loop.json'), 'utf-8'));
const bundleArtifacts = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-bundle.json'), 'utf-8')) as unknown[];

// The runs directory is the one run output is written to
// (PARACOSM_OUTPUT_DIR). A file beside it, outside it, stands for any
// other JSON file on the server.
const base = mkdtempSync(join(tmpdir(), 'paracosm-artifact-path-'));
const runsDir = join(base, 'runs');
const outsideDir = join(base, 'outside');
mkdirSync(runsDir, { recursive: true });
mkdirSync(outsideDir, { recursive: true });
process.env.PARACOSM_OUTPUT_DIR = runsDir;

const MARKER = 'file-outside-the-runs-directory';
const outsideFile = join(outsideDir, 'other.json');
writeFileSync(outsideFile, JSON.stringify({
  marker: MARKER,
  metadata: { runId: MARKER, scenario: { id: MARKER } },
  finalSwarm: { marker: MARKER },
}));

const OUTSIDE_PATHS: Array<[string, string]> = [
  ['an absolute path', outsideFile],
  ['a "../" path from inside the runs directory', `${runsDir}/../outside/other.json`],
  ['a relative "../" path', '../outside/other.json'],
];

interface Captured { status: number; body: string }

function fakeRes(captured: Captured): ServerResponse {
  return {
    writeHead(status: number) { captured.status = status; return this; },
    end(payload?: string) { captured.body = payload ?? ''; return this; },
  } as unknown as ServerResponse;
}

function memoryStore(): RunHistoryStore {
  return createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
}

function withOutputPath<T>(artifact: T, outputPath: string): T {
  const copy = JSON.parse(JSON.stringify(artifact)) as { scenarioExtensions?: Record<string, unknown> };
  copy.scenarioExtensions = { ...(copy.scenarioExtensions ?? {}), outputPath };
  return copy as T;
}

async function importBody(store: RunHistoryStore, body: unknown): Promise<Captured> {
  const captured: Captured = { status: 0, body: '' };
  await handleLibraryImport({} as IncomingMessage, fakeRes(captured), body, {
    runHistoryStore: store,
    sourceMode: 'local_demo',
  });
  return captured;
}

async function route(store: RunHistoryStore, url: string, method = 'GET'): Promise<Captured> {
  const captured: Captured = { status: 0, body: '' };
  const req = (method === 'POST'
    ? { url, method, [Symbol.asyncIterator]: async function* () { yield Buffer.from('{}'); } }
    : { url, method }) as unknown as IncomingMessage;
  await handlePlatformApiRoute(req, fakeRes(captured), {
    runHistoryStore: store,
    corsHeaders: {},
    paracosmRoutesEnabled: true,
    scenarioLookup: () => undefined,
  });
  return captured;
}

function baseRecord(runId: string, artifactPath: string): RunRecord {
  return {
    runId,
    createdAt: '2026-11-11T00:00:00.000Z',
    scenarioId: 'mars-genesis',
    scenarioVersion: '1.0.0',
    actorConfigHash: 'leaders:path-test',
    economicsProfile: 'imported',
    sourceMode: 'local_demo',
    createdBy: 'user',
    artifactPath,
  };
}

for (const [label, outputPath] of OUTSIDE_PATHS) {
  test(`import with ${label} in outputPath: GET serves the imported artifact, never that file`, async () => {
    const store = memoryStore();
    const imported = await importBody(store, { artifact: withOutputPath(turnLoopArtifact, outputPath) });
    assert.equal(imported.status, 201);
    const { runId } = JSON.parse(imported.body) as { runId: string };

    const got = await route(store, `/api/v1/runs/${encodeURIComponent(runId)}`);
    assert.doesNotMatch(got.body, new RegExp(MARKER));
    assert.equal(got.status, 200);
    const parsed = JSON.parse(got.body) as { artifact: { metadata: { runId: string } }; record: Record<string, unknown> };
    assert.equal(parsed.artifact.metadata.runId, turnLoopArtifact.metadata.runId);
    assert.equal(parsed.record.artifactPath, undefined);

    const swarm = await route(store, `/api/v1/runs/${encodeURIComponent(runId)}/swarm`);
    assert.doesNotMatch(swarm.body, new RegExp(MARKER));
  });
}

test('bundle import with outside outputPaths: no run of the bundle serves that file', async () => {
  const store = memoryStore();
  const artifacts = bundleArtifacts.map((a, i) => withOutputPath(a, OUTSIDE_PATHS[i % OUTSIDE_PATHS.length][1]));
  const imported = await importBody(store, { artifacts });
  assert.equal(imported.status, 201);
  const { runIds } = JSON.parse(imported.body) as { runIds: string[] };
  assert.equal(runIds.length, bundleArtifacts.length);
  for (const runId of runIds) {
    const got = await route(store, `/api/v1/runs/${encodeURIComponent(runId)}`);
    assert.doesNotMatch(got.body, new RegExp(MARKER));
    assert.equal(got.status, 200);
    assert.equal(JSON.parse(got.body).artifact.metadata.runId, runId);
  }
});

test('a normal import round-trips through GET, from a file under the runs directory', async () => {
  const store = memoryStore();
  const imported = await importBody(store, { artifact: turnLoopArtifact });
  assert.equal(imported.status, 201);
  const { runId } = JSON.parse(imported.body) as { runId: string };

  const head = await route(store, `/api/v1/runs/${encodeURIComponent(runId)}`, 'HEAD');
  assert.equal(head.status, 200);
  const got = await route(store, `/api/v1/runs/${encodeURIComponent(runId)}`);
  assert.equal(got.status, 200);
  const parsed = JSON.parse(got.body) as { artifact: typeof turnLoopArtifact };
  assert.deepEqual(parsed.artifact.metadata, turnLoopArtifact.metadata);
  assert.deepEqual(parsed.artifact.trajectory, turnLoopArtifact.trajectory);
  assert.ok(
    readdirSync(runsDir).some((name) => name.startsWith('v3-imported-') && name.endsWith('.json')),
    'the imported artifact is written under the runs directory',
  );
});

for (const [label, artifactPath] of OUTSIDE_PATHS) {
  test(`a stored record with ${label} is refused on every read, not read`, async () => {
    const store = memoryStore();
    const runId = `run_outside_${label.replace(/[^a-z]+/g, '_')}`;
    await store.insertRun(baseRecord(runId, artifactPath));
    for (const [url, method] of [
      [`/api/v1/runs/${runId}`, 'GET'],
      [`/api/v1/runs/${runId}`, 'HEAD'],
      [`/api/v1/runs/${runId}/swarm`, 'GET'],
      [`/api/v1/runs/${runId}/replay`, 'POST'],
    ] as const) {
      const got = await route(store, url, method);
      assert.doesNotMatch(got.body, new RegExp(MARKER), `${method} ${url}`);
      assert.equal(got.status, 410, `${method} ${url}`);
      if (method !== 'HEAD') assert.equal(JSON.parse(got.body).error, 'artifact_outside_runs_dir', `${method} ${url}`);
    }
  });
}

test('a stored record whose path is a link inside the runs directory to a file outside it is refused', async () => {
  const store = memoryStore();
  const link = join(runsDir, 'v3-link-to-outside.json');
  symlinkSync(outsideFile, link);
  await store.insertRun(baseRecord('run_symlink_outside', link));
  const got = await route(store, '/api/v1/runs/run_symlink_outside');
  assert.doesNotMatch(got.body, new RegExp(MARKER));
  assert.equal(got.status, 410);
  assert.equal(JSON.parse(got.body).error, 'artifact_outside_runs_dir');
});
