import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CellSnapshot } from '../viz-types.js';
import { useScenarioLabels } from '../../../hooks/useScenarioLabels.js';
import styles from './ColonistSearch.module.scss';

export interface SearchMatch {
  cell: CellSnapshot;
  side: 'a' | 'b';
  actorName: string;
  sideColor: string;
}

interface ColonistSearchProps {
  value: string;
  onChange: (q: string) => void;
  matches: SearchMatch[];
  onPick?: (match: SearchMatch) => void;
}

/**
 * Search input above the leader panels. Types a name fragment → any
 * matching colonists on either side get a bright highlight ring and
 * non-matches dim. Empty string = normal render.
 */
export function ColonistSearch({ value, onChange, matches, onPick }: ColonistSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const matchCount = matches.length;
  const labels = useScenarioLabels();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showDropdown = focused && value.trim().length > 0 && matches.length > 0;

  return (
    <div className={styles.bar}>
      <span aria-hidden="true" className={styles.icon} title="Search agents">🔍</span>
      <span className={styles.label}>Find</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        placeholder={`${labels.person} name, dept, mood… (space-separate to AND-match; / to focus)`}
        aria-label={`Search ${labels.people} by name, department, role, or mood`}
        className={styles.input}
      />
      {showDropdown && (
        <div role="listbox" className={styles.dropdown}>
          {matches.slice(0, 10).map((m, i) => (
            <button
              key={`${m.side}-${m.cell.agentId}-${i}`}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={e => {
                e.preventDefault();
                onPick?.(m);
              }}
              className={styles.option}
              style={{ '--result-color': m.sideColor } as CSSProperties}
            >
              <span className={styles.sidePill}>{m.side.toUpperCase()}</span>
              <span className={styles.optionName}>{m.cell.name}</span>
              <span className={styles.optionMeta}>
                {m.cell.department?.toUpperCase?.() || ''} · {m.cell.mood}
                {typeof m.cell.age === 'number' ? ` · age ${m.cell.age}` : ''}
              </span>
              {m.cell.featured && (
                <span className={styles.featuredPill}>FEATURED</span>
              )}
            </button>
          ))}
          {matches.length > 10 && (
            <div className={styles.moreNote}>+ {matches.length - 10} more…</div>
          )}
        </div>
      )}
      {value && (
        <>
          <span
            className={styles.matchCount}
            style={{ '--count-color': matchCount > 0 ? 'var(--amber)' : 'var(--rust)' } as CSSProperties}
          >
            {matchCount} match{matchCount === 1 ? '' : 'es'}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className={styles.clearBtn}
          >
            clear
          </button>
        </>
      )}
    </div>
  );
}
