/**
 * The question a `?load=` link to another site gets before anything is
 * fetched: it names the site the run file is on, and the page loads the
 * file only on Load. Cancel fetches nothing.
 *
 * Shares the LoadPreviewModal's styles, focus trap and Escape handling.
 */
import { useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './LoadPreviewModal.module.scss';

interface LoadFromHostModalProps {
  /** Host of the run file the link names. */
  host: string;
  onLoad: () => void;
  onCancel: () => void;
}

/**
 * The dialog App mounts while `useLoadFromUrl` holds a `?load=` file on
 * another site. It names `host`; Load calls `onLoad`, which starts the
 * fetch. Cancel, Escape or a click on the backdrop calls `onCancel`, and
 * nothing is fetched.
 */
export function LoadFromHostModal({ host, onLoad, onCancel }: LoadFromHostModalProps) {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-from-host-title"
      aria-describedby="load-from-host-body"
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
          <h2 id="load-from-host-title" className={styles.title}>Load a run from another site?</h2>
        </div>
        <div id="load-from-host-body" className={styles.fileInfo}>
          <p>
            This link loads a saved run from <span className={styles.fileName}>{host}</span>,
            which is not this site. Nothing is fetched until you choose Load.
          </p>
          <p>Load it only if you trust where the link came from.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={onCancel} className={styles.button} autoFocus>
            Cancel
          </button>
          <button type="button" onClick={onLoad} className={[styles.button, styles.primary].join(' ')}>
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
