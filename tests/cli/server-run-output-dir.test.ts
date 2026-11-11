/**
 * A server writes its runs' output files to the runs directory it
 * resolves from the env it is given, the same directory its run reads,
 * its imports, its retention sweep and its output wipe use. A server
 * given an env whose PARACOSM_OUTPUT_DIR differs from the process's
 * still writes, and reads back, its runs in its own directory.
 *
 * Runs the real server: POST /setup launches the real pair runner and
 * the real orchestrator, which writes each leader's output file, and
 * the run record is read back through GET /api/v1/runs/:runId. The
 * runs start with their signal already aborted, so the orchestrator
 * makes no model call; global fetch refuses anything that is not this
 * server, and the session title model is a stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { runPairSimulations } from '../../src/cli/pair-runner.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';

const leaderA = {
  name: 'Aria Chen',
  archetype: 'The Visionary',
  colony: 'Ares Horizon',
  hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.3, honestyHumility: 0.65 },
  instructions: 'Leader A',
};
const leaderB = {
  name: 'Dietrich Voss',
  archetype: 'The Engineer',
  colony: 'Meridian Base',
  hexaco: { openness: 0.25, conscientiousness: 0.97, extraversion: 0.3, agreeableness: 0.45, emotionality: 0.7, honestyHumility: 0.9 },
  instructions: 'Leader B',
};

function runOutputFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('v3-') && name.endsWith('.json'));
}

test('a server given its own PARACOSM_OUTPUT_DIR writes its runs there and reads them back', async () => {
  const base = mkdtempSync(join(tmpdir(), 'paracosm-run-output-dir-'));
  const appDir = join(base, 'app');
  const processDir = join(base, 'process-output');
  const serverRunsDir = join(base, 'server-runs');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(processDir, { recursive: true });
  mkdirSync(serverRunsDir, { recursive: true });

  // The process names one directory; the server is given another.
  const previousOutputDir = process.env.PARACOSM_OUTPUT_DIR;
  process.env.PARACOSM_OUTPUT_DIR = processDir;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
    throw new Error('no network in this test');
  }) as typeof fetch;

  const store = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  const aborted = new AbortController();
  aborted.abort('test_no_model_call');
  const server = createMarsServer({
    env: {
      ...process.env,
      APP_DIR: appDir,
      PARACOSM_OUTPUT_DIR: serverRunsDir,
      PARACOSM_ENABLE_RUN_HISTORY_ROUTES: 'true',
      PARACOSM_HOSTED_DEMO: '',
      PARACOSM_PLATFORM_API: '',
    },
    maxSimsPerDay: 0,
    runHistoryStore: store,
    generateText: async () => ({ text: 'Output directory test' }),
    // The real pair runner, with the signal aborted before the runs
    // start: every argument the server passes is handed on unchanged.
    runPairSimulations: (config, broadcast, _signal, scenario, onArtifact, ...rest: unknown[]) =>
      (runPairSimulations as (...args: unknown[]) => Promise<void>)(config, broadcast, aborted.signal, scenario, onArtifact, ...rest),
  });
  server.listen(0);
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;

  try {
    const setup = await fetch(`http://127.0.0.1:${port}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actors: [leaderA, leaderB], provider: 'openai', apiKey: 'placeholder-key-for-a-test', turns: 1 }),
    });
    assert.equal(setup.status, 200, await setup.clone().text());

    const deadline = Date.now() + 60_000;
    let records = await store.listRuns();
    while (records.length < 2 && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      records = await store.listRuns();
    }
    assert.equal(records.length, 2, 'both leaders finished and stored a run record');

    for (const record of records) {
      const got = await fetch(`http://127.0.0.1:${port}/api/v1/runs/${encodeURIComponent(record.runId)}`);
      const body = await got.text();
      assert.equal(got.status, 200, `run ${record.runId} read back: ${body}`);
      assert.equal(JSON.parse(body).artifact.metadata.runId, record.runId);
      assert.ok(record.artifactPath, 'the record names its output file');
      assert.equal(realpathSync(dirname(record.artifactPath)), realpathSync(serverRunsDir), 'the output file is in the server runs directory');
    }
    assert.equal(runOutputFiles(serverRunsDir).length, 2, 'both output files are in the server runs directory');
    assert.deepEqual(runOutputFiles(processDir), [], 'nothing was written to the process directory');
  } finally {
    server.close();
    await once(server, 'close');
    globalThis.fetch = realFetch;
    if (previousOutputDir === undefined) delete process.env.PARACOSM_OUTPUT_DIR;
    else process.env.PARACOSM_OUTPUT_DIR = previousOutputDir;
    rmSync(base, { recursive: true, force: true });
  }
});
