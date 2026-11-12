/**
 * Code a department forges at run time runs on values of its own context,
 * inside a time limit the server sets.
 *
 * The engine is the one `createEmergentEngine` builds for a run
 * (src/runtime/orchestrator/emergent-setup.ts); the judge is answered by
 * the stub transport, so no network is reached. A forge runs its test
 * cases before the judge reads anything, so these tests read what a test
 * case's code did, whatever the verdict.
 *
 * The forges whose outcome is "the process that forged goes on" run in a
 * process of their own (tests/runtime/helpers/forge-probe.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeSimulationConfig } from '../../src/cli/sim-config.js';
import { createEmergentEngine } from '../../src/runtime/orchestrator/emergent-setup.js';
import { withStubOpenAi } from './helpers/stub-openai-transport.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROBE = fileURLToPath(new URL('./helpers/forge-probe.ts', import.meta.url));

/** How one forge ended in a process of its own. */
interface ForgeOutcome {
  line: { ended?: string; success?: boolean; error?: string | null; ms?: number } | null;
  settled: boolean;
  status: number | null;
}

/** Forge once through tests/runtime/helpers/forge-probe.ts, stopping the process after `limitMs`. */
function forgeInOwnProcess(request: { code: string; sandboxTimeoutMs?: number }, limitMs: number): ForgeOutcome {
  const out = spawnSync(process.execPath, ['--import', 'tsx', '--import', './scripts/test-css-stub.mjs', PROBE, JSON.stringify(request)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: limitMs,
    killSignal: 'SIGKILL',
  });
  const lines = (out.stdout ?? '').split('\n').filter(Boolean);
  let line: ForgeOutcome['line'] = null;
  try {
    line = lines[0] ? JSON.parse(lines[0]) : null;
  } catch {
    line = null;
  }
  return { line, settled: lines.includes('settled'), status: out.status };
}

/** The mark this file's forged code would leave on the process's own global object. */
const MARK = '__paracosmForgeOwnContextMark';

test('a forged tool\'s test case runs its statements in the tool\'s context only', async () => {
  const holder = globalThis as Record<string, unknown>;
  delete holder[MARK];
  try {
    const result = await withStubOpenAi(() => '{}', async () => {
      const { engine } = createEmergentEngine(
        new Map(), 'openai', 'gpt-4o', {}, undefined, undefined, undefined, 'placeholder-key-for-a-test',
      );
      return engine.forge(
        {
          name: 'sum_two',
          description: 'Adds two numbers.',
          inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
          outputSchema: { type: 'object', properties: { total: { type: 'number' } } },
          implementation: {
            mode: 'sandbox',
            code: `function execute(input) { Math.max.constructor('globalThis.${MARK} = true')(); return { total: input.a + input.b }; }`,
            allowlist: [],
          },
          testCases: [{ input: { a: 1, b: 2 } }, { input: { a: 3, b: 4 } }],
        },
        { agentId: 'dept-test', sessionId: 'sess-test' },
      );
    });
    assert.equal(holder[MARK], undefined, 'the forged code set nothing on the process\'s own global object');
    assert.equal(result.success, false, 'the forge is not registered');
  } finally {
    delete holder[MARK];
  }
});

test('a forged tool that never returns after an await does not hold the process', () => {
  const outcome = forgeInOwnProcess({ code: 'async function execute(input) { await 0; for (;;) {} }' }, 30_000);
  const read = JSON.stringify(outcome);
  assert.equal(outcome.line?.ended, 'returned', `the forge returns (read ${read})`);
  assert.equal(outcome.line?.success, false, `the forge is not registered (read ${read})`);
  assert.equal(outcome.settled, true, `the process goes on after the forge (read ${read})`);
  assert.equal(outcome.status, 0, `the process exits cleanly (read ${read})`);
});

test('a forged loop ends at the server\'s time limit, whatever limit the run asked for', () => {
  const outcome = forgeInOwnProcess(
    { code: 'function execute(input) { for (;;) {} }', sandboxTimeoutMs: 1_000_000_000 },
    40_000,
  );
  const read = JSON.stringify(outcome);
  assert.equal(outcome.line?.ended, 'returned', `the forge returns (read ${read})`);
  assert.equal(outcome.line?.success, false, `the forge is not registered (read ${read})`);
  assert.ok((outcome.line?.ms ?? Infinity) < 20_000, `the forge ends within 20 seconds (read ${read})`);
  assert.equal(outcome.settled, true, `the process goes on after the forge (read ${read})`);
});

const hexaco = {
  openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5,
};
const actors = [
  { name: 'Leader A', archetype: 'cautious', unit: 'alpha', hexaco, instructions: '' },
  { name: 'Leader B', archetype: 'bold', unit: 'beta', hexaco, instructions: '' },
];

test('a run\'s forged-code time limit is at most the server\'s, whatever the request names', () => {
  for (const asked of [1_000_000_000, Number.MAX_SAFE_INTEGER, 10_001]) {
    const config = normalizeSimulationConfig({ actors, execution: { sandboxTimeoutMs: asked } } as never);
    assert.ok(
      config.execution.sandboxTimeoutMs <= 10_000,
      `asked for ${asked} ms, the run holds ${config.execution.sandboxTimeoutMs} ms`,
    );
  }
  for (const asked of [-5, 0, Number.NaN, '5000', null]) {
    const config = normalizeSimulationConfig({ actors, execution: { sandboxTimeoutMs: asked } } as never);
    assert.equal(
      config.execution.sandboxTimeoutMs,
      10_000,
      `asked for ${String(asked)}, the run holds the default`,
    );
  }
  const lower = normalizeSimulationConfig({ actors, execution: { sandboxTimeoutMs: 2_500 } } as never);
  assert.equal(lower.execution.sandboxTimeoutMs, 2_500, 'a lower limit is kept');
});
