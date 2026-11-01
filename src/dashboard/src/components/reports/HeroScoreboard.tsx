import * as React from 'react';
import type { CSSProperties } from 'react';
import styles from './HeroScoreboard.module.scss';
import { formatScenarioStat, scenarioStatLabel, scenarioStatRows, statLeader } from '../sim/verdict-stats';

void React;

/**
 * Top-of-report scoreboard. Shows winner + one-sentence divergence +
 * A-vs-B comparison bars: the scenario's header scores
 * (verdict.finalStats.metrics) plus tools forged, or the seven colony
 * stats for a verdict saved without them. Sources from
 * verdict.finalStats so the numbers match the VerdictPanel exactly.
 *
 * When verdict is absent (sim still in progress) the stats block hides
 * and a one-line "simulation in progress" message takes its place. The
 * hero itself stays so the first fold is still a real summary. A cohort
 * verdict renders nothing here: its `finalStats` is a per-actor list and
 * the report's CohortVerdict section is its own view.
 *
 * @module paracosm/dashboard/reports/HeroScoreboard
 */

export interface HeroScoreboardProps {
  /** Raw verdict payload emitted by the orchestrator. Shape mirrors
   *  VerdictData in ../sim/VerdictCard.tsx. */
  verdict: Record<string, unknown> | null | undefined;
  leaderAName: string;
  leaderBName: string;
  /** Default scrolls #verdict into view. Override for tests / custom nav. */
  onViewFullVerdict?: () => void;
}

interface FinalStats {
  population: number;
  morale: number;
  food: number;
  power: number;
  modules: number;
  science: number;
  tools: number;
}

interface StatRowDef {
  key: keyof FinalStats;
  label: string;
  format: 'int' | 'percent' | 'decimal';
}

const STAT_ROWS: StatRowDef[] = [
  { key: 'population', label: 'Population', format: 'int' },
  { key: 'morale',     label: 'Morale',     format: 'percent' },
  { key: 'food',       label: 'Food (mo)',  format: 'decimal' },
  { key: 'power',      label: 'Power (kW)', format: 'decimal' },
  { key: 'modules',    label: 'Modules',    format: 'decimal' },
  { key: 'science',    label: 'Science',    format: 'int' },
  { key: 'tools',      label: 'Tools Forged', format: 'int' },
];

function fmt(value: number, format: StatRowDef['format']): string {
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'decimal') return value.toFixed(1);
  return String(Math.round(value));
}

function StatBar({ a, b, winner }: { a: number; b: number; winner: 'a' | 'b' | 'tie' }) {
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  const aPct = Math.max(0, (a / max) * 100);
  const bPct = Math.max(0, (b / max) * 100);
  const aFill = winner === 'a' ? 'var(--vis)' : 'var(--border-hl)';
  const bFill = winner === 'b' ? 'var(--eng)' : 'var(--border-hl)';
  return (
    <div className={styles.bar}>
      <div className={styles.barLeftWrap}>
        <div
          className={styles.barLeftFill}
          style={{ '--bar-pct': `${aPct}%`, '--bar-fill': aFill } as CSSProperties}
        />
      </div>
      <div className={styles.barRightWrap}>
        <div
          className={styles.barRightFill}
          style={{ '--bar-pct': `${bPct}%`, '--bar-fill': bFill } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function HeroScoreboard(props: HeroScoreboardProps) {
  const v = props.verdict as {
    winnerName?: string;
    winner?: 'A' | 'B' | 'tie';
    headline?: string;
    summary?: string;
    keyDivergence?: string;
    finalStats?: { a?: Partial<FinalStats>; b?: Partial<FinalStats>; metrics?: unknown };
    mode?: string;
  } | null | undefined;
  if (v?.mode === 'cohort') return null;
  const winnerName = v?.winnerName || '';
  const headline = v?.headline || v?.summary || '';
  const keyDivergence = v?.keyDivergence || '';
  const finalA = v?.finalStats?.a;
  const finalB = v?.finalStats?.b;
  // One row shape for both sources: the scenario's header scores when
  // the verdict carries them, the fixed colony stats otherwise.
  const scenarioRows = scenarioStatRows(v?.finalStats);
  const rows: Array<{ key: string; label: string; a: number | undefined; b: number | undefined; text: (n: number | undefined) => string; better?: 'higher' | 'lower' }> = finalA && finalB
    ? scenarioRows
      ? [
          ...scenarioRows.map(r => ({
            key: r.id,
            label: scenarioStatLabel(r),
            a: r.a,
            b: r.b,
            text: (n: number | undefined) => formatScenarioStat(n, r.format, r.currency),
            better: r.better,
          })),
          { key: 'tools', label: 'Tools Forged', a: Number(finalA.tools ?? 0), b: Number(finalB.tools ?? 0), text: (n: number | undefined) => fmt(n ?? 0, 'int') },
        ]
      : STAT_ROWS.map(row => ({
          key: row.key,
          label: row.label,
          a: Number(finalA[row.key] ?? 0),
          b: Number(finalB[row.key] ?? 0),
          text: (n: number | undefined) => fmt(n ?? 0, row.format),
        }))
    : [];

  const scroll = props.onViewFullVerdict ?? (() => {
    if (typeof document !== 'undefined') {
      document.getElementById('verdict')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  return (
    <section aria-label="Run summary" className={styles.section}>
      <div className={styles.header}>
        <div className={styles.kicker}>Run Summary</div>
        {winnerName && <div className={styles.winner}>{winnerName} wins</div>}
        {headline && <div className={styles.headline}>{headline}</div>}
        {keyDivergence && <div className={styles.divergence}>{keyDivergence}</div>}
      </div>

      {finalA && finalB ? (
        <div className={styles.body}>
          <div className={styles.bodyHeader}>
            <span className={styles.nameA}>{props.leaderAName}</span>
            <span>Final stats</span>
            <span className={styles.nameB}>{props.leaderBName}</span>
          </div>
          {rows.map(row => {
            const { a, b } = row;
            const winner: 'a' | 'b' | 'tie' = statLeader(a, b, row.better) ?? 'tie';
            return (
              <div key={row.key} className={styles.statRow}>
                <div className={styles.statRowHead}>
                  <span
                    className={styles.statValueA}
                    style={{
                      '--val-color': winner === 'a' ? 'var(--vis)' : 'var(--text-2)',
                      '--val-weight': winner === 'a' ? '700' : '500',
                    } as CSSProperties}
                  >
                    {row.text(a)}
                  </span>
                  <span className={styles.statLabel}>{row.label}</span>
                  <span
                    className={styles.statValueB}
                    style={{
                      '--val-color': winner === 'b' ? 'var(--eng)' : 'var(--text-2)',
                      '--val-weight': winner === 'b' ? '700' : '500',
                    } as CSSProperties}
                  >
                    {row.text(b)}
                  </span>
                </div>
                <StatBar a={a ?? 0} b={b ?? 0} winner={winner} />
              </div>
            );
          })}
          <div className={styles.viewWrap}>
            <button type="button" onClick={scroll} className={styles.viewBtn}>
              View full verdict ›
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          Simulation in progress. Scoreboard will populate when the verdict arrives.
        </div>
      )}
    </section>
  );
}
