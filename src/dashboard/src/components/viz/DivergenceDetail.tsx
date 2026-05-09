/**
 * Optional divergence-detail panel rendered below HighlightStrip when
 * the diff overlay is on. Aggregates per-department divergence between
 * Leader A and Leader B at the current turn so the user sees, at a
 * glance, which departments are pulling the two simulations apart.
 *
 * Rendered as a horizontal strip of dept chips, sorted by magnitude
 * descending. Each chip carries the dept name + counts (`A: 4 / B: 0`)
 * with a magnitude-scaled outline that mirrors what DeptBand shows
 * when used inside the canvas grid.
 *
 * Pure presentational component. Diff math lives in viz-diff.ts; this
 * file only renders.
 *
 * @module viz/DivergenceDetail
 */
import * as React from 'react';
import type { CellDiff } from './viz-diff';
import styles from './DivergenceDetail.module.scss';

void React;

export interface DivergenceDetailProps {
  /** Per-department diff entries keyed by department id. Sorted internally
   *  by magnitude desc and the top 8 are surfaced. */
  diff: Map<string, CellDiff>;
  /** Display labels keyed by department id for the chip text. */
  departmentLabels: Record<string, string>;
}

const MAX_CHIPS = 8;

export function DivergenceDetail({ diff, departmentLabels }: DivergenceDetailProps) {
  const sorted = Array.from(diff.entries())
    .filter(([, d]) => d.magnitude > 0)
    .sort(([, x], [, y]) => y.magnitude - x.magnitude)
    .slice(0, MAX_CHIPS);

  if (sorted.length === 0) {
    return (
      <div className={styles.panel} role="status" aria-live="polite">
        <span className={styles.eyebrow}>Divergence detail</span>
        <span className={styles.empty}>No department-level divergence at this turn.</span>
      </div>
    );
  }

  return (
    <div className={styles.panel} role="status" aria-live="polite">
      <span className={styles.eyebrow}>Divergence detail</span>
      <ul className={styles.chipRow}>
        {sorted.map(([key, entry]) => {
          const label = departmentLabels[key] ?? key;
          const strong = entry.magnitude >= 0.5;
          const ariaText = `${label}: A has ${entry.aState.agentCount} agents (${entry.aState.dominantMood} mood); B has ${entry.bState.agentCount} agents (${entry.bState.dominantMood} mood)`;
          return (
            <li
              key={key}
              className={`${styles.chip} ${strong ? styles.chipStrong : styles.chipLight}`}
              title={ariaText}
              aria-label={ariaText}
            >
              <span className={styles.chipDept}>{label}</span>
              <span className={styles.chipCount}>
                A {entry.aState.agentCount} / B {entry.bState.agentCount}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
