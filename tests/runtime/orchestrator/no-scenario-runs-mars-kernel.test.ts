/**
 * A run given no scenario runs Mars Genesis, kernel included.
 *
 * runSimulation resolves `opts.scenario ?? marsScenario` for its events,
 * outcome tables, hooks and research memory, but built the kernel from
 * `opts.scenario` alone and took its start time from it. So
 * `runSimulation(leader, [], { maxTurns: 6, seed: 950 })` ran Mars on a
 * kernel with no scenario: no landing-day supplies (the supply level read
 * 1 whatever the colony built), no declared ranges, and a start at year 0
 * where Mars lands in 2035.
 *
 * The real runSimulation, aborted before it starts so it makes no model
 * call. No turn runs, so the run takes no snapshot; the kernel state it
 * built is the one the artifact keeps (`paracosmInternal.finalState`, the
 * kernel's export). The key is a placeholder and global fetch refuses, so
 * nothing reaches a provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation, type RunOptions } from '../../../src/runtime/orchestrator/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';
import type { SimulationState } from '../../../src/engine/core/state.js';

type Event = { type: string; data?: { time?: number } };

/** Run the real runSimulation aborted before it starts, and return the kernel state it built and its events. */
async function abortedRun(extra: Partial<RunOptions>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as typeof fetch;
  try {
    const controller = new AbortController();
    controller.abort('user_aborted');
    const events: Event[] = [];
    const leader = marsScenario.presets[0].leaders[0];
    const artifact = await runSimulation({ ...leader, unit: 'Colony Alpha' } as any, [], {
      maxTurns: 6,
      seed: 950,
      captureSnapshots: true,
      provider: 'openai',
      apiKey: 'placeholder-key-for-a-test',
      signal: controller.signal,
      onEvent: event => { events.push(event as unknown as Event); },
      ...extra,
    });
    const internal = (artifact.scenarioExtensions as { paracosmInternal?: { finalState?: SimulationState } } | undefined)?.paracosmInternal;
    assert.ok(internal?.finalState, 'the aborted run keeps the kernel state it built');
    return { state: internal.finalState, events };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a run with no scenario builds the Mars kernel: landing-day supplies and the 2035 start', async () => {
  const bare = await abortedRun({});

  assert.deepEqual(
    bare.state.metadata.landingSupplies,
    { lifeSupportCapacity: 120, waterLitersPerDay: 800, powerKw: 400, pressurizedVolumeM3: 3000, infrastructureModules: 3 },
    'the kernel keeps what each supply Mars Genesis marks holds on landing day',
  );
  assert.equal(marsScenario.setup.defaultStartTime, 2035);
  assert.equal(bare.state.metadata.startTime, 2035);
  assert.equal(bare.events[0]?.type, 'sim_aborted');
  assert.equal(bare.events[0]?.data?.time, 2035, 'the first turn is dated from the Mars start');

  // No scenario and Mars Genesis named build the same colony, roster included.
  const mars = await abortedRun({ scenario: marsScenario });
  assert.deepEqual(bare.state, mars.state);
});
