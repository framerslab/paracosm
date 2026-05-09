/**
 * Trajectory cue translator. Generic over trait models: emits a
 * prose line describing how the leader's profile has drifted since
 * a baseline snapshot. Reads axis ids and human-readable labels
 * from the registered TraitModel rather than hardcoded HEXACO names.
 *
 * Thresholds match the kernel's drift cap (+/- 0.05/turn): 0.05 is
 * the minimum meaningful drift; 0.15 (three full-cap turns) qualifies
 * as "substantially."
 *
 * @module paracosm/runtime/agents/cues/trait/trajectory
 */

import type { HexacoProfile, HexacoSnapshot } from '../../../../engine/core/state.js';
import type {
  TraitModel,
  TraitProfile,
} from '../../../../engine/traits/index.js';
import { traitModelRegistry, withDefaults } from '../../../../engine/traits/index.js';
import { hexacoToTraits } from '../../../../engine/traits/normalize-leader.js';

const MIN_DRIFT = 0.05;
const SUBSTANTIAL_DRIFT = 0.15;

/**
 * One snapshot of a TraitProfile along the leader's command history.
 * The runtime stores these per-turn so the trajectory cue can compare
 * current vs first.
 *
 * `time` carries the simulation clock at the time of the snapshot. The
 * trajectory cue itself only reads `profile`, but `driftLeaderProfile`
 * writes turn-and-time pairs so dashboard sparklines and replay
 * artifacts can plot drift against simulated time.
 */
export interface TraitProfileSnapshot {
  turn: number;
  time: number;
  profile: TraitProfile;
}

/**
 * Build a generic trajectory cue from a history of TraitProfile
 * snapshots and the current profile. Returns empty string when no
 * axis has drifted past MIN_DRIFT or when history is empty.
 */
export function buildTrajectoryCue(
  history: TraitProfileSnapshot[],
  current: TraitProfile,
): string {
  if (history.length < 1) return '';
  const baseline = history[0].profile;
  if (baseline.modelId !== current.modelId) return '';
  const model = traitModelRegistry.require(current.modelId);

  const baselineTraits = withDefaults(baseline.traits, model);
  const currentTraits = withDefaults(current.traits, model);

  const lines: string[] = [];
  for (const axis of model.axes) {
    const delta = currentTraits[axis.id] - baselineTraits[axis.id];
    if (Math.abs(delta) < MIN_DRIFT) continue;
    const direction = delta > 0 ? 'toward' : 'away from';
    const magnitude = Math.abs(delta) >= SUBSTANTIAL_DRIFT ? 'substantially' : 'measurably';
    // Use the model's display label rather than the raw axis id, then
    // lowercase + dasherize to match the legacy "honesty-humility"
    // formatting for HEXACO.
    const displayName = humanizeAxisLabel(axis.label);
    lines.push(`${magnitude} ${direction} higher ${displayName}`);
  }

  if (!lines.length) return '';
  return `Since you took command, your personality has drifted ${lines.join(' and ')}. Notice how recent decisions have shaped your judgment.`;
}

/**
 * Back-compat HEXACO-only wrapper. Existing callers that pass
 * HexacoSnapshot[] call this; it converts to TraitProfileSnapshot[]
 * and delegates. Equivalent in output to the legacy
 * `runtime/agents/cues/hexaco/trajectory.ts::buildTrajectoryCue`.
 */
export function buildTrajectoryCueFromHexaco(
  history: HexacoSnapshot[],
  current: HexacoProfile,
): string {
  const model = traitModelRegistry.require('hexaco');
  const profileHistory: TraitProfileSnapshot[] = history.map(snap => ({
    turn: snap.turn,
    time: snap.time,
    profile: { modelId: 'hexaco', traits: hexacoToTraits(snap.hexaco, model) },
  }));
  const currentProfile: TraitProfile = {
    modelId: 'hexaco',
    traits: hexacoToTraits(current, model),
  };
  return buildTrajectoryCue(profileHistory, currentProfile);
}

/**
 * Lowercase the axis label and replace whitespace with hyphens so
 * "Honesty-Humility" stays "honesty-humility" and "Verification rigor"
 * becomes "verification-rigor". Matches the legacy HEXACO cue
 * formatting.
 */
function humanizeAxisLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}
