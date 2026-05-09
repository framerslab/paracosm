/**
 * Model-agnostic prose cue generator. Reads a TraitProfile + the
 * profile's TraitModel, picks the highest-intensity axes, and emits
 * short prose cues the prompt builder can splice into commander /
 * department / agent-reaction prompts.
 *
 * Replaces `runtime/agents/cues/hexaco/translation.ts` for any caller that
 * has access to a registered TraitModel; the runtime barrel still
 * re-exports a HEXACO-only convenience for legacy call sites.
 *
 * @module paracosm/engine/traits/cue-translator
 */

import type { TraitModel, TraitProfile } from './index.js';
import { traitZone, withDefaults } from './index.js';

export interface CuesOptions {
  /** Maximum number of cues to emit. Default 6 (matches HEXACO axis count). */
  maxCues?: number;
  /**
   * Optional preface; defaults to "Your inner voice:". The HEXACO
   * legacy translator prefixed every cue list with this string.
   */
  preface?: string;
}

/**
 * Build a single-line cue string, e.g.
 * "Your inner voice: you feel events in your body before words;
 *  you look for what this moment makes possible."
 *
 * Empty string when no axis is polarized into a low / high zone (every
 * value sits in mid).
 */
export function buildCueLine(
  profile: TraitProfile,
  model: TraitModel,
  options: CuesOptions = {},
): string {
  const cues = pickCues(profile, model, options);
  if (cues.length === 0) return '';
  const preface = options.preface ?? 'Your inner voice';
  return `${preface}: ${cues.join('; ')}.`;
}

/**
 * Return the ordered list of cue strings for a profile under a model.
 *
 * Selection: iterate axes in model-defined order; for each axis whose
 * value sits in 'low' or 'high' (i.e. polarized past 0.35 / 0.65),
 * emit the model's registered cue string for that zone. Mid-zone
 * values contribute no cue. Cap at `maxCues` (default 6).
 *
 * The iteration order is stable across runs given the same profile,
 * so recurring trait combinations produce consistent prose order
 * across agents in a single simulation.
 */
export function pickCues(
  profile: TraitProfile,
  model: TraitModel,
  options: CuesOptions = {},
): string[] {
  const max = options.maxCues ?? 6;
  const filled = withDefaults(profile.traits, model);
  const out: string[] = [];

  for (const axis of model.axes) {
    if (out.length >= max) break;
    const value = filled[axis.id];
    const zone = traitZone(value);
    if (zone === 'mid') continue;
    const cue = model.cues[axis.id]?.[zone];
    if (cue) out.push(cue);
  }
  return out;
}

/**
 * Per-axis intensity (|value - 0.5|), useful for picking the "most
 * polarized" axes when the model's axis count exceeds maxCues.
 *
 * Currently unused by buildCueLine (which iterates in model order),
 * but exported for future use cases (e.g. dashboard sparkline
 * highlighting, prompt-budget-constrained cue selection).
 */
export function axisIntensities(
  profile: TraitProfile,
  model: TraitModel,
): Array<{ axisId: string; value: number; intensity: number }> {
  const filled = withDefaults(profile.traits, model);
  return model.axes.map(axis => {
    const value = filled[axis.id];
    return { axisId: axis.id, value, intensity: Math.abs(value - 0.5) };
  });
}
