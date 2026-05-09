import * as React from 'react';
import styles from './diff.module.scss';
import swarmStyles from './SwarmDiff.module.scss';
import {
  aliveCount,
  deathCount,
  moodHistogram,
  departmentHeadcount,
} from '../../../../../runtime/swarm/index.js';
import type { RunArtifact, SwarmAgent } from '../../../../../engine/schema/index.js';

export interface SwarmDiffProps {
  artifacts: RunArtifact[];
}

interface PerRunSummary {
  hasSwarm: boolean;
  alive: number;
  dead: number;
  morale?: number;
  topMoods: Array<[string, number]>;
  topDepts: Array<[string, number]>;
}

interface CrossRunDivergence {
  /** Agents alive only in this run, indexed by run column. */
  aliveOnly: string[][];
  /** Agents whose mood label differs across runs (need same agentId). */
  moodDeltas: Array<{ agent: string; moods: Array<string | undefined> }>;
}

/**
 * Cross-run swarm diff for the Compare modal.
 *
 * Renders three layers:
 *   1. Per-run summary card (alive/dead/morale + top moods + top depts).
 *   2. Survivor delta — agents alive in one run but not another. Same
 *      seed produces an identical agent roster, so this is a clean
 *      "who lived in which world" diff.
 *   3. Mood-delta table — shared agents whose latest mood label differs.
 *
 * Renders nothing when none of the artifacts carry `finalSwarm`.
 */
