/**
 * Full-viewport overlay shown while a file is being dragged over the
 * dashboard. Purely visual — no interactivity. The drop event is
 * handled at window level by {@link useDashboardDropZone}.
 */
import styles from './DropZoneOverlay.module.scss';

interface DropZoneOverlayProps {
  active: boolean;
}

export function DropZoneOverlay({ active }: DropZoneOverlayProps) {
  if (!active) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Drop zone active. Release to load a simulation file."
      className={styles.overlay}
    >
      <div className={styles.card}>
        <div aria-hidden="true" className={styles.icon}>⬇</div>
        <p className={styles.heading}>Drop to load</p>
        <p className={styles.sub}>.json simulation</p>
      </div>
    </div>
  );
}
