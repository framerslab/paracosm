/**
 * The drawn marks of the Run tab's first screen, as inline SVG in the page's
 * own HTML, so they show when a script or a request fails. Each is hidden
 * from screen readers: the words beside it say the same thing.
 *
 * Each mark draws in currentColor, set on the mark to its token: the accent
 * for the section triangle and the warning glyph, the ink for the broken link.
 *
 * @module paracosm/dashboard/quickstart/first-screen/marks
 */

interface MarkProps {
  className?: string;
}

/** The small triangle that leads a section mark, in the accent. */
export function SectionMark({ className }: MarkProps) {
  return (
    <svg
      className={className}
      style={{ color: 'var(--amber)' }}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      data-glyph="section"
    >
      <path d="M3 1.5 10.5 6 3 10.5Z" fill="currentColor" />
    </svg>
  );
}

/** Two chain links pulled apart, in the ink: beside every did-not-load and every offline sentence. */
export function BrokenLinkMark({ className }: MarkProps) {
  return (
    <svg
      className={className}
      style={{ color: 'var(--text-1)' }}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-mark="broken-link"
    >
      <path d="M10 14.5 7.2 17.3a3 3 0 0 1-4.24-4.24L5.8 10.2a3 3 0 0 1 4.2-.05" />
      <path d="M14 9.5 16.8 6.7a3 3 0 0 1 4.24 4.24L18.2 13.8a3 3 0 0 1-4.2.05" />
      <path d="M8.5 2.5v2.5M2.5 8.5H5M15.5 21.5V19M21.5 15.5H19" />
    </svg>
  );
}

/** A triangle with a bar and a dot, in the accent: beside every failure sentence that is not a lost load. */
export function WarningGlyph({ className }: MarkProps) {
  return (
    <svg
      className={className}
      style={{ color: 'var(--amber)' }}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-mark="warning"
    >
      <path d="M10 2.5 18 17H2Z" />
      <path d="M10 8v4" />
      <path d="M10 14.5h.01" />
    </svg>
  );
}
