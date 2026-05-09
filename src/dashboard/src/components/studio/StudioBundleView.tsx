/**
 * Renders a Studio bundle as a grid of artifact cards. Click a card →
 * inline drill-in showing the StudioArtifactView for that artifact in
 * inline mode (Promote + Compare are bundle-level actions, not
 * per-artifact, so the drill-in suppresses them).
 *
 * @module paracosm/dashboard/studio/StudioBundleView
 */
import * as React from 'react';
import styles from './StudioTab.module.scss';
import { StudioArtifactView } from './StudioArtifactView.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

export interface StudioBundleViewProps {
  artifacts: RunArtifact[];
  bundleId?: string;
  onPromote: () => void;
  onCompare: () => void;
  promoteBusy?: boolean;
  alreadyExisted?: boolean;
}

export function StudioBundleView(props: StudioBundleViewProps): JSX.Element {
  const { artifacts, bundleId, onPromote, onCompare, promoteBusy, alreadyExisted } = props;
  const [drillIdx, setDrillIdx] = React.useState<number | null>(null);

  if (drillIdx !== null && artifacts[drillIdx]) {
    const drilled = artifacts[drillIdx];
    return (
      <div>
        <button
          type="button"
          className={styles.bundleDrillBack}
          onClick={() => setDrillIdx(null)}
        >
          ← Back to bundle
        </button>
        <StudioArtifactView
          artifact={drilled}
          inline
          onPromote={() => {}}
          onCompare={() => {}}
        />
      </div>
    );
  }

  return (
    <div>
      {bundleId && (
        // Surface the bundle's identity so users can correlate the
        // loaded JSON with a Library row after a Promote, and so
        // shared/re-imported bundles are recognizable across reloads.
        <div className={styles.bundleIdChip} title={bundleId}>
          {bundleId.length > 32 ? `${bundleId.slice(0, 28)}…` : bundleId}
        </div>
      )}
      <div className={styles.bundleActions}>
        <button
          type="button"
          className={styles.promoteBtn}
          onClick={onPromote}
          disabled={promoteBusy || alreadyExisted}
        >
          {alreadyExisted ? 'Already in Library' : promoteBusy ? 'Promoting…' : `Promote bundle (${artifacts.length})`}
        </button>
        <button type="button" className={styles.compareBtn} onClick={onCompare}>
          Compare bundle
        </button>
      </div>
      <div className={styles.bundleGrid}>
        {artifacts.map((artifact, i) => {
          const actor = (artifact as { leader?: { name?: string; archetype?: string } }).leader;
          const cost = (artifact as { cost?: { totalUSD?: number } }).cost?.totalUSD;
          const turns = artifact.trajectory?.timepoints?.length ?? 0;
          return (
            <button
              type="button"
              key={artifact.metadata.runId}
              className={styles.bundleCard}
              onClick={() => setDrillIdx(i)}
            >
              <div className={styles.bundleCardTitle}>{actor?.name ?? '<unnamed>'}</div>
              <div className={styles.bundleCardMeta}>
                {actor?.archetype ?? ''} · {turns} turn{turns === 1 ? '' : 's'}
                {typeof cost === 'number' ? ` · $${cost.toFixed(3)}` : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
