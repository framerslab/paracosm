/**
 * Code a department forges at run time runs in an executor that reports it
 * isolates, with a memory cap it enforces: a tool that allocates past the
 * cap ends its call, its forge is not registered, and the run goes on.
 *
 * The engine is the one `createEmergentEngine` builds with the execution
 * settings `normalizeSimulationConfig` gives a run's setup, as a run builds
 * it. The setup's leaders are the default preset of scenarios/mars.json, and
 * it asks for more memory and time than the server allows. The forges that
 * allocate run in a process of their own
 * (tests/runtime/helpers/forge-sequence-probe.ts), so the test run itself
 * never holds what they allocate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeSimulationConfig } from '../../src/cli/sim-config.js';
import { createEmergentEngine } from '../../src/runtime/orchestrator/emergent-setup.js';
import { engineExecutor } from './helpers/engine-executor.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROBE = fileURLToPath(new URL('./helpers/forge-sequence-probe.ts', import.meta.url));

interface Leader { name: string; archetype: string; hexaco: Record<string, number>; instructions: string }
const mars = JSON.parse(readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf-8')) as {
  presets: Array<{ id: string; leaders: Leader[] }>;
};
const leaders = mars.presets.find(preset => preset.id === 'default')?.leaders ?? [];

/** A run's setup as a request carries it, asking for 2,048 MB and 15 seconds a call. */
const SETUP = {
  actors: leaders.map((leader, index) => ({ ...leader, unit: `Colony ${index + 1}` })),
  execution: { sandboxTimeoutMs: 15_000, sandboxMemoryMB: 2048 },
};

/**
 * A tool whose one test case builds 24 arrays of 1,048,576 numbers: at
 * least 192 MiB at 8 bytes a number, above the 128 MB a call may hold.
 */
const ALLOCATES_PAST_THE_CAP = {
  name: 'colony_rows',
  description: 'Builds one row of numbers for each row asked for.',
  inputSchema: {
    type: 'object',
    properties: { rows: { type: 'number' }, width: { type: 'number' } },
    required: ['rows', 'width'],
  },
  outputSchema: { type: 'object', properties: { rows: { type: 'number' } } },
  implementation: {
    mode: 'sandbox',
    code: 'function execute(input) { const rows = []; for (let r = 0; r < input.rows; r += 1) { rows.push(new Array(input.width).fill(r)); } return { rows: rows.length }; }',
    allowlist: [],
  },
  testCases: [{ input: { rows: 24, width: 1048576 } }],
};

/** A tool that computes within every limit. */
const SUMS = {
  name: 'sum_two',
  description: 'Adds two numbers.',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  outputSchema: { type: 'object', properties: { total: { type: 'number' } } },
  implementation: {
    mode: 'sandbox',
    code: 'function execute(input) { return { total: input.a + input.b }; }',
    allowlist: [],
  },
  testCases: [{ input: { a: 1, b: 2 } }, { input: { a: 3, b: 4 } }],
};

test('the engine a run builds runs forged code in an executor that reports it isolates', () => {
  const config = normalizeSimulationConfig(SETUP as never);
  const { engine } = createEmergentEngine(
    new Map(), 'openai', 'gpt-4o', config.execution, undefined, undefined, undefined, 'placeholder-key-for-a-test',
  );
  const executor = engineExecutor(engine);
  assert.equal(
    executor.isolates,
    true,
    `the engine's executor reports it isolates (read ${executor.name}, isolates: ${String(executor.isolates)})`,
  );
  assert.match(executor.name, /quickjs/i, `the executor is the QuickJS one (read ${executor.name})`);
});

test('a forged tool that allocates past the memory cap fails its forge, whatever memory the run asked for, and the next forge in the same process is registered', () => {
  const out = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--import', './scripts/test-css-stub.mjs', PROBE, JSON.stringify({ setup: SETUP, forges: [ALLOCATES_PAST_THE_CAP, SUMS] })],
    { cwd: ROOT, encoding: 'utf8', timeout: 90_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
  );
  const lines = (out.stdout ?? '').split('\n').filter(Boolean);
  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line) as { ended?: string; success?: boolean; statuses?: string[] };
    } catch {
      return null;
    }
  });
  const [allocating, summing] = parsed;
  const read = JSON.stringify({ lines, status: out.status, signal: out.signal, stderr: (out.stderr ?? '').slice(-2000) });

  assert.equal(allocating?.ended, 'returned', `the first forge returns (read ${read})`);
  assert.deepEqual(allocating?.statuses, ['memory_exceeded'], `its test case ends out of memory (read ${read})`);
  assert.equal(allocating?.success, false, `the forge that allocates past the cap is not registered (read ${read})`);
  assert.equal(summing?.ended, 'returned', `the next forge returns (read ${read})`);
  assert.deepEqual(summing?.statuses, ['ok', 'ok'], `its test cases run (read ${read})`);
  assert.equal(summing?.success, true, `the next forge in the same process is registered (read ${read})`);
  assert.equal(lines.includes('settled'), true, `the process goes on after both forges (read ${read})`);
  assert.equal(out.status, 0, `the process exits cleanly (read ${read})`);
});

test('the executor refuses a call that carries a host function, before any code runs', async () => {
  const config = normalizeSimulationConfig(SETUP as never);
  const { engine } = createEmergentEngine(
    new Map(), 'openai', 'gpt-4o', config.execution, undefined, undefined, undefined, 'placeholder-key-for-a-test',
  );
  const executor = engineExecutor(engine);
  // paracosm's ceiling grants no capability, so the engine never hands the
  // executor a function; a call made with one directly is refused.
  const answer = await executor.run({
    code: 'function execute(input) { return { ok: true }; }',
    input: {},
    globals: { fetch: () => undefined },
    timeoutMs: 1_000,
    memoryMB: 16,
  });
  assert.equal(answer.status, 'error', `the call is refused (read ${JSON.stringify(answer)})`);
  assert.equal(answer.memoryUsedBytes, 0, `no instance was made for it (read ${JSON.stringify(answer)})`);
});
