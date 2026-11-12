/**
 * POST /setup holds a run's turns and population to the server's bounds
 * (MAX_SIMULATION_TURNS, MAX_SIMULATION_POPULATION in src/cli/sim-config.ts)
 * whoever pays for the run: a caller who sends a key of their own gets the
 * same bounds as one who sends none. A request past them answers 400 and
 * starts no run.
 *
 * The server runs with a stub simulation runner, so no model is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { normalizeSimulationConfig } from '../../src/cli/sim-config.js';

/** The bounds src/cli/sim-config.ts sets (MAX_SIMULATION_TURNS, MAX_SIMULATION_POPULATION). */
const MAX_SIMULATION_TURNS = 100;
const MAX_SIMULATION_POPULATION = 2000;
import { startServer, type RunServer } from './helpers/run-server.js';

const hexaco = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 };
const actors = [
  { name: 'A', archetype: 'a', hexaco },
  { name: 'B', archetype: 'b', hexaco },
];

async function withServer(body: (api: RunServer) => Promise<void>): Promise<void> {
  const api = await startServer();
  try {
    await body(api);
  } finally {
    await api.close();
    rmSync(api.appDir, { recursive: true, force: true });
  }
}

function setup(base: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
}

const refused: Array<{ name: string; payload: Record<string, unknown> }> = [
  { name: 'a population of 3000', payload: { actors, population: 3000, apiKey: 'sk-x' } },
  { name: 'fifty million turns', payload: { actors, turns: 50_000_000, apiKey: 'sk-x' } },
  { name: 'a population past the bound', payload: { actors, population: MAX_SIMULATION_POPULATION + 1, apiKey: 'sk-x' } },
  { name: 'turns past the bound', payload: { actors, turns: MAX_SIMULATION_TURNS + 1, apiKey: 'sk-x' } },
  { name: 'a population that is not a whole number', payload: { actors, population: 2.5, apiKey: 'sk-x' } },
  { name: 'no turns at all', payload: { actors, turns: 0, apiKey: 'sk-x' } },
];

for (const c of refused) {
  test(`POST /setup with a caller key and ${c.name} answers 400 and starts no run`, async () => {
    await withServer(async (api) => {
      const res = await setup(api.base, c.payload);
      assert.equal(res.status, 400, JSON.stringify(await res.clone().json().catch(() => null)));
      assert.equal(api.launches.length, 0, 'no run started');
    });
  });
}

test('POST /setup with a caller key at the bounds starts its run', async () => {
  await withServer(async (api) => {
    const res = await setup(api.base, { actors, turns: MAX_SIMULATION_TURNS, population: MAX_SIMULATION_POPULATION, apiKey: 'sk-x' });
    assert.equal(res.status, 200);
    assert.equal(api.launches.length, 1);
    assert.equal(api.launches[0].config.turns, MAX_SIMULATION_TURNS);
    assert.equal(api.launches[0].config.initialPopulation, MAX_SIMULATION_POPULATION);
  });
});

test('normalizeSimulationConfig refuses a population of 3000 and fifty million turns', () => {
  assert.throws(() => normalizeSimulationConfig({ actors, population: 3000 }), /population/i);
  assert.throws(() => normalizeSimulationConfig({ actors, turns: 50_000_000 }), /turns/i);
});
