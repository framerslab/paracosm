/**
 * Pure builder that maps paracosm's internal run state onto the
 * universal `RunArtifact` shape published under `paracosm/schema`.
 *
 * Keeps the orchestrator return site a single function call. Every
 * field rebucketing + shape normalization lives here.
 *
 * @module paracosm/runtime/io/build-artifact
 */
import type {
  Citation,
  Cost,
  Decision,
  ForgedToolSummary,
  InterventionConfig,
  ProviderError,
  RunArtifact,
  SimulationMode,
  SpecialistNote,
  SubjectConfig,
  SwarmSnapshot,
  Timepoint,
  TrajectoryPoint,
  WorldSnapshot,
} from '../../engine/schema/index.js';

/**
 * Whitelist guards for risk/opportunity classification values. Zod
 * validates these at the DepartmentReport LLM-output boundary, but an
 * upstream caller could bypass that path (tests, direct construction)
 * and produce out-of-domain strings. Filtering here rather than casting
 * keeps the RunArtifact valid even when the inputs are degraded — the
 * Zod parse at the public boundary would reject otherwise.
 */
const VALID_RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
type RiskSeverity = (typeof VALID_RISK_SEVERITIES)[number];
const isRiskSeverity = (v: string): v is RiskSeverity =>
  (VALID_RISK_SEVERITIES as readonly string[]).includes(v);

const VALID_OPPORTUNITY_IMPACTS = ['low', 'medium', 'high'] as const;
type OpportunityImpact = (typeof VALID_OPPORTUNITY_IMPACTS)[number];
const isOpportunityImpact = (v: string): v is OpportunityImpact =>
  (VALID_OPPORTUNITY_IMPACTS as readonly string[]).includes(v);

/**
 * Input bag for {@link buildRunArtifact}. Shapes match paracosm's
 * current internal run state; this function is the single place where
 * the internal shape meets the public one.
 */
export interface BuildArtifactInputs {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  seed?: number;
  mode: SimulationMode;
  startedAt: string;
  completedAt?: string;
  /** Time-unit labels — post-F23 scenario-declared singular/plural. */
  timeUnit: { singular: string; plural: string };
  /**
   * Raw per-turn internal state. Matches {@link TurnArtifact} from
   * `./contracts.ts`. `stateSnapshotAfter` carries the five runtime
   * bags (metrics required, capacities / statuses / politics /
   * environment optional) so every turn's per-bag state rolls into
   * the returned `Timepoint.worldSnapshot` without flattening.
   */
  turnArtifacts: Array<{
    turn: number;
    time: number;
    stateSnapshotAfter: {
      metrics: Record<string, number>;
      capacities?: Record<string, number>;
      statuses?: Record<string, string | boolean>;
      politics?: Record<string, number | string | boolean>;
      environment?: Record<string, number | string | boolean>;
    };
    departmentReports: Array<{
      department: string;
      summary: string;
      confidence: number;
      risks: Array<{ severity: string; description: string }>;
      opportunities: Array<{ impact: string; description: string }>;
      citations: Array<{ text: string; url: string; doi?: string; context?: string }>;
      recommendedActions: string[];
      openQuestions: string[];
    }>;
    commanderDecision: {
      decision: string;
      rationale: string;
      reasoning?: string;
      selectedPolicies: string[];
    };
    policyEffectsApplied: string[];
  }>;
  /** Flat list of commander decisions across turns. */
  commanderDecisions: Array<{
    turn: number;
    time: number;
    actor?: string;
    decision: string;
    rationale: string;
    reasoning?: string;
    outcome?: Decision['outcome'];
  }>;
  /** Deduped forged toolbox. */
  forgedToolbox: ForgedToolSummary[];
  /** Deduped citation catalog. */
  citationCatalog: Citation[];
  /** Per-turn agent reactions — stashed under scenarioExtensions.reactions. */
  agentReactions: unknown[];
  finalState?: {
    metrics: Record<string, number>;
    capacities?: Record<string, number>;
    politics?: Record<string, number | string | boolean>;
    statuses?: Record<string, string | boolean>;
    environment?: Record<string, number | string | boolean>;
    metadata?: unknown;
  };
  /**
   * Final agent-swarm snapshot — every agent's role, mood, family edges,
   * memory at end-of-run. Pairs with `finalState`. Optional; turn-loop
   * runs that exercised the swarm populate this, batch modes do not.
   */
  finalSwarm?: SwarmSnapshot;
  fingerprint?: Record<string, number | string>;
  cost?: Cost;
  providerError?: ProviderError | null;
  aborted?: boolean;
  /** Narrative-layer overrides — batch modes populate these directly. */
  overview?: string;
  assumptions?: string[];
  leveragePoints?: string[];
  disclaimer?: string;
  /**
   * Subject being simulated. Passed through verbatim to the returned
   * artifact. Turn-loop mode does not consume this semantically.
   */
  subject?: SubjectConfig;
  /**
   * Intervention being tested on the subject. Passed through verbatim to
   * the returned artifact. Turn-loop ignores; batch modes consume.
   */
  intervention?: InterventionConfig;
  /**
   * Additional payloads to merge into `scenarioExtensions`. Paracosm's
   * orchestrator stashes internal-only fields here (leader HEXACO
   * history, forgeAttempts detail, tool registries, director events,
   * outcome log) so consumers that need them can reach in without
   * polluting the universal top-level shape.
   */
  scenarioExtensionsExtra?: Record<string, unknown>;
  /**
   * When this run was produced by a `WorldModel.fork()` call, this is
   * the parent-run linkage that gets stamped onto
   * `RunArtifact.metadata.forkedFrom`. Undefined for fresh (non-
   * forked) runs.
   */
  forkedFrom?: { parentRunId: string; atTurn: number };
}

