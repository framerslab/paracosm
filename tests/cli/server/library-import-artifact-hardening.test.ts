/**
 * How the imported artifact file is written and how a run's artifact
 * file is read, under conditions a plain round trip does not cover:
 *
 * - a link already sitting at the name an import would write to;
 * - the artifact entry replaced by a link between the read's check and
 *   its read;
 * - two imports of one run id arriving at once;
 * - an entry, a file or a link, already at the exact name an import
 *   writes to;
 * - a directory on the artifact's path replaced by a link to a
 *   directory outside the runs directory, and put back, around the
 *   read's open;
 * - an import whose record insert fails.
 *
 * Runs the real import handler and the real run-history routes over a
 * real SQLite store, with the Studio fixture as the imported artifact.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

test('an import whose record cannot be read back right after the insert answers 201 and keeps its file', async () => {
  const inner = memoryStore();
  // The first lookup (is the run stored?) answers; the read back after
  // the insert fails, as a locked or dropped database connection does.
  let lookups = 0;
  const store: RunHistoryStore = {
    ...inner,
    async getRun(id: string) {
      lookups += 1;
      if (lookups === 2) throw new Error('database is locked');
      return inner.getRun(id);
    },
  };

  const runId = 'run_read_back_fails';
  const imported = await importBody(store, { artifact: artifactFor(runId) });
  assert.equal(imported.status, 201, imported.body);
  assert.deepEqual(JSON.parse(imported.body), { runId, alreadyExisted: false });

  const got = await getRun(inner, runId);
  assert.equal(got.status, 200, got.body);
  assert.equal(JSON.parse(got.body).artifact.metadata.runId, runId);
});

test('an import refuses an entry already at the exact name it writes to, a file or a link, and leaves it as it was', async (t) => {
  // The random suffix is pinned, so the import writes to a name the test
  // knows and the entry planted there is really in its way.
  t.mock.method(crypto, 'randomBytes', (size: number) => Buffer.alloc(size, 0x5a));
  syncBuiltinESMExports();
  const suffix = '5a'.repeat(8);
  try {
    const store = memoryStore();

    const fileRunId = 'run_import_name_taken_by_file';
    const taken = join(runsDir, `${importedNamePrefix(fileRunId)}-${suffix}.json`);
    writeFileSync(taken, 'an entry that was here first');
    const overFile = await importBody(store, { artifact: artifactFor(fileRunId) });
    assert.equal(overFile.status, 500, overFile.body);
    assert.equal(readFileSync(taken, 'utf-8'), 'an entry that was here first', 'the file at the name is untouched');
    assert.equal(await store.getRun(fileRunId), null, 'no record was stored');

    const linkRunId = 'run_import_name_taken_by_link';
    const victim = join(outsideDir, 'victim-at-exact-name.json');
    writeFileSync(victim, 'original contents');
    const link = join(runsDir, `${importedNamePrefix(linkRunId)}-${suffix}.json`);
    symlinkSync(victim, link);
    const overLink = await importBody(store, { artifact: artifactFor(linkRunId) });
    assert.equal(overLink.status, 500, overLink.body);
    assert.equal(readFileSync(victim, 'utf-8'), 'original contents', 'the file the link points at is untouched');
    assert.equal(readlinkSync(link), victim, 'the link is still there');
    assert.equal(await store.getRun(linkRunId), null, 'no record was stored');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

/**
 * Store a record whose artifact is `<runs dir>/<name>/v3-x.json` and
 * read it while the directory `<name>` is replaced by a link to a
 * directory outside the runs directory that holds its own v3-x.json.
 * The swap happens right after the read first resolves the entry, so
 * the open goes through the link. With `swapBack`, the directory is put
 * back just before the read resolves the entry again, so the second
 * resolve lands inside the runs directory while the open file is the
 * outside one. With `swapOutAtStat` as well, the link goes back in just
 * before the read looks the resolved path up again to compare it with
 * the open file, so that lookup finds the outside file too.
 */