export function SwarmDiff({ artifacts }: SwarmDiffProps): JSX.Element | null {
  const summaries = React.useMemo<PerRunSummary[]>(
    () => artifacts.map(buildSummary),
    [artifacts],
  );
  const divergence = React.useMemo<CrossRunDivergence>(
    () => buildDivergence(artifacts),
    [artifacts],
  );

  if (!summaries.some(s => s.hasSwarm)) return null;

  const cssVars = {
    gridTemplateColumns: `repeat(${artifacts.length}, 1fr)`,
  } as React.CSSProperties;

  return (
    <section className={styles.diffSection} aria-label="Swarm comparison">
      <header className={styles.diffHead}>
        <h5 className={styles.diffTitle}>Agent swarm</h5>
      </header>

      <div className={swarmStyles.summaryGrid} style={cssVars}>
        {summaries.map((s, i) => (
          <SummaryColumn key={i} summary={s} />
        ))}
      </div>

      {divergence.aliveOnly.some(list => list.length > 0) && (
        <div className={swarmStyles.divBlock}>
          <h6 className={swarmStyles.divTitle}>Survivor delta</h6>
          <p className={swarmStyles.divNote}>
            Agents alive in one run but not the others. Same seed → same starting roster, so the delta isolates leader-driven mortality.
          </p>
          <div className={swarmStyles.aliveOnlyGrid} style={cssVars}>
            {divergence.aliveOnly.map((list, i) => (
              <div key={i} className={swarmStyles.aliveOnlyCol}>
                <span className={swarmStyles.aliveOnlyHead}>
                  Run {String.fromCharCode(65 + i)} only
                  <span className={swarmStyles.aliveOnlyCount}>· {list.length}</span>
                </span>
                {list.length === 0 ? (
                  <span className={swarmStyles.aliveOnlyEmpty}>—</span>
                ) : (
                  <ul className={swarmStyles.aliveOnlyList}>
                    {list.slice(0, 8).map(name => (
                      <li key={name}>{name}</li>
                    ))}
                    {list.length > 8 && (
                      <li className={swarmStyles.aliveOnlyMore}>+{list.length - 8} more</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {divergence.moodDeltas.length > 0 && (
        <div className={swarmStyles.divBlock}>
          <h6 className={swarmStyles.divTitle}>
            Mood divergence <span className={swarmStyles.divMeta}>· {divergence.moodDeltas.length} agents differ</span>
          </h6>
          <div
            className={swarmStyles.moodTable}
            style={{ gridTemplateColumns: `1.4fr repeat(${artifacts.length}, 1fr)` } as React.CSSProperties}
          >
            <span className={swarmStyles.moodHead}>Agent</span>
            {artifacts.map((_, i) => (
              <span key={i} className={swarmStyles.moodHead}>
                Run {String.fromCharCode(65 + i)}
              </span>
            ))}
            {divergence.moodDeltas.slice(0, 12).map(row => (
              <React.Fragment key={row.agent}>
                <span className={swarmStyles.moodAgent}>{row.agent}</span>
                {row.moods.map((m, i) => (
                  <span key={i} className={swarmStyles.moodCell}>{m ?? '—'}</span>
                ))}
              </React.Fragment>
            ))}
          </div>
          {divergence.moodDeltas.length > 12 && (
            <p className={swarmStyles.divNote}>
              +{divergence.moodDeltas.length - 12} more agent mood differences not shown.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryColumn({ summary }: { summary: PerRunSummary }): JSX.Element {
  if (!summary.hasSwarm) {
    return (
      <div className={swarmStyles.summaryCol}>
        <span className={swarmStyles.summaryEmpty}>No swarm captured</span>
      </div>
    );
  }
  return (
    <div className={swarmStyles.summaryCol}>
      <div className={swarmStyles.summaryStats}>
        <span><strong>{summary.alive}</strong> alive</span>
        <span><strong>{summary.dead}</strong> dead</span>
        {typeof summary.morale === 'number' && (
          <span><strong>{Math.round(summary.morale * 100)}%</strong> morale</span>
        )}
      </div>
      {summary.topMoods.length > 0 && (
        <div className={swarmStyles.summaryGroup}>
          <span className={swarmStyles.summaryLabel}>Top moods</span>
          <ul className={swarmStyles.summaryList}>
            {summary.topMoods.map(([m, n]) => (
              <li key={m}>{m} <span className={swarmStyles.summaryCount}>{n}</span></li>
            ))}
          </ul>
        </div>
      )}
      {summary.topDepts.length > 0 && (
        <div className={swarmStyles.summaryGroup}>
          <span className={swarmStyles.summaryLabel}>Top depts</span>
          <ul className={swarmStyles.summaryList}>
            {summary.topDepts.map(([d, n]) => (
              <li key={d}>{d} <span className={swarmStyles.summaryCount}>{n}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function buildSummary(artifact: RunArtifact): PerRunSummary {
  const swarm = artifact.finalSwarm;
  if (!swarm) {
    return { hasSwarm: false, alive: 0, dead: 0, topMoods: [], topDepts: [] };
  }
  const moodHist = moodHistogram(swarm);
  const deptHist = departmentHeadcount(swarm);
  return {
    hasSwarm: true,
    alive: aliveCount(swarm),
    dead: deathCount(swarm),
    morale: swarm.morale,
    topMoods: Object.entries(moodHist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4),
    topDepts: Object.entries(deptHist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4),
  };
}

function buildDivergence(artifacts: RunArtifact[]): CrossRunDivergence {
  const swarms = artifacts.map(a => a.finalSwarm);

  // Survivor delta: agents alive in this run but missing from at least
  // one other run's alive set. Map each run to a Set<agentId> of alive
  // agents, plus a name lookup.
  const aliveSets: Array<Set<string>> = swarms.map(s =>
    s ? new Set(s.agents.filter(a => a.alive).map(a => a.agentId)) : new Set(),
  );
  const nameById = new Map<string, string>();
  for (const swarm of swarms) {
    if (!swarm) continue;
    for (const a of swarm.agents) {
      if (!nameById.has(a.agentId)) nameById.set(a.agentId, a.name);
    }
  }
  const aliveOnly: string[][] = aliveSets.map((set, idx) => {
    const others = aliveSets.filter((_, i) => i !== idx);
    if (others.length === 0) return [];
    const out: string[] = [];
    for (const id of set) {
      const inAll = others.every(o => o.has(id));
      if (!inAll) out.push(nameById.get(id) ?? id);
    }
    return out.sort();
  });

  // Mood divergence: shared agents (present in all swarms) whose mood
  // labels differ across at least two runs.
  const moodDeltas: Array<{ agent: string; moods: Array<string | undefined> }> = [];
  if (swarms.every(Boolean)) {
    const allIds = new Set<string>();
    for (const swarm of swarms) {
      if (!swarm) continue;
      for (const a of swarm.agents) allIds.add(a.agentId);
    }
    for (const id of allIds) {
      const perRun = swarms.map(s => s?.agents.find(a => a.agentId === id));
      if (perRun.some(a => !a)) continue;
      const moods = perRun.map(a => (a as SwarmAgent).mood);
      const distinct = new Set(moods.filter(Boolean));
      if (distinct.size > 1) {
        moodDeltas.push({ agent: nameById.get(id) ?? id, moods });
      }
    }
    moodDeltas.sort((a, b) => a.agent.localeCompare(b.agent));
  }

  return { aliveOnly, moodDeltas };
}
