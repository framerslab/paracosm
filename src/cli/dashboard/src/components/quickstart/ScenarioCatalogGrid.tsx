/**
 * Scenario catalog grid for the Quickstart tab.
 *
 * Renders every entry the server returns from `GET /scenarios` as a
 * card with name, source badge (builtin / disk / compiled), run count,
 * age, and an optional seed-text preview when the scenario was
 * compiled from a brief. Clicking a card's Run button switches the
 * server's active scenario to that id, persists the user's actor-
 * count pick, and triggers a launch — replaces the previous "open
 * Settings → switch → come back to Quickstart" flow with a single
 * surface the user can browse.
 *
 * The component renders nothing when the catalog has fewer than 2
 * entries (a single-entry "catalog" is just the loaded scenario the
 * LoadedScenarioCTA already covers above).
 *
 * @module paracosm/dashboard/quickstart/ScenarioCatalogGrid
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useScenarioContext } from '../../App';
import { ScenarioDetailDrawer } from './ScenarioDetailDrawer';
import styles from './ScenarioCatalogGrid.module.scss';

void React;

/**
 * One entry from `GET /scenarios`, with the server-side metadata
 * extensions added in the auto-persist work — `compiledAt`,
 * `seedText`, and `runCount` are only present when the server has
 * them (builtins have no seedText; brand-new compiles have no
 * runCount yet).
 */
export interface CatalogScenario {
  id: string;
  name: string;
  description?: string;
  departments?: number;
  source?: string;
  compiledAt?: string;
  seedText?: string | null;
  runCount?: number;
}

export interface ScenarioCatalogGridProps {
  /** Disabled flag from the parent — prevents card clicks during a
   *  running compile / setup. */
  disabled?: boolean;
  /** Fired after the user clicks Run on a card. The parent is
   *  responsible for switching the server's active scenario (POST
   *  /scenario/switch) and starting the run. */
  onRunScenario: (id: string, actorCount: number) => void;
}

/**
 * Render an ISO-8601 timestamp as a coarse "X days ago" affix. Same
 * shape as the LoadedScenarioCTA dropdown's age formatter so the two
 * surfaces read consistently.
 */
function formatAge(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(iso).getFullYear().toString();
}

/** Map a source enum to a CSS-friendly modifier slug. */
function sourceTone(source?: string): 'builtin' | 'disk' | 'compiled' | 'memory' | 'other' {
  if (source === 'builtin') return 'builtin';
  if (source === 'disk') return 'disk';
  if (source === 'compiled') return 'compiled';
  if (source === 'memory') return 'memory';
  return 'other';
}

/** Friendlier label per source type than the raw enum string. */
function sourceLabel(source?: string): string {
  if (source === 'builtin') return 'Built-in';
  if (source === 'disk') return 'Saved';
  if (source === 'compiled') return 'Custom';
  if (source === 'memory') return 'Memory';
  return source ?? 'Unknown';
}

/** Source filter chip values. `all` is the no-filter default; the
 *  rest mirror the source-tone slugs used on the cards so the chip
 *  semantics stay 1:1 with the badges. */
type SourceFilter = 'all' | 'builtin' | 'disk' | 'compiled';

