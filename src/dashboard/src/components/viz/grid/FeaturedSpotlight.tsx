import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellSnapshot, TurnSnapshot } from '../viz-types.js';

interface FeaturedSpotlightProps {
  snapshot: TurnSnapshot | undefined;
  previousSnapshot: TurnSnapshot | undefined;
  sideColor: string;
  /** Fires when the spotlighted colonist is clicked. Parent typically
   *  opens their drilldown. */
  onSelect?: (colonist: CellSnapshot) => void;
}

interface Spotlight {
  cell: CellSnapshot;
  turn: number;
  expiresAt: number;
}

/**
 * Narrative spotlight banner that surfaces colonists who became
 * FEATURED this turn. Fires briefly (6s) when a new featured cast
 * appears for the current turn, fades out. Click → open drilldown.
 */
export function FeaturedSpotlight({
  snapshot,
  previousSnapshot,
  sideColor,
  onSelect,
}: FeaturedSpotlightProps) {
  const [spotlights, setSpotlights] = useState<Spotlight[]>([]);
  const prevFeaturedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!snapshot) return;
    const nowFeatured = snapshot.cells.filter(c => c.alive && c.featured);
    const prevFeaturedIds = previousSnapshot
      ? new Set(
          previousSnapshot.cells
            .filter(c => c.alive && c.featured)
            .map(c => c.agentId),
        )
      : prevFeaturedRef.current;
    const freshlyFeatured = nowFeatured.filter(c => !prevFeaturedIds.has(c.agentId));
    prevFeaturedRef.current = new Set(nowFeatured.map(c => c.agentId));
    if (freshlyFeatured.length === 0) return;
    const expiresAt = performance.now() + 6000;
    setSpotlights(
      freshlyFeatured.slice(0, 2).map(cell => ({ cell, turn: snapshot.turn, expiresAt })),
    );
  }, [snapshot, previousSnapshot]);

  useEffect(() => {
    if (spotlights.length === 0) return;
    const remaining = Math.max(0, spotlights[0].expiresAt - performance.now());
    const id = setTimeout(() => setSpotlights([]), remaining);
    return () => clearTimeout(id);
  }, [spotlights]);

  const visible = useMemo(() => spotlights, [spotlights]);
  if (visible.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'none',
        zIndex: 7,
        maxWidth: 240,
      }}
    >
      {visible.map(sp => (
        <button
          key={sp.cell.agentId}
          type="button"
          onClick={() => onSelect?.(sp.cell)}
          aria-label={`Spotlight: ${sp.cell.name} · ${sp.cell.department}`}
          title={`${sp.cell.name} · ${sp.cell.role} · ${sp.cell.department} · mood: ${sp.cell.mood}`}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: 'var(--bg-panel)',
            border: `1px solid ${sideColor}66`,
            borderLeft: `3px solid ${sideColor}`,
            borderRadius: 3,
            fontFamily: 'var(--mono)',
            fontSize: 'var(--font-xs)',
            color: 'var(--text-2)',
            textAlign: 'left',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
            animation: 'paracosm-spotlight-in 380ms ease-out',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
        >
          <span style={{ color: sideColor, fontSize: 'var(--font-2xs)', flexShrink: 0 }} aria-hidden="true">★</span>
          <span style={{ color: 'var(--text-1)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sp.cell.name}
          </span>
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--font-2xs)', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {sp.cell.department}
          </span>
        </button>
      ))}
    </div>
  );
}
