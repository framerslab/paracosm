/**
 * Branches tab (Tier 2 Spec 2B). Renders the current session's
 * parent trunk run (once terminal) and the stack of forked
 * branches launched from it, each with per-metric deltas vs parent.
 *
 * Single-click on a branch card navigates to the Reports tab;
 * loading the branch's per-turn detail there is covered by the
 * existing load-from-artifact machinery.
 *
 * @module branches/BranchesTab
 */
import { useMemo } from 'react';
import { useBranchesContext, type BranchState } from './BranchesContext';
import { useScenarioLabels, type ScenarioLabels } from '../../hooks/useScenarioLabels';
import { useDashboardNavigation } from '../../App';
import { computeBranchDeltas, formatDelta } from './BranchesTab.helpers';
import type { RunArtifact } from '../../../../engine/schema/index.js';
import styles from './BranchesTab.module.scss';

export function BranchesTab() {
  const { state } = useBranchesContext();
  const labels = useScenarioLabels();
  const navigate = useDashboardNavigation();

  if (!state.parent && state.branches.length === 0) {
    return (
      <div className={styles.emptyState} role="region" aria-label="Branches (empty)">
        <h2>No branches yet</h2>
        <p>
          Run a simulation with snapshot capture enabled (default for dashboard runs),
          then open the <strong>Reports</strong> tab and click{' '}
          <code>&#x21B3; Fork at {labels.Time} N</code> on any completed turn to branch
          with a different leader.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tab} role="region" aria-label="Branches">
      {state.parent && <ParentCard artifact={state.parent} labels={labels} />}
      <div className={styles.branchList}>
        {state.branches.map(branch => (
          <BranchCard
            key={branch.localId}
            branch={branch}
            parent={state.parent}
            labels={labels}
            onOpen={() => navigate('reports')}
          />
        ))}
      </div>
    </div>
  );
}

function ParentCard({ artifact, labels }: { artifact: RunArtifact; labels: ScenarioLabels }) {
  const metrics = (artifact.finalState?.metrics ?? {}) as Record<string, number | string | boolean>;
  const turnsCompleted = artifact.trajectory?.timepoints?.length ?? 0;
  return (
    <section className={styles.parentCard} aria-label="Parent run">
      <header className={styles.cardHeader}>
        <div>
          <h3 className={styles.parentTitle}>{artifact.metadata.scenario.name} (parent)</h3>
          <span className={styles.meta}>
            {turnsCompleted} {turnsCompleted === 1 ? labels.time : labels.times} completed · run{' '}
            <code>{artifact.metadata.runId}</code>
          </span>
        </div>
      </header>
      <dl className={styles.metrics}>
        {Object.entries(metrics).slice(0, 6).map(([k, v]) => (
          <div key={k} className={styles.metric}>
            <dt>{k}</dt>
            <dd>{formatMetricValue(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BranchCard({
  branch, parent, labels, onOpen,
}: {
  branch: BranchState;
  parent: RunArtifact | undefined;
  labels: ScenarioLabels;
  onOpen: () => void;
}) {
  const deltas = useMemo(
    () => (parent && branch.artifact ? computeBranchDeltas(parent, branch.artifact) : []),
    [parent, branch.artifact],
  );
  const statusLabel = branch.status === 'running'
    ? `Running · ${labels.Time} ${branch.currentTurn}`
    : branch.status.charAt(0).toUpperCase() + branch.status.slice(1);
  return (
    <article
      className={styles.branchCard}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Branch ${branch.actorName}, forked at ${labels.time} ${branch.forkedAtTurn}`}
    >
      <header className={styles.cardHeader}>
        <div className={styles.branchMeta}>
          <span className={styles.badge}>
            Forked at {labels.Time} {branch.forkedAtTurn}
          </span>
          <h4 className={styles.branchTitle}>
            {branch.actorName} <span className={styles.archetype}>({branch.actorArchetype})</span>
          </h4>
        </div>
        <span className={`${styles.status} ${styles[`status_${branch.status}`]}`}>
          {statusLabel}
        </span>
      </header>
      {branch.status === 'complete' && deltas.length > 0 && (
        <ul className={styles.deltas} aria-label="Delta vs parent">
          {deltas.slice(0, 4).map(d => (
            <li
              key={`${d.bag}.${d.key}`}
              className={`${styles.delta} ${styles[`direction_${d.direction}`]}`}
              title={`${d.bag}: parent=${d.parentValue}, branch=${d.branchValue}`}
            >
              {formatDelta(d)}
            </li>
          ))}
          {deltas.length > 4 && <li className={styles.more}>+{deltas.length - 4} more</li>}
        </ul>
      )}
      {branch.status === 'complete' && deltas.length === 0 && (
        <p className={styles.identical}>Identical final state. Leader overrides did not diverge.</p>
      )}
      {branch.status === 'error' && branch.errorMessage && (
        <p className={styles.error} role="alert">{branch.errorMessage}</p>
      )}
    </article>
  );
}

function formatMetricValue(v: number | string | boolean): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toString() : (Math.round(v * 100) / 100).toString();
  }
  return String(v);
}
