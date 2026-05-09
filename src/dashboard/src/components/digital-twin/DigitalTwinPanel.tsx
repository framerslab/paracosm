/**
 * DigitalTwinPanel — renders a finished `simulateIntervention` artifact
 * inline in the SIM tab. Activates when the loaded artifact has both
 * `subject` and `intervention` populated; otherwise SimView falls back
 * to the standard parallel-actor layout.
 *
 * Sections rendered:
 *  - Subject card (id, name, profile fields, signal trail)
 *  - Intervention card (name, description, duration, adherence)
 *  - Final-state metrics with delta against the first kernel snapshot
 *  - Trajectory mini-chart (per-metric line for up to three key metrics)
 *  - Cost / fingerprint summary row
 *
 * Designed to be self-contained: takes a single `artifact` prop and
 * renders read-only. The "dismiss" button calls `onDismiss` which the
 * parent (App.tsx) uses to clear the in-memory intervention artifact
 * and re-show the empty SIM state.
 *
 * @module paracosm/dashboard/digital-twin/DigitalTwinPanel
 */
import { useMemo, useState, useEffect, useRef, type CSSProperties } from 'react';
import type { RunArtifact } from '../../../../engine/schema/index.js';
import type { GameState } from '../../hooks/useGameState';
import styles from './DigitalTwinPanel.module.scss';

export interface DigitalTwinPanelProps {
  artifact: RunArtifact;
  /**
   * GameState built from the SSE events the server broadcast during
   * the run. When present, the panel exposes a "Playback" section
   * that lets the viewer scrub through every event the run emitted —
   * specialist analyses, forge attempts, the decision, the outcome —
   * matched to the live trail the SIM tab showed while the run was
   * in flight. Optional so a panel rendered against an artifact
   * loaded from disk (no live events) still works.
   */
  state?: GameState;
  onDismiss?: () => void;
}

const METRIC_LABELS: Record<string, string> = {
  // t2d-glp1-protocol metrics (the patient digital-twin scenario)
  hba1c: 'HbA1c',
  fastingGlucose: 'Fasting Glucose',
  weight: 'Weight (lb)',
  bmi: 'BMI',
  exerciseAdherence: 'Exercise Adherence',
  sleepHours: 'Sleep (hrs/night)',
  qualityOfLife: 'Quality of Life',
  mortalityRisk: '10-yr Mortality Risk',
  cardioFitness: 'Cardio Fitness',
  sideEffectBurden: 'Side-effect Load',
  patientMotivation: 'Motivation',
  familySupport: 'Family Support',
  // legacy / cross-scenario metrics (kept so non-medical scenarios
  // still get readable labels)
  population: 'Population',
  morale: 'Morale',
  alignmentBench: 'AlignmentBench',
  specGamingRate: 'Spec Gaming Rate',
  capabilityIndex: 'Capability Index',
  releaseReadiness: 'Release Readiness',
  redTeamCoverage: 'Red-team Coverage',
  runwayMonths: 'Runway',
  burnRate: 'Burn',
  marketShare: 'Market Share',
  revenueArr: 'Revenue ARR',
};

// Three signals that move under a 12-week GLP-1 + lifestyle protocol:
// HbA1c drops as glycemic control improves, weight drops as the drug
// + diet take effect, exercise adherence climbs as the lifestyle coach
// scaffolding holds. Together these tell the patient-twin story in one
// chart.
const CHART_METRICS = ['hba1c', 'weight', 'exerciseAdherence'];

const CHART_COLORS: Record<string, string> = {
  hba1c: '#ef6f5d',
  weight: '#ffd970',
  exerciseAdherence: '#34d399',
  // alternate medical metrics
  bmi: '#a78bfa',
  qualityOfLife: '#7cb6ff',
  mortalityRisk: '#ef6f5d',
  // legacy fallbacks for non-medical artifacts
  alignmentBench: '#7cb6ff',
  specGamingRate: '#ef6f5d',
  releaseReadiness: '#ffd970',
  morale: '#ffd970',
  runwayMonths: '#5fd49a',
  marketShare: '#7cb6ff',
};

