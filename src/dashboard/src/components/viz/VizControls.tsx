import type { ReactNode } from 'react';
import styles from './VizControls.module.scss';

interface VizControlsProps {
  currentTurn: number;
  maxTurn: number;
  time: number;
  /** The turn banner above shows the turn's time: on a phone the row leaves it out. */
  timeInBanner?: boolean;
  playing: boolean;
  speed: number;
  onTurnChange: (turn: number) => void;
  onPlayPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSpeedChange: (speed: number) => void;
  /** The Latest key wider than 768 px, where playback stays in view while the fields scroll. */
  latest?: ReactNode;
}

const SPEEDS = [0.5, 1, 2, 4];

/**
 * Minimal playback controls row: step back, play/pause, step forward,
 * scrub slider, turn, speed selector. Mode + layout + divergence toggles
 * retired; those moved into the visible ClusterToggleRow and D-key
 * shortcut.
 *
 * One row at every width from 320 px: on a phone the turn leaves its time to
 * the turn banner above when the banner shows it, the slider takes the room
 * the keys leave, and below 900 px every key is 44 px tall and wide.
 */
export function VizControls({
  currentTurn, maxTurn, time, timeInBanner = false, playing, speed,
  onTurnChange, onPlayPause, onStepBack, onStepForward, onSpeedChange, latest,
}: VizControlsProps) {
  return (
    <div className={styles.row}>
      <button type="button" onClick={onStepBack} disabled={currentTurn <= 0} aria-label="Previous turn" className={styles.key}>
        {'<<'}
      </button>
      <button type="button" onClick={onPlayPause} disabled={maxTurn <= 1} aria-label={playing ? 'Pause' : 'Play'} className={styles.key}>
        {playing ? '\u25A0' : '\u25B6'}
      </button>
      <button type="button" onClick={onStepForward} disabled={currentTurn >= maxTurn - 1} aria-label="Next turn" className={styles.key}>
        {'>>'}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, maxTurn - 1)}
        value={currentTurn}
        onChange={e => onTurnChange(Number(e.target.value))}
        className={styles.scrub}
        aria-label="Scrub timeline"
        aria-valuetext={`Turn ${currentTurn + 1} of ${maxTurn}`}
      />
      {latest && <div className={styles.latest}>{latest}</div>}
      <span className={styles.turn}>
        T{currentTurn + 1}/{maxTurn}{time ? <span className={timeInBanner ? styles.timeShownAbove : undefined}>{` \u00b7 ${time}`}</span> : null}
      </span>
      <select
        aria-label="Playback speed"
        value={speed}
        onChange={e => onSpeedChange(Number(e.target.value))}
        className={styles.speed}
      >
        {SPEEDS.map(s => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
}
