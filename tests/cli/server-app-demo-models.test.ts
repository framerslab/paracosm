/**
 * The models a hosted demo run gets (#252).
 *
 * On the hosted demo, a /setup that brings no provider key of its own runs
 * on the host's key, and the server's demo cap picks the models. Two live
 * Mars Genesis pairs on 11 November 2026 ran the commander on gpt-5.4-nano
 * (07:39 UTC on 0.9.1101, 08:40 UTC on 0.9.1102): in each, Aria Chen stated
 * that the bold option's chance cleared her bar and chose a safe option on
 * 5 of her 6 events. One pair at 08:51 UTC, the same body and seed with the
 * commander alone on gpt-5.4-mini, followed the bar on all 12 decisions.
 *
 * These go through the server's own /setup handler with Mars Genesis's
 * preset leaders from scenarios/mars.json, and read the config the server
 * hands to the simulation runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import { DEMO_EXECUTION, normalizeSimulationConfig, type NormalizedSimulationConfig, type SimulationSetupPayload } from '../../src/cli/sim-config.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

interface ScenarioJson {
  id: string;
  setup: { defaultTurns: number; defaultSeed: number };
  presets: Array<{ leaders: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }> }>;
}

const mars = JSON.parse(
  readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf-8'),
) as ScenarioJson;

/** The body of the live pairs of #250 and #252: Mars's two preset leaders, provider openai, seed 950. */
function marsPairBody(extra: Record<string, unknown> = {}) {
  return {
    actors: mars.presets[0].leaders.map(l => ({
      name: l.name,
      archetype: l.archetype,
      hexaco: l.hexaco,
      instructions: l.instructions,
    })),
    provider: 'openai',
    turns: mars.setup.defaultTurns,
    seed: 950,
    population: 100,
    activeDepartments: ['medical', 'engineering', 'agriculture', 'psychology', 'governance'],
    scenarioId: mars.id,
    ...extra,
  };
}

async function waitFor<T>(read: () => T | null, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('the simulation runner was not called');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** A hosted demo server whose run is a stub that records what it was handed. */
async function withHostedDemo(
  body: (
    post: (payload: unknown) => Promise<Response>,
    launches: Array<{ config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined }>,
  ) => Promise<void>,
): Promise<void> {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-demo-models-'));
  const launches: Array<{ config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined }> = [];
  const server = createMarsServer({
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: 'true' },
    maxSimsPerDay: 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async (config, _broadcast, _signal, scenario) => { launches.push({ config, scenario }); },
    // The server warms the digital-twin world on start; with a provider
    // key in the environment that would compile it against the provider.
    getDigitalTwinWorld: async () => null,
  });
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  try {
    await body(payload => fetch(`http://127.0.0.1:${port}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), launches);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(appDir, { recursive: true, force: true });
  }
}

test('POST /setup on the hosted demo with no key of its own runs the commander on gpt-5.4-mini, and the director, departments, judge and reactions stay on the economy models (#252)', async () => {
  await withHostedDemo(async (post, launches) => {
    // The client's own model picks are overwritten by the cap, as before.
    const setup = await post(marsPairBody({ models: { commander: 'gpt-5.4', director: 'gpt-5.4', departments: 'gpt-5.4' } }));
    assert.equal(setup.status, 200);
    const { config } = await waitFor(() => launches[0] ?? null);

    // The cap reads PARACOSM_DEMO_MAX_TURNS when it is set, and 6 when not.
    if (!process.env.PARACOSM_DEMO_MAX_TURNS) assert.equal(DEMO_EXECUTION.maxTurns, 6, 'the demo cap with no turn limit set');
    assert.equal(config.turns, Math.min(mars.setup.defaultTurns, DEMO_EXECUTION.maxTurns), 'the demo cap ran');
    assert.equal(config.initialPopulation, 30, 'the demo cap ran');
    assert.equal(config.economics.id, 'economy');
    assert.equal(config.models.commander, 'gpt-5.4-mini', 'the commander one model up from gpt-5.4-nano');
    assert.equal(config.models.director, 'gpt-5.4-nano', 'the director as it was');
    assert.equal(config.models.departments, 'gpt-5.4-mini', 'the departments as they were');
    assert.equal(config.models.judge, 'gpt-5.4-mini', 'the judge as it was');
    assert.equal(config.models.agentReactions, 'gpt-5.4-nano', 'the reactions as they were');
    assert.deepEqual(config.economics.models, config.models, 'the run and its economics profile name the same models');
    assert.match(config.economics.compileSignature, /"commander":"gpt-5\.4-mini"/, 'the profile signature names the commander it runs');
  });
});

test('POST /setup on the hosted demo with a key of its own gets the models the normalizer gives, as before (#252)', async () => {
  await withHostedDemo(async (post, launches) => {
    const body = marsPairBody({ apiKey: 'caller-key-for-this-test' });
    const setup = await post(body);
    assert.equal(setup.status, 200);
    const { config, scenario } = await waitFor(() => launches[0] ?? null);

    assert.equal(config.turns, 6);
    assert.equal(config.initialPopulation, 100, 'no demo cap on a caller with its own key');
    const own = normalizeSimulationConfig(body as unknown as SimulationSetupPayload, scenario);
    assert.deepEqual(config.models, own.models, 'a keyed caller keeps the models the normalizer gives');
    assert.notEqual(config.economics.id, 'economy', 'a keyed caller with no profile is not put on the demo profile');
  });
});
