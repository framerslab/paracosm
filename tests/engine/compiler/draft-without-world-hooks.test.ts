/**
 * The README's own example draft declares two metrics and no `world`.
 * `compileScenario` gives it five empty bags, and a run of it holds the
 * head count and morale. The fingerprint and department prompt hooks are
 * each tried on a state built from the draft before they are kept, so
 * those two hooks must be tried on that state: a working hook is kept on
 * its first attempt, and none of the two falls back.
 *
 * No model is called. The stand-in answers each call by the first line of
 * its system block: a working fingerprint hook, a working department
 * prompt hook, and text that is no hook for every other call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileScenario } from '../../../src/engine/compiler/index.js';
import { createCompilerTelemetry } from '../../../src/engine/compiler/telemetry.js';
import type { GenerateTextFn } from '../../../src/engine/compiler/types.js';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import type { ActorConfig, ScenarioPackage } from '../../../src/engine/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** The first fenced `json` block after the README's sentence on the authoring contract. */
function readmeExampleDraft(): Record<string, unknown> {
  const lines = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8').split('\n');
  const contract = lines.findIndex(line => line.startsWith('The authoring contract is JSON'));
  assert.ok(contract >= 0, 'README.md has no line that begins "The authoring contract is JSON"');
  const open = lines.findIndex((line, i) => i > contract && line.trim() === '```json');
  assert.ok(open > contract, 'README.md has no ```json block after the authoring contract sentence');
  const close = lines.findIndex((line, i) => i > open && line.trim() === '```');
  assert.ok(close > open, 'the README example draft has no closing fence');
  const text = lines.slice(open + 1, close).join('\n');
  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    assert.fail(`the README example draft changed shape: it no longer parses as JSON (${(err as Error).message})`);
  }
  assert.ok(Array.isArray(draft.metrics), `the README example draft changed shape: it declares no metrics (keys ${Object.keys(draft).join(', ')})`);
  assert.ok(!('world' in draft), 'the README example draft changed shape: it now declares a world');
  return draft;
}

/** Reads morale and counts the values the state holds; throws when the state holds no morale. */
const FINGERPRINT_SOURCE = `(finalState, outcomeLog, leader, toolRegs, maxTurns) => {
  const morale = finalState.metrics.morale;
  if (typeof morale !== 'number') throw new Error('the state holds no morale');
  const values = Object.keys(finalState.metrics).length;
  const mood = morale >= 0.5 ? 'steady' : 'strained';
  return { mood, summary: mood + ' over ' + values + ' values' };
}`;

/** Two lines read from the head count and morale; throws when the state holds either not. */
const PROMPTS_SOURCE = `(ctx) => {
  const metrics = ctx.state.metrics;
  if (typeof metrics.population !== 'number' || typeof metrics.morale !== 'number') {
    throw new Error('the state holds no head count or no morale');
  }
  return ['Head count: ' + metrics.population, 'Morale: ' + Math.round(metrics.morale * 100) + '%'];
}`;

const standIn: GenerateTextFn = async (request) => {
  const system = typeof request === 'string'
    ? request
    : (request.system ?? []).map(block => block.text).join('\n');
  const firstLine = system.split('\n', 1)[0] ?? '';
  if (firstLine.startsWith('You are generating a timeline fingerprint hook')) return FINGERPRINT_SOURCE;
  if (firstLine.startsWith('You are generating a department prompt hook')) return PROMPTS_SOURCE;
  return 'not a hook';
};

async function compileReadmeDraft() {
  const telemetry = createCompilerTelemetry();
  const scenario = await compileScenario(readmeExampleDraft(), {
    cache: false,
    generateText: standIn,
    telemetry,
  });
  return { scenario, snapshot: telemetry.snapshot() };
}

let compiled: ReturnType<typeof compileReadmeDraft> | undefined;
const compileOnce = () => (compiled ??= compileReadmeDraft());

/** The state a run of the compiled package starts with, from the package's own setup. */
function runState(scenario: ScenarioPackage) {
  const kernel = new SimulationKernel(scenario.setup.defaultSeed ?? 42, 'Leader', [], {
    startTime: scenario.setup.defaultStartTime,
    initialPopulation: scenario.setup.defaultPopulation,
    scenario,
  });
  return kernel.getState();
}

const leader = {
  name: 'Leader',
  archetype: 'test',
  hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
} as unknown as ActorConfig;

test('a run of the README example draft holds the head count and morale and no other value', async () => {
  const { scenario } = await compileOnce();
  const state = runState(scenario);
  assert.deepEqual(
    Object.keys(state.metrics).sort(),
    ['morale', 'population'],
    `a run of the compiled README draft holds the metrics ${JSON.stringify(state.metrics)}`,
  );
});

test('the README example draft, which declares no world, keeps its generated fingerprint and department prompt hooks on the first attempt', async () => {
  const { snapshot } = await compileOnce();
  const reasons = snapshot.fallbacks
    .filter(f => f.hookName === 'fingerprint' || f.hookName === 'prompts')
    .map(f => `${f.hookName} after ${f.attempts} attempts: ${f.reason}`);
  for (const hook of ['fingerprint', 'prompts']) {
    const bucket = snapshot.schemaRetries[`compile:${hook}`];
    assert.deepEqual(
      bucket,
      { calls: 1, attempts: 1, fallbacks: 0 },
      `compile:${hook} read ${JSON.stringify(bucket)}; fallbacks of the two hooks: ${reasons.join('; ') || 'none'}`,
    );
  }
  assert.deepEqual(reasons, [], `the compile fell back for: ${reasons.join('; ')}`);
});

test('the kept hooks read the head count and morale of a run of the README example draft', async () => {
  const { scenario } = await compileOnce();
  const state = runState(scenario);
  const fingerprint = scenario.hooks.fingerprintHook?.(state, [], leader, {}, 8);
  assert.deepEqual(
    fingerprint,
    { mood: 'steady', summary: 'steady over 2 values' },
    `fingerprintHook on a run of the compiled README draft returned ${JSON.stringify(fingerprint)}`,
  );
  const lines = scenario.hooks.departmentPromptHook?.({
    department: 'life-support',
    state,
    scenario,
    researchPacket: { canonicalFacts: [], counterpoints: [], departmentNotes: {} },
  });
  assert.deepEqual(
    lines,
    [`Head count: ${state.metrics.population}`, `Morale: ${Math.round(state.metrics.morale * 100)}%`],
    `departmentPromptHook on a run of the compiled README draft returned ${JSON.stringify(lines)}`,
  );
});
