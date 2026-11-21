/**
 * Who pays for each model call on the hosted demo, and where it goes.
 *
 * On the hosted demo a request that brings no provider key of its own runs
 * on the host's keys. Every model call such a request makes runs on OpenAI,
 * with the demo's OpenAI models, and never falls back to another provider:
 * the run's commander, departments, director, reactions, tool review and
 * verdict, a /simulate run, a Quickstart draft, its hook compile and its
 * actors, a Digital Twin run, the compile of the Digital Twin's world, a
 * /compile and a chat. A host that holds no OpenAI key refuses such a
 * request before the day's limit counts it. A request with the visitor's
 * own key runs on that key's provider and that key, the compile of the
 * Digital Twin's world included, and so does a chat with no key of its own
 * on a run the visitor's key paid for.
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
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { OVERLOADED, describeCalls, modelCalls, setHostKeys, withProviderWire, type WireCall, type WireReply } from './helpers/provider-wire.js';

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

test('one address with its own key cannot hold every run slot with Digital Twin runs', async () => {
  // A Digital Twin world whose runs stay in flight until released.
  const started: Array<Record<string, unknown>> = [];
  const releases: Array<() => void> = [];
  const world = {
    scenario: marsScenario,
    intervene: async (opts: Record<string, unknown>) => {
      started.push(opts);
      await new Promise<void>(resolve => { releases.push(resolve); });
      return { metadata: { runId: `twin-${started.length}` }, finalState: { metrics: {} } } as unknown as RunArtifact;
    },
  } as unknown as WorldModel;
  await hosted(async api => {
    const answers: Array<Promise<{ status: number; text: string }>> = [];
    const twinRun = (address: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> => {
      const answer = api.cookied({ 'cf-connecting-ip': address }).post('/api/quickstart/simulate-intervention', body)
        .then(async res => ({ status: res.status, text: await res.text() }));
      answers.push(answer);
      return answer;
    };
    try {
      const ownKey = { ...TWIN_BODY, apiKey: VISITOR_OPENAI_KEY };
      void twinRun('198.51.100.7', ownKey);
      void twinRun('198.51.100.7', ownKey);
      await waitFor(() => started.length === 2, "the address's first two Twin runs to start", 10_000);

      // Two of the three slots are the address's; its third run waits.
      const third: Array<{ status: number; text: string }> = [];
      void twinRun('198.51.100.7', ownKey).then(answer => { third.push(answer); });
      await waitFor(() => third.length > 0 || started.length === 3, "the address's third Twin run to be refused or to start", 10_000);
      assert.equal(started.length, 2, "the address's third run on its own key did not start");
      assert.equal(third[0]?.status, 503, `the third run is refused for capacity: ${third[0]?.text}`);

      // The slot it left is another address's.
      void twinRun('198.51.100.8', TWIN_BODY);
      await waitFor(() => started.length === 3, "another address's Twin run to start", 10_000);
    } finally {
      // Runs still held are let go, here and as they start, before the server closes.
      const letGo = setInterval(() => { for (const release of releases.splice(0)) release(); }, 10);
      await Promise.allSettled(answers);
      clearInterval(letGo);
    }
  }, {
    env: { ...HOST_ENV, PARACOSM_CLIENT_IP_HEADER: 'cf-connecting-ip' },
    maxRuns: 3,
    maxSimsPerDay: 10,
    extra: { getDigitalTwinWorld: async () => world },
  });
});

// ---------------------------------------------------------------------------
// The Digital Twin's world
// ---------------------------------------------------------------------------

/** The scenario the Digital Twin's world is compiled from, as the repository ships it. */
const TWIN_SCENARIO = JSON.parse(readFileSync(new URL('../../scenarios/t2d-glp1-protocol.json', import.meta.url), 'utf-8')) as { labels: { name: string } };

/** Text every model call of a scenario compile carries, and no call of a run. */
const COMPILE_MARK = /You are generating [^\n]* simulation engine\./;

