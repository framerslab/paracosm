/**
 * Render a single dropped RunArtifact in the Studio tab. Reuses the
 * static-mode adapters that the Library tab uses for stored runs:
 *   - turn-loop  → ReportViewAdapter
 *   - batch-*    → BatchArtifactView
 *
 * @module paracosm/dashboard/studio/StudioArtifactView
 */
import * as React from 'react';
import styles from './StudioTab.module.scss';
import { ReportViewAdapter } from '../reports/ReportViewAdapter.js';
import { BatchArtifactView } from '../reports/BatchArtifactView.js';
import type { MetricSpec } from '../viz/kit/index.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface StudioArtifactViewProps {
  artifact: RunArtifact;
  /** When true, omits the Promote + Compare action bar (used inside
   *  the bundle drill-in panel where actions are bundle-level). */
  inline?: boolean;
  onPromote: () => void;
  onCompare: () => void;
  /** Optional disabled signal for Promote (e.g., import in flight). */
  promoteBusy?: boolean;
  /** When set, the actor was already in the Library — rename the
   *  Promote button to "Already in Library" and disable. */
  alreadyExisted?: boolean;
}

export function StudioArtifactView(props: StudioArtifactViewProps): JSX.Element {
  const { artifact, inline, onPromote, onCompare, promoteBusy, alreadyExisted } = props;
  const mode = artifact.metadata.mode;
  const actorName = (artifact as { leader?: { name?: string } }).leader?.name ?? '<unnamed actor>';
  const scenarioName = artifact.metadata.scenario.name ?? artifact.metadata.scenario.id;

  // Same metric-spec derivation as RunDetailDrawer: pull metric ids
  // from the first timepoint, default range [0, 1].
  const metricSpecs: Record<string, MetricSpec> = React.useMemo(() => {
    const out: Record<string, MetricSpec> = {};
    const firstTp = artifact.trajectory?.timepoints?.[0] as { worldSnapshot?: { metrics?: Record<string, number> } } | undefined;
    const sample = firstTp?.worldSnapshot?.metrics ?? {};
    for (const id of Object.keys(sample)) {
      out[id] = { id, label: id, range: [0, 1] };
    }
    return out;
  }, [artifact]);

  return (
    <div className={styles.artifactView}>
      <header className={styles.artifactHead}>
        <div>
          <div className={styles.artifactScenario}>{scenarioName}</div>
          <div className={styles.artifactActor}>{actorName} · {mode}</div>
        </div>
        {!inline && (
          <div className={styles.artifactActions}>
            <button
              type="button"
              className={styles.promoteBtn}
              onClick={onPromote}
              disabled={promoteBusy || alreadyExisted}
            >
              {alreadyExisted ? 'Already in Library' : promoteBusy ? 'Promoting…' : 'Promote to Library'}
            </button>
            <button type="button" className={styles.compareBtn} onClick={onCompare}>
              Compare
            </button>
          </div>
        )}
      </header>
      <div className={styles.artifactBody}>
        {mode === 'turn-loop'
          ? <ReportViewAdapter artifact={artifact} />
          : <BatchArtifactView artifact={artifact} metricSpecs={metricSpecs} />}
      </div>
    </div>
  );
}
