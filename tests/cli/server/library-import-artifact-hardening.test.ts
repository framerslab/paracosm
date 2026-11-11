/**
 * How the imported artifact file is written and how a run's artifact
 * file is read, under conditions a plain round trip does not cover:
 *
 * - a link already sitting at the name an import would write to;
 * - the artifact entry replaced by a link between the read's check and
 *   its read;
 * - two imports of one run id arriving at once.
 *
 * Runs the real import handler and the real run-history routes over a
 * real SQLite store, with the Studio fixture as the imported artifact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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

const base = mkdtempSync(join(tmpdir(), 'paracosm-artifact-hardening-'));
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

/** The fixture under another run id, tagged so two copies can be told apart. */
function artifactFor(runId: string, tag?: string): typeof turnLoopArtifact {
  const copy = JSON.parse(JSON.stringify(turnLoopArtifact));
  copy.metadata.runId = runId;
  if (tag) copy.scenarioExtensions = { ...(copy.scenarioExtensions ?? {}), importCopy: tag };
  return copy;
}

function importedNamePrefix(runId: string): string {
  return `v3-imported-${createHash('sha256').update(runId).digest('hex').slice(0, 32)}`;
}

async function importBody(store: RunHistoryStore, body: unknown): Promise<Captured> {
  const captured: Captured = { status: 0, body: '' };
  await handleLibraryImport({} as IncomingMessage, fakeRes(captured), body, {
    runHistoryStore: store,
    sourceMode: 'local_demo',
  });
  return captured;
}

async function getRun(store: RunHistoryStore, runId: string): Promise<Captured> {
  const captured: Captured = { status: 0, body: '' };
  await handlePlatformApiRoute(
    { url: `/api/v1/runs/${encodeURIComponent(runId)}`, method: 'GET' } as unknown as IncomingMessage,
    fakeRes(captured),
    {
      runHistoryStore: store,
      corsHeaders: {},
      paracosmRoutesEnabled: true,
      scenarioLookup: () => undefined,
    },
  );
  return captured;
}

test('an import does not write through a link planted at the name derived from its run id', async () => {
  const store = memoryStore();
  const runId = 'run_import_link_planted';
  const victim = join(outsideDir, 'victim.json');
  writeFileSync(victim, 'original contents');
  symlinkSync(victim, join(runsDir, `${importedNamePrefix(runId)}.json`));

  const imported = await importBody(store, { artifact: artifactFor(runId) });
  assert.equal(imported.status, 201, imported.body);
  assert.equal(readFileSync(victim, 'utf-8'), 'original contents', 'the file the link points at is untouched');

  const got = await getRun(store, runId);
  assert.equal(got.status, 200, got.body);
  assert.equal(JSON.parse(got.body).artifact.metadata.runId, runId);
});

test('a run read checks and reads one file: the entry replaced by a link after the check is not read', async (t) => {
  // The swap is injected through the file system call the read makes on
  // the entry: right after the entry is resolved, it is replaced by a
  // link to a file outside the runs directory. A read that opens the
  // entry again by name after that point reads the outside file.
  const store = memoryStore();
  const runId = 'run_entry_swapped';
  const entry = join(runsDir, 'v3-swapped-entry.json');
  writeFileSync(entry, JSON.stringify(artifactFor(runId)));
  const record: RunRecord = {
    runId,
    createdAt: '2026-11-11T00:00:00.000Z',
    scenarioId: 'mars-genesis',
    scenarioVersion: '1.0.0',
    actorConfigHash: 'leaders:swap-test',
    economicsProfile: 'imported',
    sourceMode: 'local_demo',
    createdBy: 'user',
    artifactPath: entry,
  };
  await store.insertRun(record);

  const realRealpath = fsp.realpath;
  let swapped = false;
  t.mock.method(fsp, 'realpath', async (...args: Parameters<typeof fsp.realpath>) => {
    const out = await realRealpath(...args);
    if (!swapped && resolve(String(args[0])) === entry) {
      swapped = true;
      unlinkSync(entry);
      symlinkSync(outsideFile, entry);
    }
    return out;
  });
  syncBuiltinESMExports();
  let got: Captured;
  try {
    got = await getRun(store, runId);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }

  assert.ok(swapped, 'the read resolved the entry, so the swap ran');
  assert.doesNotMatch(got.body, new RegExp(MARKER));
  assert.equal(got.status, 410, got.body);
});

test('two imports of one run id at once: the file on disk belongs to the stored record, the later import reports alreadyExisted', async () => {
  const inner = memoryStore();
  // Both imports pass the "already stored?" check before either stores
  // its record: the first two lookups wait for each other.
  let lookups = 0;
  let arrived = 0;
  let releaseLookups!: () => void;
  const bothArrived = new Promise<void>((done) => { releaseLookups = done; });
  const store: RunHistoryStore = {
    ...inner,
    async getRun(id: string) {
      lookups += 1;
      if (lookups <= 2) {
        arrived += 1;
        if (arrived === 2) releaseLookups();
        await bothArrived;
      }
      return inner.getRun(id);
    },
  };

  const runId = 'run_concurrent_import';
  const [first, second] = await Promise.all([
    importBody(store, { artifact: artifactFor(runId, 'first') }),
    importBody(store, { artifact: artifactFor(runId, 'second') }),
  ]);
  assert.equal(first.status, 201, first.body);
  assert.equal(second.status, 201, second.body);
  const results = [JSON.parse(first.body), JSON.parse(second.body)] as Array<{ runId: string; alreadyExisted: boolean }>;
  assert.deepEqual(
    results.map((r) => r.alreadyExisted).sort(),
    [false, true],
    'exactly one import stores the run; the other reports alreadyExisted',
  );
  const storedTag = results[0].alreadyExisted ? 'second' : 'first';

  const got = await getRun(inner, runId);
  assert.equal(got.status, 200, got.body);
  assert.equal(JSON.parse(got.body).artifact.scenarioExtensions?.importCopy, storedTag);

  const files = readdirSync(runsDir).filter((name) => name.startsWith(importedNamePrefix(runId)));
  assert.equal(files.length, 1, `one imported file for the run, found: ${files.join(', ')}`);
});
