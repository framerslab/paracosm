import * as React from 'react';
import styles from './FilterChips.module.scss';
import type { RunsListFilters } from './hooks/useRunsList.js';
import { AddFilterPopover } from './AddFilterPopover.js';

export interface FilterChipsProps {
  filters: RunsListFilters;
  onChange: (next: RunsListFilters) => void;
  scenarioOptions: Array<{ id: string; name: string }>;
  leaderOptions: Array<{ hash: string; label: string }>;
}

export function FilterChips(props: FilterChipsProps): JSX.Element {
  const { filters, onChange, scenarioOptions, leaderOptions } = props;

  function remove(key: keyof RunsListFilters) {
    const next = { ...filters, offset: 0 };
    delete next[key];
    onChange(next);
  }

  return (
    <div className={styles.row}>
      {filters.mode && <Chip label={`mode: ${filters.mode}`} onRemove={() => remove('mode')} />}
      {filters.scenarioId && <Chip label={`scenario: ${filters.scenarioId}`} onRemove={() => remove('scenarioId')} />}
      {filters.actorConfigHash && <Chip label={`leader: ${filters.actorConfigHash.slice(0, 16)}…`} onRemove={() => remove('actorConfigHash')} />}
      <AddFilterPopover
        currentFilters={filters}
        onAdd={(next) => onChange({ ...filters, ...next, offset: 0 })}
        scenarioOptions={scenarioOptions}
        leaderOptions={leaderOptions}
      />
    </div>
  );
}

function Chip(props: { label: string; onRemove: () => void }): JSX.Element {
  return (
    <span className={styles.chip}>
      {props.label}
      <button onClick={props.onRemove} aria-label={`Remove ${props.label}`} className={styles.chipRemove}>×</button>
    </span>
  );
}
