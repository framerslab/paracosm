import { useEffect, useMemo, type CSSProperties } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import type { ForgeAttempt, ReuseCall } from './useGridState.js';
import styles from './ForgeLineageModal.module.scss';

export interface ForgeLineagePayload {
  toolName: string;
  side: 'a' | 'b';
  sideColor: string;
}

interface Props {
  payload: ForgeLineagePayload | null;
  forgeAttemptsA: ForgeAttempt[];
  forgeAttemptsB: ForgeAttempt[];
  reuseCallsA: ReuseCall[];
  reuseCallsB: ReuseCall[];
  onClose: () => void;
  onJumpToTurn?: (turn: number) => void;
}

/**
 * Inline modal showing a forged tool's lineage — every forge attempt
 * (approved + rejected, with confidence), every cross-dept reuse, and
 * its first-forge attribution. Click-to-jump on turns lets users rewind
 * to any moment in the tool's history.
 */
export function ForgeLineageModal({
  payload,
  forgeAttemptsA,
  forgeAttemptsB,
  reuseCallsA,
  reuseCallsB,
  onClose,
  onJumpToTurn,
}: Props) {
  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [payload, onClose]);

  const data = useMemo(() => {
    if (!payload) return null;
    const attempts =
      payload.side === 'a' ? forgeAttemptsA : forgeAttemptsB;
    const reuses = payload.side === 'a' ? reuseCallsA : reuseCallsB;
    const mine = attempts.filter(a => a.name === payload.toolName);
    mine.sort((a, b) => a.turn - b.turn || a.eventIndex - b.eventIndex);
    const mineReuses = reuses.filter(r => r.name === payload.toolName);
    mineReuses.sort((a, b) => a.turn - b.turn);
    const firstApproved = mine.find(a => a.approved);
    return { mine, mineReuses, firstApproved };
  }, [payload, forgeAttemptsA, forgeAttemptsB, reuseCallsA, reuseCallsB]);

  const dialogRef = useFocusTrap<HTMLDivElement>(!!payload);
  if (!payload || !data) return null;

  const sideStyle = { '--side-color': payload.sideColor } as CSSProperties;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Forge lineage for ${payload.toolName}`}
      onClick={onClose}
      className={styles.backdrop}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={styles.dialog}
        style={sideStyle}
      >
        <div className={styles.headerRow}>
          <div>
            <div className={styles.kicker}>
              Forge Lineage · {payload.side.toUpperCase()}
            </div>
            <div className={styles.title}>{payload.toolName}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close lineage"
            className={styles.closeBtn}
          >
            ×
          </button>
        </div>

        {data.firstApproved && (
          <div className={styles.firstForged}>
            First forged in{' '}
            <span className={styles.firstDept}>
              {data.firstApproved.department.toUpperCase()}
            </span>{' '}
            on T{data.firstApproved.turn}
            {typeof data.firstApproved.confidence === 'number'
              ? ` · confidence ${data.firstApproved.confidence.toFixed(2)}`
              : ''}
          </div>
        )}

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            Attempts ({data.mine.length})
          </div>
          {data.mine.length === 0 ? (
            <div className={styles.empty}>no forge records</div>
          ) : (
            <ul className={styles.list}>
              {data.mine.map((att, i) => {
                const statusColor = att.approved ? 'var(--green)' : 'var(--rust)';
                const statusStyle = { '--status-color': statusColor } as CSSProperties;
                return (
                  <li
                    key={`${att.turn}-${att.eventIndex}-${i}`}
                    className={styles.attemptItem}
                    style={statusStyle}
                  >
                    <span className={styles.statusLabel}>
                      {att.approved ? '✓ Forged' : '✗ Rejected'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onJumpToTurn?.(Math.max(0, att.turn - 1))}
                      className={[styles.jumpBtn, onJumpToTurn ? styles.clickable : ''].filter(Boolean).join(' ')}
                      title={onJumpToTurn ? `Jump to T${att.turn}` : undefined}
                    >
                      T{att.turn}
                    </button>
                    <span className={styles.deptLabel}>{att.department}</span>
                    {typeof att.confidence === 'number' && (
                      <span className={styles.confLabel}>
                        conf {att.confidence.toFixed(2)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className={styles.sectionLabel}>
            Cross-dept reuses ({data.mineReuses.length})
          </div>
          {data.mineReuses.length === 0 ? (
            <div className={styles.empty}>never reused across departments</div>
          ) : (
            <ul className={styles.list}>
              {data.mineReuses.map((r, i) => (
                <li
                  key={`${r.turn}-${r.callingDept}-${i}`}
                  className={styles.reuseItem}
                >
                  <button
                    type="button"
                    onClick={() => onJumpToTurn?.(Math.max(0, r.turn - 1))}
                    className={[styles.jumpBtn, onJumpToTurn ? styles.clickable : ''].filter(Boolean).join(' ')}
                  >
                    T{r.turn}
                  </button>
                  <span className={styles.deptLabel}>
                    {r.originDept} → {r.callingDept}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
