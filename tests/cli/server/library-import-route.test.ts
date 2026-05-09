import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLibraryImport } from '../../../src/server/routes/library-import.js';
import { createSqliteRunHistoryStore } from '../../../src/server/stores/sqlite-run-history.js';
import type { RunHistoryStore } from '../../../src/server/stores/run-history.js';
import type { ServerResponse, IncomingMessage } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../../fixtures');
const turnLoopArtifact = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-turn-loop.json'), 'utf-8'));
const bundleArtifacts = JSON.parse(readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-bundle.json'), 'utf-8'));

function fakeRes(): { res: ServerResponse; status: () => number; body: () => string } {
  let status = 0;
  let body = '';
  const res = {
    writeHead(s: number) { status = s; return this; },
    end(c?: string) { if (c !== undefined) body = c; return this; },
  } as unknown as ServerResponse;
  return { res, status: () => status, body: () => body };
}

function fakeStore(): RunHistoryStore {
  return createSqliteRunHistoryStore({
    dbPath: ':memory:',
    databaseOptions: { type: 'memory' },
  });
}

test('handleLibraryImport: single artifact → 201, runId returned', async () => {
  const store = fakeStore();
  const { res, status, body } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, res, { artifact: turnLoopArtifact }, { runHistoryStore: store, sourceMode: 'local_demo' });
  assert.equal(status(), 201);
  const json = JSON.parse(body());
  assert.match(json.runId, /^run_/);
  assert.equal(json.alreadyExisted, false);
  const stored = await store.getRun(json.runId);
  assert.ok(stored);
  assert.equal(stored!.actorName, 'Aria Chen');
});

test('handleLibraryImport: re-import of same artifact → alreadyExisted: true', async () => {
  const store = fakeStore();
  const { res: r1 } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, r1, { artifact: turnLoopArtifact }, { runHistoryStore: store, sourceMode: 'local_demo' });
  const { res: r2, body: b2 } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, r2, { artifact: turnLoopArtifact }, { runHistoryStore: store, sourceMode: 'local_demo' });
  const json = JSON.parse(b2());
  assert.equal(json.alreadyExisted, true);
});

test('handleLibraryImport: malformed body → 400', async () => {
  const store = fakeStore();
  const { res, status, body } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, res, { not: 'a valid body' }, { runHistoryStore: store, sourceMode: 'local_demo' });
  assert.equal(status(), 400);
  const json = JSON.parse(body());
  assert.match(json.error, /artifact|artifacts/i);
});

test('handleLibraryImport: invalid artifact (Zod fails) → 400 with issues', async () => {
  const store = fakeStore();
  const { res, status, body } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, res, { artifact: { metadata: { runId: 'x' } } }, { runHistoryStore: store, sourceMode: 'local_demo' });
  assert.equal(status(), 400);
  const json = JSON.parse(body());
  assert.ok(Array.isArray(json.issues));
});

test('handleLibraryImport: bundle of 2 → 201, both inserted, shared bundleId', async () => {
  const store = fakeStore();
  const { res, status, body } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, res, { artifacts: bundleArtifacts }, { runHistoryStore: store, sourceMode: 'local_demo' });
  assert.equal(status(), 201);
  const json = JSON.parse(body());
  assert.equal(json.runIds.length, 2);
  assert.match(json.bundleId, /^bundle_/);
  for (const runId of json.runIds) {
    const stored = await store.getRun(runId);
    assert.ok(stored);
    assert.equal(stored!.bundleId, json.bundleId);
  }
});

test('handleLibraryImport: bundle of 51 → 400', async () => {
  const store = fakeStore();
  const big = Array.from({ length: 51 }, () => turnLoopArtifact);
  const { res, status } = fakeRes();
  await handleLibraryImport({} as IncomingMessage, res, { artifacts: big }, { runHistoryStore: store, sourceMode: 'local_demo' });
  assert.equal(status(), 400);
});
