import type { LayoutPod } from './viz-types.js';
import { Tile } from './Tile.js';

interface FamilyPodProps {
  pod: LayoutPod;
  selectedId: string | null;
  divergedIds: Set<string> | undefined;
  onSelect: (agentId: string) => void;
}

/**
 * Renders a family pod: anchor + partner on the top row, children
 * wrapping below. The pod background is a 4% alpha tint mixed from
 * the members' department colors so same-dept families glow in their
 * department hue and mixed-dept families read as warm neutral.
 */
export function FamilyPod({ pod, selectedId, divergedIds, onSelect }: FamilyPodProps) {
  const anchors = pod.tiles.filter(t => t.podRole === 'anchor' || t.podRole === 'partner');
  const children = pod.tiles.filter(t => t.podRole === 'child');
  return (
    <div
      role="group"
      aria-label={`Family of ${anchors.map(t => t.name).join(' and ')}`}
      style={{
        background: `color-mix(in srgb, ${pod.sharedTint} 4%, transparent)`,
        border: `1px solid color-mix(in srgb, ${pod.sharedTint} 30%, transparent)`,
        borderRadius: 8,
        padding: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        {anchors.map(t => (
          <Tile
            key={t.agentId}
            tile={t}
            selected={selectedId === t.agentId}
            diverged={divergedIds?.has(t.agentId)}
            onSelect={onSelect}
          />
        ))}
      </div>
      {children.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {children.map(t => (
            <Tile
              key={t.agentId}
              tile={t}
              selected={selectedId === t.agentId}
              diverged={divergedIds?.has(t.agentId)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
