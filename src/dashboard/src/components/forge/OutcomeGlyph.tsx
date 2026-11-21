import type { ReactNode } from 'react';
import type { GlyphKind } from './forgeLine';
import styles from './OutcomeGlyph.module.scss';

/**
 * Each outcome's one glyph shape, drawn in currentColor on a 20 unit grid:
 * Passed a check in a filled circle; Rejected by the judge a cross in a
 * circle; Not judged a question mark in a hollow circle; Refused a struck
 * circle; Failed a triangle with a bar; Did not pass a dashed circle. The
 * glyph is drawn only: the outcome's word always sits beside it.
 */
function shape(kind: GlyphKind, stroke: number, dash: string): ReactNode {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const ring = <circle cx="10" cy="10" r="8.25" {...line} />;
  switch (kind) {
    case 'passed':
      // A filled circle with the check cut out of it, so the ground shows through.
      return (
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M1 10a9 9 0 1 0 18 0a9 9 0 1 0 -18 0Z M4.75 11.05L8.63 14.93L15.28 7.82L13.52 6.18L8.57 11.47L6.45 9.35Z"
        />
      );
    case 'rejected':
      return <>{ring}<path d="M6.9 6.9L13.1 13.1M13.1 6.9L6.9 13.1" {...line} /></>;
    case 'refused':
      return <>{ring}<path d="M4.2 15.8L15.8 4.2" {...line} /></>;
    case 'failed':
      return <><path d="M10 2.2L18.2 16.8H1.8Z" {...line} /><path d="M10 7.4V12.2" {...line} /></>;
    case 'notJudged':
      return (
        <>
          {ring}
          <path d="M7.7 7.9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.2.9-1.2 1.7v.4" {...line} />
          <circle cx="10" cy="14.5" r="1.1" fill="currentColor" />
        </>
      );
    case 'didNotPass':
      return <circle cx="10" cy="10" r="8.25" {...line} strokeLinecap="butt" strokeDasharray={dash} />;
  }
}

export function OutcomeGlyph({ kind, size }: { kind: GlyphKind; size: 10 | 20 }) {
  // A 20 unit grid drawn at 10 px halves every stroke, so the small glyph draws thicker in grid units.
  const stroke = size === 10 ? 3 : 1.75;
  const dash = size === 10 ? '5 4' : '2.6 2.1';
  return (
    <svg
      className={`${styles.glyph} ${styles[kind]}`}
      data-glyph={kind}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      {shape(kind, stroke, dash)}
    </svg>
  );
}
