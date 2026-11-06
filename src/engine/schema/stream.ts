/**
 * Stream event envelope — Zod discriminated union covering every SSE
 * event type emitted by `runSimulation`. Exported from `paracosm/schema`.
 *
 * Current 17 event types from
 * [`SimEventPayloadMap`](../../runtime/orchestrator.ts) are formalized
 * here using the published specialist, decision, and personality event
 * names from the universal schema.
 *
 * `time: number` replaces the legacy `year: number` envelope field per
 * F23's time-units rename. Both are optional on the envelope (some events
 * fire before a turn has advanced to its final time).
 *
 * @module paracosm/schema/stream
 */
import { z } from 'zod';

import { ProviderErrorSchema } from './primitives.js';

// ---------------------------------------------------------------------------
// Per-event data schemas — formalize the 17 payload shapes
// ---------------------------------------------------------------------------

const TurnStartDataSchema = z.object({
  summary: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  crisis: z.string().optional(),
  category: z.string().optional(),
  births: z.number().optional(),
  deaths: z.number().optional(),
  metrics: z.record(z.string(), z.number()).optional(),
  emergent: z.boolean().optional(),
  turnSummary: z.string().optional(),
  totalEvents: z.number().optional(),
  pacing: z.unknown().optional(),
});

const EventStartDataSchema = z.object({
  summary: z.string().optional(),
  eventIndex: z.number().int().min(0),
  totalEvents: z.number().int().min(0),
  title: z.string(),
  description: z.string().optional(),
  category: z.string(),
  emergent: z.boolean().optional(),
  turnSummary: z.string().optional(),
  pacing: z.unknown().optional(),
});

const SpecialistStartDataSchema = z.object({
  summary: z.string().optional(),
  department: z.string().min(1),
  eventIndex: z.number().int().min(0),
});

const SpecialistDoneDataSchema = z.object({
  summary: z.string().optional(),
  department: z.string().min(1),
  eventIndex: z.number().int().min(0),
  citations: z.number().int().min(0),
  citationList: z.array(z.object({
    text: z.string(),
    url: z.string(),
    doi: z.string().optional(),
  })),
  risks: z.array(z.string()),
  forgedTools: z.array(z.unknown()),
  recommendedActions: z.array(z.string()).optional(),
  /** Optional full detail payload — populated when scenario emits rich reports. */
  deptSummary: z.string().optional(),
});

const ForgeAttemptDataSchema = z.object({
  summary: z.string().optional(),
  department: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mode: z.string().optional(),
  approved: z.boolean(),
  confidence: z.number().min(0).max(1),
  inputFields: z.array(z.string()),
  outputFields: z.array(z.string()),
  errorReason: z.string().optional(),
  timestamp: z.string(),
  eventIndex: z.number().int().optional(),
});

const DecisionPendingDataSchema = z.object({
  summary: z.string().optional(),
  eventIndex: z.number().int().min(0),
});

const DecisionMadeDataSchema = z.object({
  summary: z.string().optional(),
  decision: z.string(),
  rationale: z.string(),
  reasoning: z.string(),
  selectedPolicies: z.array(z.unknown()),
  selectedOptionId: z.string().optional(),
  eventIndex: z.number().int().min(0),
});

const OutcomeDataSchema = z.object({
  summary: z.string().optional(),
  outcome: z.string(),
  category: z.string(),
  emergent: z.boolean(),
  systemDeltas: z.record(z.string(), z.number()),
  politicsDeltas: z.record(z.string(), z.number()).optional(),
  eventIndex: z.number().int().min(0),
});

const PersonalityDriftDataSchema = z.object({
  summary: z.string().optional(),
  agents: z.record(z.string(), z.object({
    name: z.string(),
    hexaco: z.record(z.string(), z.number()),
  })),
  commander: z.unknown(),
});

const AgentReactionsDataSchema = z.object({
  summary: z.string().optional(),
  reactions: z.array(z.unknown()),
  moodSummary: z.unknown().optional(),
});

const BulletinDataSchema = z.object({
  summary: z.string().optional(),
  posts: z.array(z.unknown()),
});

const TurnDoneDataSchema = z.object({
  summary: z.string().optional(),
  metrics: z.record(z.string(), z.number()),
  /**
   * Categorical statuses bag (world.statuses declarations). Emitted
   * when the scenario declared any; omitted for Mars-shape scenarios
   * that only have numeric metrics. Added in the 0.7.x worldSnapshot
   * widening so dashboards can surface scenario-declared governance
   * state, funding round, alignment, etc.
   */
  statuses: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  /**
   * Environment bag (world.environment declarations): external
   * conditions like market growth pct, radiation level, depth.
   * Same emit rule as statuses.
   */
  environment: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  /** The tools the run has forged so far, each approved tool once however often it was used. */
  toolsForged: z.number().int().min(0),
  totalEvents: z.number().int().optional(),
  deathCauses: z.record(z.string(), z.number()).optional(),
  error: z.string().optional(),
});

