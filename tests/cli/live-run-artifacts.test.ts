import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveRunRegistry } from '../../src/server/live-runs.js';
import { WorldModel, type RunArtifact } from '../../src/index.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { SimEvent } from '../../src/runtime/orchestrator/index.js';
import { withStubOpenAi } from '../runtime/helpers/stub-openai-transport.js';
import { decisionTitleOf, reactionReply, recordedAriaReply } from '../runtime/helpers/stub-model-mars-run.js';


test('a held run restored after a restart replays result artifacts without outputPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-held-artifacts-'));
  const result = `event: result\ndata: ${JSON.stringify({
    leader: 'a', artifact: { scenarioExtensions: { outputPath: '/tmp/held-output.json', label: 'kept' } },
  })}\n\n`;
  const complete = 'event: complete\ndata: {}\n\n';
  writeFileSync(join(dir, 'held.json'), JSON.stringify({
    version: 1, key: 'held', visitorId: 'anonymous', kind: 'pair',
    events: [result, complete], timestamps: [Date.now(), Date.now()], actorIds: [null, null],
  }));
  const registry = new LiveRunRegistry({
    dir, maxRuns: 2, maxHeldRuns: 10, maxHeldRunBytes: 100000,
    staleMs: 60000, disconnectGraceMs: 60000, bufferMaxEntries: 100,
  });
  try {
    const run = registry.get('held');
    assert.ok(run);
    const frames: string[] = [];
    registry.replay({ write: (frame: string) => { frames.push(frame); return true; } } as ServerResponse, run, null);
    const data = JSON.parse(frames[0].split('\n')[1].slice(6));
    assert.equal(frames[0].split('\n')[0], 'event: result');
    assert.deepEqual(data.provenance, { aiGenerated: true, generator: 'paracosm', models: {} });
    assert.deepEqual(data.artifact.scenarioExtensions, { label: 'kept' });
    assert.equal(frames[1], complete);
  } finally {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const roleOverrides = {
  commander: 'gpt-4o-mini',
  departments: 'gpt-4o',
  judge: 'gpt-4o-mini',
  agentReactions: 'gpt-4o',
};
const expectedMark = {
  aiGenerated: true,
  generator: 'paracosm',
  models: { ...roleOverrides, director: 'gpt-4o-mini' },
};
const marsLeaders = marsScenario.presets[0].leaders.map(leader => ({ ...leader, unit: 'Colony Alpha' }));

function replyToMars(lastUser: string): string {
  const reaction = reactionReply(lastUser);
  if (reaction) return reaction.reply;
  const title = decisionTitleOf(lastUser);
  return JSON.stringify((title && recordedAriaReply(title)) || {});
}

test('public simulation writes effective role assignments to the artifact and the first callback event', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'paracosm-role-artifacts-'));
  try {
    await withStubOpenAi(({ lastUser }) => replyToMars(lastUser), async requests => {
      const wm = WorldModel.fromScenario(marsScenario);
      for (const writeOutputFile of [false, true]) {
        const events: SimEvent[] = [];
        const artifact = await wm.simulate({
          actor: marsLeaders[0],
          maxTurns: 2,
          seed: 950,
          initialPopulation: 30,
          provider: 'openai',
          apiKey: 'placeholder-key-for-a-test',
          models: roleOverrides,
          outputDir,
          writeOutputFile,
          onEvent: event => events.push(event),
        });
        assert.deepEqual(artifact.provenance, expectedMark);
        assert.deepEqual(events[0]?.provenance, expectedMark);
        assert.ok(events.slice(1).every(event => event.provenance === undefined));
        const files = readdirSync(outputDir);
        assert.equal(files.length, writeOutputFile ? 1 : 0);
        if (writeOutputFile) {
          const stored = JSON.parse(readFileSync(join(outputDir, files[0]), 'utf8')) as RunArtifact;
          assert.deepEqual(stored.provenance, expectedMark);
        }
      }
      assert.ok(requests.some(request => request.model === roleOverrides.commander && decisionTitleOf(request.lastUser)));
    });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('an already-aborted public run records the effective fallback provider assignments', async t => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.match(String(input instanceof Request ? input.url : input), /\/embeddings$/);
    return new Response('{}');
  });
  const openai = process.env.OPENAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = 'placeholder-key-for-a-test';
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const controller = new AbortController();
    controller.abort('user_aborted');
    const events: SimEvent[] = [];
    const artifact = await WorldModel.fromScenario(marsScenario).simulate({
      actor: marsLeaders[0],
      provider: 'anthropic',
      costPreset: 'economy',
      signal: controller.signal,
      writeOutputFile: false,
      onEvent: event => events.push(event),
    });
    const models = {
      commander: 'gpt-5.4-nano',
      departments: 'gpt-4o',
      judge: 'gpt-5.4-nano',
      director: 'gpt-5.4-nano',
      agentReactions: 'gpt-5.4-nano',
    };
    const mark = { aiGenerated: true, generator: 'paracosm', models };
    assert.equal(events[0]?.type, 'sim_aborted');
    assert.deepEqual(events[0]?.provenance, mark);
    assert.deepEqual(artifact.provenance, mark);
    assert.ok(events.every(event => event.type !== 'provider_error'));
  } finally {
    if (openai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openai;
    if (anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = anthropic;
  }
});

