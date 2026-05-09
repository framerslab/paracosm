/**
 * Full-screen Compare modal for a Quickstart bundle. Renders three
 * progressive zooms:
 *
 *   1. AggregateStrip   — all members at once (top ~25% of modal)
 *   2. SmallMultiplesGrid — one cell per run with pin checkbox
 *   3. PinnedDiffPanel  — 2–3 pinned cells side-by-side with the
 *                         four diff dimensions (timeline, fingerprint,
 *                         decision rationale, metric trajectories)
 *
 * Lazy load: aggregate + grid render from RunRecord summaries fetched
 * by `useBundle`. Full RunArtifact fetches fire only when a cell is
 * pinned (via `useBundleArtifacts` inside PinnedDiffPanel) so opening
 * a 50-actor bundle stays under 200 ms first paint.
 *
 * @module paracosm/dashboard/compare/CompareModal
 */
import * as React from 'react';
import styles from './CompareModal.module.scss';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import { useBundle } from './hooks/useBundle.js';
import { useBundleAggregate } from './hooks/useBundleAggregate.js';
import { usePinnedRuns } from './hooks/usePinnedRuns.js';
import { AggregateStrip } from './AggregateStrip.js';
import { SmallMultiplesGrid } from './SmallMultiplesGrid.js';
import { PinnedDiffPanel } from './PinnedDiffPanel.js';
import { RunDetailDrawer } from '../library/RunDetailDrawer.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface CompareModalProps {
  /**
   * Library bundle to compare. Set to null when comparing only
   * Studio-uploaded artifacts (no Library bundle context yet — v1.1
   * will add a bundle picker inside the modal for that case).
   */
  bundleId: string | null;
  /**
   * Studio-uploaded artifacts rendered alongside the bundle's runs.
   * Marked with an "(uploaded)" badge so users can tell which came
   * from a JSON drop vs the Library.
   */
  extraArtifacts?: RunArtifact[];
  open: boolean;
  onClose: () => void;
}

export function CompareModal({ bundleId, extraArtifacts, open, onClose }: CompareModalProps): JSX.Element | null {
  const { bundle, loading, error } = useBundle(open && bundleId ? bundleId : null);
  const { aggregate } = useBundleAggregate(open && bundleId ? bundleId : null);
  const pinning = usePinnedRuns();
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);

  // Focus trap: cycles Tab inside the modal, focuses the first
  // interactive descendant on open, restores focus to the trigger on
  // close. Replaces the prior manual `lastFocusedRef + querySelector`
  // dance which lacked Tab cycling, so keyboard users could escape the
  // modal via Tab and end up scrolling the still-mounted background.
  const ref = useFocusTrap<HTMLDivElement>(open);

  React.useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // If the run-detail drawer is open over the modal, close that
        // first; otherwise close the modal itself.
        if (openRunId !== null) setOpenRunId(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, openRunId]);

  if (!open) return null;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} role="presentation" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-modal-title"
        tabIndex={-1}
        className={styles.modal}
      >
        <header className={styles.head}>
          <h2 id="compare-modal-title" className={styles.title}>
            {loading ? 'Loading bundle…' : (
              bundle ? (
                <>
                  Compare bundle
                  <span className={styles.titleAccent}>
                    {' '}{bundle.scenarioId} · {bundle.memberCount} actors
                  </span>
                </>
              ) : 'Bundle'
            )}
          </h2>
          <button onClick={onClose} className={styles.closeBtn} aria-label="Close compare">×</button>
        </header>
        <section className={styles.body}>
          {error && <p className={styles.error}>Failed to load bundle: {error}</p>}
          {loading && <p className={styles.placeholder}>Loading bundle metadata…</p>}
          {bundle && aggregate && (
            <AggregateStrip aggregate={aggregate} members={bundle.members} />
          )}
          {bundle && (
            <SmallMultiplesGrid
              members={bundle.members}
              pinnedIds={pinning.pinned}
              onTogglePin={pinning.togglePin}
              onOpenRun={setOpenRunId}
            />
          )}
          {bundle && (
            <PinnedDiffPanel pinnedIds={pinning.pinned} members={bundle.members} />
          )}
          {extraArtifacts && extraArtifacts.length > 0 && (
            <section className={styles.extras} aria-label="Uploaded artifacts">
              <h3>Uploaded ({extraArtifacts.length})</h3>
              <ul>
                {extraArtifacts.map((a) => {
                  const actor = (a as { leader?: { name?: string } }).leader?.name ?? '<unnamed>';
                  return (
                    <li key={a.metadata.runId}>
                      {actor}{' '}
                      <span className={styles.extrasBadge}>(uploaded)</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </section>
      </div>
      <RunDetailDrawer
        runId={openRunId}
        open={openRunId !== null}
        onClose={() => setOpenRunId(null)}
      />
    </>
  );
}
