/**
 * Quickstart HTTP routes (Tier 5 onboarding). Three endpoints:
 *
 * - `POST /api/quickstart/fetch-seed`: URL -> extracted main text + title.
 * - `POST /api/quickstart/compile-from-seed`: seedText -> compiled ScenarioPackage.
 * - `POST /api/quickstart/generate-actors`: scenarioId -> ActorConfig[].
 *
 * Each is stateless except for the compiled-scenario install: a
 * successful `compile-from-seed` adds the result to the catalog and makes it
 * the requesting visitor's pick, so their `/setup` POST runs it, and
 * `simulate-intervention`, whose run is its caller's own (it replaces their
 * current run and leaves every other visitor's alone). Routes are
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
import { RunCapacityError, RUN_CAPACITY_RETRY_AFTER_SECONDS } from '../live-runs.js';
import { UrlRefusedError } from '../../engine/compiler/public-url-fetch.js';

/** A run the server opened for a digital-twin request. */
export interface OpenedRun {
  /** The run's key, which its active_scenario event carries. */
  runKey: string;
  /** The visitor the run belongs to. */
  visitorId: string;
  /** Writes one of the run's events; once the run is replaced or cleared, its events go nowhere. */
  broadcast: BroadcastFn;
  /** Releases the run's capacity slot; called once the engine has returned or thrown. */
  finish: () => void;
}

/** The most JSON a Digital Twin subject's free-form profile may hold. */
const MAX_SUBJECT_PROFILE_CHARS = 8000;

