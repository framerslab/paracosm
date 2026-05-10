/**
 * Quickstart HTTP routes (Tier 5 onboarding). Three endpoints:
 *
 * - `POST /api/quickstart/fetch-seed`: URL -> extracted main text + title.
 * - `POST /api/quickstart/compile-from-seed`: seedText -> compiled ScenarioPackage.
 * - `POST /api/quickstart/generate-actors`: scenarioId -> ActorConfig[].
 *
 * Each is stateless except for the compiled-scenario install: a
 * successful `compile-from-seed` installs the result as the active
 * scenario so the subsequent `/setup` POST runs it. Routes are
 * extracted from `server-app.ts` for unit-test isolation.
 *
 * @module paracosm/cli/quickstart-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { compileFromSeed } from '../../engine/compiler/compile-from-seed.js';
import { generateQuickstartActors } from '../../runtime/world-model/index.js';
import { WorldModel } from '../../runtime/world-model/index.js';
import type { ScenarioPackage, ActorConfig } from '../../engine/types.js';
import type { SubjectConfig, InterventionConfig, RunArtifact } from '../../engine/schema/index.js';
import { groundScenario, type GroundingResult } from '../services/deep-research.js';
import type { BroadcastFn } from '../../cli/pair-runner.js';

const FetchSeedSchema = z.object({
  url: z.string().url().max(2048),
});

const CompileFromSeedSchema = z.object({
  seedText: z.string().min(200).max(50_000),
  domainHint: z.string().max(80).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  // Number of parallel actors to generate + run. Default 3; max 300.
  // Threaded into generate-actors + the subsequent /setup batch path.
  // The compiler ignores it; only the dashboard reads it back.
  // Cap raised from 50 once the batch runner gained real concurrency
  // limiting (economics.batch.maxConcurrency) so 300 actors no longer
  // fan out to 300 simultaneous LLM streams.
  actorCount: z.number().int().min(1).max(300).optional(),
});

const GenerateActorsSchema = z.object({
  scenarioId: z.string().min(3).max(64),
  // Max 300 actors per bundle. Each actor is ~$0.30 LLM spend; the
  // SeedInput cost preview surfaces the running total so users opt in
  // consciously. The runtime feeds them through the batch runner with
  // an economics-profile concurrency cap (default 8 in batch mode) so
  // 300 actors land as ~38 batches of 8, not 300 simultaneous calls.
  count: z.number().int().min(2).max(300).default(3),
});

const GroundScenarioSchema = z.object({
  scenarioId: z.string().min(3).max(64),
});

const SubjectSignalSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.union([z.number(), z.string()]),
  unit: z.string().max(40).optional(),
  recordedAt: z.string().max(64).optional(),
});

const SubjectMarkerSchema = z.object({
  id: z.string().min(1).max(64),
  category: z.string().max(40).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const SubjectSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  profile: z.record(z.string(), z.unknown()).optional(),
  signals: z.array(SubjectSignalSchema).max(40).optional(),
  markers: z.array(SubjectMarkerSchema).max(40).optional(),
});

const InterventionSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  duration: z.object({
    value: z.number(),
    unit: z.string().min(1).max(40),
  }).optional(),
  adherenceProfile: z.object({
    expected: z.number().min(0).max(1),
    risks: z.array(z.string()).optional(),
  }).optional(),
});

const LeaderSchema = z.object({
  name: z.string().min(1).max(80),
  archetype: z.string().min(1).max(60),
  unit: z.string().min(1).max(80).optional(),
  hexaco: z.object({
    openness: z.number().min(0).max(1),
    conscientiousness: z.number().min(0).max(1),
    extraversion: z.number().min(0).max(1),
    agreeableness: z.number().min(0).max(1),
    emotionality: z.number().min(0).max(1),
    honestyHumility: z.number().min(0).max(1),
  }),
  instructions: z.string().default(''),
});

const SimulateInterventionSchema = z.object({
  subject: SubjectSchema,
  intervention: InterventionSchema,
  leader: LeaderSchema.optional(),
  scenarioId: z.string().min(3).max(80).optional(),
  options: z.object({
    maxTurns: z.number().int().min(1).max(6).optional(),
    seed: z.number().int().optional(),
    costPreset: z.enum(['quality', 'economy']).optional(),
  }).optional(),
});

const DEFAULT_DIGITAL_TWIN_LEADER: ActorConfig = {
  name: 'Cautious Methodical Evaluator',
  archetype: 'The Methodical Evaluator',
  unit: 'Lab leadership',
  hexaco: {
    openness: 0.55,
    conscientiousness: 0.92,
    extraversion: 0.4,
    agreeableness: 0.65,
    emotionality: 0.55,
    honestyHumility: 0.88,
  },
  instructions: '',
};

export interface QuickstartDeps {
  /** Installs a compiled scenario as the active scenario. The optional
   *  `seedText` is the user's original natural-language prompt — server
   *  state stashes it so the next /setup → active_scenario broadcast can
   *  carry it through to the session store, which surfaces it on the
   *  replay banner and Replay-Last-Run CTA. */
  setActiveScenario: (scenario: ScenarioPackage, seedText?: string) => void;
  /** Resolves an in-memory scenario id against the server catalog. */
  getScenarioById: (id: string) => ScenarioPackage | undefined;
  /** Fetches a URL's main text content. Returns `{text, title, sourceUrl}`. */
  fetchSeedFromUrl: (url: string) => Promise<{ text: string; title: string; sourceUrl: string }>;
  /** Default provider + model for the LLM calls. */
  defaultProvider: string;
  defaultModel: string;
  /** Stash deep-research citations keyed by scenario id. Optional so
   *  legacy callers (older test fixtures) don't have to construct the
   *  full record. The grounding route is the only writer; future
   *  actor-generation prompts can read via a sibling helper. */
  recordGroundingCitations?: (
    scenarioId: string,
    citations: Array<{ query: string; sources: Array<{ title: string; link: string; domain: string }> }>,
  ) => void;
  /**
   * Lazily compile + cache the corporate-quarterly scenario and return a
   * WorldModel ready for `intervene`. Used by the
   * /simulate-intervention route so the digital-twin tab does not need
   * the user to compile a scenario first.
   *
   * Returns undefined when the underlying scenario file is missing or
   * compile fails (caller writes a 502 in that case).
   */
  getDigitalTwinWorld?: () => Promise<WorldModel | null>;
  /**
   * SSE broadcast function (same one /setup uses). When wired, the
   * simulate-intervention handler streams every per-turn event the
   * underlying runSimulation emits to the dashboard's /events channel
   * so the SIM tab renders live progress while the synchronous fetch
   * is still in flight. Without it, the run still works but the user
   * sees nothing until the artifact returns.
   */
  broadcast?: BroadcastFn;
  /**
   * Reset the in-memory event buffer + per-run state before a new
   * digital-twin run starts. Mirrors what /setup does on a fresh sim:
   * without it, prior events from another run bleed into the
   * dashboard's gameState while the new intervention is streaming.
   */
  resetEventBuffer?: () => void;
  /**
   * Test seam: substitute the actual compile pipeline. Production
   * uses the real `compileFromSeed`; tests can inject a deterministic
   * fake to exercise the async-job state machine without LLM calls.
   */
  compileFn?: typeof compileFromSeed;
}

