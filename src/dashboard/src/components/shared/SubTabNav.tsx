/**
 * SubTabNav — small horizontal tab bar for nesting related views inside
 * a single top-level tab panel. Used by StudioTab (Author / Branches)
 * and SettingsPanel (Settings / Log).
 *
 * @module paracosm/dashboard/shared/SubTabNav
 */
import * as React from 'react';

export interface SubTabOption<T extends string> {
  id: T;
  label: string;
}

export interface SubTabNavProps<T extends string> {
  options: ReadonlyArray<SubTabOption<T>>;
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

export function SubTabNav<T extends string>({ options, active, onChange, ariaLabel }: SubTabNavProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 4,
        padding: '8px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-deep)',
        flexShrink: 0,
      }}
    >
      {options.map((opt) => {
        const isActive = opt.id === active;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.id)}
            type="button"
            style={{
              padding: '6px 14px',
              fontFamily: 'var(--mono)',
              fontSize: 'var(--font-xs)',
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: isActive ? '#1a1a1a' : 'var(--text-3)',
              background: isActive ? 'var(--amber)' : 'transparent',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
