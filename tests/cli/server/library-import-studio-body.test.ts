/**
 * What the Studio tab posts to `/api/v1/library/import` (#235).
 *
 * A run the turn loop saves carries three sets of kernel snapshots: the end
 * of each turn, the start of the run and the state after each between-turn
 * step. The import stores a run record built from the run's metadata,
 * leader, cost and trajectory, and keeps none of the snapshots. Posted
 * whole, a bundle of runs that fit the server's request body limit (5 MiB
 * unless `MAX_REQUEST_BODY_BYTES` sets another) before replay kept the
 * start and after-step states could pass it once they were added, and the
 * import refused it.
 *
 * The run here is the real `runSimulation` on Mars Genesis with a stub model
 * (tests/runtime/helpers/stub-model-mars-run.ts; no network, no paid call).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleLibraryImport } from '../../../src/server/routes/library-import.js';
import { createSqliteRunHistoryStore } from '../../../src/server/stores/sqlite-run-history.js';
import type { RunHistoryStore } from '../../../src/server/stores/run-history.js';
import type { RunArtifact } from '../../../src/engine/schema/index.js';
import { artifactForImport } from '../../../src/dashboard/src/components/studio/useStudioPromote.helpers.js';
import { runMarsWithStubModel } from '../../runtime/helpers/stub-model-mars-run.js';

const SNAPSHOT_FIELDS = ['kernelSnapshotsPerTurn', 'kernelSnapshotAtStart', 'kernelSnapshotsAfterProgression'];

function fakeRes(): { res: ServerResponse; status: () => number; body: () => string } {
  let status = 0;
  let body = '';
  const res = {
    writeHead(s: number) { status = s; return this; },
    end(c?: string) { if (c !== undefined) body = c; return this; },
  } as unknown as ServerResponse;
  return { res, status: () => status, body: () => body };
}

const store = (): RunHistoryStore => createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });

/** Two runs of one bundle, as a person drops them into the Studio tab: saved files, read through JSON. One turn loop for the file. */
let pending: ReturnType<typeof runMarsWithStubModel> | undefined;
async function savedBundle(): Promise<RunArtifact[]> {
  const { artifact } = await (pending ??= runMarsWithStubModel());
  return ['run-studio-a', 'run-studio-b'].map(runId => {
    const copy = JSON.parse(JSON.stringify(artifact)) as RunArtifact;
    copy.metadata.runId = runId;
    return copy;
  });
}

/** The bundle through the import route, as the server reads a posted body; the records it stored, by runId. */
async function imported(body: string): Promise<Map<string, Record<string, unknown>>> {
  const runs = store();
  const { res, status, body: answer } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, res, JSON.parse(body), { runHistoryStore: runs, sourceMode: 'local_demo' });
  assert.equal(status(), 201, answer());
  const records = new Map<string, Record<string, unknown>>();
  for (const runId of (JSON.parse(answer()) as { runIds: string[] }).runIds) {
    const { createdAt: _createdAt, bundleId: _bundleId, ...record } = (await runs.getRun(runId)) as unknown as Record<string, unknown>;
    records.set(runId, record);
  }
  return records;
}

test('the Studio tab posts a bundle without the kernel snapshots the import never keeps, and the import stores the same records', async () => {
  const bundle = await savedBundle();
  const ext = bundle[0].scenarioExtensions as Record<string, unknown>;
  for (const field of SNAPSHOT_FIELDS) assert.ok(field in ext, `the turn loop saved ${field}`);

  const whole = JSON.stringify({ artifacts: bundle });
  const posted = JSON.stringify({ artifacts: bundle.map(artifactForImport) });

  for (const artifact of (JSON.parse(posted) as { artifacts: RunArtifact[] }).artifacts) {
    const kept = (artifact.scenarioExtensions ?? {}) as Record<string, unknown>;
    for (const field of SNAPSHOT_FIELDS) assert.ok(!(field in kept), `the posted run leaves out ${field}`);
  }
  for (const field of SNAPSHOT_FIELDS) assert.ok(field in ext, `the run the page holds keeps ${field}`);

  // Each snapshot holds every person in the colony; the bundle posts none.
  const snapshotBytes = bundle.reduce((sum, a) => {
    const e = a.scenarioExtensions as Record<string, unknown>;
    return sum + SNAPSHOT_FIELDS.reduce((s, f) => s + JSON.stringify(e[f]).length, 0);
  }, 0);
  assert.ok(whole.length - posted.length >= snapshotBytes, `the posted body is ${whole.length - posted.length} bytes smaller, the snapshots are ${snapshotBytes}`);

  assert.deepEqual(await imported(posted), await imported(whole), 'the import stores the same record from the posted run as from the whole one');
});

test('the Studio tab posts a single run without the kernel snapshots, and the run it holds keeps them', async () => {
  const [artifact] = await savedBundle();
  const posted = JSON.parse(JSON.stringify({ artifact: artifactForImport(artifact) })) as { artifact: RunArtifact };
  const kept = (posted.artifact.scenarioExtensions ?? {}) as Record<string, unknown>;
  for (const field of SNAPSHOT_FIELDS) assert.ok(!(field in kept), `the posted run leaves out ${field}`);
  assert.equal(posted.artifact.metadata.runId, artifact.metadata.runId);
  assert.ok('kernelSnapshotsAfterProgression' in (artifact.scenarioExtensions as Record<string, unknown>));
});
