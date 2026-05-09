/**
 * Atlas Lab scenario package — frontier AI lab racing competitor labs
 * to ship a model that just crossed deployment thresholds. Two leaders
 * deliberate ship-vs-hold each month: Marcus Reinhardt (Cautious
 * Methodical Evaluator) vs Priya Kapoor (Compounding-Edge Capabilities
 * Lead). Departments: Alignment Research, Capability Research,
 * Governance, Deployment Engineering, Communications.
 *
 * Wraps `scenario.json` (data shape) with the AI-lab-specific hooks
 * from `hooks.ts` (department prompt context, director system prompt,
 * fingerprint classifier, politics deltas, agent reaction voice).
 * Mirrors the `mars/` and `lunar/` builtin pattern so the scenario
 * loads at server boot via the registration in `server-app.ts` and
 * surfaces as a `[builtin]` source in the catalog grid alongside Mars
 * Genesis and Lunar Outpost.
 *
 * @module paracosm/engine/atlas-lab
 */

import type { ScenarioPackage, ScenarioHooks } from '../types.js';
import scenarioData from './scenario.json' with { type: 'json' };
import {
  atlasLabDepartmentPromptLines,
  atlasLabDirectorInstructions,
  atlasLabFingerprint,
  atlasLabPoliticsHook,
  atlasLabReactionContext,
} from './hooks.js';

/** Atlas Lab scenario: ~480-researcher frontier AI lab, 6 monthly turns by default. */
export const atlasLabScenario: ScenarioPackage = {
  ...scenarioData as unknown as ScenarioPackage,

  // Map declared `events` ids to {icon,color} so the renderer keys
  // line up with what the scenario.json declares — same trick the
  // mars/lunar wrappers use.
  ui: {
    ...(scenarioData.ui as unknown as ScenarioPackage['ui']),
    eventRenderers: Object.fromEntries(
      scenarioData.events.map((e) => [e.id, { icon: e.icon, color: e.color }]),
    ),
  },

  // Effects table is JSON-keyed-by-category; the engine reads it as
  // an array of effect entries with `categoryDefaults`. Wrap the JSON
  // map into the engine's expected shape so the runtime can consume
  // it without a JSON migration.
  effects: [
    {
      id: 'category_effects',
      type: 'category_outcome',
      label: 'Category Outcome Effects',
      categoryDefaults: scenarioData.effects,
    },
  ],

  hooks: {
    departmentPromptHook: (ctx) => atlasLabDepartmentPromptLines(ctx.department, ctx.state),
    directorInstructions: atlasLabDirectorInstructions,
    fingerprintHook: atlasLabFingerprint,
    politicsHook: atlasLabPoliticsHook,
    reactionContextHook: atlasLabReactionContext,
  } satisfies ScenarioHooks,
};
