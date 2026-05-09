/**
 * Shared types for the paracosm dashboard viz kit.
 *
 * Each public component (TimepointCard, HealthScoreGauge, RiskFlagList,
 * TrajectoryStrip) consumes these. The types intentionally model the
 * universal RunArtifact shape exported from `paracosm/schema` so the kit
 * is mode-aware via `metadata.mode` without per-component branching.
 */

/**
 * Specification for a single metric: how to label it, what unit format
 * to use, what value range it spans, and where the warn / critical
 * thresholds sit. Inverted metrics (radiation exposure: lower-is-better)
 * reverse the color scale.
 */
export interface MetricSpec {
  id: string;
  label: string;
  unit?: 'pct' | 'count' | 'currency' | 'time' | string;
  range: [number, number];
  thresholds?: { warn?: number; critical?: number };
  inverted?: boolean;
}

/**
 * Severity-graded callout. RiskFlags surface in TimepointCard and
 * RiskFlagList; the severity ordering critical > high > medium > low
 * is canonical and the list is sorted on that key.
 */
export interface RiskFlag {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  label: string;
  detail?: string;
  source?: string;
}

/**
 * Lightweight summary of a single timepoint. Composed by TimepointCard;
 * also produced upstream from RunArtifact.trajectory.timepoints[] for
 * batch-trajectory and turn-loop modes.
 */
export interface TimepointSummary {
  label: string;
  metrics: Record<string, number>;
  highlights?: string[];
  riskFlags?: RiskFlag[];
}

/**
 * Mode discriminator carried on RunArtifact.metadata.mode.
 */
export type SimulationMode = 'turn-loop' | 'batch-trajectory' | 'batch-point';
