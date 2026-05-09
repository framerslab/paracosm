/**
 * Generic, reusable per-agent progression physics modules.
 *
 * Each module is a `(ProgressionHookContext) => void` that walks the
 * agent roster and mutates per-agent health / state in domain-specific
 * ways the data-driven-hooks DSL can't express in JSON (per-agent
 * iteration, conditional decay rates, asymptotic clamping).
 *
 * Scenarios opt into a physics module by name via the JSON DSL field
 * `dataDrivenHooks.progressionPhysics: '<id>'`. The scenarios
 * loader looks up the function in this registry and wires it into
 * `ScenarioPackage.hooks.progressionHook`.
 *
 * Adding a new physics module: drop a new `<id>.ts` file in this
 * directory exporting a single `(ctx) => void`, then add it to the
 * registry below. Names are kebab-case and describe the physics, NOT
 * the scenario (so `mars-radiation-bone`, not `mars-genesis`).
 *
 * @module paracosm/engine/physics
 */
import type { ProgressionHookContext } from '../types.js';
import { marsRadiationBoneProgression } from './mars-radiation-bone.js';
import { lunarRegolithAtrophyProgression } from './lunar-regolith-atrophy.js';

/** Per-agent progression physics function shape. */
export type ProgressionPhysics = (ctx: ProgressionHookContext) => void;

/**
 * Registry of physics modules indexed by scenario-facing ID. Lookup
 * by `physicsModules['<id>']` returns the matching `ProgressionPhysics`
 * or `undefined` if the ID isn't registered (loader logs and falls
 * back to a no-op so an unknown ID doesn't crash a run).
 */
export const physicsModules: Record<string, ProgressionPhysics> = {
  'mars-radiation-bone': marsRadiationBoneProgression,
  'lunar-regolith-atrophy': lunarRegolithAtrophyProgression,
};

export { marsRadiationBoneProgression, lunarRegolithAtrophyProgression };
