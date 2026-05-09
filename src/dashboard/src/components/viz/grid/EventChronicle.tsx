import { useMemo, useState, type CSSProperties } from 'react';
import styles from './EventChronicle.module.scss';

interface ChronicleEvent {
  turn: number;
  kind: 'birth' | 'death' | 'forge' | 'crisis';
  side: 'a' | 'b';
  label: string;
  toolName?: string;
}

type ChronicleFilter = 'all' | 'birth' | 'death' | 'forge' | 'crisis';

const FILTER_CHIPS: { key: ChronicleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'birth', label: 'Births' },
  { key: 'death', label: 'Deaths' },
  { key: 'forge', label: 'Forges' },
  { key: 'crisis', label: 'Crises' },
];

interface EventChronicleProps {
  eventsA: Array<{ type: string; turn?: number; data?: Record<string, unknown> }>;
  eventsB: Array<{ type: string; turn?: number; data?: Record<string, unknown> }>;
  currentTurn: number;
  onJumpToTurn: (turn: number) => void;
  /** Lifted hover turn so sister widgets (sparkline) can render a
   *  matching ghost cursor. 0-indexed to match currentTurn. */
  onHoverTurnChange?: (turn: number | null) => void;
  hoveredTurn?: number | null;
  /** Fires when a forge dot is clicked. Parent opens the lineage modal. */
  onForgeSelect?: (toolName: string, side: 'a' | 'b') => void;
  /**
   * Optional controlled filter. When `filter` + `onFilterChange` are
   * provided, the parent owns the filter state and can propagate it to
   * sister widgets (e.g. dim non-matching flares in the main canvas).
   * When omitted, EventChronicle falls back to its own internal state.
   */
  filter?: ChronicleFilter;
  onFilterChange?: (next: ChronicleFilter) => void;
  /**
   * Fires when the user hovers a chronicle event pill. The parent can
   * propagate the hovered kind + side to the main canvas so the panel
   * flashes the event's category color while the cursor is on the
   * pill. Makes the chronicle row feel connected to the canvas.
   */
  onHoverEventChange?: (ev: { kind: ChronicleEvent['kind']; side: 'a' | 'b'; turn: number } | null) => void;
  /**
   * Fires on shift+click of a chronicle event pill. The parent
   * navigates to the Reports tab and scrolls to that turn's detail
   * section. Shift is the standard "open in alternate view" modifier.
   * Normal click still scrubs the viz playhead (primary action).
   */
  onJumpToReports?: (turn: number) => void;
}

export type { ChronicleFilter, ChronicleEvent };

const KIND_COLORS: Record<ChronicleEvent['kind'], string> = {
  birth: 'rgba(154, 205, 96, 0.95)',
  death: 'rgba(200, 95, 80, 0.95)',
  forge: 'rgba(232, 180, 74, 0.95)',
  crisis: 'rgba(196, 74, 30, 0.95)',
};

const KIND_GLYPHS: Record<ChronicleEvent['kind'], string> = {
  birth: '+',
  death: '\u00D7', // ×
  forge: '\u25B2', // ▲
  crisis: '\u26A1', // ⚡
};

/**
 * Dots-and-ticks strip summarizing the last ~40 meaningful events
 * across both leaders. Click a dot to jump the timeline playhead to
 * that turn. Sides encoded by vertical position (upper half = A,
 * lower half = B); kinds by color + glyph; current turn highlighted.
 */