// closed_turn_based_settlement engine archetype injects colony defaults
// (powerKw, foodMonthsReserve, waterLitersPerDay, pressurizedVolumeM3,
// lifeSupportCapacity, infrastructureModules, scienceOutput, morale)
// on top of every scenario's world.metrics. For a patient digital-twin
// run those defaults are noise — the panel would render HbA1c next to
// lifeSupportCapacity. We allow-list the medical metrics the
// t2d-glp1-protocol scenario declares so the grid only shows
// subject-relevant numbers. Falls back to "show every metric" when the
// artifact is from a non-medical scenario.
const DIGITAL_TWIN_METRICS = new Set([
  'hba1c',
  'fastingGlucose',
  'weight',
  'bmi',
  'exerciseAdherence',
  'sleepHours',
  'qualityOfLife',
  'mortalityRisk',
  'cardioFitness',
  'sideEffectBurden',
]);

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) < 1) return value.toFixed(3);
  return value.toFixed(2);
}

function formatDelta(initial: number, final: number): { text: string; direction: 'up' | 'down' | 'flat' } {
  const delta = final - initial;
  if (Math.abs(delta) < 1e-6) return { text: '·', direction: 'flat' };
  const sign = delta > 0 ? '+' : '';
  return {
    text: `${sign}${formatNumber(delta)}`,
    direction: delta > 0 ? 'up' : 'down',
  };
}

function formatProfileValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const EVENT_LABELS: Record<string, string> = {
  run_started: 'Run started',
  turn_started: 'Turn started',
  event_start: 'Crisis event',
  specialist_start: 'Specialist analyzing',
  specialist_done: 'Specialist done',
  forge_attempt: 'Forge attempt',
  forge_approved: 'Tool forged',
  forge_rejected: 'Forge rejected',
  decision_pending: 'Decision pending',
  decision_made: 'Decision made',
  outcome: 'Outcome',
  bulletin: 'Bulletin',
  turn_done: 'Turn complete',
  agent_reactions: 'Agent reactions',
  promotion: 'Promotion',
  systems_snapshot: 'Snapshot',
  complete: 'Complete',
};

function eventBody(event: { type: string; data: Record<string, unknown> }): string {
  const d = event.data ?? {};
  if (typeof d.title === 'string') return d.title;
  if (typeof d.summary === 'string') return d.summary;
  if (typeof d.name === 'string') return d.name;
  if (typeof d.description === 'string') return d.description;
  if (typeof d.outcome === 'string') return d.outcome;
  if (typeof d.toolName === 'string') return d.toolName;
  if (typeof d.department === 'string') return d.department;
  return '';
}

