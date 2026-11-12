/**
 * Forges one tool on paracosm's own engine in a process of its own and
 * prints how the forge ended.
 *
 * tests/runtime/forged-code-own-context.test.ts starts this file for the
 * forges whose outcome is "the process that forged goes on": a forge made
 * in the test's own process could hold the whole test run.
 *
 * The request is one JSON argument: `{ code, sandboxTimeoutMs? }`. The
 * engine is the one `createEmergentEngine` builds for a run, with the
 * run's `execution.sandboxTimeoutMs` when the request names one. The judge
 * is answered by the stub transport (tests/runtime/helpers/
 * stub-openai-transport.ts), so no network is reached. The first line
 * printed says how the forge ended and how long it took. The second line,
 * `settled`, is printed from a timer, so it is reached only when nothing
 * the forge left behind holds the process first.
 */
import { createEmergentEngine } from '../../../src/runtime/orchestrator/emergent-setup.js';
import { withStubOpenAi } from './stub-openai-transport.js';

interface ForgeProbeRequest {
  code: string;
  sandboxTimeoutMs?: number;
}

const request = JSON.parse(process.argv[2] ?? '{}') as ForgeProbeRequest;
const started = Date.now();

withStubOpenAi(() => '{}', async () => {
  const { engine } = createEmergentEngine(
    new Map(),
    'openai',
    'gpt-4o',
    request.sandboxTimeoutMs === undefined ? {} : { sandboxTimeoutMs: request.sandboxTimeoutMs },
    undefined,
    undefined,
    undefined,
    'placeholder-key-for-a-test',
  );
  return engine.forge(
    {
      name: 'sum_two',
      description: 'Adds two numbers.',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
      outputSchema: { type: 'object', properties: { total: { type: 'number' } } },
      implementation: { mode: 'sandbox', code: request.code, allowlist: [] },
      testCases: [{ input: { a: 1, b: 2 } }],
    },
    { agentId: 'dept-test', sessionId: 'sess-test' },
  );
}).then(
  (result) => ({ ended: 'returned', success: result.success, error: result.error ?? null }),
  (err: unknown) => ({ ended: 'threw', message: err instanceof Error ? err.message : 'a value that is not an Error' }),
).then((line) => {
  process.stdout.write(`${JSON.stringify({ ...line, ms: Date.now() - started })}\n`);
  setTimeout(() => {
    process.stdout.write('settled\n');
  }, 50);
});
