/**
 * Trait cue runtime helpers. Dispatches through the trait-model
 * registry so commander, department, director, and agent-reaction
 * prompts pick up the right cue dictionary for any registered model
 * (hexaco, ai-agent, ...) without hardcoding HEXACO axis names.
 *
 * Replaces the per-axis HEXACO calls in `runtime/agents/cues/hexaco/`. The
 * legacy module is preserved as a back-compat re-export shim so any
 * external imports continue to work.
 *
 * @module paracosm/runtime/trait-cues
 */

export {
  buildReactionCues,
  buildReactionCuesFromHexaco,
} from './reaction.js';
export { buildTrajectoryCue, buildTrajectoryCueFromHexaco } from './trajectory.js';
