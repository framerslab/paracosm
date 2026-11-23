import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './OneRowScroller.module.scss';

/** Props of {@link OneRowScroller}. */
export interface OneRowScrollerProps {
  /**
   * What the row holds, in words. Its arrow keys read "Show previous <label>"
   * and "Show next <label>".
   */
  label: string;
  /** The row's keys, in order. */
  children: ReactNode;
  /** A class for the outer box, which holds the arrow keys and the row. */
  className?: string;
  /** A class for the row itself: its gap and how it aligns its keys. */
  rowClassName?: string;
  /** An ARIA role for the row itself, such as "toolbar". */
  role?: string;
  /** The row's accessible name, given with `role`. */
  ariaLabel?: string;
}

/** How far one press of an arrow key moves the row: about one view. */
const VIEW_SHARE = 0.8;

/**
 * A row of keys that stays one row at every width. When its keys are wider
 * than the row, the row scrolls sideways: the edge that hides keys fades, and
 * a Previous and a Next key stand at its ends. Each press moves the row about
 * one view, gliding, or in one step under reduced motion. The keys follow
 * where the row stands, read as it moves: a key is disabled once the row
 * reaches its end, and a focused key the row reaches the end of hands focus
 * to the other, whether a press, a swipe or a trackpad moved the row. While
 * the keys fit, the row shows no arrow keys and no fade.
 */
export function OneRowScroller({ label, children, className, rowClassName, role, ariaLabel }: OneRowScrollerProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const handFocusTo = useRef<'previous' | 'next' | null>(null);
  const [edges, setEdges] = useState({ scrolls: false, previous: false, next: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    const box = row?.parentElement;
    if (!row || !box) return;
    // The row scrolls only while its keys are wider than the whole box: the
    // width the row has without the arrow keys, whose own width would
    // otherwise keep them shown once the keys fit again. That width lies
    // inside the box's own padding.
    const style = getComputedStyle(row);
    const boxStyle = getComputedStyle(box);
    const room = box.clientWidth
      - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight)
      - parseFloat(style.marginLeft) - parseFloat(style.marginRight);
    const scrolls = row.scrollWidth > room + 1;
    const end = row.scrollWidth - row.clientWidth;
    const previous = scrolls && row.scrollLeft > 1;
    const next = scrolls && row.scrollLeft < end - 1;
    // A focused key about to be disabled hands focus to the other key rather
    // than to the page. Its own disabled state is the one drawn now, so the
    // keys change and the hand-over runs once they are drawn.
    const active = document.activeElement;
    if (active === nextRef.current && !nextRef.current?.disabled && !next && previous) handFocusTo.current = 'previous';
    else if (active === previousRef.current && !previousRef.current?.disabled && !previous && next) handFocusTo.current = 'next';
    setEdges(e => (e.scrolls === scrolls && e.previous === previous && e.next === next ? e : { scrolls, previous, next }));
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    measure();
    // The row's width, and each key's, decide whether it scrolls: a key that
    // appears, goes or changes its words measures the row again.
    const sizes = new ResizeObserver(measure);
    const watchKeys = () => {
      sizes.disconnect();
      sizes.observe(row);
      if (row.parentElement) sizes.observe(row.parentElement);
      for (const key of Array.from(row.children)) sizes.observe(key);
    };
    watchKeys();
    const keys = new MutationObserver(() => { watchKeys(); measure(); });
    keys.observe(row, { childList: true, subtree: true, characterData: true });
    row.addEventListener('scroll', measure, { passive: true });
    return () => {
      sizes.disconnect();
      keys.disconnect();
      row.removeEventListener('scroll', measure);
    };
  }, [measure]);

  useEffect(() => {
    const to = handFocusTo.current;
    if (!to) return;
    handFocusTo.current = null;
    // Only while focus is still on an arrow key, or fell to the page when the
    // key was disabled: a control the person moved to keeps its focus.
    const active = document.activeElement;
    if (active && active !== document.body && active !== previousRef.current && active !== nextRef.current) return;
    // And only while the key it leaves is disabled as drawn: a row that came
    // back from its end before the keys were drawn keeps focus where it is.
    if ((to === 'previous' ? nextRef : previousRef).current?.disabled !== true) return;
    (to === 'previous' ? previousRef : nextRef).current?.focus();
  }, [edges]);

  const step = (direction: -1 | 1) => {
    const row = rowRef.current;
    if (!row) return;
    const end = row.scrollWidth - row.clientWidth;
    const left = Math.max(0, Math.min(end, row.scrollLeft + direction * row.clientWidth * VIEW_SHARE));
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The keys follow the row as it scrolls (measure): the pressed key stays
    // enabled while the row glides and is disabled when the row arrives at
    // its end, which is when focus goes on to the other key.
    row.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  };

  const { scrolls } = edges;

  return (
    <div className={[styles.scroller, className].filter(Boolean).join(' ')}>
      {scrolls && (
        <button
          ref={previousRef}
          type="button"
          className={styles.arrow}
          aria-label={`Show previous ${label}`}
          title={`Show previous ${label}`}
          disabled={!edges.previous}
          onClick={() => step(-1)}
        >
          <span aria-hidden="true">{'‹'}</span>
        </button>
      )}
      <div
        ref={rowRef}
        role={role}
        aria-label={ariaLabel}
        className={[styles.row, rowClassName].filter(Boolean).join(' ')}
        data-fade-start={edges.previous ? 'true' : 'false'}
        data-fade-end={edges.next ? 'true' : 'false'}
      >
        {children}
      </div>
      {scrolls && (
        <button
          ref={nextRef}
          type="button"
          className={styles.arrow}
          aria-label={`Show next ${label}`}
          title={`Show next ${label}`}
          disabled={!edges.next}
          onClick={() => step(1)}
        >
          <span aria-hidden="true">{'›'}</span>
        </button>
      )}
    </div>
  );
}
