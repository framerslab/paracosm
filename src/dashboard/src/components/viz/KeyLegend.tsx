import { useLayoutEffect, useRef, useState } from 'react';
import styles from './KeyLegend.module.scss';

/** One keyboard hint: the key and what it does. */
export interface KeyHint {
  k: string;
  v: string;
}

interface KeyLegendProps {
  /** The hints, most useful first: a narrow row keeps the first ones. */
  hints: readonly KeyHint[];
  /** Opens the list of every key: the help overlay's Keyboard section. */
  onShowAll: () => void;
}

/** The words on the key that opens the full list. */
const ALL_KEYS = 'All keys';

/**
 * The Viz tab's keyboard legend: one row at every width from 320 px, its
 * words at 15 px. It shows the hints that fit, in order, and where some do
 * not, a key that opens the help overlay, whose Keyboard section lists every
 * key. A hidden copy of the row, laid out at its own width, measures each
 * hint and that key, so the count follows the type as it loads and the row as
 * it resizes.
 */
export function KeyLegend({ hints, onShowAll }: KeyLegendProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(hints.length);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const copy = copyRef.current;
    if (!row || !copy) return;
    const fit = () => {
      const style = getComputedStyle(row);
      // A pixel to spare, so rounding never pushes the last part out.
      const room = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 1;
      const gap = parseFloat(style.columnGap) || 0;
      const widths = Array.from(copy.children).map(c => c.getBoundingClientRect().width);
      const hintWidths = widths.slice(0, hints.length);
      const allKey = widths[hints.length] ?? 0;
      const whole = hintWidths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, hintWidths.length - 1);
      let count = hints.length;
      if (whole > room) {
        let used = allKey;
        count = 0;
        for (const w of hintWidths) {
          if (used + gap + w > room) break;
          used += gap + w;
          count += 1;
        }
      }
      // The first hint always stands, so the row is never only a key.
      const next = Math.max(1, count);
      setShown(prev => (prev === next ? prev : next));
    };
    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(row);
    sizes.observe(copy);
    return () => sizes.disconnect();
  }, [hints]);

  const some = shown < hints.length;

  return (
    <>
      <div ref={rowRef} className={styles.row}>
        {hints.slice(0, shown).map(h => (
          <span key={h.k} className={styles.hint}>
            <kbd className={styles.key}>{h.k}</kbd>
            <span className={styles.label}>{h.v}</span>
          </span>
        ))}
        {some && (
          <button
            type="button"
            onClick={onShowAll}
            aria-label={`Show all ${hints.length} keyboard keys`}
            title="Every keyboard key, in the help overlay"
            className={styles.allKeys}
          >
            {ALL_KEYS}
          </button>
        )}
      </div>
      <div ref={copyRef} className={[styles.row, styles.copy].join(' ')} aria-hidden="true">
        {hints.map(h => (
          <span key={h.k} className={styles.hint}>
            <span className={styles.key}>{h.k}</span>
            <span className={styles.label}>{h.v}</span>
          </span>
        ))}
        <span className={styles.allKeys}>{ALL_KEYS}</span>
      </div>
    </>
  );
}