export async function handleFetchSeed(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: QuickstartDeps,
): Promise<void> {
  const parsed = FetchSeedSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL', issues: parsed.error.issues.slice(0, 3).map(i => i.message) }));
    return;
  }
  const { url } = parsed.data;
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL' }));
    return;
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unsupported URL scheme: ${scheme}. Use http or https.` }));
    return;
  }
  try {
    const { text, title, sourceUrl } = await deps.fetchSeedFromUrl(url);
    const truncated = text.length > 50_000;
    const finalText = truncated ? text.slice(0, 50_000) : text;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: finalText, title, sourceUrl, truncated }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Failed to fetch URL: ${String(err)}` }));
  }
}

/**
 * Async-job pattern for compile-from-seed.
 *
 * Compile takes 60-120s (LLM draft + grounding + zod validate + hook
 * compile). Cloudflare's edge tier cuts HTTP responses at 100s with a
 * 524, so synchronously awaiting the compile in the request handler
 * means the dashboard sees "Compile failed: HTTP 524" even though the
 * server-side compile is still running. Retries kick off a NEW compile
 * that also 524s and the loop never resolves.
 *
 * Fix: split the endpoint into start + status:
 *   - POST /api/quickstart/compile-from-seed              (start)
 *     Returns 202 + { jobId, status: 'pending' } in <100ms. Compile
 *     runs in the background. If the same seed is submitted again
 *     while pending, the second call returns the same jobId — no
 *     duplicate compile.
 *   - POST /api/quickstart/compile-from-seed/status       (poll)
 *     Returns { jobId, status, scenario? } in <50ms. Client polls
 *     every 2s until status === 'done' or 'error'. The connection
 *     never stays open past the edge timeout, so 524 cannot fire.
 *
 * Job state is in-memory; resolved jobs are kept for 10 minutes so a
 * slow user retry hits the cached scenario instantly. Beyond that the
 * compiled scenario is still in customScenarioCatalog (via
 * setActiveScenario) — the job map is purely the compile-pipeline
 * deduplicator.
 */
