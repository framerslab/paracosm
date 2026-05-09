/**
 * Back-compat shim for the legacy `buildTrajectoryCue(history, current)`
 * entry point. Delegates to
 * `runtime/agents/cues/trait/trajectory::buildTrajectoryCueFromHexaco`, which
 * routes through the trait-model registry.
 *
 * Output is byte-identical for HEXACO inputs because the hexaco model's
 * axis labels lower-case + dasherize to "honesty-humility" etc. New
 * code should import `buildTrajectoryCue(history, current)` from
 * `runtime/trait-cues` and supply TraitProfile-shaped inputs.
 *
 * @module paracosm/runtime/agents/cues/hexaco/trajectory
 */
import { buildTrajectoryCueFromHexaco } from '../trait/trajectory.js';
import type { HexacoProfile, HexacoSnapshot } from '../../../../engine/core/state.js';

/**
 * @deprecated since 0.8.0: use `buildTrajectoryCue(history, current)`
 *   from `runtime/trait-cues` with TraitProfile-shaped inputs. This
 *   shim continues to work for HEXACO callers and produces byte-
 *   identical output. Removal scheduled for 0.9.0.
 */
export function buildTrajectoryCue(
  history: HexacoSnapshot[],
  current: HexacoProfile,
): string {
  return buildTrajectoryCueFromHexaco(history, current);
}
