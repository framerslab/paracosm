/**
 * Library tab top-level. Composes hero stats, search, filter chips,
 * recently-viewed strip, gallery / table view, and detail drawer.
 *
 * URL-backed state: every filter and the selected runId roundtrips
 * through query params so any view is a shareable link.
 *
 * @module paracosm/dashboard/library/LibraryTab
 */
import * as React from 'react';
import styles from './LibraryTab.module.scss';
import { useRunsList } from './hooks/useRunsList.js';
import { useRecentlyViewed } from './hooks/useRecentlyViewed.js';
import { useKeyboardNav } from './hooks/useKeyboardNav.js';
import { SearchBar } from './SearchBar.js';
import { FilterChips } from './FilterChips.js';
import { HeroStatsStrip } from './HeroStatsStrip.js';
import { RecentlyViewedStrip } from './RecentlyViewedStrip.js';
import { RunGallery } from './RunGallery.js';
import { RunTable } from './RunTable.js';
import { RunDetailDrawer } from './RunDetailDrawer.js';
import { CompareModal } from '../compare/CompareModal.js';
import { EmptyState } from './EmptyState.js';

export function LibraryTab(): JSX.Element {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const { filters, setFilters, runs, total, hasMore, loading, error } = useRunsList();
  const { records: recentRecords, push: pushRecent, remove: removeRecent } = useRecentlyViewed();

  const [view, setView] = React.useState<'gallery' | 'table'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'table' ? 'table' : 'gallery';
  });

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'table') url.searchParams.set('view', 'table');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url.toString());
  }, [view]);

  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('runId');
  });

  // Compare-runs UI: opening a bundle card slides the CompareModal over
  // the LibraryTab. Bundle id lives in the URL alongside `runId` so the
  // page is shareable / restorable.
  const [compareBundleId, setCompareBundleId] = React.useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('bundleId');
  });

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedRunId) url.searchParams.set('runId', selectedRunId);
    else url.searchParams.delete('runId');
    window.history.replaceState({}, '', url.toString());
  }, [selectedRunId]);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (compareBundleId) url.searchParams.set('bundleId', compareBundleId);
    else url.searchParams.delete('bundleId');
    window.history.replaceState({}, '', url.toString());
  }, [compareBundleId]);

  // Build scenario + leader option lists from the current page of runs.
  // De-duplicated; populated as the user browses.
  const scenarioOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    runs.forEach(r => map.set(r.scenarioId, r.scenarioId));
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [runs]);

  const leaderOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    runs.forEach(r => {
      if (r.actorConfigHash) {
        const label = r.actorName ? `${r.actorName} (${r.actorConfigHash.slice(0, 12)})` : r.actorConfigHash.slice(0, 16);
        map.set(r.actorConfigHash, label);
      }
    });
    return [...map.entries()].map(([hash, label]) => ({ hash, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [runs]);

  useKeyboardNav({
    enabled: true,
    cardSelector: '[data-run-card]',
    searchInputRef: searchRef,
    onOpenFocused: (el) => {
      const runId = el.getAttribute('data-run-id');
      if (runId) setSelectedRunId(runId);
    },
    onClose: () => setSelectedRunId(null),
  });

  const filtersActive = Boolean(filters.q || filters.mode || filters.scenarioId || filters.actorConfigHash);

  return (
    <div className={styles.tab}>
      <header className={styles.header}>
        <h1 className={styles.title}>Library</h1>
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          <button
            className={view === 'gallery' ? styles.viewActive : styles.viewBtn}
            onClick={() => setView('gallery')}
            aria-pressed={view === 'gallery'}
          >Gallery</button>
          <button
            className={view === 'table' ? styles.viewActive : styles.viewBtn}
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
          >Table</button>
        </div>
      </header>

      <HeroStatsStrip
        filters={{ mode: filters.mode, scenario: filters.scenarioId, leader: filters.actorConfigHash }}
      />

      <SearchBar
        value={filters.q ?? ''}
        onChange={(q) => setFilters({ ...filters, q: q || undefined, offset: 0 })}
        inputRef={searchRef}
      />
      <FilterChips
        filters={filters}
        onChange={setFilters}
        scenarioOptions={scenarioOptions}
        leaderOptions={leaderOptions}
      />

      <RecentlyViewedStrip onSelect={(runId) => setSelectedRunId(runId)} />

      {error ? (
        <div className={styles.error}>Failed to load runs: {error}</div>
      ) : !loading && runs.length === 0 ? (
        <EmptyState
          filtersActive={filtersActive}
          onClearFilters={() => setFilters({ limit: filters.limit, offset: 0 })}
        />
      ) : view === 'gallery' ? (
        <RunGallery
          runs={runs}
          total={total}
          hasMore={hasMore}
          loading={loading}
          onOpen={(runId) => setSelectedRunId(runId)}
          onReplay={(runId) => setSelectedRunId(runId)}
          onOpenBundle={(bundleId) => setCompareBundleId(bundleId)}
          currentOffset={filters.offset ?? 0}
          pageSize={filters.limit ?? 24}
          onPageChange={(offset) => setFilters({ ...filters, offset })}
        />
      ) : (
        <RunTable
          runs={runs}
          onOpen={(runId) => setSelectedRunId(runId)}
          onReplay={(runId) => setSelectedRunId(runId)}
        />
      )}

      <RunDetailDrawer
        runId={selectedRunId}
        open={selectedRunId !== null}
        onClose={() => setSelectedRunId(null)}
        onArtifactLoaded={pushRecent}
        // Server says this run is gone (Wipe All / TTL / manual delete).
        // Drop it from the recently-viewed cache so the ghost card stops
        // surfacing on the next load.
        onRunMissing={removeRecent}
      />

      {/* CompareModal mounts above the LibraryTab when a bundle is
          opened. It is its own dialog with backdrop + Esc handling. */}
      {compareBundleId && (
        <CompareModal
          bundleId={compareBundleId}
          open
          onClose={() => setCompareBundleId(null)}
        />
      )}

      {/* Touch recentRecords so React tracks it for the strip. */}
      <span hidden aria-hidden="true">{recentRecords.length}</span>
    </div>
  );
}
