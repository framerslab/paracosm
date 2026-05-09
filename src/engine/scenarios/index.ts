/**
 * Built-in scenarios: Mars Genesis + Lunar Outpost.
 *
 * Both scenarios live as JSON in `scenarios/{mars,lunar}.json` (with
 * separate `*-knowledge.json` research bundles). This module is a
 * thin loader that:
 *
 *   1. Imports the JSON at module init via ESM JSON imports
 *   2. Merges the referenced knowledge bundle into each scenario
 *   3. Wraps `effects` from object → array (engine expects the array
 *      shape; JSON ships the cleaner object shape)
 *   4. Computes `ui.eventRenderers` from the `events` list
 *   5. Compiles the `dataDrivenHooks` config into runtime hooks via
 *      the data-driven-hooks factory (which also looks up
 *      `progressionPhysics` against the `physics` registry)
 *
 * The result is two `ScenarioPackage` exports — `marsScenario` and
 * `lunarScenario` — that the npm package surface, the orchestrator,
 * the CLI server, and the cookbook scripts all consume directly. No
 * scenario data lives in TypeScript; all of it is in `scenarios/`.
 *
 * @module paracosm/engine/scenarios
 */
import type {
  ScenarioPackage,
  KnowledgeBundle,
  EffectDefinition,
  ScenarioUiDefinition,
} from '../types.js';
import {
  buildDataDrivenHooksFromJson,
  type JsonDataDrivenScenarioConfig,
} from '../data-driven-hooks/index.js';

import marsJson from '../../../scenarios/mars.json' with { type: 'json' };
import marsKnowledge from '../../../scenarios/mars-knowledge.json' with { type: 'json' };
import lunarJson from '../../../scenarios/lunar.json' with { type: 'json' };
import lunarKnowledge from '../../../scenarios/lunar-knowledge.json' with { type: 'json' };

/**
 * Compile a scenario JSON draft (the shape under `scenarios/*.json`)
 * plus a knowledge bundle into a runnable `ScenarioPackage`. Mirrors
 * the `liftDataDrivenDraft` flow used by the disk-loader for custom
 * scenarios but inlined here so the built-in scenarios stay a single
 * import-time evaluation with no filesystem walk.
 */
function liftBuiltinScenario(
  json: Record<string, unknown>,
  knowledge: KnowledgeBundle,
): ScenarioPackage {
  const ddh = json.dataDrivenHooks as JsonDataDrivenScenarioConfig;
  const events = Array.isArray(json.events)
    ? json.events as Array<{ id: string; icon?: string; color?: string }>
    : [];
  const effectsRaw = json.effects;
  const ui = (json.ui ?? {}) as Partial<ScenarioUiDefinition>;

  const liftedEffects: EffectDefinition[] =
    effectsRaw && typeof effectsRaw === 'object' && !Array.isArray(effectsRaw)
      ? [{
          id: 'category_effects',
          type: 'category_outcome',
          label: 'Category Outcome Effects',
          categoryDefaults: effectsRaw as Record<string, Record<string, number>>,
        } as unknown as EffectDefinition]
      : Array.isArray(effectsRaw) ? effectsRaw as EffectDefinition[] : [];

  const liftedUi: ScenarioUiDefinition = {
    ...ui,
    eventRenderers: ui.eventRenderers ?? Object.fromEntries(
      events.map((e) => [e.id, { icon: e.icon, color: e.color }]),
    ),
  } as ScenarioUiDefinition;

  const { dataDrivenHooks: _ddh, knowledgeRef: _kref, ...rest } = json;
  void _ddh; void _kref;

  return {
    ...rest,
    ui: liftedUi,
    effects: liftedEffects,
    knowledge,
    hooks: buildDataDrivenHooksFromJson(ddh),
  } as unknown as ScenarioPackage;
}

/**
 * Mars Genesis: 100-colonist Mars colony over 48 simulated years.
 * Per-agent radiation accumulation + bone density decay run via the
 * `mars-radiation-bone` physics module.
 */
export const marsScenario: ScenarioPackage = liftBuiltinScenario(
  marsJson as Record<string, unknown>,
  marsKnowledge as KnowledgeBundle,
);

/**
 * Lunar Outpost: 50-person crew at the lunar south pole. Per-agent
 * regolith dust exposure + 1/6g muscle/bone atrophy run via the
 * `lunar-regolith-atrophy` physics module.
 */
export const lunarScenario: ScenarioPackage = liftBuiltinScenario(
  lunarJson as Record<string, unknown>,
  lunarKnowledge as KnowledgeBundle,
);
