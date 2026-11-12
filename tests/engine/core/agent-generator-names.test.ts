/**
 * generateInitialPopulation gives every person a name of their own and
 * returns, however many people it is asked for. Its first and last name
 * lists hold 50 names each, 2500 pairs; past them a name takes a number.
 *
 * The call runs in a child process with a deadline, so a call that never
 * returns fails the test instead of holding the test run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('../../../src/engine/core/agent-generator.ts', import.meta.url));

function countNames(population: number): { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string } {
  const code = `
    const { generateInitialPopulation } = await import(${JSON.stringify(generator)});
    const people = generateInitialPopulation(1, 0, [], ${population});
    process.stdout.write(JSON.stringify({ count: people.length, distinct: new Set(people.map(p => p.core.name)).size }));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

test('generateInitialPopulation(1, 0, [], 3000) returns 3000 people with distinct names', () => {
  const run = countNames(3000);
  assert.equal(run.signal, null, `the call returned within 30 s (signal ${run.signal}; stderr ${run.stderr.slice(0, 500)})`);
  assert.equal(run.status, 0, run.stderr.slice(0, 500));
  assert.deepEqual(JSON.parse(run.stdout), { count: 3000, distinct: 3000 });
});
