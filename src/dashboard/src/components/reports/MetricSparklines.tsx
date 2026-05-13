/**
 * Six compact SVG sparklines, one per world metric. Renders two
 * shapes:
 *
 * - Pair mode (default): overlays leader A + leader B polylines on
 *   each card so the user spots crossover turns. Driven by
 *   `metric.a` / `metric.b` in the MetricSeries payload.
 * - Cohort mode: when `metric.series` is populated, overlays one
 *   polyline per actor (up to N) and renders a wrapped legend at the
 *   top. Triggered by ReportView when the user runs a cohort with the
 *   pair-focus toggle OFF.
 *
 * No chart library; same inline-SVG pattern as CommanderTrajectoryCard.
 *
 * @module paracosm/dashboard/reports/MetricSparklines
 */
import type { CSSProperties } from 'react';
import type { MetricSeries } from './reports-shared';
import styles from './MetricSparklines.module.scss';

export interface MetricSparklinesProps {
  metrics: MetricSeries[];
  leaderAName: string;
  leaderBName: string;
  sideAColor?: string;
  sideBColor?: string;
}

function formatValue(v: number, unit?: string): string {
  if (unit === 'mo' || unit === 'kW') return `${v.toFixed(1)}${unit ? ' ' + unit : ''}`;
  if (v > 0 && v < 1) return `${Math.round(v * 100)}%`;
  return `${Math.round(v)}${unit ? ' ' + unit : ''}`;
}

interface CardProps {
  metric: MetricSeries;
  sideAColor: string;
  sideBColor: string;
}

function SparkCard({ metric, sideAColor, sideBColor }: CardProps) {
  const W = 200;
  const H = 50;
  const padX = 4;
  const padY = 6;

  // Cohort mode: one polyline per actor in `series`. Falls through to
  // pair mode when the array is absent or empty.
  const isCohortShape = Array.isArray(metric.series) && metric.series.length >= 2;

  const allPoints = isCohortShape
    ? metric.series!.flatMap(s => s.points)
    : [...metric.a, ...metric.b];
  if (allPoints.length === 0) return null;

  // Single-pass min/max scan. Spread-based `Math.min(...allPoints)` would
  // blow the call stack on very large cohorts (e.g., 300 actors × 6 turns
  // = 1800 points) since spread inflates the argument list past JS engine
  // function-argument caps. The reduce is O(n) and call-stack-safe.
  let minTurn = Infinity;
  let maxTurn = -Infinity;
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const p of allPoints) {
    if (p.turn < minTurn) minTurn = p.turn;
    if (p.turn > maxTurn) maxTurn = p.turn;
    if (p.value < minVal) minVal = p.value;
    if (p.value > maxVal) maxVal = p.value;
  }
  const valRange = Math.max(1e-6, maxVal - minVal);
  const turnRange = Math.max(1, maxTurn - minTurn);

  const xFor = (turn: number) => padX + (W - padX * 2) * ((turn - minTurn) / turnRange);
  const yFor = (value: number) => padY + (H - padY * 2) * (1 - (value - minVal) / valRange);

  if (isCohortShape) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardLabel}>{metric.label}</span>
          <span className={styles.cardRange}>T{minTurn} → T{maxTurn}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`${metric.label} sparkline (${metric.series!.length} actors)`}
        >
          <line x1={padX} y1={H / 2} x2={W - padX} y2={H / 2} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,3" />
          {metric.series!.map((s) => {
            const points = s.points.map(p => `${xFor(p.turn)},${yFor(p.value)}`).join(' ');
            if (!points) return null;
            return (
              <polyline
                key={s.actorId}
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.78}
              >
                <title>{s.name}</title>
              </polyline>
            );
          })}
        </svg>
        <div className={styles.cardFooterCohort}>
          {metric.series!.map((s) => {
            const last = s.points[s.points.length - 1]?.value;
            return (
              <span
                key={s.actorId}
                className={styles.lastCohort}
                style={{ ['--actor-color' as string]: s.color } as CSSProperties}
                title={s.name}
              >
                {last != null ? formatValue(last, metric.unit) : '·'}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // Pair mode (original rendering).
  const aPoints = metric.a.map(p => `${xFor(p.turn)},${yFor(p.value)}`).join(' ');
  const bPoints = metric.b.map(p => `${xFor(p.turn)},${yFor(p.value)}`).join(' ');
  const aLast = metric.a[metric.a.length - 1]?.value;
  const bLast = metric.b[metric.b.length - 1]?.value;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardLabel}>{metric.label}</span>
        <span className={styles.cardRange}>T{minTurn} → T{maxTurn}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`${metric.label} sparkline`}
      >
        <line x1={padX} y1={H / 2} x2={W - padX} y2={H / 2} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,3" />
        {aPoints && (
          <polyline points={aPoints} fill="none" stroke={sideAColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        )}
        {bPoints && (
          <polyline points={bPoints} fill="none" stroke={sideBColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        )}
      </svg>
      <div className={styles.cardFooter}>
        <span className={styles.lastA}>
          {aLast != null ? formatValue(aLast, metric.unit) : '·'}
        </span>
        <span className={styles.lastB}>
          {bLast != null ? formatValue(bLast, metric.unit) : '·'}
        </span>
      </div>
    </div>
  );
}

export function MetricSparklines(props: MetricSparklinesProps) {
  const { metrics, leaderAName, leaderBName } = props;
  const sideAColor = props.sideAColor ?? 'var(--vis)';
  const sideBColor = props.sideBColor ?? 'var(--eng)';
  // Detect cohort shape off the first metric — collectMetricSeriesCohort
  // populates `series` on every entry uniformly.
  const isCohortShape = metrics.length > 0 && Array.isArray(metrics[0].series) && metrics[0].series!.length >= 2;
  const populated = metrics.filter(m =>
    isCohortShape
      ? (m.series ?? []).some(s => s.points.length > 0)
      : (m.a.length > 0 || m.b.length > 0),
  );
  if (populated.length === 0) return null;

  const themeStyle = {
    '--side-a-color': sideAColor,
    '--side-b-color': sideBColor,
  } as CSSProperties;

  return (
    <section aria-label="Metric sparklines" className={styles.section} style={themeStyle}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Metric Trajectories</span>
        {isCohortShape ? (
          <span className={styles.legendCohort}>
            {(populated[0].series ?? []).map((s) => (
              <span
                key={s.actorId}
                className={styles.legendCohortEntry}
                style={{ ['--actor-color' as string]: s.color } as CSSProperties}
              >
                {s.name}
              </span>
            ))}
          </span>
        ) : (
          <span className={styles.legend}>
            <span className={styles.legendA}>{leaderAName}</span>
            {' · '}
            <span className={styles.legendB}>{leaderBName}</span>
          </span>
        )}
      </div>
      <div className={`responsive-grid-3 ${styles.grid}`}>
        {populated.map(m => (
          <SparkCard key={m.id} metric={m} sideAColor={sideAColor} sideBColor={sideBColor} />
        ))}
      </div>
    </section>
  );
}
