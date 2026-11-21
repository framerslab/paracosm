/**
 * Which provider and which key a hosted demo run bills.
 *
 * On the hosted demo a /setup that brings no provider key of its own runs
 * on the host's keys. Such a run always runs on OpenAI with the demo's
 * OpenAI models, whatever provider the page posts, also when the host
 * holds an Anthropic key. A run on the visitor's own key keeps the
 * provider that key belongs to.
 *
 * When a finished run is saved, its title comes from one model call. That
 * call uses the run's own key when the run brought one, and the host's key
 * only on a host-paid run.
 *
 * A host that holds no OpenAI key refuses a host-paid run before the day's
 * limit counts it, whatever other key it holds.
 *
 * Every test goes through createMarsServer over HTTP, in hosted demo mode,
 * with both provider keys in the server's environment unless it names
 * others, and the limiter off unless it turns it on. The simulation
 * runner is a stub: it records the config the server hands it and reads
 * the provider and key that config bills the way each leader's run does
 * (resolveProviderFromCredentials, apiKeyForProvider and
 * resolveProviderWithFallback, as in runSimulation). The title model is a
 * stub that records the provider, model and key of each call. No network,
 * no paid call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BroadcastFn } from '../../src/cli/pair-runner.js';
import { applyDemoCaps, normalizeSimulationConfig, type NormalizedSimulationConfig, type SimulationSetupPayload } from '../../src/cli/sim-config.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { apiKeyForProvider, resolveProviderFromCredentials } from '../../src/engine/provider/credentials.js';
import { resolveProviderWithFallback } from '../../src/engine/provider/resolver.js';
import { openSessionStore } from '../../src/server/stores/session.js';
import { mars, settingsBody, waitFor, withVisitors, type RunServer } from './helpers/run-server.js';

const HOST_OPENAI_KEY = 'host-openai-key-for-this-test';
const HOST_ANTHROPIC_KEY = 'host-anthropic-key-for-this-test';
const VISITOR_OPENAI_KEY = 'visitor-openai-key-for-this-test';
const VISITOR_ANTHROPIC_KEY = 'visitor-anthropic-key-for-this-test';

/** The hosted demo, with the host holding a key for each provider. */
const HOST_ENV = {
  PARACOSM_HOSTED_DEMO: 'true',
  OPENAI_API_KEY: HOST_OPENAI_KEY,
  ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY,
};

/** The provider a leader's run calls and the key it calls it with, read as runSimulation reads them. */
function billedBy(config: NormalizedSimulationConfig): { provider: string; key: string | undefined } {
  const requested = resolveProviderFromCredentials(config.provider, config, 'openai');
  const { provider } = resolveProviderWithFallback(requested, {
    apiKey: apiKeyForProvider(requested, config),
    env: HOST_ENV,
    silent: true,
  });
  const own = apiKeyForProvider(provider, config);
  return { provider, key: own ?? (provider === 'anthropic' ? HOST_ANTHROPIC_KEY : HOST_OPENAI_KEY) };
}

interface TitleCall { provider: string; model: string; apiKey?: string; fallbackProviders?: unknown[] }

/** A runner that plays every leader through every turn at once and completes, so the server saves the run. */
async function finishingRunner(config: NormalizedSimulationConfig, broadcast: BroadcastFn): Promise<void> {
  broadcast('status', { phase: 'parallel', maxTurns: config.turns, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
  for (const actor of config.actors) {
    for (let turn = 1; turn <= config.turns; turn++) {
      broadcast('sim', { type: 'turn_start', leader: actor.name, data: { turn, time: turn, title: `${actor.name} turn ${turn}` } }, actor.name);
      broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn, time: turn } }, actor.name);
    }
  }
  for (const actor of config.actors) {
    broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
  }
  broadcast('complete', {});
}

async function withHostedDemo(
  body: (api: RunServer, titleCalls: TitleCall[]) => Promise<void>,
  env: Record<string, string> = HOST_ENV,
  maxSimsPerDay = 0,
): Promise<void> {
  const titleCalls: TitleCall[] = [];
  await withVisitors(api => body(api, titleCalls), {
    env,
    maxSimsPerDay,
    runner: async (config, broadcast) => finishingRunner(config, broadcast),
    extra: {
      // The server warms the digital-twin world on start; with provider
      // keys in the environment that would compile it against a provider.
      getDigitalTwinWorld: async () => null,
      sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
      generateText: async (args: TitleCall & { prompt: string }) => {
        titleCalls.push({ provider: args.provider, model: args.model, apiKey: args.apiKey, fallbackProviders: args.fallbackProviders });
        return { text: 'A saved run' };
      },
    },
  });
}

/** The runs this client has left of the day, read from GET /rate-limit. */
async function runsLeft(api: RunServer): Promise<number> {
  const answer = await api.visitor().json<{ remaining?: number; unlimited?: boolean }>('/rate-limit');
  assert.equal(answer.unlimited, undefined, 'the limiter is on');
  return Number(answer.remaining);
}

/**
 * Posts a host-paid /setup to a hosted demo whose host holds `env`'s keys,
 * with the limiter at one run a day, and checks it is refused before it
 * counts: a 503 that says why, no run started, the day's run left as it was.
 */
