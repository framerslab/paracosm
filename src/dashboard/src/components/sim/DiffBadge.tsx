import * as React from 'react';
import type { TurnDiffClass } from './turn-diff.js';
import styles from './DiffBadge.module.scss';

void React;

interface DiffBadgeProps {
  classification: TurnDiffClass;
}

const TEXT: Record<TurnDiffClass, string> = {
  'same': '✓ SAME',
  'different-outcome': '⚠ DIFFERENT OUTCOME',
  'different-event': '⚠ DIFFERENT EVENT',
  'pending': '… running',
  'one-sided': '· · · waiting',
};

const ARIA: Record<TurnDiffClass, string> = {
  'same': 'Same event, same outcome',
  'different-outcome': 'Same event, different outcome',
  'different-event': 'Different events',
  'pending': 'Turn is still running',
  'one-sided': 'Only one leader has reached this turn',
};

const CLASS_NAME: Record<TurnDiffClass, string> = {
  'same': styles.same,
  'different-outcome': styles.differentOutcome,
  'different-event': styles.differentEvent,
  'pending': styles.pending,
  'one-sided': styles.oneSided,
};

export function DiffBadge({ classification }: DiffBadgeProps) {
  return (
    <span
      className={`${styles.badge} ${CLASS_NAME[classification]}`}
      aria-label={ARIA[classification]}
    >
      {TEXT[classification]}
    </span>
  );
}
