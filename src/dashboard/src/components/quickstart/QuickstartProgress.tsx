/**
 * Four-stage progress panel for the Quickstart run.
 *
 * Each stage is rendered as an expandable card (QuickstartStageCard)
 * with its own scrollable log body. The compile / research / actors
 * stages emit synthesized lines anchored to phase transitions; the
 * running stage streams real SSE events from the orchestrator with
 * type-color coding so the viewer can watch the simulation tick.
 *
 * Stages:
 * 1. Compile scenario (LLM call for the draft)
 * 2. Ground with research citations (folded into compile server-side)
 * 3. Generate N actors (LLM call)
 * 4. Run N simulations in parallel (SSE-driven; per-actor turn counters)
 *
 * @module paracosm/dashboard/quickstart/QuickstartProgress
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimEvent } from '../../hooks/useSSE';
import { useDashboardNavigation } from '../../App';
import { QuickstartStageCard } from './QuickstartStageCard';
import {
  buildLogForStage,
  formatStageDuration,
  type BuildLogContext,
} from './QuickstartStageLog.helpers';
import styles from './QuickstartProgress.module.scss';

export type Stage = 'compile' | 'research' | 'actors' | 'running' | 'done';
export type StageStatus = 'pending' | 'active' | 'done';

export interface ActorProgress {
  name: string;
  archetype: string;
  currentTurn: number;
  maxTurns: number;
  status: 'running' | 'complete' | 'error' | 'aborted';
}

export interface QuickstartProgressProps {
  stage: Stage;
  actors?: ActorProgress[];
  events?: SimEvent[];
  /** Number of actors the run was configured for. Used to label the
   *  Generate stage and the synthesized log lines (e.g. "Generate 4
   *  actors"). Defaults to 3 to match the legacy copy. */
  actorCount?: number;
  /** Result of the ground-scenario pass. Surfaced as citation log
   *  lines on the Research stage card. Null/undefined falls back to
   *  the legacy placeholder copy. */
  groundingSummary?: import('./QuickstartStageLog.helpers').GroundingSummaryForLog | null;
  onCancel?: () => void;
}

const STAGE_ORDER: Stage[] = ['compile', 'research', 'actors', 'running', 'done'];

function statusFor(current: Stage, stage: Stage): StageStatus {
  const currentIdx = STAGE_ORDER.indexOf(current);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  if (currentIdx > stageIdx) return 'done';
  if (currentIdx === stageIdx) return 'active';
  return 'pending';
}

export function QuickstartProgress({
  stage,
  actors,
  events,
  actorCount,
  groundingSummary,
  onCancel,
}: QuickstartProgressProps): JSX.Element {
  // First render captures wall-clock t=0 for the whole run; phase
  // transitions are stamped each time `stage` flips. The transitions
  // record powers both the per-stage duration badges and the timestamp
  // column on synthesized log lines.
  const startMsRef = useRef<number>(Date.now());
  const [phaseTransitionMs, setPhaseTransitionMs] = useState<Partial<Record<Stage, number>>>(
    () => ({ compile: Date.now() }),
  );
  const lastStageRef = useRef<Stage>(stage);

  useEffect(() => {
    if (lastStageRef.current === stage) return;
    lastStageRef.current = stage;
    setPhaseTransitionMs((prev) => {
      if (prev[stage]) return prev;
      return { ...prev, [stage]: Date.now() };
    });
  }, [stage]);

  // Tick once per second so duration badges on the active card stay
  // live. We don't need to re-render for the SSE feed itself — the
  // running-stage log re-renders when `events.length` changes.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (stage === 'done') return;
    const id = setInterval(() => forceTick((t) => (t + 1) % 1_000_000), 1_000);
    return () => clearInterval(id);
  }, [stage]);

  const resolvedActorCount = actorCount ?? actors?.length ?? 3;
  const navigate = useDashboardNavigation();

  const ctx: BuildLogContext = useMemo(
    () => ({
      stage,
      startMs: startMsRef.current,
      phaseTransitionMs,
      actorCount: resolvedActorCount,
      events: events ?? [],
      groundingSummary: groundingSummary ?? null,
    }),
    [stage, phaseTransitionMs, resolvedActorCount, events, groundingSummary],
  );

  const stages: Array<{ id: Stage; label: string }> = [
    { id: 'compile', label: 'Compile scenario' },
    { id: 'research', label: 'Ground with citations' },
    { id: 'actors', label: `Generate ${resolvedActorCount} actor${resolvedActorCount === 1 ? '' : 's'}` },
    { id: 'running', label: `Run ${resolvedActorCount} simulation${resolvedActorCount === 1 ? '' : 's'}` },
  ];

  return (
    <section className={styles.progress} role="region" aria-label="Quickstart progress">
      <header className={styles.heading}>
        <span className={styles.title}>Quickstart run</span>
        <span className={styles.subtitle}>
          Live trace of every step from seed text to ready-to-explore artifacts.
        </span>
      </header>

      <ol className={styles.stageList}>
        {stages.map((s) => {
          const status = statusFor(stage, s.id);
          return (
            <li key={s.id} className={styles.stageItem}>
              <QuickstartStageCard
                stageId={s.id}
                label={s.label}
                status={status}
                logLines={buildLogForStage(s.id, ctx)}
                duration={formatStageDuration(s.id, ctx)}
                actors={s.id === 'running' ? actors : undefined}
              />
            </li>
          );
        })}
      </ol>

      {/* Once the running stage starts, the live SSE stream is already
          flowing into SIM. Surface a one-click jump so users who don't
          want to watch the staged progress panel can hop to the live
          side-by-side view immediately. Hidden until running starts so
          earlier stages stay focused on their own progress. */}
      {(stage === 'running' || stage === 'done') && (
        <button
          type="button"
          className={styles.jumpToSim}
          onClick={() => navigate('sim')}
        >
          Jump to live SIM →
        </button>
      )}
      {onCancel && stage !== 'done' && (
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel run
        </button>
      )}
    </section>
  );
}