/** The model calls of a scenario compile. */
function compileCalls(calls: readonly WireCall[]): WireCall[] {
  return modelCalls(calls).filter(c => COMPILE_MARK.test(c.text));
}

/**
 * Resolves once the stub has received no request for a quarter of a second,
 * or after five seconds: a compile or a run that failed may still have calls
 * on their way, and they are to reach the stub, not the network.
 */
async function callsToEnd(calls: readonly WireCall[]): Promise<void> {
  const deadline = Date.now() + 5000;
  let seen = -1;
  while (seen !== calls.length && Date.now() < deadline) {
    seen = calls.length;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

interface TwinServerSetup {
  /** The server's environment. */
  env: Record<string, string>;
  /** The provider keys of the host, which a call with no key of its own runs on. */
  hostKeys: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string };
  /**
   * How the stub answers the calls of a compile. Absent: with text no hook
   * is read from, so a compile ends with its built-in hooks, in a world, and
   * writes nothing to its disk cache. `'fails'`: with the stub's error, which
   * fails the compile. `'fails at the start'`: with the error until the
   * server's start is over, so the server holds no world when `body` runs,
   * and with the text from then on.
   */
  compiles?: 'fails' | 'fails at the start';
  /** The most runs the server holds in flight at once. Absent: the server's own. */
  maxRuns?: number;
}

/** A hosted demo server that compiles the Digital Twin's world itself, once its start is over. */
interface TwinServer {
  api: RunServer;
  /** The provider requests the server made at its start. */
  startCalls: readonly WireCall[];
  /** The provider requests made since the server's start was over. */
  calls: () => WireCall[];
  /** Every line the server has logged about the Digital Twin's world. */
  twinLines: () => string[];
}

/**
 * Runs `body` against a hosted demo server that compiles the Digital Twin's
 * world itself, with the providers stubbed at the wire, once the server's
 * start is over: it has compiled the world, failed to, or left it, and
 * logged which. The scenario it compiles carries a name of its own, so no
 * compile of another test is read from the compile's disk cache. A call
 * that is not a compile's gets the stub's error.
 */
async function twinServer(body: (twin: TwinServer) => Promise<void>, setup: TwinServerSetup): Promise<void> {
  const scenarioDir = mkdtempSync(join(tmpdir(), 'paracosm-twin-world-'));
  writeFileSync(
    join(scenarioDir, 't2d-glp1-protocol.json'),
    JSON.stringify({ ...TWIN_SCENARIO, labels: { ...TWIN_SCENARIO.labels, name: `${TWIN_SCENARIO.labels.name} ${randomUUID()}` } }),
  );
  let answered = setup.compiles === undefined;
  const reply: WireReply = call => (answered && COMPILE_MARK.test(call.text) ? 'no hook' : undefined);
  const lines: string[] = [];
  const twinLines = (): string[] => lines.filter(line => line.includes('[digital-twin]'));
  const { log, error } = console;
  console.log = (...args: unknown[]): void => {
    lines.push(args.map(String).join(' '));
    log(...args);
  };
  console.error = (...args: unknown[]): void => {
    lines.push(args.map(String).join(' '));
    error(...args);
  };
  const restore = setHostKeys(setup.hostKeys);
  try {
    await withProviderWire(async wire => {
      await hosted(async api => {
        try {
          await waitFor(() => twinLines().length > 0, "the server's start to compile the Digital Twin world, fail to, or leave it", 30_000);
          await callsToEnd(wire);
          const start = wire.length;
          if (setup.compiles === 'fails at the start') answered = true;
          await body({ api, startCalls: wire.slice(0, start), calls: () => wire.slice(start), twinLines });
        } finally {
          await callsToEnd(wire);
        }
      }, { env: setup.env, scenarioDir, ...(setup.maxRuns !== undefined ? { maxRuns: setup.maxRuns } : {}), extra: { getDigitalTwinWorld: undefined } });
    }, reply, reply);
  } finally {
    restore();
    console.log = log;
    console.error = error;
    rmSync(scenarioDir, { recursive: true, force: true });
  }
}

/** Asserts a Twin request got past the world's preparation and its run began: it ended, or the stubbed model failed it. */
async function assertTwinRunBegan(res: Response, what: string): Promise<void> {
  assertRunBegan({ status: res.status, text: await res.text() }, what);
}

/** The same, for an answer whose text is already read. */
function assertRunBegan(answer: { status: number; text: string }, what: string): void {
  assert.ok(
    answer.status === 200 || (answer.status === 500 && answer.text.includes('Intervention run failed')),
    `${what} began: ${answer.status} ${answer.text.slice(0, 300)}`,
  );
}

/** The host a provider request goes to, and the key it carries. */
function providerRequest(input: string | URL | Request, init?: RequestInit): { hostname: string; pathname: string; key: string | undefined } {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const { hostname, pathname } = new URL(url);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const bearer = headers.get('authorization');
  return { hostname, pathname, key: headers.get('x-api-key') ?? (bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : undefined) };
}

function toAnthropic(hostname: string): boolean {
  return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com');
}

function toOpenAi(hostname: string): boolean {
  return hostname === 'api.openai.com' || hostname.endsWith('.openai.com');
}

/** The calls on a key of the host. */
function onHostKeys(calls: readonly WireCall[]): string[] {
  return modelCalls(calls).filter(c => c.key === HOST_OPENAI_KEY || c.key === HOST_ANTHROPIC_KEY).map(c => `${c.provider} ${c.path} ${c.model ?? '-'}`);
}

const BOTH_HOST_KEYS = { OPENAI_API_KEY: HOST_OPENAI_KEY, ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY };

for (const visitor of [
  { name: 'OpenAI', provider: 'openai', key: VISITOR_OPENAI_KEY, body: { apiKey: VISITOR_OPENAI_KEY } },
  { name: 'Anthropic', provider: 'anthropic', key: VISITOR_ANTHROPIC_KEY, body: { anthropicKey: VISITOR_ANTHROPIC_KEY } },
] as const) {
  test(`a Digital Twin run with the visitor's ${visitor.name} key on a hosted demo with no host OpenAI key compiles the world and runs on that key`, async () => {
    await twinServer(async twin => {
      assert.deepEqual(modelCalls(twin.startCalls), [], 'the server made no model call at its start');
      const res = await twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, ...visitor.body });
      await assertTwinRunBegan(res, 'the Twin run');

      const calls = twin.calls();
      const compiled = compileCalls(calls);
      const made = modelCalls(calls);
      assert.ok(compiled.length > 0, `the world was compiled for the request. The stub received:\n${describeCalls(calls)}`);
      assert.ok(made.length > compiled.length, `the run made model calls after the compile. The stub received:\n${describeCalls(calls)}`);
      for (const call of made) {
        assert.equal(call.provider, visitor.provider, `${call.path} goes to the visitor's provider. The stub received:\n${describeCalls(calls)}`);
        assert.equal(call.key, visitor.key, `${call.path} carries the visitor's key`);
      }
    }, { env: NO_KEYS_ENV, hostKeys: {} });
  });
}

