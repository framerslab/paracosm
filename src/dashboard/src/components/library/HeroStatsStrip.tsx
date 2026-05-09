import * as React from 'react';
import styles from './HeroStatsStrip.module.scss';
import { useRunsAggregate } from './hooks/useRunsAggregate.js';

export interface HeroStatsStripProps {
  filters: { mode?: string; scenario?: string; leader?: string };
}

const fmtCurrency = (n: number): string => {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

const fmtDuration = (ms: number): string => {
  const minutes = ms / 60000;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
  if (minutes >= 1) return `${minutes.toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export function HeroStatsStrip(props: HeroStatsStripProps): JSX.Element {
  const { stats, loading, error } = useRunsAggregate(props.filters);

  if (loading) {
    return (
      <div className={styles.strip}>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className={styles.skeleton} />)}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className={styles.strip}>
        <div className={styles.error}>Stats unavailable: {error ?? 'unknown'}</div>
      </div>
    );
  }

  const replayPct = stats.replaysAttempted > 0
    ? Math.round((stats.replaysMatched / stats.replaysAttempted) * 100)
    : null;

  const replayValueClass =
    replayPct === null ? styles.neutral :
    replayPct >= 95 ? styles.ok :
    replayPct >= 80 ? styles.warn :
    styles.critical;

  return (
    <div className={styles.strip}>
      <Stat label="Runs" value={String(stats.totalRuns)} />
      <Stat label="Spent" value={fmtCurrency(stats.totalCostUSD)} />
      <Stat label="Avg / run" value={fmtCurrency(stats.totalCostUSD / Math.max(stats.totalRuns, 1))} />
      <Stat label="Total time" value={fmtDuration(stats.totalDurationMs)} />
      <Stat
        label="Replay match"
        value={replayPct === null ? 'n/a' : `${replayPct}%`}
        valueClassName={replayValueClass}
      />
    </div>
  );
}

function Stat(props: { label: string; value: string; valueClassName?: string }): JSX.Element {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{props.label}</span>
      <span className={[styles.statValue, props.valueClassName ?? ''].filter(Boolean).join(' ')}>{props.value}</span>
    </div>
  );
}
