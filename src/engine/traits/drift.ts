/**
 * Trait drift dispatcher. Reads a TraitProfile + the profile's
 * TraitModel and applies the three drift sources defined in the
 * model's DriftTable:
 *
 *   1. Outcome reinforcement: each turn outcome class produces a
 *      per-axis delta (e.g. risky_failure raises verification-rigor on
 *      the ai-agent model, raises emotionality on the hexaco model).
 *   2. Leader pull: agents drift toward their leader's traits at the
 *      per-axis pull strength.
 *   3. Role activation: agents promoted to a department whose role
 *      activates an axis get an extra push on that axis.
 *
 * Each call clamps the resulting trait values to [0, 1].
 *
 * @module paracosm/engine/traits/drift
 */

import type { Outcome, TraitModel, TraitProfile } from './index.js';
import { clampTrait, withDefaults } from './index.js';

/**
 * Lower bound for the kernel's drift clamp. Matches the canonical
 * `[0.05, 0.95]` bounds applied by `driftCommanderHexaco` in
 * `src/engine/core/progression.ts`. Keeps traits from saturating at
 * the [0, 1] poles where small inputs flip behavior.
 */
const KERNEL_TRAIT_LOWER = 0.05;
const KERNEL_TRAIT_UPPER = 0.95;

/**
 * Per-turn drift cap: a leader's outcome pull, scaled by the turn's
 * length, is clamped to this range, as `driftCommanderHexaco` does in
 * progression.ts.
 */
const PER_TURN_DRIFT_CAP = 0.05;

/**
 * Clamp a trait value to the kernel's stricter bounds. Used by
 * `driftLeaderProfile` so non-HEXACO models drift under the same
 * saturation discipline as the legacy `driftCommanderHexaco`.
 */
function clampKernelTrait(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  if (value < KERNEL_TRAIT_LOWER) return KERNEL_TRAIT_LOWER;
  if (value > KERNEL_TRAIT_UPPER) return KERNEL_TRAIT_UPPER;
  return value;
}

export interface DriftOutcomeContext {
  /** The outcome class the kernel emitted for this turn. */
  outcome: Outcome;
}

export interface DriftLeaderPullContext {
  /** The leader's profile (the pull target). */
  leader: TraitProfile;
}

export interface DriftRoleActivationContext {
  /** axis-id -> sign (+1 to push up, -1 to push down). */
  axisSigns: Record<string, 1 | -1>;
}

/**
 * Apply outcome-reinforcement drift to a profile in place. Returns a
 * new TraitProfile (same modelId) with the deltas applied + clamped.
 */
export function applyOutcomeDrift(
  profile: TraitProfile,
  model: TraitModel,
  ctx: DriftOutcomeContext,
): TraitProfile {
  if (profile.modelId !== model.id) {
    throw new Error(
      `applyOutcomeDrift: profile.modelId='${profile.modelId}' but model.id='${model.id}'`,
    );
  }
  const filled = withDefaults(profile.traits, model);
  const out: Record<string, number> = { ...filled };
  for (const axis of model.axes) {
    const delta = model.drift.outcomes[axis.id]?.[ctx.outcome] ?? 0;
    if (delta !== 0) {
      out[axis.id] = clampTrait(filled[axis.id] + delta);
    }
  }
  return { modelId: profile.modelId, traits: out };
}

/**
 * Apply leader-pull drift: shift the agent's profile toward the
 * leader's per-axis values by `model.drift.leaderPull[axisId] *
 * (leader[axis] - agent[axis])`. Returns a new TraitProfile.
 *
 * Skipped when the agent's modelId differs from the leader's
 * (cross-model pull is undefined).
 */
