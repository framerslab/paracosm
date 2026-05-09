/**
 * Event Log tab content. Scrollable list of every SSE event with
 * per-type color coding, a rich filter bar (F15) covering text search,
 * event-type toggles, per-leader filter, and turn range. Legacy
 * `#log=<toolName>` hash filter (set by the ToolboxSection CTA) is
 * preserved and surfaced as a chip in the bar. Auto-pin-to-bottom
 * stays live as events stream in.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import type { SimEvent } from '../../hooks/useSSE';
import { EventLogFilterBar } from './EventLogFilterBar';
import {
  applyLogFilters,
  parseFiltersFromUrl,
  serializeFiltersToUrl,
  type LogFilters,
} from './EventLogPanel.helpers';
import styles from './EventLogPanel.module.scss';

const TYPE_COLORS: Record<string, string> = {
  status: 'var(--teal)',
  turn_start: 'var(--rust)',
  turn_done: 'var(--rust)',
  specialist_start: 'var(--text-3)',
  specialist_done: 'var(--green)',
  decision_pending: 'var(--amber)',
  decision_made: 'var(--amber)',
  outcome: '#e8b44a',
  drift: 'var(--teal)',
  agent_reactions: '#6aad48',
  bulletin: 'var(--text-2)',
  promotion: 'var(--teal)',
};

interface EventLogPanelProps {
  events: SimEvent[];
}

function readFiltersFromWindow(): LogFilters {
  if (typeof window === 'undefined') {
    return parseFiltersFromUrl('', '');
  }
  return parseFiltersFromUrl(window.location.search, window.location.hash);
}

export function EventLogPanel({ events }: EventLogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [filters, setFilters] = useState<LogFilters>(readFiltersFromWindow);

  // Listen for hash changes so the legacy `#log=` chip updates when
  // ToolboxSection clicks set the hash.
  useEffect(() => {
    const onHash = () => setFilters(readFiltersFromWindow());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  // Sync filters back to the URL so a refresh / share link preserves
  // state. The legacy `#log=<tool>` hash is stripped when the user
  // clears `toolHash` via the chip's × button; otherwise the hash is
  // preserved (toolbox-section clicks can still drive it).
  const handleFiltersChange = useCallback(
    (next: LogFilters) => {
      setFilters((prev) => {
        try {
          const qs = serializeFiltersToUrl(next);
          const base = window.location.pathname;
          // Drop the hash entirely when the user just cleared toolHash.
          const toolHashJustCleared = prev.toolHash !== '' && next.toolHash === '';
          const hash = toolHashJustCleared ? '' : window.location.hash;
          const target = base + qs + (hash || '');
          window.history.replaceState({}, '', target);
        } catch {
          // Best-effort; filter state still lives in React.
        }
        return next;
      });
    },
    [],
  );

  const filteredEvents = applyLogFilters(events, filters);
  const hasActiveFilter =
    filters.query !== '' ||
    filters.types.size > 0 ||
    filters.leader !== null ||
    filters.turnRange !== null ||
    filters.toolHash !== '';

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto p-4 font-mono text-xs ${styles.panel}`}
      role="log"
      aria-label="Event log"
      aria-live="polite"
    >
      <div className={styles.header}>
        <h2 className={styles.heading}>
          Event Log ({filteredEvents.length}
          {hasActiveFilter ? ` of ${events.length}` : ''} events)
        </h2>
      </div>
      <EventLogFilterBar
        events={events}
        filters={filters}
        onFiltersChange={handleFiltersChange}
      />
      {filteredEvents.length === 0 && (
        <div className={styles.emptyState}>
          {hasActiveFilter
            ? 'No events matched the current filter. Adjust or press Reset.'
            : 'No events yet. Run a simulation to see the raw SSE event stream.'}
        </div>
      )}
      {filteredEvents.map((e, i) => {
        const color = TYPE_COLORS[e.type] || 'var(--text-3)';
        const hasData = e.data && Object.keys(e.data).length > 0;
        return (
          <details
            key={i}
            className={styles.event}
            style={{ ['--log-type-color' as string]: color }}
          >
            <summary className={styles.eventSummary}>
              <span className={styles.index}>{i}</span>
              <span className={styles.type}>{e.type}</span>
              <span className={styles.leader}>{e.leader}</span>
              {e.data?.turn != null && <span className={styles.turn}>T{String(e.data.turn)}</span>}
              {!!e.data?.title && <span className={styles.title}>{String(e.data.title)}</span>}
              {!!e.data?.department && <span className={styles.department}>{String(e.data.department)}</span>}
              {!!e.data?.outcome && <span className={styles.outcome}>{String(e.data.outcome)}</span>}
            </summary>
            {hasData && (
              <pre className={styles.dataBlock}>
                {JSON.stringify(e.data, null, 2)}
              </pre>
            )}
          </details>
        );
      })}
    </div>
  );
}