export function buildRunArtifact(inputs: BuildArtifactInputs): RunArtifact {
  const timepoints: Timepoint[] = inputs.turnArtifacts.map((ta) => ({
    time: ta.time,
    label: `${inputs.timeUnit.singular.charAt(0).toUpperCase()}${inputs.timeUnit.singular.slice(1)} ${ta.time}`,
    // Per-timepoint worldSnapshot carries all five runtime bags, not
    // just metrics. Conditional spread keeps the emitted JSON tight
    // (no noisy empty `statuses: {}` / `environment: {}` on scenarios
    // that don't declare those bags). Consumers destructure with
    // optional chaining: `tp.worldSnapshot?.statuses?.governanceStatus`.
    worldSnapshot: {
      metrics: ta.stateSnapshotAfter.metrics,
      ...(ta.stateSnapshotAfter.capacities && Object.keys(ta.stateSnapshotAfter.capacities).length > 0
        ? { capacities: ta.stateSnapshotAfter.capacities }
        : {}),
      ...(ta.stateSnapshotAfter.statuses && Object.keys(ta.stateSnapshotAfter.statuses).length > 0
        ? { statuses: ta.stateSnapshotAfter.statuses }
        : {}),
      ...(ta.stateSnapshotAfter.politics && Object.keys(ta.stateSnapshotAfter.politics).length > 0
        ? { politics: ta.stateSnapshotAfter.politics }
        : {}),
      ...(ta.stateSnapshotAfter.environment && Object.keys(ta.stateSnapshotAfter.environment).length > 0
        ? { environment: ta.stateSnapshotAfter.environment }
        : {}),
    } satisfies WorldSnapshot,
  }));

  const points: TrajectoryPoint[] = inputs.turnArtifacts.map((ta) => ({
    time: ta.time,
    metrics: ta.stateSnapshotAfter.metrics,
  }));

  const specialistNotes: SpecialistNote[] = inputs.turnArtifacts.flatMap((ta) =>
    ta.departmentReports.map((r) => ({
      domain: r.department,
      summary: r.summary,
      confidence: r.confidence,
      detail: {
        risks: r.risks
          .filter((risk) => isRiskSeverity(risk.severity))
          .map((risk) => ({
            severity: risk.severity as RiskSeverity,
            description: risk.description,
          })),
        opportunities: r.opportunities
          .filter((o) => isOpportunityImpact(o.impact))
          .map((o) => ({
            impact: o.impact as OpportunityImpact,
            description: o.description,
          })),
        recommendedActions: r.recommendedActions,
        citations: r.citations.map((c) => ({
          text: c.text,
          url: c.url,
          doi: c.doi,
          context: c.context ?? '',
        })),
        openQuestions: r.openQuestions,
      },
    })),
  );

  const decisions: Decision[] = inputs.commanderDecisions.map((d) => ({
    time: d.time,
    actor: d.actor,
    choice: d.decision,
    rationale: d.rationale,
    reasoning: d.reasoning,
    outcome: d.outcome,
  }));

  const trajectoryPopulated = timepoints.length > 0 || points.length > 0;

  const mergedExtensions: Record<string, unknown> = {
    ...(inputs.agentReactions.length > 0 ? { reactions: inputs.agentReactions } : {}),
    ...(inputs.scenarioExtensionsExtra ?? {}),
  };

  const artifact: RunArtifact = {
    metadata: {
      runId: inputs.runId,
      scenario: { id: inputs.scenarioId, name: inputs.scenarioName },
      seed: inputs.seed,
      mode: inputs.mode,
      startedAt: inputs.startedAt,
      completedAt: inputs.completedAt,
      ...(inputs.forkedFrom ? { forkedFrom: inputs.forkedFrom } : {}),
    },
    overview: inputs.overview,
    assumptions: inputs.assumptions,
    leveragePoints: inputs.leveragePoints,
    disclaimer: inputs.disclaimer,
    trajectory: trajectoryPopulated
      ? { timeUnit: inputs.timeUnit, points, timepoints }
      : undefined,
    specialistNotes: specialistNotes.length > 0 ? specialistNotes : undefined,
    decisions: decisions.length > 0 ? decisions : undefined,
    subject: inputs.subject,
    intervention: inputs.intervention,
    finalState: inputs.finalState
      ? {
          metrics: inputs.finalState.metrics,
          capacities: inputs.finalState.capacities,
          politics: inputs.finalState.politics,
          statuses: inputs.finalState.statuses,
          environment: inputs.finalState.environment,
        }
      : undefined,
    finalSwarm: inputs.finalSwarm,
    fingerprint: inputs.fingerprint,
    citations: inputs.citationCatalog.length > 0 ? inputs.citationCatalog : undefined,
    forgedTools: inputs.forgedToolbox.length > 0 ? inputs.forgedToolbox : undefined,
    cost: inputs.cost,
    providerError: inputs.providerError ?? null,
    aborted: inputs.aborted ?? false,
    scenarioExtensions:
      Object.keys(mergedExtensions).length > 0 ? mergedExtensions : undefined,
  };

  return artifact;
}
