/**
 * Barrel re-exports for the paracosm dashboard viz kit.
 *
 * Consumers can import all four primary components plus the shared types
 * from this single entry: `import { TimepointCard, ... } from '.../viz/kit'`.
 */
export { HealthScoreGauge } from './HealthScoreGauge.js';
export type { HealthScoreGaugeProps } from './HealthScoreGauge.js';

export { RiskFlagList } from './RiskFlagList.js';
export type { RiskFlagListProps } from './RiskFlagList.js';

export { TimepointCard, timepointLabel, pickTopN } from './TimepointCard.js';
export type { TimepointCardProps } from './TimepointCard.js';

export { TrajectoryStrip, pickHighest } from './TrajectoryStrip.js';
export type { TrajectoryStripProps, TrajectoryStripPoint } from './TrajectoryStrip.js';

export type { MetricSpec, RiskFlag, TimepointSummary, SimulationMode } from './shared/types.js';
export { metricColor } from './shared/metric-color.js';
export type { ColorBucket } from './shared/metric-color.js';
export { formatMetric } from './shared/format-metric.js';
