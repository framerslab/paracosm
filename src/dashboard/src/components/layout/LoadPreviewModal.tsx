/**
 * Two-stage-load preview dialog. After the user picks a file, this
 * dialog shows the file's metadata (scenario name, leader list, turn
 * count, schema version, verdict presence) so they can confirm before
 * the events stream is dispatched and the current simulation state is
 * replaced.
 *
 * Rendering is purely a function of `metadata` + `showOverwriteWarning`.
 * Focus trap + Escape handling match VerdictModal.
 */
import { useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { PreviewMetadata } from '../../hooks/useLoadPreview.helpers';
import styles from './LoadPreviewModal.module.scss';

interface LoadPreviewModalProps {
  metadata: PreviewMetadata;
  /**
   * When true, the confirm button label warns the user that loading
   * will replace the current simulation. Hidden when the live state is
   * empty or when replay mode is active.
   */
  showOverwriteWarning: boolean;
  /** Count of events in the current (pre-load) simulation. Used in
   *  the warning copy only. */
  currentEventCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatStartedAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function LoadPreviewModal({
  metadata,
  showOverwriteWarning,
  currentEventCount,
  onConfirm,
  onCancel,
}: LoadPreviewModalProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const schemaLabel =
    metadata.schemaVersion === 'legacy'
      ? 'legacy (pre-0.5.0)'
      : `v${metadata.schemaVersion}`;

  const isMismatch = metadata.scenarioMatch?.state === 'mismatch';
  const confirmLabel = isMismatch
    ? 'Load anyway'
    : showOverwriteWarning
      ? 'Replace current simulation'
      : 'Load';
  const confirmClassName = [
    styles.button,
    isMismatch || showOverwriteWarning ? styles.warningConfirm : styles.primary,
  ].join(' ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-preview-title"
      onClick={onCancel}
      className={styles.backdrop}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={styles.dialog}
      >
        <div className={styles.header}>
          <h2 id="load-preview-title" className={styles.title}>Load simulation</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close load preview"
            className={styles.closeButton}
          >
            ×
          </button>
        </div>

        {metadata.fileName && (
          <div className={styles.fileInfo}>
            <div className={styles.fileName}>{metadata.fileName}</div>
            <div className={styles.fileMeta}>
              {metadata.fileSize}
              {metadata.startedAt ? ` · saved ${formatStartedAt(metadata.startedAt)}` : ''}
            </div>
          </div>
        )}

        <div className={styles.metaTable}>
          <div className={styles.metaLabel}>Scenario</div>
          <div className={styles.metaValue}>{metadata.scenarioName}</div>

          <div className={styles.metaLabel}>Actors</div>
          <div className={styles.metaValue}>
            {(metadata.actorNames ?? []).length > 0
              ? (metadata.actorNames ?? []).join(' · ')
              : '—'}
          </div>

          <div className={styles.metaLabel}>Turns</div>
          <div className={styles.metaValue}>{metadata.turnCount ?? '—'}</div>

          <div className={styles.metaLabel}>Events</div>
          <div className={styles.metaValue}>{metadata.eventCount}</div>

          <div className={styles.metaLabel}>Schema</div>
          <div className={styles.metaValue}>
            <span
              className={[
                styles.schemaBadge,
                metadata.schemaVersion === 'legacy' ? styles.legacy : '',
              ].filter(Boolean).join(' ')}
            >
              {schemaLabel}
            </span>
          </div>

          <div className={styles.metaLabel}>Verdict</div>
          <div className={styles.metaValue}>{metadata.hasVerdict ? 'yes' : 'no'}</div>
        </div>

        {metadata.scenarioMatch?.state === 'mismatch' && (
          <div role="alert" className={styles.warning}>
            <span aria-hidden="true" className={styles.warningIcon}>⚠</span>
            <span>
              This file was saved under <strong>{metadata.scenarioMatch.fileScenarioName}</strong>.
              Your dashboard's active scenario is <strong>{metadata.scenarioMatch.currentScenarioName}</strong>.
              Labels, colors, and department names will not match. Switch
              scenario in Settings before loading for a clean render.
            </span>
          </div>
        )}

        {showOverwriteWarning && (
          <div role="alert" className={styles.warning}>
            <span aria-hidden="true" className={styles.warningIcon}>⚠</span>
            <span>
              This will replace the {currentEventCount}-event run you're viewing.
            </span>
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            onClick={onCancel}
            className={styles.button}
            autoFocus={showOverwriteWarning || isMismatch}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmClassName}
            autoFocus={!showOverwriteWarning && !isMismatch}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