test("a Digital Twin run with the visitor's key, on a host whose compile at the start failed, makes no model call on the host's keys", async () => {
  await twinServer(async twin => {
    assert.ok(compileCalls(twin.startCalls).length > 0, 'the server tried a compile at its start');
    const res = await twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, anthropicKey: VISITOR_ANTHROPIC_KEY });
    await assertTwinRunBegan(res, 'the Twin run');

    const calls = twin.calls();
    assert.ok(compileCalls(calls).length > 0, `the world was compiled for the request. The stub received:\n${describeCalls(calls)}`);
    assert.deepEqual(onHostKeys(calls), [], `the request made no model call on a key of the host. The stub received:\n${describeCalls(calls)}`);
    for (const call of modelCalls(calls)) {
      assert.equal(call.provider, 'anthropic', `${call.path} goes to the visitor's provider`);
      assert.equal(call.key, VISITOR_ANTHROPIC_KEY, `${call.path} carries the visitor's key`);
    }
  }, { env: HOST_ENV, hostKeys: BOTH_HOST_KEYS, compiles: 'fails at the start' });
});

test("a host-paid Digital Twin request that finds no world compiles it on the host's OpenAI key with the Quickstart model, and stays on OpenAI when OpenAI fails", async () => {
  await twinServer(async twin => {
    const res = await twin.api.cookied().post('/api/quickstart/simulate-intervention', TWIN_BODY);
    assert.equal(res.status, 503, `the compile failed, so there is no world to run: ${(await res.text()).slice(0, 300)}`);

    // Each hook of the failed compile makes its call, some after the answer.
    await waitFor(() => compileCalls(twin.calls()).length > 0, "the request's compile to reach the stub", 10_000);
    for (const [when, calls] of [['at the start', twin.startCalls], ['for the request', twin.calls()]] as const) {
      const compiled = compileCalls(calls);
      assert.ok(compiled.length > 0, `a compile ${when} reached OpenAI. The stub received:\n${describeCalls(calls)}`);
      assert.deepEqual(modelCalls(calls).map(c => c.path), compiled.map(c => c.path), `the compile made the only model calls ${when}`);
      assertOnHostOpenAi(calls, `the compile ${when}`);
      for (const call of compiled) {
        assert.equal(call.model, 'gpt-5.4-mini', "the model of the hosted demo's Quickstart calls");
      }
    }
  }, { env: HOST_ENV, hostKeys: BOTH_HOST_KEYS, compiles: 'fails' });
});

