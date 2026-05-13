/**
 * Full-verdict modal triggered from the global VerdictBanner. Renders
 * either the pair-mode VerdictDetails (A vs B scoreboard) or a cohort
 * ranking table depending on `verdict.mode`. Focus is trapped while
 * open; backdrop click + Escape (handled by the caller) dismiss.
 */
import type { CSSProperties } from 'react';
import { VerdictDetails } from '../sim/VerdictCard';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getActorColorVar } from '../../hooks/useGameState';
import styles from './VerdictModal.module.scss';

interface VerdictModalProps {
  verdict: Record<string, unknown>;
  onClose: () => void;
}

interface CohortRankingEntry {
  actorName: string;
  actorIndex: number;
  rank: number;
  rationale: string;
  scores?: {
    survival?: number;
    prosperity?: number;
    morale?: number;
    innovation?: number;
  };
}

/**
 * Runtime type guard for one cohort ranking entry. The server side
 * sends a Zod-validated payload but saved sessions (loaded back into
 * the UI months later) can carry arbitrary JSON that no longer matches
 * the current schema. Filtering through this guard keeps the modal
 * from crashing on a stale shape and silently drops malformed rows
 * instead of rendering `#undefined` badges or NaN scores.
 */
function isValidRankingEntry(raw: unknown): raw is CohortRankingEntry {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.actorName !== 'string' || r.actorName.length === 0) return false;
  if (typeof r.actorIndex !== 'number' || !Number.isFinite(r.actorIndex)) return false;
  if (typeof r.rank !== 'number' || !Number.isFinite(r.rank)) return false;
  if (typeof r.rationale !== 'string') return false;
  if (r.scores != null && typeof r.scores !== 'object') return false;
  return true;
}

function CohortVerdictDetails({ v }: { v: Record<string, unknown> }) {
  const headline = String(v.headline || '');
  const summary = String(v.summary || '');
  const keyDivergence = String(v.keyDivergence || '');
  const rankings: CohortRankingEntry[] = Array.isArray(v.rankings)
    ? (v.rankings as unknown[]).filter(isValidRankingEntry)
    : [];
  const reasoning = String(v.reasoning || '');
  // Schema requires `rankings` to carry ≥ 2 entries, but a malformed
  // verdict payload could still arrive empty; the floor of 1 keeps the
  // kicker from rendering "Cohort of 0" which would never match the
  // banner's actor count and looks like a bug to the user.
  const actorCount = Math.max(
    1,
    Array.isArray(v.actors) ? (v.actors as unknown[]).length : rankings.length,
  );

  return (
    <div className={styles.cohortDetails}>
      <header className={styles.cohortHeader}>
        <div className={styles.cohortKicker}>★ Cohort of {actorCount} · Verdict</div>
        <h2 className={styles.cohortHeadline}>{headline}</h2>
        {summary && <p className={styles.cohortSummary}>{summary}</p>}
        {keyDivergence && (
          <p className={styles.cohortDivergence}>
            <strong>Key divergence:</strong> {keyDivergence}
          </p>
        )}
      </header>

      <ol className={styles.cohortRankings}>
        {rankings
          .slice()
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
          .map((r) => {
            const color = getActorColorVar(r.actorIndex);
            return (
              <li
                key={`${r.rank ?? 'unranked'}-${r.actorName}-${r.actorIndex}`}
                className={styles.cohortRankingEntry}
                style={{ '--actor-color': color } as CSSProperties}
              >
                <div className={styles.cohortRankBadge}>#{r.rank ?? '?'}</div>
                <div className={styles.cohortRankBody}>
                  <div className={styles.cohortRankName}>{r.actorName}</div>
                  <div className={styles.cohortRankScores}>
                    <span title="Survival">S {r.scores?.survival ?? '?'}</span>
                    <span title="Prosperity">P {r.scores?.prosperity ?? '?'}</span>
                    <span title="Morale">M {r.scores?.morale ?? '?'}</span>
                    <span title="Innovation">I {r.scores?.innovation ?? '?'}</span>
                  </div>
                  {r.rationale && <p className={styles.cohortRankRationale}>{r.rationale}</p>}
                </div>
              </li>
            );
          })}
      </ol>

      {reasoning && (
        <details className={styles.cohortReasoning}>
          <summary>Full reasoning</summary>
          <pre>{reasoning}</pre>
        </details>
      )}
    </div>
  );
}

export function VerdictModal({ verdict, onClose }: VerdictModalProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const mode = verdict.mode === 'cohort' ? 'cohort' : 'pair';
  const winner = verdict.winner;
  const dialogClassName = [
    styles.dialog,
    mode === 'pair' && winner === 'A' ? styles.winnerA : undefined,
    mode === 'pair' && winner === 'B' ? styles.winnerB : undefined,
    mode === 'pair' && winner === 'tie' ? styles.winnerTie : undefined,
    mode === 'cohort' ? styles.cohortDialog : undefined,
  ].filter(Boolean).join(' ');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Simulation verdict full breakdown"
      onClick={onClose}
      className={styles.backdrop}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={dialogClassName}
      >
        <button
          onClick={onClose}
          aria-label="Close verdict"
          className={styles.closeButton}
        >
          ×
        </button>
        {mode === 'cohort'
          ? <CohortVerdictDetails v={verdict} />
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : <VerdictDetails v={verdict as any} />}
      </div>
    </div>
  );
}
