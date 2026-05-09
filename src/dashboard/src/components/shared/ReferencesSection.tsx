import type { CitationRegistry } from '../../hooks/useCitationRegistry';
import styles from './ReferencesSection.module.scss';

interface ReferencesSectionProps {
  registry: CitationRegistry;
  /** Optional title override — defaults to "References". */
  title?: string;
  /** When true, render as a collapsible details element. */
  collapsible?: boolean;
  /** When true, start expanded. Ignored unless collapsible. */
  defaultOpen?: boolean;
  /** Optional callback fired when the user toggles the collapsible state. */
  onToggle?: (open: boolean) => void;
}

type Entry = CitationRegistry['list'][number];

function renderEntry(entry: Entry) {
  const depts = [...entry.departments].join(', ');
  const sidesLabel = [...entry.actorNames].join(' · ');
  return (
    <li key={entry.n} id={`cite-${entry.n}`} className={styles.item}>
      <span className={styles.itemNumber}>[{entry.n}]</span>
      <span>
        {entry.url ? (
          <a href={entry.url} target="_blank" rel="noopener noreferrer" className={styles.itemLink}>
            {entry.text}
          </a>
        ) : (
          <span className={styles.itemText}>{entry.text}</span>
        )}
        <div className={styles.itemMeta}>
          {entry.doi && <>DOI:{entry.doi} · </>}
          {depts && <>cited by {depts} · </>}
          <span title="Which leader's run referenced this source">leader {sidesLabel}</span>
        </div>
      </span>
    </li>
  );
}

/**
 * Numbered references list rendered at the bottom of a report or shown
 * inside a modal. Each entry's number matches the inline `[N]` pill
 * rendered in specialist_done citation rows. Departments that referenced each
 * source are listed for provenance.
 *
 * Two-column responsive grid mirrors the side-by-side leader columns.
 */
export function ReferencesSection({ registry, title = 'References', collapsible = false, defaultOpen = false, onToggle }: ReferencesSectionProps) {
  if (registry.list.length === 0) return null;

  const inner = <ol className={styles.list}>{registry.list.map(renderEntry)}</ol>;

  if (collapsible) {
    return (
      <details
        open={defaultOpen}
        onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
        className={styles.wrap}
      >
        <summary className={styles.summary}>
          {title} · {registry.list.length}
        </summary>
        {inner}
      </details>
    );
  }

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>{title} · {registry.list.length}</h3>
      {inner}
    </div>
  );
}

/** Just the inner numbered list — for embedding inside a modal. */
export function ReferencesList({ registry }: { registry: CitationRegistry }) {
  if (registry.list.length === 0) return null;
  return <ol className={styles.list}>{registry.list.map(renderEntry)}</ol>;
}