test('an actor writer role stays on the artifact for that profile', async () => {
  const world = WorldModel.fromScenario(marsScenario);
  const authored = { model: 'test-leader-writer', fields: ['archetype', 'instructions'] };
  const abort = new AbortController();
  abort.abort('user_aborted');
  for (const source of [authored, undefined]) {
    const events: SimEvent[] = [];
    const artifact = await world.simulate({
      actor: { ...marsLeaders[0], aiAuthorship: source },
      maxTurns: 1,
      seed: 950,
      provider: 'openai',
      apiKey: 'placeholder-key-for-a-test',
      models: roleOverrides,
      signal: abort.signal,
      writeOutputFile: false,
      onEvent: event => events.push(event),
    });
    const internal = artifact.scenarioExtensions?.paracosmInternal as { leader?: { aiAuthorship?: typeof authored } } | undefined;
    assert.deepEqual(internal?.leader?.aiAuthorship, source);
    assert.equal(artifact.provenance?.models.leaderWriter, source?.model);
    assert.equal(events[0]?.provenance?.models.leaderWriter, source?.model);
  }
});

test('a public batch writes role assignments for each member', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'paracosm-role-batch-'));
  const originalDir = process.env.PARACOSM_OUTPUT_DIR;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.PARACOSM_OUTPUT_DIR = outputDir;
  process.env.OPENAI_API_KEY = 'placeholder-key-for-a-test';
  try {
    await withStubOpenAi(({ lastUser }) => replyToMars(lastUser), async () => {
      const batch = await WorldModel.fromScenario(marsScenario).batch({
        actors: marsLeaders.slice(0, 2),
        turns: 1,
        seed: 950,
        provider: 'openai',
        models: roleOverrides,
      });
      assert.deepEqual(batch.results.map(member => member.leader), marsLeaders.slice(0, 2).map(actor => actor.name));
      assert.equal(readdirSync(outputDir).length, 2);
      for (const { output } of batch.results) {
        assert.deepEqual(output.provenance, expectedMark);
        const stored = JSON.parse(readFileSync(output.scenarioExtensions.outputPath, 'utf8')) as RunArtifact;
        assert.equal(stored.metadata.runId, output.metadata.runId);
        assert.deepEqual(stored.provenance, expectedMark);
      }
    });
  } finally {
    if (originalDir === undefined) delete process.env.PARACOSM_OUTPUT_DIR;
    else process.env.PARACOSM_OUTPUT_DIR = originalDir;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('kernel replay retains run identity inputs and marks a fresh artifact without a provider call', async () => {
  const { runMarsWithStubModel } = await import('../runtime/helpers/stub-model-mars-run.js');
  const { artifact } = await runMarsWithStubModel({ writeOutputFile: false });
  const wm = WorldModel.fromScenario(marsScenario);
  const { provenance, ...legacy } = artifact;
  const full = await withStubOpenAi(() => assert.fail('recorded replay called a model'), async requests => {
    const current = await wm.replay(artifact);
    const historical = await wm.replay(legacy);
    assert.deepEqual(requests, []);
    assert.equal(current.matches, true);
    assert.equal(historical.matches, true);
    assert.deepEqual(current.artifact.provenance, provenance);
    return historical.artifact;
  });
  assert.notEqual(full.metadata.runId, legacy.metadata.runId);
  assert.equal(full.metadata.seed, legacy.metadata.seed);
  assert.deepEqual(full.fingerprint, legacy.fingerprint);
  assert.deepEqual(full.provenance, { aiGenerated: true, generator: 'paracosm', models: {} });
});

function parseFrames(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  return text.split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const [event, data] = frame.split('\n');
    return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
  });
}

