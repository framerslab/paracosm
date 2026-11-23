import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { format } from 'node:util';
import { clearPool, getPoolStats, type ChatAgentOptions, type ColonistMemoryEntry, type ColonistProfile } from '../../src/runtime/agents/chat-agents.js';
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

test("a finished run's keys go after the idle time while its page stays open", async t => {
  const agents: ChatAgentOptions[] = [];
  await withVisitors(async ({ cookied }) => {
    const visitor = cookied();
    const runKey = await launch(visitor);
    // The visitor's page stays open on the finished run, so the run is kept.
    const page = new AbortController();
    const stream = await visitor.get('/events', { signal: page.signal });
    assert.equal(stream.status, 200);
    const chatWithoutKey = async () => {
      const response = await visitor.post('/chat', { ...CHAT, runKey });
      await response.body?.cancel();
    };
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      await chatWithoutKey();
      assert.equal(agents.length, 1);
      assert.equal(agents[0].apiKey, KEY, "on the hosted demo a chat with no key runs on the run's key");
      t.mock.timers.tick(IDLE_MS + 1);
      assert.equal((await visitor.json<{ runKey: string }>('/results')).runKey, runKey, 'the open page keeps the run');
      await chatWithoutKey();
      assert.equal(agents.length, 2);
      assert.notEqual(agents[1].apiKey, KEY, "the run's key went after the idle time");
    } finally {
      t.mock.timers.reset();
      page.abort();
    }
  }, {
    ...options,
    env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'host-model-key-fixture' },
    extra: {
      ...options.extra,
      chatAgent: async (_profile: ColonistProfile, _memories: ColonistMemoryEntry[], opts: ChatAgentOptions) => {
        agents.push(opts);
        return { session: { send: async () => ({ text: 'Stub reply.', usage: {} }) }, isNew: true };
      },
    },
  });
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

test("forgetting keys drops the visitor's agents on the shared run they watch and keeps that run", async t => {
  t.after(() => clearPool());
  await withProviderWire(async () => {
    await withVisitors(async ({ visitor, cookied }) => {
      // A local server's own run, which a browser with no run of its own watches.
      const shared = visitor();
      const runKey = await launch(shared);
      const browser = cookied();
      assert.equal((await browser.json<{ runKey: string }>('/results')).runKey, runKey);
      const sent = await browser.post('/chat', { ...CHAT, apiKey: KEY });
      assert.equal(sent.status, 200, await sent.clone().text());
      assert.equal(getPoolStats().active, 1);

      const response = await browser.post('/forget-keys', {});
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { runConfigsDropped: 0, chatAgentsDropped: 1 });
      assert.equal(getPoolStats().active, 0);
      assert.equal((await shared.json<{ runKey: string }>('/results')).runKey, runKey, 'the shared run stays');
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
      const setupAnswer = await setup.text();
      const { runKey, run } = JSON.parse(setupAnswer) as { runKey: string; run: unknown };
      assert.ok(run);
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
        ['setup response', setupAnswer],
        ['held run file', readFileSync(file, 'utf-8')],
        ['run record', JSON.stringify(record)],
        ['saved session', JSON.stringify(storedSession)],
        ['captured logs', logs.join('\n')],
        ['response cookies', JSON.stringify([...visitor.cookies.values()])],
      ]) {
        assert.equal(text.includes(KEY), false, `${name} does not contain the key`);
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

/**
 * POSTs a key-bearing /setup from 127.0.0.2, a peer the server does not count
 * as this computer's own: how a proxy in another container, or a container's
 * published port, reaches the server. Answers the status.
 */
async function setupFromAnotherPeer(base: string, headers: Record<string, string>): Promise<number> {
  const body = JSON.stringify({ ...settingsBody(mars), apiKey: KEY });
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: new URL(base).port,
      path: '/setup',
      method: 'POST',
      localAddress: '127.0.0.2',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...headers },
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('a key reaches the server from a browser on this computer through a container port, or over HTTPS through a named proxy', async () => {
  const proxy = { 'x-forwarded-for': '203.0.113.7', host: 'paracosm.example' };
  await withVisitors(async ({ base }) => {
    // The browser addressed localhost; the server sees the container bridge's address.
    assert.equal(await setupFromAnotherPeer(base, { host: `localhost:${new URL(base).port}` }), 200);
    // The proxy the operator named reached the browser over HTTPS.
    assert.equal(await setupFromAnotherPeer(base, { ...proxy, 'x-forwarded-proto': 'https' }), 200);
    // Plain HTTP through that proxy is refused.
    assert.equal(await setupFromAnotherPeer(base, { ...proxy, 'x-forwarded-proto': 'http' }), 403);
  }, { ...options, env: { PARACOSM_ALLOWED_HOSTS: 'paracosm.example', PARACOSM_CLIENT_IP_HEADER: 'x-forwarded-for' } });

  // With no proxy named, another peer's word that the browser used HTTPS is not taken.
  await withVisitors(async ({ base, launches }) => {
    assert.equal(await setupFromAnotherPeer(base, { ...proxy, 'x-forwarded-proto': 'https' }), 403);
    assert.equal(launches.length, 0);
  }, { ...options, env: { PARACOSM_ALLOWED_HOSTS: 'paracosm.example' } });
});
