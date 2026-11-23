/**
 * A restart restores every saved compiled scenario on any host, and the
 * restore calls no model.
 *
 * Each test saves two compiled scenarios on a hosted demo whose host holds
 * an OpenAI key, then starts the server again on the same folders:
 *
 * - `saltmere-delta-council` (tests/fixtures/compiler/persisted/compiled/), a
 *   scenario a Quickstart compile answered with, saved as the server wrote
 *   its saved scenarios before they carried their hooks. The first boot
 *   compiles it again on the host's OpenAI key, which leaves its hooks in
 *   the compiler's disk cache.
 * - `orchard-seasons` (tests/fixtures/compiler/draft-orchard-bare.json),
 *   compiled through Quickstart on a visitor's own Anthropic key, so its
 *   hooks come from `claude-sonnet-4-6`, a model no host-paid call on the
 *   hosted demo uses.
 *
 * The providers are stubs at the wire (./helpers/provider-wire.ts): every
 * request is recorded, each code hook request is answered with a small
 * working hook, and the director and milestone requests with `{}`, which
 * leaves those two on the compiler's own fallbacks. The hooks the first
 * boot and the visitor's compile get say "Compiled with" in their
 * department prompt; the hooks a restart would get if it asked a model say
 * "Generated again". The test runs in a folder of its own, so the
 * compiler's disk cache (`.paracosm/cache` under the working folder) is the
 * test's alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../src/engine/compiler/index.js';
import type { ScenarioHooks } from '../../src/engine/types.js';
import { _resetCompileJobsForTest } from '../../src/server/routes/quickstart.js';
import { openSessionStore } from '../../src/server/stores/session.js';
import { describeCalls, modelCalls, setHostKeys, withProviderWire, type WireCall, type WireReply } from './helpers/provider-wire.js';
import { mars, settingsBody, startServer, waitFor, type RunServer } from './helpers/run-server.js';

const HOST_OPENAI_KEY = 'host-openai-key-of-this-test';
const HOST_ANTHROPIC_KEY = 'host-anthropic-key-of-this-test';
const VISITOR_ANTHROPIC_KEY = 'visitor-anthropic-key-of-this-test';

const SALTMERE = 'saltmere-delta-council';
const ORCHARD = 'orchard-seasons';

const fixture = (path: string): string => fileURLToPath(new URL(`../fixtures/compiler/${path}`, import.meta.url));
const ORCHARD_DRAFT = readFileSync(fixture('draft-orchard-bare.json'), 'utf-8');

/** The brief the visitor's Quickstart compile is given: Quickstart takes 200 characters or more. */
const SEED_TEXT = [
  'A family orchard on a hillside grows apples through four seasons a year.',
  'Its growers weigh each harvest against the health of the soil and the prices the buyers offer.',
  'Over the coming years they decide when to prune, what to plant and how much of the crop to keep back.',
].join(' ');

type HostKeys = { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string };
type Page = ReturnType<RunServer['cookied']>;

/** A compiled scenario as GET /scenarios lists it, less the brief, which the list shows only to some visitors. */
interface Listed { id: string; name: string; description: string; departments: number; source: string; compiledAt?: string }

/**
 * How the stub answers a hook request: each code hook with a working
 * function, the department prompt's lines opening with `label`, and the
 * director and the milestones with `{}`. Any other request gets the stub's
 * error.
 */
function hookReplies(label: string): WireReply {
  const hooks: ReadonlyArray<readonly [mark: string, source: string]> = [
    ['You are generating a between-turn progression hook', '(ctx) => {}'],
    ['You are generating a department prompt hook', `(ctx) => ['${label}: ' + Object.keys(ctx.state.metrics).join(', ')]`],
    [
      'You are generating a timeline fingerprint hook',
      "(finalState) => { const held = Object.keys(finalState.metrics).length; const breadth = held > 2 ? 'broad' : 'narrow'; return { breadth, summary: breadth + ' (' + held + ' scores held)' }; }",
    ],
    ['You are generating a politics hook', '(category, outcome) => null'],
    ['You are generating a reaction context hook', "(colonist, ctx) => 'Steady after the last turn.'"],
  ];
  return (call: WireCall) => {
    if (!call.text.includes('You are generating ')) return undefined;
    return hooks.find(([mark]) => call.text.includes(mark))?.[1] ?? '{}';
  };
}
const COMPILED_WITH = hookReplies('Compiled with');
const GENERATED_AGAIN = hookReplies('Generated again');

