/**
 * HTTP `POST /simulate` one-shot endpoint (Tier 4 T4.2). Accepts
 * `{ scenario, leader, options }`, returns a full `RunArtifact` JSON.
 * Unblocks curl + Python + third-party dashboards that don't want to
 * speak SSE.
 *
 * Gated behind `PARACOSM_ENABLE_SIMULATE_ENDPOINT=true` so the hosted
 * demo's SSE-first path stays the default. Self-hosted deployments
 * flip the flag on.
 *
 * Extracted from `server-app.ts` so the 8 route tests can inject
 * stub deps instead of booting the full HTTP server.
 *
 * @module paracosm/server/routes/simulate
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ScenarioPackage, ActorConfig, LlmProvider, SimulationModelConfig } from '../../engine/types.js';
import type { RunArtifact } from '../../engine/schema/index.js';
import type { CompileOptions } from '../../engine/compiler/types.js';
import type { KeyPersonnel } from '../../engine/core/agent-generator.js';
import type { CostPreset } from '../../cli/sim-config.js';
import {
  normalizeCredential,
  resolveProviderFromCredentials,
  type ProviderCredentialOptions,
} from '../../engine/provider/credentials.js';

const LeaderSchema = z.object({
  name: z.string().min(1).max(80),
  archetype: z.string().min(1).max(60),
  unit: z.string().min(1).max(80),
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

const SimulateOptionsSchema = z.object({
  maxTurns: z.number().int().min(1).max(12).optional(),
  seed: z.number().int().optional(),
  startTime: z.number().int().optional(),
  captureSnapshots: z.boolean().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  costPreset: z.enum(['quality', 'economy']).optional(),
  seedText: z.string().max(50_000).optional(),
  seedUrl: z.string().url().max(2048).optional(),
}).partial();

export const SimulateRequestSchema = z.object({
  // Scenario payload is the raw JSON that `compileScenario` accepts.
  // The endpoint always runs this through the compiler (cache-by-id
  // keeps repeat calls nearly free) so HTTP callers never need to
  // ship compiled hook code across the wire. We accept an arbitrary
  // record shape and let the compiler's own validation surface any
  // domain errors.
  scenario: z.record(z.string(), z.unknown()).refine(
    s => typeof (s as { id?: unknown }).id === 'string'
      && ((s as { id: string }).id).trim().length > 0,
    { message: 'scenario.id must be a non-empty string' },
  ),
  leader: LeaderSchema,
  options: SimulateOptionsSchema.optional(),
});

export type SimulateRequest = z.infer<typeof SimulateRequestSchema>;

/** What `handleSimulate` returns in the 200 response body. */
export interface SimulateResponse {
  artifact: RunArtifact;
  scenario: ScenarioPackage;
  durationMs: number;
}

/**
 * Options `handleSimulate` forwards to the injected runSimulation.
 * Narrow subset of the full RunOptions; the handler sets `scenario`
 * and leaves key personnel empty.
 *
 * Explicit request credentials travel as data on these options so
 * concurrent /simulate requests do not contend on process.env.
 */
export interface SimulateRunOptions {
  maxTurns?: number;
  seed?: number;
  startTime?: number;
  captureSnapshots?: boolean;
  provider?: LlmProvider;
  costPreset?: CostPreset;
  models?: Partial<SimulationModelConfig>;
  scenario: ScenarioPackage;
  apiKey?: string;
  anthropicKey?: string;
}

/**
 * Injectable deps so unit tests can run without booting the full
 * server or hitting real LLM providers. Production wiring in
 * `server-app.ts` passes the real `compileScenario` + `runSimulation`.
 *
 * BYO-key handling is passed as data from the caller layer. The route
 * handler never mutates process.env.
 */
export interface SimulateDeps {
  /** Compile a raw scenario draft into a runnable ScenarioPackage. */
  compileScenario: (raw: Record<string, unknown>, options: CompileOptions) => Promise<ScenarioPackage>;
  /** Run one leader against a scenario and return a RunArtifact. */
  runSimulation: (leader: ActorConfig, keyPersonnel: KeyPersonnel[], options: SimulateRunOptions) => Promise<RunArtifact>;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

/**
 * Route handler. Returns nothing; writes response on `res`.
 */
export async function handleSimulate(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  deps: SimulateDeps,
  credentials: ProviderCredentialOptions = {},
): Promise<void> {
  const parsed = SimulateRequestSchema.safeParse(body);
  if (!parsed.success) {
    writeJson(res, 400, {
      error: 'invalid request',
      issues: parsed.error.issues.slice(0, 5).map(i => i.message),
    });
    return;
  }

  const { scenario: scenarioInput, leader, options = {} } = parsed.data;
  const cleanCredentials: ProviderCredentialOptions = {
    apiKey: normalizeCredential(credentials.apiKey),
    anthropicKey: normalizeCredential(credentials.anthropicKey),
  };
  const provider = resolveProviderFromCredentials(options.provider, cleanCredentials, 'openai');

  let scenarioPkg: ScenarioPackage;
  try {
    // Always compile. compileScenario caches by id so repeat calls
    // are nearly free, and forcing the server-side compile means we
    // never trust client-supplied hook code.
    scenarioPkg = await deps.compileScenario(scenarioInput, {
      provider,
      seedText: options.seedText,
      seedUrl: options.seedUrl,
      apiKey: cleanCredentials.apiKey,
      anthropicKey: cleanCredentials.anthropicKey,
    });
  } catch (err) {
    // Server-side log with the full stack; client gets a generic
    // message to avoid leaking paths + stack traces.
    console.error('[simulate] compileScenario failed:', err);
    writeJson(res, 502, { error: 'Scenario compile failed' });
    return;
  }

  const startedAt = Date.now();
  let artifact: RunArtifact;
  try {
    artifact = await deps.runSimulation(leader as ActorConfig, [], {
      scenario: scenarioPkg,
      maxTurns: options.maxTurns,
      seed: options.seed,
      startTime: options.startTime,
      captureSnapshots: options.captureSnapshots ?? false,
      provider,
      costPreset: options.costPreset,
      apiKey: cleanCredentials.apiKey,
      anthropicKey: cleanCredentials.anthropicKey,
    });
  } catch (err) {
    console.error('[simulate] runSimulation failed:', err);
    writeJson(res, 500, { error: 'Simulation failed' });
    return;
  }
  const durationMs = Date.now() - startedAt;

  const response: SimulateResponse = { artifact, scenario: scenarioPkg, durationMs };
  writeJson(res, 200, response);
}
