/**
 * Full-verdict modal triggered from the global VerdictBanner. Opens a
 * centered dialog carrying the VerdictDetails breakdown with focus
 * trapped inside while open. Backdrop click + Escape (handled by
 * caller) both dismiss.
 */
import { VerdictDetails } from '../sim/VerdictCard';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './VerdictModal.module.scss';

interface VerdictModalProps {
  verdict: Record<string, unknown>;
  onClose: () => void;
}

export function VerdictModal({ verdict, onClose }: VerdictModalProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const winner = verdict.winner;
  const dialogClassName = [
    styles.dialog,
    winner === 'A' ? styles.winnerA : undefined,
    winner === 'B' ? styles.winnerB : undefined,
    winner === 'tie' ? styles.winnerTie : undefined,
  ].filter(Boolean).join(' ');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Simulation verdict full breakdown"
      onClick={onClose}
      className={styles.backdrop}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={dialogClassName}
      >
        <button
          onClick={onClose}
          aria-label="Close verdict"
          className={styles.closeButton}
        >
          ×
        </button>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <VerdictDetails v={verdict as any} />
      </div>
    </div>
  );
}
