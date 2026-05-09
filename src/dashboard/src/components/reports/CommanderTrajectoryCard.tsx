import type { CSSProperties } from 'react';
import type { SimEvent } from '../../hooks/useSSE';
import styles from './CommanderTrajectoryCard.module.scss';

/**
 * Compact line chart of a commander's HEXACO trajectory across the run.
 *
 * Reads per-turn commander snapshots from `personality_drift` SSE events (emitted by
 * the orchestrator after every turn's outcome). Renders each of the six
 * HEXACO axes as a thin SVG polyline in a small inline card. Six lines
 * overlap in a 0..1 y-axis bounded to [0.05, 0.95] (matching the kernel's
 * drift bounds) and a turn-based x-axis.
 *
 * No external chart library — a single SVG keeps the dashboard dependency
 * surface flat and the card renders instantly even for long runs.
 *
 * @module paracosm/dashboard/reports/CommanderTrajectoryCard
 */

const TRAIT_KEYS: Array<keyof CommanderSnapshot> = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'emotionality',
  'honestyHumility',
];

const TRAIT_COLORS: Record<string, string> = {
  openness: 'var(--side-a, #e8b44a)',
  conscientiousness: 'var(--teal, #4ca8a8)',
  extraversion: '#c44a1e',
  agreeableness: '#6b9a6b',
  emotionality: '#a86cb5',
  honestyHumility: '#d2b48c',
};

const TRAIT_LABELS: Record<string, string> = {
  openness: 'O',
  conscientiousness: 'C',
  extraversion: 'E',
  agreeableness: 'A',
  emotionality: 'Em',
  honestyHumility: 'HH',
};

interface CommanderSnapshot {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  emotionality: number;
  honestyHumility: number;
}

/**
 * Minimal event shape this card needs. Compatible with both the live
 * `SimEvent` stream (carries `leader`) and the per-leader `ProcessedEvent[]`
 * that `useGameState` exposes (where every event on
 * `state.actors[actorIds[i]].events` is already attributed to that
 * leader and the `leader` field is optional).
 */
interface TrajectoryEvent {
  type: string;
  leader?: string;
  data?: Record<string, unknown>;
}

/**
 * Either a strict HEXACO snapshot or the looser `Record<string, number>`
 * shape used on ActorConfig. Widening the prop type so
 * `state.actors[id].leader?.hexaco` (typed as a loose record) flows in
 * without a cast.
 */
type BaselineHexacoInput = CommanderSnapshot | Record<string, number>;

function coerceSnapshot(input: BaselineHexacoInput | undefined): CommanderSnapshot | undefined {
  if (!input) return undefined;
  const required: Array<keyof CommanderSnapshot> = [
    'openness',
    'conscientiousness',
    'extraversion',
    'agreeableness',
    'emotionality',
    'honestyHumility',
  ];
  for (const k of required) {
    if (typeof (input as Record<string, number>)[k] !== 'number') return undefined;
  }
  return input as CommanderSnapshot;
}

/** Extract per-turn commander snapshots for a single leader from the event stream. */
function extractCommanderTrajectory(
  events: TrajectoryEvent[],
  actorName: string,
): Array<{ turn: number; hexaco: CommanderSnapshot }> {
  const out: Array<{ turn: number; hexaco: CommanderSnapshot }> = [];
  for (const e of events) {
    if (e.type !== 'personality_drift' || !e.data) continue;
    // Accept events without a leader field (ProcessedEvent on a
    // per-actor bucket in state.actors is already attributed to that
    // actor); filter only when present.
    if (e.leader !== undefined && e.leader !== actorName) continue;
    const commander = (e.data as Record<string, unknown>).commander as CommanderSnapshot | undefined;
    const turn = (e.data as Record<string, unknown>).turn as number | undefined;
    if (!commander || typeof turn !== 'number') continue;
    out.push({ turn, hexaco: commander });
  }
  return out.sort((a, b) => a.turn - b.turn);
}

export function CommanderTrajectoryCard({
  events,
  actorName,
  baselineHexaco,
}: {
  events: TrajectoryEvent[] | SimEvent[];
  actorName: string;
  /** Turn-0 baseline. Prepended so the chart shows the drift FROM config,
   *  not just the drift BETWEEN turn 1 and turn N. */
  baselineHexaco?: BaselineHexacoInput;
}) {
  const baseline = coerceSnapshot(baselineHexaco);
  const trajectory = extractCommanderTrajectory(events, actorName);
  if (trajectory.length === 0 && !baseline) return null;

  const series: Array<{ turn: number; hexaco: CommanderSnapshot }> = baseline
    ? [{ turn: 0, hexaco: baseline }, ...trajectory]
    : trajectory;
  if (series.length < 2) return null;

  const W = 260;
  const H = 80;
  const padX = 6;
  const padY = 6;
  const minTurn = series[0].turn;
  const maxTurn = series[series.length - 1].turn;
  const xRange = Math.max(1, maxTurn - minTurn);

  // Kernel bounds are [0.05, 0.95]. Project onto [padY, H - padY] with
  // y=0 at top so higher trait value renders higher on the chart.
  const yFor = (v: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, v));
    return padY + (H - padY * 2) * (1 - (clamped - 0.05) / 0.9);
  };
  const xFor = (turn: number) => padX + (W - padX * 2) * ((turn - minTurn) / xRange);

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.title}>PERSONALITY ARC</span>
        <span className={styles.range}>turn {minTurn} → {maxTurn}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`HEXACO trajectory for ${actorName}`}
      >
        <line x1={padX} y1={yFor(0.5)} x2={W - padX} y2={yFor(0.5)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,3" />
        {TRAIT_KEYS.map(trait => {
          const points = series.map(s => `${xFor(s.turn)},${yFor(s.hexaco[trait])}`).join(' ');
          return (
            <polyline
              key={trait}
              points={points}
              fill="none"
              stroke={TRAIT_COLORS[trait]}
              strokeWidth="1.25"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.85}
            />
          );
        })}
      </svg>
      <div className={styles.legend}>
        {TRAIT_KEYS.map(trait => (
          <span key={trait} className={styles.legendItem}>
            <span
              aria-hidden="true"
              className={styles.legendSwatch}
              style={{ '--trait-color': TRAIT_COLORS[trait] } as CSSProperties}
            />
            <span className={styles.legendLabel}>{TRAIT_LABELS[trait]}</span>
            <span className={styles.legendValue}>{series[series.length - 1].hexaco[trait].toFixed(2)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
