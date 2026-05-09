/**
 * Pure helpers for the Branches tab (Tier 2 Spec 2B). Split from the
 * component file so unit tests can exercise delta computation without
 * pulling in SCSS modules through the `.tsx` import chain.
 *
 * @module branches/BranchesTab.helpers
 */
import type { RunArtifact } from '../../../../engine/schema/index.js';

/**
 * A single metric / status / environment delta between a parent run's
 * final state and a branch run's final state. Consumed by the branch
 * card renderer to show "Pop +12" / "morale: -8%" / "fundingRound:
 * seed → series-a" style deltas.
 */
export interface BranchDelta {
  /** Which finalState bag the key came from. */
  bag: 'metrics' | 'capacities' | 'statuses' | 'environment' | 'politics';
  /** Key inside the bag. */
  key: string;
  /** Parent's value at the same key. */
  parentValue: number | string | boolean;
  /** Branch's value. */
  branchValue: number | string | boolean;
  /**
   * Numeric diff when both values are numbers, undefined when mixed
   * or non-numeric. Used by the renderer to decide between an arrow
   * and a string transition display.
   */
  delta?: number;
  /**
   * Display hint the renderer uses to pick a CSS class. 'up' for
   * numeric increase, 'down' for decrease, 'changed' for any
   * non-numeric change, 'unchanged' is filtered out before render.
   */
  direction: 'up' | 'down' | 'changed' | 'unchanged';
}

/**
 * Internal: classify a pair of same-bag values as direction.
 * Numbers compare by magnitude, everything else by equality.
 */
function classify(parentValue: unknown, branchValue: unknown): BranchDelta['direction'] {
  if (typeof parentValue === 'number' && typeof branchValue === 'number') {
    if (branchValue > parentValue) return 'up';
    if (branchValue < parentValue) return 'down';
    return 'unchanged';
  }
  if (parentValue === branchValue) return 'unchanged';
  return 'changed';
}

/**
 * Compute deltas across the five comparable finalState bags
 * (metrics, capacities, statuses, environment, politics) between a parent and
 * branch run's final state. Skips keys that exist in only one side,
 * skips identical values. Sorted by |delta| descending for numerics
 * first, then non-numeric changes, preserving bag grouping order.
 *
 * @param parent Parent RunArtifact (the trunk run).
 * @param branch Forked branch RunArtifact.
 * @returns Ordered array of {@link BranchDelta}; empty when the two
 *   final states are identical or neither carries finalState bags.
 */
export function computeBranchDeltas(parent: RunArtifact, branch: RunArtifact): BranchDelta[] {
  const bags: Array<BranchDelta['bag']> = ['metrics', 'capacities', 'statuses', 'environment', 'politics'];
  const results: BranchDelta[] = [];
  const parentFinal = parent.finalState as unknown as Record<
    string,
    Record<string, number | string | boolean> | undefined
  > | undefined;
  const branchFinal = branch.finalState as unknown as Record<
    string,
    Record<string, number | string | boolean> | undefined
  > | undefined;
  if (!parentFinal || !branchFinal) return results;
  for (const bag of bags) {
    const parentBag = parentFinal[bag];
    const branchBag = branchFinal[bag];
    if (!parentBag || !branchBag) continue;
    for (const key of Object.keys(parentBag)) {
      if (!(key in branchBag)) continue;
      const parentValue = parentBag[key];
      const branchValue = branchBag[key];
      const direction = classify(parentValue, branchValue);
      if (direction === 'unchanged') continue;
      const delta =
        typeof parentValue === 'number' && typeof branchValue === 'number'
          ? branchValue - parentValue
          : undefined;
      results.push({ bag, key, parentValue, branchValue, delta, direction });
    }
  }
  return results.sort((a, b) => {
    if (a.delta !== undefined && b.delta !== undefined) {
      return Math.abs(b.delta) - Math.abs(a.delta);
    }
    if (a.delta !== undefined) return -1;
    if (b.delta !== undefined) return 1;
    return 0;
  });
}

/**
 * Render a single {@link BranchDelta} as a compact display string.
 * Numeric deltas get a sign + one-decimal value; non-numerics show
 * the transition.
 */
export function formatDelta(d: BranchDelta): string {
  if (d.delta !== undefined) {
    const sign = d.delta > 0 ? '+' : '';
    const value = Math.round(d.delta * 10) / 10;
    return `${d.key} ${sign}${value}`;
  }
  return `${d.key}: ${d.parentValue} → ${d.branchValue}`;
}
