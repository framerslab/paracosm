import * as React from 'react';
import styles from './RecentlyViewedStrip.module.scss';
import { useRecentlyViewed } from './hooks/useRecentlyViewed.js';
import type { RunRecord } from '../../../../server/services/run-record.js';

export interface RecentlyViewedStripProps {
  onSelect: (runId: string) => void;
}

export function RecentlyViewedStrip(props: RecentlyViewedStripProps): JSX.Element | null {
  const { records } = useRecentlyViewed();
  const [open, setOpen] = React.useState(true);

  if (records.length === 0) return null;

  return (
    <section className={styles.strip}>
      <header className={styles.head}>
        <span className={styles.title}>Recently viewed</span>
        <button className={styles.toggle} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? 'Collapse recently viewed' : 'Expand recently viewed'}>
          {open ? '−' : '+'}
        </button>
      </header>
      {open && (
        <div className={styles.row}>
          {records.map(r => <CompactCard key={r.runId} record={r} onClick={() => props.onSelect(r.runId)} />)}
        </div>
      )}
    </section>
  );
}

function CompactCard(props: { record: RunRecord; onClick: () => void }): JSX.Element {
  const { record, onClick } = props;
  return (
    <button className={styles.card} onClick={onClick}>
      <span className={styles.cardScenario}>{record.scenarioId}</span>
      <span className={styles.cardLeader}>{record.actorName ?? 'Unknown leader'}</span>
      <span className={styles.cardMode} data-mode={record.mode ?? 'unknown'}>{record.mode ?? 'unknown'}</span>
    </button>
  );
}
