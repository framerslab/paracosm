/**
 * Pure helpers for the StatsBar component. Split out so they can be
 * unit-tested without the component file transitively pulling in
 * SCSS module imports that node:test cannot resolve.
 */

/**
 * Render a status / environment bag as a tooltip-friendly multi-line
 * string. Empty / undefined bags produce an empty string so callers
 * can short-circuit with `if (s)`. Boolean values render as "yes" /
 * "no" (not "true" / "false") since the tooltip is user-facing.
 * Numbers stringify; strings pass through.
 */
export function formatBagTooltip(bag: Record<string, string | number | boolean> | undefined): string {
  if (!bag) return '';
  const entries = Object.entries(bag);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => {
    const display = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    return `${k}: ${display}`;
  }).join('\n');
}

/** What the stats bar needs to know of a header metric to show its value. */
export interface HeaderMetricDisplay {
  format: string;
  /** The world field's declared ceiling, from GET /scenario. */
  max?: number;
}

/**
 * The number a header metric shows. A percent metric is held either as a
 * fraction (Release Readiness, 0.65 of max 1) or in percent already (Hull
 * Integrity, 100 of max 100); only a fraction is scaled. A metric with no
 * declared ceiling is read by its value.
 */
export function headerMetricValue(value: number, metric: HeaderMetricDisplay): number {
  if (metric.format !== 'percent') return value;
  const isFraction = metric.max !== undefined ? metric.max <= 1 : Math.abs(value) <= 1;
  return isFraction ? value * 100 : value;
}

/** A header metric's value as the stats bar shows it. */
export function formatHeaderMetric(value: number, metric: HeaderMetricDisplay): string {
  if (metric.format === 'percent') return `${Math.round(headerMetricValue(value, metric))}%`;
  if (metric.format === 'number') {
    const r = Math.round(value * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return String(value);
}