async function assertRefusedBeforeTheDay(env: Record<string, string>): Promise<void> {
  await withHostedDemo(async (api) => {
    assert.equal(await runsLeft(api), 1, 'one run of the day before the request');
    const res = await api.cookied().post('/setup', { ...settingsBody(mars), provider: 'anthropic' });

    assert.equal(res.status, 503, 'refused: a host-paid run runs on OpenAI only');
    const answer = await res.json() as { error?: string };
    assert.match(String(answer.error), /OpenAI/, 'the answer says why');
    assert.equal(api.launches.length, 0, 'no run started');
    assert.equal(await runsLeft(api), 1, 'the refusal did not count toward the day');
  }, env, 1);
}

async function setupAndLaunch(api: RunServer, payload: Record<string, unknown>): Promise<{ config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined }> {
  const res = await api.cookied().post('/setup', payload);
  assert.equal(res.status, 200, `POST /setup: ${await res.text()}`);
  return waitFor(() => api.launches[0] ?? null, 'the simulation runner to be called');
}

test('a host-paid /setup on the hosted demo that posts provider anthropic runs on OpenAI with the demo OpenAI models and the host OpenAI key', async () => {
  await withHostedDemo(async (api) => {
    const body = { ...settingsBody(mars), provider: 'anthropic' };
    const { config, scenario } = await setupAndLaunch(api, body);

    assert.equal(config.provider, 'openai', 'the run is configured for OpenAI');
    const demo = applyDemoCaps(normalizeSimulationConfig({ ...body, provider: 'openai' } as unknown as SimulationSetupPayload, scenario));
    assert.deepEqual(config.models, demo.models, 'the demo OpenAI models');
    assert.equal(config.economics.id, 'economy');
    for (const [role, model] of Object.entries(config.models)) {
      assert.doesNotMatch(String(model), /^claude/, `the ${role} model is not an Anthropic model`);
    }
    assert.deepEqual(billedBy(config), { provider: 'openai', key: HOST_OPENAI_KEY }, "every call bills the host's OpenAI key");
    assert.equal(config.stayOnProvider, true, 'no call of the run falls back to another provider');
  });
});

test('a host-paid /setup on a hosted demo whose host holds an Anthropic key and no OpenAI key is refused before it counts toward the day', async () => {
  await assertRefusedBeforeTheDay({ PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
});

test('a host-paid /setup on a hosted demo whose host holds neither provider key is refused before it counts toward the day', async () => {
  await assertRefusedBeforeTheDay({ PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' });
});

test("a /setup with the visitor's own Anthropic key on a hosted demo whose host holds no OpenAI key runs on that key", async () => {
  await withHostedDemo(async (api) => {
    const { config } = await setupAndLaunch(api, { ...settingsBody(mars), provider: 'anthropic', anthropicKey: VISITOR_ANTHROPIC_KEY });

    assert.equal(config.provider, 'anthropic');
    assert.equal(config.anthropicKey, VISITOR_ANTHROPIC_KEY);
  }, { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
});

test("a /setup on the hosted demo with the visitor's own Anthropic key runs on Anthropic with that key", async () => {
  await withHostedDemo(async (api) => {
    const { config } = await setupAndLaunch(api, { ...settingsBody(mars), provider: 'anthropic', anthropicKey: VISITOR_ANTHROPIC_KEY });

    assert.equal(config.provider, 'anthropic');
    assert.match(config.models.commander, /^claude/, 'the Anthropic models');
    assert.notEqual(config.economics.id, 'economy', 'no demo cap on a run on the visitor\'s own key');
    assert.deepEqual(billedBy(config), { provider: 'anthropic', key: VISITOR_ANTHROPIC_KEY }, "every call bills the visitor's Anthropic key");
  });
});

test("a saved run made on the visitor's own key makes its title call with that key", async () => {
  await withHostedDemo(async (api, titleCalls) => {
    await setupAndLaunch(api, { ...settingsBody(mars), provider: 'openai', apiKey: VISITOR_OPENAI_KEY });
    const [call] = await waitFor(() => (titleCalls.length > 0 ? titleCalls : null), 'the title call', 5000);

    assert.equal(titleCalls.length, 1, 'one title call a saved run');
    assert.equal(call.provider, 'openai');
    assert.equal(call.apiKey, VISITOR_OPENAI_KEY, "the title call carries the visitor's key");
    assert.deepEqual(call.fallbackProviders, [], 'a failed title call does not move to another provider on the environment key');
  });
});

test("a saved run made on the visitor's own Anthropic key makes its title call on Anthropic with that key", async () => {
  await withHostedDemo(async (api, titleCalls) => {
    await setupAndLaunch(api, { ...settingsBody(mars), provider: 'anthropic', anthropicKey: VISITOR_ANTHROPIC_KEY });
    const [call] = await waitFor(() => (titleCalls.length > 0 ? titleCalls : null), 'the title call', 5000);

    assert.equal(call.provider, 'anthropic');
    assert.equal(call.apiKey, VISITOR_ANTHROPIC_KEY, "the title call carries the visitor's key");
    assert.deepEqual(call.fallbackProviders, [], 'a failed title call does not move to another provider on the environment key');
  });
});

test("a saved host-paid run that posted provider anthropic makes its title call on OpenAI with the host's key", async () => {
  await withHostedDemo(async (api, titleCalls) => {
    await setupAndLaunch(api, { ...settingsBody(mars), provider: 'anthropic' });
    const [call] = await waitFor(() => (titleCalls.length > 0 ? titleCalls : null), 'the title call', 5000);

    assert.equal(call.provider, 'openai', 'the host-paid run runs on OpenAI, and so does its title');
    assert.equal(call.apiKey, undefined, "no key passed: the call uses the host's environment key");
    assert.deepEqual(call.fallbackProviders, [], 'a failed title call does not move to another provider on the host key');
  });
});
