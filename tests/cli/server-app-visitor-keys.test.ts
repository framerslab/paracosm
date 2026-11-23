import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clearPool, getPoolStats } from '../../src/runtime/agents/chat-agents.js';
import { withProviderWire } from './helpers/provider-wire.js';
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
