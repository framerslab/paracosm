/**
 * Modal that lets the user swap one of the Quickstart-generated actors
 * for a built-in actor preset.
 *
 * @module paracosm/dashboard/quickstart/ActorPresetPicker
 */
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ACTOR_PRESETS, type LeaderPreset } from '../../../../engine/presets/index.js';
import styles from './ActorPresetPicker.module.scss';

export interface ActorPresetPickerProps {
  onSelect: (preset: LeaderPreset) => void;
  onClose: () => void;
}

export function ActorPresetPicker({ onSelect, onClose }: ActorPresetPickerProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Swap leader"
      className={styles.backdrop}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.dialog}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h3>Swap leader</h3>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <ul className={styles.list}>
          {Object.values(ACTOR_PRESETS).map(p => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                className={styles.preset}
              >
                <strong>{p.name}</strong>
                <span className={styles.archetype}>{p.archetype}</span>
                <span className={styles.description}>{p.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
