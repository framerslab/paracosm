/**
 * A scenario the server saved from a seed compile loads as it was saved.
 *
 * tests/fixtures/compiler/persisted/compiled/orchard-seasons.json is a
 * compiled scenario in the folder layout the server reads at boot
 * (src/cli/persisted-compiled-scenarios.ts): the bare orchard draft compiled
 * with no world, no category table, no supply mark and no death dice. The
 * first test shows that file is what the compiler and the server's own
 * writer produce for that draft today, but for the time it was written. The
 * others read it as the server does at boot and require it to load
 * unchanged, so a later change to the seed compile cannot reach a scenario
 * saved before it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import { DraftScenarioSchema } from '../../../src/engine/compiler/compile-from-seed.js';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import { EffectRegistry } from '../../../src/engine/registries/effects.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';
import { loadPersistedCompiledDrafts, persistCompiledScenario } from '../../../src/cli/persisted-compiled-scenarios.js';
import { scenarioKeyPersonnel } from '../../../src/cli/sim-config.js';
import { loadCompilerFixture } from './helpers/stub-model-compile.js';

/** A model that returns no hook, so every hook is the compiler's own fallback. No model is called. */
const noHook = async () => 'not a hook';

const persistedRoot = fileURLToPath(new URL('../../fixtures/compiler/persisted', import.meta.url));
const saved = loadCompilerFixture('persisted/compiled/orchard-seasons.json') as Record<string, unknown> & {
  _persistMeta: { compiledAt: string; seedText: string | null };
};

/** The saved file without the side-channel block the server adds. */
function withoutPersistMeta(file: Record<string, unknown>): Record<string, unknown> {
  const { _persistMeta: _meta, ...rest } = file;
  return rest;
}

/** The saved file without the time it was written, the one field that differs from write to write. */
function withoutCompiledAt(file: Record<string, unknown>): Record<string, unknown> {
  const meta = { ...(file._persistMeta as Record<string, unknown>) };
  delete meta.compiledAt;
  return { ...file, _persistMeta: meta };
}

/** The package without its hooks, which are functions and are not saved. */
function withoutHooks(pkg: ScenarioPackage): Record<string, unknown> {
  const { hooks: _hooks, ...rest } = pkg as unknown as Record<string, unknown>;
  return rest;
}

test('the saved orchard scenario is what the compiler and the server\'s writer produce for the bare orchard draft', async () => {
  const draft = DraftScenarioSchema.parse(loadCompilerFixture('draft-orchard-bare.json'));
  const compiled = await compileScenario(draft as unknown as Record<string, unknown>, { cache: false, generateText: noHook });
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-persisted-'));
  try {
    const written = persistCompiledScenario(dir, compiled, null);
    assert.ok(written, 'persistCompiledScenario wrote the scenario');
    const file = JSON.parse(readFileSync(written.filePath, 'utf-8')) as Record<string, unknown>;
    assert.deepEqual(
      withoutCompiledAt(file),
      withoutCompiledAt(saved),
      'the file the writer wrote, but for its compiledAt, is the committed fixture',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scenario saved before the change loads at boot as it was saved', async () => {
  const drafts = loadPersistedCompiledDrafts(persistedRoot);
  assert.deepEqual(drafts.map(d => d.id), ['orchard-seasons'], 'the server reads the one saved scenario from the fixtures\' compiled folder');
  const [entry] = drafts;
  assert.deepEqual(entry.draft, withoutPersistMeta(saved), 'the loader hands on the file less its _persistMeta');
  assert.deepEqual(entry.meta, { compiledAt: saved._persistMeta.compiledAt, seedText: null }, 'the loader reads the saved meta');

  const pkg = await compileScenario(entry.draft, { cache: false, generateText: noHook });
  assert.deepEqual(withoutHooks(pkg), withoutPersistMeta(saved), 'the package, less its hooks, is the saved file less its _persistMeta');
});

test('a scenario saved before the change keeps the head count and morale alone, no supply mark, no death dice and no category table', async () => {
  const [entry] = loadPersistedCompiledDrafts(persistedRoot);
  assert.ok(entry, 'the server reads the saved scenario');
  const pkg = await compileScenario(entry.draft, { cache: false, generateText: noHook });
  const kernel = new SimulationKernel(950, 'Leader', scenarioKeyPersonnel(pkg), {
    startTime: pkg.setup?.defaultStartTime ?? 1,
    initialPopulation: 20,
    scenario: pkg,
  });
  const state = kernel.getState();
  assert.deepEqual(Object.keys(state.metrics).sort(), ['morale', 'population'], `the kernel holds the head count and morale alone (read ${JSON.stringify(state.metrics)})`);
  assert.equal(state.metadata.landingSupplies, undefined, 'no supply is marked as sustaining the growers');
  assert.equal(state.metadata.mortalityDice, undefined, 'each step rolls its own death die');
  assert.deepEqual(EffectRegistry.forScenario(pkg).categories(), [], 'the registry has no category table');
});
