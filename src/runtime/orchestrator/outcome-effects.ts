/**
 * The outcome step of a turn and the totals its roster snapshot carries,
 * as the orchestrator runs them.
 *
 * @module paracosm/runtime/orchestrator/outcome-effects
 */
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { TurnEvent, WorldMetrics } from '../../engine/core/state.js';
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
 *
 * The registry's table can name a key the run does not carry: the forge
 * cost charges `powerKw` in every run, and a scenario's category table
 * can name a politics key. The kernel drops those, so the run reports and
 * logs only the deltas it applied.
 */
export function applyOutcomeEffects(
  kernel: SimulationKernel,
  registry: EffectRegistry,
  input: OutcomeEffectInput,
): Record<string, number> {
  const { category, outcome, modifiers, turn, time } = input;
  const deltas = registry.applyOutcome(category, outcome, modifiers);
  const event: TurnEvent = { turn, time, type: 'system', description: '' };
  const applied = kernel.applySystemDeltas(deltas as Partial<WorldMetrics>, [event]);
  event.description = `Outcome effect (${outcome}): ${Object.entries(applied).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`;
  return applied;
}

/** The world totals a `systems_snapshot` stream event carries beside the roster. */
export interface SystemsSnapshotTotals {
  population: number;
  morale: number;
  /** Months of food, in a run whose scenario carries `foodMonthsReserve`. */
  foodReserve?: number;
}

/** The totals of `metrics` that a `systems_snapshot` event carries. */
export function systemsSnapshotTotals(metrics: WorldMetrics): SystemsSnapshotTotals {
  const totals: SystemsSnapshotTotals = { population: metrics.population, morale: metrics.morale };
  if (typeof metrics.foodMonthsReserve === 'number') totals.foodReserve = metrics.foodMonthsReserve;
  return totals;
}
