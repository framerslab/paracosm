/**
 * HealthScoreGauge: pure-SVG single-metric indicator.
 *
 * Two variants:
 *  - linear (default): horizontal filled bar, scales to width
 *  - radial: 270deg arc with a fill needle
 *
 * Color buckets resolve via {@link metricColor}; the visual color comes
 * from SCSS module variables --metric-ok / --metric-warn / --metric-critical.
 *
 * No external chart library; the SVG is hand-built so the gauge stays
 * under 1 KB gzipped per instance.
 */
import * as React from 'react';
import styles from './HealthScoreGauge.module.scss';
import { metricColor } from './shared/metric-color.js';
import { formatMetric } from './shared/format-metric.js';
import type { MetricSpec } from './shared/types.js';

export interface HealthScoreGaugeProps {
  spec: MetricSpec;
  value: number;
  variant?: 'radial' | 'linear';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_PX: Record<NonNullable<HealthScoreGaugeProps['size']>, number> = {
  sm: 80,
  md: 120,
  lg: 200,
};

export function HealthScoreGauge(props: HealthScoreGaugeProps): JSX.Element {
  const { spec, value, variant = 'linear', size = 'md', className } = props;
  const px = SIZE_PX[size];
  const valid = !Number.isNaN(value) && value !== null && value !== undefined;
  const color = valid ? metricColor(spec, value) : 'ok';
  const formatted = formatMetric(spec, value);

  const [min, max] = spec.range;
  const ratio = valid && max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;

  return (
    <div className={[styles.gauge, styles[size], className].filter(Boolean).join(' ')}>
      <span className={styles.label}>{spec.label}</span>
      {variant === 'linear' ? (
        <svg className={styles.svg} viewBox={`0 0 ${px} 12`} width={px} height={12} role="img" aria-label={`${spec.label}: ${formatted}`}>
          <rect x={0} y={0} width={px} height={12} fill="rgba(255,255,255,0.06)" />
          <rect className={styles.fill} data-color={color} x={0} y={0} width={px * ratio} height={12} />
        </svg>
      ) : (
        <svg className={styles.svg} viewBox="0 0 100 100" width={px} height={px} role="img" aria-label={`${spec.label}: ${formatted}`}>
          <path
            d={radialArcPath(50, 50, 40, 0, ratio * 270)}
            className={styles.fill}
            data-color={color}
            fill="currentColor"
          />
        </svg>
      )}
      <span className={styles.value}>{formatted}</span>
    </div>
  );
}

/**
 * Compute the SVG path for an arc up to 270 degrees.
 *
 * @param cx Center x.
 * @param cy Center y.
 * @param r  Radius.
 * @param startDeg Starting angle in degrees (0 points at 3 o'clock).
 * @param sweepDeg Sweep in degrees (positive = clockwise).
 */
function radialArcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = ((startDeg + sweepDeg) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}