const PromotionDataSchema = z.object({
  summary: z.string().optional(),
  agentId: z.string().min(1),
  department: z.string().min(1),
  role: z.string().min(1),
  reason: z.string().optional(),
});

const SystemsSnapshotDataSchema = z.object({
  summary: z.string().optional(),
  agents: z.array(z.unknown()),
  population: z.number(),
  morale: z.number(),
  /** Months of food, in a run whose scenario carries `foodMonthsReserve`. */
  foodReserve: z.number().optional(),
  births: z.number(),
  deaths: z.number(),
});

const StreamProviderErrorDataSchema = ProviderErrorSchema.extend({
  summary: z.string().optional(),
  site: z.string().optional(),
});

const ValidationFallbackDataSchema = z.object({
  summary: z.string().optional(),
  site: z.string(),
  schemaName: z.string().optional(),
  rawTextPreview: z.string(),
  error: z.string(),
});

const SimAbortedDataSchema = z.object({
  summary: z.string().optional(),
  reason: z.string(),
  completedTurns: z.number().int().min(0),
  metrics: z.record(z.string(), z.number()),
  /** The tools the run has forged so far, each approved tool once however often it was used. */
  toolsForged: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Envelope — common fields on every stream event
// ---------------------------------------------------------------------------

/**
 * Build an envelope schema for a given event type + data schema.
 *
 * `time` replaces legacy `year` per F23. `turn` is 0-indexed turn number
 * when applicable (some events fire before a turn advances). Both
 * optional; some stream events fire outside a turn context
 * (e.g., `provider_error` during setup).
 */
const envelope = <T extends z.ZodTypeAny>(type: string, data: T) =>
  z.object({
    type: z.literal(type),
    leader: z.string(),
    turn: z.number().int().optional(),
    time: z.number().optional(),
    data,
  });

// ---------------------------------------------------------------------------
// StreamEvent — discriminated union of all 17 event types
// ---------------------------------------------------------------------------

/**
 * Every SSE event emitted by `runSimulation` validates against this
 * union. Consumers `switch` on `event.type` for full narrow-typed access
 * to `event.data` fields.
 *
 * @example
 * ```ts
 * import { StreamEventSchema } from 'paracosm/schema';
 *
 * for await (const raw of sse) {
 *   const event = StreamEventSchema.parse(JSON.parse(raw));
 *   switch (event.type) {
 *     case 'outcome':         console.log(event.data.systemDeltas); break;
 *     case 'decision_made':   console.log(event.data.rationale); break;
 *     case 'provider_error':  console.error(event.data.kind, event.data.message); break;
 *   }
 * }
 * ```
 */
export const StreamEventSchema = z.discriminatedUnion('type', [
  envelope('turn_start', TurnStartDataSchema),
  envelope('event_start', EventStartDataSchema),
  envelope('specialist_start', SpecialistStartDataSchema),
  envelope('specialist_done', SpecialistDoneDataSchema),
  envelope('forge_attempt', ForgeAttemptDataSchema),
  envelope('decision_pending', DecisionPendingDataSchema),
  envelope('decision_made', DecisionMadeDataSchema),
  envelope('outcome', OutcomeDataSchema),
  envelope('personality_drift', PersonalityDriftDataSchema),
  envelope('agent_reactions', AgentReactionsDataSchema),
  envelope('bulletin', BulletinDataSchema),
  envelope('turn_done', TurnDoneDataSchema),
  envelope('promotion', PromotionDataSchema),
  envelope('systems_snapshot', SystemsSnapshotDataSchema),
  envelope('provider_error', StreamProviderErrorDataSchema),
  envelope('validation_fallback', ValidationFallbackDataSchema),
  envelope('sim_aborted', SimAbortedDataSchema),
]);

/**
 * The set of valid `event.type` literals. Consumers can use this as a
 * type guard against unknown event types.
 */
export const STREAM_EVENT_TYPES = [
  'turn_start',
  'event_start',
  'specialist_start',
  'specialist_done',
  'forge_attempt',
  'decision_pending',
  'decision_made',
  'outcome',
  'personality_drift',
  'agent_reactions',
  'bulletin',
  'turn_done',
  'promotion',
  'systems_snapshot',
  'provider_error',
  'validation_fallback',
  'sim_aborted',
] as const;

export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number];
