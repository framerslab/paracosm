/**
 * The hook sources of a compiled scenario: the text each hook was restored
 * or generated from, the model that generated it, and the compile schema
 * version it was generated under.
 *
 * `compileScenario` records them for every scenario it compiles. The
 * server's writer saves them beside a compiled scenario
 * (src/cli/persisted-compiled-scenarios.ts), and the boot restore hands them
 * back to `compileScenario` (`CompileOptions.restore`), which rebuilds every
 * hook from them without calling a model. A saved scenario's hooks then come
 * back on any host, whatever keys it holds, and the restore spends nothing.
 *
 * @module paracosm/engine/compiler/hook-sources
 */

/** The hooks a compile generates, in generation order. */
export const HOOK_NAMES = [
  'progression',
  'director',
  'prompts',
  'milestones',
  'fingerprint',
  'politics',
  'reactions',
] as const;

/** One of {@link HOOK_NAMES}. */
export type HookName = (typeof HOOK_NAMES)[number];

/** The hook sources of one compiled scenario. */
export interface CompiledHookSources {
  /** The compile schema version (`COMPILE_SCHEMA_VERSION`, ./cache.ts) the sources were generated under. */
  schemaVersion: number;
  /** The model that generated them. */
  model: string;
  /**
   * Each hook's source by hook name. A hook the compile left on its fallback
   * has none, so a compile that kept every hook on its fallback has a record
   * that names no hook.
   */
  hooks: Partial<Record<HookName, string>>;
}

/**
 * The sources of each compiled scenario's hooks, by its `hooks` object.
 * Copies of a compiled scenario (`{ ...scenario, id }`) share that object,
 * so they share its sources; nothing here is serialised with the scenario.
 */
const sourcesByHooks = new WeakMap<object, CompiledHookSources>();

/** Records the sources a compile produced for a scenario's `hooks` object. */
export function recordHookSources(hooks: object, sources: CompiledHookSources): void {
  sourcesByHooks.set(hooks, sources);
}

/** The hook sources of a scenario this process compiled or restored, or undefined. */
export function hookSourcesOf(scenario: { hooks?: unknown }): CompiledHookSources | undefined {
  const hooks = scenario.hooks;
  return hooks !== null && typeof hooks === 'object' ? sourcesByHooks.get(hooks) : undefined;
}

/**
 * Hook sources read back from a saved compiled scenario, or undefined when
 * the value does not hold them: a schema version that is an integer, a model
 * name, and a `hooks` object. Its source strings for {@link HOOK_NAMES} are
 * kept and any other key under `hooks` is left out; a record that names no
 * hook is kept as such, the record of a compile that kept every hook on its
 * fallback.
 */
export function readHookSources(value: unknown): CompiledHookSources | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { schemaVersion, model, hooks } = value as Record<string, unknown>;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) return undefined;
  if (typeof model !== 'string' || model.trim() === '') return undefined;
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return undefined;
  const saved: Partial<Record<HookName, string>> = {};
  for (const name of HOOK_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(hooks, name)) continue;
    const source = (hooks as Record<string, unknown>)[name];
    if (typeof source === 'string' && source.trim() !== '') saved[name] = source;
  }
  return { schemaVersion, model, hooks: saved };
}
