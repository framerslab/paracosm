/**
 * TimepointCard: a single timepoint summary tile.
 *
 * Mode-aware label: turn-loop -> "Turn N"; batch-trajectory -> "T+N";
 * batch-point -> "Forecast". The viz-kit components themselves do not
 * branch on mode beyond this label; ReportView consumes whichever
 * combination of cards and strips a given mode warrants.
 *
 * Top-3 metrics render as compact `<HealthScoreGauge variant="linear" size="sm" />`
 * instances. Highlights render as a bullet list. Risk flags render via
 * `<RiskFlagList expandable={false}>`. All three blocks omit when empty.
 */
import * as React from 'react';
import styles from './TimepointCard.module.scss';
import { HealthScoreGauge } from './HealthScoreGauge.js';
import { RiskFlagList } from './RiskFlagList.js';
import type { MetricSpec, RiskFlag, SimulationMode } from './shared/types.js';

export interface TimepointCardProps {
  timepoint: number;
  mode: SimulationMode;
  metrics: Record<string, number>;
  metricSpecs: Record<string, MetricSpec>;
  highlights?: string[];
  riskFlags?: RiskFlag[];
  className?: string;
}

/**
 * Mode-discriminated label. Pure function so it is unit-testable
 * independent of the React component.
 */
export function timepointLabel(mode: SimulationMode, timepoint: number): string {
  switch (mode) {
    case 'turn-loop':         return `Turn ${timepoint}`;
    case 'batch-trajectory':  return `T+${timepoint}`;
    case 'batch-point':       return `Forecast`;
  }
}

/**
 * Pick the top-N metrics from the provided record + spec map. "Top" is
 * defined as: presence of a spec, then alphabetical-by-id (deterministic
 * across renders). A future spec can swap this for a "distance from
 * threshold" ranking.
 *
 * Exported so unit tests can verify selection independent of rendering.
 */
export function pickTopN(
  metrics: Record<string, number>,
  specs: Record<string, MetricSpec>,
  n: number,
): Array<{ key: string; spec: MetricSpec; value: number }> {
  const entries = Object.entries(metrics)
    .filter(([k]) => specs[k] !== undefined)
    .map(([k, v]) => ({ key: k, spec: specs[k], value: v }));
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries.slice(0, n);
}

export function TimepointCard(props: TimepointCardProps): JSX.Element {
  const { timepoint, mode, metrics, metricSpecs, highlights, riskFlags, className } = props;
  const top3 = pickTopN(metrics, metricSpecs, 3);

  return (
    <div className={[styles.card, className].filter(Boolean).join(' ')}>
      <div className={styles.label}>{timepointLabel(mode, timepoint)}</div>

      <div className={styles.metrics}>
        {top3.map(({ key, spec, value }) => (
          <HealthScoreGauge key={key} spec={spec} value={value} variant="linear" size="sm" />
        ))}
      </div>

      {highlights && highlights.length > 0 && (
        <ul className={styles.highlights}>
          {highlights.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      )}

      {riskFlags && riskFlags.length > 0 && (
        <RiskFlagList flags={riskFlags} expandable={false} />
      )}
    </div>
  );
}
