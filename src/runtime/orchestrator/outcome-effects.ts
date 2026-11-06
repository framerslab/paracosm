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
  /** The scenario's per-outcome politics table; see {@link applyOutcomeEffects}. */
  politicsHook?: (category: string, outcome: string) => Record<string, number> | null;
}

/** What an outcome moved, as the `outcome` stream event reports it. */
export interface OutcomeEffectsApplied {
  systemDeltas: Record<string, number>;
  politicsDeltas: Record<string, number>;
}

/**
 * Apply an event's outcome effects to the kernel and return the changes
 * the run reports for it (the `outcome` stream event's `systemDeltas` and
 * `politicsDeltas`).
 *
 * A key of the registry's category table moves the metric or the politics
 * value the run holds under it. The table can also name a key the run does
 * not carry (the forge cost charges `powerKw` in every run); the kernel
 * drops those, so the run reports and logs only what it applied.
 *
 * The scenario's politics hook names a change for each outcome, so where it
 * names a key, its change replaces the category table's and the key moves
 * once. The table scales each entry by the outcome, and a harmful entry
 * stays a cost on a failure (see `EffectRegistry`): a safety breach's -8
 * board confidence grows on a failed response; the hook can name a
 * different change for each outcome.
 */
export function applyOutcomeEffects(
  kernel: SimulationKernel,
  registry: EffectRegistry,
  input: OutcomeEffectInput,
): OutcomeEffectsApplied {
  const { category, outcome, modifiers, turn, time, politicsHook } = input;
  const deltas = registry.applyOutcome(category, outcome, modifiers);
  const event: TurnEvent = { turn, time, type: 'system', description: '' };
  const systemDeltas = kernel.applySystemDeltas(deltas as Partial<WorldMetrics>, [event]);
  const tablePolitics = Object.fromEntries(Object.entries(deltas).filter(([k]) => !(k in systemDeltas)));
  const politicsDeltas = kernel.applyPoliticsDeltas({ ...tablePolitics, ...(politicsHook?.(category, outcome) ?? {}) });
  const changes = Object.entries({ ...systemDeltas, ...politicsDeltas });
  event.description = `Outcome effect (${outcome}): ${changes.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`;
  return { systemDeltas, politicsDeltas };
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
