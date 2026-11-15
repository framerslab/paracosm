/**
 * A compiled hook that names a built-in its context does not hold is not
 * kept.
 *
 * The hook runner's context deletes every global outside its allow-list
 * (src/engine/compiler/own-context.ts): the typed arrays, `ArrayBuffer`,
 * `Promise`, `WeakRef` and `Symbol.for` among them. A hook that reaches
 * one throws a ReferenceError or a TypeError at that call, and no caller
 * of a hook catches it: the kernel's between-turn step, the department
 * prompt, the reaction prompt and the run's fingerprint all stop there.
 *
 * The disk cache holds text an earlier build accepted, and an earlier
 * runner left those built-ins in place. These tests compile the deep-ocean
 * station (scenarios/submarine.json) with the real `compileScenario` on a
 * stand-in model and a hook cache written as an earlier build wrote it,
 * then call what was compiled the way a run does: the kernel's
 * `advanceTurn` for the progression hook and `runFingerprint` for the
 * fingerprint hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import { readCache, writeCache } from '../../../src/engine/compiler/cache.js';
import type { GenerateTextFn } from '../../../src/engine/compiler/types.js';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';
import { scenarioKeyPersonnel } from '../../../src/cli/sim-config.js';
import { runFingerprint } from '../../../src/runtime/util/generic-fingerprint.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MODEL = 'stand-in-model';

/** The deep-ocean station's scenario JSON, read afresh for each compile. */
function submarineJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'scenarios/submarine.json'), 'utf-8'));
}

/** The first line of each hook's system block, by the compiler's name for the hook. */
const HOOK_MARKS: ReadonlyArray<readonly [hook: string, mark: string]> = [
  ['progression', 'You are generating a between-turn progression hook'],
  ['prompts', 'You are generating a department prompt hook'],
  ['fingerprint', 'You are generating a timeline fingerprint hook'],
  ['politics', 'You are generating a politics hook'],
  ['reactions', 'You are generating a reaction context hook'],
];

/** What a stand-in model answers one hook's prompt with: `attempt` counts that hook's prompts from 1. */
type Answer = (attempt: number, prompt: string) => string;

/**
 * A stand-in model that answers a hook's prompt with `answers[hook]` and
 * any other prompt with text that is not a hook; `asked` records the hook
 * of every prompt it was sent ('other' for a prompt that names none).
 */
function standInModel(answers: Readonly<Record<string, Answer>>, asked: string[]): GenerateTextFn {
  const generateText = async (args: { system?: Array<{ text: string }>; prompt: string }): Promise<string> => {
    const system = (args.system ?? []).map(block => block.text).join('\n');
    const hook = HOOK_MARKS.find(([, mark]) => system.includes(mark))?.[0] ?? 'other';
    asked.push(hook);
    const attempt = asked.filter(name => name === hook).length;
    return answers[hook]?.(attempt, args.prompt) ?? 'not a hook';
  };
  return generateText as unknown as GenerateTextFn;
}

/** A working cached source for each hook a compile restores. */
const WORKING_SOURCES: Readonly<Record<string, string>> = {
  progression: '(ctx) => {}',
  director: 'Write one event a turn about the station: its hull, its crew, its air and the sea outside.',
  prompts: "(ctx) => ['Scores held: ' + Object.keys(ctx.state.metrics).join(', ')]",
  milestones: JSON.stringify({ founding: { title: 'First dive' }, legacy: { title: 'Last dive' } }),
  fingerprint: "(finalState) => ({ summary: Object.keys(finalState.metrics).length + ' scores held' })",
  politics: '(category, outcome) => null',
  reactions: "(colonist, ctx) => colonist.core.name + ' keeps watch.'",
};

/** A hook cache for the station as an earlier build wrote it, with `changed` laid over the working sources. */
function cacheWith(changed: Readonly<Record<string, string>>): { cacheDir: string; json: Record<string, unknown> } {
  const cacheDir = mkdtempSync(join(tmpdir(), 'paracosm-removed-built-ins-'));
  const json = submarineJson();
  for (const [hook, source] of Object.entries({ ...WORKING_SOURCES, ...changed })) {
    writeCache(json, hook, source, MODEL, cacheDir);
  }
  return { cacheDir, json };
}

