import { useMemo, type CSSProperties } from 'react';
import styles from './TurnProgress.module.scss';

type Event = { type: string; turn?: number; data?: Record<string, unknown> };

interface TurnProgressProps {
  eventsA: Event[];
  eventsB: Event[];
  totalDepartments: number;
}

interface SideProgress {
  inFlightTurn: number | null;
  deptsReported: Set<string>;
}

function computeSide(events: Event[]): SideProgress {
  let lastCompletedTurn = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'turn_done') {
      const t = Number(e.turn ?? e.data?.turn ?? 0);
      if (t > 0) {
        lastCompletedTurn = t;
        break;
      }
    }
  }
  const inFlightTurn = lastCompletedTurn + 1;
  const reported = new Set<string>();
  let sawInFlight = false;
  for (const e of events) {
    const t = Number(e.turn ?? e.data?.turn ?? 0);
    if (e.type === 'specialist_done' && t === inFlightTurn) {
      const dept = typeof e.data?.department === 'string' ? e.data.department : '';
      if (dept) reported.add(dept);
      sawInFlight = true;
    }
    if (e.type === 'turn_done' && t === inFlightTurn) {
      return { inFlightTurn: null, deptsReported: new Set() };
    }
  }
  return {
    inFlightTurn: sawInFlight ? inFlightTurn : null,
    deptsReported: reported,
  };
}

/**
 * Thin strip above the timeline showing in-flight turn state per
 * leader. Renders *only* while a turn is mid-stream (departments
 * reporting, turn_done not yet fired). Gives the viewer an at-a-
 * glance "the sim is thinking" signal without a spinner.
 */
export function TurnProgress({
  eventsA,
  eventsB,
  totalDepartments,
}: TurnProgressProps) {
  const a = useMemo(() => computeSide(eventsA), [eventsA]);
  const b = useMemo(() => computeSide(eventsB), [eventsB]);
  if (a.inFlightTurn === null && b.inFlightTurn === null) return null;

  const denom = Math.max(1, totalDepartments);
  const row = (
    label: string,
    color: string,
    p: SideProgress,
  ) => {
    if (p.inFlightTurn === null) return null;
    const pct = Math.min(100, (p.deptsReported.size / denom) * 100);
    return (
      <div
        className={styles.row}
        style={{ '--side-color': color } as CSSProperties}
      >
        <span className={styles.label}>{label}</span>
        <span>T{p.inFlightTurn}</span>
        <div className={styles.track}>
          <div
            className={styles.fill}
            style={{ '--bar-pct': `${pct}%` } as CSSProperties}
          />
        </div>
        <span className={styles.count}>
          {p.deptsReported.size}/{denom}
        </span>
      </div>
    );
  };

  return (
    <div aria-live="polite" className={styles.bar}>
      {row('A', 'var(--vis)', a)}
      {row('B', 'var(--eng)', b)}
    </div>
  );
}
