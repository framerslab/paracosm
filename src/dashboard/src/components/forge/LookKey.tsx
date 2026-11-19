import { useTheme } from '../../theme/ThemeProvider';
import { LOOK_KEY_NAMES } from './forgeWords';
import styles from './TraceDialog.module.scss';

/**
 * The look key of a forge dialog's header row: a sun in the dark look and a
 * moon in the light look, with the page header's own names. It flips the
 * look of the whole page with the dialog open, and stays the same button,
 * so focus stays on it.
 */
export function LookKey() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  const name = next === 'light' ? LOOK_KEY_NAMES.toLight : LOOK_KEY_NAMES.toDark;
  return (
    <button
      type="button"
      className={`${styles.key} ${styles.iconKey}`}
      onClick={() => setTheme(next)}
      aria-label={name}
      title={name}
    >
      <span className={styles.lookGlyph} aria-hidden="true">{resolved === 'dark' ? '☀' : '☽'}</span>
    </button>
  );
}
