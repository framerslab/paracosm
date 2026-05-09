import type { LayoutTile } from './viz-types.js';
import { Tile } from './Tile.js';

interface DeptBandProps {
  label: string;
  tiles: LayoutTile[];
  selectedId: string | null;
  divergedIds: Set<string> | undefined;
  onSelect: (agentId: string) => void;
  /**
   * A-vs-B divergence magnitude for this department on the current
   * turn (in [0, 1]). When the diff overlay toggle in SwarmViz is on,
   * the band gets an outline scaled by magnitude:
   *   - 0           : no outline (departments match)
   *   - (0, 0.5)    : 1px amber outline (slight divergence)
   *   - [0.5, 1]    : 2px rust outline + Δ corner badge
   * Undefined or null means "overlay off" — the band renders as today.
   */
  diffMagnitude?: number | null;
}

/**
 * Horizontal band with a text label, count, and row of small tiles.
 * In families mode bands only hold unpartnered colonists; in
 * departments / mood / age modes they hold everyone alive under the
 * chosen bucket key.
 */
export function DeptBand({ label, tiles, selectedId, divergedIds, onSelect, diffMagnitude }: DeptBandProps) {
  if (tiles.length === 0) return null;
  const showDiff = typeof diffMagnitude === 'number' && diffMagnitude > 0;
  const diffStrong = showDiff && diffMagnitude! >= 0.5;
  const diffOutline = showDiff
    ? diffStrong
      ? '2px solid var(--rust)'
      : '1px solid var(--amber)'
    : 'none';
  return (
    <div
      role="group"
      aria-label={
        showDiff
          ? `${label}, ${tiles.length} colonists. Diverged from other leader.`
          : `${label}, ${tiles.length} colonists`
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        position: 'relative',
        outline: diffOutline,
        outlineOffset: diffStrong ? '-2px' : '-1px',
        borderRadius: 4,
      }}
    >
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 'var(--font-2xs)',
        color: 'var(--text-3)',
        minWidth: 60,
      }}>
        {label.toUpperCase()} {tiles.length}
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {tiles.map(t => (
          <Tile
            key={t.agentId}
            tile={t}
            selected={selectedId === t.agentId}
            diverged={divergedIds?.has(t.agentId)}
            onSelect={onSelect}
          />
        ))}
      </div>
      {diffStrong && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 2,
            right: 4,
            fontFamily: 'var(--mono)',
            fontSize: 'var(--font-3xs)',
            fontWeight: 800,
            color: 'var(--rust)',
            pointerEvents: 'none',
          }}
        >
          Δ
        </span>
      )}
    </div>
  );
}
