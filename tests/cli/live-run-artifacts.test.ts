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
