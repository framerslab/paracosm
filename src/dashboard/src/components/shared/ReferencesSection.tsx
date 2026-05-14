import { useEffect, useMemo, useState } from 'react';
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
 * Apply the active actor + department filters. Returns the subset of
 * entries that satisfy BOTH filters. `null` filter values mean
 * "everything" for that dimension. Kept outside the component so the
 * embedded `ReferencesList` can reuse the same projection — and so
 * the projection is unit-testable without a DOM.
 */
export function applyReferenceFilters(
  list: Entry[],
  actor: string | null,
  department: string | null,
): Entry[] {
  if (!actor && !department) return list;
  return list.filter(e => {
    if (actor && !e.actorNames.has(actor)) return false;
    if (department && !e.departments.has(department)) return false;
    return true;
  });
}

/** Build the dedup'd sorted facets we offer in the filter bar. */
export function collectReferenceFacets(list: Entry[]): { actors: string[]; departments: string[] } {
  const actors = new Set<string>();
  const departments = new Set<string>();
  for (const e of list) {
    for (const a of e.actorNames) actors.add(a);
    for (const d of e.departments) departments.add(d);
  }
  return {
    actors: [...actors].sort((a, b) => a.localeCompare(b)),
    departments: [...departments].sort((a, b) => a.localeCompare(b)),
  };
}

interface FilterBarProps {
  actors: string[];
  departments: string[];
  actorFilter: string | null;
  departmentFilter: string | null;
  onActorChange: (actor: string | null) => void;
  onDepartmentChange: (dept: string | null) => void;
  total: number;
  shown: number;
}

function FilterBar({ actors, departments, actorFilter, departmentFilter, onActorChange, onDepartmentChange, total, shown }: FilterBarProps) {
  // Show the bar whenever there's at least one axis worth filtering by
  // — pair runs surface both actors via the actor select, cohort runs
  // get both axes. Hidden for single-actor / single-department runs
  // since nothing meaningful narrows.
  if (actors.length < 2 && departments.length < 2) return null;
  return (
    <div className={styles.filterBar} role="region" aria-label="Filter references">
      {actors.length > 1 && (
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="references-actor-filter">
            Leader
          </label>
          <select
            id="references-actor-filter"
            className={styles.filterSelect}
            value={actorFilter ?? ''}
            onChange={(e) => onActorChange(e.target.value || null)}
          >
            <option value="">All leaders</option>
            {actors.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      )}
      {departments.length > 1 && (
        <div className={styles.filterField}>
          <label className={styles.filterLabel} htmlFor="references-department-filter">
            Department
          </label>
          <select
            id="references-department-filter"
            className={styles.filterSelect}
            value={departmentFilter ?? ''}
            onChange={(e) => onDepartmentChange(e.target.value || null)}
          >
            <option value="">All departments</option>
            {departments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}
      <span className={styles.filterStats}>
        Showing {shown} of {total}
      </span>
    </div>
  );
}

/**
 * Numbered references list rendered at the bottom of a report or shown
 * inside a modal. Each entry's number matches the inline `[N]` pill
 * rendered in specialist_done citation rows.
 *
 * Filter bar (actor + department selects) sits above the list so the
 * user can pivot a single combined list into per-actor / per-department
 * slices — previously every reference rendered as one flat 24-entry
 * block regardless of who cited it, which was the user-reported pain
 * for cohort runs.
 *
 * Two-column responsive grid mirrors the side-by-side leader columns.
 */
export function ReferencesSection({ registry, title = 'References', collapsible = false, defaultOpen = false, onToggle }: ReferencesSectionProps) {
  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);

  const { actors, departments } = useMemo(() => collectReferenceFacets(registry.list), [registry.list]);
  const filtered = useMemo(
    () => applyReferenceFilters(registry.list, actorFilter, departmentFilter),
    [registry.list, actorFilter, departmentFilter],
  );

  // Defensive filter reset when an inline citation pill targets a
  // reference that's been filtered out. Without this, clicking `[7]`
  // in an event card while the actor filter is set to a different
  // leader scrolls to nothing because the `#cite-7` anchor was
  // hidden by the filter. Watch the URL hash + auto-clear the
  // filters when the requested entry isn't visible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => {
      const match = window.location.hash.match(/^#cite-(\d+)$/);
      if (!match) return;
      const n = Number(match[1]);
      if (!Number.isFinite(n)) return;
      const visible = filtered.some(e => e.n === n);
      if (visible) return;
      const exists = registry.list.some(e => e.n === n);
      if (!exists) return;
      // Entry is in the master list but hidden by the active filter
      // combo — drop both filters so the scroll target appears.
      setActorFilter(null);
      setDepartmentFilter(null);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [filtered, registry.list]);

  if (registry.list.length === 0) return null;

  const filterBar = (
    <FilterBar
      actors={actors}
      departments={departments}
      actorFilter={actorFilter}
      departmentFilter={departmentFilter}
      onActorChange={setActorFilter}
      onDepartmentChange={setDepartmentFilter}
      total={registry.list.length}
      shown={filtered.length}
    />
  );

  const inner = filtered.length > 0
    ? <ol className={styles.list}>{filtered.map(renderEntry)}</ol>
    : <div className={styles.empty}>No references match the current filters.</div>;

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
        {filterBar}
        {inner}
      </details>
    );
  }

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>{title} · {registry.list.length}</h3>
      {filterBar}
      {inner}
    </div>
  );
}

/** Just the inner numbered list — for embedding inside a modal. */
export function ReferencesList({ registry }: { registry: CitationRegistry }) {
  if (registry.list.length === 0) return null;
  return <ol className={styles.list}>{registry.list.map(renderEntry)}</ol>;
}