/** A hosted demo on `scenarioDir`, with no Digital Twin compile at boot and a title call that calls no model. */
function hostedDemo(scenarioDir: string, keys: HostKeys): Promise<RunServer> {
  return startServer({
    scenarioDir,
    env: { PARACOSM_HOSTED_DEMO: 'true', OPENAI_API_KEY: keys.OPENAI_API_KEY ?? '', ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY ?? '' },
    extra: {
      getDigitalTwinWorld: async () => null,
      sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
      generateText: async () => ({ text: 'A saved run' }),
      // A Quickstart compile's draft is the orchard draft; its hooks are
      // compiled by the real compiler on the keys and provider the route
      // gives it.
      compileFromSeed: (_input: unknown, options: Parameters<typeof compileScenario>[1]) =>
        compileScenario(JSON.parse(ORCHARD_DRAFT) as Record<string, unknown>, options),
    },
  });
}

async function listedCompiled(page: Page): Promise<Listed[]> {
  const { scenarios } = await page.json<{ scenarios: Array<Listed & { seedText?: string | null }> }>('/scenarios');
  return scenarios
    .filter(e => e.source === 'compiled')
    .map(({ id, name, description, departments, source, compiledAt }) => ({ id, name, description, departments, source, compiledAt }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Compiles the orchard through Quickstart on the visitor's own Anthropic key. */
async function quickstartOnVisitorKey(page: Page): Promise<void> {
  const start = await page.post('/api/quickstart/compile-from-seed', { seedText: SEED_TEXT, anthropicKey: VISITOR_ANTHROPIC_KEY });
  assert.equal(start.status, 202, `POST /api/quickstart/compile-from-seed: ${start.status}`);
  const { jobId } = await start.json() as { jobId: string };
  await waitFor(async () => {
    const res = await page.post('/api/quickstart/compile-from-seed/status', { jobId });
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; scenarioId?: string; error?: string };
    assert.notEqual(body.status, 'error', body.error);
    return body.status === 'done' ? body : null;
  }, 'the Quickstart compile to finish', 20_000);
}

interface Saved { scenarioDir: string; listed: Listed[] }

/**
 * Saves the two compiled scenarios as a hosted demo whose host holds an
 * OpenAI key does, closes that server, and hands `body` the folder and the
 * list GET /scenarios gave once both were in.
 */
async function withSavedScenarios(body: (saved: Saved) => Promise<void>): Promise<void> {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'paracosm-compiled-restore-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  copyFileSync(fixture(`persisted/compiled/${SALTMERE}.json`), join(scenarioDir, 'compiled', `${SALTMERE}.json`));
  process.chdir(root);
  _resetCompileJobsForTest();
  try {
    const listed = await (async (): Promise<Listed[]> => {
      const restoreKeys = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY });
      try {
        return await withProviderWire(async calls => {
          const api = await hostedDemo(scenarioDir, { OPENAI_API_KEY: HOST_OPENAI_KEY });
          try {
            const page = api.cookied();
            await waitFor(async () => (await listedCompiled(page)).some(e => e.id === SALTMERE), 'the first boot to compile the saved scenario', 20_000);
            await quickstartOnVisitorKey(page);
            const entries = await listedCompiled(page);
            assert.deepEqual(entries.map(e => e.id), [ORCHARD, SALTMERE]);
            const sent = modelCalls(calls);
            assert.ok(sent.some(c => c.provider === 'openai' && c.key === HOST_OPENAI_KEY), `the first boot compiled the saved scenario on the host's OpenAI key. The stub received:\n${describeCalls(calls)}`);
            assert.ok(sent.some(c => c.provider === 'anthropic' && c.key === VISITOR_ANTHROPIC_KEY), `the visitor's compile ran on their Anthropic key. The stub received:\n${describeCalls(calls)}`);
            return entries;
          } finally {
            await api.close();
            rmSync(api.appDir, { recursive: true, force: true });
          }
        }, COMPILED_WITH, COMPILED_WITH);
      } finally {
        restoreKeys();
      }
    })();
    assert.ok(existsSync(join(scenarioDir, 'compiled', `${ORCHARD}.json`)), 'the visitor\'s compile is saved');
    await body({ scenarioDir, listed });
  } finally {
    process.chdir(cwd);
    _resetCompileJobsForTest();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Starts the hosted demo again on the saved folders with `keys`, the stub recording every provider request. */
async function restart(scenarioDir: string, keys: HostKeys, body: (api: RunServer, calls: WireCall[]) => Promise<void>): Promise<void> {
  const restoreKeys = setHostKeys(keys);
  try {
    await withProviderWire(async calls => {
      const api = await hostedDemo(scenarioDir, keys);
      try {
        await body(api, calls);
      } finally {
        await api.close();
        rmSync(api.appDir, { recursive: true, force: true });
      }
    }, GENERATED_AGAIN, GENERATED_AGAIN);
  } finally {
    restoreKeys();
  }
}

/** The list once `count` saved scenarios, both by default, are in it. */
function restored(api: RunServer, count = 2): Promise<Listed[]> {
  const page = api.cookied();
  return waitFor(async () => {
    const entries = await listedCompiled(page);
    return entries.length === count ? entries : null;
  }, count === 2 ? 'both saved compiled scenarios to be listed after the restart' : `${count} saved compiled scenario(s) to be listed after the restart`, 10_000);
}

function assertNoModelCall(calls: readonly WireCall[], what: string): void {
  assert.deepEqual(
    modelCalls(calls).map(c => `${c.provider} ${c.path} ${c.model ?? '-'}`),
    [],
    `${what} called no model. The stub received:\n${describeCalls(calls)}`,
  );
}

/** The lines a scenario's department prompt hook gives for a state holding `metrics`. */
function departmentLines(hooks: ScenarioHooks | undefined, metrics: Record<string, number>): string {
  const lines = hooks?.departmentPromptHook?.({
    department: 'any',
    state: { agents: [], metrics, politics: {}, metadata: {} },
    scenario: {},
    researchPacket: { canonicalFacts: [], counterpoints: [], departmentNotes: {} },
  } as never);
  return JSON.stringify(lines);
}

/** Starts a host-paid run in `scenarioId` and returns the scenario the server handed the runner. */
async function runIn(api: RunServer, scenarioId: string) {
  const res = await api.cookied().post('/setup', { ...settingsBody(mars), scenarioId });
  assert.equal(res.status, 200, `POST /setup: ${await res.text()}`);
  const launch = await waitFor(() => api.launches.find(l => l.scenario?.id === scenarioId), `the run in ${scenarioId}`);
  return launch.scenario;
}

test('a restart on a hosted demo with no OpenAI key lists every saved compiled scenario and calls no model', async () => {
  await withSavedScenarios(async ({ scenarioDir, listed }) => {
    for (const [host, keys] of [['an Anthropic key only', { ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY }], ['no key', {}]] as const) {
      await restart(scenarioDir, keys, async (api, calls) => {
        assert.deepEqual(await restored(api), listed, `a host with ${host}`);
        assertNoModelCall(calls, `the restore on a host with ${host}`);
      });
    }
  });
});

test('a restart on a hosted demo with the host OpenAI key lists every saved compiled scenario and calls no model', async () => {
  await withSavedScenarios(async ({ scenarioDir, listed }) => {
    await restart(scenarioDir, { OPENAI_API_KEY: HOST_OPENAI_KEY }, async (api, calls) => {
      assert.deepEqual(await restored(api), listed);
      assertNoModelCall(calls, 'the restore on a host with an OpenAI key');

      // Saltmere's file carries no hooks: a run in it holds the hooks the
      // first boot compiled, read back from the disk cache.
      const saltmere = await runIn(api, SALTMERE);
      assert.equal(departmentLines(saltmere?.hooks, { 'fresh-water': 1 }), JSON.stringify(['Compiled with: fresh-water']), 'the run holds the department prompt the first boot compiled');
    });
  });
});

test('a saved scenario compiled on a model the host cannot serve is listed after a restart and runs the hooks it was compiled with', async () => {
  await withSavedScenarios(async ({ scenarioDir, listed }) => {
    // The host holds an OpenAI key alone, and a host-paid call on the hosted
    // demo stays on OpenAI: the orchard's model, claude-sonnet-4-6, is not
    // one it serves.
    await restart(scenarioDir, { OPENAI_API_KEY: HOST_OPENAI_KEY }, async (api) => {
      const entries = await restored(api);
      assert.deepEqual(entries.find(e => e.id === ORCHARD), listed.find(e => e.id === ORCHARD));

      const orchard = await runIn(api, ORCHARD);
      const hooks = (orchard?.hooks ?? {}) as ScenarioHooks & Record<string, unknown>;
      for (const name of ['progressionHook', 'directorInstructions', 'departmentPromptHook', 'getMilestoneEvent', 'fingerprintHook', 'politicsHook', 'reactionContextHook']) {
        assert.equal(typeof hooks[name], 'function', `the restored scenario holds its ${name}`);
      }
      assert.equal(departmentLines(hooks, { harvest: 420, 'soil-health': 62 }), JSON.stringify(['Compiled with: harvest, soil-health']), 'the run holds the department prompt the scenario was compiled with');
      assert.equal(hooks.reactionContextHook?.({ core: {} } as never, {} as never), 'Steady after the last turn.', 'the run holds the reaction context the scenario was compiled with');
      assert.equal(
        JSON.stringify(hooks.fingerprintHook?.({ metrics: { harvest: 420, 'soil-health': 62, water: 3 } } as never, [], {} as never, {}, 6)),
        JSON.stringify({ breadth: 'broad', summary: 'broad (3 scores held)' }),
        'the run holds the fingerprint the scenario was compiled with',
      );
    });
  });
});

/**
 * Answers every hook request with text no hook parser takes, so each of
 * the seven hooks ends on the compiler's fallback: the compile succeeds and
 * keeps no hook.
 */
const NO_HOOK: WireReply = (call: WireCall) => (call.text.includes('You are generating ') ? 'not a hook' : undefined);

test('a saved scenario whose compile kept every hook on its fallback is listed after a restart on any host, and the restore calls no model', async () => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'paracosm-compiled-restore-'));
  const scenarioDir = join(root, 'scenarios');
  mkdirSync(join(scenarioDir, 'compiled'), { recursive: true });
  process.chdir(root);
  _resetCompileJobsForTest();
  try {
    // The visitor's Quickstart compile on their own Anthropic key, on a
    // hosted demo whose host holds an OpenAI key, gets no hook it can keep.
    const listed = await (async (): Promise<Listed[]> => {
      const restoreKeys = setHostKeys({ OPENAI_API_KEY: HOST_OPENAI_KEY });
      try {
        return await withProviderWire(async () => {
          const api = await hostedDemo(scenarioDir, { OPENAI_API_KEY: HOST_OPENAI_KEY });
          try {
            const page = api.cookied();
            await quickstartOnVisitorKey(page);
            const entries = await listedCompiled(page);
            assert.deepEqual(entries.map(e => e.id), [ORCHARD]);
            return entries;
          } finally {
            await api.close();
            rmSync(api.appDir, { recursive: true, force: true });
          }
        }, NO_HOOK, NO_HOOK);
      } finally {
        restoreKeys();
      }
    })();
    assert.ok(existsSync(join(scenarioDir, 'compiled', `${ORCHARD}.json`)), 'the visitor\'s compile is saved');

    for (const [host, keys] of [
      ['no key', {}],
      ['an Anthropic key only', { ANTHROPIC_API_KEY: HOST_ANTHROPIC_KEY }],
      ['the host OpenAI key', { OPENAI_API_KEY: HOST_OPENAI_KEY }],
    ] as const) {
      await restart(scenarioDir, keys, async (api, calls) => {
        assert.deepEqual(await restored(api, 1), listed, `a host with ${host}`);
        assertNoModelCall(calls, `the restore on a host with ${host}`);
      });
    }
  } finally {
    process.chdir(cwd);
    _resetCompileJobsForTest();
    rmSync(root, { recursive: true, force: true });
  }
});
