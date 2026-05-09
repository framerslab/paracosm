/**
 * RiskFlagList: vertical severity-sorted list of risk callouts.
 *
 * Used in TimepointCard headers and in TrajectoryStrip column hovers.
 * `expandable` controls whether the optional `detail` field renders
 * inline; when false, only the label and severity pill render.
 */
import * as React from 'react';
import styles from './RiskFlagList.module.scss';
import type { RiskFlag } from './shared/types.js';

export interface RiskFlagListProps {
  flags: RiskFlag[];
  expandable?: boolean;
  className?: string;
}

const ORDER: Record<RiskFlag['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function RiskFlagList(props: RiskFlagListProps): JSX.Element {
  const { flags, expandable = false, className } = props;

  if (flags.length === 0) {
    return (
      <div className={[styles.list, className].filter(Boolean).join(' ')}>
        <span className={styles.empty}>No risks flagged.</span>
      </div>
    );
  }

  const sorted = [...flags].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return (
    <div className={[styles.list, className].filter(Boolean).join(' ')}>
      {sorted.map(flag => (
        <div key={flag.id}>
          <div className={styles.flag} data-severity={flag.severity}>
            <span aria-hidden="true">●</span>
            <span>{flag.label}</span>
          </div>
          {expandable && flag.detail && <div className={styles.detail}>{flag.detail}</div>}
        </div>
      ))}
    </div>
  );
}
