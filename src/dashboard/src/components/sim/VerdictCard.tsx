import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import styles from './VerdictCard.module.scss';

interface VerdictData {
  winner: 'A' | 'B' | 'tie';
  winnerName: string;
  headline: string;
  summary: string;
  keyDivergence: string;
  scores: {
    a: { survival: number; prosperity: number; morale: number; innovation: number };
    b: { survival: number; prosperity: number; morale: number; innovation: number };
  };
  leaderA: { name: string; archetype: string; unit: string };
  leaderB: { name: string; archetype: string; unit: string };
  finalStats: {
    a: { population: number; morale: number; food: number; power: number; modules: number; science: number; tools: number };
    b: { population: number; morale: number; food: number; power: number; modules: number; science: number; tools: number };
  };
}

interface VerdictCardProps {
  verdict: Record<string, unknown>;
}

function ScoreBar({ label, a, b }: { label: string; a: number; b: number }) {
  const max = Math.max(a, b, 1);
  const aPct = `${(a / max) * 100}%`;
  const bPct = `${(b / max) * 100}%`;
  return (
    <div className={styles.scoreBar}>
      <div className={styles.scoreBarLegend}>
        <span>{a.toFixed(0)}</span>
        <span className={styles.scoreBarLabel}>{label}</span>
        <span>{b.toFixed(0)}</span>
      </div>
      <div className={styles.scoreBarTrack}>
        <div className={styles.scoreBarLeftCol}>
          <div
            className={styles.scoreBarFillLeft}
            style={{
              '--bar-pct': aPct,
              '--bar-color': a >= b ? 'var(--vis)' : 'var(--border-hl)',
            } as CSSProperties}
          />
        </div>
        <div className={styles.scoreBarRightCol}>
          <div
            className={styles.scoreBarFillRight}
            style={{
              '--bar-pct': bPct,
              '--bar-color': b >= a ? 'var(--eng)' : 'var(--border-hl)',
            } as CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, a, b, format }: { label: string; a: number; b: number; format?: 'percent' | 'decimal' | 'number' }) {
  const fmt = (v: number) => {
    if (format === 'percent') return `${Math.round(v * 100)}%`;
    if (format === 'decimal') return v.toFixed(1);
    return String(Math.round(v));
  };
  const better = a > b ? 'a' : b > a ? 'b' : null;
  return (
    <div className={styles.statRow}>
      <span
        className={styles.statValueA}
        style={{
          '--stat-color': better === 'a' ? 'var(--vis)' : 'var(--text-2)',
          '--stat-weight': better === 'a' ? '700' : '400',
        } as CSSProperties}
      >
        {fmt(a)}
      </span>
      <span className={styles.statLabel}>{label}</span>
      <span
        className={styles.statValueB}
        style={{
          '--stat-color': better === 'b' ? 'var(--eng)' : 'var(--text-2)',
          '--stat-weight': better === 'b' ? '700' : '400',
        } as CSSProperties}
      >
        {fmt(b)}
      </span>
    </div>
  );
}

/**
 * Build a markdown export of the verdict for sharing or saving.
 */
function buildMarkdownExport(v: VerdictData): string {
  const lines: string[] = [];
  lines.push('# Simulation Verdict');
  lines.push('');
  lines.push(`**Winner:** ${v.winner === 'tie' ? 'Tie' : `${v.winnerName} (Leader ${v.winner})`}`);
  lines.push('');
  lines.push(`> ${v.headline}`);
  lines.push('');
  lines.push(v.summary);
  lines.push('');
  lines.push('## Key Divergence');
  lines.push('');
  lines.push(v.keyDivergence);
  if (v.scores) {
    lines.push('');
    lines.push('## Scores');
    lines.push('');
    lines.push('| Dimension | ' + (v.leaderA?.name || 'A') + ' | ' + (v.leaderB?.name || 'B') + ' |');
    lines.push('|---|---|---|');
    lines.push(`| Survival | ${v.scores.a?.survival ?? 0} | ${v.scores.b?.survival ?? 0} |`);
    lines.push(`| Prosperity | ${v.scores.a?.prosperity ?? 0} | ${v.scores.b?.prosperity ?? 0} |`);
    lines.push(`| Morale | ${v.scores.a?.morale ?? 0} | ${v.scores.b?.morale ?? 0} |`);
    lines.push(`| Innovation | ${v.scores.a?.innovation ?? 0} | ${v.scores.b?.innovation ?? 0} |`);
  }
  if (v.finalStats) {
    lines.push('');
    lines.push('## Final Colony Stats');
    lines.push('');
    lines.push('| Stat | ' + (v.leaderA?.name || 'A') + ' | ' + (v.leaderB?.name || 'B') + ' |');
    lines.push('|---|---|---|');
    lines.push(`| Population | ${v.finalStats.a?.population ?? 0} | ${v.finalStats.b?.population ?? 0} |`);
    lines.push(`| Morale | ${Math.round((v.finalStats.a?.morale ?? 0) * 100)}% | ${Math.round((v.finalStats.b?.morale ?? 0) * 100)}% |`);
    lines.push(`| Food (months) | ${(v.finalStats.a?.food ?? 0).toFixed(1)} | ${(v.finalStats.b?.food ?? 0).toFixed(1)} |`);
    lines.push(`| Power (kW) | ${(v.finalStats.a?.power ?? 0).toFixed(1)} | ${(v.finalStats.b?.power ?? 0).toFixed(1)} |`);
    lines.push(`| Modules | ${(v.finalStats.a?.modules ?? 0).toFixed(1)} | ${(v.finalStats.b?.modules ?? 0).toFixed(1)} |`);
    lines.push(`| Science | ${v.finalStats.a?.science ?? 0} | ${v.finalStats.b?.science ?? 0} |`);
    lines.push(`| Tools Forged | ${v.finalStats.a?.tools ?? 0} | ${v.finalStats.b?.tools ?? 0} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('Generated by [Paracosm](https://paracosm.agentos.sh)');
  return lines.join('\n');
}

function winColorFor(winner: VerdictData['winner']): string {
  if (winner === 'A') return 'var(--vis)';
  if (winner === 'B') return 'var(--eng)';
  return 'var(--amber)';
}

/**
 * Full verdict body shared by the Sim modal and the Reports inline
 * panel. Accepts the parsed VerdictData and renders the winner
 * headline, summary, key divergence, score bars, and final stats.
 * Caller supplies any wrapping chrome (modal vs inline card).
 */
export function VerdictDetails({ v, onExport, copied }: { v: VerdictData; onExport?: () => void; copied?: boolean }) {
  const winColor = winColorFor(v.winner);
  return (
    <>
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <div className={styles.headerKicker}>SIMULATION VERDICT</div>
          <div
            className={styles.headerWinner}
            style={{ '--win-color': winColor } as CSSProperties}
          >
            {v.winner === 'tie' ? 'TIE' : `${v.winnerName} WINS`}
          </div>
          <div className={styles.headerHeadline}>{v.headline}</div>
        </div>
        {onExport && (
          <div className={styles.exportWrap}>
            <button
              onClick={onExport}
              aria-label="Copy verdict as markdown"
              className={[styles.exportBtn, copied ? styles.copied : ''].filter(Boolean).join(' ')}
            >
              {copied ? 'COPIED ✓' : 'EXPORT MD'}
            </button>
          </div>
        )}
      </div>

      <div className={styles.summary}>{v.summary}</div>

      <div className={styles.divergenceBox}>
        <span className={styles.divergenceLabel}>KEY DIVERGENCE</span>
        <div className={styles.divergenceBody}>{v.keyDivergence}</div>
      </div>

      <div className={styles.matchupRow}>
        <div className={styles.matchupSide}>
          <div className={styles.matchupNameA}>{v.leaderA?.name || 'Leader A'}</div>
          <div className={styles.matchupArchetype}>{v.leaderA?.archetype}</div>
        </div>
        <div className={styles.matchupVs}>vs</div>
        <div className={styles.matchupSide}>
          <div className={styles.matchupNameB}>{v.leaderB?.name || 'Leader B'}</div>
          <div className={styles.matchupArchetype}>{v.leaderB?.archetype}</div>
        </div>
      </div>

      <div className={styles.scoreBarsWrap}>
        <ScoreBar label="Survival" a={v.scores.a?.survival ?? 0} b={v.scores.b?.survival ?? 0} />
        <ScoreBar label="Prosperity" a={v.scores.a?.prosperity ?? 0} b={v.scores.b?.prosperity ?? 0} />
        <ScoreBar label="Morale" a={v.scores.a?.morale ?? 0} b={v.scores.b?.morale ?? 0} />
        <ScoreBar label="Innovation" a={v.scores.a?.innovation ?? 0} b={v.scores.b?.innovation ?? 0} />
      </div>

      {v.finalStats && (
        <div className={styles.finalStats}>
          <div className={styles.finalStatsLabel}>FINAL COLONY STATS</div>
          <StatRow label="Population" a={v.finalStats.a?.population ?? 0} b={v.finalStats.b?.population ?? 0} />
          <StatRow label="Morale" a={v.finalStats.a?.morale ?? 0} b={v.finalStats.b?.morale ?? 0} format="percent" />
          <StatRow label="Food (mo)" a={v.finalStats.a?.food ?? 0} b={v.finalStats.b?.food ?? 0} format="decimal" />
          <StatRow label="Power (kW)" a={v.finalStats.a?.power ?? 0} b={v.finalStats.b?.power ?? 0} format="decimal" />
          <StatRow label="Modules" a={v.finalStats.a?.modules ?? 0} b={v.finalStats.b?.modules ?? 0} format="decimal" />
          <StatRow label="Science" a={v.finalStats.a?.science ?? 0} b={v.finalStats.b?.science ?? 0} />
          <StatRow label="Tools Forged" a={v.finalStats.a?.tools ?? 0} b={v.finalStats.b?.tools ?? 0} />
        </div>
      )}
    </>
  );
}

/**
 * Inline full-width verdict panel for the Reports tab. Renders every
 * field VerdictDetails surfaces without the click-to-open step the
 * Sim modal requires, and adds a winner ribbon above the header.
 */
export function VerdictPanel({ verdict: raw }: VerdictCardProps) {
  const v = raw as unknown as VerdictData;
  const [copied, setCopied] = useState(false);
  const handleExport = useCallback(() => {
    const md = buildMarkdownExport(v);
    navigator.clipboard.writeText(md).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
      () => { /* clipboard denied — silent */ },
    );
  }, [v]);
  if (!v.winner || !v.scores) return null;
  const winColor = winColorFor(v.winner);
  return (
    <div
      className={styles.panel}
      style={{ '--win-color': winColor } as CSSProperties}
    >
      <VerdictDetails v={v} onExport={handleExport} copied={copied} />
    </div>
  );
}

/**
 * Verdict surface. Renders as a compact banner pinned at the top of the
 * sim area when a verdict is available — never takes over the layout.
 * The full verdict (scores, stats, summary) opens in a modal on demand,
 * with a copy-to-clipboard markdown export so the user can save or
 * share the result without leaving the sim view.
 */
export function VerdictCard({ verdict: raw }: VerdictCardProps) {
  const v = raw as unknown as VerdictData;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Escape key closes the modal when open. Matches the dismissal
  // behavior of every other dashboard modal (CostBreakdown,
  // ShortcutsOverlay, SimFooterBar pops, ToolDetailModal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleExport = useCallback(() => {
    const md = buildMarkdownExport(v);
    navigator.clipboard.writeText(md).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
      () => { /* clipboard denied — silent */ },
    );
  }, [v]);

  if (!v.winner || !v.scores) return null;
  const winColor = winColorFor(v.winner);
  const winnerLabel = v.winner === 'tie' ? 'Tie' : `${v.winnerName} wins`;
  const winColorVar = { '--win-color': winColor } as CSSProperties;

  return (
    <>
      {/* Compact banner — never takes more than ~36px so the sim columns
          stay fully visible. Click to open the full breakdown modal. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open simulation verdict"
        className={styles.banner}
        style={winColorVar}
      >
        <span className={styles.bannerKicker}>Verdict</span>
        <span className={styles.bannerWinner}>{winnerLabel}</span>
        <span className={styles.bannerHeadline}>{v.headline}</span>
        <span className={styles.bannerCta}>VIEW FULL VERDICT →</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Simulation verdict"
          onClick={() => setOpen(false)}
          className={styles.modalBackdrop}
        >
          <div
            onClick={e => e.stopPropagation()}
            className={styles.modalDialog}
            style={winColorVar}
          >
            <div className={styles.modalCloseAnchor}>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close verdict"
                className={styles.modalCloseBtn}
              >
                ×
              </button>
              <VerdictDetails v={v} onExport={handleExport} copied={copied} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
