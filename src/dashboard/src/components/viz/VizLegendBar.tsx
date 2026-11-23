/**
 * Always-visible 4-glyph legend strip + a "Show full legend" popover.
 * The inline strip is glanceable; the popover carries the full color
 * map (departments, mood tiers) and every mark the strip shows. Dismissed
 * with Esc, with the click outside the popover, or with the Close button.
 * Focus is trapped per existing dashboard conventions while open.
 *
 * The strip is one row at every width it shows at: each mark keeps its
 * glyph and its words together, and a mark the row has no room for is
 * left out of the row, one key away in the popover.
 *
 * @module viz/VizLegendBar
 */
import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './VizLegendBar.module.scss';

void React;

/** Department entry surfaced in the popover's color-map list. */
export interface VizLegendDept {
  id: string;
  label: string;
  color: string;
}

type GlyphType = 'band' | 'agent' | 'featured' | 'turn';

/** The marks on the grid, in the order the strip shows them. */
const MARKS: ReadonlyArray<{ type: GlyphType; label: string }> = [
  { type: 'band', label: 'Department band' },
  { type: 'agent', label: 'Agent' },
  { type: 'featured', label: 'Featured agent' },
  { type: 'turn', label: 'Turn marker' },
];

export interface VizLegendBarProps {
  /** Active scenario's department list with display color. */
  departments: ReadonlyArray<VizLegendDept>;
}

export function VizLegendBar({ departments }: VizLegendBarProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useFocusTrap<HTMLDivElement>(open);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Esc closes the popover. Outside-click closes too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className={styles.bar} aria-label="Visualization legend" ref={wrapRef}>
      <span className={styles.glyphRow}>
        {MARKS.map(({ type, label }) => (
          <span key={type} className={styles.mark}>
            <Glyph type={type} />
            <span className={styles.label}>{label}</span>
          </span>
        ))}
      </span>
      <button
        type="button"
        className={styles.fullLegend}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Show full legend
      </button>
      {open && (
        <div
          className={styles.popover}
          role="dialog"
          aria-modal="true"
          aria-labelledby="viz-legend-heading"
          tabIndex={-1}
          ref={popoverRef}
        >
          <h3 id="viz-legend-heading" className={styles.popHeading}>
            What you&rsquo;re looking at
          </h3>
          <section>
            <h4>Marks on the grid</h4>
            <ul className={styles.markList}>
              {MARKS.map(({ type, label }) => (
                <li key={type}>
                  <Glyph type={type} />
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4>Departments (tile color)</h4>
            <ul className={styles.deptList}>
              {departments.map((d) => (
                <li key={d.id}>
                  <span
                    className={styles.deptSwatch}
                    style={{ background: d.color }}
                    aria-hidden="true"
                  />
                  {d.label}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4>Mood tiers (chip glyph)</h4>
            <ul className={styles.moodList}>
              <li>
                <span aria-hidden="true">▼</span> low (under 25% morale)
              </li>
              <li>
                <span aria-hidden="true">▽</span> tense (25–50%)
              </li>
              <li>
                <span aria-hidden="true">△</span> steady (50–75%)
              </li>
              <li>
                <span aria-hidden="true">▲</span> rising (over 75%)
              </li>
            </ul>
          </section>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setOpen(false)}
            aria-label="Close legend"
          >
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}

function Glyph({ type }: { type: GlyphType }) {
  switch (type) {
    case 'band':
      return <span className={`${styles.glyph} ${styles.band}`} aria-hidden="true" />;
    case 'agent':
      return <span className={`${styles.glyph} ${styles.agent}`} aria-hidden="true" />;
    case 'featured':
      return <span className={`${styles.glyph} ${styles.featured}`} aria-hidden="true" />;
    case 'turn':
      return (
        <span className={`${styles.glyph} ${styles.turn}`} aria-hidden="true">
          T
        </span>
      );
  }
}
