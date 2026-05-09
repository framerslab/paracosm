import { useMemo, useState, type CSSProperties } from 'react';
import type { CellSnapshot } from '../viz-types.js';
import { useScenarioLabels } from '../../../hooks/useScenarioLabels.js';
import styles from './RosterDrawer.module.scss';

interface RosterDrawerProps {
  open: boolean;
  cells: CellSnapshot[];
  actorName: string;
  sideColor: string;
  searchQuery: string;
  hoveredId: string | null;
  onHover: (agentId: string | null) => void;
  onSelect: (cell: CellSnapshot) => void;
  onClose: () => void;
}

const MOOD_COLORS: Record<string, string> = {
  positive: 'rgba(106, 173, 72, 1)',
  hopeful: 'rgba(154, 205, 96, 1)',
  neutral: 'rgba(107, 95, 80, 1)',
  anxious: 'rgba(232, 180, 74, 1)',
  negative: 'rgba(224, 101, 48, 1)',
  defiant: 'rgba(196, 74, 30, 1)',
  resigned: 'rgba(168, 152, 120, 1)',
};

/**
 * Per-leader full colonist roster. Collapsible panel docked inside
 * the leader canvas wrapper (top-left). Groups alive colonists by
 * department, lists deceased at the bottom in a muted section.
 * Filters by the active search query; hovering a row highlights the
 * glyph, clicking opens the drilldown (delegated to caller).
 */
type RosterSort = 'dept' | 'name' | 'psych' | 'age';

const SORT_CHIPS: { key: RosterSort; label: string }[] = [
  { key: 'dept', label: 'Dept' },
  { key: 'name', label: 'Name' },
  { key: 'psych', label: 'Psych' },
  { key: 'age', label: 'Age' },
];

export function RosterDrawer({
  open,
  cells,
  actorName,
  sideColor,
  searchQuery,
  hoveredId,
  onHover,
  onSelect,
  onClose,
}: RosterDrawerProps) {
  const [showDeceased, setShowDeceased] = useState(false);
  const [sort, setSort] = useState<RosterSort>('dept');
  const labels = useScenarioLabels();

  const { alive, deceased, matchSet } = useMemo(() => {
    const aliveArr: CellSnapshot[] = [];
    const deceasedArr: CellSnapshot[] = [];
    for (const c of cells) {
      if (c.alive) aliveArr.push(c);
      else deceasedArr.push(c);
    }
    if (sort === 'dept') {
      aliveArr.sort(
        (a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name),
      );
    } else if (sort === 'name') {
      aliveArr.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'psych') {
      aliveArr.sort((a, b) => (b.psychScore ?? 0) - (a.psychScore ?? 0));
    } else if (sort === 'age') {
      aliveArr.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    }
    deceasedArr.sort((a, b) => a.name.localeCompare(b.name));

    const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const match = new Set<string>();
    if (tokens.length > 0) {
      for (const c of cells) {
        const hay = `${c.name} ${c.department} ${c.role} ${c.mood}`.toLowerCase();
        if (tokens.every(t => hay.includes(t))) match.add(c.agentId);
      }
    }
    return { alive: aliveArr, deceased: deceasedArr, matchSet: match };
  }, [cells, searchQuery, sort]);

  const grouped = useMemo(() => {
    if (sort !== 'dept') {
      return [['__flat__', alive] as [string, CellSnapshot[]]];
    }
    const byDept = new Map<string, CellSnapshot[]>();
    for (const c of alive) {
      const k = (c.department || 'unknown').toLowerCase();
      const arr = byDept.get(k) ?? [];
      arr.push(c);
      byDept.set(k, arr);
    }
    return [...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [alive, sort]);

  if (!open) return null;

  const sideStyle = { '--side-color': sideColor } as CSSProperties;

  const rowVarStyle = (highlighted: boolean, dimmed: boolean, isHovered: boolean): CSSProperties => ({
    '--row-color': dimmed ? 'var(--text-4)' : 'var(--text-2)',
    '--row-bg': isHovered
      ? 'var(--bg-card)'
      : highlighted
      ? `color-mix(in srgb, ${sideColor} 13%, transparent)`
      : 'transparent',
    '--row-border': highlighted ? sideColor : 'transparent',
    '--row-opacity': dimmed ? '0.55' : '1',
  } as CSSProperties);

  return (
    <div className={styles.drawer}>
      <div className={styles.header} style={sideStyle}>
        <span className={styles.headerLabel} style={sideStyle}>
          {actorName} Roster · {alive.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close roster"
          className={styles.closeBtn}
        >
          ×
        </button>
      </div>
      <div className={styles.sortRow}>
        {SORT_CHIPS.map(chip => {
          const active = sort === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSort(chip.key)}
              aria-pressed={active}
              className={[styles.sortChip, active ? styles.active : ''].filter(Boolean).join(' ')}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className={styles.body}>
        {grouped.length === 0 && (
          <div className={styles.empty}>No living {labels.people}.</div>
        )}
        {grouped.map(([dept, list]) => (
          <div key={dept}>
            {sort === 'dept' && (
              <div className={styles.deptHeader}>
                {dept} · {list.length}
              </div>
            )}
            {list.map(c => {
              const isMatch = matchSet.has(c.agentId);
              const isHovered = hoveredId === c.agentId;
              const dimmed = searchQuery.trim().length > 0 && !isMatch;
              return (
                <button
                  key={c.agentId}
                  type="button"
                  onMouseEnter={() => onHover(c.agentId)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(c)}
                  title={`${c.name} · ${c.role} · ${c.mood}`}
                  className={styles.row}
                  style={rowVarStyle(isMatch, dimmed, isHovered)}
                >
                  <span
                    aria-hidden="true"
                    className={styles.swatch}
                    style={{ '--swatch-bg': MOOD_COLORS[c.mood] ?? MOOD_COLORS.neutral } as CSSProperties}
                  />
                  <span className={styles.rowName}>{c.name}</span>
                  {c.featured && (
                    <span className={styles.featuredPill} style={sideStyle}>★</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {deceased.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowDeceased(v => !v)}
              className={styles.deceasedToggle}
            >
              {showDeceased ? '▼' : '▶'} Deceased · {deceased.length}
            </button>
            {showDeceased &&
              deceased.map(c => {
                const isHovered = hoveredId === c.agentId;
                return (
                  <button
                    key={c.agentId}
                    type="button"
                    onMouseEnter={() => onHover(c.agentId)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(c)}
                    title={`${c.name} · ${c.role} · deceased`}
                    className={[styles.row, styles.deceased].join(' ')}
                    style={rowVarStyle(false, true, isHovered)}
                  >
                    <span
                      aria-hidden="true"
                      className={styles.swatch}
                      style={{ '--swatch-bg': 'var(--text-4)' } as CSSProperties}
                    />
                    <span className={styles.rowName}>{c.name}</span>
                  </button>
                );
              })}
          </>
        )}
      </div>
    </div>
  );
}