const emptyMark = { aiGenerated: true, generator: 'paracosm', models: {} };

test('live and saved pair streams carry the roles of the bound run through an actor reconnect', async () => {
  const { mars, settingsBody, openStream, readReplay, withVisitors, waitFor } = await import('./helpers/run-server.js');
  const markFor = (commander: string) => ({
    aiGenerated: true,
    generator: 'paracosm',
    models: { ...roleOverrides, commander, director: commander },
  });
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await withVisitors(async ({ cookied }) => {
    const visitors = [cookied(), cookied()];
    const idle = await openStream(visitors[0]);
    try {
      assert.equal(idle.frames[0]?.event, 'connected');
      assert.equal(idle.frames[0]?.data.provenance, undefined);
    } finally {
      idle.close();
    }

    const launches = await Promise.all(visitors.map(async (visitor, index) => {
      const commander = index === 0 ? 'gpt-4o' : 'gpt-4o-mini';
      const response = await visitor.post('/setup', {
        ...settingsBody(mars),
        provider: 'openai',
        apiKey: 'placeholder-key-for-a-test',
        models: { ...roleOverrides, commander, director: commander },
      });
      assert.equal(response.status, 200, await response.clone().text());
      const { runKey } = await response.json();
      return { visitor, runKey, provenance: markFor(commander) };
    }));

    try {
      for (const { visitor, runKey, provenance } of launches) {
        const stream = await openStream(visitor, `?runKey=${runKey}`);
        try {
          assert.equal(stream.frames[0]?.event, 'connected');
          assert.deepEqual(stream.frames[0]?.data.provenance, provenance);
          assert.equal(stream.frames[1]?.event, 'active_scenario');
          assert.deepEqual(stream.frames[1]?.data.provenance, provenance);
        } finally {
          stream.close();
        }
      }
    } finally {
      release();
    }

    for (const { visitor, runKey, provenance } of launches) {
      const query = `?runKey=${runKey}&actor=${encodeURIComponent(mars.presets[0].leaders[0].name)}`;
      const session = await waitFor(async () => {
        const response = await visitor.get('/sessions');
        const body = await response.json() as { sessions: Array<{ id: string; provenance?: unknown }> };
        return body.sessions.find(row => row.id);
      }, 'the saved run', 5000);
      const reconnect = await readReplay(visitor, query);
      assert.deepEqual(reconnect.connected.provenance, provenance);
      assert.equal(reconnect[0]?.event, 'active_scenario');
      assert.deepEqual(reconnect[0]?.data.provenance, provenance);
      assert.ok(reconnect.every(frame => frame.event !== 'sim' || frame.data.leader === mars.presets[0].leaders[0].name));
      assert.ok(reconnect.length < 12, 'the actor reconnect reads the trimmed buffer');
      assert.deepEqual(session.provenance, provenance);

      const replay = await visitor.get(`/sessions/${session.id}/replay`);
      assert.equal(replay.status, 200);
      const frames = parseFrames(await replay.text());
      assert.equal(frames[0]?.event, 'active_scenario');
      assert.deepEqual(frames[0]?.data.provenance, provenance);
      assert.equal(frames.filter(frame => frame.event === 'sim').length, 12);
    }
  }, {
    env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'placeholder-host-key', PARACOSM_EVENT_BUFFER_MAX: '5' },
    extra: { getDigitalTwinWorld: async () => null, generateText: async () => ({ text: 'Saved pair' }) },
    runner: async (config, broadcast) => {
      await ready;
      for (let turn = 1; turn <= config.turns; turn++) {
        for (const actor of config.actors) {
          broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn, time: turn } }, actor.name);
        }
      }
      broadcast('complete', { timestamp: '2026-04-26T00:01:30.000Z' });
    },
  });
});

