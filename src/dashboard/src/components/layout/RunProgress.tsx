import type { CSSProperties } from 'react';
import type { GameState } from '../../hooks/useGameState';
import type { ValidationFallbackBucket } from '../../hooks/useSSE';
import { Tooltip } from '../shared/Tooltip';
import styles from './RunProgress.module.scss';

/** The current turn, in-sim time, seed and validation notes for an open run. */
export function RunProgress({ gameState, validationFallbacks }: {
  gameState: GameState;
  validationFallbacks: readonly ValidationFallbackBucket[];
}) {
  // The turn's live region stays in the page from turn 0, empty until the
  // first turn: a screen reader reads a region's changes, not the words of
  // one that arrives with them.
  const turnRegion = (
    <span key="turn-region" className="sr-only" aria-live="polite">
      {gameState.turn > 0 ? `Turn ${gameState.turn} of ${gameState.maxTurns}` : ''}
    </span>
  );
  if (gameState.turn <= 0) return <>{turnRegion}</>;
  const progressPct = gameState.maxTurns > 0
    ? `${Math.round((gameState.turn / gameState.maxTurns) * 100)}%`
    : '0%';

  return (
    <>
    {/* Reads each new turn aloud, and only the turn: the time and seed stay quiet. */}
    {turnRegion}
    <div className={styles.meta}>
      {/* The compact figures open tooltips with their full meaning. */}
      <Tooltip
        content={
          <div>
            <div className={styles.tooltipTitle}>
              Turn {gameState.turn} / {gameState.maxTurns}
            </div>
            <div>
              One decision cycle per turn. Departments analyze the
              situation, the commander picks a policy, the kernel
              advances in-sim time, colonists age. At turn
              {' '}{gameState.maxTurns}{' '}the run finishes
              {gameState.actorIds.length === 2
                ? ' and the verdict judge compares the two commanders.'
                : '. Cohort runs (3+ commanders) surface group-median deltas.'}
            </div>
          </div>
        }
      >
        <span className={styles.tokenInline}>
          <span className={styles.tokenLabel}>T</span>
          <strong className={styles.tokenValue}>{gameState.turn}</strong>
          <span className={styles.tokenLabel}>/{gameState.maxTurns}</span>
        </span>
      </Tooltip>
      <Tooltip
        content={
          <div>
            <div className={styles.tooltipTitle}>
              In-sim time {gameState.time}
            </div>
            <div>
              The time the colony thinks it's living in. Advances by
              the scenario's <code>timePerTurn</code> (usually 5-10)
              each decision cycle. Drives aging, childbirth,
              retirement, and long-arc narrative. Real wall-clock
              time is independent of in-sim time.
            </div>
          </div>
        }
      >
        <span className={styles.tokenInline}>
          <span className={styles.tokenLabel}>Y</span>
          <strong className={styles.tokenValue}>{gameState.time}</strong>
        </span>
      </Tooltip>
      <Tooltip
        content={
          <div>
            <div className={styles.tooltipTitle}>
              Random seed {gameState.seed}
            </div>
            <div>
              All kernel-side randomness (colonist generation, mood
              drift, crisis selection) derives from this seed. Same
              seed + same leaders + same scenario produces identical
              rosters and identical kernel outcomes. Leader A
              and Leader B start from the same colony and diverge
              only by their personalities, not by luck.
            </div>
          </div>
        }
      >
        <span className={styles.tokenInline}>
          <span className={styles.tokenLabel}>S</span>
          <strong className={styles.tokenValue}>{gameState.seed}</strong>
        </span>
      </Tooltip>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={gameState.turn}
        aria-valuemin={0}
        aria-valuemax={gameState.maxTurns}
        aria-label={`Simulation progress, turn ${gameState.turn} of ${gameState.maxTurns}`}
      >
        <div
          className={styles.progressFill}
          style={{ '--progress-pct': progressPct } as CSSProperties}
        />
      </div>
      {validationFallbacks.length > 0 && (() => {
        // A fallback replaced a reply with the empty skeleton; a
        // salvage kept the model's own reply without the effect keys
        // the run does not hold. The pill counts both and names each.
        const fallbacks = validationFallbacks.filter(b => !b.salvaged);
        const salvages = validationFallbacks.filter(b => b.salvaged);
        const fellBack = fallbacks.reduce((sum, b) => sum + b.count, 0);
        const kept = salvages.reduce((sum, b) => sum + b.count, 0);
        const total = fellBack + kept;
        const fellBackLabel = `${fellBack} validation fallback${fellBack === 1 ? '' : 's'}`;
        const keptLabel = `${kept} ${kept === 1 ? 'reply' : 'replies'} kept without the keys the run does not hold`;
        const label = [fellBack > 0 ? fellBackLabel : '', kept > 0 ? keptLabel : ''].filter(Boolean).join(', ');
        const rows = (buckets: typeof fallbacks) => (
          <div className={styles.fallbackBlock}>
            {buckets.map(b => (
              <div key={b.schemaName} className={styles.fallbackRow}>
                <span>{b.schemaName}</span>
                <span className={styles.fallbackRowMeta}>
                  {b.count}× {b.lastSite ? `(last: ${b.lastSite})` : ''}
                </span>
              </div>
            ))}
          </div>
        );
        return (
          <Tooltip
            content={
              <div>
                {fellBack > 0 && (
                  <div className={kept > 0 ? styles.tooltipSection : undefined}>
                    <div className={styles.tooltipTitle}>⚠ {fellBackLabel}</div>
                    <div className={styles.tooltipSection}>
                      An LLM call returned a JSON payload that failed zod
                      schema validation. After retries were exhausted the
                      orchestrator continued with an empty skeleton so the
                      sim wouldn't abort mid-turn. Numbers here let you
                      spot which schema is misbehaving.
                    </div>
                    {rows(fallbacks)}
                  </div>
                )}
                {kept > 0 && (
                  <div>
                    <div className={styles.tooltipTitle}>⚠ {keptLabel}</div>
                    <div className={styles.tooltipSection}>
                      A reply failed schema validation only on effect keys
                      the run does not hold. After retries the run kept the
                      model's own reply with those keys dropped; nothing
                      was replaced with a skeleton.
                    </div>
                    {rows(salvages)}
                  </div>
                )}
              </div>
            }
          >
            <span
              aria-label={label}
              className={styles.fallbackPill}
            >
              <span aria-hidden="true">⚠</span>
              {total}
            </span>
          </Tooltip>
        );
      })()}
    </div>
    </>
  );
}
