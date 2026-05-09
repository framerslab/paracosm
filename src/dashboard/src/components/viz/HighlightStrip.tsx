/**
 * Single-line strip rendered above the VIZ sub-tab bar. Carries the
 * computed turn highlight (from {@link computeTurnHighlight}) so a
 * first-time viewer reads what diverged this turn before hunting
 * through five sub-tabs.
 *
 * `role="status"` + `aria-live="polite"` so screen readers announce as
 * the user scrubs the timeline. Truncates at 120 chars with a More /
 * Less toggle so a long divergence line never breaks the layout.
 *
 * @module viz/HighlightStrip
 */
import * as React from 'react';
import { useState } from 'react';
import styles from './HighlightStrip.module.scss';

void React;

const TRUNCATE_AT = 120;

export interface HighlightStripProps {
  text: string;
  /** Display-only — exposed as `data-turn` so a future visual-regression
   *  snapshot can pin the strip to a specific turn for fixturing. */
  turn: number;
}

export function HighlightStrip({ text, turn }: HighlightStripProps) {
  const [expanded, setExpanded] = useState(false);
  const overflow = text.length > TRUNCATE_AT;
  const truncated = overflow && !expanded;
  const display = truncated ? `${text.slice(0, TRUNCATE_AT - 1)}…` : text;
  return (
    <div
      className={styles.strip}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-turn={turn}
    >
      <span className={styles.text}>{display}</span>
      {overflow && (
        <button
          type="button"
          className={styles.expand}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}
