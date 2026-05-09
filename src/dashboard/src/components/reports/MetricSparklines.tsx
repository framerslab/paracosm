/**
 * Six compact SVG sparklines, one per world metric, overlaying
 * A and B so the user sees where the curves cross across the run.
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

  const all = [...metric.a, ...metric.b];
  if (all.length === 0) return null;

  const minTurn = Math.min(...all.map(p => p.turn));
  const maxTurn = Math.max(...all.map(p => p.turn));
  const minVal = Math.min(...all.map(p => p.value));
  const maxVal = Math.max(...all.map(p => p.value));
  const valRange = Math.max(1e-6, maxVal - minVal);
  const turnRange = Math.max(1, maxTurn - minTurn);

  const xFor = (turn: number) => padX + (W - padX * 2) * ((turn - minTurn) / turnRange);
  const yFor = (value: number) => padY + (H - padY * 2) * (1 - (value - minVal) / valRange);

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
  const populated = metrics.filter(m => m.a.length > 0 || m.b.length > 0);
  if (populated.length === 0) return null;

  const themeStyle = {
    '--side-a-color': sideAColor,
    '--side-b-color': sideBColor,
  } as CSSProperties;

  return (
    <section aria-label="Metric sparklines" className={styles.section} style={themeStyle}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Metric Trajectories</span>
        <span className={styles.legend}>
          <span className={styles.legendA}>{leaderAName}</span>
          {' · '}
          <span className={styles.legendB}>{leaderBName}</span>
        </span>
      </div>
      <div className={`responsive-grid-3 ${styles.grid}`}>
        {populated.map(m => (
          <SparkCard key={m.id} metric={m} sideAColor={sideAColor} sideBColor={sideBColor} />
        ))}
      </div>
    </section>
  );
}
