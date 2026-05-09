/**
 * Format a numeric metric value for display, given its MetricSpec.
 *
 * Unit handling:
 * - 'pct'      ->  multiply by 100, append '%', round to 0 decimals
 * - 'count'    ->  thousands separator
 * - 'currency' ->  $XK / $X.XM / $XB short-form, else $X
 * - 'time'     ->  YYYY -> 'Y2042'
 * - other      ->  number + ' ' + unit
 *
 * NaN / null / undefined return the 'n/a' placeholder. ASCII-only by
 * design: the codebase rule against em-dashes applies even to visual
 * sentinels in dashboard copy.
 */

import type { MetricSpec } from './types.js';

const PLACEHOLDER = 'n/a';

export function formatMetric(spec: MetricSpec, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return PLACEHOLDER;

  const unit = spec.unit ?? '';

  switch (unit) {
    case 'pct': {
      const pct = Math.round(value * 100);
      return `${pct}%`;
    }
    case 'count': {
      return value.toLocaleString('en-US');
    }
    case 'currency': {
      if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
      if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
      return `$${Math.round(value)}`;
    }
    case 'time': {
      return `Y${Math.round(value)}`;
    }
    default: {
      return unit ? `${value} ${unit}` : String(value);
    }
  }
}
