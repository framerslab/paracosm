/**
 * The Studio tab promotes a bundle of runs saved with snapshots whose
 * JSON together passes the server's request body limit (#263).
 *
 * A run the turn loop saves with `captureSnapshots` holds three kernel
 * snapshot sets in `scenarioExtensions` (`kernelSnapshotsPerTurn`,
 * `kernelSnapshotAtStart`, `kernelSnapshotsAfterProgression`), which
 * replay and fork read from the server's own copy of an imported run.
 * The server refuses a request body over its limit (5 MiB unless
 * `MAX_REQUEST_BODY_BYTES` sets another).
 *
 * The run is the real `runSimulation` on Mars Genesis with a stub model
 * (tests/runtime/helpers/stub-model-mars-run.ts; no network, no paid
 * call), read back through JSON as the Studio reads a dropped file. The
 * bundle is copies of it, each under its own runId, enough of them that
 * the bundle's JSON passes the default limit. It goes through the hook
 * the Studio tab calls (`useStudioPromote`) to the real server: the
 * route, its checks and its default limit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer, type MarsServer } from '../../src/server/server-app.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { useStudioPromote, type UseStudioPromote } from '../../src/dashboard/src/components/studio/useStudioPromote.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import type { KernelSnapshot } from '../../src/engine/core/snapshot.js';
import { runMarsWithStubModel } from '../runtime/helpers/stub-model-mars-run.js';

/** The server's request body limit when MAX_REQUEST_BODY_BYTES sets none. */
const DEFAULT_LIMIT_BYTES = 5 * 1024 * 1024;
/** The largest file the Studio drop zone reads (StudioDropZone.tsx). */
const STUDIO_FILE_CAP_BYTES = 10 * 1024 * 1024;
/** The most runs a Studio bundle holds (parseStudioInput.ts). */
const STUDIO_BUNDLE_CAP = 50;

// The hook runs on the dashboard's React, so it renders with that copy.
const dashboardRequire = createRequire(new URL('../../src/dashboard/package.json', import.meta.url));
const React = dashboardRequire('react') as typeof import('react');
const { renderToString } = dashboardRequire('react-dom/server') as typeof import('react-dom/server');

interface SnapshotExtensions {
  kernelSnapshotsPerTurn?: KernelSnapshot[];
  kernelSnapshotAtStart?: KernelSnapshot;
  kernelSnapshotsAfterProgression?: KernelSnapshot[];
}

const snapshotsOf = (artifact: RunArtifact): SnapshotExtensions => {
  const ext = (artifact.scenarioExtensions ?? {}) as SnapshotExtensions;
  return {
    kernelSnapshotsPerTurn: ext.kernelSnapshotsPerTurn,
    kernelSnapshotAtStart: ext.kernelSnapshotAtStart,
    kernelSnapshotsAfterProgression: ext.kernelSnapshotsAfterProgression,
  };
};

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

/** One stubbed run for the file: the turn loop is the expensive part. */
let pending: Promise<RunArtifact> | undefined;
const savedRun = () => (pending ??= runMarsWithStubModel().then(({ artifact }) => JSON.parse(JSON.stringify(artifact)) as RunArtifact));

/** `count` copies of a saved run, each under its own runId. */
function copiesOf(run: RunArtifact, count: number, label: string): RunArtifact[] {
  return Array.from({ length: count }, (_, i) => ({
    ...run,
    metadata: { ...run.metadata, runId: `${run.metadata.runId}-${label}-${i + 1}` },
  }));
}

interface Served {
  server: MarsServer;
  base: string;
  runsDir: string;
  cleanup: () => void;
}

