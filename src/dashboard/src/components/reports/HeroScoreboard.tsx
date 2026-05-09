import type { CSSProperties } from 'react';
import styles from './HeroScoreboard.module.scss';

/**
 * Top-of-report scoreboard. Shows winner + one-sentence divergence +
 * seven-stat A-vs-B comparison bars. Sources from verdict.finalStats
 * so the numbers match the existing VerdictPanel exactly.
 *
 * When verdict is absent (sim still in progress) the stats block hides
 * and a one-line "simulation in progress" message takes its place. The
 * hero itself stays so the first fold is still a real summary.
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
    finalStats?: { a?: Partial<FinalStats>; b?: Partial<FinalStats> };
  } | null | undefined;
  const winnerName = v?.winnerName || '';
  const headline = v?.headline || v?.summary || '';
  const keyDivergence = v?.keyDivergence || '';
  const finalA = v?.finalStats?.a;
  const finalB = v?.finalStats?.b;

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
          {STAT_ROWS.map(row => {
            const a = Number(finalA[row.key] ?? 0);
            const b = Number(finalB[row.key] ?? 0);
            const winner: 'a' | 'b' | 'tie' = a > b ? 'a' : b > a ? 'b' : 'tie';
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
                    {fmt(a, row.format)}
                  </span>
                  <span className={styles.statLabel}>{row.label}</span>
                  <span
                    className={styles.statValueB}
                    style={{
                      '--val-color': winner === 'b' ? 'var(--eng)' : 'var(--text-2)',
                      '--val-weight': winner === 'b' ? '700' : '500',
                    } as CSSProperties}
                  >
                    {fmt(b, row.format)}
                  </span>
                </div>
                <StatBar a={a} b={b} winner={winner} />
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
