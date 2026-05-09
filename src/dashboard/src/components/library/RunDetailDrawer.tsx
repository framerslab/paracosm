import * as React from 'react';
import styles from './RunDetailDrawer.module.scss';
import { useRunArtifact } from './hooks/useRunArtifact.js';
import { ReplayPanel } from './ReplayPanel.js';
import { SwarmPanel } from './SwarmPanel.js';
import { BatchArtifactView } from '../reports/BatchArtifactView.js';
import { ReportViewAdapter } from '../reports/ReportViewAdapter.js';
import type { MetricSpec } from '../viz/kit/index.js';
import type { RunRecord } from '../../../../server/services/run-record.js';

export interface RunDetailDrawerProps {
  runId: string | null;
  open: boolean;
  onClose: () => void;
  onArtifactLoaded?: (record: RunRecord) => void;
  /** Fires when the backing run came back as not_found (404). Lets the
   *  parent prune the id from the recently-viewed strip / any other
   *  cached id list so the ghost card doesn't show up again on reload. */
  onRunMissing?: (runId: string) => void;
}

export function RunDetailDrawer(props: RunDetailDrawerProps): JSX.Element {
  const { runId, open, onClose, onArtifactLoaded, onRunMissing } = props;
  const { record, artifact, loading, error, status } = useRunArtifact(open ? runId : null);
  const drawerRef = React.useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (record) onArtifactLoaded?.(record);
  }, [record, onArtifactLoaded]);

  // Prune the id from any cached strip the moment we know the run is
  // gone server-side. The drawer's own "Run not found" UI still renders
  // for the click that surfaced the 404; this just ensures the next
  // page load doesn't show the same ghost card.
  React.useEffect(() => {
    if (status === 'not_found' && runId) {
      onRunMissing?.(runId);
    }
  }, [status, runId, onRunMissing]);

  React.useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => {
        const target = drawerRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        target?.focus();
      });
    } else {
      lastFocusedRef.current?.focus();
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = getFocusableElements(drawerRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !drawerRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Build a minimal MetricSpec map from the artifact's first timepoint.
  // v1 default: range [0, 1] for every metric. v2 derives ranges +
  // thresholds from the scenario contract.
  const metricSpecs: Record<string, MetricSpec> = React.useMemo(() => {
    if (!artifact) return {};
    const out: Record<string, MetricSpec> = {};
    const firstTp = artifact.trajectory?.timepoints?.[0] as { worldSnapshot?: { metrics?: Record<string, number> } } | undefined;
    const sample = firstTp?.worldSnapshot?.metrics ?? {};
    for (const id of Object.keys(sample)) {
      out[id] = { id, label: id, range: [0, 1] };
    }
    return out;
  }, [artifact]);

  return (
    <>
      {open && <div className={styles.backdrop} onClick={onClose} role="presentation" />}
      <aside
        ref={drawerRef}
        className={[styles.drawer, open ? styles.open : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-label="Run detail"
        aria-modal={open ? 'true' : 'false'}
        aria-hidden={!open}
      >
        <header className={styles.head}>
          <button onClick={onClose} className={styles.closeBtn} aria-label="Close detail">×</button>
          {artifact && <ReplayPanel artifact={artifact} />}
        </header>

        <section className={styles.body}>
          {loading && <p className={styles.placeholder}>Loading…</p>}
          {error && status !== 'ok' && (
            <div className={styles.error}>
              <strong>{
                status === 'not_found' ? 'Run not found' :
                status === 'unavailable' ? 'Artifact path not preserved' :
                status === 'unreadable' ? 'Artifact file unreadable' :
                'Error'
              }</strong>
              <p>{error}</p>
            </div>
          )}
          {artifact && record && (
            <>
              <section className={styles.summary}>
                <span className={styles.modeBadge} data-mode={artifact.metadata.mode}>{artifact.metadata.mode}</span>
                <h2>{artifact.metadata.scenario.name}</h2>
                <p>
                  {record.actorName ?? 'Unknown'}
                  {record.actorArchetype ? ` · ${record.actorArchetype}` : ''}
                </p>
                <p className={styles.meta}>
                  {(artifact.trajectory?.timepoints?.length ?? 0)} timepoints · {record.costUSD != null ? `$${record.costUSD.toFixed(2)}` : '-'} · {record.createdAt.slice(0, 19).replace('T', ' ')}
                </p>
              </section>

              <SwarmPanel artifact={artifact} />

              <section className={styles.detailBody}>
                {artifact.metadata.mode === 'turn-loop'
                  ? <ReportViewAdapter artifact={artifact} />
                  : <BatchArtifactView artifact={artifact} metricSpecs={metricSpecs} />}
              </section>
            </>
          )}
        </section>
      </aside>
    </>
  );
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}