export function applyLeaderPull(
  agent: TraitProfile,
  model: TraitModel,
  ctx: DriftLeaderPullContext,
): TraitProfile {
  if (agent.modelId !== model.id) {
    throw new Error(
      `applyLeaderPull: agent.modelId='${agent.modelId}' but model.id='${model.id}'`,
    );
  }
  if (ctx.leader.modelId !== model.id) {
    // Cross-model pull is undefined; emit a noop (no warn; caller
    // controls whether to allow mixed-model populations).
    return agent;
  }
  const agentFilled = withDefaults(agent.traits, model);
  const leaderFilled = withDefaults(ctx.leader.traits, model);
  const out: Record<string, number> = { ...agentFilled };
  for (const axis of model.axes) {
    const pull = model.drift.leaderPull[axis.id] ?? 0;
    if (pull > 0) {
      const gap = leaderFilled[axis.id] - agentFilled[axis.id];
      out[axis.id] = clampTrait(agentFilled[axis.id] + pull * gap);
    }
  }
  return { modelId: agent.modelId, traits: out };
}

/**
 * Drift a leader's TraitProfile in place after a turn outcome,
 * mirroring the semantics of the legacy `driftCommanderHexaco` in
 * `src/engine/core/progression.ts` but generic over trait models:
 *
 *   1. Per-axis pull from `model.drift.outcomes[axis][outcome]`
 *      (defaulting to 0 when missing).
 *   2. Pull is scaled by timeDelta and then clamped to
 *      ±PER_TURN_DRIFT_CAP (±0.05), so one turn moves an axis at most
 *      0.05 however long the turn. Matches `driftCommanderHexaco`.
 *   3. Result clamped to [KERNEL_TRAIT_LOWER, KERNEL_TRAIT_UPPER]
 *      ([0.05, 0.95]). Matches `driftCommanderHexaco`.
 *   4. The new traits are pushed to the snapshot history.
 *
 * For HEXACO leaders this produces byte-identical output to
 * `driftCommanderHexaco` because hexacoModel.drift.outcomes mirrors
 * the canonical `outcomePullForTrait` table (see hexaco.ts comments).
 *
 * For non-HEXACO leaders (ai-agent etc), this is the canonical drift
 * call site. Throws when profile.modelId mismatches model.id.
 */
export function driftLeaderProfile(
  profile: TraitProfile,
  model: TraitModel,
  ctx: {
    outcome: Outcome | null;
    timeDelta: number;
    turn: number;
    time: number;
    history: Array<{ turn: number; time: number; profile: TraitProfile }>;
  },
): TraitProfile {
  if (profile.modelId !== model.id) {
    throw new Error(
      `driftLeaderProfile: profile.modelId='${profile.modelId}' but model.id='${model.id}'`,
    );
  }
  const filled = withDefaults(profile.traits, model);
  const out: Record<string, number> = { ...filled };
  for (const axis of model.axes) {
    let pull = 0;
    if (ctx.outcome) {
      pull += model.drift.outcomes[axis.id]?.[ctx.outcome] ?? 0;
    }
    const delta = Math.max(-PER_TURN_DRIFT_CAP, Math.min(PER_TURN_DRIFT_CAP, pull * ctx.timeDelta));
    out[axis.id] = clampKernelTrait(filled[axis.id] + delta);
  }
  const next: TraitProfile = { modelId: profile.modelId, traits: out };
  ctx.history.push({ turn: ctx.turn, time: ctx.time, profile: next });
  return next;
}

/**
 * Apply role-activation drift: when an agent is promoted to a
 * department whose role activates one or more axes, push those axes
 * by `model.drift.roleActivation[axisId] * sign`. Sign comes from the
 * scenario's role-axis mapping (caller supplies via ctx.axisSigns).
 * Returns a new TraitProfile.
 */
export function applyRoleActivation(
  profile: TraitProfile,
  model: TraitModel,
  ctx: DriftRoleActivationContext,
): TraitProfile {
  if (profile.modelId !== model.id) {
    throw new Error(
      `applyRoleActivation: profile.modelId='${profile.modelId}' but model.id='${model.id}'`,
    );
  }
  const filled = withDefaults(profile.traits, model);
  const out: Record<string, number> = { ...filled };
  for (const axis of model.axes) {
    const amplification = model.drift.roleActivation[axis.id] ?? 0;
    const sign = ctx.axisSigns[axis.id];
    if (amplification !== 0 && sign !== undefined) {
      out[axis.id] = clampTrait(filled[axis.id] + amplification * sign);
    }
  }
  return { modelId: profile.modelId, traits: out };
}
