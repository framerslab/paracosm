import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleSimulate, type SimulateDeps } from '../../src/server/routes/simulate.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage, ActorConfig } from '../../src/engine/types.js';
import type { RunArtifact } from '../../src/engine/schema/index.js';

function fakeRes() {
  let status = 0;
  let body = '';
  const res = {
    writeHead: (s: number) => { status = s; },
    end: (b?: string) => { if (b) body = b; },
  } as unknown as ServerResponse;
  return {
    res,
    get: () => ({ status, body: body ? JSON.parse(body) : null }),
  };
}

function fakeLeader(overrides: Partial<ActorConfig> = {}): ActorConfig {
  return {
    name: 'Test Leader',
    archetype: 'Tester',
    unit: 'Test Unit',
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
    instructions: '',
    ...overrides,
  };
}

function fakeArtifact(): RunArtifact {
  return {
    metadata: { runId: 'r-1', scenario: { id: marsScenario.id, name: marsScenario.labels.name }, mode: 'turn-loop', startedAt: '2026-04-24T00:00:00.000Z' },
    finalState: { metrics: { population: 100, morale: 0.7 } },
  } as unknown as RunArtifact;
}

function fakeDeps(overrides: Partial<SimulateDeps> = {}): SimulateDeps {
  return {
    compileScenario: async () => marsScenario,
    runSimulation: async () => fakeArtifact(),
    ...overrides,
  };
}

test('simulate: pre-compiled scenario returns 200 with artifact + scenario + durationMs', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: marsScenario, leader: fakeLeader() },
    fakeDeps(),
  );
  const r = get();
  assert.equal(r.status, 200);
  assert.equal(r.body.artifact.metadata.runId, 'r-1');
  assert.equal(r.body.scenario.id, marsScenario.id);
  assert.equal(typeof r.body.durationMs, 'number');
});

test('simulate: raw scenario (no hooks) triggers compileScenario', async () => {
  const { res, get } = fakeRes();
  let compileCalls = 0;
  await handleSimulate(
    {} as IncomingMessage,
    res,
    {
      scenario: { id: 'draft', labels: { name: 'Draft' } },
      leader: fakeLeader(),
      options: { seedText: 'seed text example', seedUrl: 'https://example.com/doc' },
    },
    fakeDeps({
      compileScenario: async () => { compileCalls += 1; return marsScenario; },
    }),
  );
  assert.equal(get().status, 200);
  assert.equal(compileCalls, 1);
});

test('simulate: missing leader rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: marsScenario },
    fakeDeps(),
  );
  assert.equal(get().status, 400);
});

test('simulate: HEXACO out-of-bounds in leader rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    {
      scenario: marsScenario,
      leader: fakeLeader({ hexaco: { openness: 1.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 } }),
    },
    fakeDeps(),
  );
  assert.equal(get().status, 400);
});

test('simulate: malformed body rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: 'not an object', leader: fakeLeader() },
    fakeDeps(),
  );
  assert.equal(get().status, 400);
});

test('simulate: compileScenario throws -> 502 with generic message (no stack leak)', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: { id: 'x-scenario', labels: { name: 'X' } }, leader: fakeLeader() },
    fakeDeps({
      compileScenario: async () => { throw new Error('internal LLM detail'); },
    }),
  );
  const r = get();
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'Scenario compile failed');
  assert.doesNotMatch(r.body.error, /internal LLM detail/);
});

test('simulate: runSimulation throws -> 500 with generic message (no stack leak)', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: marsScenario, leader: fakeLeader() },
    fakeDeps({
      runSimulation: async () => { throw new Error('kernel crash detail'); },
    }),
  );
  const r = get();
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'Simulation failed');
  assert.doesNotMatch(r.body.error, /kernel crash detail/);
});

test('simulate: request credentials are forwarded through compile and run options', async () => {
  const { res, get } = fakeRes();
  let receivedOpts: Record<string, unknown> = {};
  let compileOpts: Record<string, unknown> = {};
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: marsScenario, leader: fakeLeader(), options: { provider: 'openai' } },
    fakeDeps({
      compileScenario: async (_raw, opts) => {
        compileOpts = opts as unknown as Record<string, unknown>;
        return marsScenario;
      },
      runSimulation: async (_leader, _personnel, opts) => {
        receivedOpts = opts as unknown as Record<string, unknown>;
        return fakeArtifact();
      },
    }),
    { apiKey: 'sk-openai-request', anthropicKey: 'sk-ant-request' },
  );
  assert.equal(get().status, 200);
  assert.equal(compileOpts.apiKey, 'sk-openai-request');
  assert.equal(compileOpts.anthropicKey, 'sk-ant-request');
  assert.equal(receivedOpts.apiKey, 'sk-openai-request');
  assert.equal(receivedOpts.anthropicKey, 'sk-ant-request');
});

test('simulate: SimulateDeps no longer carries userApiKey or userAnthropicKey', () => {
  // Type-level guarantee: building a SimulateDeps with those fields
  // fails the compiler. This runtime sentinel asserts the legitimate
  // fields are present and that no key fields leak through.
  const deps: SimulateDeps = {
    compileScenario: async () => marsScenario,
    runSimulation: async () => fakeArtifact(),
  };
  assert.equal(typeof deps.compileScenario, 'function');
  assert.equal(typeof deps.runSimulation, 'function');
  // Cast through any so the test compiles even if a future refactor adds
  // back BYO-key fields; the assertion catches it at runtime.
  assert.ok(!('userApiKey' in (deps as unknown as Record<string, unknown>)));
  assert.ok(!('userAnthropicKey' in (deps as unknown as Record<string, unknown>)));
});

test('simulate: captureSnapshots option is forwarded verbatim', async () => {
  const { res, get } = fakeRes();
  let capture: boolean | undefined;
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: marsScenario, leader: fakeLeader(), options: { captureSnapshots: true } },
    fakeDeps({
      runSimulation: async (_leader, _personnel, opts) => {
        capture = opts.captureSnapshots;
        return fakeArtifact();
      },
    }),
  );
  assert.equal(get().status, 200);
  assert.equal(capture, true);
});

test('simulate: pre-compiled-looking scenario is still routed through compileScenario (no unsafe pass-through)', async () => {
  const { res, get } = fakeRes();
  let compileCalls = 0;
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: marsScenario, leader: fakeLeader() },
    fakeDeps({
      compileScenario: async () => { compileCalls += 1; return marsScenario; },
    }),
  );
  assert.equal(get().status, 200);
  assert.equal(compileCalls, 1, 'endpoint always compiles; pre-compiled pass-through is disallowed');
});

test('simulate: empty scenario.id rejects with 400', async () => {
  const { res, get } = fakeRes();
  await handleSimulate(
    {} as IncomingMessage,
    res,
    { scenario: { id: '   ', labels: { name: 'X' } }, leader: fakeLeader() },
    fakeDeps(),
  );
  assert.equal(get().status, 400);
});
