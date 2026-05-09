/**
 * Back-compat shim for the legacy `buildReactionCues(hexaco)` entry
 * point. Delegates to `runtime/agents/cues/trait/reaction::buildReactionCuesFromHexaco`,
 * which routes through the trait-model registry.
 *
 * Output is byte-identical for HEXACO inputs because the hexaco model's
 * cue dictionary preserves the original strings verbatim. New code
 * should import `buildReactionCues(profile: TraitProfile)` from
 * `runtime/trait-cues` directly.
 *
 * @module paracosm/runtime/agents/cues/hexaco/translation
 */
import { buildReactionCuesFromHexaco } from '../trait/reaction.js';
import type { HexacoProfile } from '../../../../engine/core/state.js';

/**
 * @deprecated since 0.8.0: use `buildReactionCues(profile)` from
 *   `runtime/trait-cues` and supply a TraitProfile. This shim
 *   continues to work for HEXACO callers and produces byte-identical
 *   output. Removal scheduled for 0.9.0.
 */
export function buildReactionCues(h: HexacoProfile): string {
  return buildReactionCuesFromHexaco(h);
}
