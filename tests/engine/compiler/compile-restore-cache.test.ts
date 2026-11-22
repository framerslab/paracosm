/**
 * A restore (`CompileOptions.restore`) reads a scenario's hooks back from
 * the disk cache with no model call, and generates them again, as a compile
 * does, when the cache's manifest names hook files that are gone.
 *
 * Compiles the deep-ocean station (scenarios/submarine.json) with a stub
 * model that answers each code hook with a working function, the director
 * and the milestones with `{}` (which leaves those two on the compiler's
 * fallbacks), and counts its calls. The cache folder is a temporary one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import type { GenerateTextFn } from '../../../src/engine/compiler/types.js';
import type { ScenarioHooks } from '../../../src/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const submarine = JSON.parse(
  readFileSync(resolve(here, '../../../scenarios/submarine.json'), 'utf-8'),
) as Record<string, unknown>;

/** A working function for each code hook, by the opening of its system block. */
const WORKING_HOOKS: ReadonlyArray<readonly [mark: string, source: string]> = [
  ['You are generating a between-turn progression hook', '(ctx) => {}'],
  ['You are generating a department prompt hook', "(ctx) => ['Scores held: ' + Object.keys(ctx.state.metrics).join(', ')]"],
  [
    'You are generating a timeline fingerprint hook',
    "(finalState) => { const held = Object.keys(finalState.metrics).length; const breadth = held > 2 ? 'broad' : 'narrow'; return { breadth, summary: breadth + ' (' + held + ' scores held)' }; }",
  ],
  ['You are generating a politics hook', '(category, outcome) => null'],
  ['You are generating a reaction context hook', "(colonist, ctx) => 'Steady after the last turn.'"],
];

function stubModel(): { calls: () => number; generateText: GenerateTextFn } {
  let calls = 0;
  const generateText = async (
    args: string | { system?: Array<{ text: string }>; prompt: string },
  ): Promise<string> => {
    calls += 1;
    const text = typeof args === 'string'
      ? args
      : [...(args.system ?? []).map(block => block.text), args.prompt].join('\n');
    return WORKING_HOOKS.find(([mark]) => text.includes(mark))?.[1] ?? '{}';
  };
  return { calls: () => calls, generateText: generateText as unknown as GenerateTextFn };
}

/** What the department prompt hook says for a state holding two scores. */
function departmentLines(hooks: ScenarioHooks): string {
  return JSON.stringify(hooks.departmentPromptHook?.({
    department: 'any',
    state: { agents: [], metrics: { pressure: 1, oxygen: 2 }, politics: {}, metadata: {} },
    scenario: {},
    researchPacket: { canonicalFacts: [], counterpoints: [], departmentNotes: {} },
  } as never));
}
const WORKING_LINES = JSON.stringify(['Scores held: pressure, oxygen']);

test('a restore reads the hooks back from the cache with no model call, and generates them again when the cached hook files are gone', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'paracosm-compile-restore-'));
  try {
    const first = stubModel();
    await compileScenario(submarine, { cache: true, cacheDir, generateText: first.generateText });
    assert.ok(first.calls() > 0, 'the first compile asked the model for the hooks');

    const whole = stubModel();
    const restored = await compileScenario(submarine, { cache: true, cacheDir, generateText: whole.generateText, restore: {} });
    assert.equal(whole.calls(), 0, 'a restore from a whole cache calls no model');
    assert.equal(departmentLines(restored.hooks), WORKING_LINES, 'the restore holds the cached department prompt');

    // The manifest stays and names the hooks; every hook file it names goes.
    const [folder] = readdirSync(cacheDir);
    const removed = readdirSync(join(cacheDir, folder)).filter(name => name !== 'manifest.json');
    assert.ok(removed.length > 0, 'the cache held hook files');
    for (const name of removed) unlinkSync(join(cacheDir, folder, name));

    const emptied = stubModel();
    const compiled = await compileScenario(submarine, { cache: true, cacheDir, generateText: emptied.generateText, restore: {} });
    assert.ok(emptied.calls() > 0, 'with no cached hook file left, the hooks are generated again');
    assert.equal(departmentLines(compiled.hooks), WORKING_LINES, 'the compile holds a generated department prompt, not the fallback');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
