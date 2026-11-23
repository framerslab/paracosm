import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { format } from 'node:util';
import { clearPool, getPoolStats } from '../../src/runtime/agents/chat-agents.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import type { BroadcastFn } from '../../src/cli/pair-runner.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import { openSessionStore } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { modelCalls, withProviderWire } from './helpers/provider-wire.js';
import { mars, settingsBody, waitFor, withVisitors, type RunServerOptions } from './helpers/run-server.js';
import type { Visitor } from './helpers/visitor.js';

const pair = JSON.parse(readFileSync(new URL('../fixtures/mars-pair-chat-2026-11-11.json', import.meta.url), 'utf-8')) as {
  events: { type: string; leader: string; data: Record<string, unknown> }[];
};
const KEY = 'visitor-model-key-fixture';
const CHAT = { agentId: 'col-bruno-morales', leader: 'Aria Chen', message: 'What happened?' };
const IDLE_MS = 30 * 60 * 1000;

const options: RunServerOptions = {
  runner: async (_config, broadcast) => {
    for (const event of pair.events) broadcast('sim', event, event.leader);
    broadcast('complete', {});
  },
  extra: { getDigitalTwinWorld: async () => null, generateText: async () => ({ text: 'Mars Genesis replay' }) },
};

async function launch(visitor: Visitor): Promise<string> {
  const response = await visitor.post('/setup', { ...settingsBody(mars), apiKey: KEY });
  assert.equal(response.status, 200);
  const { runKey } = await response.json() as { runKey: string };
  await waitFor(async () => (await visitor.json<{ isComplete: boolean }>('/results')).isComplete, 'the run to finish');
  return runKey;
}

async function chat(visitor: Visitor, runKey: string) {
  const response = await visitor.post('/chat', { ...CHAT, runKey, apiKey: KEY });
  assert.equal(response.status, 200, await response.clone().text());
}

test("a visitor-key agent has its own idle deadline even while the run is watched", async t => {
  t.after(() => clearPool());
  await withProviderWire(async () => {
    await withVisitors(async ({ cookied }) => {
      const visitor = cookied();
      const runKey = await launch(visitor);
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
      try {
        await chat(visitor, runKey);
        assert.equal(getPoolStats().active, 1);
        t.mock.timers.tick(IDLE_MS - 1);
        assert.equal(getPoolStats().active, 1);
        t.mock.timers.tick(1);
        assert.equal(getPoolStats().active, 0);
        assert.equal((await visitor.json<{ runKey: string }>('/results')).runKey, runKey);
      } finally {
        t.mock.timers.reset();
      }
    }, options);
  }, () => 'The engineering team kept the power on.');
});

test("forgetting keys drops the visitor's run and pooled agent alone", async t => {
  t.after(() => clearPool());
  await withProviderWire(async () => {
    await withVisitors(async ({ cookied }) => {
      const first = cookied();
      const second = cookied();
      const firstRun = await launch(first);
      const secondRun = await launch(second);
      await chat(first, firstRun);
      await chat(second, secondRun);
      assert.equal(getPoolStats().active, 2);

      const response = await first.post('/forget-keys', { runKey: secondRun });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { runConfigsDropped: 1, chatAgentsDropped: 1 });
      assert.equal(getPoolStats().active, 1);
      assert.equal((await first.json<{ runKey: string | null }>('/results')).runKey, null);
      assert.equal((await second.json<{ runKey: string }>('/results')).runKey, secondRun);

      assert.equal((await second.post('/clear', { runKey: secondRun })).status, 200);
      assert.equal(getPoolStats().active, 0);
    }, options);
  }, () => 'The engineering team kept the power on.');
});

test('visitor keys stay out of held run files, run records, sessions and logs', async t => {
  t.after(() => clearPool());
  const logs: string[] = [];
  for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => { logs.push(format(...args)); });
  }
  const artifact = JSON.parse(readFileSync(new URL('../fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf-8')) as RunArtifact;
  const history = createSqliteRunHistoryStore({ dbPath: ':memory:', databaseOptions: { type: 'memory' } });
  const sessions = openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } });

  await withProviderWire(async calls => {
    await withVisitors(async ({ cookied, appDir }) => {
      const visitor = cookied();
      const setup = await visitor.post('/setup', { ...settingsBody(mars), turns: 1, apiKey: KEY });
      assert.equal(setup.status, 200);
      const { runKey, runRecord } = await setup.json() as { runKey: string; runRecord: unknown };
      await waitFor(async () => (await visitor.json<{ isComplete: boolean }>('/results')).isComplete, 'the run to finish');
      await chat(visitor, runKey);
      assert.ok(modelCalls(calls).some(call => call.key === KEY), 'the chat used the supplied key');

      const file = join(appDir, '.live-runs', `${runKey}.json`);
      await waitFor(() => existsSync(file), 'the held run file');
      const saved = await waitFor(async () => (await sessions.listSessions())[0], 'the saved session');
      const storedSession = await sessions.getSession(saved.id);
      assert.ok(storedSession);
      const record = await history.getRun(artifact.metadata.runId);
      assert.ok(record);
      assert.ok(logs.length > 0);

      for (const [name, text] of [
        ['setup response', JSON.stringify(runRecord)],
        ['held run file', readFileSync(file, 'utf-8')],
        ['run record', JSON.stringify(record)],
        ['saved session', JSON.stringify(storedSession)],
        ['captured logs', logs.join('\n')],
        ['response cookies', JSON.stringify([...visitor.cookies.values()])],
      ]) {
        assert.equal(text?.includes(KEY), false, `${name} does not contain the key`);
      }
    }, {
      extra: {
        ...options.extra,
        runHistoryStore: history,
        sessionStore: sessions,
        runPairSimulations: async (
          config: NormalizedSimulationConfig,
          broadcast: BroadcastFn,
          _signal: unknown,
          _scenario: unknown,
          onArtifact: (value: RunArtifact, actor: typeof config.actors[number]) => void | Promise<void>,
        ) => {
          await onArtifact(artifact, config.actors[0]);
          for (const event of pair.events) broadcast('sim', event, event.leader);
          for (const actor of config.actors) {
            broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn: 1 } }, actor.name);
          }
          broadcast('complete', {});
        },
      },
    });
  }, () => 'The engineering team kept the power on.');
});

test('the server refuses model and search keys sent without HTTPS outside the local path', async () => {
  await withVisitors(async ({ cookied, launches }) => {
    const visitor = cookied({ 'x-forwarded-proto': 'http' });
    for (const credentials of [{ apiKey: KEY }, { tavilyKey: KEY }]) {
      const response = await visitor.post('/setup', { ...settingsBody(mars), ...credentials });
      assert.equal(response.status, 403);
      assert.match((await response.json() as { error: string }).error, /HTTPS/);
    }
    assert.equal(launches.length, 0);
  }, options);
});
