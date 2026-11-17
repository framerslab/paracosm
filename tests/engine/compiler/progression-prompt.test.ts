/**
 * A progression hook that follows its prompt is kept.
 *
 * The hook runner hands a progression hook its `ctx` as data: JSON text
 * the hook's own context parses (src/engine/compiler/sandbox-runner.ts),
 * so `ctx` carries no function. A prompt that tells the model to call one
 * asks for a hook that throws in its smoke test, and the compile then
 * asks again or keeps the no-op fallback.
 *
 * The stand-in model here does what the prompt says: it reads the system
 * block the real `generateProgressionHook` sends for the deep-ocean
 * station (scenarios/submarine.json) and writes a hook that calls every
 * function the block names on `ctx`. The hook is then run the way a run
 * runs it, through the kernel's `advanceTurn`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProgressionHook } from '../../../src/engine/compiler/generate-progression.js';
import { createCompilerTelemetry } from '../../../src/engine/compiler/telemetry.js';
import type { GenerateTextFn } from '../../../src/engine/compiler/types.js';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The deep-ocean station's scenario JSON. */
function submarineJson(): Record<string, any> {
  return JSON.parse(readFileSync(join(ROOT, 'scenarios/submarine.json'), 'utf-8'));
}

/** Every function the text tells a hook to call on `ctx`, as the path after `ctx`: `.rng.chance` for `ctx.rng.chance(p)`. */
function functionsNamedOnCtx(text: string): string[] {
  return [...new Set([...text.matchAll(/\bctx((?:\.[A-Za-z_$][\w$]*)+)\(/g)].map(match => match[1]))];
}

test('a progression hook that calls what its prompt names on ctx passes its smoke test on the first attempt', async () => {
  const systems: string[] = [];
  const written: string[] = [];
  const generateText = (async (args: { system?: Array<{ text: string }>; prompt: string }): Promise<string> => {
    const system = (args.system ?? []).map(block => block.text).join('\n');
    systems.push(system);
    const calls = functionsNamedOnCtx(system).map(path => `ctx${path}(0.5);`).join(' ');
    const hook = `(ctx) => { for (const c of ctx.agents) { if (!c.health.alive) continue; ${calls} `
      + 'c.health.psychScore = Math.max(0, Math.min(1, c.health.psychScore - 0.01 * (ctx.yearsDelta ?? ctx.timeDelta))); } }';
    written.push(hook);
    return hook;
  }) as unknown as GenerateTextFn;

  const telemetry = createCompilerTelemetry();
  const result = await generateProgressionHook(submarineJson(), generateText, { telemetry });
  const read = `the model was asked ${systems.length} time(s); it wrote ${written[0]}; telemetry ${JSON.stringify(telemetry.snapshot())}`;
  assert.equal(result.fromFallback, false, `the hook the model wrote is kept, not the no-op fallback (${read})`);
  assert.equal(result.attempts, 1, `the first hook passes its smoke test (${read})`);

  // A run calls the hook from the kernel's between-turn step, with the
  // turn's own ctx. A second kernel on the same seed advances with no
  // hook, so what differs between the two is what the hook wrote.
  const withHook = new SimulationKernel(200, 'Leader', [], { startTime: 2038, initialPopulation: 50 });
  const without = new SimulationKernel(200, 'Leader', [], { startTime: 2038, initialPopulation: 50 });
  assert.doesNotThrow(() => withHook.advanceTurn(1, 2039, result.hook), 'the turn advances with the hook');
  without.advanceTurn(1, 2039);
  const plain = new Map(without.getState().agents.map(a => [a.core.id, a]));
  const lowered = withHook.getState().agents.filter((a) => {
    const twin = plain.get(a.core.id);
    return a.health.alive && twin !== undefined && twin.health.alive && a.health.psychScore < twin.health.psychScore;
  });
  assert.ok(lowered.length > 0, 'the hook lowered a psych score of the run, against the same turn with no hook');
});

test('the progression prompt names no random number function on ctx, and says what to write in its place', async () => {
  let system = '';
  const generateText = (async (args: { system?: Array<{ text: string }> }): Promise<string> => {
    system = (args.system ?? []).map(block => block.text).join('\n');
    return '(ctx) => {}';
  }) as unknown as GenerateTextFn;
  await generateProgressionHook(submarineJson(), generateText);

  assert.deepEqual(functionsNamedOnCtx(system), [], 'the prompt tells the hook to call no function on ctx');
  assert.doesNotMatch(system, /ctx\.rng/, 'the prompt lists no ctx.rng, which arrives with no function');
  assert.match(system, /Math\.random/, 'the prompt still rules out Math.random, which two runs on one seed would not share');
});
