import { AiWritten, isAiWritten, isAiWrittenPassage } from '../shared/AiWritten';
/**
 * Event Log tab content. Scrollable list of every SSE event with
 * per-type color coding, a rich filter bar (F15) covering text search,
 * event-type toggles, per-leader filter, and turn range. Legacy
 * `#log=<toolName>` hash filter (set by a forged tool's Show in Event Log) is
 * preserved and surfaced as a chip in the bar. The log opens at its top,
 * with its heading and filters in view; once the visitor scrolls to its end
 * it follows new events as they stream in.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import type { SimEvent } from '../../hooks/useSSE';
import { EventLogFilterBar } from './EventLogFilterBar';
import {
  applyLogFilters,
  hrefWithLogFilters,
  parseFiltersFromUrl,
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
  const pinnedRef = useRef(false);
  const [filters, setFilters] = useState<LogFilters>(readFiltersFromWindow);

  // Listen for hash changes so the legacy `#log=` chip updates when
  // a forged tool's Show in Event Log sets the hash.
  useEffect(() => {
    const onHash = () => setFilters(readFiltersFromWindow());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The heading and the filter bar scroll with the list, so the log opens
  // at its top, where they are, and follows new events only once the
  // visitor has scrolled to its end. Following from the first render put the
  // heading, search field and a tool's chip out of view, behind the sub-tab
  // bar above the panel, whenever the list was taller than the panel: on a
  // phone after a forged tool's Show in Event Log, and at every width after
  // a reload of a replay, whose events arrive after the panel mounts.
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
  // state. Only the log parameters change; the replay, tab and sub view
  // stay in the address. The legacy `#log=<tool>` hash is stripped when the
  // user clears `toolHash` via the chip's × button; otherwise the hash is
  // preserved (a forged tool's Show in Event Log can still drive it).
  const handleFiltersChange = useCallback(
    (next: LogFilters) => {
      setFilters((prev) => {
        try {
          const toolHashJustCleared = prev.toolHash !== '' && next.toolHash === '';
          window.history.replaceState({}, '', hrefWithLogFilters(window.location.href, next, toolHashJustCleared));
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
        const data = e.data ?? {};
        const hasData = Object.keys(data).length > 0;
        // A frame saved before field-level source holds a decision or a
        // department report whose text is the model's unless it fell back.
        const rawAuthored = Array.isArray(data.aiWrittenFields)
          ? data.aiWrittenFields.length > 0
          : e.type === 'decision_made'
            ? isAiWrittenPassage(data, 'decision', data.decision)
            : e.type === 'specialist_done' && isAiWrittenPassage(data, 'summary', data.summary);
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
              {!!e.data?.title && <AiWritten className={styles.title} authored={isAiWritten(e.data, "title")}>{String(e.data.title)}</AiWritten>}
              {!!e.data?.department && <span className={styles.department}>{String(e.data.department)}</span>}
              {!!e.data?.outcome && <span className={styles.outcome}>{String(e.data.outcome)}</span>}
            </summary>
            {hasData && (
              <AiWritten as="div" authored={rawAuthored}>
                <pre className={styles.dataBlock}>{JSON.stringify(data, null, 2)}</pre>
              </AiWritten>
            )}
          </details>
        );
      })}
    </div>
  );
}