/** The real server with the run-history routes on and no MAX_REQUEST_BODY_BYTES. */
async function serve(): Promise<Served> {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-studio-bundle-'));
  const appDir = join(root, 'app');
  const runsDir = join(root, 'runs');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  process.env.PARACOSM_OUTPUT_DIR = runsDir;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DIR: appDir,
    PARACOSM_OUTPUT_DIR: runsDir,
    PARACOSM_ENABLE_RUN_HISTORY_ROUTES: 'true',
  };
  delete env.MAX_REQUEST_BODY_BYTES;
  const server = createMarsServer({
    env,
    runPairSimulations: async () => {},
    runHistoryStore: createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } }),
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { server, base: `http://127.0.0.1:${port}`, runsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function stop(served: Served): Promise<void> {
  served.server.close();
  await once(served.server, 'close');
  served.cleanup();
}

/** What the page sent to the import route: each request's body size and the answer's status. */
interface ImportCall {
  bodyBytes: number;
  status: number | string;
}

/**
 * The page's `fetch`: a path such as `/api/v1/library/import` goes to the
 * test server, as the page's own origin would serve it. Records each
 * import request.
 */
async function withPageFetch<T>(base: string, calls: ImportCall[], body: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input;
    const isImport = typeof input === 'string' && input === '/api/v1/library/import';
    const bodyBytes = typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
    try {
      const res = await realFetch(url, init);
      if (isImport) calls.push({ bodyBytes, status: res.status });
      return res;
    } catch (err) {
      if (isImport) calls.push({ bodyBytes, status: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }) as typeof fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** The hook as the Studio tab holds it after a render. */
function studioPromote(): UseStudioPromote {
  let hook: UseStudioPromote | undefined;
  function Probe(): null {
    hook = useStudioPromote();
    return null;
  }
  renderToString(React.createElement(Probe));
  assert.ok(hook, 'the hook rendered');
  return hook;
}

test('a Studio bundle of runs with snapshots over the request body limit imports, and each run keeps its snapshots', async () => {
  const run = await savedRun();
  const ext = snapshotsOf(run);
  assert.equal(ext.kernelSnapshotsPerTurn?.length, 2, 'the run saved the state at the end of each turn');
  assert.equal(ext.kernelSnapshotAtStart?.turn, 0, 'the run saved the state its first between-turn step starts from');
  assert.equal(ext.kernelSnapshotsAfterProgression?.length, 2, 'the run saved the state right after each between-turn step');

  const runBytes = bytesOf(run);
  const count = Math.ceil(DEFAULT_LIMIT_BYTES / runBytes) + 1;
  assert.ok(count <= STUDIO_BUNDLE_CAP, `${count} copies of a ${runBytes}-byte run fit a Studio bundle`);
  const bundle = copiesOf(run, count, 'bundle');
  const bundleBytes = bytesOf({ artifacts: bundle });
  assert.ok(bundleBytes > DEFAULT_LIMIT_BYTES, `the bundle's JSON (${bundleBytes} bytes) passes the default limit`);
  assert.ok(bundleBytes <= STUDIO_FILE_CAP_BYTES, `the bundle's JSON (${bundleBytes} bytes) is a file the Studio reads`);

  const served = await serve();
  try {
    const calls: ImportCall[] = [];
    const result = await withPageFetch(served.base, calls, () => studioPromote().promoteBundle(bundle));
    assert.ok(result, `the Studio's promote imported the bundle; the import route answered ${JSON.stringify(calls)}`);
    assert.deepEqual(result.runIds, bundle.map(a => a.metadata.runId), 'every run imported, in the bundle\'s order');
    assert.deepEqual(result.alreadyExisted, bundle.map(() => false));
    assert.ok(calls.length > 1, 'the page sent the bundle in parts');
    for (const call of calls) {
      assert.equal(call.status, 201, `each part was taken: ${JSON.stringify(calls)}`);
      assert.ok(call.bodyBytes <= DEFAULT_LIMIT_BYTES, `each part is under the limit: ${JSON.stringify(calls)}`);
    }

    // One Library bundle holds every run.
    const bundleRes = await fetch(`${served.base}/api/v1/bundles/${encodeURIComponent(result.bundleId)}`);
    assert.equal(bundleRes.status, 200);
    const listed = (await bundleRes.json()) as { memberCount: number; members: Array<{ runId: string }> };
    assert.equal(listed.memberCount, bundle.length, 'the parts share one bundle');
    assert.deepEqual(new Set(listed.members.map(m => m.runId)), new Set(result.runIds));

    // The server wrote its own copy of each run, and serves the snapshots from it.
    const copies = readdirSync(served.runsDir).filter(name => name.startsWith('v3-imported-') && name.endsWith('.json'));
    assert.equal(copies.length, bundle.length, 'one copy of each run under the runs directory');
    for (const sent of bundle) {
      const res = await fetch(`${served.base}/api/v1/runs/${encodeURIComponent(sent.metadata.runId)}`);
      assert.equal(res.status, 200, `${sent.metadata.runId} reads back`);
      const { artifact } = (await res.json()) as { artifact: RunArtifact };
      assert.deepEqual(snapshotsOf(artifact), snapshotsOf(sent), `${sent.metadata.runId} kept its snapshots`);
    }
  } finally {
    await stop(served);
  }
});
