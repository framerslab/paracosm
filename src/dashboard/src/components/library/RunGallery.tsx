import * as React from 'react';
import styles from './RunGallery.module.scss';
import { RunCard } from './RunCard.js';
import { BundleCard } from './BundleCard.js';
import { groupRunsByBundle } from './groupRunsByBundle.js';
import type { RunRecord } from '../../../../server/services/run-record.js';

export interface RunGalleryProps {
  runs: RunRecord[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  onOpen: (runId: string) => void;
  onReplay: (runId: string) => void;
  /** Open the Compare modal for a bundle. Bundles are auto-grouped from
   *  RunRecords sharing a bundleId via {@link groupRunsByBundle}. */
  onOpenBundle: (bundleId: string) => void;
  onPageChange: (offset: number) => void;
  currentOffset: number;
  pageSize: number;
}

export function RunGallery(props: RunGalleryProps): JSX.Element {
  const { runs, total, hasMore, loading, onOpen, onReplay, onOpenBundle, onPageChange, currentOffset, pageSize } = props;
  const page = Math.floor(currentOffset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Group bundles inline. The `runs` prop is the flat per-page result;
  // groups are built per render so paging changes refresh the grouping.
  // The gallery still reverses presentation order (newest first).
  const entries = React.useMemo(() => {
    const grouped = groupRunsByBundle(runs);
    return [...grouped].reverse();
  }, [runs]);

  return (
    <section className={styles.gallery}>
      <header className={styles.head}>
        <span>All runs · {loading ? 'loading…' : `${total} results`}</span>
      </header>

      {loading && runs.length === 0 ? (
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className={styles.cardSkeleton} />)}
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((entry) =>
            entry.kind === 'bundle' ? (
              <BundleCard
                key={`bundle:${entry.bundleId}`}
                entry={entry}
                onOpen={() => onOpenBundle(entry.bundleId)}
              />
            ) : (
              <RunCard
                key={entry.record.runId}
                record={entry.record}
                onOpen={() => onOpen(entry.record.runId)}
                onReplay={() => onReplay(entry.record.runId)}
              />
            )
          )}
        </div>
      )}

      <footer className={styles.foot}>
        <button
          disabled={currentOffset === 0}
          onClick={() => onPageChange(Math.max(0, currentOffset - pageSize))}
        >‹ Prev</button>
        <span>page {page} of {totalPages}</span>
        <button disabled={!hasMore} onClick={() => onPageChange(currentOffset + pageSize)}>Next ›</button>
      </footer>
    </section>
  );
}
