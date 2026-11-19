import type { CSSProperties } from 'react';
import { actorLabel } from './forgeWords';
import styles from './ActorTile.module.scss';

/** The tile grows with its label so "A300" is never cut: 28 px for two characters, 32 for three, 40 for four. */
const TILE_SIZES: Record<number, number> = { 2: 28, 3: 32, 4: 40 };

/**
 * An actor's tile, as the living grid draws its tiles: a square with a band
 * across its top in the actor's run colour, holding the actor's slot label.
 * The band is drawn only; the label names the actor in words, and the
 * actor's name follows the tile wherever it is shown.
 */
export function ActorTile({ index, colour }: { index: number; colour: string }) {
  const label = actorLabel(index);
  const size = TILE_SIZES[label.length] ?? TILE_SIZES[4];
  const style = { '--tile-size': `${size}px`, '--tile-band': colour } as CSSProperties;
  return (
    <span className={styles.tile} style={style} data-actor-tile={label} translate="no">
      <span className={styles.band} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
