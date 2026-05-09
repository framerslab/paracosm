/**
 * Horizontal 1-row timeline. One cell per turn with per-side outcome
 * badges stacked. Clicking a cell scrolls #turn-<n> into view.
 *
 * @module paracosm/dashboard/reports/RunStrip
 */
import type { CSSProperties } from 'react';
import type { RunStripCell } from './reports-shared';
import { outcomeColor } from './reports-shared';
import { useMediaQuery, PHONE_QUERY } from '../viz/grid/useMediaQuery';
import styles from './RunStrip.module.scss';

export interface RunStripProps {
  turns: RunStripCell[];
  leaderAName: string;
  leaderBName: string;
  onJumpToTurn?: (turn: number) => void;
}

const OUTCOME_LABEL: Record<string, string> = {
  conservative_success: 'SAFE WIN',
  risky_success:        'RISKY WIN',
  conservative_failure: 'SAFE LOSS',
  risky_failure:        'RISKY LOSS',
};

/** Phone-friendly 2-char abbreviation. Color still encodes
 *  win/loss; the letter pair encodes safe/risky × win/loss for
 *  users who can read past the color. */
const OUTCOME_LABEL_SHORT: Record<string, string> = {
  conservative_success: 'S✓',
  risky_success:        'R✓',
  conservative_failure: 'S✗',
  risky_failure:        'R✗',
};

function outcomeShort(outcome: string | undefined, compact = false): string {
  if (!outcome) return '·';
  if (compact) return OUTCOME_LABEL_SHORT[outcome] ?? '·';
  return OUTCOME_LABEL[outcome] ?? outcome.replace(/_/g, ' ').toUpperCase();
}

function Badge({ outcome, sideColor, compact }: { outcome: string | undefined; sideColor: string; compact: boolean }) {
  const color = outcomeColor(outcome);
  return (
    <div
      className={styles.badge}
      style={{
        '--side-color': sideColor,
        '--outcome-color': color,
        '--badge-size': compact ? '11px' : '9px',
        '--badge-spacing': compact ? '0' : '0.04em',
      } as CSSProperties}
    >
      {outcomeShort(outcome, compact)}
    </div>
  );
}

export function RunStrip(props: RunStripProps) {
  const { turns, leaderAName, leaderBName, onJumpToTurn } = props;
  const isPhone = useMediaQuery(PHONE_QUERY);
  if (turns.length === 0) return null;

  const handleClick = (turn: number) => {
    if (onJumpToTurn) { onJumpToTurn(turn); return; }
    if (typeof document !== 'undefined') {
      document.getElementById(`turn-${turn}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <section aria-label="Run timeline strip" className={styles.section}>
      <div className={styles.title}>Run Strip</div>
      <div
        role="list"
        className={styles.grid}
        style={{ '--turn-count': String(turns.length) } as CSSProperties}
      >
        {turns.map(cell => (
          <button
            key={cell.turn}
            type="button"
            role="listitem"
            onClick={() => handleClick(cell.turn)}
            aria-label={`Jump to turn ${cell.turn}${cell.time ? ', time ' + cell.time : ''}${cell.diverged ? ', divergent' : ''}`}
            className={[styles.cell, cell.diverged ? styles.diverged : ''].filter(Boolean).join(' ')}
          >
            <div className={styles.cellHead}>
              <span className={styles.cellTurn}>T{cell.turn}</span>
              {cell.time && !isPhone && <span>Y{cell.time}</span>}
            </div>
            <Badge outcome={cell.a.outcome} sideColor="var(--vis)" compact={isPhone} />
            <Badge outcome={cell.b.outcome} sideColor="var(--eng)" compact={isPhone} />
          </button>
        ))}
      </div>
      <div className={styles.legend}>
        <span>{leaderAName}</span>
        <span>{leaderBName}</span>
      </div>
    </section>
  );
}
