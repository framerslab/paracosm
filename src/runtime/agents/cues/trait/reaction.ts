/**
 * Reaction cue translator. Generic over trait models: the runtime
 * looks up the leader's TraitProfile.modelId in the registry and
 * builds a cue line from the model's cue dictionary.
 *
 * For HEXACO scenarios, the output string is byte-identical to the
 * legacy `runtime/agents/cues/hexaco/translation.ts::buildReactionCues`
 * because hexacoModel's cues dictionary lifts those strings verbatim.
 *
 * @module paracosm/runtime/agents/cues/trait/reaction
 */

import type { HexacoProfile } from '../../../../engine/core/state.js';
import type { TraitProfile } from '../../../../engine/traits/index.js';
import { traitModelRegistry } from '../../../../engine/traits/index.js';
import { buildCueLine } from '../../../../engine/traits/cue-translator.js';
import { hexacoToTraits } from '../../../../engine/traits/normalize-leader.js';

/**
 * Generic reaction cue line. Reads the leader's trait model from the
 * registry, picks polarized-axis cues, and emits a single-line string
 * the agent's LLM prompt can splice in.
 *
 * Returns an empty string when no axis is polarized into low/high.
 */
export function buildReactionCues(profile: TraitProfile): string {
  const model = traitModelRegistry.require(profile.modelId);
  return buildCueLine(profile, model);
}

/**
 * Back-compat HEXACO-only wrapper. Existing callers that hold a raw
 * HexacoProfile (no model id) call this; it synthesizes a hexaco
 * traitProfile and delegates. Equivalent in output to the legacy
 * `runtime/agents/cues/hexaco/translation.ts::buildReactionCues`.
 */
export function buildReactionCuesFromHexaco(hexaco: HexacoProfile): string {
  const model = traitModelRegistry.require('hexaco');
  return buildCueLine(
    { modelId: 'hexaco', traits: hexacoToTraits(hexaco, model) },
    model,
  );
}
