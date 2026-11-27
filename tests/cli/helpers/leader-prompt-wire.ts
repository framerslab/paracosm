import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GENERAL_AUDIENCE_GUIDANCE } from '../../../src/runtime/util/audience.js';
import { openSessionStore } from '../../../src/server/stores/session.js';
import { modelCalls, setHostKeys, withProviderWire, type WireCall } from './provider-wire.js';
import { mars, settingsBody, waitFor, withVisitors } from './run-server.js';

interface OpeningMessages {
  system: string;
  opening: string;
}

const BOOTSTRAP_MARKER = 'You receive department reports and make strategic decisions.';

function firstBootstrap(calls: readonly WireCall[], orders: string): OpeningMessages {
  const input = GENERAL_AUDIENCE_GUIDANCE + '\n\n' + orders;
  const call = calls.find(call =>
    call.lastUser.includes(BOOTSTRAP_MARKER) && call.system.includes(input),
  );
  assert.ok(call, 'the commander received its own written orders and opening message');
  return { system: call.system, opening: call.lastUser };
}

function reply(call: WireCall): string | undefined {
  if (call.lastUser.includes(BOOTSTRAP_MARKER)) return 'Acknowledged.';
  if (call.lastUser.includes('You must promote')) return '{}';
  return undefined;
}

/** Run the real Mars pair and retain only the first two inputs for each commander. */
export async function captureMarsOpenings(): Promise<{ aria: OpeningMessages; dietrich: OpeningMessages }> {
  const standIns = {
    OPENAI_API_KEY: 'openai-for-prompt-tests',
    ANTHROPIC_API_KEY: 'anthropic-for-prompt-tests',
  };
  const restore = setHostKeys(standIns);
  try {
    return await withProviderWire(async calls => {
      const body = settingsBody(mars);
      const [aria, dietrich] = body.actors;
      assert.equal(aria?.name, 'Aria Chen');
      assert.equal(dietrich?.name, 'Dietrich Voss');
      await withVisitors(async api => {
        const visitor = api.cookied();
        const response = await visitor.post('/setup', { ...body, turns: 1 });
        assert.equal(response.status, 200);
        await waitFor(async () => (await visitor.json<{ isComplete: boolean }>('/results')).isComplete,
          'the Mars pair to finish its run', 120_000);
      }, {
        env: { ...standIns, PARACOSM_HOSTED_DEMO: 'true' },
        extra: {
          getDigitalTwinWorld: async () => null,
          runPairSimulations: undefined,
          sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
          generateText: async () => ({ text: 'A saved run' }),
        },
      });
      const completions = modelCalls(calls);
      const openings = {
        aria: firstBootstrap(completions, aria.instructions),
        dietrich: firstBootstrap(completions, dietrich.instructions),
      };
      assert.ok(openings.aria.system !== openings.dietrich.system, 'the leaders have distinct system prompts');
      assert.ok(openings.aria.opening !== openings.dietrich.opening, 'the leaders have distinct opening messages');
      return openings;
    }, reply, reply);
  } finally {
    restore();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination] = process.argv.slice(2);
  assert.ok(mode === '--capture-mars' && destination, 'usage: --capture-mars <destination>');
  await writeFile(destination, JSON.stringify(await captureMarsOpenings(), null, 2) + '\n', 'utf8');
}

/** Retain the bootstrap and first decision from the same real commander. */
export function firstCommanderTurn(calls: readonly WireCall[], orderMarker: string) {
  const completions = modelCalls(calls);
  const bootstrap = completions.find(call =>
    call.lastUser.includes(BOOTSTRAP_MARKER) && call.system.includes(orderMarker),
  );
  assert.ok(bootstrap, 'the first commander bootstrap reached the provider');
  const decision = completions.find(call =>
    call.system.includes(orderMarker) && /^TURN 1(,| \(Event 1\/\d+\),)/.test(call.lastUser) && call.lastUser.includes('YOUR DECISION RULE'),
  );
  assert.ok(decision, 'the first commander decision reached the provider');
  return { bootstrap, decision };
}

/** Observe the real pair runner with only the network and session title substituted. */
export async function withPromptRuns(
  run: (api: import('./run-server.js').RunServer, calls: WireCall[]) => Promise<void>,
  options: import('./run-server.js').RunServerOptions = {},
): Promise<void> {
  const standIns = { OPENAI_API_KEY: 'openai-for-prompt-tests', ANTHROPIC_API_KEY: 'anthropic-for-prompt-tests' };
  const restore = setHostKeys(standIns);
  try {
    await withProviderWire(async calls => {
      await withVisitors(api => run(api, calls), {
        ...options,
        env: { ...standIns, PARACOSM_HOSTED_DEMO: 'true', ...options.env },
        extra: {
          getDigitalTwinWorld: async () => null,
          runPairSimulations: undefined,
          sessionStore: openSessionStore(':memory:', 10, { databaseOptions: { type: 'memory' } }),
          generateText: async () => ({ text: 'A saved run' }),
        },
      });
    }, reply, reply);
  } finally {
    restore();
  }
}