/** The answer a route writes when a limit refuses the request. */
export interface QuickstartRefusal {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function writeRefusal(res: ServerResponse, refusal: QuickstartRefusal): void {
  res.writeHead(refusal.status, { 'Content-Type': 'application/json', ...refusal.headers });
  res.end(JSON.stringify(refusal.body));
}

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

/**
 * The longest scenario id the Quickstart routes the page calls after a
 * compile take (generate-actors, ground-scenario): 64 characters, the
 * longest id a compile from a seed gives its draft. The server keeps the id
 * it installs a Quickstart compile under within it.
 */
export const QUICKSTART_SCENARIO_ID_MAX = 64;

const GenerateActorsSchema = z.object({
  scenarioId: z.string().min(3).max(QUICKSTART_SCENARIO_ID_MAX),
  // Max 300 actors per bundle. A hosted demo actor cost 0.29 to 1.05 USD
  // in the pairs measured on 30 October and 1 November 2026; the
  // SeedInput cost preview surfaces the running total so users opt in
  // consciously. The runtime feeds them through the batch runner with
  // an economics-profile concurrency cap (default 8 in batch mode) so
  // 300 actors land as ~38 batches of 8, not 300 simultaneous calls.
  count: z.number().int().min(2).max(300).default(3),
});

const GroundScenarioSchema = z.object({
  scenarioId: z.string().min(3).max(QUICKSTART_SCENARIO_ID_MAX),
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
  profile: z.record(z.string(), z.unknown())
    .refine(profile => JSON.stringify(profile).length <= MAX_SUBJECT_PROFILE_CHARS, {
      message: `profile is over ${MAX_SUBJECT_PROFILE_CHARS} characters of JSON`,
    })
    .optional(),
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
  instructions: z.string().max(400).default(''),
});

const SimulateInterventionSchema = z.object({
  subject: SubjectSchema,
  intervention: InterventionSchema,
  leader: LeaderSchema.optional(),
  scenarioId: z.string().min(3).max(80).optional(),
  /**
   * The key the run opens with. The page that starts the run names it, so
   * it can tell its own run on the shared stream; the answer only comes
   * when the run is over. Absent: the server makes one.
   */
  runKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
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
  /** Installs a compiled scenario into the server catalog and persists it.
   *  It becomes nobody's pick by itself: the visitor who compiled it gets
   *  it through `pickHeaders` on the answers they receive. The optional
   *  `seedText` is the user's original natural-language prompt; the server
   *  keeps it with the scenario so a run's active_scenario event can carry
   *  it through to the session store, which surfaces it on the replay
   *  banner and Replay-Last-Run CTA.
   *
   *  Returns the scenario as installed. The server never replaces a
   *  scenario the compiled id already names, so the installed one can carry
   *  another id (`<id>-2`); the answers report the returned scenario. An
   *  implementation that returns nothing installed the one it was given. */
  installCompiledScenario: (scenario: ScenarioPackage, seedText?: string) => ScenarioPackage | void;
  /** Resolves a scenario id against the server catalog. */
  getScenarioById: (id: string) => ScenarioPackage | undefined;
  /** The headers that make a scenario the requesting visitor's pick (the
   *  paracosm_scenario cookie). Spread into the compile answers that report
   *  a finished scenario. Optional: without it those answers set nothing. */
  pickHeaders?: (scenarioId: string) => Record<string, string>;
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
   * The directory a digital-twin run's output file is written to: the
   * server's runs directory. Omitted, the run writes to
   * `PARACOSM_OUTPUT_DIR` from `process.env`, else `<cwd>/output`.
   */
  outputDir?: string;
  /**
   * Opens the caller's run for a digital-twin request: it replaces their
   * current run, is admitted under the server's run cap (throws
   * RunCapacityError above it), and opens with the run's active_scenario
   * event, which carries `runKey` (the page's key when given). The handler
   * writes the roster and turn count, every event runSimulation emits as a
   * `sim` event tagged with its leader, as the pair runner does, and the run's
   * `complete` through the returned broadcast, so the SIM tab renders live
   * progress while the synchronous fetch is still in flight, and calls
   * `finish` once the engine has returned or thrown. Without it the run still
   * works, but the user sees nothing until the artifact returns.
   */
  openRun?: (scenario: ScenarioPackage, runKey?: string) => OpenedRun | Promise<OpenedRun>;
  /**
   * True when a run has already opened with this key. Pages tell runs apart
   * by key and read each key off the stream, so a request naming a used key
   * would have its run taken for that one.
   */
  isRunKeyUsed?: (runKey: string) => boolean;
  /**
   * Test seam: substitute the actual compile pipeline. Production
   * uses the real `compileFromSeed`; tests can inject a deterministic
   * fake to exercise the async-job state machine without LLM calls.
   */
  compileFn?: typeof compileFromSeed;
  /**
   * Limits for a server that bills the host's keys (the hosted demo).
   * Absent, every route runs as asked. Each refusal function returns the
   * answer to write, or null to go on.
   */
  hostLimits?: {
    /** Charges a new compile-from-seed against the caller's compile limit. */
    admitCompile: () => QuickstartRefusal | null;
    /** The most compile-from-seed jobs pending at once, server-wide. */
    maxPendingCompiles: number;
    /** Charges a grounding, actor or URL request against the caller's Quickstart limit. */
    admitCall: () => QuickstartRefusal | null;
    /** Charges the caller's run of the day; `refund` gives it back when the run cannot open. */
    run: { admit: () => QuickstartRefusal | null; refund: () => void };
    /** The hosted demo's caps on a run: its turns and its leaders. */
    maxTurns: number;
    maxActors: number;
  };
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
  const refused = deps.hostLimits?.admitCall() ?? null;
  if (refused) {
    writeRefusal(res, refused);
    return;
  }
  try {
    const { text, title, sourceUrl } = await deps.fetchSeedFromUrl(url);
    const truncated = text.length > 50_000;
    const finalText = truncated ? text.slice(0, 50_000) : text;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: finalText, title, sourceUrl, truncated }));
  } catch (err) {
    // A URL that names an address the server does not fetch is the
    // caller's to change, as an invalid one is.
    const status = err instanceof UrlRefusedError || (err as Error | null)?.name === 'UrlRefusedError' ? 400 : 502;
    res.writeHead(status, { 'Content-Type': 'application/json' });
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
 * installCompiledScenario); the job map is purely the compile-pipeline
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
      // An admin can have deleted the scenario from the catalog since it
      // compiled, so install it again; the answer makes it this visitor's
      // pick, as the status answer does for the visitor who waited.
      existing.scenario = deps.installCompiledScenario(existing.scenario, parsed.data.seedText) ?? existing.scenario;
      res.writeHead(200, { 'Content-Type': 'application/json', ...deps.pickHeaders?.(existing.scenario.id) });
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

  if (deps.hostLimits) {
    let pending = 0;
    for (const job of compileJobs.values()) if (job.status === 'pending') pending += 1;
    if (pending >= deps.hostLimits.maxPendingCompiles) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({
        error: `The server is compiling ${pending} scenarios right now, the most it compiles at once. Try again in a minute.`,
      }));
      return;
    }
    const refused = deps.hostLimits.admitCompile();
    if (refused) {
      writeRefusal(res, refused);
      return;
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
    // The job reports the scenario as installed, whose id the server may
    // have changed to a free one.
    stored.scenario = deps.installCompiledScenario(scenario, parsed.data.seedText) ?? scenario;
    stored.status = 'done';
    stored.resolvedAt = Date.now();
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
  deps: QuickstartDeps,
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
  // The compile resolved in the background, where no response could carry
  // the visitor's pick; the done answer the polling page receives sets it,
  // so the page it redirects to opens on the scenario it compiled.
  const pick = job.status === 'done' && job.scenario ? deps.pickHeaders?.(job.scenario.id) : undefined;
  res.writeHead(200, { 'Content-Type': 'application/json', ...pick });
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
  const refused = deps.hostLimits?.admitCall() ?? null;
  if (refused) {
    writeRefusal(res, refused);
    return;
  }
  // A hosted run takes at most maxActors leaders, so no more are generated.
  const count = deps.hostLimits ? Math.min(parsed.data.count, deps.hostLimits.maxActors) : parsed.data.count;
  try {
    const actors = await generateQuickstartActors(scenario, count, {
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
  const refused = deps.hostLimits?.admitCall() ?? null;
  if (refused) {
    writeRefusal(res, refused);
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
 * to a leader against the t2d-glp1-protocol scenario and returns the
 * full RunArtifact JSON. Drives the dashboard's Digital Twin card.
 *
 * Behaviour:
 * - If `scenarioId` is provided, resolves it via deps.getScenarioById.
 * - Otherwise calls deps.getDigitalTwinWorld() which lazily compiles
 *   t2d-glp1-protocol.json and caches the WorldModel.
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

  const { subject, intervention, leader, scenarioId, runKey: requestedRunKey, options = {} } = parsed.data;

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

  // Pages tell runs apart by key and read each key off the stream, so a
  // request naming a key a run has had would have that run taken for its own.
  if (requestedRunKey && deps.isRunKeyUsed?.(requestedRunKey)) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'That run key has already opened a run.' }));
    return;
  }
  // On the hosted demo a twin run is the caller's run of the day, as a
  // /setup run is. It is charged before the run opens, in the same step as
  // the check, so concurrent requests cannot all pass the check; a run
  // refused for capacity gives the charge back.
  const runRefused = deps.hostLimits?.run.admit() ?? null;
  if (runRefused) {
    writeRefusal(res, runRefused);
    return;
  }
  // The caller's run, with its own buffer and viewers, so the dashboard's
  // gameState does not interleave it with whatever run came before.
  let run: OpenedRun | null = null;
  try {
    run = deps.openRun ? await deps.openRun(world.scenario, requestedRunKey) : null;
  } catch (err) {
    deps.hostLimits?.run.refund();
    if (err instanceof RunCapacityError) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': String(RUN_CAPACITY_RETRY_AFTER_SECONDS) });
      res.end(JSON.stringify(err.body()));
      return;
    }
    throw err;
  }
  const opened = run;
  const runKey = opened?.runKey ?? requestedRunKey ?? randomUUID();

  // Writes to the run's stream. One bad event must not fail the run.
  const send: BroadcastFn = (event, data, actorId) => {
    if (!opened) return;
    try { opened.broadcast(event, data, actorId); } catch { /* the run goes on */ }
  };

  // The same frames a /setup run writes: the roster and the turn count, each
  // engine event as a `sim` event tagged with its leader, and an end. Without
  // them, the dashboard sees nothing until the artifact returns at the bottom
  // of this handler. The roster and the turn count share one `parallel`
  // frame, which is what marks the run running on the page. The handler still
  // returns the full artifact synchronously at the end, which the Digital
  // Twin card renders.
  // The hosted demo's caps: its turn cap and the economy tier.
  const maxTurns = Math.min(options.maxTurns ?? 2, deps.hostLimits?.maxTurns ?? Number.POSITIVE_INFINITY);
  const costPreset = deps.hostLimits ? 'economy' : options.costPreset ?? 'economy';
  send('status', {
    phase: 'parallel',
    maxTurns,
    actors: [{
      name: effectiveLeader.name,
      archetype: effectiveLeader.archetype,
      unit: effectiveLeader.unit,
      hexaco: effectiveLeader.hexaco,
    }],
  });
  const onEvent = (event: { type: string; leader?: string }) => {
    send('sim', event, event.leader);
  };

  const startedAt = Date.now();
  let artifact: RunArtifact | undefined;
  try {
    try {
      artifact = await world.intervene({
        subject: subject as SubjectConfig,
        intervention: intervention as InterventionConfig,
        actor: effectiveLeader,
        maxTurns,
        seed: options.seed ?? 11,
        costPreset,
        captureSnapshots: false,
        onEvent,
        outputDir: deps.outputDir,
      });
    } catch (err) {
      console.error('[simulate-intervention] intervene failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      send('sim_error', { leader: effectiveLeader.name, error: message }, effectiveLeader.name);
      send('complete', { timestamp: new Date().toISOString(), aborted: true });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Intervention run failed: ${message}` }));
      return;
    }

    // A run the provider stopped or a signal cancelled returns partial
    // results and ends as aborted, as the pair runner ends one.
    const stopped = artifact as RunArtifact & { aborted?: unknown; providerError?: unknown };
    send('complete', {
      timestamp: new Date().toISOString(),
      ...(stopped.aborted === true || stopped.providerError ? { aborted: true } : {}),
    });
  } finally {
    // The engine has returned or thrown: the run's capacity slot is free.
    opened?.finish();
  }
  const durationMs = Date.now() - startedAt;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    artifact,
    durationMs,
    runKey,
    ...(opened ? { visitorId: opened.visitorId } : {}),
  }));
}
