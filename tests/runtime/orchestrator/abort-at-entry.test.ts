/**
 * A run whose signal is already aborted when it starts spends nothing.
 *
 * The server holds a run's capacity slot until its runner settles, and a
 * batch that is cleared may still start an actor whose signal has fired. The
 * orchestrator's first model call, the commander's bootstrap, had no abort
 * gate, so every such actor made it before the turn loop saw the signal.
 *
 * The real runSimulation over Mars Genesis. The key is a placeholder and
 * global fetch refuses, so nothing reaches a provider either way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation } from '../../../src/runtime/orchestrator/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';

test('a run aborted before it starts emits one sim_aborted with the reason and makes no model call', async () => {
  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    requests.push(String(input instanceof Request ? input.url : input));
    throw new Error('no network in this test');
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    controller.abort('user_aborted');
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const leader = marsScenario.presets[0].leaders[0];
    const artifact = await runSimulation({ ...leader, unit: 'Colony Alpha' } as any, [], {
      scenario: marsScenario,
      maxTurns: 1,
      provider: 'openai',
      apiKey: 'placeholder-key-for-a-test',
      signal: controller.signal,
      onEvent: event => { events.push(event as { type: string; data?: Record<string, unknown> }); },
    });

    assert.equal((artifact as { aborted?: boolean }).aborted, true);
    assert.equal(events[0]?.type, 'sim_aborted', `first event: ${events.map(e => e.type).join(', ')}`);
    assert.equal(events[0].data?.reason, 'user_aborted');
    assert.equal(events.filter(e => e.type === 'sim_aborted').length, 1);
    assert.equal(events.some(e => e.type === 'turn_start'), false);
    assert.equal(events.some(e => e.type === 'provider_error'), false, 'no model call was attempted');
    assert.deepEqual(requests.filter(url => !url.includes('/embeddings')), [], 'no request reached a provider');
  } finally {
    globalThis.fetch = realFetch;
  }
});