export function DigitalTwinPanel({ artifact, state, onDismiss }: DigitalTwinPanelProps) {
  const { subject, intervention, finalState, trajectory, cost, fingerprint, metadata } = artifact;

  const initialMetrics = useMemo(() => {
    const tj = trajectory as { sampleTimepoint?: { worldSnapshot?: { metrics?: Record<string, number> } }; timepoints?: Array<{ worldSnapshot?: { metrics?: Record<string, number> } }> } | undefined;
    if (tj?.timepoints && tj.timepoints.length > 0) {
      return tj.timepoints[0]?.worldSnapshot?.metrics ?? {};
    }
    return tj?.sampleTimepoint?.worldSnapshot?.metrics ?? {};
  }, [trajectory]);

  const finalMetrics = (finalState as { metrics?: Record<string, number> } | undefined)?.metrics ?? {};

  const profileEntries = subject?.profile
    ? Object.entries(subject.profile).slice(0, 6)
    : [];

  const chartData = useMemo(() => {
    const tj = trajectory as { timepoints?: Array<{ time?: number; label?: string; worldSnapshot?: { metrics?: Record<string, number> } }> } | undefined;
    const points = tj?.timepoints ?? [];
    if (points.length === 0) return null;
    const series = CHART_METRICS.map(metric => {
      const values = points.map(p => p.worldSnapshot?.metrics?.[metric] ?? null);
      const valid = values.filter((v): v is number => typeof v === 'number');
      if (valid.length < 1) return null;
      const min = Math.min(...valid);
      const max = Math.max(...valid);
      return { metric, values, min, max };
    }).filter((s): s is { metric: string; values: Array<number | null>; min: number; max: number } => s !== null);
    return { points, series };
  }, [trajectory]);

  const metricKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.keys(finalMetrics).forEach(k => keys.add(k));
    Object.keys(initialMetrics).forEach(k => keys.add(k));
    // If any digital-twin medical metric is present we're in
    // patient-twin mode; filter the grid to subject-shaped metrics.
    // Otherwise we're rendering against a non-medical artifact and the
    // unrestricted first-12 view is the right fallback (Mars /
    // corporate-quarterly / lunar / submarine / frontier-ai-lab).
    const inDigitalTwinScenario = Array.from(keys).some(k => DIGITAL_TWIN_METRICS.has(k));
    const filtered = inDigitalTwinScenario
      ? Array.from(keys).filter(k => DIGITAL_TWIN_METRICS.has(k))
      : Array.from(keys);
    return filtered.slice(0, 12);
  }, [finalMetrics, initialMetrics]);

  const fingerprintTop = fingerprint
    ? Object.entries(fingerprint).slice(0, 6)
    : [];

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.title}>Digital Twin · Intervention Result</h2>
          <span className={styles.subTitle}>
            {metadata?.scenario?.name ?? 'scenario'} · seed {metadata?.seed ?? '?'} · {trajectory?.timepoints?.length ?? 0} turns
          </span>
        </div>
        <div className={styles.runMeta}>
          {metadata?.runId && <span>run: {metadata.runId.slice(0, 28)}</span>}
          {cost?.totalUSD != null && <span>${cost.totalUSD.toFixed(3)}</span>}
          {cost?.llmCalls != null && <span>{cost.llmCalls} LLM calls</span>}
        </div>
      </div>

      <div className={styles.cardsRow}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Subject</span>
            <span className={styles.cardId}>{subject?.id}</span>
          </div>
          <div className={styles.cardName}>{subject?.name}</div>
          {profileEntries.length > 0 && (
            <div className={styles.kvList}>
              {profileEntries.map(([key, value]) => (
                <div key={key} className={styles.kv}>
                  <span>{key}</span>
                  <span>{formatProfileValue(value)}</span>
                </div>
              ))}
            </div>
          )}
          {subject?.signals && subject.signals.length > 0 && (
            <div className={styles.signalList}>
              {subject.signals.slice(0, 4).map((s, i) => (
                <div key={i} className={styles.signal}>
                  <span className={styles.signalLabel}>{s.label}</span>
                  <span className={styles.signalValue}>
                    {typeof s.value === 'number' ? formatNumber(s.value) : String(s.value)}
                    {s.unit ? ` ${s.unit}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLabel}>Intervention</span>
            <span className={styles.cardId}>{intervention?.id}</span>
          </div>
          <div className={styles.cardName}>{intervention?.name}</div>
          {intervention?.description && (
            <p className={styles.description}>{intervention.description}</p>
          )}
          <div className={styles.kvList}>
            {intervention?.duration && (
              <div className={styles.kv}>
                <span>Duration</span>
                <span>{intervention.duration.value} {intervention.duration.unit}</span>
              </div>
            )}
            {intervention?.adherenceProfile && (
              <div className={styles.kv}>
                <span>Adherence</span>
                <span>{(intervention.adherenceProfile.expected * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {metricKeys.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Final state · delta vs initial</h3>
          <div className={styles.metricsGrid}>
            {metricKeys.map(key => {
              const initial = initialMetrics[key];
              const final = finalMetrics[key];
              if (typeof final !== 'number') return null;
              const delta = typeof initial === 'number' ? formatDelta(initial, final) : null;
              return (
                <div key={key} className={styles.metric}>
                  <span className={styles.metricLabel}>{METRIC_LABELS[key] ?? key}</span>
                  <span className={styles.metricValue}>{formatNumber(final)}</span>
                  {delta && (
                    <span
                      className={`${styles.metricDelta} ${delta.direction === 'up' ? styles.metricDeltaUp : delta.direction === 'down' ? styles.metricDeltaDown : ''}`}
                    >
                      {delta.text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {chartData && chartData.series.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Trajectory</h3>
          <div className={styles.chartWrap}>
            <svg className={styles.chart} viewBox="0 0 600 200" preserveAspectRatio="none">
              {chartData.series.map(series => {
                const range = Math.max(0.0001, series.max - series.min);
                const stepX = chartData.points.length > 1 ? 580 / (chartData.points.length - 1) : 0;
                let path = '';
                series.values.forEach((v, i) => {
                  if (typeof v !== 'number') return;
                  const x = 10 + i * stepX;
                  const normalized = (v - series.min) / range;
                  const y = 180 - normalized * 160;
                  path += (path ? ' L' : 'M') + ` ${x.toFixed(1)} ${y.toFixed(1)}`;
                });
                return (
                  <g key={series.metric}>
                    <path d={path} stroke={CHART_COLORS[series.metric] ?? '#ffd970'} strokeWidth={1.5} fill="none" />
                    {series.values.map((v, i) => {
                      if (typeof v !== 'number') return null;
                      const x = 10 + i * stepX;
                      const normalized = (v - series.min) / range;
                      const y = 180 - normalized * 160;
                      return <circle key={`${series.metric}-${i}`} cx={x} cy={y} r={2.5} fill={CHART_COLORS[series.metric] ?? '#ffd970'} />;
                    })}
                  </g>
                );
              })}
              {chartData.points.map((p, i) => {
                const stepX = chartData.points.length > 1 ? 580 / (chartData.points.length - 1) : 0;
                const x = 10 + i * stepX;
                return (
                  <text key={`label-${i}`} x={x} y={196} fontSize={9} textAnchor="middle" fill="#888">
                    {p.label ?? `t${p.time ?? i}`}
                  </text>
                );
              })}
            </svg>
            <div className={styles.chartLegend}>
              {chartData.series.map(series => (
                <span key={series.metric} className={styles.legendItem}>
                  <span
                    className={`${styles.legendSwatch} ${styles.legendSwatchInline}`}
                    style={{ '--swatch-color': CHART_COLORS[series.metric] } as CSSProperties}
                  />
                  {METRIC_LABELS[series.metric] ?? series.metric}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {fingerprintTop.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Fingerprint</h3>
          <div className={styles.fingerprintList}>
            {fingerprintTop.map(([key, value]) => (
              <span key={key} className={styles.fingerprintChip}>
                {key}<b>{String(value)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <DigitalTwinPlayback state={state} />

      {onDismiss && (
        <div className={styles.dismissBar}>
          <button onClick={onDismiss} className={styles.dismissButton}>
            Clear · run another
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Scrubbable playback of the run's SSE event trail. Renders a slider
 * that walks the user through every event the run emitted (specialist
 * analyses, forge attempts, decision, outcome, completion) plus a
 * play/pause control that reveals events sequentially at ~600ms each.
 *
 * Reads events directly from gameState (the same stream
 * DigitalTwinProgress consumed live), so the playback timeline matches
 * the live feed exactly.
 */
function DigitalTwinPlayback({ state }: { state?: GameState }) {
  const events = useMemo(() => {
    if (!state) return [];
    const leaderId = state.actorIds[0];
    return leaderId ? state.actors[leaderId]?.events ?? [] : [];
  }, [state]);

  const totalEvents = events.length;
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Park the slider at the end the first time events arrive so a
  // freshly-completed run shows the final state by default. Tracked via
  // a ref so the effect only fires once even if events grow further.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && totalEvents > 0) {
      initializedRef.current = true;
      setPosition(totalEvents);
    }
  }, [totalEvents]);

  // Auto-advance one event every 600ms while playing.
  useEffect(() => {
    if (!playing) return;
    if (position >= totalEvents) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setPosition((p) => p + 1), 600);
    return () => window.clearTimeout(id);
  }, [playing, position, totalEvents]);

  if (totalEvents === 0) return null;

  const visibleEvents = events.slice(0, position);

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Playback · {position} / {totalEvents} events</h3>
      <div className={styles.playbackControls}>
        <button onClick={() => setPlaying(!playing)} className={styles.playbackPlayBtn}>
          {playing ? 'Pause' : (position >= totalEvents ? 'Replay' : 'Play')}
        </button>
        <button onClick={() => { setPosition(0); setPlaying(false); }} className={styles.playbackResetBtn}>
          Reset
        </button>
        <input
          type="range"
          min={0}
          max={totalEvents}
          value={position}
          onChange={(e) => { setPosition(Number(e.target.value)); setPlaying(false); }}
          className={styles.playbackSlider}
        />
      </div>
      <div className={styles.playbackList}>
        {visibleEvents.length === 0 ? (
          <div className={styles.playbackHint}>
            Drag the slider or press Play to step through the run.
          </div>
        ) : (
          visibleEvents.map((event) => (
            <div key={event.id} className={styles.playbackEvent}>
              <span className={styles.playbackTurn}>
                {event.turn != null ? `T${event.turn}` : ''}
              </span>
              <span className={styles.playbackType}>
                {EVENT_LABELS[event.type] ?? event.type}
              </span>
              <span className={styles.playbackBody}>
                {eventBody(event)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
