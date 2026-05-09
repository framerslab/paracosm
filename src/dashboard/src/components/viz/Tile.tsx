import { type CSSProperties, memo } from 'react';
import type { LayoutTile } from './viz-types.js';
import { DEPARTMENT_COLORS, DEFAULT_DEPT_COLOR } from './viz-types.js';
import styles from './Tile.module.scss';

interface TileProps {
  tile: LayoutTile;
  selected: boolean;
  diverged?: boolean;
  onSelect: (agentId: string) => void;
}

const MOOD_GLYPHS: Record<string, string> = {
  positive: ':)',
  neutral: ':|',
  anxious: ':/',
  negative: ':(',
  defiant: '!',
  hopeful: '*',
  resigned: 'z',
};

const SIZES = {
  xl: 96,
  md: 56,
  sm: 28,
  ghost: 28,
};

/**
 * One colonist, rendered as a focusable button. Size + content scale
 * by tier: xl (featured, full identity), md (partnered, name + glyph),
 * sm (solo, initial + color), ghost (deceased, outline only). Click or
 * Enter opens the drilldown panel for this colonist.
 */
function TileImpl(props: TileProps) {
  const { tile, selected, diverged, onSelect } = props;
  const size = SIZES[tile.tierInfo.size];
  const deptColor = DEPARTMENT_COLORS[tile.department] ?? DEFAULT_DEPT_COLOR;
  const isGhost = tile.tierInfo.size === 'ghost';
  const isXl = tile.tierInfo.size === 'xl';
  const firstName = tile.name.split(/\s+/)[0];
  const initial = firstName.charAt(0).toUpperCase();
  const mood = MOOD_GLYPHS[tile.mood] ?? MOOD_GLYPHS.neutral;

  const tileStyle: CSSProperties = {
    '--tile-size': `${size}px`,
    '--tile-padding': isXl ? '6px' : '2px',
    '--dept-bar-h': isXl ? '6px' : '3px',
    '--dept-bar-margin': isXl ? '-6px -6px 6px -6px' : '-2px -2px 2px -2px',
    '--dept-color': deptColor,
    '--diverged-shadow': diverged ? 'inset 0 0 0 9999px color-mix(in srgb, var(--rust) 12%, transparent)' : 'none',
  } as CSSProperties;

  const cls = [
    styles.tile,
    selected ? styles.selected : '',
    isGhost ? styles.ghost : '',
  ].filter(Boolean).join(' ');

  const label = `${tile.name}, ${tile.role || 'colonist'}, ${tile.department || 'unassigned'}, mood ${tile.mood}${isGhost ? ', deceased' : ''}`;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(tile.agentId)}
      className={cls}
      style={tileStyle}
    >
      <span aria-hidden="true" className={styles.deptBar} />
      {isGhost && (
        <span aria-hidden="true" className={styles.ghostX}>X</span>
      )}
      {!isGhost && isXl && (
        <>
          <div className={styles.xlName}>{tile.name}</div>
          <div className={styles.xlRole}>{tile.role || ''}</div>
          <div className={styles.flexFill} />
          <div className={styles.xlBottom}>
            <span aria-hidden="true">{mood}</span>
            <span className={styles.xlAge}>{tile.age ?? ''}</span>
          </div>
        </>
      )}
      {!isGhost && tile.tierInfo.size === 'md' && (
        <>
          <div className={styles.mdName}>{firstName}</div>
          <div className={styles.flexFill} />
          <div className={styles.mdBottom}>
            <span aria-hidden="true">{mood}</span>
            <span className={styles.mdAge}>{tile.age ?? ''}</span>
          </div>
        </>
      )}
      {!isGhost && tile.tierInfo.size === 'sm' && (
        <div className={styles.smInitial}>{initial}</div>
      )}
    </button>
  );
}

export const Tile = memo(TileImpl);