const JOB_TTL_MS = 10 * 60 * 1000;

type JobStatus = 'pending' | 'done' | 'error';

interface CompileJob {
  jobId: string;
  signature: string;
  status: JobStatus;
  scenario?: ScenarioPackage;
  error?: string;
  startedAt: number;
  /** Set when status flips to 'done' or 'error'. Drives TTL eviction. */
  resolvedAt?: number;
}

const compileJobs = new Map<string, CompileJob>();
const jobBySignature = new Map<string, string>();

function compileSignature(input: {
  seedText: string;
  sourceUrl?: string;
  domainHint?: string;
}): string {
  // Normalize whitespace + lowercase optional fields so trivially
  // different submissions share a slot. The seed text is fingerprinted
  // by length + head + tail; collisions across two 50KB payloads with
  // the same length are extraordinarily unlikely and the worst case is
  // one client receives a different scenario than they typed once.
  const text = input.seedText.trim();
  return JSON.stringify({
    len: text.length,
    head: text.slice(0, 256),
    tail: text.slice(-128),
    url: (input.sourceUrl ?? '').toLowerCase(),
    hint: (input.domainHint ?? '').toLowerCase(),
  });
}

function sweepStaleJobs(): void {
  const now = Date.now();
  for (const [jobId, job] of compileJobs) {
    if (job.resolvedAt && now - job.resolvedAt > JOB_TTL_MS) {
      compileJobs.delete(jobId);
      if (jobBySignature.get(job.signature) === jobId) {
        jobBySignature.delete(job.signature);
      }
    }
  }
}

const CompileFromSeedStatusSchema = z.object({
  jobId: z.string().min(1).max(80),
});

/**
 * Test seam: clears the in-memory job state. Production never calls
 * this — it's only for the unit tests so each one starts from a clean
 * slate.
 */
export function _resetCompileJobsForTest(): void {
  compileJobs.clear();
  jobBySignature.clear();
}

