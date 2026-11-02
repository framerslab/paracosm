/**
 * The outcome step of a turn and the totals its roster snapshot carries,
 * as the orchestrator runs them.
 *
 * @module paracosm/runtime/orchestrator/outcome-effects
 */
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { WorldMetrics } from '../../engine/core/state.js';
import type { EffectRegistry, OutcomeModifiers, TurnOutcome } from '../../engine/registries/effects.js';

/** One event's outcome, as the turn loop resolved it. */
export interface OutcomeEffectInput {
  category: string;
  outcome: TurnOutcome;
  modifiers: OutcomeModifiers;
  turn: number;
  time: number;
}

/**
 * Apply an event's outcome effects to the kernel and return the deltas
 * the run reports for it (the `outcome` stream event's `systemDeltas`).
 */
export function applyOutcomeEffects(
  kernel: SimulationKernel,
  registry: EffectRegistry,
  input: OutcomeEffectInput,
): Record<string, number> {
  const { category, outcome, modifiers, turn, time } = input;
  const deltas = registry.applyOutcome(category, outcome, modifiers);
  const description = `Outcome effect (${outcome}): ${Object.entries(deltas).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`;
  kernel.applySystemDeltas(deltas as Partial<WorldMetrics>, [{ turn, time, type: 'system', description }]);
  return deltas;
}

/** The world totals a `systems_snapshot` stream event carries beside the roster. */
export interface SystemsSnapshotTotals {
  population: number;
  morale: number;
  foodReserve?: number;
}

/** The totals of `metrics` that a `systems_snapshot` event carries. */
export function systemsSnapshotTotals(metrics: WorldMetrics): SystemsSnapshotTotals {
  return {
    population: metrics.population,
    morale: metrics.morale,
    foodReserve: metrics.foodMonthsReserve,
  };
}
