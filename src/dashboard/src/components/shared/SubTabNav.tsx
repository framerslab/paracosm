/**
 * SubTabNav — small horizontal tab bar for nesting related views inside
 * a single top-level tab panel. Used by StudioTab (Author / Branches)
 * and SettingsPanel (Settings / Log).
 *
 * @module paracosm/dashboard/shared/SubTabNav
 */
import * as React from 'react';
import styles from './SubTabNav.module.scss';

void React;

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
    <div role="tablist" aria-label={ariaLabel} className={styles.tablist}>
      {options.map((opt) => {
        const isActive = opt.id === active;
        const className = isActive
          ? `${styles.tab} ${styles.tabActive}`
          : styles.tab;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.id)}
            type="button"
            className={className}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