export async function handleCompileFromSeed(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: QuickstartDeps,
): Promise<void> {
  const parsed = CompileFromSeedSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Invalid compile-from-seed payload',
      issues: parsed.error.issues.slice(0, 5).map(i => i.message),
    }));
    return;
  }

  sweepStaleJobs();
  const signature = compileSignature(parsed.data);

  // Dedupe: an existing job for this signature short-circuits a new
  // compile. Pending → return the same jobId so the second client
  // polls the in-flight compile. Done → return the scenario inline so
  // a fast retry skips polling entirely. Error → clear and start
  // fresh; users should be able to retry past a transient failure.
  const existingId = jobBySignature.get(signature);
  if (existingId) {
    const existing = compileJobs.get(existingId);
    if (existing && existing.status === 'pending') {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: existing.jobId, status: 'pending' }));
      return;
    }
    if (existing && existing.status === 'done' && existing.scenario) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jobId: existing.jobId,
        status: 'done',
        scenario: existing.scenario,
        scenarioId: existing.scenario.id,
      }));
      return;
    }
    if (existing && existing.status === 'error') {
      compileJobs.delete(existing.jobId);
      jobBySignature.delete(signature);
    }
  }

  // New compile — store as pending, kick off in background, respond
  // immediately. We do NOT await the promise here; that's the entire
  // point of the async pattern. Errors are caught and stored on the
  // job; the status endpoint surfaces them.
  const jobId = randomUUID();
  const job: CompileJob = {
    jobId,
    signature,
    status: 'pending',
    startedAt: Date.now(),
  };
  compileJobs.set(jobId, job);
  jobBySignature.set(signature, jobId);

  const compile = deps.compileFn ?? compileFromSeed;
  void compile(parsed.data, {
    draftProvider: deps.defaultProvider,
    draftModel: deps.defaultModel,
  }).then((scenario) => {
    const stored = compileJobs.get(jobId);
    if (!stored) return; // Swept out by TTL while still pending — exotic.
    stored.scenario = scenario;
    stored.status = 'done';
    stored.resolvedAt = Date.now();
    deps.setActiveScenario(scenario, parsed.data.seedText);
  }).catch((err: unknown) => {
    const stored = compileJobs.get(jobId);
    if (!stored) return;
    stored.status = 'error';
    stored.error = err instanceof Error ? err.message : String(err);
    stored.resolvedAt = Date.now();
  });

  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jobId, status: 'pending' }));
}

export async function handleCompileFromSeedStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  _deps: QuickstartDeps,
): Promise<void> {
  const parsed = CompileFromSeedStatusSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Invalid status query',
      issues: parsed.error.issues.slice(0, 3).map(i => i.message),
    }));
    return;
  }
  sweepStaleJobs();
  const job = compileJobs.get(parsed.data.jobId);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Compile job not found. It may have expired (10-minute TTL) or never existed.',
    }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jobId: job.jobId,
    status: job.status,
    scenario: job.status === 'done' ? job.scenario : undefined,
    scenarioId: job.status === 'done' ? job.scenario?.id : undefined,
    error: job.status === 'error' ? job.error : undefined,
  }));
}

export async function handleGenerateActors(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: QuickstartDeps,
): Promise<void> {
  const parsed = GenerateActorsSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid payload', issues: parsed.error.issues.slice(0, 3).map(i => i.message) }));
    return;
  }
  const scenario = deps.getScenarioById(parsed.data.scenarioId);
  if (!scenario) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Scenario '${parsed.data.scenarioId}' not found. Compile it via /api/quickstart/compile-from-seed first.` }));
    return;
  }
  try {
    const actors = await generateQuickstartActors(scenario, parsed.data.count, {
      provider: deps.defaultProvider,
      model: deps.defaultModel,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ actors }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Actor generation failed: ${String(err)}` }));
  }
}

/**
 * POST /api/quickstart/ground-scenario
 *
 * Runs the deep-research grounding pass over a previously-compiled
 * scenario. Returns citations + the ScenarioPackage gets the same
 * citations attached to its `metadata.groundingCitations` slot so the
 * subsequent actor-generation + run prompts can reference them.
 *
 * Returns `{ skipped: true, reason }` rather than 4xx when SERPER_API_KEY
 * isn't configured — the Quickstart flow continues without grounding
 * rather than failing the whole run.
 */
export async function handleGroundScenario(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: QuickstartDeps,
): Promise<void> {
  const parsed = GroundScenarioSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid payload', issues: parsed.error.issues.slice(0, 3).map(i => i.message) }));
    return;
  }
  const scenario = deps.getScenarioById(parsed.data.scenarioId);
  if (!scenario) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Scenario '${parsed.data.scenarioId}' not found. Compile it via /api/quickstart/compile-from-seed first.` }));
    return;
  }
  try {
    const result: GroundingResult | null = await groundScenario(scenario);
    if (!result) {
      // SERPER_API_KEY missing — skip gracefully so the Quickstart UI
      // can show a single "skipped: no API key" line instead of breaking
      // the run.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skipped: true, reason: 'SERPER_API_KEY not configured' }));
      return;
    }
    // Stash citations under the scenario id so future actor-generation
    // and narration prompts can read them. ScenarioPackage doesn't have
    // a free-form metadata slot today; this in-memory side-channel is
    // intentionally scoped to the server process so a restart drops
    // citations along with the scenario itself.
    deps.recordGroundingCitations?.(scenario.id, result.citations);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      citations: result.citations,
      totalSources: result.totalSources,
      durationMs: result.durationMs,
      emptyQueries: result.emptyQueries,
      providersUsed: result.providersUsed,
      providersFailed: result.providersFailed,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Grounding failed: ${String(err)}` }));
  }
}

