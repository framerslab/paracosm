/**
 * A scenario the server saved from a seed compile loads as it was saved.
 *
 * tests/fixtures/compiler/persisted/compiled/ holds two compiled scenarios
 * in the folder layout the server reads at boot
 * (src/cli/persisted-compiled-scenarios.ts).
 *
 * orchard-seasons.json is the bare orchard draft compiled with no world, no
 * category table, no supply mark and no death dice. The first test shows
 * that file is what the compiler and the server's own writer produce for
 * that draft today, but for the time it was written. The next two read it as
 * the server does at boot and require it to load unchanged, so a later
 * change to the seed compile cannot reach a scenario saved before it.
 *
 * saltmere-delta-council.json is a recording: a scenario a seed compile
 * answered with on 12 November 2026, with a world that holds its four
 * declared scores, six category tables, one supply marked as sustaining its
 * people and one death die for a life (tests/fixtures/compiler/README.md
 * says what was recorded and what was replaced). The last two tests read it
 * as the server does at boot: it loads and compiles again unchanged, a
 * kernel built from it holds every score it declares, and
 * `validateSeedWorld` reports nothing for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import { DraftScenarioSchema } from '../../../src/engine/compiler/compile-from-seed.js';
import { validateSeedWorld } from '../../../src/engine/compiler/validate.js';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import { EffectRegistry } from '../../../src/engine/registries/effects.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';
import {
  loadPersistedCompiledDrafts,
  persistCompiledScenario,
  type PersistedCompiledDraft,
} from '../../../src/cli/persisted-compiled-scenarios.js';
import { scenarioKeyPersonnel } from '../../../src/cli/sim-config.js';
import { hookSourcesOf } from '../../../src/engine/compiler/hook-sources.js';
import { loadCompilerFixture } from './helpers/stub-model-compile.js';

/** A model that returns no hook, so every hook is the compiler's own fallback. No model is called. */
const noHook = async () => 'not a hook';

const ORCHARD = 'orchard-seasons';
const SALTMERE = 'saltmere-delta-council';