test('a Digital Twin request on a host that holds a compiled world makes no compile call, whoever pays for it', async () => {
  await twinServer(async twin => {
    const compiled = compileCalls(twin.startCalls);
    assert.ok(compiled.length > 0, `the server compiled the world at its start. The stub received:\n${describeCalls(twin.startCalls)}`);
    for (const call of compiled) {
      assert.equal(call.provider, 'openai', `${call.path} of the compile goes to OpenAI`);
      assert.equal(call.key, HOST_OPENAI_KEY, `${call.path} of the compile runs on the host's OpenAI key`);
    }

    const first = await twin.api.cookied().post('/api/quickstart/simulate-intervention', TWIN_BODY);
    await assertTwinRunBegan(first, 'the host-paid Twin run');
    const second = await twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, anthropicKey: VISITOR_ANTHROPIC_KEY });
    await assertTwinRunBegan(second, "the Twin run on the visitor's key");
    assert.ok(modelCalls(twin.calls()).length > 0, 'the runs made model calls');
    assert.deepEqual(compileCalls(twin.calls()).map(c => `${c.provider} ${c.path}`), [], 'the requests compiled nothing');
  }, { env: HOST_ENV, hostKeys: BOTH_HOST_KEYS });
});

test('a hosted demo with no host OpenAI key starts without compiling the Digital Twin world, and says why in one line', async () => {
  await twinServer(async twin => {
    const lines = twin.twinLines();
    assert.deepEqual(lines.filter(line => line.includes('Compile failed')), [], 'no compile was tried');
    assert.equal(lines.length, 1, `one line about the Digital Twin: ${lines.join(' | ')}`);
    assert.match(lines[0], /no host OpenAI key/i, 'the line says why the world is not compiled');
    assert.deepEqual(modelCalls(twin.startCalls), [], 'no model call was made at the start');
  }, { env: ANTHROPIC_ONLY_ENV, hostKeys: { ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY } });
});