/**
 * POST /api/quickstart/simulate-intervention
 *
 * Synchronous digital-twin run: applies a SubjectConfig + InterventionConfig
 * to a leader against the corporate-quarterly scenario and returns the
 * full RunArtifact JSON. Drives the dashboard's Digital Twin tab.
 *
 * Behaviour:
 * - If `scenarioId` is provided, resolves it via deps.getScenarioById.
 * - Otherwise calls deps.getDigitalTwinWorld() which lazily compiles
 *   corporate-quarterly.json and caches the WorldModel.
 * - Leader defaults to a Cautious Methodical Evaluator HEXACO profile
 *   if the body does not supply one.
 * - Options default to maxTurns=2, seed=11, costPreset='economy' so a
 *   single intervention run completes in ~30-90s on prod.
 *
 * Response shape: `{ artifact, durationMs }` on success.
 */
export async function handleSimulateIntervention(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: QuickstartDeps,
): Promise<void> {
  const parsed = SimulateInterventionSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Invalid simulate-intervention payload',
      issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`),
    }));
    return;
  }

  const { subject, intervention, leader, scenarioId, options = {} } = parsed.data;

  let world: WorldModel | null = null;
  if (scenarioId) {
    const sc = deps.getScenarioById(scenarioId);
    if (!sc) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Scenario '${scenarioId}' not found.` }));
      return;
    }
    world = WorldModel.fromScenario(sc);
  } else {
    if (!deps.getDigitalTwinWorld) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Digital-twin scenario provider not configured on server.' }));
      return;
    }
    try {
      world = await deps.getDigitalTwinWorld();
    } catch (err) {
      console.error('[simulate-intervention] getDigitalTwinWorld failed:', err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to prepare digital-twin scenario.' }));
      return;
    }
    if (!world) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Digital-twin scenario unavailable. Provide scenarioId or check server config.' }));
      return;
    }
  }

  const effectiveLeader: ActorConfig = leader
    ? { ...leader, unit: leader.unit ?? 'Lab leadership', instructions: leader.instructions ?? '' }
    : DEFAULT_DIGITAL_TWIN_LEADER;

  // Reset the SSE event buffer before broadcasting this run's events so
  // the dashboard's gameState does not interleave them with whatever
  // run came before. /setup does the same thing at its top.
  deps.resetEventBuffer?.();

  // Build an onEvent shim that forwards each typed SimEvent emitted by
  // runSimulation to the SSE broadcast bus. Without it, the dashboard
  // sees nothing until the artifact returns at the bottom of this
  // handler. With it, the SIM tab renders specialist_done /
  // turn_done / decision events as they arrive — the same live feel
  // /setup-driven runs already have. The handler still returns the full
  // artifact synchronously at the end so existing clients
  // (InterventionDemoCard) keep working unchanged.
  const broadcast = deps.broadcast;
  const onEvent = broadcast
    ? (event: { type: string }) => {
        try { broadcast(event.type, event); } catch { /* one bad event must not fail the run */ }
      }
    : undefined;

  const startedAt = Date.now();
  let artifact: RunArtifact;
  try {
    artifact = await world.intervene({
      subject: subject as SubjectConfig,
      intervention: intervention as InterventionConfig,
      actor: effectiveLeader,
      maxTurns: options.maxTurns ?? 2,
      seed: options.seed ?? 11,
      costPreset: options.costPreset ?? 'economy',
      captureSnapshots: false,
      onEvent,
    });
  } catch (err) {
    console.error('[simulate-intervention] intervene failed:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Intervention run failed: ${err instanceof Error ? err.message : String(err)}` }));
    return;
  }
  const durationMs = Date.now() - startedAt;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ artifact, durationMs }));
}
