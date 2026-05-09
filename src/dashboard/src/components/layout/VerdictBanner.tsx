/**
 * Global verdict banner. Visible on every tab as soon as the verdict
 * LLM returns; closable per-verdict (a new run's headline re-shows the
 * banner even after dismissal). Click the middle strip or the "View
 * Full Verdict" button to open the full breakdown modal; the "Reports"
 * chip jumps to the Reports tab.
 */
import type { CSSProperties } from 'react';
import type { DashboardTab } from '../../tab-routing';
import styles from './VerdictBanner.module.scss';

interface VerdictBannerProps {
  verdict: Record<string, unknown> | null;
  currentTurn: number;
  maxTurns: number;
  dismissedKey: string | null;
  onOpenModal: () => void;
  onDismiss: (key: string) => void;
  onNavigateTab: (tab: Exclude<DashboardTab, 'about'>) => void;
}

function resolveWinColor(winner: 'A' | 'B' | 'tie'): string {
  if (winner === 'A') return 'var(--vis)';
  if (winner === 'B') return 'var(--eng)';
  return 'var(--amber)';
}

// Derived translucent/faint/glow stops from the winner color. Kept as
// CSS custom properties so the SCSS module reads them off the root
// element via fallback chains instead of templating into class names.
function winColorCssVars(winner: 'A' | 'B' | 'tie'): CSSProperties {
  const winColor = resolveWinColor(winner);
  return {
    '--win-color': winColor,
    '--win-color-translucent': `${winColor}22`,
    '--win-color-faint': `${winColor}33`,
    '--win-color-border': `${winColor}55`,
    '--win-color-glow': `${winColor}66`,
  } as CSSProperties;
}

export function VerdictBanner({
  verdict,
  currentTurn,
  maxTurns,
  dismissedKey,
  onOpenModal,
  onDismiss,
  onNavigateTab,
}: VerdictBannerProps) {
  if (!verdict || !verdict.winner) return null;
  const headline = String(verdict.headline || '');
  const winnerKey = `${verdict.winner}|${headline}`;
  if (dismissedKey === winnerKey) return null;
  const winner = verdict.winner as 'A' | 'B' | 'tie';
  const winnerLabel = winner === 'tie'
    ? 'Tie'
    : `${String(verdict.winnerName || 'Winner')} wins`;
  const turnLabel = `Turn ${currentTurn}/${maxTurns} · verdict by gpt-4o`;
  return (
    <div
      // role=status + aria-live polite so screen readers announce the
      // verdict the moment the banner mounts. The banner appears
      // mid-stream when the run completes and disappears on dismiss;
      // role=region (the prior value) is for navigation landmarks, not
      // for live announcements.
      role="status"
      aria-live="polite"
      aria-label="Simulation verdict"
      className={styles.banner}
      style={winColorCssVars(winner)}
    >
      <div className={styles.winnerLabel}>
        <div className={styles.kicker}>★ Run Complete</div>
        <div className={styles.winnerName}>{winnerLabel}</div>
      </div>
      <div className={styles.headlineColumn}>
        <button
          onClick={onOpenModal}
          className={styles.headlineButton}
          title="Click to open the full verdict breakdown"
        >
          {headline || 'Verdict delivered — click to see full breakdown.'}
        </button>
        <div className={styles.turnLabel}>{turnLabel}</div>
      </div>
      <button onClick={onOpenModal} className={styles.viewButton}>
        View Full Verdict →
      </button>
      <button
        onClick={() => onNavigateTab('reports')}
        className={styles.reportsChip}
        title="Open the Reports tab for the full run breakdown"
      >
        Reports
      </button>
      <button
        onClick={() => onDismiss(winnerKey)}
        aria-label="Dismiss verdict banner"
        className={styles.dismissButton}
      >
        ×
      </button>
    </div>
  );
}
