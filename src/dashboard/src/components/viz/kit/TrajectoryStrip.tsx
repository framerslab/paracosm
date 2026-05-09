/**
 * TrajectoryStrip: horizontal SVG strip showing the primary metric line
 * across N timepoints. Risk flags appear as colored dots above their
 * column. Used heavily in batch-trajectory mode.
 *
 * No external chart library; pure SVG so the strip stays under 1 KB
 * gzipped per render.
 */
import * as React from 'react';
import styles from './TrajectoryStrip.module.scss';
import type { MetricSpec, RiskFlag } from './shared/types.js';

export interface TrajectoryStripPoint {
  label: string;
  metrics: Record<string, number>;
  riskFlags?: RiskFlag[];
}

export interface TrajectoryStripProps {
  timepoints: TrajectoryStripPoint[];
  primaryMetric: MetricSpec;
  width?: number;
  height?: number;
  className?: string;
}

const HIGHEST_SEVERITY: Record<RiskFlag['severity'], number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

/**
 * Pure helper. Returns the highest-severity flag in the list, or null
 * if the list is empty/undefined. Exported for unit tests.
 */
export function pickHighest(flags: RiskFlag[] | undefined): RiskFlag['severity'] | null {
  if (!flags || flags.length === 0) return null;
  return flags.reduce((acc: RiskFlag['severity'], f) =>
    HIGHEST_SEVERITY[f.severity] > HIGHEST_SEVERITY[acc] ? f.severity : acc,
  flags[0].severity);
}

export function TrajectoryStrip(props: TrajectoryStripProps): JSX.Element {
  const { timepoints, primaryMetric, width = 600, height = 80, className } = props;

  if (timepoints.length === 0) {
    return (
      <div className={[styles.strip, className].filter(Boolean).join(' ')}>
        <span className={styles.empty}>No trajectory data.</span>
      </div>
    );
  }

  const [min, max] = primaryMetric.range;
  const span = max - min || 1;
  const pad = 8;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = timepoints.map((tp, i) => {
    const x = pad + (timepoints.length === 1 ? innerW / 2 : (innerW * i) / (timepoints.length - 1));
    const v = tp.metrics[primaryMetric.id] ?? min;
    const ratio = Math.max(0, Math.min(1, (v - min) / span));
    const y = pad + innerH - (ratio * innerH);
    return { x, y, tp, i };
  });

  const polylinePoints = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return (
    <div className={[styles.strip, className].filter(Boolean).join(' ')}>
      <div className={styles.svgWrap}>
        <svg className={styles.svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${primaryMetric.label} trajectory across ${timepoints.length} timepoints`}>
          {points.map(p => (
            <line key={`col-${p.i}`} className={styles.column} data-column={p.i} x1={p.x} y1={pad} x2={p.x} y2={pad + innerH} />
          ))}
          <polyline className={styles.line} points={polylinePoints} />
          {points.map(p => {
            const severity = pickHighest(p.tp.riskFlags);
            if (!severity) return null;
            return (
              <circle
                key={`risk-${p.i}`}
                className={styles.riskDot}
                data-severity={severity}
                data-risk-column={p.i}
                cx={p.x}
                cy={pad / 2}
                r={3}
              />
            );
          })}
        </svg>
      </div>
      <div className={styles.labels}>
        {timepoints.map((tp, i) => <span key={i}>{tp.label}</span>)}
      </div>
    </div>
  );
}
