/**
 * Pure value-to-color-bucket function used by every viz-kit primitive.
 * Three discrete buckets keep the dashboard color palette consistent;
 * the actual hex codes resolve in component SCSS modules via CSS variables.
 */

import type { MetricSpec } from './types.js';

/** Color bucket. Maps to dashboard SCSS variables: --metric-ok / --metric-warn / --metric-critical. */
export type ColorBucket = 'ok' | 'warn' | 'critical';

/**
 * Bucket a value against the spec's warn + critical thresholds.
 *
 * For normal (non-inverted) metrics: lower is worse. value <= critical is critical;
 * value <= warn is warn; otherwise ok.
 *
 * For inverted metrics (e.g. cumulative radiation, where higher is worse):
 * value >= critical is critical; value >= warn is warn; otherwise ok.
 *
 * If thresholds are not declared, returns 'ok' regardless of value.
 *
 * @param spec  Metric specification (range + thresholds + inversion flag).
 * @param value Current value of the metric.
 * @returns The color bucket for visual treatment.
 */
export function metricColor(spec: MetricSpec, value: number): ColorBucket {
  if (!spec.thresholds) return 'ok';
  const { warn, critical } = spec.thresholds;

  if (spec.inverted) {
    if (critical !== undefined && value >= critical) return 'critical';
    if (warn !== undefined && value >= warn) return 'warn';
    return 'ok';
  }

  if (critical !== undefined && value <= critical) return 'critical';
  if (warn !== undefined && value <= warn) return 'warn';
  return 'ok';
}