/** A kernel on the compiled scenario, with the station's 50 people. */
function kernelFor(scenario: ScenarioPackage): SimulationKernel {
  return new SimulationKernel(200, 'Leader', scenarioKeyPersonnel(scenario), {
    startTime: scenario.setup?.defaultStartTime ?? 1,
    initialPopulation: 50,
    scenario,
  });
}

/** The message of what `call` threw, or null when it returned. */
function thrownBy(call: () => unknown): string | null {
  try {
    call();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

test('a cached fingerprint hook that makes a typed array is generated again at restore, and the run gets its fingerprint', async () => {
  // Kept by a runner whose context still held the typed arrays.
  const { cacheDir, json } = cacheWith({
    fingerprint: "(finalState) => ({ summary: new Float64Array([1]).join(',') })",
  });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ fingerprint: () => "(finalState) => ({ summary: 'steady' })" }, asked),
    }) as ScenarioPackage;

    const kernel = kernelFor(scenario);
    const leader = (scenario.presets?.[0] as { leaders?: unknown[] } | undefined)?.leaders?.[0];
    let fingerprint: Record<string, string> = {};
    // The end of a run calls the hook through runFingerprint (orchestrator/index.ts).
    const thrown = thrownBy(() => {
      fingerprint = runFingerprint(
        scenario.hooks.fingerprintHook,
        kernel.getState(),
        [{ turn: 1, time: scenario.setup?.defaultStartTime ?? 1, outcome: 'conservative_success' }],
        leader as Parameters<typeof runFingerprint>[3],
        [],
        8,
      );
    });
    assert.equal(thrown, null, 'the run\'s fingerprint is computed with the compiled fingerprint hook');
    assert.equal(fingerprint.summary, 'steady', 'the fingerprint holds the new hook\'s summary');
    assert.deepEqual(asked, ['fingerprint'], 'the model was asked for that hook only; the other six came from the cache');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached progression hook that allocates a typed array is generated again at restore, and the turn advances', async () => {
  const { cacheDir, json } = cacheWith({
    progression: '(ctx) => { const doses = new Float64Array(ctx.agents.length); '
      + 'for (let i = 0; i < ctx.agents.length; i++) { doses[i] = ctx.agents[i].health.alive ? 1 : 0; } }',
  });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({
        progression: () => '(ctx) => { for (const c of ctx.agents) { if (!c.health.alive) continue; '
          + 'c.health.psychScore = Math.max(0, Math.min(1, c.health.psychScore - 0.01 * (ctx.yearsDelta ?? ctx.timeDelta))); } }',
      }, asked),
    }) as ScenarioPackage;

    const kernel = kernelFor(scenario);
    const start = scenario.setup?.defaultStartTime ?? 1;
    // The kernel calls the hook once a step of the between-turn advance (progression.ts).
    const thrown = thrownBy(() => kernel.advanceTurn(1, start + (scenario.setup?.defaultTimePerTurn ?? 1), scenario.hooks.progressionHook));
    assert.equal(thrown, null, 'the turn advances with the compiled progression hook');
    assert.deepEqual(asked, ['progression'], 'the model was asked for that hook only; the other six came from the cache');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a fresh hook that names such a built-in on a path its smoke test does not take is asked for again, so the cache never holds one', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'paracosm-removed-built-ins-'));
  try {
    const json = submarineJson();
    const asked: string[] = [];
    // The smoke test's state holds a handful of scores, so the first
    // answer's typed array is never reached there.
    const first = "(finalState) => ({ summary: Object.keys(finalState.metrics).length > 1000 ? new Float64Array([1]).join(',') : 'steady' })";
    const second = "(finalState) => ({ summary: Object.keys(finalState.metrics).length > 1000 ? [1].join(',') : 'steady' })";
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({
        ...Object.fromEntries(HOOK_MARKS.map(([hook]) => [hook, () => WORKING_SOURCES[hook]])),
        fingerprint: (attempt) => (attempt === 1 ? first : second),
      }, asked),
    });
    assert.equal(
      asked.filter(hook => hook === 'fingerprint').length,
      2,
      'the model is asked for the fingerprint hook a second time, with the reason the first was not kept',
    );
    assert.equal(readCache(json, 'fingerprint', MODEL, cacheDir), second, 'the cache holds the second answer');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that holds such a name in a string or a comment only is restored with no model call', async () => {
  // The words are text the hook returns, and a note: the hook reaches no built-in.
  const prompts = [
    '(ctx) => [',
    '  // no WeakRef and no Proxy here',
    "  'Reflect the hull readings in every report.',",
    '  `Promise nothing the station cannot hold: ${Object.keys(ctx.state.metrics).length} scores.`, /* nor a DataView */',
    ']',
  ].join('\n');
  const { cacheDir, json } = cacheWith({ prompts });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({}, asked),
    }) as ScenarioPackage;
    assert.deepEqual(asked, [], 'every hook came from the cache');
    const lines = scenario.hooks.departmentPromptHook?.({ state: kernelFor(scenario).getState() } as never) ?? [];
    assert.equal(lines[0], 'Reflect the hull readings in every report.', 'the restored hook answers with its own text');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that reads a removed member of a kept built-in is generated again at restore', async () => {
  const { cacheDir, json } = cacheWith({
    reactions: "(colonist, ctx) => String(Symbol.for(colonist.core.name).description) + ' keeps watch.'",
  });
  try {
    const asked: string[] = [];
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ reactions: () => "(colonist, ctx) => colonist.core.name + ' keeps watch.'" }, asked),
    });
    assert.deepEqual(asked, ['reactions'], 'the model was asked for that hook only');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that holds such a name in a pattern it tests after an if is restored with no model call', async () => {
  // The name is the text of a pattern the hook tests the department's
  // name against. After the parenthesis of an `if`, a slash opens a
  // pattern and is not a division: the hook reaches no built-in.
  const prompts = [
    '(ctx) => {',
    '  const lines = [];',
    "  if (ctx.department) /Promise/.test(ctx.department) && lines.push('matched');",
    "  lines.push(Object.keys(ctx.state.metrics).length + ' scores held');",
    '  return lines;',
    '}',
  ].join('\n');
  const { cacheDir, json } = cacheWith({ prompts });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({}, asked),
    }) as ScenarioPackage;
    assert.deepEqual(asked, [], 'every hook came from the cache');
    const lines = scenario.hooks.departmentPromptHook?.({
      department: 'Promise keepers',
      state: kernelFor(scenario).getState(),
    } as never) ?? [];
    assert.equal(lines[0], 'matched', 'the restored hook tests the department against its own pattern');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that divides after a parenthesis and makes a typed array on the same line is generated again at restore', async () => {
  // After the parenthesis of an expression a slash divides. Read as the
  // start of a pattern, it would hide the rest of the line up to the
  // next slash, and the typed array with it.
  const { cacheDir, json } = cacheWith({
    fingerprint: '(finalState) => ({ summary: String((Object.keys(finalState.metrics).length) / 2 '
      + '+ new Float64Array([1]).length / 1) })',
  });
  try {
    const asked: string[] = [];
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ fingerprint: () => "(finalState) => ({ summary: 'steady' })" }, asked),
    });
    assert.deepEqual(asked, ['fingerprint'], 'the model was asked for that hook only');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that reads a removed member written in brackets is generated again at restore', async () => {
  // `Symbol['for']` is the member `Symbol.for` is.
  const { cacheDir, json } = cacheWith({
    reactions: "(colonist, ctx) => String(Symbol['for'](colonist.core.name).description) + ' keeps watch.'",
  });
  try {
    const asked: string[] = [];
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ reactions: () => "(colonist, ctx) => colonist.core.name + ' keeps watch.'" }, asked),
    });
    assert.deepEqual(asked, ['reactions'], 'the model was asked for that hook only');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that tests a pattern in the second ${ } of a template is restored with no model call', async () => {
  // Each `${ }` of a template holds an expression of its own, so a slash
  // that opens the second one opens a pattern, whatever the first one
  // ended with. The name is the pattern's text: the hook reaches no built-in.
  const prompts = '(ctx) => [`${ctx.department} ${/Promise/.test(ctx.department)}`]';
  const { cacheDir, json } = cacheWith({ prompts });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({}, asked),
    }) as ScenarioPackage;
    assert.deepEqual(asked, [], 'every hook came from the cache');
    const lines = scenario.hooks.departmentPromptHook?.({
      department: 'Promise keepers',
      state: kernelFor(scenario).getState(),
    } as never) ?? [];
    assert.equal(lines[0], 'Promise keepers true', 'the restored hook tests the department against its own pattern');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that divides a variable named of and makes a typed array on the same line is generated again at restore', async () => {
  // `of` is a keyword in the head of a for and a name anywhere else. Read
  // as the keyword, it would make the slash after it open a pattern,
  // which hides the rest of the line up to the next slash.
  const { cacheDir, json } = cacheWith({
    fingerprint: '(finalState) => { const of = 2; '
      + 'return { summary: String(of / 2 + new Float64Array([1]).length / 1) }; }',
  });
  try {
    const asked: string[] = [];
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ fingerprint: () => "(finalState) => ({ summary: 'steady' })" }, asked),
    });
    assert.deepEqual(asked, ['fingerprint'], 'the model was asked for that hook only');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that yields a pattern from a generator is restored with no model call', async () => {
  // After `yield` a slash opens a pattern. The name is the pattern's
  // text: the hook reaches no built-in.
  const prompts = '(ctx) => [...(function* () { yield /Promise/; })()].map(String)';
  const { cacheDir, json } = cacheWith({ prompts });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({}, asked),
    }) as ScenarioPackage;
    assert.deepEqual(asked, [], 'every hook came from the cache');
    const lines = scenario.hooks.departmentPromptHook?.({ state: kernelFor(scenario).getState() } as never) ?? [];
    assert.equal(lines[0], '/Promise/', 'the restored hook answers with the pattern it yields');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that divides a variable named of in the head of a for is generated again at restore', async () => {
  // In the head of a for, `of` is the keyword only where it follows the
  // name the loop binds. In a condition it is a name, and the slash
  // after it divides: the typed array on the same line is read.
  const { cacheDir, json } = cacheWith({
    fingerprint: '(finalState) => { const of = 2; '
      + 'for (; of / 2 + new Float64Array([1]).length / 1; ) { break; } '
      + "return { summary: 'steady' }; }",
  });
  try {
    const asked: string[] = [];
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ fingerprint: () => "(finalState) => ({ summary: 'steady' })" }, asked),
    });
    assert.deepEqual(asked, ['fingerprint'], 'the model was asked for that hook only');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that loops over the matches of a pattern written after of is restored with no model call', async () => {
  // After the `of` of a for-of a slash opens a pattern. The name is the
  // pattern's text: the hook reaches no built-in.
  const prompts = [
    '(ctx) => {',
    '  const lines = [];',
    "  for (const found of /Promise/.exec(String(ctx.department)) ?? []) lines.push(found);",
    '  return lines;',
    '}',
  ].join('\n');
  const { cacheDir, json } = cacheWith({ prompts });
  try {
    const asked: string[] = [];
    const scenario = await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({}, asked),
    }) as ScenarioPackage;
    assert.deepEqual(asked, [], 'every hook came from the cache');
    const lines = scenario.hooks.departmentPromptHook?.({
      department: 'Promise keepers',
      state: kernelFor(scenario).getState(),
    } as never) ?? [];
    assert.deepEqual(lines, ['Promise'], 'the restored hook lists what its own pattern found');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('a cached hook that divides a counter it has just raised and makes a typed array on the same line is generated again at restore', async () => {
  // After `n++` a slash divides. Read as the start of a pattern, it
  // would hide the rest of the line up to the next slash.
  const { cacheDir, json } = cacheWith({
    fingerprint: '(finalState) => { let n = 1; '
      + 'return { summary: String(n++ / 2 + new Float64Array([1]).length / 1) }; }',
  });
  try {
    const asked: string[] = [];
    await compileScenario(json, {
      cache: true,
      cacheDir,
      model: MODEL,
      generateText: standInModel({ fingerprint: () => "(finalState) => ({ summary: 'steady' })" }, asked),
    });
    assert.deepEqual(asked, ['fingerprint'], 'the model was asked for that hook only');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
