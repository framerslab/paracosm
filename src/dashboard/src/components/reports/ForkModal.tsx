/**
 * ForkModal (Tier 2 Spec 2B). Opens when the user clicks the
 * `↳ Fork at {Time} N` button in a Reports-tab turn row. Lets the
 * user override the leader, optionally override the seed, and
 * optionally inject custom events, then fires the fork-POST to
 * `/setup` via the `onConfirm` callback.
 *
 * Thin wrapper over {@link ForkModal.helpers} for all non-presentation
 * logic (preset resolution, cost estimate, event parsing).
 *
 * @module reports/ForkModal
 */
import { useState, useEffect } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useScenarioContext } from '../../App';
import { useScenarioLabels } from '../../hooks/useScenarioLabels';
import {
  resolveLeaderPresets,
  estimateForkCost,
  parseCustomEvents,
} from './ForkModal.helpers';
import type { ActorConfig } from '../../../../engine/types.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';
import styles from './ForkModal.module.scss';

/** Payload produced on confirm, consumed by the caller (ReportView). */
export interface ForkConfirmPayload {
  parentArtifact: RunArtifact;
  atTurn: number;
  leader: ActorConfig;
  seedOverride?: number;
  customEvents?: Array<{ turn: number; title: string; description: string }>;
}

export interface ForkModalProps {
  /** Parent run to fork from; dashboard passes in the full artifact
   *  so the server can resume from the embedded kernel snapshot. */
  parentArtifact: RunArtifact;
  /** Turn index selected by the user (from the ReportView button). */
  atTurn: number;
  /** Total turns the fork should run to (typically parent's maxTurns). */
  maxTurns: number;
  /** Current session cost preset (from Settings). */
  costPreset: 'quality' | 'economy';
  /** Current session provider (from Settings). */
  provider: 'openai' | 'anthropic';
  /** Session-custom leaders (optional; from SettingsPanel state). */
  sessionCustomLeaders?: ActorConfig[];
  /** Called with the validated payload when the user confirms. */
  onConfirm: (payload: ForkConfirmPayload) => void;
  /** Called when the user dismisses without confirming. */
  onClose: () => void;
}

export function ForkModal(props: ForkModalProps) {
  const {
    parentArtifact, atTurn, maxTurns, costPreset, provider,
    sessionCustomLeaders = [], onConfirm, onClose,
  } = props;

  const scenario = useScenarioContext();
  const labels = useScenarioLabels();
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const presets = resolveLeaderPresets(scenario as never, sessionCustomLeaders);
  const [actorIndex, setLeaderIndex] = useState(0);
  const [seedText, setSeedText] = useState('');
  const [customEventsText, setCustomEventsText] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const costEstimate = estimateForkCost(atTurn, maxTurns, costPreset, provider);
  const turnsRemaining = Math.max(0, maxTurns - atTurn);
  const parentSeed = parentArtifact.metadata.seed;

  const handleConfirm = () => {
    const leader = presets[actorIndex];
    if (!leader) return;
    const parsedSeed = seedText.trim() ? parseInt(seedText, 10) : undefined;
    const seedOverride = parsedSeed !== undefined && Number.isFinite(parsedSeed)
      ? parsedSeed
      : undefined;
    const customEvents = customEventsText.trim()
      ? parseCustomEvents(customEventsText)
      : undefined;
    onConfirm({ parentArtifact, atTurn, leader, seedOverride, customEvents });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-modal-title"
      className={styles.backdrop}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.dialog}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h3 id="fork-modal-title">
            Fork at {labels.Time} {atTurn}
          </h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close fork modal"
          >
            ×
          </button>
        </header>

        <div className={styles.field}>
          <label htmlFor="fork-leader-select">Override leader</label>
          {presets.length === 0 ? (
            <p className={styles.warning}>
              No preset leaders available for this scenario. Add leaders in
              Settings or pick a scenario with presets to continue.
            </p>
          ) : (
            <select
              id="fork-leader-select"
              value={actorIndex}
              onChange={e => setLeaderIndex(parseInt(e.target.value, 10))}
            >
              {presets.map((p, i) => (
                <option key={`${p.name}-${i}`} value={i}>
                  {p.name} ({p.archetype})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="fork-seed">Seed override (optional)</label>
          <input
            id="fork-seed"
            type="number"
            placeholder={
              parentSeed !== undefined
                ? `Parent seed: ${parentSeed}`
                : '(use parent seed)'
            }
            value={seedText}
            onChange={e => setSeedText(e.target.value)}
          />
          <span className={styles.hint}>
            Leave blank to resume from the parent's RNG state.
          </span>
        </div>

        <details className={styles.advanced}>
          <summary>Advanced: custom events</summary>
          <textarea
            rows={4}
            placeholder={
              'One event per line, format: "turn: title: description"\n' +
              'Example: 5: Supply drop: Relief arrives with 3 months of food.'
            }
            value={customEventsText}
            onChange={e => setCustomEventsText(e.target.value)}
          />
        </details>

        <div className={styles.costEstimate} role="status">
          <span>Estimated cost</span>
          <strong>{costEstimate}</strong>
          <span className={styles.costDetail}>
            for {turnsRemaining} more {turnsRemaining === 1 ? labels.time : labels.times}
          </span>
        </div>

        <footer className={styles.footer}>
          <button type="button" onClick={onClose} className={styles.cancelButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={presets.length === 0}
            className={styles.confirmButton}
          >
            Fork
          </button>
        </footer>
      </div>
    </div>
  );
}
