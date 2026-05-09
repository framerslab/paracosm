/**
 * Sortable actor table for the SIM tab. Replaces the pairwise
 * leaders-row when 3+ actors are running — a horizontal card strip
 * fails past ~5 actors but a sortable table reads cleanly at any N.
 * Sticky header, click-to-sort columns, click-to-drill-in row, with
 * the active actor highlighted via the same color slot the
 * constellation uses so a glance correlates the two surfaces.
 *
 * Sort state is local React state; the comparator + projection logic
 * live in `actor-table.helpers.ts` so they can be unit-tested without
 * a DOM.
 *
 * @module paracosm/dashboard/sim/ActorTable
 */
import * as React from 'react';
import { useMemo, useState, useCallback } from 'react';
import type { GameState } from '../../hooks/useGameState';
import { getActorColorVar } from '../../hooks/useGameState.js';
import {
  projectActorRows,
  sortRows,
  defaultSortDir,
  type SortKey,
  type SortDir,
  type ActorRow,
} from './actor-table.helpers.js';
import styles from './ActorTable.module.scss';

void React;

export interface ActorTableProps {
  state: GameState;
  /** Drill into an actor when its row is activated (click or Enter). */
  onActorClick?: (id: string) => void;
}

interface ColumnDef {
  key: SortKey;
  label: string;
  numeric: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: 'name',       label: 'Actor',      numeric: false },
  { key: 'archetype',  label: 'Archetype',  numeric: false },
  { key: 'turn',       label: 'Turn',       numeric: true  },
  { key: 'population', label: 'Pop',        numeric: true  },
  { key: 'morale',     label: 'Morale',     numeric: true  },
  { key: 'deaths',     label: 'Deaths',     numeric: true  },
  { key: 'tools',      label: 'Tools',      numeric: true  },
];

function ariaSortFor(active: boolean, dir: SortDir): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}

export function ActorTable({ state, onActorClick }: ActorTableProps): JSX.Element {
  // Default: morale desc — surfaces the healthiest actors first, which
  // is the most-asked-about column in pair runs ("which side is doing
  // better"). Switching the default to "deaths asc" tested as more
  // alarming than informative for the median 6-actor run.
  const [sortKey, setSortKey] = useState<SortKey>('morale');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        // Same column clicked: toggle direction.
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      // New column: reset to its natural default direction.
      setSortDir(defaultSortDir(key));
      return key;
    });
  }, []);

  // popHistory.length and the actor map identity drive re-projection.
  // Both change on every SSE event during a live run, so memoize on
  // actorIds.length plus the actor map reference.
  const rows: ActorRow[] = useMemo(
    () => projectActorRows(state),
    [state],
  );
  const sorted = useMemo(
    () => sortRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

  const handleRowKey = (id: string) => (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (!onActorClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActorClick(id);
    }
  };

  if (sorted.length === 0) {
    return (
      <div className={styles.empty} role="status">
        No actor data yet — events will populate this table as the run progresses.
      </div>
    );
  }

  return (
    <div className={styles.wrap} aria-label={`Actor roster (${sorted.length} actors)`}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th aria-hidden="true" className={styles.colorCell} />
              {COLUMNS.map(col => {
                const active = col.key === sortKey;
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSortFor(active, sortDir)}
                    className={`${styles.th} ${col.numeric ? styles.numeric : ''} ${active ? styles.activeSort : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => handleSort(col.key)}
                      aria-label={`Sort by ${col.label}${active ? ` (${sortDir === 'asc' ? 'ascending' : 'descending'} active)` : ''}`}
                    >
                      <span>{col.label}</span>
                      <span className={styles.sortGlyph} aria-hidden="true">
                        {active ? (sortDir === 'asc' ? '▲' : '▼') : '·'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => {
              // Map id back to its position in actorIds so the color slot
              // matches what ConstellationView assigns to the same actor.
              const idx = state.actorIds.indexOf(row.id);
              const color = idx >= 0 ? getActorColorVar(idx) : 'var(--text-3)';
              return (
                <tr
                  key={row.id}
                  className={`${styles.row} ${onActorClick ? styles.rowClickable : ''}`}
                  tabIndex={onActorClick ? 0 : -1}
                  onClick={onActorClick ? () => onActorClick(row.id) : undefined}
                  onKeyDown={onActorClick ? handleRowKey(row.id) : undefined}
                  aria-label={`${row.name}, ${row.archetype}, turn ${row.turn}, population ${row.population}, morale ${row.morale}%, ${row.deaths} deaths, ${row.tools} tools`}
                >
                  <td className={styles.colorCell} aria-hidden="true">
                    <span className={styles.colorDot} style={{ background: color }} />
                  </td>
                  <td className={styles.nameCell}>
                    <span className={styles.actorName}>{row.name}</span>
                    {row.pending && (
                      <span className={styles.pendingPill} title="Waiting on commander decision">
                        pending
                      </span>
                    )}
                  </td>
                  <td className={styles.archetypeCell}>{row.archetype}</td>
                  <td className={styles.numCell}>T{row.turn}</td>
                  <td className={styles.numCell}>{row.population}</td>
                  <td className={styles.numCell}>
                    <span className={styles.moraleWrap}>
                      <span className={styles.moraleBar} aria-hidden="true">
                        <span className={styles.moraleFill} style={{ width: `${Math.min(100, Math.max(0, row.morale))}%`, background: color }} />
                      </span>
                      <span className={styles.moraleText}>{row.morale}%</span>
                    </span>
                  </td>
                  <td className={styles.numCell}>{row.deaths}</td>
                  <td className={styles.numCell}>{row.tools}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
