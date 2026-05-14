/**
 * Global verdict banner. Visible on every tab as soon as the verdict
 * LLM returns; closable per-verdict (a new run's headline re-shows the
 * banner even after dismissal). Click the middle strip or the "View
 * Full Verdict" button to open the full breakdown modal; the "Reports"
 * chip jumps to the Reports tab.
 *
 * Renders two shapes:
 * - Pair verdict (mode=`pair`): A-vs-B winner from the 2-actor pair
 *   runner. `winner` is `'A' | 'B' | 'tie'` and the banner color comes
 *   from the side palette.
 * - Cohort verdict (mode=`cohort`): top-ranked actor across an N-actor
 *   cohort run. `winner` is the actor name + `winnerIndex` is the slot,
 *   so the banner color comes from the 8-slot actor palette.
 */
import type { CSSProperties } from 'react';
import type { DashboardTab } from '../../tab-routing';
import { getActorColorVar } from '../../hooks/useGameState';
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

function resolvePairWinColor(winner: 'A' | 'B' | 'tie'): string {
  if (winner === 'A') return 'var(--vis)';
  if (winner === 'B') return 'var(--eng)';
  return 'var(--amber)';
}

// Derived translucent/faint/glow stops from the winner color. Kept as
// CSS custom properties so the SCSS module reads them off the root
// element via fallback chains instead of templating into class names.
function winColorCssVars(winColor: string): CSSProperties {
  return {
    '--win-color': winColor,
    '--win-color-translucent': `color-mix(in srgb, ${winColor} 14%, transparent)`,
    '--win-color-faint': `color-mix(in srgb, ${winColor} 22%, transparent)`,
    '--win-color-border': `color-mix(in srgb, ${winColor} 36%, transparent)`,
    '--win-color-glow': `color-mix(in srgb, ${winColor} 42%, transparent)`,
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
  if (!verdict) return null;
  // Skipped-verdict branch: server emitted `verdict_skipped` (LLM call
  // failed, cohort too large, or economics profile turned verdicts
  // off). Renders an explanatory chip so the user understands the
  // missing banner is intentional / explainable, not a stuck pipe.
  if (verdict.skipped) {
    const reason = String(verdict.reason || 'unknown');
    const reasonCopy = (() => {
      switch (reason) {
        case 'generation_failed': return 'Verdict LLM call failed — open Reports for the raw run stats.';
        case 'cohort_too_large': return `Cohort exceeded the verdict cap (${verdict.actorCount}/${verdict.max} actors). Open Reports for the cohort breakdown.`;
        case 'economics_skip': return 'Verdict generation off in your economics profile. Reports tab carries the run summary.';
        default: return 'Verdict unavailable. Open Reports for the run breakdown.';
      }
    })();
    const skippedKey = `skipped|${reason}`;
    if (dismissedKey === skippedKey) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Verdict unavailable"
        className={`${styles.banner} ${styles.bannerSkipped}`}
        style={winColorCssVars('var(--text-3)')}
      >
        <div className={styles.winnerLabel}>
          <div className={styles.kicker}>Run complete</div>
          <div className={`${styles.winnerName} ${styles.winnerNameSkipped}`}>No verdict</div>
        </div>
        <div className={styles.headlineColumn}>
          {/* Static informational text — uses the dedicated info
              variant so screen readers don't announce it as
              interactive and sighted users don't get a
              cursor: pointer hint on non-clickable text. */}
          <p className={styles.headlineStatic}>{reasonCopy}</p>
          <div className={styles.turnLabel}>Turn {currentTurn}/{maxTurns}</div>
        </div>
        <button
          onClick={() => onNavigateTab('reports')}
          className={styles.reportsChip}
          title="Open the Reports tab for the full run breakdown"
        >
          Reports
        </button>
        <button
          onClick={() => onDismiss(skippedKey)}
          aria-label="Dismiss banner"
          className={styles.dismissButton}
        >
          ×
        </button>
      </div>
    );
  }
  if (!verdict.winner) return null;
  const headline = String(verdict.headline || '');
  const winnerKey = `${verdict.winner}|${headline}`;
  if (dismissedKey === winnerKey) return null;

  // Mode discriminator: pair verdict uses A/B/tie; cohort verdict uses
  // an actor name + winnerIndex. Falls back to pair when unset for
  // back-compat with saved sessions captured before cohort verdicts
  // shipped.
  const mode = verdict.mode === 'cohort' ? 'cohort' : 'pair';

  let winColor: string;
  let winnerLabel: string;
  let kickerLabel: string;
  if (mode === 'cohort') {
    const idx = typeof verdict.winnerIndex === 'number' ? verdict.winnerIndex : 0;
    winColor = getActorColorVar(idx);
    const actorCount = Array.isArray(verdict.actors) ? (verdict.actors as unknown[]).length : 0;
    winnerLabel = `${String(verdict.winner)} leads`;
    kickerLabel = actorCount > 0 ? `★ Cohort of ${actorCount} complete` : '★ Cohort run complete';
  } else {
    const pairWinner = verdict.winner as 'A' | 'B' | 'tie';
    winColor = resolvePairWinColor(pairWinner);
    winnerLabel = pairWinner === 'tie'
      ? 'Tie'
      : `${String(verdict.winnerName || 'Winner')} wins`;
    kickerLabel = '★ Run Complete';
  }

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
      style={winColorCssVars(winColor)}
    >
      <div className={styles.winnerLabel}>
        <div className={styles.kicker}>{kickerLabel}</div>
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
