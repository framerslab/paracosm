import * as React from 'react';
import styles from './diff.module.scss';
import type { RunArtifact } from '../../../../../engine/schema/index.js';

export interface MetricTrajectoryDiffProps {
  artifacts: RunArtifact[];
}

interface MetricSeries {
  metricId: string;
  /** Per-artifact list of {turn, value} pairs. Outer index aligns with `artifacts` arg. */
  perArtifact: Array<Array<{ turn: number; value: number }>>;
}

const SERIES_COLORS = ['var(--amber)', 'var(--rust)', 'var(--teal)'];

export function MetricTrajectoryDiff({ artifacts }: MetricTrajectoryDiffProps): JSX.Element {
  const metrics = React.useMemo<MetricSeries[]>(() => collectMetrics(artifacts), [artifacts]);
  if (metrics.length === 0) {
    return (
      <section className={styles.diffSection} aria-label="Metric trajectory comparison">
        <header className={styles.diffHead}>
          <h5 className={styles.diffTitle}>Metric trajectories</h5>
        </header>
        <p className={styles.diffEmpty}>No timepoint metrics in any artifact.</p>
      </section>
    );
  }
  return (
    <section className={styles.diffSection} aria-label="Metric trajectory comparison">
      <header className={styles.diffHead}>
        <h5 className={styles.diffTitle}>Metric trajectories</h5>
      </header>
      <div className={styles.metricGrid}>
        {metrics.map((m) => (
          <div key={m.metricId} className={styles.metricCard}>
            <span className={styles.metricLabel}>{m.metricId}</span>
            <MultiSparkline series={m.perArtifact} />
          </div>
        ))}
      </div>
    </section>
  );
}

function MultiSparkline({ series }: { series: Array<Array<{ turn: number; value: number }>> }): JSX.Element {
  const W = 200;
  const H = 40;
  const pad = 2;
  const flat = series.flatMap((s) => s.map((p) => p.value)).filter((v) => Number.isFinite(v));
  if (flat.length === 0) return <span className={styles.diffEmpty}>—</span>;
  const minV = Math.min(...flat);
  const maxV = Math.max(...flat);
  const range = Math.max(1e-6, maxV - minV);
  const turnsFlat = series.flatMap((s) => s.map((p) => p.turn));
  const minT = Math.min(...turnsFlat);
  const maxT = Math.max(...turnsFlat);
  const turnRange = Math.max(1, maxT - minT);
  return (
    <svg
      className={styles.metricSparkline}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Metric over turns, one series per artifact"
    >
      {series.map((s, i) => {
        if (s.length < 2) return null;
        const points = s
          .map((p) => `${pad + ((p.turn - minT) / turnRange) * (W - pad * 2)},${pad + (H - pad * 2) * (1 - (p.value - minV) / range)}`)
          .join(' ');
        return (
          <polyline
            key={i}
            points={points}
            fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={1.4}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

function collectMetrics(artifacts: RunArtifact[]): MetricSeries[] {
  const accum = new Map<string, Array<Array<{ turn: number; value: number }>>>();
  for (let ai = 0; ai < artifacts.length; ai++) {
    const tps = (artifacts[ai].trajectory?.timepoints ?? []) as Array<{
      turn?: number;
      worldSnapshot?: { metrics?: Record<string, number> };
    }>;
    const points = (artifacts[ai].trajectory?.points ?? []) as Array<{
      time?: number;
      metrics?: Record<string, number>;
    }>;
    // Prefer timepoints (rich); fall back to points (lean) when absent.
    if (tps.length > 0) {
      for (const tp of tps) {
        if (typeof tp.turn !== 'number') continue;
        const m = tp.worldSnapshot?.metrics;
        if (!m) continue;
        for (const [metricId, value] of Object.entries(m)) {
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          let perArtifact = accum.get(metricId);
          if (!perArtifact) {
            perArtifact = artifacts.map(() => []);
            accum.set(metricId, perArtifact);
          }
          perArtifact[ai].push({ turn: tp.turn, value });
        }
      }
    } else {
      for (const p of points) {
        if (typeof p?.time !== 'number') continue;
        const m = p.metrics;
        if (!m) continue;
        for (const [metricId, value] of Object.entries(m)) {
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          let perArtifact = accum.get(metricId);
          if (!perArtifact) {
            perArtifact = artifacts.map(() => []);
            accum.set(metricId, perArtifact);
          }
          perArtifact[ai].push({ turn: Math.round(p.time), value });
        }
      }
    }
  }
  return [...accum.entries()]
    .map(([metricId, perArtifact]) => ({ metricId, perArtifact }))
    .filter((m) => m.perArtifact.some((s) => s.length > 0))
    .sort((a, b) => a.metricId.localeCompare(b.metricId));
}
