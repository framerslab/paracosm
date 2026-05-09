/**
 * BatchArtifactView: renders a stored `RunArtifact` for batch-trajectory
 * and batch-point modes.
 *
 * The existing `ReportView` is shaped around the live-SSE turn-loop
 * `GameState`. Batch modes consume a different surface (a loaded
 * `RunArtifact` rather than a streaming SSE feed), so this component
 * is a separate render path. The two coexist; a parent dispatcher
 * picks one based on `artifact.metadata.mode`.
 *
 * For `mode === 'batch-trajectory'`: renders a `<TrajectoryStrip>`
 * across the timepoints plus a grid of `<TimepointCard>` tiles.
 * For `mode === 'batch-point'`: renders a single `<TimepointCard>`
 * positioned as the forecast.
 *
 * The component intentionally does not handle `mode === 'turn-loop'`;
 * the existing `ReportView` is the right path for that mode and a
 * top-level dispatcher should fork before reaching this component.
 */
import * as React from 'react';
import styles from './BatchArtifactView.module.scss';
import { TrajectoryStrip, TimepointCard } from '../viz/kit/index.js';
import type { MetricSpec, RiskFlag } from '../viz/kit/index.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface BatchArtifactViewProps {
  artifact: RunArtifact;
  /**
   * Map of metric id -> MetricSpec, derived from the active scenario.
   * Defaults are filled in for any metric that has a value but no spec
   * (range [0, 1] for pct, [0, 10000] for count, etc.).
   */
  metricSpecs: Record<string, MetricSpec>;
  className?: string;
}

/**
 * Resolve which metric to draw as the polyline overlay on a TrajectoryStrip.
 * The first declared spec (insertion order) is the primary by convention.
 * When no spec is declared, derives from the timepoints by max-range
 * relative to the mean (heuristic for "most volatile" metric).
 */
export function resolvePrimaryMetric(
  artifact: RunArtifact,
  specs: Record<string, MetricSpec>,
): MetricSpec {
  const declaredOrder = Object.keys(specs);
  if (declaredOrder.length > 0) return specs[declaredOrder[0]];

  const timepoints = artifact.trajectory?.timepoints ?? [];
  const keys = new Set<string>();
  timepoints.forEach(tp => {
    const m = (tp as { worldSnapshot?: { metrics?: Record<string, number> } }).worldSnapshot?.metrics;
    if (m) Object.keys(m).forEach(k => keys.add(k));
  });
  let bestKey = '';
  let bestScore = -Infinity;
  for (const k of keys) {
    const values = timepoints.map(tp => {
      const m = (tp as { worldSnapshot?: { metrics?: Record<string, number> } }).worldSnapshot?.metrics;
      return m?.[k] ?? 0;
    });
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
    const score = mean === 0 ? 0 : (max - min) / Math.abs(mean);
    if (score > bestScore) { bestScore = score; bestKey = k; }
  }
  return specs[bestKey] ?? { id: bestKey || 'unknown', label: bestKey || 'Unknown', range: [0, 1] };
}

interface RawTimepoint {
  label?: string;
  t?: number;
  time?: number;
  worldSnapshot?: { metrics?: Record<string, number> };
  highlights?: string[];
  riskFlags?: RiskFlag[];
}

function timepointLabel(tp: RawTimepoint, fallbackIndex: number): string {
  if (tp.label) return tp.label;
  const t = tp.t ?? tp.time ?? fallbackIndex;
  return `T${t}`;
}

export function BatchArtifactView(props: BatchArtifactViewProps): JSX.Element {
  const { artifact, metricSpecs, className } = props;
  const mode = artifact.metadata.mode;

  if (mode === 'batch-trajectory') {
    const rawTimepoints = (artifact.trajectory?.timepoints ?? []) as RawTimepoint[];
    if (rawTimepoints.length === 0) {
      return <div className={[styles.empty, className].filter(Boolean).join(' ')}>No timepoints in this run.</div>;
    }

    const stripPoints = rawTimepoints.map((tp, i) => ({
      label: timepointLabel(tp, i),
      metrics: tp.worldSnapshot?.metrics ?? {},
      riskFlags: tp.riskFlags,
    }));

    return (
      <div className={[styles.batchTrajectory, className].filter(Boolean).join(' ')}>
        <div className={styles.header}>
          <span>{artifact.metadata.scenario.name}</span>
          <span>Batch trajectory ({rawTimepoints.length} timepoints)</span>
        </div>
        <TrajectoryStrip
          timepoints={stripPoints}
          primaryMetric={resolvePrimaryMetric(artifact, metricSpecs)}
        />
        <div className={styles.timepointGrid}>
          {rawTimepoints.map((tp, i) => (
            <TimepointCard
              key={i}
              timepoint={tp.t ?? tp.time ?? i}
              mode="batch-trajectory"
              metrics={tp.worldSnapshot?.metrics ?? {}}
              metricSpecs={metricSpecs}
              highlights={tp.highlights}
              riskFlags={tp.riskFlags}
            />
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'batch-point') {
    const finalState = (artifact as { finalState?: { metrics?: Record<string, number> } }).finalState;
    const overview = (artifact as { overview?: string }).overview;
    const riskFlags = (artifact as { riskFlags?: RiskFlag[] }).riskFlags;
    return (
      <div className={[styles.batchPoint, className].filter(Boolean).join(' ')}>
        <div className={styles.header}>
          <span>{artifact.metadata.scenario.name}</span>
          <span>Batch point forecast</span>
        </div>
        <TimepointCard
          timepoint={0}
          mode="batch-point"
          metrics={finalState?.metrics ?? {}}
          metricSpecs={metricSpecs}
          highlights={overview ? [overview] : undefined}
          riskFlags={riskFlags}
        />
      </div>
    );
  }

  // turn-loop fallthrough: this component is not the right view for that
  // mode. The parent dispatcher should route turn-loop artifacts to
  // ReportView instead.
  return <div className={styles.empty}>Use ReportView for turn-loop runs; this component renders batch-trajectory and batch-point only.</div>;
}