test('two Digital Twin requests on different keys, the second sent while the compile for the first runs, each compile the world on their own key', async () => {
  await twinServer(async twin => {
    // Every completion request to OpenAI waits at this gate, so the first
    // request's compile is still running when the second request arrives.
    const wire = globalThis.fetch;
    let open: () => void = () => {};
    const gate = new Promise<void>(resolve => { open = resolve; });
    let held = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { hostname, pathname } = new URL(url);
      if ((hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) && !pathname.endsWith('/models')) {
        held += 1;
        await gate;
      }
      return wire(input, init);
    }) as typeof fetch;
    const requests: Array<Promise<Response>> = [];
    try {
      requests.push(twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, apiKey: VISITOR_OPENAI_KEY }));
      await waitFor(() => held > 0, 'the first compile to reach OpenAI', 10_000);
      requests.push(twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, anthropicKey: VISITOR_ANTHROPIC_KEY }));
      await waitFor(
        () => compileCalls(twin.calls()).some(c => c.provider === 'anthropic'),
        "a compile on the visitor's Anthropic key to reach Anthropic while the first compile runs",
        10_000,
      );
    } finally {
      open();
      await Promise.allSettled(requests.map(async request => (await request).text()));
      globalThis.fetch = wire;
    }

    const calls = twin.calls();
    const compiled = compileCalls(calls);
    assert.ok(compiled.some(c => c.provider === 'openai'), `a compile ran on OpenAI. The stub received:\n${describeCalls(calls)}`);
    assert.ok(compiled.some(c => c.provider === 'anthropic'), `a compile ran on Anthropic. The stub received:\n${describeCalls(calls)}`);
    for (const call of compiled) {
      assert.equal(call.key, call.provider === 'openai' ? VISITOR_OPENAI_KEY : VISITOR_ANTHROPIC_KEY, `${call.provider} ${call.path} of a compile carries the key of the request it is for`);
    }
    assert.deepEqual(onHostKeys(calls), [], `the requests made no model call on a key of the host. The stub received:\n${describeCalls(calls)}`);
  }, { env: HOST_ENV, hostKeys: BOTH_HOST_KEYS, compiles: 'fails at the start' });
});

test("a Digital Twin request whose own compile fails after another request's compile left a world runs in that world", async () => {
  await twinServer(async twin => {
    // Every request to Anthropic waits at this gate and is then answered with
    // the stub's error, so the compile for the first request is still running
    // when the second request's compile ends in a world, and fails after it.
    const wire = globalThis.fetch;
    let open: () => void = () => {};
    const gate = new Promise<void>(resolve => { open = resolve; });
    let held = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (toAnthropic(providerRequest(input, init).hostname)) {
        held += 1;
        await gate;
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: OVERLOADED } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return wire(input, init);
    }) as typeof fetch;
    const compilesFailed = (): number => twin.twinLines().filter(line => line.includes('Compile failed')).length;
    const failedBefore = compilesFailed();
    const first = twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, anthropicKey: VISITOR_ANTHROPIC_KEY })
      .then(async res => ({ status: res.status, text: await res.text() }));
    try {
      await waitFor(() => held > 0, "the first request's compile to reach Anthropic", 10_000);
      const second = await twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, apiKey: VISITOR_OPENAI_KEY });
      await assertTwinRunBegan(second, "the second request's Twin run, in the world its own compile left");
      assert.equal(compilesFailed(), failedBefore, "the first request's compile is still running");
    } finally {
      open();
      await first.catch(() => undefined);
      globalThis.fetch = wire;
    }

    assert.equal(compilesFailed(), failedBefore + 1, "the first request's compile failed");
    assertRunBegan(await first, "the first request's Twin run, in the world the other request's compile left");
    const calls = twin.calls();
    assert.ok(
      compileCalls(calls).some(c => c.provider === 'openai' && c.key === VISITOR_OPENAI_KEY),
      `the world was compiled on the second request's key. The stub received:\n${describeCalls(calls)}`,
    );
    assert.deepEqual(onHostKeys(calls), [], `the requests made no model call on a key of the host. The stub received:\n${describeCalls(calls)}`);
  }, { env: HOST_ENV, hostKeys: BOTH_HOST_KEYS, compiles: 'fails at the start' });
});