const persistedRoot = fileURLToPath(new URL('../../fixtures/compiler/persisted', import.meta.url));
const saved = loadCompilerFixture(`persisted/compiled/${ORCHARD}.json`) as Record<string, unknown> & {
  _persistMeta: { compiledAt: string; seedText: string | null };
};
const recorded = loadCompilerFixture(`persisted/compiled/${SALTMERE}.json`) as Record<string, unknown> & {
  metrics: Array<{ id: string }>;
  world: { metrics: Record<string, { initial: number; sustains?: boolean }> };
  knowledge: { topics: Record<string, { canonicalFacts: unknown[] }>; categoryMapping: Record<string, string[]> };
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

/**
 * The saved scenario the server's loader reads under `id`. The loader lists
 * the newest file first by the time each was written, which a checkout does
 * not fix, so a test asks for its scenario by id.
 */
function loadedAtBoot(id: string): PersistedCompiledDraft {
  const drafts = loadPersistedCompiledDrafts(persistedRoot);
  const entry = drafts.find(d => d.id === id);
  assert.ok(entry, `the server reads ${id} from the fixtures' compiled folder (read ${JSON.stringify(drafts.map(d => d.id))})`);
  return entry;
}

test('the saved orchard scenario is what the compiler and the server\'s writer produce for the bare orchard draft', async () => {
  const draft = DraftScenarioSchema.parse(loadCompilerFixture('draft-orchard-bare.json'));
  const compiled = await compileScenario(draft as unknown as Record<string, unknown>, { cache: false, generateText: noHook });
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-persisted-'));
  try {
    const written = persistCompiledScenario(dir, compiled, null);
    assert.ok(written, 'persistCompiledScenario wrote the scenario');
    const { _persistHooks: hookRecord, ...file } = JSON.parse(readFileSync(written.filePath, 'utf-8')) as Record<string, unknown>;
    // The compile kept every hook on its fallback. The writer saves its hook
    // record all the same, naming no hook, so a restart restores it with no
    // model call; the fixture was recorded before files carried that record.
    assert.deepEqual(hookRecord, hookSourcesOf(compiled), 'the writer saves the compile\'s hook record');
    assert.deepEqual((hookRecord as { hooks?: unknown } | undefined)?.hooks, {}, 'the record names no hook');
    assert.deepEqual(
      withoutCompiledAt(file),
      withoutCompiledAt(saved),
      'the file the writer wrote, but for its compiledAt and its hook record, is the committed fixture',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scenario saved before the change loads at boot as it was saved', async () => {
  const drafts = loadPersistedCompiledDrafts(persistedRoot);
  assert.deepEqual(
    drafts.map(d => d.id).sort(),
    [ORCHARD, SALTMERE],
    'the server reads the two saved scenarios from the fixtures\' compiled folder',
  );
  const entry = loadedAtBoot(ORCHARD);
  assert.deepEqual(entry.draft, withoutPersistMeta(saved), 'the loader hands on the file less its _persistMeta');
  assert.deepEqual(entry.meta, { compiledAt: saved._persistMeta.compiledAt, seedText: null }, 'the loader reads the saved meta');

  const pkg = await compileScenario(entry.draft, { cache: false, generateText: noHook });
  assert.deepEqual(withoutHooks(pkg), withoutPersistMeta(saved), 'the package, less its hooks, is the saved file less its _persistMeta');
});

test('a scenario saved before the change keeps the head count and morale alone, no supply mark, no death dice and no category table', async () => {
  const entry = loadedAtBoot(ORCHARD);
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

test('the recorded Saltmere scenario loads at boot as it was saved and compiles again unchanged, its research facts carried as data', async () => {
  const entry = loadedAtBoot(SALTMERE);
  assert.deepEqual(entry.draft, withoutPersistMeta(recorded), 'the loader hands on the file less its _persistMeta');
  assert.deepEqual(
    entry.meta,
    recorded._persistMeta,
    `the loader reads the saved meta, the time and the prompt (read ${JSON.stringify(entry.meta)})`,
  );
  assert.ok(
    typeof entry.meta.seedText === 'string' && entry.meta.seedText.startsWith('Saltmere is an invented river-delta town'),
    `the saved meta carries the prompt the scenario was compiled from (read ${JSON.stringify(entry.meta.seedText)})`,
  );

  const pkg = await compileScenario(entry.draft, { cache: false, generateText: noHook });
  assert.deepEqual(withoutHooks(pkg), withoutPersistMeta(recorded), 'the package, less its hooks, is the saved file less its _persistMeta');

  // The compile is given no seed text at boot, so the knowledge the file holds is the knowledge the package holds.
  const facts = Object.values(pkg.knowledge?.topics ?? {}).map(topic => topic.canonicalFacts.length);
  assert.deepEqual(
    facts,
    Object.values(recorded.knowledge.topics).map(topic => topic.canonicalFacts.length),
    `the package holds every fact of every topic the file holds (read ${JSON.stringify(facts)})`,
  );
  assert.ok(
    facts.reduce((sum, count) => sum + count, 0) > 0,
    `the file holds research facts for the compile to carry (read ${JSON.stringify(facts)})`,
  );
});

test('a kernel built from the recorded Saltmere scenario holds every score it declares, and validateSeedWorld reports nothing for it', async () => {
  const entry = loadedAtBoot(SALTMERE);
  const pkg = await compileScenario(entry.draft, { cache: false, generateText: noHook });
  const kernel = new SimulationKernel(950, 'Leader', scenarioKeyPersonnel(pkg), {
    startTime: pkg.setup?.defaultStartTime ?? 1,
    initialPopulation: 20,
    scenario: pkg,
  });
  const state = kernel.getState();
  const held = state.metrics as unknown as Record<string, unknown>;

  const declared = recorded.metrics.map(m => m.id);
  assert.ok(declared.length >= 2, `the recording declares its scores (read ${JSON.stringify(declared)})`);
  assert.deepEqual(
    declared.filter(id => id !== 'population' && id !== 'morale'),
    declared,
    `none of the declared scores is the head count or morale, so each is the scenario's own (read ${JSON.stringify(declared)})`,
  );
  assert.deepEqual(
    Object.fromEntries(declared.map(id => [id, held[id]])),
    Object.fromEntries(declared.map(id => [id, recorded.world.metrics[id]?.initial])),
    `the kernel holds every declared score at the start its world gives (it holds ${JSON.stringify(held)})`,
  );
  assert.deepEqual(
    declared.filter(id => typeof held[id] !== 'number' || !Number.isFinite(held[id] as number)),
    [],
    `every declared score is a number in the kernel (it holds ${JSON.stringify(held)})`,
  );

  // Its events have tables, and the director is offered the tables' keys.
  const tables = EffectRegistry.forScenario(pkg).categories();
  assert.ok(tables.length >= 3, `the scenario has three category tables or more (read ${JSON.stringify(tables)})`);
  assert.deepEqual(
    Object.keys(pkg.knowledge?.categoryMapping ?? {}),
    tables,
    `the categories the knowledge bundle maps are the category tables' keys, in order (read ${JSON.stringify(Object.keys(pkg.knowledge?.categoryMapping ?? {}))})`,
  );

  // The supply the world marks keeps its amount on day one, and each person keeps one death die for life.
  const marked = Object.entries(recorded.world.metrics).filter(([, field]) => field.sustains === true);
  assert.ok(marked.length >= 1, `the recording marks a supply as sustaining its people (read ${JSON.stringify(recorded.world.metrics)})`);
  assert.deepEqual(
    state.metadata.landingSupplies,
    Object.fromEntries(marked.map(([key, field]) => [key, field.initial])),
    `the kernel keeps each marked supply's amount on day one (read ${JSON.stringify(state.metadata.landingSupplies)})`,
  );
  assert.equal(
    state.metadata.mortalityDice,
    'life',
    `the kernel keeps one death die for a life (read ${JSON.stringify(state.metadata.mortalityDice)})`,
  );

  assert.deepEqual(
    validateSeedWorld(pkg as unknown as Record<string, unknown>).errors,
    [],
    'validateSeedWorld reports nothing for the package compiled from the saved file',
  );
  assert.deepEqual(
    validateSeedWorld(entry.draft).errors,
    [],
    'validateSeedWorld reports nothing for the saved file as the loader hands it on',
  );
});
