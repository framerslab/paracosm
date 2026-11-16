#!/usr/bin/env node
/**
 * Times the executor forged code runs in and reads the process's memory
 * around its calls, printing the figures to the job log.
 *
 * Run with `node --expose-gc scripts/measure-forged-code-executor.mjs`.
 * After `npm run build` it measures paracosm's executor as the server runs
 * it (dist/runtime/orchestrator/forged-code-executor.js). Without a build,
 * as in CI's server-install job, which installs the production dependencies
 * only, it measures AgentOS's `QuickJSExecutor` at paracosm's limits, which
 * also shows that the production install loads QuickJS.
 *
 * It prints:
 * - the first load: importing QuickJS and compiling its WebAssembly, once a
 *   process;
 * - creating an executor: {@link CREATES} executors made with
 *   `QuickJSExecutor.create()`, each compiling the WebAssembly again;
 * - a call: {@link CALLS} calls, one after another, of one small forged tool
 *   at a 10-second and 128 MB limit;
 * - memory: the process's resident set, V8 heap and memory outside the heap
 *   before the calls, after every quarter of them and at the end, each read
 *   after a forced collection.
 *
 * Times are the median and the 95th percentile, in milliseconds. It exits 1
 * when a call does not return the tool's result; the figures set no pass bar.
 */
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { QuickJSExecutor } from '@framers/agentos';

const CREATES = 50;
const CALLS = 200;
const TIMEOUT_MS = 10_000;
const MEMORY_MB = 128;

/** A small forged tool, of the kind a department writes. */
const CODE = `function execute(input) {
  const scores = input.readings.map((r) => Math.round((r.value / input.scale) * 100) / 100);
  const total = scores.reduce((sum, s) => sum + s, 0);
  return { score: Math.round((total / scores.length) * 100) / 100, highest: Math.max(...scores) };
}`;
const INPUT = { scale: 50, readings: [{ value: 12 }, { value: 40 }, { value: 33 }, { value: 7 }] };
const EXPECTED = JSON.stringify({ score: 0.46, highest: 0.8 });

const built = new URL('../dist/runtime/orchestrator/forged-code-executor.js', import.meta.url);

function collect() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summary(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return `median ${percentile(sorted, 50).toFixed(2)} ms, p95 ${percentile(sorted, 95).toFixed(2)} ms, min ${sorted[0].toFixed(2)} ms, max ${sorted.at(-1).toFixed(2)} ms (n=${sorted.length})`;
}

const MIB = 1024 * 1024;

function memory() {
  collect();
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers };
}

function showMemory(label, m) {
  return `${label}: rss ${(m.rss / MIB).toFixed(1)} MiB, heapUsed ${(m.heapUsed / MIB).toFixed(1)} MiB, external ${(m.external / MIB).toFixed(1)} MiB, arrayBuffers ${(m.arrayBuffers / MIB).toFixed(1)} MiB`;
}

function delta(from, to) {
  const d = (key) => `${((to[key] - from[key]) / MIB >= 0 ? '+' : '')}${((to[key] - from[key]) / MIB).toFixed(1)} MiB`;
  return `rss ${d('rss')}, heapUsed ${d('heapUsed')}, external ${d('external')}, arrayBuffers ${d('arrayBuffers')}`;
}

async function main() {
  const lines = [];
  const say = (line) => {
    lines.push(line);
    process.stdout.write(`${line}\n`);
  };
  say(`Forged-code executor measurement: Node ${process.version}, ${process.platform} ${process.arch}, gc ${typeof globalThis.gc === 'function' ? 'forced' : 'not exposed'}`);

  let executor;
  let measured;
  const loadStarted = performance.now();
  if (existsSync(built)) {
    const { QuickJSForgedCodeExecutor } = await import(built.href);
    executor = new QuickJSForgedCodeExecutor();
    await executor.ready();
    measured = `paracosm's executor (${executor.name}, isolates: ${executor.isolates}) from dist/`;
  } else {
    executor = await QuickJSExecutor.create();
    measured = `AgentOS's QuickJSExecutor (${executor.name}, isolates: ${executor.isolates}) from the installed package`;
  }
  say(`Measured: ${measured}`);
  say(`First load (import QuickJS, compile its WebAssembly): ${(performance.now() - loadStarted).toFixed(2)} ms`);

  const creates = [];
  for (let i = 0; i < CREATES; i += 1) {
    const started = performance.now();
    await QuickJSExecutor.create();
    creates.push(performance.now() - started);
  }
  say(`Creating an executor (QuickJSExecutor.create(), WebAssembly compiled each time): ${summary(creates)}`);

  const request = { code: CODE, input: INPUT, globals: {}, timeoutMs: TIMEOUT_MS, memoryMB: MEMORY_MB };
  // One call before the measured ones, so the first measured call is not the first a process makes.
  await executor.run(request);

  const before = memory();
  say(showMemory(`Memory before ${CALLS} calls`, before));
  const calls = [];
  for (let i = 1; i <= CALLS; i += 1) {
    const started = performance.now();
    const answer = await executor.run(request);
    calls.push(performance.now() - started);
    if (answer.status !== 'ok' || JSON.stringify(answer.output) !== EXPECTED) {
      say(`Call ${i} did not return the tool's result: ${JSON.stringify(answer)}`);
      process.exitCode = 1;
      return;
    }
    if (i % (CALLS / 4) === 0 && i < CALLS) {
      say(showMemory(`Memory after ${i} calls`, memory()));
    }
  }
  const after = memory();
  say(showMemory(`Memory after ${CALLS} calls`, after));
  say(`A call of one small forged tool (${TIMEOUT_MS} ms, ${MEMORY_MB} MB): ${summary(calls)}`);
  say(`Memory delta across ${CALLS} calls, after a forced collection: ${delta(before, after)}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Forged-code executor\n\n${lines.map((line) => `- ${line}`).join('\n')}\n`);
  }
}

main().catch((err) => {
  process.stdout.write(`The measurement failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
