import type { LayoutTile } from './viz-types.js';
import { Tile } from './Tile.js';

interface GhostLayerProps {
  ghosts: LayoutTile[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}

/**
 * Faded outline tiles for deceased colonists. Rendered beneath pods
 * and bands at low opacity. The ghost layer visually records
 * attrition: turns play back with pods forming and outlines appearing
 * where cells used to be.
 */
export function GhostLayer({ ghosts, selectedId, onSelect }: GhostLayerProps) {
  if (ghosts.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={`${ghosts.length} deceased`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', opacity: 0.7 }}
    >
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 'var(--font-2xs)',
        color: 'var(--text-3)',
        minWidth: 60,
      }}>
        LOST {ghosts.length}
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {ghosts.map(t => (
          <Tile
            key={t.agentId}
            tile={t}
            selected={selectedId === t.agentId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
