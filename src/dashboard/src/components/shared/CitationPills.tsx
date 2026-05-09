import { useCitationContext, type CitationEntry } from '../../hooks/useCitationRegistry';
import { Tooltip } from './Tooltip';
import styles from './CitationPills.module.scss';

interface CitationPillsProps {
  citations: Array<{ text?: string; url?: string; doi?: string }>;
  /** Override the leading label. Empty string hides the label. */
  label?: string;
  /** When true, no top border / padding — for use inline within a header. */
  inline?: boolean;
}

/**
 * Compact `[1] [2] [3]` numbered pills replacing verbose inline citation
 * lists. Each pill is wrapped in a Tooltip showing the full claim, source,
 * DOI, and URL on hover. Click opens the URL (or scrolls to the matching
 * `#cite-N` entry in the References section when no URL is available).
 *
 * If no citations resolve to registry numbers, renders nothing.
 */
export function CitationPills({ citations, label = 'sources', inline = false }: CitationPillsProps) {
  const registry = useCitationContext();
  if (!citations || citations.length === 0) return null;

  // Resolve to unique registry numbers, preserving first-seen order
  const seen = new Set<number>();
  const numbered: Array<{ n: number; entry: CitationEntry | { text: string; url: string; doi?: string } }> = [];
  for (const c of citations) {
    const url = (c.url || '').trim();
    const text = (c.text || '').trim();
    if (!url && !text) continue;
    if (!url && text === 'Seed document') continue;
    const lookup = url || text;
    const n = registry.getNumber(lookup);
    if (n === 0 || seen.has(n)) continue;
    seen.add(n);
    const entry = registry.getEntry(lookup);
    numbered.push({
      n,
      entry: entry ?? { text: text || url, url, doi: c.doi },
    });
  }

  if (numbered.length === 0) return null;

  return (
    <div className={[styles.row, inline ? styles.inline : ''].filter(Boolean).join(' ')}>
      {label && <span className={styles.label}>{label}</span>}
      {numbered.map(({ n, entry }) => (
        <CitationPill key={n} n={n} entry={entry} />
      ))}
    </div>
  );
}

function CitationPill({ n, entry }: { n: number; entry: CitationEntry | { text: string; url: string; doi?: string } }) {
  const url = entry.url || '';
  const text = entry.text || url || `Source [${n}]`;
  const doi = entry.doi;
  const departments = (entry as CitationEntry).departments
    ? [...(entry as CitationEntry).departments]
    : [];
  const actorNames = (entry as CitationEntry).actorNames
    ? [...(entry as CitationEntry).actorNames]
    : [];

  const popover = (
    <div className={styles.popoverWrap}>
      <div className={styles.popoverHeader}>REFERENCE [{n}]</div>
      <div className={styles.popoverText}>{text}</div>
      {url && (
        <div className={styles.popoverUrlRow}>
          <a href={url} target="_blank" rel="noopener noreferrer" className={styles.popoverUrl}>
            {url}
          </a>
        </div>
      )}
      {doi && <div className={styles.popoverDoi}>DOI:{doi}</div>}
      {(departments.length > 0 || actorNames.length > 0) && (
        <div className={styles.popoverProvenance}>
          {departments.length > 0 && <>cited by {departments.join(', ')} · </>}
          {actorNames.length > 0 && <>leader {actorNames.join(' · ')}</>}
        </div>
      )}
      <div className={styles.popoverHint}>
        Click to open source · or scroll to References below
      </div>
    </div>
  );

  return (
    <Tooltip content={popover}>
      <a
        href={url || `#cite-${n}`}
        target={url ? '_blank' : undefined}
        rel={url ? 'noopener noreferrer' : undefined}
        onClick={(e) => {
          const ref = document.getElementById(`cite-${n}`);
          if (ref) {
            if (!url) e.preventDefault();
            ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
            ref.style.transition = 'background 0.4s';
            ref.style.background = 'rgba(232,180,74,0.18)';
            setTimeout(() => { ref.style.background = ''; }, 1200);
          }
        }}
        className={styles.pill}
      >
        [{n}]
      </a>
    </Tooltip>
  );
}
