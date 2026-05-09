import type { ScenarioPackage } from '../../engine/types.js';

export interface ProjectedSystemBags {
  metrics: Record<string, number>;
  capacities?: Record<string, number>;
}

/**
 * Project the kernel's flattened numeric systems bag onto public
 * world-snapshot bags. Capacity values remain in `metrics` for
 * back-compat and are additionally copied into `capacities` when the
 * scenario declares the key under `world.capacities`.
 */
export function projectSystemBags(
  metrics: Record<string, number>,
  scenario: Pick<ScenarioPackage, 'world'>,
  extraMetrics: Record<string, number> = {},
): ProjectedSystemBags {
  const capacityKeys = new Set(Object.keys(scenario.world?.capacities ?? {}));
  const capacities: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (capacityKeys.has(key)) capacities[key] = value;
  }

  return {
    metrics: { ...metrics, ...extraMetrics },
    ...(Object.keys(capacities).length > 0 ? { capacities } : {}),
  };
}
