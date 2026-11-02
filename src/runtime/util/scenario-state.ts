/**
 * What a run's prompts say about the world's state, limited to what the
 * scenario declares.
 *
 * The kernel holds Mars-heritage values in every run: its progression
 * reads food, life support and the rest, so they stay in the state and
 * in saved runs. A scenario that does not declare them has no such things
 * ("Food 18.0mo" in an AI lab), and the Atlas Lab commanders wrote of
 * "Earth-governed amplification" once the director read
 * `governanceStatus: earth-governed`. So the prompts read them through
 * here, and a scenario sees them only by declaring them in `world`.
 *
 * @module paracosm/runtime/util/scenario-state
 */
import type { ScenarioWorldSchema } from '../../engine/types.js';

/** The parts of a scenario's world these helpers read. */
export type DeclaredWorld = Partial<Pick<ScenarioWorldSchema, 'metrics' | 'capacities' | 'statuses' | 'politics'>>;

/** The kernel's default metrics that belong to the Mars and Lunar settlements. */
const HERITAGE_METRICS = new Set([
  'powerKw',
  'foodMonthsReserve',
  'waterLitersPerDay',
  'pressurizedVolumeM3',
  'lifeSupportCapacity',
  'infrastructureModules',
  'scienceOutput',
]);

/** The kernel's default politics that belong to the Mars and Lunar settlements. */
const HERITAGE_POLITICS = new Set(['earthDependencyPct', 'governanceStatus', 'independencePressure']);

/** How to show a metric: every run has people and morale, declared or not. */
interface MetricDisplay {
  label: string;
  unit: string;
  max?: number;
}

const UNIVERSAL_METRICS: Record<string, MetricDisplay> = {
  population: { label: 'Population', unit: '' },
  morale: { label: 'Morale', unit: '%', max: 1 },
};

/** The metrics a scenario's prompts may name: all but undeclared heritage ones. */
export function declaredMetrics(metrics: Record<string, number>, world?: DeclaredWorld | null): Record<string, number> {
  const declared = { ...world?.metrics, ...world?.capacities };
  return Object.fromEntries(
    Object.entries(metrics).filter(([key]) => !HERITAGE_METRICS.has(key) || key in declared),
  );
}

/**
 * The politics a scenario's prompts may name: all but undeclared heritage
 * ones. Mars declares `governanceStatus` among its statuses, so it counts
 * there too.
 */
export function declaredPolitics(
  politics: Record<string, number | string | boolean>,
  world?: DeclaredWorld | null,
): Record<string, number | string | boolean> {
  const declared = { ...world?.politics, ...world?.statuses };
  return Object.fromEntries(
    Object.entries(politics).filter(([key]) => !HERITAGE_POLITICS.has(key) || key in declared),
  );
}

function formatValue(value: number, display?: MetricDisplay): string {
  const plain = String(Number(value.toFixed(3)));
  const unit = display?.unit ?? '';
  if (unit === '%') {
    // A percent may be declared as 0..1 (morale) or 0..100 (hull integrity).
    const fraction = display?.max !== undefined ? display.max <= 1 : Math.abs(value) <= 1;
    return fraction ? `${Math.round(value * 100)}%` : `${plain}%`;
  }
  return unit ? `${plain} ${unit}` : plain;
}

/**
 * One line of the scenario's metrics with their labels and units, for the
 * department and commander prompts: "Researchers 480 people | Morale 85% |
 * AlignmentBench 0.84 score | Release Readiness 65%".
 */
export function formatStateLine(metrics: Record<string, number>, world?: DeclaredWorld | null): string {
  const displays: Record<string, MetricDisplay> = { ...UNIVERSAL_METRICS, ...world?.capacities, ...world?.metrics };
  return Object.entries(declaredMetrics(metrics, world))
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${displays[key]?.label ?? key} ${formatValue(value, displays[key])}`)
    .join(' | ');
}
