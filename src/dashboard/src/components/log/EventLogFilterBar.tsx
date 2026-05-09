/**
 * Filter toolbar for EventLogPanel (F15). Renders 4 controls + a
 * reset button. Stateless — the panel owns the `LogFilters` object
 * and mutates it through `onFiltersChange`. Matches the audit F15
 * spec + carries the legacy `#log=` tool chip through intact.
 */
import { useMemo } from 'react';
import type { SimEvent } from '../../hooks/useSSE';
import {
  emptyFilters,
  extractAvailableFacets,
  type LogFilters,
} from './EventLogPanel.helpers';
import styles from './EventLogFilterBar.module.scss';

interface EventLogFilterBarProps {
  events: SimEvent[];
  filters: LogFilters;
  onFiltersChange: (next: LogFilters) => void;
}

function isFilterActive(f: LogFilters): boolean {
  return (
    f.query !== '' ||
    f.types.size > 0 ||
    f.leader !== null ||
    f.turnRange !== null ||
    f.toolHash !== ''
  );
}

export function EventLogFilterBar({
  events,
  filters,
  onFiltersChange,
}: EventLogFilterBarProps) {
  const facets = useMemo(() => extractAvailableFacets(events), [events]);
  const active = isFilterActive(filters);

  const setFilters = (patch: Partial<LogFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  const toggleType = (type: string) => {
    const next = new Set(filters.types);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setFilters({ types: next });
  };

  const showTypeChecked = (type: string) =>
    filters.types.size === 0 || filters.types.has(type);

  return (
    <div className={styles.bar}>
      <div className={styles.topRow}>
        <div className={styles.searchWrap}>
          <span aria-hidden="true" className={styles.searchIcon}>🔍</span>
          <input
            type="search"
            aria-label="Filter log by text (type, leader, department, title, summary)"
            placeholder="Search type, leader, department, title, summary..."
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            className={styles.searchInput}
          />
        </div>
        {filters.toolHash && (
          <span className={styles.toolChip}>
            tool: {filters.toolHash}
            <button
              type="button"
              aria-label="Clear tool filter"
              className={styles.chipClear}
              onClick={() => setFilters({ toolHash: '' })}
            >
              ×
            </button>
          </span>
        )}
        <button
          type="button"
          className={styles.resetButton}
          disabled={!active}
          onClick={() => onFiltersChange(emptyFilters())}
        >
          Reset filters
        </button>
      </div>

      {facets.types.length > 0 && (
        <div className={styles.facetsRow}>
          <span className={styles.facetLabel}>types</span>
          <div className={styles.checkboxGroup}>
            {facets.types.map((t) => {
              const checked = showTypeChecked(t);
              return (
                <label
                  key={t}
                  className={[
                    styles.checkbox,
                    checked ? styles.active : '',
                  ].filter(Boolean).join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleType(t)}
                  />
                  {t}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {(facets.actors.length > 1 || facets.maxTurn > 3) && (
        <div className={styles.facetsRow}>
          {facets.actors.length > 1 && (
            <>
              <span className={styles.facetLabel}>leader</span>
              <select
                aria-label="Filter by leader"
                className={styles.leaderSelect}
                value={filters.leader ?? ''}
                onChange={(e) => setFilters({ leader: e.target.value || null })}
              >
                <option value="">all</option>
                {facets.actors.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </>
          )}
          {facets.maxTurn > 3 && (
            <>
              <span className={styles.facetLabel}>turns</span>
              <div className={styles.rangeWrap}>
                <input
                  type="number"
                  aria-label="Min turn"
                  min={0}
                  max={facets.maxTurn}
                  value={filters.turnRange ? filters.turnRange[0] : 0}
                  onChange={(e) => {
                    const min = Number(e.target.value);
                    if (!Number.isFinite(min)) return;
                    const max = filters.turnRange?.[1] ?? facets.maxTurn;
                    setFilters({ turnRange: [min, Math.max(min, max)] });
                  }}
                  className={styles.rangeInput}
                />
                <span>to</span>
                <input
                  type="number"
                  aria-label="Max turn"
                  min={0}
                  max={facets.maxTurn}
                  value={filters.turnRange ? filters.turnRange[1] : facets.maxTurn}
                  onChange={(e) => {
                    const max = Number(e.target.value);
                    if (!Number.isFinite(max)) return;
                    const min = filters.turnRange?.[0] ?? 0;
                    setFilters({ turnRange: [Math.min(min, max), max] });
                  }}
                  className={styles.rangeInput}
                />
                {filters.turnRange && (
                  <button
                    type="button"
                    className={styles.chipClear}
                    aria-label="Clear turn range"
                    onClick={() => setFilters({ turnRange: null })}
                  >
                    ×
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {filters.types.size > 0 && filters.types.size === facets.types.length && (
        <div className={styles.emptyHint}>
          All types selected — filter is a no-op on this axis.
        </div>
      )}
    </div>
  );
}