async function readAcrossParentSwap(
  t: TestContext,
  name: string,
  swapBack: boolean,
  swapOutAtStat = false,
): Promise<{ got: Captured; resolves: number; statSwaps: number }> {
  const store = memoryStore();
  const runId = `run_parent_${name}`;
  const sub = join(runsDir, name);
  const parked = join(base, `${name}-parked`);
  const outsideSub = join(outsideDir, name);
  mkdirSync(sub);
  mkdirSync(outsideSub);
  const entry = join(sub, 'v3-x.json');
  writeFileSync(entry, JSON.stringify(artifactFor(runId)));
  writeFileSync(join(outsideSub, 'v3-x.json'), readFileSync(outsideFile));
  await store.insertRun({
    runId,
    createdAt: '2026-11-11T00:00:00.000Z',
    scenarioId: 'mars-genesis',
    scenarioVersion: '1.0.0',
    actorConfigHash: `leaders:${name}`,
    economicsProfile: 'imported',
    sourceMode: 'local_demo',
    createdBy: 'user',
    artifactPath: entry,
  });

  const entryTail = join(name, 'v3-x.json');
  const realRealpath = fsp.realpath;
  let resolves = 0;
  t.mock.method(fsp, 'realpath', async (...args: Parameters<typeof fsp.realpath>) => {
    if (!String(args[0]).endsWith(entryTail)) return realRealpath(...args);
    resolves += 1;
    if (resolves === 2 && swapBack) {
      unlinkSync(sub);
      renameSync(parked, sub);
    }
    const out = await realRealpath(...args);
    if (resolves === 1) {
      renameSync(sub, parked);
      symlinkSync(outsideSub, sub);
    }
    return out;
  });
  const realStat = fsp.stat;
  let statSwaps = 0;
  if (swapOutAtStat) {
    t.mock.method(fsp, 'stat', async (...args: Parameters<typeof fsp.stat>) => {
      if (String(args[0]).endsWith(entryTail) && resolves === 2 && statSwaps === 0) {
        statSwaps += 1;
        renameSync(sub, parked);
        symlinkSync(outsideSub, sub);
      }
      return realStat(...args);
    });
  }
  syncBuiltinESMExports();
  try {
    return { got: await getRun(store, runId), resolves, statSwaps };
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test('a run read whose parent directory becomes a link outside the runs directory before its open is refused', async (t) => {
  const { got, resolves } = await readAcrossParentSwap(t, 'swapped-out', false);
  assert.equal(resolves, 2, 'the read resolved the entry before and after its open');
  assert.doesNotMatch(got.body, new RegExp(MARKER));
  assert.equal(got.status, 410, got.body);
  assert.equal(JSON.parse(got.body).error, 'artifact_outside_runs_dir');
});

test('a run read whose parent directory is swapped out before its open and back before its second resolve is refused', async (t) => {
  const { got, resolves } = await readAcrossParentSwap(t, 'swapped-back', true);
  assert.equal(resolves, 2, 'the read resolved the entry before and after its open');
  assert.doesNotMatch(got.body, new RegExp(MARKER));
  assert.equal(got.status, 410, got.body);
  assert.equal(JSON.parse(got.body).error, 'artifact_unreadable');
});

test(
  'a run read whose parent directory is swapped out for its open, back for its second resolve and out again for its identity check is refused',
  { skip: existsSync('/proc/self/fd') ? false : 'reading where an open descriptor points needs /proc/self/fd' },
  async (t) => {
    const { got, resolves, statSwaps } = await readAcrossParentSwap(t, 'swapped-thrice', true, true);
    assert.equal(resolves, 2, 'the read resolved the entry before and after its open');
    assert.equal(statSwaps, 1, 'the read looked the entry up again for its identity check, so the third swap ran');
    assert.doesNotMatch(got.body, new RegExp(MARKER));
    assert.equal(got.status, 410, got.body);
    assert.equal(JSON.parse(got.body).error, 'artifact_outside_runs_dir');
  },
);

test('an import whose record insert fails answers 500 and removes the file it wrote', async () => {
  const inner = memoryStore();
  let written: string | undefined;
  let existedAtInsert = false;
  const store: RunHistoryStore = {
    ...inner,
    async insertRun(run: RunRecord) {
      written = run.artifactPath;
      existedAtInsert = Boolean(written && existsSync(written));
      throw new Error('disk I/O error');
    },
  };

  const runId = 'run_insert_fails';
  const imported = await importBody(store, { artifact: artifactFor(runId) });
  assert.equal(imported.status, 500, imported.body);
  assert.ok(written, 'the insert was attempted');
  assert.ok(existedAtInsert, 'the import wrote its file before the insert');
  assert.equal(existsSync(written), false, 'the file the import wrote is removed');
  assert.deepEqual(readdirSync(runsDir).filter((n) => n.startsWith(importedNamePrefix(runId))), []);
  assert.equal(await inner.getRun(runId), null);
});