export function ScenarioCatalogGrid(props: ScenarioCatalogGridProps): JSX.Element | null {
  const { disabled = false, onRunScenario } = props;
  const scenario = useScenarioContext();
  const activeId = scenario.id;
  const [scenarios, setScenarios] = useState<CatalogScenario[]>([]);
  const [actorCount, setActorCount] = useState<number>(2);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Search query is debounced via a delayed setter below so a fast
  // typist doesn't re-filter the grid on every keystroke. The raw
  // input value drives the controlled <input>; the debounced value
  // drives the actual filter. Trims + lowercases at compare time.
  const [queryInput, setQueryInput] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(queryInput), 120);
    return () => clearTimeout(handle);
  }, [queryInput]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  // Detail drawer state. Click a card body to open with that
  // scenario; close via Esc, backdrop click, or the X. Stays scoped
  // to the grid component because the detail view is a "dive into a
  // catalog entry" affordance — outside this surface it would need
  // routing of its own (URL hash, etc.) which is out of scope here.
  const [detailScenario, setDetailScenario] = useState<CatalogScenario | null>(null);

  // Catalog refresh on mount + a soft 30s poll so a freshly-compiled
  // scenario from another browser tab (or a friend on the same hosted
  // demo) lands in the grid without needing a manual reload. Keeps
  // network traffic minimal — one GET every 30s, body ≤ a few KB.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchCatalog = async () => {
      try {
        const res = await fetch('/scenarios');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { scenarios?: CatalogScenario[] };
        if (cancelled) return;
        setScenarios(body.scenarios ?? []);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchCatalog();
    timer = setInterval(fetchCatalog, 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (loading && scenarios.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="scenario-catalog-heading">
        <h3 className={styles.heading} id="scenario-catalog-heading">All scenarios</h3>
        <p className={styles.statusLine}>Loading catalog…</p>
      </section>
    );
  }
  if (error && scenarios.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="scenario-catalog-heading">
        <h3 className={styles.heading} id="scenario-catalog-heading">All scenarios</h3>
        <p className={`${styles.statusLine} ${styles.error}`} role="alert">
          Failed to load catalog: {error}
        </p>
      </section>
    );
  }
  // Hide entirely when the catalog only has the active scenario —
  // the LoadedScenarioCTA above already covers that single-entry case.
  if (scenarios.length < 2) return null;

  const sliderId = 'scenario-catalog-actor-count';
  const searchInputId = 'scenario-catalog-search';
  const filtersActive = debouncedQuery.trim().length > 0 || sourceFilter !== 'all';

  // Filter pipeline: source-chip → free-text → sort. The active
  // scenario stays pinned to position 0 regardless of filter so users
  // never lose track of it; filtering it OUT of the list mid-search
  // would be a reasonable behavior too, but pinning matches the
  // LoadedScenarioCTA's "this one is loaded" framing above the grid.
  const queryNeedle = debouncedQuery.trim().toLowerCase();
  const filtered = scenarios.filter((s) => {
    if (s.id === activeId) return true; // always show active
    if (sourceFilter !== 'all' && s.source !== sourceFilter) return false;
    if (queryNeedle.length === 0) return true;
    const haystack = [
      s.name,
      s.id,
      s.seedText ?? '',
      s.description ?? '',
    ].join(' ').toLowerCase();
    return haystack.includes(queryNeedle);
  });

  // Sort: active first, then most-run, then newest, then alphabetical.
  const sorted = [...filtered].sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    const runDiff = (b.runCount ?? 0) - (a.runCount ?? 0);
    if (runDiff !== 0) return runDiff;
    if (a.compiledAt && b.compiledAt) {
      const aTime = Date.parse(a.compiledAt);
      const bTime = Date.parse(b.compiledAt);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
    }
    return a.name.localeCompare(b.name);
  });

  // Per-chip count for the filter row. Surfacing them as suffixes
  // (`Built-in 2`) tells the user how many entries they'll see before
  // they click — reduces the "filter to nothing then back out" cycle
  // when e.g. there are no Saved scenarios on a fresh install.
  const sourceCounts = scenarios.reduce<Record<string, number>>((acc, s) => {
    const key = s.source ?? 'other';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const chipDefs: Array<{ key: SourceFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'builtin', label: 'Built-in' },
    { key: 'disk', label: 'Saved' },
    { key: 'compiled', label: 'Custom' },
  ];

  return (
    <section className={styles.section} aria-labelledby="scenario-catalog-heading">
      <header className={styles.header}>
        <h3 className={styles.heading} id="scenario-catalog-heading">
          All scenarios{' '}
          <span className={styles.count}>
            · {filtersActive ? `${sorted.length} of ${scenarios.length}` : scenarios.length}
          </span>
        </h3>
        <div className={styles.actorRow}>
          <label className={styles.actorLabel} htmlFor={sliderId}>Actors</label>
          <input
            id={sliderId}
            type="range"
            min={1}
            max={300}
            value={actorCount}
            onChange={(e) => setActorCount(parseInt(e.target.value, 10))}
            disabled={disabled}
            className={styles.actorSlider}
            aria-label="Number of parallel actors per scenario run"
          />
          <span className={styles.actorValue}>{actorCount}</span>
        </div>
      </header>
      <div className={styles.filterRow}>
        <label className={styles.searchLabel} htmlFor={searchInputId}>
          <span className="sr-only">Search scenarios</span>
          <input
            id={searchInputId}
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search by name or seed text…"
            className={styles.searchInput}
            aria-label="Filter catalog by name or seed text"
          />
        </label>
        <div className={styles.chipGroup} role="group" aria-label="Filter by scenario source">
          {chipDefs.map((c) => {
            const total = c.key === 'all'
              ? scenarios.length
              : (sourceCounts[c.key] ?? 0);
            const active = sourceFilter === c.key;
            // Hide chips with no entries so a fresh-install single-
            // builtin user doesn't see four empty filter buttons.
            if (c.key !== 'all' && total === 0) return null;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setSourceFilter(c.key)}
                className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                aria-pressed={active}
              >
                {c.label} <span className={styles.chipCount}>{total}</span>
              </button>
            );
          })}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className={styles.emptyMatches} role="status" aria-live="polite">
          No scenarios match your filter.{' '}
          <button
            type="button"
            className={styles.clearFiltersBtn}
            onClick={() => { setQueryInput(''); setSourceFilter('all'); }}
          >
            Clear filters
          </button>
        </div>
      ) : (
      <ul className={styles.grid} role="list">
        {sorted.map((s) => {
          const tone = sourceTone(s.source);
          const isActive = s.id === activeId;
          return (
            <li key={s.id} className={`${styles.card} ${styles[`tone_${tone}`] ?? ''} ${isActive ? styles.cardActive : ''}`.trim()}>
              {/* Card body is a button so the whole top region is
                  clickable for opening the detail drawer. The Run
                  button below stops propagation so clicks there
                  don't double-fire (drawer-open + run). */}
              <button
                type="button"
                className={styles.cardBody}
                onClick={() => setDetailScenario(s)}
                aria-label={`View detail for ${s.name}`}
              >
                <div className={styles.cardHeader}>
                  <span className={`${styles.sourceBadge} ${styles[`badge_${tone}`] ?? ''}`}>
                    {sourceLabel(s.source)}
                  </span>
                  {isActive && <span className={styles.activeBadge}>Loaded</span>}
                </div>
                <h4 className={styles.cardName}>{s.name}</h4>
                {s.seedText && (
                  <p className={styles.cardSeed} title={s.seedText}>
                    {s.seedText.slice(0, 140)}{s.seedText.length > 140 ? '…' : ''}
                  </p>
                )}
                <dl className={styles.cardStats}>
                  {typeof s.runCount === 'number' && s.runCount > 0 && (
                    <div className={styles.stat}>
                      <dt className={styles.statKey}>Runs</dt>
                      <dd className={styles.statValue}>{s.runCount.toLocaleString()}</dd>
                    </div>
                  )}
                  {typeof s.departments === 'number' && s.departments > 0 && (
                    <div className={styles.stat}>
                      <dt className={styles.statKey}>Depts</dt>
                      <dd className={styles.statValue}>{s.departments}</dd>
                    </div>
                  )}
                  {s.compiledAt && (
                    <div className={styles.stat}>
                      <dt className={styles.statKey}>Compiled</dt>
                      <dd className={styles.statValue}>{formatAge(s.compiledAt) || s.compiledAt.slice(0, 10)}</dd>
                    </div>
                  )}
                </dl>
              </button>
              <button
                type="button"
                className={styles.runButton}
                onClick={(e) => {
                  // stopPropagation isn't strictly needed here because
                  // the parent .cardBody is a sibling button (not an
                  // ancestor), but keeping it explicit guards against
                  // a future refactor that wraps the whole card in a
                  // single click target.
                  e.stopPropagation();
                  onRunScenario(s.id, actorCount);
                }}
                disabled={disabled}
                aria-label={`Run ${actorCount} actor${actorCount === 1 ? '' : 's'} against ${s.name}`}
              >
                Run {actorCount} {actorCount === 1 ? 'actor' : 'actors'} →
              </button>
            </li>
          );
        })}
      </ul>
      )}
      <ScenarioDetailDrawer
        scenario={detailScenario}
        disabled={disabled}
        initialActorCount={actorCount}
        onRunScenario={(id, count) => {
          setDetailScenario(null);
          onRunScenario(id, count);
        }}
        onClose={() => setDetailScenario(null)}
      />
    </section>
  );
}
