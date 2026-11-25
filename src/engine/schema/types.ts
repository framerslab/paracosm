/**
 * Inferred TypeScript type aliases for every public schema exported from
 * `paracosm/schema`. Consumers who don't want runtime validation can
 * `import type { RunArtifact } from 'paracosm/schema'` and get full
 * type safety with zero runtime cost.
 *
 * Public types drop the `Z` suffix that the internal `src/runtime/validators/`
 * Zod schemas use. `DepartmentReportZ` stays internal; `RunArtifact`,
 * `Timepoint`, `SpecialistNote` are the public names.
 *
 * @module paracosm/schema/types
 */
import type { z } from 'zod';

import type { RunArtifactSchema, ForgedToolSummarySchema } from './artifact.js';
import type {
  CitationSchema,
  CostSchema,
  DecisionOutcomeSchema,
  DecisionSchema,
  HighlightMetricSchema,
  InterventionConfigSchema,
  ProviderErrorSchema,
  RiskFlagSchema,
  RunMetadataSchema,
  RunProvenanceSchema,
  ScenarioExtensionsSchema,
  ScoreSchema,
  SimulationModeSchema,
  SpecialistDetailSchema,
  SpecialistNoteSchema,
  SubjectConfigSchema,
  SubjectMarkerSchema,
  SubjectSignalSchema,
  SwarmAgentSchema,
  SwarmSnapshotSchema,
  TimepointSchema,
  TrajectoryPointSchema,
  TrajectorySchema,
  WorldSnapshotSchema,
} from './primitives.js';
import type { StreamEventSchema } from './stream.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type ScenarioExtensions = z.infer<typeof ScenarioExtensionsSchema>;
export type SimulationMode = z.infer<typeof SimulationModeSchema>;
export type RunMetadata = z.infer<typeof RunMetadataSchema>;

/** Machine-readable authorship and assigned public model identifiers. */
export type RunProvenance = z.infer<typeof RunProvenanceSchema>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export type Score = z.infer<typeof ScoreSchema>;
export type HighlightMetric = z.infer<typeof HighlightMetricSchema>;
export type Timepoint = z.infer<typeof TimepointSchema>;
export type TrajectoryPoint = z.infer<typeof TrajectoryPointSchema>;
export type Trajectory = z.infer<typeof TrajectorySchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type SpecialistDetail = z.infer<typeof SpecialistDetailSchema>;
export type SpecialistNote = z.infer<typeof SpecialistNoteSchema>;
export type RiskFlag = z.infer<typeof RiskFlagSchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Cost = z.infer<typeof CostSchema>;
export type ProviderError = z.infer<typeof ProviderErrorSchema>;

// Subject + Intervention input primitives
export type SubjectSignal = z.infer<typeof SubjectSignalSchema>;
export type SubjectMarker = z.infer<typeof SubjectMarkerSchema>;
export type SubjectConfig = z.infer<typeof SubjectConfigSchema>;
export type InterventionConfig = z.infer<typeof InterventionConfigSchema>;

// Swarm primitives — public view of the agent roster
export type SwarmAgent = z.infer<typeof SwarmAgentSchema>;
export type SwarmSnapshot = z.infer<typeof SwarmSnapshotSchema>;

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export type ForgedToolSummary = z.infer<typeof ForgedToolSummarySchema>;
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

export type StreamEvent = z.infer<typeof StreamEventSchema>;