test('at most four compiles of the Digital Twin world run at once, and a request past them runs in the world they leave', async () => {
  const keys = [1, 2, 3, 4, 5, 6].map(n => `${VISITOR_OPENAI_KEY}-${n}`);
  await twinServer(async twin => {
    // Every completion request to OpenAI waits at this gate, so each compile
    // that starts is still running when the next request arrives.
    const wire = globalThis.fetch;
    let open: () => void = () => {};
    const gate = new Promise<void>(resolve => { open = resolve; });
    const compiling = new Set<string>();
    let held = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = providerRequest(input, init);
      if (toOpenAi(request.hostname) && !request.pathname.endsWith('/models')) {
        if (request.key) compiling.add(request.key);
        held += 1;
        await gate;
      }
      return wire(input, init);
    }) as typeof fetch;
    const answers = [] as Array<Promise<{ status: number; text: string }>>;
    const twinRun = (key: string): void => {
      answers.push(twin.api.cookied().post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, apiKey: key })
        .then(async res => ({ status: res.status, text: await res.text() })));
    };
    try {
      for (const key of keys.slice(0, 4)) twinRun(key);
      await waitFor(() => compiling.size === 4, 'four compiles to reach OpenAI, each on its own key', 10_000);
      for (const key of keys.slice(4)) twinRun(key);
      // A fifth and a sixth compile, if they start, reach the gate within this wait.
      let seen = -1;
      while (seen !== held) {
        seen = held;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.deepEqual([...compiling].sort(), keys.slice(0, 4), 'four compiles run at once: the fifth and the sixth request started none');
    } finally {
      open();
      await Promise.allSettled(answers);
      globalThis.fetch = wire;
    }

    for (const [i, answer] of (await Promise.all(answers)).entries()) {
      assertRunBegan(answer, `the Twin run of request ${i + 1}`);
    }
    const compiled = new Set(compileCalls(twin.calls()).map(c => c.key));
    assert.deepEqual([...compiled].sort(), keys.slice(0, 4), 'the world was compiled on the first four keys alone');
  }, { env: HOST_ENV, hostKeys: BOTH_HOST_KEYS, compiles: 'fails at the start', maxRuns: 8 });
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

test("a chat with no key of its own on a Digital Twin run made with the visitor's Anthropic key runs on that run's key", async () => {
  const agents: ChatAgentOptions[] = [];
  // A Digital Twin world whose run plays the saved pair's events, so the run holds people to chat with.
  const world = {
    scenario: marsScenario,
    intervene: async (opts: { onEvent?: (event: SimEvent) => void }) => {
      for (const e of pair.events) opts.onEvent?.(e);
      return { metadata: { runId: 'twin-with-people' }, finalState: { metrics: {} } } as unknown as RunArtifact;
    },
  } as unknown as WorldModel;
  await hosted(async api => {
    const page = api.cookied();
    const run = await page.post('/api/quickstart/simulate-intervention', { ...TWIN_BODY, anthropicKey: VISITOR_ANTHROPIC_KEY });
    assert.equal(run.status, 200, `the Twin run: ${await run.text()}`);
    const res = await page.post('/chat', { agentId: PERSON, leader: 'Aria Chen', message: 'What happened?' });
    assert.equal(res.status, 200, `POST /chat: ${await res.clone().text()}`);
  }, {
    extra: {
      getDigitalTwinWorld: async () => world,
      chatAgent: async (_profile: ColonistProfile, _memories: ColonistMemoryEntry[], opts: ChatAgentOptions) => {
        agents.push(opts);
        return { session: { send: async () => ({ text: 'Stub reply.', usage: {} }) }, isNew: true };
      },
    },
  });
  assert.equal(agents.length, 1, 'one chat agent');
  const [opts] = agents;
  assert.equal(opts.provider, 'anthropic', "the chat is on the run's provider");
  assert.equal(opts.anthropicKey, VISITOR_ANTHROPIC_KEY, "the chat carries the run's own key, not the host's");
  assert.equal(opts.apiKey, undefined);
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
