/**
 * Who pays for each model call on the hosted demo, and where it goes.
 *
 * On the hosted demo a request that brings no provider key of its own runs
 * on the host's keys. Every model call such a request makes runs on OpenAI,
 * with the demo's OpenAI models, and never falls back to another provider:
 * the run's commander, departments, director, reactions, tool review and
 * verdict, a /simulate run, a Quickstart draft, its hook compile and its
 * actors, a Digital Twin run, a /compile and a chat. A host that holds no
 * OpenAI key refuses such a request before the day's limit counts it. A
 * request with the visitor's own key runs on that key's provider and that
 * key, and so does a chat with no key of its own on a run the visitor's key
 * paid for.
 *
 * Every test but the chat agent pool's goes through createMarsServer over
 * HTTP in hosted demo mode.
 * Where a test runs the server's own model calls, the providers are stubs at
 * the wire (./helpers/provider-wire.ts): every call to OpenAI, Anthropic or
 * OpenRouter is recorded with its provider, model and key and answered with
 * an error AgentOS falls back on, so a call that may fall back to another
 * provider shows up as a call to that provider. Elsewhere the step that
 * would call a model is a stub that records what the server handed it. No
 * network, no paid call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScenarioPackage } from '../../src/engine/types.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import type { WorldModel } from '../../src/runtime/world-model/index.js';
import { chatAgentPoolKey, type ChatAgentOptions, type ColonistMemoryEntry, type ColonistProfile } from '../../src/runtime/agents/chat-agents.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { createEmergentEngine } from '../../src/runtime/orchestrator/emergent-setup.js';
import { openSessionStore } from '../../src/server/stores/session.js';
import { mars, settingsBody, waitFor, withVisitors, type RunServer, type RunServerOptions } from './helpers/run-server.js';
import { describeCalls, modelCalls, setHostKeys, withProviderWire, type WireCall, type WireReply } from './helpers/provider-wire.js';

const HOST_OPENAI_KEY = 'host-openai-key-for-this-test';
const HOST_ANTHROPIC_KEY = 'host-anthropic-key-for-this-test';
const VISITOR_OPENAI_KEY = 'visitor-openai-key-for-this-test';
const VISITOR_ANTHROPIC_KEY = 'visitor-anthropic-key-for-this-test';

/** The hosted demo, with the host holding a key for each provider. */
const HOST_ENV = { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY };
/** The hosted demo, with the host holding an Anthropic key and no OpenAI key. */
const ANTHROPIC_ONLY_ENV = { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY };
/** The hosted demo, with the host holding no provider key. */
const NO_KEYS_ENV = { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' };

/**
 * A hosted demo server with no Digital Twin compile at boot, an in-memory
 * session store, a title call that calls no model, and a scenario folder of
 * its own, so a compiled scenario is written to none of the repository's.
 */
async function hosted(body: (api: RunServer) => Promise<void>, options: RunServerOptions = {}): Promise<void> {
  const scenarioDir = mkdtempSync(join(tmpdir(), 'paracosm-hosted-model-calls-'));
  try {
    await withVisitors(body, {
      env: HOST_ENV,
      scenarioDir,
      ...options,
      extra: {
        getDigitalTwinWorld: async () => null,
        sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
        generateText: async () => ({ text: 'A saved run' }),
        ...options.extra,
      },
    });
  } finally {
    rmSync(scenarioDir, { recursive: true, force: true });
  }
}

/** The runs this client has left of the day, read from GET /rate-limit. */
async function runsLeft(api: RunServer): Promise<number> {
  const answer = await api.visitor().json<{ remaining?: number; unlimited?: boolean }>('/rate-limit');
  assert.equal(answer.unlimited, undefined, 'the limiter is on');
  return Number(answer.remaining);
}

/** The models of a host-paid hosted /setup run, read from the config the server hands the runner. */
async function hostedSetupModels(api: RunServer): Promise<Record<string, string>> {
  const res = await api.cookied().post('/setup', settingsBody(mars));
  assert.equal(res.status, 200, `POST /setup: ${await res.text()}`);
  const { config } = await waitFor(() => api.launches[0] ?? null, 'the hosted /setup run');
  return { ...config.models };
}

/** The requests that asked a provider other than OpenAI for a completion. */
function offOpenAi(calls: readonly WireCall[]): WireCall[] {
  return modelCalls(calls).filter(c => c.provider !== 'openai');
}

/** Asserts the record holds completion requests, every one to OpenAI on the host's key, and returns them. */
function assertOnHostOpenAi(calls: readonly WireCall[], what: string): WireCall[] {
  const record = describeCalls(calls);
  assert.deepEqual(offOpenAi(calls).map(c => `${c.provider} ${c.path}`), [], `${what}: no model call went to another provider. The stub received:\n${record}`);
  const openai = modelCalls(calls).filter(c => c.provider === 'openai');
  assert.ok(openai.length > 0, `${what}: the calls reached OpenAI. The stub received:\n${record}`);
  for (const call of openai) {
    assert.equal(call.key, HOST_OPENAI_KEY, `${what}: ${call.path} bills the host's OpenAI key`);
  }
  return openai;
}

/** A leader /simulate takes: Mars Genesis's first preset leader. */
const SIMULATE_LEADER = { ...mars.presets[0].leaders[0], unit: 'Colony Alpha' };

// ---------------------------------------------------------------------------
// A /setup run on the host's keys
// ---------------------------------------------------------------------------

/** Text only one role's request carries, for each role of a run. */
const ROLE_MARKS: Record<string, string> = {
  commander: 'You receive department reports and make strategic decisions',
  departments: 'forge_tool(',
  director: 'GENERATE EVENT FOR TURN',
  reactions: 'AGENT id=',
  verdict: 'Your job is to decide which of them ran the',
};

/**
 * The commander's promotion call is answered with `{}`, which fails its
 * schema, so the run takes the fallback that promotes each department's
 * top candidate: a promotion call that fails at the provider ends the run.
 * Every other call is answered with the stub's error, which each of them
 * meets with its own fallback, so the run reaches every role.
 */
const promotionsAnsweredEmpty: WireReply = call => (call.text.includes('You must promote') ? '{}' : undefined);

test('every model call of a host-paid /setup run on the hosted demo stays on OpenAI with the host key when OpenAI fails', async () => {
  const restore = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
  try {
    await withProviderWire(async calls => {
      await hosted(async api => {
        const page = api.cookied();
        // Three turns: Mars Genesis plays its milestones on the first and the
        // last, so the second turn asks the director.
        const res = await page.post('/setup', { ...settingsBody(mars), turns: 3, provider: 'anthropic' });
        assert.equal(res.status, 200, `POST /setup: ${await res.text()}`);
        await waitFor(async () => (await page.json<{ isComplete: boolean }>('/results')).isComplete, 'the run to finish', 120_000);

        const openai = assertOnHostOpenAi(calls, 'the run');
        const sent = openai.map(c => c.text).join('\n\n');
        for (const [role, mark] of Object.entries(ROLE_MARKS)) {
          assert.ok(sent.includes(mark), `the ${role} call was made and reached OpenAI. The stub received:\n${describeCalls(calls)}`);
        }
        for (const call of openai) {
          assert.doesNotMatch(String(call.model), /^claude/, `${call.path} names an OpenAI model`);
        }
      }, { extra: { runPairSimulations: undefined } });
    }, promotionsAnsweredEmpty);
  } finally {
    restore();
  }
});

test("a host-paid run's tool review stays on OpenAI when OpenAI fails", async () => {
  const restore = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
  try {
    await withProviderWire(async calls => {
      // The engine a host-paid run builds: no key of the run's own, the run
      // kept on its provider.
      const { engine } = createEmergentEngine(
        new Map(), 'openai', 'gpt-5.4-nano', {}, undefined, undefined, undefined, undefined, true,
      );
      await engine.forge(
        {
          name: 'sum_two',
          description: 'Adds two numbers.',
          inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
          outputSchema: { type: 'object', properties: { total: { type: 'number' } } },
          implementation: { mode: 'sandbox', code: 'function execute(input) { return { total: input.a + input.b }; }', allowlist: [] },
          testCases: [{ input: { a: 1, b: 2 } }],
        },
        { agentId: 'dept-test', sessionId: 'sess-test' },
      );
      assertOnHostOpenAi(calls, 'the tool review');
    });
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// POST /simulate
// ---------------------------------------------------------------------------

const SIMULATE_ENV = { ...HOST_ENV, PARACOSM_ENABLE_SIMULATE_ENDPOINT: 'true' };

test('a host-paid /simulate on the hosted demo runs on OpenAI with the hosted models, whatever provider and cost preset it asks for', async () => {
  const restore = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
  const compiles: Array<Record<string, unknown>> = [];
  try {
    await withProviderWire(async calls => {
      await hosted(async api => {
        const hostedModels = Object.values(await hostedSetupModels(api));
        await api.cookied().post('/simulate', {
          scenario: { id: mars.id },
          leader: SIMULATE_LEADER,
          options: { provider: 'anthropic', costPreset: 'quality', maxTurns: 1 },
        });

        assert.equal(compiles.length, 1, 'the scenario was compiled once');
        assert.equal(compiles[0].provider, 'openai', 'the compile runs on OpenAI');
        assert.equal(compiles[0].stayOnProvider, true, 'the compile does not fall back to another provider');
        assert.equal(compiles[0].webSearch, false, "the compile runs no web search on the host's keys");
        assert.equal(compiles[0].apiKey, undefined);
        assert.equal(compiles[0].anthropicKey, undefined);
        const openai = assertOnHostOpenAi(calls, 'the /simulate run');
        for (const call of openai) {
          assert.ok(hostedModels.includes(String(call.model)), `${call.path} names ${call.model}, one of the hosted models ${hostedModels.join(', ')}`);
        }
      }, {
        env: SIMULATE_ENV,
        compileScenario: async (_json, options) => {
          compiles.push(options);
          return marsScenario;
        },
      });
    });
  } finally {
    restore();
  }
});

test('a host-paid /simulate on a hosted demo with no host OpenAI key is refused before it counts toward the day', async () => {
  let compiles = 0;
  await withProviderWire(async calls => {
    await hosted(async api => {
      assert.equal(await runsLeft(api), 1);
      const res = await api.cookied().post('/simulate', { scenario: { id: mars.id }, leader: SIMULATE_LEADER, options: { maxTurns: 1 } });
      assert.equal(res.status, 503, 'refused: a host-paid run runs on OpenAI only');
      assert.match(String((await res.json() as { error?: string }).error), /OpenAI/);
      assert.equal(compiles, 0, 'nothing was compiled');
      assert.equal(await runsLeft(api), 1, 'the refusal did not count toward the day');
      assert.deepEqual(modelCalls(calls), []);
    }, {
      env: { ...NO_KEYS_ENV, PARACOSM_ENABLE_SIMULATE_ENDPOINT: 'true' },
      maxSimsPerDay: 1,
      compileScenario: async () => {
        compiles += 1;
        return marsScenario;
      },
    });
  });
});

test("a /simulate on the hosted demo reads no seed URL through the host's keys", async () => {
  let compiles = 0;
  await withProviderWire(async () => {
    await hosted(async api => {
      const res = await api.cookied().post('/simulate', {
        scenario: { id: mars.id },
        leader: SIMULATE_LEADER,
        options: { maxTurns: 1, seedUrl: 'https://example.com/brief' },
      });
      assert.equal(res.status, 400, 'a seed URL is refused on the hosted demo');
      assert.match(String((await res.json() as { error?: string }).error), /seedText/);
      assert.equal(compiles, 0, 'nothing was compiled');
    }, {
      env: SIMULATE_ENV,
      compileScenario: async () => {
        compiles += 1;
        return marsScenario;
      },
    });
  });
});

// ---------------------------------------------------------------------------
// The Digital Twin
// ---------------------------------------------------------------------------

const TWIN_BODY = {
  subject: { id: 's', name: 'Subject' },
  intervention: { id: 'i', name: 'Plan', description: 'Apply the plan' },
  options: { maxTurns: 1 },
};

/** A Digital Twin world whose engine records the options it is run with. */
function twinWorld() {
  const runs: Array<Record<string, unknown>> = [];
  let prepared = 0;
  const world = {
    scenario: marsScenario,
    intervene: async (opts: Record<string, unknown>) => {
      runs.push(opts);
      return { metadata: { runId: `twin-${runs.length}` }, finalState: { metrics: {} } } as unknown as RunArtifact;
    },
  } as unknown as WorldModel;
  return {
    runs,
    prepared: () => prepared,
    getDigitalTwinWorld: async () => {
      prepared += 1;
      return world;
    },
  };
}

test('a host-paid Digital Twin run on the hosted demo runs on OpenAI with the models of a hosted /setup run, with the limiter off', async () => {
  const twin = twinWorld();
  await hosted(async api => {
    const hostedModels = await hostedSetupModels(api);
    const res = await api.cookied().post('/api/quickstart/simulate-intervention', TWIN_BODY);
    assert.equal(res.status, 200, `the Twin run: ${await res.text()}`);

    assert.equal(twin.runs.length, 1);
    const [run] = twin.runs;
    assert.equal(run.provider, 'openai', 'the Twin runs on OpenAI');
    assert.deepEqual(run.models, hostedModels, 'the models of a hosted /setup run');
    assert.equal(run.stayOnProvider, true, 'the Twin does not fall back to another provider');
    assert.equal(run.apiKey, undefined);
    assert.equal(run.anthropicKey, undefined);
  }, { maxSimsPerDay: 0, extra: { getDigitalTwinWorld: twin.getDigitalTwinWorld } });
});

test("a Digital Twin run with the visitor's Anthropic key runs on that key", async () => {
  const twin = twinWorld();
  await hosted(async api => {
    const res = await api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, anthropicKey: VISITOR_ANTHROPIC_KEY });
    assert.equal(res.status, 200, `the Twin run: ${await res.text()}`);
    const [run] = twin.runs;
    assert.equal(run.provider, 'anthropic', "the run is on the visitor's provider");
    assert.equal(run.anthropicKey, VISITOR_ANTHROPIC_KEY, "the run carries the visitor's key");
    assert.equal(run.apiKey, undefined);
  }, { extra: { getDigitalTwinWorld: twin.getDigitalTwinWorld } });
});

test('a host-paid Digital Twin run on a hosted demo with no host OpenAI key is refused before the world is prepared and before it counts toward the day', async () => {
  const twin = twinWorld();
  await hosted(async api => {
    const before = twin.prepared();
    assert.equal(await runsLeft(api), 1);
    const res = await api.cookied().post('/api/quickstart/simulate-intervention', TWIN_BODY);
    assert.equal(res.status, 503, 'refused: a host-paid run runs on OpenAI only');
    assert.match(String((await res.json() as { error?: string }).error), /OpenAI/);
    assert.equal(twin.prepared(), before, 'the world was not prepared for it');
    assert.equal(twin.runs.length, 0, 'no Twin run started');
    assert.equal(await runsLeft(api), 1, 'the refusal did not count toward the day');
  }, { env: ANTHROPIC_ONLY_ENV, maxSimsPerDay: 1, extra: { getDigitalTwinWorld: twin.getDigitalTwinWorld } });
});

// ---------------------------------------------------------------------------
// POST /compile
// ---------------------------------------------------------------------------

test('a host-paid /compile on the hosted demo compiles on OpenAI with the demo compile model, whatever provider it posts', async () => {
  const compiles: Array<Record<string, unknown>> = [];
  await hosted(async api => {
    const page = api.cookied();
    const active = await page.json<Record<string, unknown>>('/scenario');
    const res = await page.post('/compile', { scenario: { ...active, id: 'host-paid-compile' }, provider: 'anthropic', webSearch: false });
    await res.text();

    assert.equal(compiles.length, 1);
    assert.equal(compiles[0].provider, 'openai', 'the compile runs on OpenAI');
    assert.equal(compiles[0].model, 'gpt-5.4-nano', 'the demo compile model');
    assert.equal(compiles[0].stayOnProvider, true, 'the compile does not fall back to another provider');
    assert.equal(compiles[0].apiKey, undefined);
    assert.equal(compiles[0].anthropicKey, undefined);
  }, {
    compileScenario: async (json, options) => {
      compiles.push(options);
      return { ...json, departments: [], hooks: {} } as unknown as ScenarioPackage;
    },
  });
});

test('a host-paid /compile on a hosted demo with no host OpenAI key is refused and compiles nothing', async () => {
  let compiles = 0;
  await hosted(async api => {
    const page = api.cookied();
    const active = await page.json<Record<string, unknown>>('/scenario');
    const res = await page.post('/compile', { scenario: { ...active, id: 'host-paid-compile' }, webSearch: false });
    assert.equal(res.status, 503, 'refused: a host-paid compile runs on OpenAI only');
    assert.match(String((await res.json() as { error?: string }).error), /OpenAI/);
    assert.equal(compiles, 0, 'nothing was compiled');
  }, {
    env: ANTHROPIC_ONLY_ENV,
    compileScenario: async json => {
      compiles += 1;
      return { ...json, departments: [], hooks: {} } as unknown as ScenarioPackage;
    },
  });
});

// ---------------------------------------------------------------------------
// POST /chat
// ---------------------------------------------------------------------------

interface SimEvent { type: string; leader: string; data: Record<string, unknown> }
const pair = JSON.parse(
  readFileSync(new URL('../fixtures/mars-pair-chat-2026-11-11.json', import.meta.url), 'utf-8'),
) as { events: SimEvent[] };
/** The Chief Engineer, who reacted under both leaders of the saved pair. */
const PERSON = 'col-bruno-morales';

/** The options of the chat agent the server builds for one chat with no key of its own, after a run started with `setup`. */
async function chatAfterRun(setup: Record<string, unknown>): Promise<ChatAgentOptions> {
  const agents: ChatAgentOptions[] = [];
  await hosted(async api => {
    const page = api.cookied();
    assert.equal((await page.post('/setup', setup)).status, 200);
    await waitFor(async () => (await page.json<{ isComplete: boolean }>('/results')).isComplete, 'the run to finish', 10_000);
    const res = await page.post('/chat', { agentId: PERSON, leader: 'Aria Chen', message: 'What happened?' });
    assert.equal(res.status, 200, `POST /chat: ${await res.clone().text()}`);
  }, {
    runner: async (_config, broadcast) => {
      for (const e of pair.events) broadcast('sim', e, e.leader);
      broadcast('complete', {});
    },
    extra: {
      chatAgent: async (_profile: ColonistProfile, _memories: ColonistMemoryEntry[], opts: ChatAgentOptions) => {
        agents.push(opts);
        return { session: { send: async () => ({ text: 'Stub reply.', usage: {} }) }, isNew: true };
      },
    },
  });
  assert.equal(agents.length, 1, 'one chat agent');
  return agents[0];
}

test("a chat with no key of its own on a run made with the visitor's Anthropic key runs on that run's key", async () => {
  const opts = await chatAfterRun({ ...settingsBody(mars), provider: 'anthropic', anthropicKey: VISITOR_ANTHROPIC_KEY });
  assert.equal(opts.provider, 'anthropic', "the chat is on the run's provider");
  assert.equal(opts.anthropicKey, VISITOR_ANTHROPIC_KEY, "the chat carries the run's own key, not the host's");
  assert.equal(opts.apiKey, undefined);
});

test('a host-paid chat on the hosted demo runs on OpenAI and does not fall back to another provider', async () => {
  const opts = await chatAfterRun({ ...settingsBody(mars), provider: 'anthropic' });
  assert.equal(opts.provider, 'openai', 'the chat is on OpenAI');
  assert.equal(opts.apiKey, undefined);
  assert.equal(opts.anthropicKey, undefined);
  assert.equal(opts.stayOnProvider, true, 'the chat does not fall back to another provider');
});

test('a chat agent kept on its provider is never the agent made for a chat that may fall back', () => {
  const person: ColonistProfile = { agentId: PERSON, name: 'Bruno Morales' };
  const opts: ChatAgentOptions = { provider: 'openai', runKey: 'run-1', leader: 'Aria Chen' };
  assert.notEqual(
    chatAgentPoolKey(person, { ...opts, stayOnProvider: true }),
    chatAgentPoolKey(person, opts),
    'on the environment key, a chat that stays on its provider and one that may fall back talk to different agents',
  );
  assert.equal(
    chatAgentPoolKey(person, { ...opts, apiKey: VISITOR_OPENAI_KEY, stayOnProvider: true }),
    chatAgentPoolKey(person, { ...opts, apiKey: VISITOR_OPENAI_KEY }),
    'on an explicit key no chat falls back, so both talk to one agent',
  );
});

// ---------------------------------------------------------------------------
// Quickstart: the seed compile and the actors
// ---------------------------------------------------------------------------

/** A seed of more than 200 characters, distinct per test: the compile jobs are shared by signature. */
function seed(tag: string): string {
  return `${tag}: a coastal town of four thousand people runs its own water utility. `.repeat(6);
}

/** The options of the seed compile the server starts for `body`. */
async function seedCompile(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const compiles: Array<Record<string, unknown>> = [];
  await hosted(async api => {
    const res = await api.cookied().post('/api/quickstart/compile-from-seed', body);
    assert.equal(res.status, 202, `POST compile-from-seed: ${await res.clone().text()}`);
    await waitFor(() => compiles.length > 0, 'the seed compile to start');
  }, {
    extra: {
      compileFromSeed: async (_input: unknown, options: Record<string, unknown>) => {
        compiles.push(options);
        return { ...marsScenario, id: `seed-compile-${compiles.length}` };
      },
    },
  });
  return compiles[0];
}

test("a Quickstart seed compile with the visitor's Anthropic key drafts and compiles on that key", async () => {
  const options = await seedCompile({ seedText: seed('own key'), anthropicKey: VISITOR_ANTHROPIC_KEY });
  assert.equal(options.draftProvider, 'anthropic', "the draft is on the visitor's provider");
  assert.match(String(options.draftModel), /^claude/, 'an Anthropic model drafts');
  assert.equal(options.provider, 'anthropic', "the hook compile is on the visitor's provider");
  assert.equal(options.anthropicKey, VISITOR_ANTHROPIC_KEY, "the compile carries the visitor's key");
  assert.equal(options.apiKey, undefined);
});

test('a host-paid Quickstart seed compile drafts and compiles on OpenAI and does not fall back to another provider', async () => {
  const options = await seedCompile({ seedText: seed('host paid') });
  assert.equal(options.draftProvider, 'openai');
  assert.equal(options.provider, 'openai', 'the hook compile is on OpenAI');
  assert.equal(options.stayOnProvider, true, 'the compile does not fall back to another provider');
  assert.equal(options.apiKey, undefined);
  assert.equal(options.anthropicKey, undefined);
});

test('a Quickstart seed compile on another key starts a compile of its own, and a retry on the same key joins the one it started', async () => {
  const compiles: Array<Record<string, unknown>> = [];
  const finish: Array<() => void> = [];
  const seedText = seed('two keys');
  await hosted(async api => {
    const page = api.cookied();
    const jobOf = async (body: Record<string, unknown>): Promise<string> => {
      const res = await page.post('/api/quickstart/compile-from-seed', body);
      assert.equal(res.status, 202, `POST compile-from-seed: ${await res.clone().text()}`);
      return (await res.json() as { jobId: string }).jobId;
    };
    const first = await jobOf({ seedText, anthropicKey: VISITOR_ANTHROPIC_KEY });
    await waitFor(() => compiles.length === 1, 'the first compile to start');
    const onAnotherKey = await jobOf({ seedText, apiKey: VISITOR_OPENAI_KEY });
    const retry = await jobOf({ seedText, anthropicKey: VISITOR_ANTHROPIC_KEY });

    assert.notEqual(onAnotherKey, first, 'a request on another key does not wait on a compile that runs on a key it did not send');
    assert.equal(retry, first, 'a retry on the same key joins the compile it started');
    await waitFor(() => compiles.length === 2, 'the compile on the other key to start');
    assert.equal(compiles.length, 2, 'two compiles: one for each key');
    assert.equal(compiles[1].provider, 'openai', "the second compile is on its own key's provider");
    assert.equal(compiles[1].apiKey, VISITOR_OPENAI_KEY, 'the second compile carries its own key');
    assert.equal(compiles[1].anthropicKey, undefined, "the second compile carries no other request's key");
    for (const done of finish) done();
  }, {
    extra: {
      compileFromSeed: (_input: unknown, options: Record<string, unknown>) => {
        compiles.push(options);
        const id = `seed-two-keys-${compiles.length}`;
        return new Promise<ScenarioPackage>(resolve => finish.push(() => resolve({ ...marsScenario, id })));
      },
    },
  });
});

test("Quickstart actor generation with the visitor's Anthropic key runs on that key", async () => {
  const restore = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
  try {
    await withProviderWire(async calls => {
      await hosted(async api => {
        await api.cookied().post('/api/quickstart/generate-actors', { scenarioId: mars.id, count: 2, anthropicKey: VISITOR_ANTHROPIC_KEY });
        const made = modelCalls(calls);
        assert.ok(made.length > 0, 'the actor call was made');
        for (const call of made) {
          assert.equal(call.provider, 'anthropic', `${call.path}: the actor call is on the visitor's provider\n${describeCalls(calls)}`);
          assert.equal(call.key, VISITOR_ANTHROPIC_KEY, `${call.path}: the actor call carries the visitor's key`);
        }
      });
    });
  } finally {
    restore();
  }
});

test('host-paid Quickstart actor generation stays on OpenAI with the host key when OpenAI fails', async () => {
  const restore = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
  try {
    await withProviderWire(async calls => {
      await hosted(async api => {
        await api.cookied().post('/api/quickstart/generate-actors', { scenarioId: mars.id, count: 2 });
        assertOnHostOpenAi(calls, 'the actor call');
      });
    });
  } finally {
    restore();
  }
});

/** One leader the actor call's schema takes. */
function leader(i: number) {
  return {
    name: `Leader ${i + 1}`,
    archetype: 'The Planner',
    unit: 'Town water board',
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
    instructions: 'Weigh the water supply before every decision.',
  };
}

/** Answers the actor call with as many leaders as its prompt asks for. */
const leadersAskedFor: WireReply = call => {
  const asked = /Generate exactly (\d+) archetypal actors/.exec(call.text);
  return asked ? JSON.stringify({ actors: Array.from({ length: Number(asked[1]) }, (_, i) => leader(i)) }) : undefined;
};

/**
 * Posts a Quickstart actor call for 24 leaders to a hosted demo, its model
 * answering, with the limiter at `maxSimsPerDay` runs a day (0 turns it
 * off); returns the leaders and the calls.
 */
async function generateLeaders(keys: Record<string, string>, maxSimsPerDay = 1): Promise<{ status: number; leaders: unknown[]; calls: WireCall[] }> {
  const restore = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY });
  try {
    return await withProviderWire(async calls => {
      let status = 0;
      let leaders: unknown[] = [];
      await hosted(async api => {
        const res = await api.cookied().post('/api/quickstart/generate-actors', { scenarioId: mars.id, count: 24, ...keys });
        status = res.status;
        const answer = await res.json() as { actors?: unknown[]; error?: string };
        assert.equal(res.status, 200, `the actor call: ${JSON.stringify(answer).slice(0, 300)}\n${describeCalls(calls)}`);
        leaders = answer.actors ?? [];
      }, { maxSimsPerDay });
      return { status, leaders, calls: modelCalls(calls) };
    }, leadersAskedFor);
  } finally {
    restore();
  }
}

