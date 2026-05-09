import * as React from 'react';
import styles from './EmptyState.module.scss';

export interface EmptyStateProps {
  filtersActive: boolean;
  onClearFilters: () => void;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  const { filtersActive, onClearFilters } = props;

  if (filtersActive) {
    return (
      <section className={styles.empty}>
        <div className={styles.icon} aria-hidden="true">⌕</div>
        <h2>No runs match these filters.</h2>
        <p>Clear filters to see all runs in the library.</p>
        <button onClick={onClearFilters} className={styles.cta}>Clear filters</button>
      </section>
    );
  }

  return (
    <section className={styles.empty}>
      <div className={styles.icon} aria-hidden="true">∎</div>
      <h2>No runs in your library yet.</h2>
      <p>Try one of these to get started:</p>
      <ul className={styles.list}>
        <li><a href="?tab=sim">Run a Mars Genesis demo</a></li>
        <li><a href="?tab=quickstart">Quickstart from a prompt or URL</a></li>
        <li><a href="?tab=sim">Compile a custom scenario</a></li>
      </ul>
    </section>
  );
}