export function EventChronicle({
  eventsA,
  eventsB,
  currentTurn,
  onJumpToTurn,
  onHoverTurnChange,
  hoveredTurn,
  onForgeSelect,
  filter: controlledFilter,
  onFilterChange,
  onHoverEventChange,
  onJumpToReports,
}: EventChronicleProps) {
  const chronicle = useMemo<ChronicleEvent[]>(() => {
    const out: ChronicleEvent[] = [];
    const collect = (
      events: EventChronicleProps['eventsA'],
      side: 'a' | 'b',
    ) => {
      for (const e of events) {
        const turn = Number(e.turn ?? e.data?.turn ?? 0);
        if (turn <= 0) continue;
        if (e.type === 'birth') {
          out.push({ turn, kind: 'birth', side, label: `T${turn}: birth (${side.toUpperCase()})` });
        } else if (e.type === 'death') {
          const name = typeof e.data?.name === 'string' ? e.data.name : '';
          out.push({
            turn,
            kind: 'death',
            side,
            label: `T${turn}: ${name ? name + ' died' : 'death'} (${side.toUpperCase()})`,
          });
        } else if (e.type === 'forge_attempt') {
          const name = typeof e.data?.name === 'string' ? e.data.name : 'tool';
          const approved = e.data?.approved === true;
          out.push({
            turn,
            kind: 'forge',
            side,
            label: `T${turn}: ${approved ? 'forged' : 'rejected'} ${name} (${side.toUpperCase()}) — click for lineage`,
            toolName: name,
          });
        } else if (e.type === 'event_start' || e.type === 'director_crisis') {
          const cat = typeof e.data?.category === 'string' ? e.data.category : '';
          if (cat && ['political', 'social', 'infrastructure', 'medical', 'resource', 'environmental'].includes(cat)) {
            out.push({
              turn,
              kind: 'crisis',
              side,
              label: `T${turn}: ${cat} crisis (${side.toUpperCase()})`,
            });
          }
        }
      }
    };
    collect(eventsA, 'a');
    collect(eventsB, 'b');
    out.sort((a, b) => a.turn - b.turn);
    return out.slice(-60);
  }, [eventsA, eventsB]);

  // Uncontrolled fallback. When the parent passes `filter` + `onFilterChange`
  // the internal state is shadowed entirely — the controlled value flows
  // through and setFilterInternal is a no-op signal to React that state
  // is owned upstream.
  const [internalFilter, setFilterInternal] = useState<ChronicleFilter>('all');
  const filter = controlledFilter ?? internalFilter;
  const setFilter = (next: ChronicleFilter) => {
    if (controlledFilter === undefined) setFilterInternal(next);
    onFilterChange?.(next);
  };
  const filtered = useMemo(
    () => (filter === 'all' ? chronicle : chronicle.filter(e => e.kind === filter)),
    [chronicle, filter],
  );
  if (chronicle.length === 0) return null;

  return (
    <div aria-label="Event filter" className={styles.bar}>
      <span className={styles.heading}>
        Events ({filtered.length}
        {filter !== 'all' ? `/${chronicle.length}` : ''})
      </span>
      <div className={styles.filterRow}>
        {FILTER_CHIPS.map(chip => {
          const active = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              aria-pressed={active}
              className={[styles.filterChip, active ? styles.active : ''].filter(Boolean).join(' ')}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className={styles.dotsRow}>
        {filtered.map((ev, i) => {
          const evTurn0 = Math.max(0, ev.turn - 1);
          const isCurrent = evTurn0 === currentTurn;
          const isHovered = hoveredTurn === evTurn0;
          const dotCls = [
            styles.dot,
            isCurrent ? styles.current : '',
            isHovered ? styles.hovered : '',
          ].filter(Boolean).join(' ');
          const dotStyle = {
            '--kind-color': KIND_COLORS[ev.kind],
            '--side-shift': ev.side === 'a' ? '-2px' : '2px',
          } as CSSProperties;
          return (
            <button
              key={`${ev.turn}-${ev.side}-${ev.kind}-${i}`}
              type="button"
              onClick={(e) => {
                if (e.shiftKey && onJumpToReports) {
                  e.preventDefault();
                  onJumpToReports(ev.turn);
                  return;
                }
                if (ev.kind === 'forge' && ev.toolName && onForgeSelect) {
                  onForgeSelect(ev.toolName, ev.side);
                } else {
                  onJumpToTurn(evTurn0);
                }
              }}
              onMouseEnter={() => {
                onHoverTurnChange?.(evTurn0);
                onHoverEventChange?.({ kind: ev.kind, side: ev.side, turn: ev.turn });
              }}
              onMouseLeave={() => {
                onHoverTurnChange?.(null);
                onHoverEventChange?.(null);
              }}
              onFocus={() => {
                onHoverTurnChange?.(evTurn0);
                onHoverEventChange?.({ kind: ev.kind, side: ev.side, turn: ev.turn });
              }}
              onBlur={() => {
                onHoverTurnChange?.(null);
                onHoverEventChange?.(null);
              }}
              title={`${ev.label}${onJumpToReports ? ' · Shift+click to open in Reports' : ''}`}
              aria-label={ev.label}
              className={dotCls}
              style={dotStyle}
            >
              {KIND_GLYPHS[ev.kind]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