test("Quickstart actor generation with the visitor's own key on the hosted demo writes every leader it asks for on that key", async () => {
  const { leaders, calls } = await generateLeaders({ apiKey: VISITOR_OPENAI_KEY });
  assert.equal(leaders.length, 24, 'the 24 leaders asked for: the two-leader cap holds a host-paid request only');
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.provider, 'openai', "the call is on the visitor's provider");
    assert.equal(call.key, VISITOR_OPENAI_KEY, "the call carries the visitor's key, not the host's");
  }
  assert.match(calls[0].text, /Generate exactly 24 archetypal actors/);
});

test("host-paid Quickstart actor generation on the hosted demo writes two leaders on the host's OpenAI key", async () => {
  const { leaders, calls } = await generateLeaders({});
  assert.equal(leaders.length, 2, 'a host-paid request is held to the two-leader cap');
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.provider, 'openai');
    assert.equal(call.key, HOST_OPENAI_KEY, "the call bills the host's OpenAI key");
  }
  assert.match(calls[0].text, /Generate exactly 2 archetypal actors/);
});

test("host-paid Quickstart actor generation on the hosted demo with the limiter off writes two leaders on the host's OpenAI key", async () => {
  const { leaders, calls } = await generateLeaders({}, 0);
  assert.equal(leaders.length, 2, 'a host-paid request is held to the two-leader cap whether or not the limiter is on');
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.provider, 'openai');
    assert.equal(call.key, HOST_OPENAI_KEY, "the call bills the host's OpenAI key");
  }
  assert.match(calls[0].text, /Generate exactly 2 archetypal actors/);
});
