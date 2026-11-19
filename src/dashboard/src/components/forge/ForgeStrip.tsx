import type { RecordOutcome } from '../../hooks/useToolRegistry';
import { stripMore } from './forgeWords';
import styles from './ForgeStrip.module.scss';

/** The most cells a strip draws before it says how many more it holds. */
const DEFAULT_MAX = 20;

/**
 * An actor's forges as a strip of the living grid's cells, one a forge in
 * turn order: filled when it passed, hollow when it did not, and "+{n}" for
 * the forges past the cells it draws. An actor with no forge is the strip
 * with no cell. The strip is drawn only: the actor's counts say the same in
 * words beside it.
 */
export function ForgeStrip({ cells, max = DEFAULT_MAX }: { cells: RecordOutcome[]; max?: number }) {
  const shown = cells.slice(0, Math.max(0, max));
  const more = cells.length - shown.length;
  return (
    <span className={styles.strip} aria-hidden="true" data-forge-strip={cells.length}>
      {shown.map((outcome, i) => (
        <span key={i} className={styles.cell} data-cell={outcome} />
      ))}
      {more > 0 && <span className={styles.more}>{stripMore(more)}</span>}
    </span>
  );
}
