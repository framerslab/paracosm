import * as React from 'react';
import styles from './PinnedDiffPanel.module.scss';
import { useBundleArtifacts } from './hooks/useBundleArtifacts.js';
import { TimelineDiff } from './diff/TimelineDiff.js';
import { FingerprintDiff } from './diff/FingerprintDiff.js';
import { DecisionRationaleDiff } from './diff/DecisionRationaleDiff.js';
import { MetricTrajectoryDiff } from './diff/MetricTrajectoryDiff.js';
import { SwarmDiff } from './diff/SwarmDiff.js';
import type { RunRecord } from '../../../../server/services/run-record.js';

export interface PinnedDiffPanelProps {
  pinnedIds: string[];
  members: RunRecord[];
}

export function PinnedDiffPanel({ pinnedIds, members }: PinnedDiffPanelProps): JSX.Element {
  const { artifacts, loading, errors } = useBundleArtifacts(pinnedIds);

  if (pinnedIds.length === 0) {
    return (
      <section className={styles.empty} aria-label="Pinned diff">
        <p>Pin 2-3 cells above with the ☆ toggle to compare them side-by-side.</p>
      </section>
    );
  }

  const recordsById: Record<string, RunRecord> = Object.fromEntries(members.map((m) => [m.runId, m]));
  // Bundle positions are stable (1-based) and shared with the grid above
  // so an unnamed cell labeled "Actor 3" stays "Actor 3" when pinned.
  const indexByRunId = new Map(members.map((m, i) => [m.runId, i + 1]));
  const pinnedRecords = pinnedIds.map((id) => recordsById[id]).filter(Boolean);
  const pinnedArtifacts = pinnedIds
    .map((id) => artifacts[id])
    .filter((a): a is NonNullable<typeof a> => !!a);

  const headStyle = { gridTemplateColumns: `repeat(${pinnedRecords.length}, 1fr)` } as React.CSSProperties;

  return (
    <section className={styles.panel} aria-label="Pinned runs side-by-side">
      <header className={styles.head} style={headStyle}>
        {pinnedRecords.map((r) => (
          <div key={r.runId} className={styles.column}>
            <h4>{r.actorName ?? `Actor ${indexByRunId.get(r.runId) ?? '?'}`}</h4>
            {r.actorArchetype && <span className={styles.archetype}>{r.actorArchetype}</span>}
            <div className={styles.statusRow}>
              {loading[r.runId] && <span className={styles.loading}>loading…</span>}
              {errors[r.runId] && <span className={styles.error}>{errors[r.runId]}</span>}
            </div>
          </div>
        ))}
      </header>
      {pinnedArtifacts.length > 0 && (
        <>
          <FingerprintDiff artifacts={pinnedArtifacts} />
          <TimelineDiff artifacts={pinnedArtifacts} />
          <DecisionRationaleDiff artifacts={pinnedArtifacts} />
          <MetricTrajectoryDiff artifacts={pinnedArtifacts} />
          <SwarmDiff artifacts={pinnedArtifacts} />
        </>
      )}
    </section>
  );
}
