import * as React from 'react';
import styles from './diff.module.scss';
import type { RunArtifact } from '../../../../../engine/schema/index.js';

export interface TimelineDiffProps {
  artifacts: RunArtifact[];
}

interface TurnRow {
  turn: number;
  cells: Array<string | null>;
}

export function TimelineDiff({ artifacts }: TimelineDiffProps): JSX.Element {
  const rows = React.useMemo<TurnRow[]>(() => buildRows(artifacts), [artifacts]);
  if (rows.length === 0) {
    return (
      <section className={styles.diffSection} aria-label="Timeline comparison">
        <header className={styles.diffHead}>
          <h5 className={styles.diffTitle}>Timeline</h5>
        </header>
        <p className={styles.diffEmpty}>No timepoints in any artifact.</p>
      </section>
    );
  }
  const cssVars = { gridTemplateColumns: `60px repeat(${artifacts.length}, 1fr)` } as React.CSSProperties;
  return (
    <section className={styles.diffSection} aria-label="Timeline comparison">
      <header className={styles.diffHead}>
        <h5 className={styles.diffTitle}>Timeline</h5>
      </header>
      <div className={styles.timelineGrid} style={cssVars}>
        {rows.map((row) => (
          <React.Fragment key={row.turn}>
            <div className={styles.timelineTurn}>T{row.turn}</div>
            {row.cells.map((c, i) => (
              <div key={i} className={styles.timelineCell}>
                {c ?? <em style={{ color: 'var(--text-3)' }}>—</em>}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function buildRows(artifacts: RunArtifact[]): TurnRow[] {
  const byTurn = new Map<number, Array<string | null>>();
  for (let ai = 0; ai < artifacts.length; ai++) {
    const a = artifacts[ai];
    const tps = (a.trajectory?.timepoints ?? []) as Array<{
      turn?: number;
      label?: string;
      events?: Array<{ title?: string }>;
      decision?: { decision?: string };
    }>;
    const points = (a.trajectory?.points ?? []) as Array<{ time?: number; metrics?: Record<string, number> }>;
    const seen = new Set<number>();
    for (const tp of tps) {
      if (typeof tp.turn !== 'number') continue;
      seen.add(tp.turn);
      const summary = summarizeTimepoint(tp);
      ensureRow(byTurn, tp.turn, artifacts.length)[ai] = summary;
    }
    // Trajectory points are time-indexed (not turn-indexed) under the
    // canonical schema. Fall back to using `time` as a faux turn number
    // when the artifact lacks `timepoints`. This keeps the timeline
    // diff readable for batch-trajectory artifacts without timepoints.
    if (tps.length === 0 && points.length > 0) {
      for (const p of points) {
        const t = typeof p?.time === 'number' ? Math.round(p.time) : undefined;
        if (t === undefined || seen.has(t)) continue;
        ensureRow(byTurn, t, artifacts.length)[ai] = `t=${t}`;
      }
    }
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, cells]) => ({ turn, cells }));
}

function ensureRow(map: Map<number, Array<string | null>>, turn: number, n: number): Array<string | null> {
  let row = map.get(turn);
  if (!row) {
    row = Array.from({ length: n }, () => null);
    map.set(turn, row);
  }
  return row;
}

function summarizeTimepoint(tp: {
  label?: string;
  events?: Array<{ title?: string }>;
  decision?: { decision?: string };
}): string {
  const eventTitle = tp.events?.[0]?.title;
  const decisionLabel = tp.decision?.decision;
  if (eventTitle && decisionLabel) return `${eventTitle} → ${decisionLabel}`;
  if (eventTitle) return eventTitle;
  if (decisionLabel) return decisionLabel;
  if (tp.label) return tp.label;
  return '—';
}