test('saved replay marks a leading historical result and an empty session without exposing private fields', async () => {
  const { withVisitors } = await import('./helpers/run-server.js');
  const { openSessionStore } = await import('../../src/server/stores/session.js');
  const { randomUUID, createHash } = await import('node:crypto');
  const owner = createHash('sha256').update(randomUUID()).digest('hex');
  const store = openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } });
  const frame = (event: string, data: unknown, ts: number) => ({ ts, sse: `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` });
  const old = await store.saveSession([
    frame('result', { leader: 'Aria', artifact: { scenarioExtensions: { outputPath: '/private/run.json', label: 'kept' } } }, 1000),
    frame('active_scenario', { id: marsScenario.id, seedText: 'Private scenario brief' }, 1020),
  ], undefined, { owner });
  const empty = await store.saveSession([], undefined, { owner });
  await withVisitors(async ({ cookied }) => {
    for (const query of ['', '?speed=2']) {
      const response = await cookied().get(`/sessions/${old.id}/replay${query}`);
      assert.equal(response.status, 200);
      const frames = parseFrames(await response.text());
      assert.equal(frames[0]?.event, 'result');
      assert.deepEqual(frames[0]?.data.provenance, emptyMark);
      assert.deepEqual(frames[0]?.data.artifact, { scenarioExtensions: { label: 'kept' } });
      assert.equal(frames[1]?.data.seedText, null);
    }
    const response = await cookied().get(`/sessions/${empty.id}/replay`);
    assert.equal(response.status, 200);
    assert.deepEqual(parseFrames(await response.text()), [{ event: 'provenance', data: { provenance: emptyMark } }]);
  }, {
    env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: 'placeholder-host-key' },
    extra: { sessionStore: store, getDigitalTwinWorld: async () => null },
  });
});

test('the Digital Twin stream opens with the economy assignments used by its runner', async () => {
  const { openStream, withVisitors } = await import('./helpers/run-server.js');
  const models = {
    commander: 'gpt-5.4-nano', departments: 'gpt-4o', judge: 'gpt-5.4-nano',
    director: 'gpt-5.4-nano', agentReactions: 'gpt-5.4-nano',
  };
  const provenance = { aiGenerated: true, generator: 'paracosm', models };
  let costPreset: unknown;
  await withVisitors(async ({ cookied }) => {
    const visitor = cookied();
    const runKey = 'economy-twin';
    const launch = await visitor.post('/api/quickstart/simulate-intervention', {
      runKey,
      apiKey: 'placeholder-key-for-a-test',
      subject: { id: 'colony', name: 'Colony' },
      intervention: { id: 'reserve', name: 'Power reserve', description: 'Keep power in reserve.' },
      options: { costPreset: 'economy' },
    });
    assert.equal(launch.status, 200, await launch.clone().text());
    assert.equal(costPreset, 'economy');
    const stream = await openStream(visitor, `?runKey=${runKey}`);
    try {
      assert.equal(stream.frames[0]?.event, 'connected');
      assert.deepEqual(stream.frames[0]?.data.provenance, provenance);
      assert.equal(stream.frames[1]?.event, 'active_scenario');
      assert.deepEqual(stream.frames[1]?.data.provenance, provenance);
    } finally {
      stream.close();
    }
  }, {
    extra: {
      getDigitalTwinWorld: async () => ({
        scenario: marsScenario,
        intervene: async (options: { costPreset: unknown }) => {
          costPreset = options.costPreset;
          return { metadata: { runId: 'twin-fixture', scenario: { id: marsScenario.id } }, trajectory: { timepoints: [] } };
        },
      }),
    },
  });
});
