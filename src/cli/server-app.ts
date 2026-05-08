import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, createReadStream } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSimulationConfig, applyDemoCaps, type NormalizedSimulationConfig, type SimulationSetupPayload } from './sim-config.js';
import { runPairSimulations, runForkSimulation, runBatchSimulations, type BroadcastFn } from './pair-runner.js';
import {
  handleFetchSeed, handleCompileFromSeed, handleCompileFromSeedStatus,
  handleGenerateActors, handleGroundScenario, handleSimulateIntervention,
  type QuickstartDeps,
} from './quickstart-routes.js';
import { WorldModel } from '../runtime/world-model/index.js';
import { handleSimulate, type SimulateDeps } from './simulate-route.js';
import { compileScenario as compileScenarioReal } from '../engine/compiler/index.js';
import { marsScenario } from '../engine/mars/index.js';
import { lunarScenario } from '../engine/lunar/index.js';
import type { ScenarioPackage } from '../engine/types.js';
import {
  hasProviderCredentials,
  normalizeCredential,
  resolveProviderFromCredentials,
} from '../engine/provider-credentials.js';
import {
  describeCustomScenarioSource,
  isRunnableScenarioPackage,
  loadDiskCustomScenarios,
} from './custom-scenarios.js';
import { IpRateLimiter } from './rate-limiter.js';
import {
  aggregateSchemaRetries,
  aggregateForgeStats,
  aggregateCacheStats,
  aggregateProviderErrors,
  type PerRunSchemaRetries,
  type PerRunForgeStats,
  type PerRunCacheStats,
  type PerRunProviderErrors,
} from './retry-stats.js';
import { createCompilerTelemetry, type CompilerTelemetry } from '../engine/compiler/telemetry.js';
import { openSessionStore, type SessionStore, type TimestampedEvent } from './session-store.js';
import { generateSessionTitle } from './session-title.js';
import { resolveServerMode } from './server/server-mode.js';
import { createRunRecord, hashActorConfig } from './server/run-record.js';
import { enrichRunRecordFromArtifact } from './server/enrich-run-record.js';
import { createNoopRunHistoryStore, type RunHistoryStore } from './server/run-history-store.js';
import { createSqliteRunHistoryStore } from './server/sqlite-run-history-store.js';
import { createWaitlistStore, type WaitlistStore } from './server/waitlist-store.js';
import { handleWaitlist } from './server/waitlist-route.js';
import { sendEmail } from './server/email.js';
import { handlePublicDemoRoute } from './server/routes/public-demo.js';
import { handlePlatformApiRoute } from './server/routes/platform-api.js';
import { validateForkSetupPreconditions } from './fork-preconditions.js';
import { fetchSeedFromUrl } from './fetch-seed-url.js';

function projectScenarioForClient(sc: ScenarioPackage) {
  return {
    id: sc.id,
    version: sc.version,
    labels: sc.labels,
    theme: sc.theme,
    setup: sc.setup,
    departments: sc.departments.map(d => ({ id: d.id, label: d.label, role: d.role, icon: d.icon })),
    presets: sc.presets,
    ui: sc.ui,
    policies: {
      // Compiled scenarios can express policies either as
      // { toolForging: true } (boolean shorthand) or as
      // { toolForging: { enabled: true } } (object with flags).
      // The server crashed with "Cannot read properties of
      // undefined (reading 'enabled')" on the shorthand form.
      // Defensive reader handles both shapes and missing entries.
      toolForging: typeof sc.policies?.toolForging === 'object'
        ? Boolean((sc.policies.toolForging as { enabled?: boolean }).enabled)
        : Boolean(sc.policies?.toolForging),
      bulletin: typeof sc.policies?.bulletin === 'object'
        ? Boolean((sc.policies.bulletin as { enabled?: boolean }).enabled)
        : Boolean(sc.policies?.bulletin),
      characterChat: typeof sc.policies?.characterChat === 'object'
        ? Boolean((sc.policies.characterChat as { enabled?: boolean }).enabled)
        : Boolean(sc.policies?.characterChat),
    },
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolved paracosm version from package.json (for docs header and API responses). */
const PARACOSM_VERSION: string = (() => {
  try {
    const pkgPath = resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;

  constructor(maxBytes: number) {
    super(`Request body too large. Maximum ${maxBytes} bytes.`);
  }
}

function writeJsonError(res: ServerResponse, error: unknown, fallbackStatus = 400): void {
  const status = error instanceof RequestBodyTooLargeError
    ? error.statusCode
    : fallbackStatus;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: String(error) }));
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    let receivedBytes = 0;
    let settled = false;
    let tooLarge = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (tooLarge) return;
      receivedBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk));
      if (receivedBytes > maxBytes) {
        tooLarge = true;
        body = '';
        fail(new RequestBodyTooLargeError(maxBytes));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolveBody(body);
    });
    req.on('error', fail);
  });
}

export interface CreateMarsServerOptions {
  env?: NodeJS.ProcessEnv;
  runPairSimulations?: (
    config: NormalizedSimulationConfig,
    broadcast: BroadcastFn,
    signal?: AbortSignal,
    scenario?: ScenarioPackage,
    onArtifact?: (
      artifact: import('../engine/schema/index.js').RunArtifact,
      leader: import('../runtime/orchestrator.js').ActorConfig,
    ) => void | Promise<void>,
  ) => Promise<void>;
  generateText?: (args: { provider: string; model: string; prompt: string }) => Promise<{ text: string }>;
  compileScenario?: (scenarioJson: Record<string, unknown>, options: Record<string, unknown>) => Promise<ScenarioPackage>;
  scenarioDir?: string;
  /** Max simulations per IP per day. 0 = unlimited. Default: 3. Set via RATE_LIMIT env var. */
  maxSimsPerDay?: number;
  /**
   * Grace period (ms) between the last SSE client disconnecting and the
   * server cancelling the active simulation. Default 30_000ms (30s),
   * which covers the common case of a user clicking an internal link
   * (e.g. /docs, /, another dashboard tab that triggers a full page
   * navigation) and returning within half a minute. Shorter values
   * (the previous 1500ms) surfaced "Interrupted" badges on routine
   * in-domain navigation — a bad tradeoff, since the per-LLM-call
   * abort gates in the orchestrator already cap the worst-case
   * wasted-spend at a single in-flight call regardless of how long
   * the grace window is.
   */
  disconnectGraceMs?: number;
  /**
   * Override the stale-buffer threshold. The on-startup and runtime
   * gates drop the eventBuffer when its last activity was more than
   * this many milliseconds ago. Production default is 30 minutes;
   * tests inject a small value (e.g. 100ms) to exercise the gate
   * without waiting half an hour.
   */
  staleBufferMs?: number;
  /**
   * Override the session store instance. Intended for tests; the
   * default production path opens a SQLite store at
   * `${APP_DIR}/data/sessions.db`.
   */
  sessionStore?: SessionStore;
  runHistoryStore?: RunHistoryStore;
  /** Maximum accepted HTTP request body size. Defaults to 5 MiB. */
  maxRequestBodyBytes?: number;
}

/**
 * Optional hooks the /setup handler can pass to startWithConfig so that
 * per-artifact post-flight work (Library-tab record persistence, future
 * webhook notifications, etc.) can run with /setup-handler scope (which
 * is where hasUserKeys, the runRecord base, and the active scenario
 * already live).
 */
export interface StartConfigHooks {
  /**
   * Fired once per completed leader artifact. Failures inside the hook
   * are caught and logged by the runner; they do not abort the run.
   */
  onArtifact?: (
    artifact: import('../engine/schema/index.js').RunArtifact,
    leader: import('../runtime/orchestrator.js').ActorConfig,
  ) => void | Promise<void>;
}

export interface MarsServer extends Server {
  startWithConfig: (config: NormalizedSimulationConfig, hooks?: StartConfigHooks) => Promise<void>;
}

/**
 * Resolve the production run-history store. SQLite by default at
 * `${APP_DIR}/data/runs.db`; env override `PARACOSM_RUN_HISTORY_DB_PATH`.
 * Set `PARACOSM_DISABLE_RUN_HISTORY=1` to fall back to the noop store
 * (useful for ephemeral test environments and CLI smoke tests).
 */
function resolveRunHistoryStore(env: NodeJS.ProcessEnv): RunHistoryStore {
  if (env.PARACOSM_DISABLE_RUN_HISTORY === '1') {
    return createNoopRunHistoryStore();
  }
  const dbPath = env.PARACOSM_RUN_HISTORY_DB_PATH
    ?? resolve(env.APP_DIR || '.', 'data', 'runs.db');
  return createSqliteRunHistoryStore({ dbPath });
}

export function buildResultsPayloadFromEventBuffer(eventBuffer: readonly string[]) {
  const simEvents = eventBuffer
    .filter(msg => msg.startsWith('event: sim\n') || msg.startsWith('event: result\n') || msg.startsWith('event: verdict\n') || msg.startsWith('event: complete\n'))
    .map(msg => {
      const lines = msg.split('\n');
      const eventType = lines[0]?.replace('event: ', '') || '';
      try { return { event: eventType, data: JSON.parse(lines[1]?.replace('data: ', '') || '{}') }; }
      catch { return { event: eventType, data: {} }; }
    });
  const results = simEvents.filter(e => e.event === 'result').map(e => e.data);
  const verdict = simEvents.find(e => e.event === 'verdict')?.data || null;
  const isComplete = simEvents.some(e => e.event === 'complete');
  const turns = simEvents.filter(e => e.event === 'sim' && e.data?.type === 'turn_start').length / 2;

  // Reconstruct per-leader timelines from the sim event stream.
  // Group every sim event by leader name, then bucket interesting
  // payload types into typed lists so consumers can pull turn-by-turn
  // crisis info, dept reports, decisions, forges, citations, reactions.
  const byLeader = new Map<string, {
    events: Array<{ turn?: number; time?: number; eventIndex?: number; title?: string; category?: string; description?: string; emergent?: boolean }>;
    decisions: Array<{ turn?: number; time?: number; eventIndex?: number; decision?: string; rationale?: string; selectedPolicies?: unknown[]; outcome?: string }>;
    forges: Array<Record<string, unknown>>;
    citations: Array<{ text?: string; url?: string; doi?: string; department?: string; turn?: number }>;
    deptReports: Array<{ turn?: number; time?: number; eventIndex?: number; department?: string; summary?: string; risks?: unknown[]; recommendedActions?: unknown[]; citations?: number; toolCount?: number }>;
    agentReactions: Array<{ turn?: number; time?: number; reactions?: unknown[]; totalReactions?: number }>;
    promotions: Array<Record<string, unknown>>;
    systemsSnapshots: Array<Record<string, unknown>>;
  }>();
  const ensureLeader = (name: string) => {
    if (!byLeader.has(name)) byLeader.set(name, { events: [], decisions: [], forges: [], citations: [], deptReports: [], agentReactions: [], promotions: [], systemsSnapshots: [] });
    return byLeader.get(name)!;
  };
  // Track decision pending state so we can attach it to outcomes per event.
  const pendingDecision = new Map<string, { decision?: string; rationale?: string; selectedPolicies?: unknown[] }>();
  for (const e of simEvents) {
    if (e.event !== 'sim') continue;
    const inner = e.data as Record<string, unknown>;
    const type = String(inner.type || '');
    const leader = String(inner.leader || '');
    if (!leader) continue;
    const slot = ensureLeader(leader);
    const data = (inner.data as Record<string, unknown>) ?? {};
    const turn = data.turn as number | undefined;
    const time = data.time as number | undefined;
    const eventIndex = data.eventIndex as number | undefined;
    const pendKey = `${leader}-${turn}-${eventIndex ?? 0}`;
    if (type === 'event_start') {
      slot.events.push({ turn, time, eventIndex, title: data.title as string, category: data.category as string, description: data.description as string, emergent: data.emergent as boolean });
    } else if (type === 'turn_start' && data.title && data.title !== 'Director generating...') {
      slot.events.push({ turn, time, title: data.title as string, category: data.category as string, description: data.crisis as string, emergent: data.emergent as boolean });
    } else if (type === 'decision_made') {
      pendingDecision.set(pendKey, {
        decision: data.decision as string,
        rationale: data.rationale as string,
        selectedPolicies: data.selectedPolicies as unknown[],
      });
    } else if (type === 'outcome') {
      const p = pendingDecision.get(pendKey);
      slot.decisions.push({ turn, time, eventIndex, ...p, outcome: data.outcome as string });
      pendingDecision.delete(pendKey);
    } else if (type === 'specialist_done') {
      const dept = data.department as string;
      const cites = (data.citationList as Array<{ text?: string; url?: string; doi?: string }>) || [];
      slot.deptReports.push({
        turn, time, eventIndex, department: dept,
        summary: data.summary as string,
        risks: data.risks as unknown[],
        recommendedActions: data.recommendedActions as unknown[],
        citations: cites.length,
        toolCount: Array.isArray(data.forgedTools) ? (data.forgedTools as unknown[]).length : 0,
      });
      for (const c of cites) {
        slot.citations.push({ ...c, department: dept, turn });
      }
    } else if (type === 'forge_attempt') {
      slot.forges.push({ turn, time, eventIndex, ...data });
    } else if (type === 'agent_reactions') {
      slot.agentReactions.push({ turn, time, reactions: data.reactions as unknown[], totalReactions: data.totalReactions as number });
    } else if (type === 'promotion') {
      slot.promotions.push({ ...data });
    } else if (type === 'systems_snapshot') {
      slot.systemsSnapshots.push({ turn, time, ...data });
    }
  }
  const actors = [...byLeader.entries()].map(([name, slot]) => ({ name, ...slot }));

  return {
    results,
    verdict,
    isComplete,
    turnsCompleted: Math.floor(turns),
    totalEvents: simEvents.length,
    actors,
  };
}

export function createMarsServer(options: CreateMarsServerOptions = {}): MarsServer {
  const env = options.env ?? process.env;
  const serverMode = resolveServerMode(env);
  // Rate limit default: 1 simulation per IP per day for the public-demo
  // path. Even on DEMO_MODELS + DEMO_EXECUTION a run costs ~$0.40 against
  // the host's keys, so 1/day caps worst-case monthly spend at roughly
  // $30 × unique-daily-IPs. Users who want more runs provide their own
  // key, which fully bypasses rate limiting. Override with RATE_LIMIT
  // env var or maxSimsPerDay option when hosting on your own infra.
  const maxSims = options.maxSimsPerDay ?? parseInt(env.RATE_LIMIT || '1', 10);
  const adminWrite = (env.ADMIN_WRITE || 'false').toLowerCase() === 'true';
  // Per-request token gate for /admin/* routes. When ADMIN_WRITE=true,
  // ADMIN_TOKEN must be set to a non-empty secret (paracosm fails the
  // request closed otherwise). The dashboard's Wipe All path sends
  // the token via the `X-Admin-Token` header (read from localStorage,
  // matches the existing key-overrides pattern). Operators set
  // ADMIN_TOKEN once in /opt/paracosm/.env; the dashboard pastes it
  // once into Settings. Drive-by visitors get 401.
  const adminToken = (env.ADMIN_TOKEN || '').trim();
  const requireAdminToken = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!adminWrite) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ADMIN_WRITE not enabled on this server' }));
      return false;
    }
    if (!adminToken) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'ADMIN_TOKEN must be set in the server env when ADMIN_WRITE=true. ' +
               'Without it /admin/* routes are unreachable on purpose — open admin endpoints with no per-request auth would let any visitor wipe data.',
      }));
      return false;
    }
    const headerToken = String(req.headers['x-admin-token'] ?? '').trim();
    if (!headerToken || headerToken !== adminToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing X-Admin-Token header' }));
      return false;
    }
    return true;
  };
  const parsedMaxRequestBodyBytes = Number.parseInt(env.MAX_REQUEST_BODY_BYTES || '', 10);
  const defaultMaxRequestBodyBytes = Number.isFinite(parsedMaxRequestBodyBytes)
    ? parsedMaxRequestBodyBytes
    : 5 * 1024 * 1024;
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? defaultMaxRequestBodyBytes;
  const scenarioDir = options.scenarioDir ?? resolve(__dirname, '..', '..', 'scenarios');
  // Rate-limit state survives pm2 restarts via a JSON file alongside
  // the repo. Without this, a restart gives every blocked IP a full
  // fresh quota. APP_DIR is the install location on the Linode
  // (/opt/paracosm); dev runs default to `.` so the cache file lands
  // next to the project root.
  const rateLimitStatePath = resolve(env.APP_DIR || '.', '.rate-limit.json');
  // Per-IP /chat cap (hourly). Each chat fires a 1k-2k token LLM call
  // against the host key — 30 messages/hr is enough for a real user
  // exploring colonist conversations, well under host-budget noise.
  // Override with CHAT_RATE_LIMIT env var if a local fork wants more.
  const chatPerHour = parseInt(env.CHAT_RATE_LIMIT || '30', 10);
  // Global /chat cap (hourly, across all IPs). Defends against IP
  // rotation: even if an attacker burns a fresh per-IP quota every
  // request via a proxy pool, they can't exceed the aggregate budget
  // for the host's chat traffic. 500/hr ≈ $1-2 worst-case host spend
  // per hour. Override via CHAT_RATE_LIMIT_GLOBAL.
  const chatGlobalPerHour = parseInt(env.CHAT_RATE_LIMIT_GLOBAL || '500', 10);
  const rateLimiter = maxSims > 0
    ? new IpRateLimiter(maxSims, 5, chatPerHour, rateLimitStatePath, chatGlobalPerHour)
    : null;

  // Concurrent-/chat limiter: hard cap on in-flight LLM calls. Stops
  // a burst of N parallel POSTs from spawning N parallel LLM calls
  // before any per-IP / global counter has had a chance to throw.
  // Excess requests get a 429 (clients can retry); we don't queue
  // because long queues hide the back-pressure from clients.
  const chatConcurrencyCap = parseInt(env.CHAT_CONCURRENCY || '4', 10);
  let chatInflight = 0;

  // Output retention: sweep simulation output JSON older than
  // OUTPUT_RETENTION_DAYS on boot. /opt/paracosm/output/ otherwise
  // grows unbounded (~300KB per run × N daily runs = GB over months).
  // Default 30 days. Set to 0 to disable the sweep. Non-fatal on any
  // filesystem error — missing dir is fine, permission denied is
  // logged once and skipped.
  (() => {
    const retentionDays = parseInt(env.OUTPUT_RETENTION_DAYS || '30', 10);
    if (retentionDays <= 0) return;
    const outputDir = resolve(env.APP_DIR || resolve(__dirname, '..', '..'), 'output');
    if (!existsSync(outputDir)) return;
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      for (const name of readdirSync(outputDir)) {
        if (!name.endsWith('.json')) continue;
        const full = resolve(outputDir, name);
        try {
          const stat = statSync(full);
          if (stat.mtimeMs < cutoffMs) {
            unlinkSync(full);
            removed++;
          }
        } catch { /* skip unreadable entry */ }
      }
      if (removed > 0) {
        console.log(`  [retention] Pruned ${removed} sim output files older than ${retentionDays} days from ${outputDir}`);
      }
    } catch (err) {
      console.log(`  [retention] Sweep failed: ${err}`);
    }
  })();
  let simConfig: NormalizedSimulationConfig | null = null;
  let simRunning = false;
  let activeScenario: ScenarioPackage = marsScenario;
  // Original natural-language prompt that produced `activeScenario`,
  // when the run originated from compile-from-seed. Threaded through
  // the active_scenario SSE broadcast and into the session store so
  // the replay banner can show users WHAT they prompted, not just a
  // run title and an event count. Reset to null whenever a non-seed
  // scenario gets installed.
  let activeScenarioSeedText: string | null = null;
  // Raw custom scenario JSON payloads authored during this session.
  const memoryScenarios = new Map<string, unknown>();
  // Runnable scenarios that can appear in the catalog and be switched to.
  // Disk-loaded + builtins register into the SAME map so the switch /
  // list / active-derivation code is universal — no hardcoded branches
  // for specific IDs. New builtins ship by adding one more
  // customScenarioCatalog.set(id, { scenario, source: 'builtin' }) here.
  const customScenarioCatalog = loadDiskCustomScenarios(scenarioDir);
  customScenarioCatalog.set(marsScenario.id, { scenario: marsScenario, source: 'builtin' });
  customScenarioCatalog.set(lunarScenario.id, { scenario: lunarScenario, source: 'builtin' });

  // Side-channel for ground-scenario citations keyed by scenario id.
  // ScenarioPackage has no free-form metadata slot today; this Map
  // lives for the lifetime of the server process so a restart drops
  // citations along with the scenario itself. Future actor-generation
  // and narration prompts can read via a sibling helper if we want to
  // ground prompts on the cited sources directly.
  const groundingCitationsByScenarioId = new Map<string, unknown>();

  // Lazily compiled WorldModel for the Digital Twin tab. Backed by
  // scenarios/t2d-glp1-protocol.json — a clinical digital-twin scenario
  // where the subject is a person (Maria Chen, T2D + obesity) and the
  // intervention is a 12-week semaglutide + lifestyle protocol. Metrics
  // are subject-shaped: HbA1c, fasting glucose, weight, BMI, exercise
  // adherence, sleep hours, quality of life, 10-year mortality risk,
  // cardio fitness, side-effect burden.
  //
  // Why patient-twin over org-twin: the canonical "digital twin" most
  // viewers think of is a person under intervention with concrete,
  // measurable outcomes. Patient-twin is the use case the landing page
  // already names (digital-twin medicine), and the metrics — A1c
  // dropping, weight coming off — are unambiguously person-shaped, so
  // the result panel reads as a real digital twin rather than a
  // generic org sim with labels stapled on.
  //
  // The first /api/quickstart/simulate-intervention call compiles and
  // caches; later calls reuse the same WorldModel so a series of
  // digital-twin runs costs one compile.
  let digitalTwinWorld: WorldModel | null = null;
  let digitalTwinCompilePromise: Promise<WorldModel | null> | null = null;
  const getDigitalTwinWorld = (): Promise<WorldModel | null> => {
    if (digitalTwinWorld) return Promise.resolve(digitalTwinWorld);
    if (digitalTwinCompilePromise) return digitalTwinCompilePromise;
    digitalTwinCompilePromise = (async () => {
      const scenarioPath = resolve(scenarioDir, 't2d-glp1-protocol.json');
      if (!existsSync(scenarioPath)) {
        console.log(`  [digital-twin] Scenario file missing: ${scenarioPath}`);
        digitalTwinCompilePromise = null;
        return null;
      }
      try {
        const raw = JSON.parse(readFileSync(scenarioPath, 'utf-8')) as Record<string, unknown>;
        const compiled = await compileScenarioReal(raw, {
          provider: 'openai',
          model: 'gpt-5.4-mini',
          cache: true,
        });
        digitalTwinWorld = WorldModel.fromScenario(compiled);
        console.log(`  [digital-twin] Compiled + cached ${compiled.id} (${compiled.labels?.name ?? 'unnamed'})`);
        return digitalTwinWorld;
      } catch (err) {
        console.error('  [digital-twin] Compile failed:', err);
        digitalTwinCompilePromise = null;
        return null;
      }
    })();
    return digitalTwinCompilePromise;
  };
  // Pre-warm the digital-twin world on server boot so the first user
  // request does not pay the ~30-60s compile inside its response. Cloudflare
  // proxies paracosm.agentos.sh with a 100s gateway timeout, so a cold
  // compile + 2-turn simulation reliably tripped 524 errors. Pre-warming
  // moves the compile off the user's critical path; the cookbook's
  // disk cache means restarts after the first one are nearly free.
  // Fire-and-forget — failure is logged from inside getDigitalTwinWorld
  // and the route handler still surfaces a 503 if the user beats the
  // pre-warm to the request.
  void getDigitalTwinWorld();
  // SSE clients with optional per-actor filter. Map value is the
  // actorId the client subscribed to via /events?actor=<id>, or null
  // for the default "send me everything" subscription. broadcast()
  // filters writes per-client based on this.
  const clients: Map<ServerResponse, string | null> = new Map();

  // Event buffer: stores all broadcast events so new clients can catch up.
  // Persisted to disk so a server restart (CI/CD redeploy, pm2 reload,
  // crash) does not evaporate a completed run from the /chat and /results
  // endpoints, which otherwise would tell users "no simulation data" the
  // moment they navigate away and come back after a deploy.
  //
  // Staleness gate: skip rehydration when the buffer file's mtime is older
  // than STALE_BUFFER_MS. mtime tracks the last broadcast event (every
  // event triggers persistBufferSoon → writeFileSync), so a buffer that
  // hasn't moved in 30 minutes belongs to a run that's terminal in
  // practice — either complete-and-walked-away, aborted-and-walked-away,
  // or crashed-mid-run. Replaying any of those to a fresh visitor surfaces
  // an "Interrupted" badge + stale turn counter + leftover cost meter on
  // the dashboard's first paint, which was the audit's P0 finding.
  // Completed runs the user wants to revisit live in sessions.db via the
  // auto-save path; that store is canonical for replay, the live buffer
  // is not.
  const STALE_BUFFER_MS = options.staleBufferMs ?? 30 * 60 * 1000;
  const eventBufferPath = resolve(env.APP_DIR || '.', '.event-buffer.json');
  const eventBuffer: string[] = (() => {
    try {
      if (existsSync(eventBufferPath)) {
        const ageMs = Date.now() - statSync(eventBufferPath).mtimeMs;
        if (ageMs > STALE_BUFFER_MS) {
          const ageMin = Math.round(ageMs / 60000);
          console.log(`  [event-buffer] Skipping rehydration: buffer is ${ageMin}m old (> ${STALE_BUFFER_MS / 60000}m); fresh visitors get a clean slate`);
          try { unlinkSync(eventBufferPath); } catch { /* best-effort */ }
          return [];
        }
        const raw = readFileSync(eventBufferPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          console.log(`  [event-buffer] Rehydrated ${parsed.length} buffered events from ${eventBufferPath}`);
          return parsed.filter((x: unknown): x is string => typeof x === 'string');
        }
      }
    } catch (err) {
      console.log(`  [event-buffer] Failed to rehydrate (${err}); starting empty`);
    }
    return [];
  })();
  // Parallel array of broadcast wall-clock timestamps. Index-aligned
  // with eventBuffer so /admin/sessions/save can capture per-event
  // pacing for replay. Rehydrated runs (post-deploy) start with no
  // historical timestamps — replay of those would fall back to a
  // fixed inter-event interval. Live runs after the deploy get
  // accurate pacing.
  const eventTimestamps: number[] = new Array(eventBuffer.length).fill(0);
  // Parallel array tracking the actorId each buffered SSE message is
  // attributed to, so /events?actor=<id> replay can filter at the
  // buffer level instead of re-parsing JSON per message. null means
  // "global event" (status, active_scenario, complete, sim_aborted,
  // verdict — anything not scoped to a specific leader). Buffer
  // entries that survive a server restart come back tagged null
  // (rehydrated entries lose their original tag), which is the
  // safest default — they replay to everyone.
  const eventActorIds: Array<string | null> = new Array(eventBuffer.length).fill(null);

  // Bound the live event buffer. At 300 actors × 20 turns the buffer
  // approaches 100k events at ~1-3KB per SSE message — 150MB+ resident
  // in the Node process plus a same-size .event-buffer.json snapshot.
  // Once growth crosses the trim threshold we drop the oldest events
  // FIFO down to the target cap, so live clients keep seeing the most
  // recent N events while late reconnects miss the earliest. Hysteresis
  // (trim 10% above target) amortizes the splice so it runs once per
  // 10k events rather than per-event. Configurable via env to let
  // operators size against their box and typical cohort load.
  const EVENT_BUFFER_MAX_ENTRIES = (() => {
    const raw = env.PARACOSM_EVENT_BUFFER_MAX;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    // Floor at 1 (cap=0 would mean "drop every event" which makes the
    // SSE replay path useless). No upper floor — operators sizing
    // against a small box are free to drop to 5_000 or so.
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 100_000;
  })();
  const EVENT_BUFFER_TRIM_AT = Math.ceil(EVENT_BUFFER_MAX_ENTRIES * 1.1);
  let bufferCapWarned = false;

  // Run-state flags for auto-save on clean completion. Reset inside
  // clearEventBuffer() so the next run starts fresh.
  //
  // AUTO_SAVE_MIN_TURNS floors the run length at one completed turn:
  // accidental clicks never get saved (no turn_done → nothing to replay
  // anyway), but a legitimate 1- or 2-turn run does. The earlier value
  // of 3 silently excluded most hosted-demo runs from the cache ring,
  // which kept the LoadMenu perpetually empty for visitors.
  let currentRunAborted = false;
  let currentRunSaved = false;
  // Set when any actor in the current run emits a `sim_error` event.
  // Auto-save then skips this run so the LoadMenu / Replay-Last-Run
  // CTAs only ever surface clean runs. Without this, a run where one
  // actor blew up mid-turn (LLM API hiccup, rate-limit, schema retry
  // exhaustion) would still get into the ring once turn_done fired
  // for the surviving actor — replay UX then advertised a half-broken
  // session as cached state.
  let currentRunErrored = false;
  const AUTO_SAVE_MIN_TURNS = 1;

  // Persistent storage for completed sim runs. Lives at
  // `${APP_DIR}/data/sessions.db`; the directory is created on first
  // open. Cap of 10 saved sessions; oldest evicts when an admin saves
  // an 11th. The store is opened once at server start so the SQLite
  // handle and prepared statements stay warm across requests.
  let sessionStore: SessionStore | null = options.sessionStore ?? null;
  const sessionsDbPath = resolve(env.APP_DIR || '.', 'data', 'sessions.db');
  if (!sessionStore) try {
    sessionStore = openSessionStore(sessionsDbPath);
    // The store opens its underlying adapter lazily — fire-and-forget
    // an initial count() so we surface the stored-rows hint at boot
    // without forcing createMarsServer itself to be async.
    sessionStore.count()
      .then((n) => console.log(`  [sessions] Opened session store at ${sessionsDbPath} (${n} stored)`))
      .catch((err) => console.log(`  [sessions] Initial count failed: ${err}`));
  } catch (err) {
    // Don't crash the server if SQL backend init fails (missing native binary,
    // disk full, etc) — sims still run, the /sessions and /admin/sessions
    // routes just return 503.
    console.log(`  [sessions] Failed to open session store: ${err}`);
  }
  const runHistoryStore = options.runHistoryStore ?? resolveRunHistoryStore(env);

  // Waitlist store for enterprise-access signups on the landing page.
  // Sync factory; SQLite adapter is built lazily on first POST.
  const waitlistDbPath = resolve(env.APP_DIR || '.', 'data', 'waitlist.db');
  const waitlistStore: WaitlistStore = createWaitlistStore({ dbPath: waitlistDbPath });
  const waitlistFrom = env['WAITLIST_FROM'] || 'Paracosm <team@frame.dev>';

  // Coalesce disk writes so a burst of broadcasts (e.g. 50 forge_attempt
  // events during a turn) only triggers one persist call. 500ms debounce
  // is short enough that a crash loses at most a half-second of events
  // but long enough to avoid thrashing the disk during active runs.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBufferSoon = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        writeFileSync(eventBufferPath, JSON.stringify(eventBuffer));
      } catch (err) {
        console.log(`  [event-buffer] Persist failed: ${err}`);
      }
    }, 500);
  };

  // ── Cross-run schema-retry ring buffer ─────────────────────────────
  //
  // Each completed simulation contributes its `cost.schemaRetries`
  // payload to a rotating ring of the last N runs. The `/retry-stats`
  // endpoint aggregates the ring so operators can answer "is 0.1.228 on
  // Anthropic retrying too much on CommanderDecision?" without replaying
  // individual runs. Persisted to disk so a restart doesn't wipe the
  // telemetry. 100 entries ≈ 2-3 weeks of typical demo traffic.
  const RETRY_RING_MAX = 100;
  const retryRingPath = resolve(env.APP_DIR || '.', '.retry-stats.json');

  // File format v4:
  //   { version: 4, schemas, forges, caches, providerErrors }
  // Prior formats loaded for back-compat:
  //   v1 (bare JSON array) - pre-2026-04-18
  //   v2 (object with schemas + forges) - 2026-04-18 first half
  //   v3 (+ caches) - 2026-04-18 mid
  interface RetryRingFile {
    version: number;
    schemas: PerRunSchemaRetries[];
    forges: PerRunForgeStats[];
    caches: PerRunCacheStats[];
    providerErrors: PerRunProviderErrors[];
  }

  const {
    schemas: retryRing,
    forges: forgeRing,
    caches: cacheRing,
    providerErrors: providerErrorRing,
  } = ((): RetryRingFile => {
    try {
      if (existsSync(retryRingPath)) {
        const raw = readFileSync(retryRingPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return { version: 4, schemas: parsed.slice(-RETRY_RING_MAX), forges: [], caches: [], providerErrors: [] };
        }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.schemas)) {
          return {
            version: 4,
            schemas: parsed.schemas.slice(-RETRY_RING_MAX),
            forges: Array.isArray(parsed.forges) ? parsed.forges.slice(-RETRY_RING_MAX) : [],
            caches: Array.isArray(parsed.caches) ? parsed.caches.slice(-RETRY_RING_MAX) : [],
            providerErrors: Array.isArray(parsed.providerErrors)
              ? parsed.providerErrors.slice(-RETRY_RING_MAX)
              : [],
          };
        }
      }
    } catch { /* start empty on corrupt file */ }
    return { version: 4, schemas: [], forges: [], caches: [], providerErrors: [] };
  })();

  const persistRetryRing = () => {
    try {
      const payload: RetryRingFile = {
        version: 4,
        schemas: retryRing,
        forges: forgeRing,
        caches: cacheRing,
        providerErrors: providerErrorRing,
      };
      writeFileSync(retryRingPath, JSON.stringify(payload));
    } catch (err) { console.log(`  [retry-stats] persist failed: ${err}`); }
  };
  /**
   * Scan the current event buffer back-to-front for the first event
   * whose `_cost` payload carries a `schemaRetries` field. That event
   * has the run's terminal per-schema rollup; earlier events have
   * partial counts. Push to the ring and persist.
   */
  const captureRetrySnapshot = () => {
    let capturedSchemas = false;
    let capturedForges = false;
    let capturedCaches = false;
    let capturedProviderErrors = false;
    const allCaptured = () => capturedSchemas && capturedForges && capturedCaches && capturedProviderErrors;
    for (let i = eventBuffer.length - 1; i >= 0 && !allCaptured(); i--) {
      const msg = eventBuffer[i];
      const dataLine = msg.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(6));
        const cost = payload?.data?._cost;
        if (!cost) continue;
        if (!capturedSchemas && cost.schemaRetries && typeof cost.schemaRetries === 'object') {
          retryRing.push(cost.schemaRetries as PerRunSchemaRetries);
          if (retryRing.length > RETRY_RING_MAX) {
            retryRing.splice(0, retryRing.length - RETRY_RING_MAX);
          }
          capturedSchemas = true;
        }
        if (!capturedForges && cost.forgeStats && typeof cost.forgeStats === 'object') {
          forgeRing.push(cost.forgeStats as PerRunForgeStats);
          if (forgeRing.length > RETRY_RING_MAX) {
            forgeRing.splice(0, forgeRing.length - RETRY_RING_MAX);
          }
          capturedForges = true;
        }
        if (!capturedCaches && cost.cacheStats && typeof cost.cacheStats === 'object') {
          cacheRing.push(cost.cacheStats as PerRunCacheStats);
          if (cacheRing.length > RETRY_RING_MAX) {
            cacheRing.splice(0, cacheRing.length - RETRY_RING_MAX);
          }
          capturedCaches = true;
        }
        if (!capturedProviderErrors && cost.providerErrors && typeof cost.providerErrors === 'object') {
          providerErrorRing.push(cost.providerErrors as PerRunProviderErrors);
          if (providerErrorRing.length > RETRY_RING_MAX) {
            providerErrorRing.splice(0, providerErrorRing.length - RETRY_RING_MAX);
          }
          capturedProviderErrors = true;
        }
      } catch { /* skip malformed buffer entries */ }
    }
    if (capturedSchemas || capturedForges || capturedCaches || capturedProviderErrors) {
      persistRetryRing();
    }
  };

  /**
   * Persist the current run to the session ring when it completes
   * cleanly. Called from inside broadcast() on an `event: complete`
   * frame. Silent no-op when conditions aren't met. Errors are logged
   * but never propagate: a cache write failure must not fail the
   * client-facing broadcast.
   */
  const autoSaveOnComplete = async () => {
    // Every branch logs a single [sessions] line so production can see
    // in server stderr/stdout WHY a run did or did not make it into the
    // ring. Without these, a save silently failing on a writable-but-
    // locked SQLite file (container volume quirk) looked identical to
    // a clean save from outside.
    //
    // Each skip/outcome also fires a `sim_saved` SSE event so the
    // dashboard can surface "saved as <id>" / "save skipped: <reason>"
    // without the user having to SSH the server to find out why the
    // LOAD menu is still empty after a clean run.
    const emitSaveStatus = (status: 'saved' | 'skipped' | 'failed', detail: Record<string, unknown>) => {
      // Call broadcast directly so the client sees the status on the same
      // stream as the rest of the run. Status events are included in the
      // event buffer so a returning user (SSE reconnect + replay) still
      // sees whether the prior run saved.
      try { broadcast('sim_saved', { status, ...detail }); } catch { /* never fail the server on telemetry */ }
    };
    if (!sessionStore) {
      console.log('[sessions] auto-save skipped: session store not initialized');
      emitSaveStatus('skipped', { reason: 'store_not_initialized' });
      return;
    }
    if (currentRunAborted) {
      console.log('[sessions] auto-save skipped: run was aborted');
      emitSaveStatus('skipped', { reason: 'run_aborted' });
      return;
    }
    if (currentRunErrored) {
      console.log('[sessions] auto-save skipped: run had sim_error events');
      emitSaveStatus('skipped', { reason: 'run_errored' });
      return;
    }
    if (currentRunSaved) {
      console.log('[sessions] auto-save skipped: already saved for this run');
      return;
    }
    if (eventBuffer.length === 0) {
      console.log('[sessions] auto-save skipped: empty event buffer');
      emitSaveStatus('skipped', { reason: 'empty_buffer' });
      return;
    }

    // Count completed turns. Two shapes are in play:
    //   1. Legacy / test shape: `broadcast('turn_done', ...)` → frame
    //      line `event: turn_done\n...`.
    //   2. Real production shape: the orchestrator wraps every engine
    //      event in `broadcast('sim', {type: 'turn_done', ...})` →
    //      frame line `event: sim\ndata: {"type":"turn_done",...}`.
    // The prior check only matched shape (1), so every prod run
    // silently skipped with `below_min_turns`. Match either shape.
    const turnDoneCount = eventBuffer.reduce((n, msg) => {
      if (msg.startsWith('event: turn_done\n')) return n + 1;
      if (msg.startsWith('event: sim\n') && msg.includes('"type":"turn_done"')) return n + 1;
      return n;
    }, 0);
    if (turnDoneCount < AUTO_SAVE_MIN_TURNS) {
      console.log(`[sessions] auto-save skipped: turn_done count ${turnDoneCount} below AUTO_SAVE_MIN_TURNS (${AUTO_SAVE_MIN_TURNS})`);
      emitSaveStatus('skipped', { reason: 'below_min_turns', turnDoneCount, minTurns: AUTO_SAVE_MIN_TURNS });
      return;
    }

    // Full-completion gate: only cache runs that played every actor
    // through every scheduled turn. A pair run with `turns: 6` and 2
    // actors should emit 12 turn_done events; if it emits 10 the run
    // bailed early (orchestrator timeout, watchdog disconnect, mid-run
    // crash that did not raise sim_error/sim_aborted) and the cached
    // session would replay a half-finished trajectory. Skip those so
    // the LoadMenu / Replay-Last-Run only ever surfaces full plays.
    //
    // simConfig is non-null here: autoSaveOnComplete is only invoked
    // from inside the broadcast pipeline, which is only set up after
    // /setup wired simConfig. Guard anyway to keep the type checker
    // and the eventual deletion path (when simConfig gets reset to
    // null on /clear) honest.
    const cfg = simConfig;
    if (cfg) {
      const expectedTurnDone = cfg.actors.length * cfg.turns;
      if (expectedTurnDone > 0 && turnDoneCount < expectedTurnDone) {
        console.log(`[sessions] auto-save skipped: turn_done count ${turnDoneCount} below expected ${expectedTurnDone} (${cfg.actors.length} actors × ${cfg.turns} turns) — partial run`);
        emitSaveStatus('skipped', {
          reason: 'partial_completion',
          turnDoneCount,
          expectedTurnDone,
          actors: cfg.actors.length,
          turns: cfg.turns,
        });
        return;
      }
    }

    // Claim the save BEFORE the first await so a synchronous double
    // `complete` broadcast doesn't race past the `currentRunSaved`
    // guard above. The sync better-sqlite3 implementation got this for
    // free because saveSession returned before the next event landed;
    // the async sql-storage-adapter version has to flip the flag up
    // front so re-entrant calls early-return. Stays true on failure
    // (matches sync behavior — throws bubble out of saveSession either
    // way and a doubled `complete` shouldn't trigger a retry).
    currentRunSaved = true;
    try {
      const now = Date.now();
      const events: TimestampedEvent[] = eventBuffer.map((sse, i) => ({
        ts: eventTimestamps[i] || now,
        sse,
      }));
      const result = await sessionStore.saveSession(events);
      const storeCount = await sessionStore.count();
      console.log(`[sessions] auto-saved run ${result.id}: ${events.length} events, ${turnDoneCount} turns (store count: ${storeCount})`);
      emitSaveStatus('saved', {
        id: result.id,
        evictedId: result.evictedId,
        eventCount: events.length,
        turnCount: turnDoneCount,
        totalStored: storeCount,
      });
      // Title-generation pipeline: fire-and-forget nano-tier LLM call
      // off the save hot path. A failed / slow title call must not
      // block the broadcast pipeline, so the promise is intentionally
      // unawaited. Emits a second `sim_saved` event when the title
      // lands so the dashboard can patch its in-memory session list
      // without a round-trip to /sessions.
      const titleProvider = simConfig?.provider === 'anthropic' ? 'anthropic' : 'openai';
      const store = sessionStore; // non-null inside this closure
      void generateSessionTitle(events, titleProvider, runGenerateText).then(async (title) => {
        if (!title) return;
        try {
          await store.updateTitle(result.id, title);
          console.log(`[sessions] titled run ${result.id}: "${title}"`);
          try {
            broadcast('sim_saved', {
              status: 'titled',
              id: result.id,
              title,
            });
          } catch { /* broadcast failure must not crash the title pipeline */ }
        } catch (err) {
          console.warn('[sessions] title update failed:', err);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[sessions] auto-save failed:', err);
      emitSaveStatus('failed', { error: message });
    }
  };

  const broadcast: BroadcastFn = (event, data, actorId) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const tag = actorId ?? null;
    eventBuffer.push(msg);
    eventTimestamps.push(Date.now());
    eventActorIds.push(tag);
    // Bounded-buffer guard. When growth crosses the trim threshold,
    // drop the oldest events FIFO so the array reverts to the target
    // cap. Live clients only see future events; reconnect-after-trim
    // is the only client that loses anything (it misses the dropped
    // prefix). Splice is O(n) so we hysteresis-trim by 10% to amortize.
    if (eventBuffer.length > EVENT_BUFFER_TRIM_AT) {
      const drop = eventBuffer.length - EVENT_BUFFER_MAX_ENTRIES;
      eventBuffer.splice(0, drop);
      eventTimestamps.splice(0, drop);
      eventActorIds.splice(0, drop);
      if (!bufferCapWarned) {
        console.warn(
          `[event-buffer] Capped at ${EVENT_BUFFER_MAX_ENTRIES} events; dropped oldest ${drop}. ` +
          `Late reconnects on this run will miss the dropped prefix. ` +
          `Bump PARACOSM_EVENT_BUFFER_MAX to widen.`,
        );
        bufferCapWarned = true;
      }
    }
    persistBufferSoon();
    for (const [res, filter] of clients) {
      // Filter contract: client subscribed without ?actor= sees
      // everything (filter null). Client subscribed to ?actor=X
      // sees global events (tag null) AND events tagged with X.
      // Events tagged with a different actor are dropped for that
      // client.
      if (filter !== null && tag !== null && tag !== filter) continue;
      try {
        res.write(msg);
      } catch {
        clients.delete(res);
      }
    }
    if (event === 'sim_aborted') {
      currentRunAborted = true;
    }
    if (event === 'sim_error') {
      currentRunErrored = true;
    }
    // On simulation completion, snapshot the run's schema-retry payload
    // to the cross-run ring buffer so /retry-stats can aggregate across
    // production runs. We pull schemaRetries from the MOST RECENT cost
    // payload observed in the current event buffer; the orchestrator
    // emits it on every SSE event, so the last event has the complete
    // picture.
    if (event === 'complete') {
      captureRetrySnapshot();
      autoSaveOnComplete().catch((err) => {
        console.error('[sessions] auto-save failed:', err);
      });
    }
  };

  /**
   * Clear the in-memory event buffer AND remove the persisted snapshot on
   * disk. Without the disk drop, /clear (or a new /setup that resets the
   * buffer) would leave the old run's events on disk; a subsequent server
   * restart would rehydrate them and overwrite what the user expected to
   * be a fresh state. Cancels any pending write so the empty state wins.
   */
  const clearEventBuffer = () => {
    currentRunAborted = false;
    currentRunSaved = false;
    currentRunErrored = false;
    eventBuffer.length = 0;
    eventTimestamps.length = 0;
    eventActorIds.length = 0;
    // Reset the once-per-run "buffer capped" warning so the next large
    // cohort run logs its own first-trim notice instead of staying
    // silent because a previous run already tripped the flag.
    bufferCapWarned = false;
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      if (existsSync(eventBufferPath)) unlinkSync(eventBufferPath);
    } catch { /* nothing to clean up */ }
  };

  const startSimulations = options.runPairSimulations ?? runPairSimulations;

  // --- Cancel-on-disconnect watchdog ---------------------------------
  //
  // While a simulation is active, watch for the SSE client set going
  // empty. If it stays empty for `disconnectGraceMs`, abort the run so
  // the server stops burning API credits on work nobody is watching.
  //
  // The event buffer stays intact: a returning user reconnects, sees
  // all events up to the cancellation point, and the dashboard labels
  // the run "Unfinished" via the sim_aborted SSE event the orchestrator
  // emits on cancel.
  //
  // Grace period handles the legitimate refresh / in-domain navigation
  // case: EventSource disconnects briefly, then reconnects. The default
  // 30_000ms (30s) covers a user clicking an internal link (e.g. the
  // About tab, which redirects to `/`) and returning within half a
  // minute — the previous 1500ms surfaced "Interrupted" badges whenever
  // the user navigated away and back. Combined with the per-LLM-call
  // abort gates in the orchestrator (runtime/orchestrator.ts), at most
  // one in-flight call finishes after the watchdog trips regardless of
  // how long the grace window is, so widening it has no worst-case
  // wasted-spend cost.
  const disconnectGraceMs = options.disconnectGraceMs ?? 30_000;
  /** Current sim's AbortController, or null when no sim is running. */
  let activeSimAbortController: AbortController | null = null;
  /** Timer id for the pending disconnect-watchdog fire. Null when disarmed. */
  let disconnectWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const armDisconnectWatchdog = () => {
    if (!activeSimAbortController) return; // no sim running, nothing to cancel
    if (disconnectWatchdogTimer) return;   // already armed
    disconnectWatchdogTimer = setTimeout(() => {
      disconnectWatchdogTimer = null;
      if (!activeSimAbortController) return;
      if (clients.size > 0) return; // somebody reconnected just in time
      console.log(`  [watchdog] No SSE clients for ${disconnectGraceMs}ms — aborting active simulation.`);
      activeSimAbortController.abort();
    }, disconnectGraceMs);
  };
  const disarmDisconnectWatchdog = () => {
    if (disconnectWatchdogTimer) {
      clearTimeout(disconnectWatchdogTimer);
      disconnectWatchdogTimer = null;
    }
  };
  const runGenerateText = options.generateText ?? (async args => {
    const { generateText } = await import('@framers/agentos');
    return generateText(args as any);
  });
  const runCompileScenario = options.compileScenario ?? (async (scenarioJson, compileOptions) => {
    const { compileScenario } = await import('../engine/compiler/index.js');
    return compileScenario(scenarioJson, compileOptions as any);
  });

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
  };

  const server = createServer(async (req, res) => {
    // CORS preflight for browser-based POST requests (compile, setup, chat, clear)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (handlePublicDemoRoute(serverMode, req, res, corsHeaders)) {
      return;
    }
    const runHistoryRoutesDefault = serverMode !== 'hosted_demo';
    const runHistoryEnvFlag = (env.PARACOSM_ENABLE_RUN_HISTORY_ROUTES ?? '').toLowerCase();
    const paracosmRoutesEnabled =
      runHistoryEnvFlag === 'true' ? true :
      runHistoryEnvFlag === 'false' ? false :
      runHistoryRoutesDefault;

    // Bundle + Library-import handlers run BEFORE handlePlatformApiRoute
    // because that handler's "unknown_platform_route" 404 fires for any
    // /api/v1/* path it doesn't recognize — including these. Without
    // this ordering the Compare modal showed
    // 'Failed to load bundle: HTTP 404 unknown_platform_route' on every
    // bundle fetch, even though a perfectly good bundle handler lived
    // 30 lines further down.
    if (paracosmRoutesEnabled && req.url === '/api/v1/library/import' && req.method === 'POST') {
      if (!runHistoryStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Run-history store disabled' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const { handleLibraryImport } = await import('./server/library-import-route.js');
        await handleLibraryImport(req, res, body, { runHistoryStore, sourceMode: serverMode });
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Compare-runs UI: bundle endpoints. /api/v1/bundles/:id and
    // /api/v1/bundles/:id/aggregate are read-only views over the
    // RunHistoryStore. Same gating as platform-api routes below.
    if (paracosmRoutesEnabled && req.url?.startsWith('/api/v1/bundles/') && req.method === 'GET') {
      const match = req.url.match(/^\/api\/v1\/bundles\/([^/?]+)(\/aggregate)?(\?.*)?$/);
      if (!match) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Invalid bundle URL' }));
        return;
      }
      const bundleId = decodeURIComponent(match[1]);
      const isAggregate = !!match[2];
      const { handleListBundle, handleBundleAggregate } = await import('./bundle-routes.js');
      try {
        if (isAggregate) await handleBundleAggregate(bundleId, res, { runHistoryStore });
        else await handleListBundle(bundleId, res, { runHistoryStore });
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    if (await handlePlatformApiRoute(req, res, {
      runHistoryStore,
      corsHeaders,
      paracosmRoutesEnabled,
      scenarioLookup: (id) => customScenarioCatalog.get(id)?.scenario,
    })) {
      return;
    }

    if (req.url === '/events' || req.url?.startsWith('/events?')) {
      // Per-actor channel: /events?actor=<leaderName> filters the
      // stream to events tagged with that leader plus all global
      // events (status, active_scenario, complete, etc.). The default
      // /events with no query param keeps the legacy "send me
      // everything" behavior so the constellation, distribution
      // panel, and table still receive the full stream.
      let actorFilter: string | null = null;
      if (req.url?.includes('?')) {
        try {
          const parsed = new URL(req.url, 'http://localhost');
          const a = parsed.searchParams.get('actor');
          if (a && a.trim().length > 0) actorFilter = a.trim();
        } catch {
          // Malformed URL — fall through with no filter (safest).
        }
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ actorFilter })}\n\n`);
      // Stale-buffer gate: when this is the first reconnect after a long
      // idle and the buffer hasn't moved in over STALE_BUFFER_MS, the run
      // it represents is terminal in practice (user closed the tab,
      // watchdog aborted, cost meter froze). Replaying that to a fresh
      // visitor surfaces an "Interrupted" badge + frozen turn counter as
      // their first paint. Drop the buffer so they get the empty state
      // instead. Active runs (clients still connected, or a recent
      // broadcast) keep replaying as before.
      //
      // Concurrency invariant: this gate, the replay loop below, and the
      // `clients.add(res)` call all execute synchronously on a single
      // Node turn — there is no `await` between them. Two simultaneous
      // /events requests cannot interleave inside this block, so the
      // worst case for concurrent fresh visitors is two redundant calls
      // to clearEventBuffer() (idempotent: the second is a no-op against
      // an already-emptied array). Do NOT introduce an `await` between
      // here and `clients.add(res)` without re-evaluating this.
      if (clients.size === 0 && eventBuffer.length > 0) {
        const lastTs = eventTimestamps[eventTimestamps.length - 1] || 0;
        if (lastTs > 0 && Date.now() - lastTs > STALE_BUFFER_MS) {
          const ageMin = Math.round((Date.now() - lastTs) / 60000);
          console.log(`  [event-buffer] Dropping stale buffer on first reconnect: last event ${ageMin}m ago (> ${STALE_BUFFER_MS / 60000}m)`);
          clearEventBuffer();
        }
      }
      // Replay all buffered events so new clients catch up. The trailing
      // `replay_done` marker lets the client distinguish historical-buffer
      // events from truly live ones so toasts (transient per-event
      // notifications) only fire for events that arrive AFTER the user
      // reached the page, never for the replay of a prior run.
      for (let i = 0; i < eventBuffer.length; i++) {
        // Replay-time filtering: skip events tagged with a different
        // actor when the client subscribed with ?actor=. Untagged
        // (global) events always replay so the dashboard's run
        // metadata (active_scenario, status) reaches per-actor
        // subscribers.
        const tag = eventActorIds[i] ?? null;
        if (actorFilter !== null && tag !== null && tag !== actorFilter) continue;
        try { res.write(eventBuffer[i]); } catch { break; }
      }
      try { res.write('event: replay_done\ndata: {}\n\n'); } catch {}
      clients.set(res, actorFilter);
      // Reconnection cancels any pending disconnect watchdog fire so
      // the sim keeps running once the returning user is watching again.
      disarmDisconnectWatchdog();
      req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0) {
          // Start (or re-start) the grace-period countdown. If no
          // client reconnects before it fires, the watchdog aborts
          // the active sim.
          armDisconnectWatchdog();
        }
      });
      return;
    }

    if (req.url === '/scenario' && req.method === 'GET') {
      const payload = JSON.stringify(projectScenarioForClient(activeScenario));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(payload);
      return;
    }

    // List scenarios that can be switched to. Builtins, disk-loaded,
    // in-memory runnable customs, and any currently-active compiled
    // scenario all live in the same catalog — this endpoint is a
    // uniform iteration over it. No hardcoded IDs.
    if (req.url === '/scenarios' && req.method === 'GET') {
      const scenarios: Array<{ id: string; name: string; description: string; departments: number; source: string }> = [];
      for (const [id, entry] of customScenarioCatalog) {
        const sc = entry.scenario;
        scenarios.push({
          id,
          name: sc.labels?.name || id,
          description: describeCustomScenarioSource(entry.source),
          departments: sc.departments?.length || 0,
          source: entry.source,
        });
      }
      // Active scenario might not be in the catalog yet (freshly
      // compiled but we haven't written it back — belt-and-suspenders).
      if (!customScenarioCatalog.has(activeScenario.id)) {
        scenarios.push({
          id: activeScenario.id,
          name: activeScenario.labels?.name || activeScenario.id,
          description: 'Custom compiled scenario',
          departments: activeScenario.departments?.length || 0,
          source: 'compiled',
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ scenarios, active: activeScenario.id }));
      return;
    }

    // Admin config: tells client what's enabled
    if (req.url === '/admin-config' && req.method === 'GET') {
      // Hosted-demo flag: when true, env-only API keys belong to the
      // host (not the end user), so the dashboard treats env presence as
      // "host is paying" and surfaces demo-mode UX (hidden model picker,
      // rate-limit notice). Local dev leaves this unset and the picker
      // becomes visible whenever any LLM key is configured.
      const hostedDemo = serverMode === 'hosted_demo';
      // Expose the effective demo caps so the Settings UI can show
      // accurate `demo:N` lock labels without hardcoding the number
      // in the client. Lets operators flip the env var + pm2 restart
      // and the UI updates on the next page load without a redeploy.
      const { DEMO_EXECUTION } = await import('./sim-config.js');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        adminWrite,
        hostedDemo,
        serverMode,
        demoCaps: {
          maxTurns: DEMO_EXECUTION.maxTurns,
          maxPopulation: DEMO_EXECUTION.maxPopulation,
          maxActiveDepartments: DEMO_EXECUTION.maxActiveDepartments,
        },
        memoryScenarios: [...memoryScenarios.keys()],
        keys: {
          openai: !!env.OPENAI_API_KEY,
          anthropic: !!env.ANTHROPIC_API_KEY,
          serper: !!env.SERPER_API_KEY,
          firecrawl: !!env.FIRECRAWL_API_KEY,
          tavily: !!env.TAVILY_API_KEY,
          cohere: !!env.COHERE_API_KEY,
        },
      }));
      return;
    }

    // Store a scenario in memory (always allowed) or save to disk (requires ADMIN_WRITE)
    if (req.url === '/scenario/store' && req.method === 'POST') {
      try {
        const { scenario: scenarioJson, saveToDisk } = JSON.parse(await readBody(req, maxRequestBodyBytes));
        if (!scenarioJson || !scenarioJson.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'scenario with id required' }));
          return;
        }
        // Store raw JSON in memory for this authoring session.
        memoryScenarios.set(scenarioJson.id, scenarioJson);
        const switchable = isRunnableScenarioPackage(scenarioJson);
        if (switchable) {
          customScenarioCatalog.set(scenarioJson.id, {
            scenario: scenarioJson,
            source: saveToDisk && adminWrite ? 'disk' : 'memory',
          });
        }

        // Optionally save to disk if admin
        let savedToDisk = false;
        if (saveToDisk && adminWrite) {
          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync(scenarioDir, { recursive: true });
          writeFileSync(resolve(scenarioDir, `${scenarioJson.id}.json`), JSON.stringify(scenarioJson, null, 2));
          savedToDisk = true;
          if (switchable) {
            customScenarioCatalog.set(scenarioJson.id, {
              scenario: scenarioJson,
              source: 'disk',
            });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ stored: true, id: scenarioJson.id, savedToDisk, adminWrite, switchable }));
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Switch active scenario. Uniform catalog lookup — builtins
    // (mars-genesis, lunar-outpost) are registered into the same map
    // at server init, so this handler has NO hardcoded IDs. Any ID
    // that resolves to a runnable entry switches; source JSONs that
    // were /scenario/store'd but never compiled get a specific
    // "needs compile" error instead of the misleading "Unknown".
    if (req.url === '/scenario/switch' && req.method === 'POST') {
      try {
        const { id } = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const entry = customScenarioCatalog.get(id);
        if (entry) {
          activeScenario = entry.scenario;
        } else if (memoryScenarios.has(id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Scenario "${id}" is stored but not runnable — it's a source JSON (missing hooks, world, or canonical policies shape). Click Compile in the Scenario Editor to generate hooks before switching to it.`,
            storedButUnrunnable: true,
            id,
          }));
          return;
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown scenario: ${id}. Use /compile or /scenario/store for custom scenarios.` }));
          return;
        }
        clearEventBuffer();
        simConfig = null;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ active: activeScenario.id, name: activeScenario.labels?.name }));
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Landing-page enterprise-access waitlist. Captures email, sends a
    // branded confirmation via Resend, dedupes per-email, rate-limits
    // 1 submission / IP / 5 min. When `rateLimiter` is null (self-hosted
    // unlimited mode), fall through to allow-all because there is only
    // one operator to protect from abusive submissions.
    if (req.url === '/api/waitlist' && req.method === 'POST') {
      const body = await readBody(req, maxRequestBodyBytes);
      await handleWaitlist(req, res, body, {
        waitlistStore,
        sendEmail,
        rateLimiter: {
          consumeWaitlist: (ip) =>
            rateLimiter
              ? rateLimiter.consumeWaitlist(ip)
              : { allowed: true, remaining: 0, resetAt: Date.now() + 1, limit: 1 },
          getClientIp: (r) => IpRateLimiter.getIp(r),
        },
        waitlistFrom,
      });
      return;
    }

    // Tier 5 Quickstart onboarding endpoints.
    if (req.url?.startsWith('/api/quickstart/') && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const quickstartDeps: QuickstartDeps = {
          setActiveScenario: (sc, seedText) => {
            activeScenario = sc;
            activeScenarioSeedText = typeof seedText === 'string' && seedText.trim().length > 0
              ? seedText.slice(0, 1000)
              : null;
            // Quickstart-compiled scenarios reuse the 'compiled' source
            // tag; same post-compile semantics, no new source state
            // required.
            customScenarioCatalog.set(sc.id, { scenario: sc, source: 'compiled' });
          },
          getScenarioById: (id) => {
            if (id === activeScenario.id) return activeScenario;
            return customScenarioCatalog.get(id)?.scenario;
          },
          fetchSeedFromUrl,
          // Default to OpenAI to match compileScenario's existing
          // default (compiler/index.ts:162) and the codebase's
          // default-to-openai posture. The quickstart SeedInput form
          // does not yet collect user-supplied keys, so this default
          // is what hosted prod hits when the user does not override.
          // Self-hosted deployments can change this at the call site
          // (or pass `defaultProvider` from a custom server).
          // `inferProviderFromCredentials` still honors single-key
          // intent when only one of OPENAI/ANTHROPIC is in env.
          defaultProvider: 'openai',
          defaultModel: 'gpt-5.4-mini',
          recordGroundingCitations: (scenarioId, citations) => {
            groundingCitationsByScenarioId.set(scenarioId, citations);
          },
          getDigitalTwinWorld,
          // Pipe simulate-intervention's per-event stream into the same
          // SSE bus /setup uses. The dashboard's useSSE is already
          // listening; flipping this on lights up live SIM progress for
          // digital-twin runs without any client reset on the SSE
          // connection itself.
          broadcast,
          resetEventBuffer: clearEventBuffer,
        };
        // compile-from-seed is the first call in a new Quickstart
        // launch flow. Clearing the event buffer here means that any
        // SSE clients reconnecting between compile and /setup won't
        // re-receive events from the prior run (which was leaving
        // QuickstartProgress's "Run N simulations" stage card with
        // 100+ stale events from the previous bookstore/AGI/clinical
        // run before the new run had even started simulating).
        // Status polls are NOT a fresh-launch event so they MUST NOT
        // clear the buffer — they fire every 2s while a compile is in
        // flight, and clearing here would wipe in-flight SSE state.
        if (req.url === '/api/quickstart/compile-from-seed') {
          clearEventBuffer();
        }
        if (req.url === '/api/quickstart/fetch-seed') {
          await handleFetchSeed(req, res, body, quickstartDeps);
          return;
        }
        if (req.url === '/api/quickstart/compile-from-seed') {
          await handleCompileFromSeed(req, res, body, quickstartDeps);
          return;
        }
        if (req.url === '/api/quickstart/compile-from-seed/status') {
          await handleCompileFromSeedStatus(req, res, body, quickstartDeps);
          return;
        }
        if (req.url === '/api/quickstart/generate-actors') {
          await handleGenerateActors(req, res, body, quickstartDeps);
          return;
        }
        if (req.url === '/api/quickstart/ground-scenario') {
          await handleGroundScenario(req, res, body, quickstartDeps);
          return;
        }
        if (req.url === '/api/quickstart/simulate-intervention') {
          await handleSimulateIntervention(req, res, body, quickstartDeps);
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unknown quickstart route: ${req.url}` }));
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Tier 4 T4.2: POST /simulate one-shot HTTP endpoint. Gated behind
    // `PARACOSM_ENABLE_SIMULATE_ENDPOINT=true` so the hosted demo's
    // SSE path stays the default; self-hosted deployments flip the
    // flag on to expose the sync request-response surface.
    if (
      req.url === '/simulate' &&
      req.method === 'POST' &&
      (env.PARACOSM_ENABLE_SIMULATE_ENDPOINT || '').toLowerCase() === 'true'
    ) {
      try {
        const body = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const userApiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
        const userAnthropicKey = typeof req.headers['x-anthropic-key'] === 'string' ? req.headers['x-anthropic-key'] : undefined;
        const simulateCredentials = {
          apiKey: normalizeCredential(userApiKey),
          anthropicKey: normalizeCredential(userAnthropicKey),
        };
        const hasUserKeys = hasProviderCredentials(simulateCredentials);
        // Rate limit with BYO-key bypass, matching the /setup pattern.
        // `.check()` alone is advisory; `.record()` consumes the slot.
        if (rateLimiter && !hasUserKeys) {
          const ip = IpRateLimiter.getIp(req);
          const { allowed, remaining, limit } = rateLimiter.check(ip);
          if (!allowed) {
            res.writeHead(429, {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': '86400',
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': '0',
            });
            res.end(JSON.stringify({
              error: `Rate limit exceeded. Maximum ${limit} simulations per day. Set X-API-Key or X-Anthropic-Key to bypass.`,
              limit,
              remaining: 0,
            }));
            return;
          }
          rateLimiter.record(ip);
          console.log(`  [rate-limit] /simulate ${ip}: ${remaining - 1} remaining of ${limit}`);
        } else if (hasUserKeys) {
          console.log(`  [rate-limit] /simulate bypassed. BYO key present.`);
        }
        const deps: SimulateDeps = {
          compileScenario: (raw, opts) => {
            const userCompile = options.compileScenario;
            if (userCompile) return userCompile(raw, opts as Record<string, unknown>);
            return compileScenarioReal(raw, opts);
          },
          runSimulation: async (leader, keyPersonnel, runOpts) => {
            const { runSimulation } = await import('../runtime/orchestrator.js');
            return runSimulation(leader, keyPersonnel, runOpts);
          },
        };
        await handleSimulate(req, res, body, deps, simulateCredentials);
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Compile a custom scenario JSON into a ScenarioPackage
    if (req.url === '/compile' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const { scenario: scenarioJson, provider: requestedProvider, model: requestedModel, seedText, seedUrl, webSearch, maxSearches, apiKey, anthropicKey } = body;
        if (!scenarioJson || typeof scenarioJson !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'scenario JSON object required' }));
          return;
        }
        const compileCredentials = {
          apiKey: normalizeCredential(apiKey),
          anthropicKey: normalizeCredential(anthropicKey),
        };

        // Rate-limit compile against its own daily bucket. Each compile
        // costs ~$0.10 against the host's API key, so even 10 uncontrolled
        // hits is a real line item. Bypassed when the caller is not
        // billing the host: either a session key was supplied, or the
        // server is in local mode (PARACOSM_HOSTED_DEMO unset) where
        // env keys belong to the operator.
        const userSuppliedKey = hasProviderCredentials(compileCredentials);
        const isHostedDemoCompile = serverMode === 'hosted_demo';
        const hostBilled = !userSuppliedKey && isHostedDemoCompile;
        if (rateLimiter && hostBilled) {
          const ip = IpRateLimiter.getIp(req);
          const { allowed, remaining, resetAt, limit } = rateLimiter.consumeCompile(ip);
          if (!allowed) {
            res.writeHead(429, {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
            });
            res.end(JSON.stringify({
              error: `Compile rate limit exceeded. Maximum ${limit} compiles per day. Add your own API keys to bypass.`,
              limit,
              remaining: 0,
              resetAt,
            }));
            return;
          }
          console.log(`  [rate-limit] /compile ${ip}: ${remaining} remaining of ${limit}`);
        }

        const envDefaultProvider = env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY ? 'anthropic' : 'openai';
        const provider = resolveProviderFromCredentials(requestedProvider, compileCredentials, envDefaultProvider);
        // Force the cheapest class only when the host is billing
        // (hosted-demo mode + no session key). Local dev and BYO-key
        // paths honor the requested model.
        const demoCompileModel = provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-5.4-nano';
        const model = !hostBilled
          ? (requestedModel || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.4-mini'))
          : demoCompileModel;

        // SSE progress stream
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        res.write('event: status\ndata: {"status":"compiling"}\n\n');

        // Forward every compile-hook fallback as an SSE event in real time
        // so the dashboard surfaces degraded compiles instead of showing
        // a silent success. The underlying aggregator still records the
        // attempts + fallbacks for the /retry-stats ring buffer below.
        const baseCompileTelemetry = createCompilerTelemetry();
        const compileTelemetry: CompilerTelemetry = {
          recordAttempt: (hookName, attempts, fromFallback) =>
            baseCompileTelemetry.recordAttempt(hookName, attempts, fromFallback),
          recordFallback: (hookName, details) => {
            baseCompileTelemetry.recordFallback(hookName, details);
            res.write(`event: compile_validation_fallback\ndata: ${JSON.stringify({
              hookName,
              attempts: details.attempts,
              reason: details.reason,
              rawTextExcerpt: (details.rawText ?? '').slice(-500),
            })}\n\n`);
          },
          snapshot: () => baseCompileTelemetry.snapshot(),
        };

        const compiled = await runCompileScenario(scenarioJson, {
          provider,
          model,
          cache: true,
          seedText,
          seedUrl,
          webSearch: webSearch ?? true,
          maxSearches,
          apiKey: compileCredentials.apiKey,
          anthropicKey: compileCredentials.anthropicKey,
          telemetry: compileTelemetry,
          onProgress(hookName: string, status: string) {
            res.write(`event: progress\ndata: ${JSON.stringify({ hook: hookName, status })}\n\n`);
          },
        });

        // Update the active scenario for GET /scenario
        activeScenario = compiled;
        memoryScenarios.set(compiled.id, compiled);
        customScenarioCatalog.set(compiled.id, { scenario: compiled, source: 'compiled' });

        // Snapshot compile telemetry into the ring buffer so /retry-stats
        // aggregates compile:* schemas alongside runtime schemas, and emit
        // the rollup as SSE so the dashboard can render per-hook attempts
        // and fallbacks immediately without polling the endpoint.
        const compileSnap = compileTelemetry.snapshot();
        if (Object.keys(compileSnap.schemaRetries).length > 0) {
          retryRing.push(compileSnap.schemaRetries as PerRunSchemaRetries);
          if (retryRing.length > RETRY_RING_MAX) {
            retryRing.splice(0, retryRing.length - RETRY_RING_MAX);
          }
          persistRetryRing();
        }
        const perHookMetrics: Record<string, { attempts: number; fromFallback: boolean }> = {};
        for (const [key, bucket] of Object.entries(compileSnap.schemaRetries)) {
          perHookMetrics[key.replace(/^compile:/, '')] = {
            attempts: bucket.attempts,
            fromFallback: bucket.fallbacks > 0,
          };
        }
        res.write(`event: compile_metrics\ndata: ${JSON.stringify({
          hooks: perHookMetrics,
          totalFallbacks: compileSnap.fallbacks.length,
        })}\n\n`);

        res.write(`event: complete\ndata: ${JSON.stringify({ id: compiled.id, version: compiled.version, departments: compiled.departments.length, hooks: Object.keys(compiled.hooks).filter(k => (compiled.hooks as any)[k]).length })}\n\n`);
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          writeJsonError(res, err, 500);
        } else {
          res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
          res.end();
        }
      }
      return;
    }

    if (req.url === '/clear' && req.method === 'POST') {
      clearEventBuffer();
      simConfig = null;
      // Clear chat agent pool when simulation is cleared
      import('../runtime/chat-agents.js').then(m => m.clearPool()).catch(() => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cleared: true }));
      return;
    }

    if (req.url === '/setup' && req.method === 'GET') {
      res.writeHead(302, { Location: '/sim?tab=settings' });
      res.end();
      return;
    }

    // Rate limit status endpoint
    // Post-simulation colonist chat
    if (req.url === '/chat' && req.method === 'POST') {
      let inflightSlot = false;
      try {
        const parsed = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const { agentId, message, history, apiKey, anthropicKey } = parsed;
        if (!agentId || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'agentId and message required' }));
          return;
        }
        // Hard caps on attacker-controlled inputs. Each /chat fires a
        // multi-thousand-token LLM call against the host's API key, so
        // unchecked message + history bytes are a direct cost-drain
        // vector (one POST with 100KB of crafted history is a 25k+
        // token call). Buckets are conservative — real human chats are
        // a few hundred bytes; a 4KB cap on the live message and 32KB
        // on cumulative history covers any real conversation.
        const MAX_MESSAGE_BYTES = 4_096;
        const MAX_HISTORY_BYTES = 32_768;
        const MAX_HISTORY_TURNS = 32;
        const messageBytes = Buffer.byteLength(String(message), 'utf-8');
        if (messageBytes > MAX_MESSAGE_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `message exceeds ${MAX_MESSAGE_BYTES} bytes (got ${messageBytes})` }));
          return;
        }
        if (Array.isArray(history)) {
          if (history.length > MAX_HISTORY_TURNS) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `history exceeds ${MAX_HISTORY_TURNS} turns (got ${history.length})` }));
            return;
          }
          let total = 0;
          for (const h of history) {
            total += Buffer.byteLength(String(h?.content ?? ''), 'utf-8');
            if (total > MAX_HISTORY_BYTES) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `history exceeds ${MAX_HISTORY_BYTES} bytes (cumulative content)` }));
              return;
            }
          }
        }

        const chatCredentials = {
          apiKey: normalizeCredential(apiKey),
          anthropicKey: normalizeCredential(anthropicKey),
        };
        const chatUserKey = hasProviderCredentials(chatCredentials);

        // Rate-limit chat per IP per hour. Runs against the host's
        // key unless a session key was provided in the request body,
        // in which case the caller is paying and the cap is bypassed
        // (same contract as /setup and /compile). 200/hour leaves
        // plenty of headroom for real host-billed users exploring
        // colonist conversations.
        // Concurrency cap: rejects bursts before they can spawn N
        // parallel LLM calls in flight. Applies even to user-keyed
        // requests because a single laptop spamming requests with a
        // valid key still hammers the server's outbound connection
        // pool and the LLM provider's rate limit.
        if (chatInflight >= chatConcurrencyCap) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Too many concurrent chat requests. Try again in a moment.',
          }));
          return;
        }

        if (rateLimiter && !chatUserKey) {
          const ip = IpRateLimiter.getIp(req);
          const { allowed, remaining, resetAt, limit } = rateLimiter.consumeChat(ip);
          if (!allowed) {
            res.writeHead(429, {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
            });
            res.end(JSON.stringify({
              error: `Chat rate limit exceeded. Maximum ${limit} messages per hour. Try again later.`,
              limit,
              remaining: 0,
              resetAt,
            }));
            return;
          }
          if (remaining < 5) {
            console.log(`  [rate-limit] /chat ${ip}: ${remaining} remaining of ${limit}`);
          }
        }
        chatInflight++;
        inflightSlot = true;

        // The chat route builds agents from the event buffer. If the
        // buffer was lost (fresh boot with no persisted snapshot on disk,
        // or the user hit /clear) there is nothing to build from. Phrase
        // the error so users understand it is a server-side emptiness,
        // not "the run you just finished is gone forever".
        if (eventBuffer.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server has no simulation in memory right now. Run a new simulation from the Settings tab, or reload this page so your saved events restore from cache.' }));
          return;
        }

        // Import chat agent system (lazy to avoid startup cost)
        const { getOrCreateChatAgent, extractColonistMemories, extractColonistRoster } = await import('../runtime/chat-agents.js');

        // Extract sim events and find colonist profile
        const simEvents = eventBuffer
          .filter(msg => msg.startsWith('event: sim\n'))
          .map(msg => { try { return JSON.parse(msg.split('data: ')[1]); } catch { return null; } })
          .filter(Boolean);

        const agentReactions = simEvents
          .filter((e: any) => e.type === 'agent_reactions')
          .flatMap((e: any) => (e.data?.reactions || []).filter((r: any) =>
            r.agentId === agentId || String(r.name || '').toLowerCase().includes(agentId.toLowerCase())
          ));
        const colonist = agentReactions[0];

        // Build colonist profile
        const profile = {
          agentId,
          name: colonist?.name || agentId,
          age: colonist?.age,
          marsborn: colonist?.marsborn,
          role: colonist?.role,
          department: colonist?.department,
          specialization: colonist?.specialization,
          hexaco: colonist?.hexaco,
          psychScore: colonist?.psychScore,
          boneDensity: colonist?.boneDensity,
          radiation: colonist?.radiation,
        };

        // Extract simulation memories for this colonist
        const memories = extractColonistMemories(agentId, simEvents, activeScenario.labels?.timeUnitNoun);
        // Extract the full agent roster from the latest systems_snapshot so
        // the chat agent knows who else exists. Without this, the agent
        // confabulates fake bios for any name the user invents.
        const roster = extractColonistRoster(simEvents);

        // Get or create the agent (lazy init with memory seeding)
        const envDefaultProvider = env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY ? 'anthropic' : 'openai';
        const provider = resolveProviderFromCredentials(simConfig?.provider, chatCredentials, envDefaultProvider);
        const { session, isNew } = await getOrCreateChatAgent(profile, memories, {
          provider,
          apiKey: chatCredentials.apiKey,
          anthropicKey: chatCredentials.anthropicKey,
          settlementNoun: activeScenario.labels?.settlementNoun,
          populationNoun: activeScenario.labels?.populationNoun,
          roster,
        });

        // Send message through the agent session (full history + memory + RAG automatic)
        const result = await session.send(message);

        // Surface per-turn token usage + cost so the dashboard footer
        // can fold chat spend into the run-total display. Without this,
        // the cost readout only reflected the simulation pipeline and
        // users racked up chat charges invisibly.
        const usage = (result as { usage?: { totalTokens?: number; costUSD?: number; promptTokens?: number; completionTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } }).usage ?? {};
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          reply: result.text,
          colonist: profile.name,
          memorySeeded: memories.length,
          firstMessage: isNew,
          usage: {
            totalTokens: usage.totalTokens ?? 0,
            costUSD: usage.costUSD ?? 0,
            promptTokens: usage.promptTokens ?? 0,
            completionTokens: usage.completionTokens ?? 0,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheCreationTokens: usage.cacheCreationTokens ?? 0,
          },
        }));
      } catch (err) {
        writeJsonError(res, err, 500);
      } finally {
        // Only release if THIS request actually claimed a slot.
        // Early-return paths (validation failures, rate-limit 429s)
        // exit before chatInflight++, so we'd otherwise decrement
        // somebody else's slot.
        if (inflightSlot) chatInflight--;
      }
      return;
    }

    // GET /results — full structured simulation results including verdict.
    // Reconstructs per-leader payloads from the SSE buffer so consumers
    // get the same rich data the dashboard sees, without having to scrape
    // raw events themselves.
    if (req.url === '/results' && req.method === 'GET') {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildResultsPayloadFromEventBuffer(eventBuffer)));
      return;
    }

    if (req.url === '/rate-limit' && req.method === 'GET') {
      const clientIp = IpRateLimiter.getIp(req);
      if (!rateLimiter) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ unlimited: true, ip: clientIp }));
        return;
      }
      const status = rateLimiter.check(clientIp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ip: clientIp, ...status, resetAtISO: new Date(status.resetAt).toISOString() }));
      return;
    }

    // Cross-run schema-retry aggregate for production reliability
    // telemetry. Reads the rotating ring of the last N completed runs
    // and rolls up calls/attempts/fallbacks per Zod schema so operators
    // can answer "is this model retrying too much on CommanderDecision?"
    // without scraping individual run results.
    //
    // Query params:
    //   ?limit=N — only aggregate the last N runs from the ring
    // Health endpoint — lightweight liveness + version check. Used by
    // monitors + CI/CD smoke tests to confirm the server came up cleanly
    // and which paracosm build is running. Cheap to hit: no LLM calls,
    // no ring-buffer iteration, just the current counters.
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        // Cloudflare sits in front; make sure a stale health snapshot
        // does not get cached at the edge and mislead monitors.
        'Cache-Control': 'no-store, max-age=0',
        ...corsHeaders,
      });
      res.end(
        JSON.stringify({
          status: 'ok',
          version: PARACOSM_VERSION,
          uptimeSeconds: Math.round(process.uptime()),
          runCount: retryRing.length,
        }),
      );
      return;
    }

    // ── Stored sessions: save / list / replay ───────────────────────
    //
    // Lets visitors replay a previously-saved demo via SSE instead of
    // triggering a fresh LLM-powered run. Save is gated by ADMIN_WRITE
    // (existing flag) — admin runs a good demo, hits POST /admin/sessions/save,
    // the in-memory event buffer (with per-event wall-clock timestamps)
    // gets written to SQLite. Public /sessions returns the metadata
    // listing; public /sessions/:id/replay streams the events back at
    // the original pacing (or accelerated via ?speed=N).

    if (req.url === '/admin/sessions/save' && req.method === 'POST') {
      if (!requireAdminToken(req, res)) return;
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      if (eventBuffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'no buffered events to save' }));
        return;
      }
      try {
        // Build the timestamped event array from the parallel buffers.
        // For events whose timestamp is 0 (rehydrated from disk pre-
        // timestamp-tracking), use the next known timestamp so replay
        // pacing stays monotonic instead of bunching at the start.
        const now = Date.now();
        const events: TimestampedEvent[] = eventBuffer.map((sse, i) => ({
          ts: eventTimestamps[i] || now,
          sse,
        }));
        const result = await sessionStore.saveSession(events);
        const totalStored = await sessionStore.count();
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({
          ...result,
          eventCount: events.length,
          totalStored,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // Admin destructive wipe: clears the runs + sessions tables and
    // optionally the on-disk artifact JSONs under <APP_DIR>/output/.
    // Same admin gate as /admin/sessions/save above. Returns the
    // counts of deleted rows + files.
    if (req.url === '/admin/data/wipe' && req.method === 'POST') {
      if (!requireAdminToken(req, res)) return;
      let body: { wipeRuns?: boolean; wipeSessions?: boolean; wipeOutput?: boolean; wipeEventBuffer?: boolean } = {};
      try {
        const raw = await readBody(req, maxRequestBodyBytes);
        if (raw) body = JSON.parse(raw);
      } catch (err) {
        void err; // Empty body is fine — defaults below.
      }
      const wipeRuns = body.wipeRuns !== false;
      const wipeSessions = body.wipeSessions !== false;
      const wipeOutput = body.wipeOutput === true;
      // Default-on: the event buffer is the SSE replay source. Leaving
      // it intact while wiping every other store means a page reload
      // re-renders the just-wiped run from the buffer, which surprised
      // users and looked like Wipe All wasn't actually working.
      const wipeEventBuffer = body.wipeEventBuffer !== false;

      const result: { runs: number; sessions: number; outputFiles: number; eventBuffer: boolean } = { runs: 0, sessions: 0, outputFiles: 0, eventBuffer: false };
      try {
        if (wipeRuns && runHistoryStore?.wipeAll) {
          result.runs = await runHistoryStore.wipeAll();
        }
        if (wipeSessions && sessionStore) {
          result.sessions = await sessionStore.wipeAll();
        }
        if (wipeEventBuffer) {
          // Same path the in-process /clear endpoint uses: clear the
          // in-memory buffer + cancel any pending persist + remove the
          // .event-buffer.json snapshot from disk.
          clearEventBuffer();
          simConfig = null;
          result.eventBuffer = true;
        }
        if (wipeOutput) {
          const outputDir = resolve(env.APP_DIR || '.', 'output');
          if (existsSync(outputDir)) {
            for (const file of readdirSync(outputDir)) {
              if (file.startsWith('v3-') && file.endsWith('.json')) {
                try {
                  unlinkSync(resolve(outputDir, file));
                  result.outputFiles += 1;
                } catch (err) {
                  void err; // Best-effort; one failure shouldn't abort the rest.
                }
              }
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ wiped: result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.url === '/sessions' && req.method === 'GET') {
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      try {
        const sessions = await sessionStore.listSessions();
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ sessions }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // Session metadata-only probe — `GET /sessions/:id` (no `/replay`
    // suffix) returns the session meta without the full event stream
    // so the client can validate a replay id before opening an
    // EventSource. Without this, a bogus ?replay=X URL produced an
    // invisible 404-retry loop on the SSE layer with no user signal.
    if (req.url?.startsWith('/sessions/') && !req.url.endsWith('/replay') && req.method === 'GET') {
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      const id = req.url.replace(/^\/sessions\//, '').split('?')[0];
      if (!id || id.includes('/')) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'invalid session id' }));
        return;
      }
      const session = await sessionStore.getSession(id);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session not found', id }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ meta: session.meta }));
      return;
    }

    if (req.url?.startsWith('/sessions/') && req.url.endsWith('/replay') && req.method === 'GET') {
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const id = url.pathname.replace(/^\/sessions\//, '').replace(/\/replay$/, '');
      const speedRaw = url.searchParams.get('speed');
      const speed = Math.max(0.25, Math.min(50, speedRaw ? parseFloat(speedRaw) || 1 : 1));
      const session = await sessionStore.getSession(id);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session not found', id }));
        return;
      }
      // SSE stream: same headers as /events. Replays on the original
      // wall-clock pacing scaled by `speed` (1 = real-time, 4 = 4x
      // faster, 0.5 = half speed). Closes the response when done.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...corsHeaders,
      });
      let cancelled = false;
      req.on('close', () => { cancelled = true; });
      void (async () => {
        let prevTs = session.events[0]?.ts ?? 0;
        for (const ev of session.events) {
          if (cancelled) return;
          const delay = Math.max(0, (ev.ts - prevTs) / speed);
          if (delay > 0) await new Promise(r => setTimeout(r, delay));
          prevTs = ev.ts;
          try {
            res.write(ev.sse);
          } catch {
            return;
          }
        }
        try { res.end(); } catch { /* socket already closed */ }
      })();
      return;
    }

    if (req.url?.startsWith('/retry-stats') && req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.max(1, Math.min(RETRY_RING_MAX, parseInt(limitRaw, 10) || RETRY_RING_MAX)) : undefined;
      const schemaWindow = limit ? retryRing.slice(-limit) : retryRing;
      const forgeWindow = limit ? forgeRing.slice(-limit) : forgeRing;
      const cacheWindow = limit ? cacheRing.slice(-limit) : cacheRing;
      const providerErrorWindow = limit ? providerErrorRing.slice(-limit) : providerErrorRing;
      const schemaAgg = aggregateSchemaRetries(schemaWindow);
      const forgeAgg = aggregateForgeStats(forgeWindow);
      const cacheAgg = aggregateCacheStats(cacheWindow);
      const providerErrorAgg = aggregateProviderErrors(providerErrorWindow);
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({
        ...schemaAgg,
        forges: forgeAgg,
        caches: cacheAgg,
        providerErrors: providerErrorAgg,
      }));
      return;
    }

    if (req.url === '/setup' && req.method === 'POST') {
      try {
        const rawConfig = JSON.parse(await readBody(req, maxRequestBodyBytes));
        // JSON.parse('null') returns null and JSON.parse('"x"') returns
        // a string; both crash the field reads below with a TypeError
        // that bubbles out as the unhelpful "Cannot read properties of
        // null (reading 'apiKey')" the user sees in the launch banner.
        // Reject non-object bodies up front with a 400 the dashboard's
        // mapLaunchErrorToMessage already surfaces as a friendly hint.
        if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Setup payload must be a JSON object.' }));
          return;
        }
        const config = rawConfig as Record<string, unknown> & {
          apiKey?: unknown;
          anthropicKey?: unknown;
          actors?: unknown;
          forkFrom?: unknown;
        };

        // Rate limit check: bypass when user provides real API keys.
        const requestCredentials = {
          apiKey: normalizeCredential(config.apiKey),
          anthropicKey: normalizeCredential(config.anthropicKey),
        };
        const hasUserKeys = hasProviderCredentials(requestCredentials);
        if (rateLimiter && !hasUserKeys) {
          const ip = IpRateLimiter.getIp(req);
          const { allowed, remaining, limit } = rateLimiter.check(ip);
          if (!allowed) {
            console.log(`  [rate-limit] Blocked ${ip} (${limit}/${limit} used)`);
            res.writeHead(429, {
              'Content-Type': 'application/json',
              'Retry-After': '86400',
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': '0',
            });
            res.end(JSON.stringify({
              error: `Rate limit exceeded. Maximum ${limit} simulations per day. Add your own API keys in Settings to remove this limit.`,
              limit,
              remaining: 0,
            }));
            return;
          }
          rateLimiter.record(ip);
          console.log(`  [rate-limit] ${ip}: ${remaining - 1} remaining of ${limit}`);
        } else if (hasUserKeys) {
          console.log(`  [rate-limit] Bypassed — user provided API keys`);
        }
        // Fork setups take exactly one actor (the override for the
        // forked branch). Regular setups take exactly two. Spec 2B.
        const isForkSetup = !!config.forkFrom;
        const actorsArray = Array.isArray(config.actors) ? config.actors : null;
        if (isForkSetup) {
          if (!actorsArray || actorsArray.length !== 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Fork setup requires exactly one actor.' }));
            return;
          }
        } else if (!actorsArray || actorsArray.length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'At least 2 actors required' }));
          return;
        }

        simConfig = normalizeSimulationConfig(config as SimulationSetupPayload);

        // Spec 2B: validate fork preconditions against the supplied
        // parent artifact before spinning up the orchestrator.
        if (simConfig.forkFrom) {
          const { parentArtifact } = simConfig.forkFrom;
          const forkTurn = simConfig.forkFrom.atTurn;
          const forkValidation = validateForkSetupPreconditions({
            parentArtifact,
            atTurn: forkTurn,
            activeScenarioId: activeScenario.id,
            activeRunInProgress: simRunning && !!activeSimAbortController,
          });
          if (!forkValidation.ok) {
            res.writeHead(forkValidation.statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: forkValidation.error,
              issues: forkValidation.issues,
            }));
            return;
          }
          simConfig.forkFrom.parentArtifact = forkValidation.parentArtifact;
          // Force captureSnapshots on for forked children so they are
          // themselves forkable.
          simConfig.captureSnapshots = true;
        }

        // Demo-mode enforcement: clamp only when the run bills against
        // the host's provider keys AND the server is in hosted-demo
        // mode. On local dev (PARACOSM_HOSTED_DEMO unset) env keys
        // belong to the operator, so we trust the tiered defaults and
        // any model overrides the client sent. On the hosted Linode
        // this variable is set, so env-only requests get clamped.
        const isHostedDemo = serverMode === 'hosted_demo';
        if (!hasUserKeys && isHostedDemo) {
          simConfig = applyDemoCaps(simConfig);
          console.log(
            `  [demo-mode] Capped run: turns=${simConfig.turns} pop=${simConfig.initialPopulation} ` +
            `depts=${simConfig.activeDepartments.length} models=${simConfig.models.commander}`,
          );
        }

        // Capture into a local non-null reference BEFORE the first
        // await. Earlier code only captured at the startWithConfig call
        // site (line ~2367), but every read of `simConfig` between the
        // first `await import(...)` below and that capture site was
        // still racing against `/clear` / `/select-scenario` (lines
        // 1353, 1672, 2013) which null out the closure variable. A
        // concurrent /clear during the bundle-id import or the
        // in-flight-sim abort drain produced "Cannot read properties of
        // null (reading 'actors')" 400s for the originating /setup.
        // Single capture here removes the whole race surface.
        const launchConfig = simConfig;

        // Build a base RunRecord for the /setup response (line ~1830). The
        // record is NOT inserted at run-start; instead, server-app inserts
        // one enriched record per completed artifact via the onArtifact
        // callback wired into the runner functions below. That callback
        // captures artifact-derived fields (artifactPath, costUSD,
        // durationMs, mode, actorName, actorArchetype) which the Library
        // tab needs to render gallery cards and to load full artifacts.
        // Generate a bundleId once per /setup invocation when the run
        // is a multi-leader batch. Every per-artifact RunRecord then
        // shares the same bundleId so the LIBRARY can collapse them
        // into one card and the CompareModal can fetch them in one
        // query. Solo runs (1 leader) leave bundleId undefined and
        // render as solo cards exactly as today.
        const { generateBundleId } = await import('./server/bundle-id.js');
        const bundleId = launchConfig.actors.length >= 2 ? generateBundleId() : undefined;
        const runRecord = createRunRecord({
          scenarioId: activeScenario.id,
          scenarioVersion: activeScenario.version,
          actorConfigHash: hashActorConfig({
            actors: launchConfig.actors,
            turns: launchConfig.turns,
            seed: launchConfig.seed,
          }),
          economicsProfile: launchConfig.economics.id,
          sourceMode: serverMode,
          createdBy: hasUserKeys ? 'user' : 'anonymous',
          bundleId,
        });
        // Insert a per-artifact RunRecord at run-end: the runner fires
        // `onArtifact` for each completed leader, we enrich the base
        // record with artifact fields and use the artifact's own runId
        // so the Library tab links each card to a specific artifact.
        const persistTurns = launchConfig.turns;
        const persistSeed = launchConfig.seed;
        const onArtifactPersist = async (
          artifact: import('../engine/schema/index.js').RunArtifact,
          leader: import('../runtime/orchestrator.js').ActorConfig,
        ) => {
          try {
            const perArtifactBase = {
              ...runRecord,
              runId: artifact.metadata.runId,
              actorConfigHash: hashActorConfig({
                leader,
                turns: persistTurns,
                seed: persistSeed,
              }),
            };
            const enriched = enrichRunRecordFromArtifact(perArtifactBase, artifact);
            await runHistoryStore.insertRun(enriched);
          } catch (error) {
            console.warn('[run-history] per-artifact insert failed:', error);
          }
        };

        // If a run is already in flight, abort it before starting the
        // new one. Previously /setup silently no-op'd on simRunning,
        // which left the old sim draining API credits while the user
        // thought their new config had taken effect. The orchestrator
        // handles AbortSignal via its finally block in startWithConfig
        // (resets simRunning + activeSimAbortController), so awaiting
        // that unwind before starting ensures the event buffer clear +
        // new config take effect cleanly.
        if (simRunning && activeSimAbortController) {
          console.log(`  [setup] Aborting in-flight sim before launching new one`);
          activeSimAbortController.abort();
          // Wait up to 5s for the previous run's finally block to run.
          // Without this, the orchestrator's finally could reset
          // simRunning AFTER the new startWithConfig has already set
          // it, then the watchdog would never re-arm on the new sim.
          const waitStart = Date.now();
          while (simRunning && Date.now() - waitStart < 5000) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }

        // Broadcast the scenario about to run BEFORE kicking off the
        // simulation. Closes the loop on "I uploaded Mercury JSON but
        // the run looked like Mars" — the dashboard can render a
        // prominent 'Running: Mars Genesis' banner so the user sees
        // immediately which scenario is active vs what's in their
        // editor.
        broadcast('active_scenario', {
          id: activeScenario.id,
          name: activeScenario.labels?.name ?? activeScenario.id,
          settlementNoun: activeScenario.labels?.settlementNoun,
          populationNoun: activeScenario.labels?.populationNoun,
          departments: activeScenario.departments?.length ?? 0,
          // Carry the original seed prompt through when the run came
          // out of compile-from-seed; null for built-in scenarios.
          seedText: activeScenarioSeedText,
        });
        console.log(`  Running scenario: "${activeScenario.labels?.name ?? activeScenario.id}" (${activeScenario.id})`);

        // launchConfig was captured above (right after applyDemoCaps)
        // so it stays non-null even if a concurrent /clear nulls out
        // the closure-level simConfig during one of the awaits.
        marsServer.startWithConfig(launchConfig, { onArtifact: onArtifactPersist }).catch((error) => {
          console.warn('[setup] simulation failed:', error);
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          redirect: '/sim',
          scenarioId: activeScenario.id,
          scenarioName: activeScenario.labels?.name,
          run: {
            id: runRecord.runId,
            sourceMode: runRecord.sourceMode,
            economicsProfile: runRecord.economicsProfile,
          },
        }));
      } catch (error) {
        writeJsonError(res, error);
      }
      return;
    }

    if (req.url === '/about') {
      res.writeHead(302, { Location: '/sim?tab=about' });
      res.end();
      return;
    }

    // Serve brand assets. Defensive: bot probes hit `/brand/` (empty
    // suffix) or `/brand/<dirname>`, which `existsSync` reports as
    // present but `readFileSync` then blows up on with EISDIR. The whole
    // block wraps in try/catch + the existsSync check now also requires
    // a file (not a directory) so a probe falls through to 404 instead
    // of crashing the request handler. Server logs were full of these.
    if (req.url?.split('?')[0].startsWith('/brand/')) {
      try {
        const assetsRoot = resolve(__dirname, '..', '..', 'assets');
        const brandPath = resolve(assetsRoot, req.url.split('?')[0].replace('/brand/', ''));
        // Path-traversal guard: bot probes like `/brand/../../etc/passwd`
        // resolve outside `assetsRoot`. Only serve when the resolved
        // path stays inside the allowed root. Without this, a crafted
        // suffix could read any file the server process can.
        const insideRoot = brandPath === assetsRoot || brandPath.startsWith(assetsRoot + sep);
        if (insideRoot && existsSync(brandPath) && statSync(brandPath).isFile()) {
          const ext = brandPath.split('.').pop() || '';
          const types: Record<string,string> = { svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', css:'text/css', js:'application/javascript', woff2:'font/woff2' };
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300, s-maxage=60' });
          res.end(readFileSync(brandPath));
          return;
        }
      } catch (err) {
        console.warn(`[brand] failed to serve ${req.url}: ${(err as Error).message}`);
      }
    }

    // Serve demo videos (Remotion-rendered loops shown on the landing
    // page). Long cache: rendered output is content-addressable enough
    // that the landing's <video src> changes when content changes.
    //
    // Honors HTTP Range requests so the landing-page <video controls>
    // scrubber can seek without buffering the whole file. Without this,
    // the prior implementation sent HTTP 200 + the full body even when
    // a Range header was present — Cloudflare cached that as a
    // non-rangeable response, which disabled the timeline scrubber for
    // every visitor. The mp4 itself has +faststart (moov atom at the
    // front) so the browser only needs the byte range it asked for to
    // render any timestamp.
    if (req.url?.split('?')[0].startsWith('/demo/')) {
      const demoRoot = resolve(__dirname, '..', '..', 'assets', 'demo');
      const demoPath = resolve(demoRoot, req.url.split('?')[0].replace('/demo/', ''));
      // Path-traversal guard: same vulnerability as the /brand/ route.
      // Reject anything that resolves outside the demo asset root.
      const insideDemo = demoPath === demoRoot || demoPath.startsWith(demoRoot + sep);
      if (insideDemo && existsSync(demoPath)) {
        const ext = demoPath.split('.').pop() || '';
        const types: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg' };
        const contentType = types[ext] || 'application/octet-stream';
        const stat = statSync(demoPath);
        const fileSize = stat.size;
        const rangeHeader = req.headers.range;

        if (rangeHeader) {
          // Parse `bytes=<start>-<end?>`. Accepts open-ended end so
          // browsers can ask for "everything from offset N onward" and
          // suffix-byte ranges (`bytes=-N`) for the last N bytes of the
          // file. Malformed headers fall through to a 416.
          const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
          if (!match) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
              'Content-Type': 'text/plain',
            });
            res.end('Malformed Range header');
            return;
          }
          let start: number;
          let end: number;
          if (match[1] === '' && match[2] !== '') {
            // Suffix range: "bytes=-N" → last N bytes.
            const suffix = parseInt(match[2], 10);
            start = Math.max(fileSize - suffix, 0);
            end = fileSize - 1;
          } else {
            start = match[1] === '' ? 0 : parseInt(match[1], 10);
            end = match[2] === '' ? fileSize - 1 : parseInt(match[2], 10);
          }
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
              'Content-Type': 'text/plain',
            });
            res.end('Requested range not satisfiable');
            return;
          }
          end = Math.min(end, fileSize - 1);
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
          });
          // Stream the requested chunk so we don't buffer the whole
          // file into memory per request.
          createReadStream(demoPath, { start, end }).pipe(res);
          return;
        }

        // No Range header: full-file response, but still advertise
        // Accept-Ranges so browsers know they can seek on subsequent
        // requests.
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        });
        createReadStream(demoPath).pipe(res);
        return;
      }
    }

    // SEO + AI-crawler assets — sitemap.xml, robots.txt, and llms.txt
    // live in the dashboard's public/ tree (Vite copies them to dist/
    // on build) but Vite only mounts that tree under its own asset
    // routes. Serve them explicitly from the root so
    // paracosm.agentos.sh/sitemap.xml + /robots.txt + /llms.txt resolve
    // cleanly. Without these handlers Cloudflare returns 404 and Search
    // Console / GPTBot / Perplexity can't crawl the site.
    if (req.url === '/sitemap.xml' || req.url === '/robots.txt' || req.url === '/llms.txt') {
      try {
        const distDir = resolve(__dirname, 'dashboard/dist');
        const fileName = req.url.slice(1);
        const filePath = resolve(distDir, fileName);
        if (existsSync(filePath)) {
          const contentType = req.url === '/sitemap.xml' ? 'application/xml' : 'text/plain';
          res.writeHead(200, {
            'Content-Type': contentType + '; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(readFileSync(filePath, 'utf-8'));
          return;
        }
        res.writeHead(404); res.end();
      } catch {
        res.writeHead(404); res.end();
      }
      return;
    }

    if (req.url === '/favicon.svg' || req.url === '/favicon.png' || req.url === '/favicon.ico' || req.url === '/icon.svg' || req.url === '/apple-touch-icon.png') {
      try {
        const assetsDir = resolve(__dirname, '..', '..', 'assets');
        const favDir = resolve(assetsDir, 'favicons');
        // Apple touch icon
        if (req.url === '/apple-touch-icon.png') {
          const p = resolve(favDir, 'favicon-180.png');
          if (existsSync(p)) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(readFileSync(p)); return; }
        }
        // PNG routes: serve 32px PNG
        if (req.url === '/favicon.png' || req.url === '/favicon.ico') {
          const p = resolve(favDir, 'favicon-32.png');
          if (existsSync(p)) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(readFileSync(p)); return; }
        }
        // SVG routes
        const svgPath = resolve(favDir, 'icon.svg');
        const fallbackSvg = resolve(assetsDir, 'mars-genesis-icon.svg');
        const iconPath = existsSync(svgPath) ? svgPath : existsSync(fallbackSvg) ? fallbackSvg : null;
        if (iconPath) {
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
          res.end(readFileSync(iconPath, 'utf-8'));
        } else {
          res.writeHead(404); res.end();
        }
      } catch {
        res.writeHead(404); res.end();
      }
      return;
    }

    // ---------------------------------------------------------------------------
    // Static file serving
    // ---------------------------------------------------------------------------
    const distDir = resolve(__dirname, 'dashboard/dist');
    const hasViteBuild = existsSync(resolve(distDir, 'index.html'));
    const pathname = (req.url || '/').split('?')[0];

    // Landing page at /
    if (pathname === '/' || pathname === '/index.html') {
      const landingPath = resolve(__dirname, 'dashboard/landing.html');
      if (existsSync(landingPath)) {
        // Inject the package version into the schema.org LD+JSON block
        // so search engines and social previews show the real current
        // release instead of the stale literal that sat there
        // (`0.1.0` lingered in the HTML long after we shipped 0.4.x).
        // The placeholder is what lives on disk; we swap it per-request
        // since it's a one-line string replace on a cached template.
        const html = readFileSync(landingPath, 'utf-8').replace(
          /__PARACOSM_VERSION__/g,
          PARACOSM_VERSION,
        );
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
        res.end(html);
        return;
      }
    }

    // API docs (TypeDoc generated)
    if (pathname.startsWith('/docs')) {
      const docsDir = resolve(__dirname, '..', '..', 'docs', 'api');
      if (pathname === '/docs' || pathname === '/docs/') {
        res.writeHead(302, { Location: '/docs/modules.html' });
        res.end();
        return;
      }
      let docPath = pathname.replace('/docs', '');
      if (!docPath || docPath === '/') docPath = '/modules.html';
      const filePath = resolve(docsDir, docPath.startsWith('/') ? docPath.slice(1) : docPath);
      try {
        const { statSync } = await import('node:fs');
        const stat = statSync(filePath);
        if (stat.isFile()) {
          const ext = filePath.split('.').pop() || '';
          const mimeTypes: Record<string, string> = {
            html: 'text/html', css: 'text/css', js: 'application/javascript',
            svg: 'image/svg+xml', png: 'image/png', json: 'application/json',
            jpg: 'image/jpeg', gif: 'image/gif', woff: 'font/woff', woff2: 'font/woff2',
          };

          if (ext === 'html') {
            // Inject Paracosm theme into TypeDoc HTML
            let html = readFileSync(filePath, 'utf-8');
            // Rewrite relative asset paths to absolute /docs/ paths
            html = html.replace(/href="\.\.\/assets\//g, 'href="/docs/assets/');
            html = html.replace(/src="\.\.\/assets\//g, 'src="/docs/assets/');
            html = html.replace(/href="assets\//g, 'href="/docs/assets/');
            html = html.replace(/src="assets\//g, 'src="/docs/assets/');
            html = html.replace(/href="\.\.\/media\//g, 'href="/docs/media/');
            html = html.replace(/src="\.\.\/media\//g, 'src="/docs/media/');
            html = html.replace(/href="media\//g, 'href="/docs/media/');
            html = html.replace(/src="media\//g, 'src="/docs/media/');
            // TypeDoc toolbar + page title hidden via CSS (kept in DOM so JS doesn't crash)
            // Add our CSS override + fonts + favicon + inline mobile styles
            html = html.replace('</head>',
              `<link rel="icon" href="/favicon.png" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="/docs/assets/paracosm-override.css">
<style>
/* Hamburger button (hidden on desktop) */
.pdh-hamburger{display:none;background:none;border:1px solid var(--color-text-aside);border-radius:6px;width:32px;height:32px;cursor:pointer;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:7px;flex-shrink:0;opacity:.6;transition:opacity .2s}
.pdh-hamburger:hover{opacity:1}
.pdh-hamburger span{display:block;width:16px;height:2px;background:var(--color-text);border-radius:1px;transition:transform .25s,opacity .25s}
.pdh-hamburger.open span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.pdh-hamburger.open span:nth-child(2){opacity:0}
.pdh-hamburger.open span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
/* Mobile nav dropdown (site links, not API sidebar) */
.pdh-mobile-nav{display:none;position:fixed;top:44px;left:0;right:0;z-index:99999;background:var(--color-background);border-bottom:1px solid var(--color-background-active);padding:8px 16px;flex-direction:column;gap:0}
.pdh-mobile-nav.open{display:flex}
.pdh-mobile-nav a{display:block;padding:12px 8px;font-size:15px;font-weight:500;color:var(--color-text-aside);text-decoration:none;border-bottom:1px solid var(--color-background-active);font-family:'Inter',system-ui,sans-serif}
.pdh-mobile-nav a:last-child{border-bottom:none}
.pdh-mobile-nav a:hover{color:var(--color-text)}
@media(max-width:1100px){
  header.tsd-page-toolbar{height:0!important;overflow:hidden!important;visibility:hidden!important;padding:0!important;margin:0!important;border:none!important}
  .container-main{display:block!important;grid-template-columns:none!important}
  .col-sidebar{display:none!important}
  .pdh-hamburger{display:flex}
  .pdh-right a,.pdh-right .pdh-search{display:none!important}
}
/* Below 600px the AGENTOS tag, separator, and "API Reference vX" text
 * all squeeze between the brand and the theme/hamburger buttons,
 * forcing the version label to wrap onto 3 lines. The user is already
 * on /docs at that point so the breadcrumb is redundant — drop it. */
@media(max-width:600px){
  .pdh-tag,.pdh-sep,.pdh-current{display:none!important}
}
</style></head>`
            );
            // Inject nav header after <body>
            html = html.replace(/<body[^>]*>/, `$&
<div class="paracosm-docs-header">
  <div class="pdh-left">
    <a href="/" style="display:flex;align-items:center;text-decoration:none" aria-label="Paracosm home">
      <svg class="pdh-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="22" height="22" style="margin-right:8px;flex-shrink:0;display:block" role="img" aria-label="Paracosm"><line x1="32" y1="32" x2="37.63" y2="10.98" stroke="var(--pc-line)" stroke-width="1.6" opacity=".5"/><line x1="32" y1="32" x2="53.02" y2="26.37" stroke="var(--pc-line)" stroke-width="1.6" opacity=".5"/><line x1="32" y1="32" x2="47.39" y2="47.39" stroke="var(--pc-line)" stroke-width="1.6" opacity=".5"/><line x1="32" y1="32" x2="26.37" y2="53.02" stroke="var(--pc-line)" stroke-width="1.6" opacity=".5"/><line x1="32" y1="32" x2="10.98" y2="37.63" stroke="var(--pc-line)" stroke-width="1.6" opacity=".5"/><line x1="32" y1="32" x2="16.61" y2="16.61" stroke="var(--pc-line)" stroke-width="1.6" opacity=".5"/><line x1="37.63" y1="10.98" x2="47.39" y2="47.39" stroke="var(--pc-line)" stroke-width="1.1" opacity=".18"/><line x1="53.02" y1="26.37" x2="26.37" y2="53.02" stroke="var(--pc-line)" stroke-width="1.1" opacity=".18"/><line x1="47.39" y1="47.39" x2="10.98" y2="37.63" stroke="var(--pc-line)" stroke-width="1.1" opacity=".18"/><line x1="26.37" y1="53.02" x2="16.61" y2="16.61" stroke="var(--pc-line)" stroke-width="1.1" opacity=".18"/><line x1="10.98" y1="37.63" x2="37.63" y2="10.98" stroke="var(--pc-line)" stroke-width="1.1" opacity=".18"/><line x1="16.61" y1="16.61" x2="53.02" y2="26.37" stroke="var(--pc-line)" stroke-width="1.1" opacity=".18"/><circle cx="32" cy="32" r="9.2" fill="var(--pc-amber)" opacity=".08"/><circle cx="32" cy="32" r="5.12" fill="var(--pc-amber)"/><circle cx="37.63" cy="10.98" r="3.52" fill="var(--pc-rust)"/><circle cx="53.02" cy="26.37" r="3.52" fill="var(--pc-amber)"/><circle cx="47.39" cy="47.39" r="3.52" fill="var(--pc-teal)"/><circle cx="26.37" cy="53.02" r="3.52" fill="var(--pc-rust)"/><circle cx="10.98" cy="37.63" r="3.52" fill="var(--pc-teal)"/><circle cx="16.61" cy="16.61" r="3.52" fill="var(--pc-amber)"/></svg>
      <span class="pdh-brand">PARA<span style="color:#e8b44a">COSM</span></span>
    </a>
    <a href="https://agentos.sh/en" target="_blank" rel="noopener" class="pdh-tag">AGENTOS</a>
    <span class="pdh-sep">|</span>
    <span class="pdh-current">API Reference v${PARACOSM_VERSION}</span>
  </div>
  <div class="pdh-right">
    <a href="/">Home</a>
    <a href="/sim">Simulation</a>
    <a href="/docs">API Docs</a>
    <a href="https://github.com/framersai/paracosm" target="_blank" rel="noopener">GitHub</a>
    <a href="https://www.npmjs.com/package/paracosm" target="_blank" rel="noopener">npm</a>
    <button class="pdh-search" onclick="document.getElementById('tsd-search-trigger')?.click()" aria-label="Search docs"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><line x1="11" y1="11" x2="15" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    <button class="pdh-theme" id="pdh-theme-toggle" aria-label="Toggle theme"></button>
    <button class="pdh-hamburger" id="pdh-hamburger" aria-label="Toggle menu"><span></span><span></span><span></span></button>
  </div>
</div>
<div class="pdh-mobile-nav" id="pdh-mobile-nav">
  <a href="/">Home</a>
  <a href="/sim">Simulation</a>
  <a href="/docs">API Docs</a>
  <a href="https://github.com/framersai/paracosm" target="_blank" rel="noopener">GitHub</a>
  <a href="https://www.npmjs.com/package/paracosm" target="_blank" rel="noopener">npm</a>
  <a href="https://agentos.sh/en" target="_blank" rel="noopener">AgentOS</a>
  <a href="https://wilds.ai/discord" target="_blank" rel="noopener">Discord</a>
</div>
<script>
(function(){
  // Search: intercept showModal -> show() so CSS can position it as popover
  var d=document.getElementById('tsd-search');
  if(d){
    d.showModal=function(){d.show();d.style.position='fixed';d.style.top='54px';d.style.right='24px';d.style.left='auto';d.style.bottom='auto';d.style.width='420px';d.style.maxWidth='calc(100vw - 48px)';d.style.maxHeight='480px';d.style.margin='0';d.style.borderRadius='8px';d.style.boxShadow='0 12px 40px rgba(0,0,0,.5)';d.style.zIndex='99999';var i=d.querySelector('input');if(i)i.focus();};
    document.addEventListener('click',function(e){if(d.open&&!d.contains(e.target)&&!e.target.closest('.pdh-search'))d.close();});
  }
  // Theme toggle
  var btn=document.getElementById('pdh-theme-toggle');
  if(btn){
    function applyTheme(t){
      document.documentElement.dataset.theme=t;
      localStorage.setItem('tsd-theme',t);
      btn.textContent=t==='dark'?'\\u2600':'\\u263D';
    }
    var saved=localStorage.getItem('tsd-theme')||'os';
    if(saved==='os') saved=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
    applyTheme(saved);
    btn.addEventListener('click',function(){
      var next=document.documentElement.dataset.theme==='dark'?'light':'dark';
      applyTheme(next);
    });
  }
  // Hamburger: toggle mobile nav dropdown
  var hb=document.getElementById('pdh-hamburger');
  var mn=document.getElementById('pdh-mobile-nav');
  if(hb&&mn){
    hb.addEventListener('click',function(){
      hb.classList.toggle('open');
      mn.classList.toggle('open');
    });
    mn.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click',function(){hb.classList.remove('open');mn.classList.remove('open');});
    });
  }
  // a11y: typedoc renders <details><summary><a>...</a></summary></details>
  // for module accordion entries in the left nav. axe flags this as
  // nested-interactive (a focusable <a> inside an interactive
  // <summary>). Restructure each match by moving the <a> out of the
  // <details> entirely (as a next-sibling of <details>), so it stays
  // visible regardless of details state, and tag the parent so CSS
  // can flex chevron + link side-by-side. Re-run on every nav
  // mutation since typedoc hydrates the sidebar asynchronously.
  function fixNestedInteractive(){
    var summaries=document.querySelectorAll('details > summary.tsd-accordion-summary > a');
    for(var i=0;i<summaries.length;i++){
      var link=summaries[i];
      var summary=link.parentElement;
      var details=summary&&summary.parentElement;
      if(!details||details.tagName!=='DETAILS') continue;
      if(link.dataset.tsdExtracted) continue;
      var detailsParent=details.parentElement;
      if(!detailsParent) continue;
      var label=(link.textContent||'').trim();
      if(label) summary.setAttribute('aria-label','Toggle '+label);
      summary.removeChild(link);
      detailsParent.insertBefore(link,details.nextSibling);
      link.dataset.tsdExtracted='1';
      link.classList.add('tsd-extracted-summary-link');
      detailsParent.classList.add('tsd-fixed-accordion-row');
    }
  }
  fixNestedInteractive();
  if(window.MutationObserver){
    new MutationObserver(fixNestedInteractive).observe(document.body,{childList:true,subtree:true});
  }
})();
</script>`);
            // Inject footer before </body>
            html = html.replace('</body>',
              `<div class="paracosm-docs-footer">
  <div class="pdf-links">
    <a href="https://agentos.sh/en">agentos.sh</a>
    <a href="https://github.com/framersai/paracosm">GitHub</a>
    <a href="https://www.npmjs.com/package/paracosm">npm</a>
    <a href="https://frame.dev">Frame.dev</a>
    <a href="https://manic.agency">Manic Agency</a>
  </div>
  <span><span style="font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-weight:700;letter-spacing:.08em;font-size:10px">PARA<span style="color:#e8b44a">COSM</span></span> &middot; Apache-2.0 &middot; <a href="https://manic.agency">Manic Agency</a> / <a href="https://frame.dev">Frame.dev</a></span>
</div></body>`);
            res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
            res.end(html);
            return;
          }

          const content = readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
          });
          res.end(content);
          return;
        }
        // Directory: try index.html
        if (stat.isDirectory()) {
          const indexPath = resolve(filePath, 'index.html');
          if (existsSync(indexPath)) {
            const content = readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
            res.end(content);
            return;
          }
        }
      } catch {}
    }

    // Vite assets (CSS, JS, fonts)
    if (req.url?.startsWith('/assets/')) {
      const assetPath = resolve(distDir, req.url.slice(1));
      // Path-traversal guard: same vulnerability as the /brand/ and
      // /demo/ routes. Reject anything that resolves outside distDir.
      const insideDist = assetPath === distDir || assetPath.startsWith(distDir + sep);
      if (insideDist && existsSync(assetPath)) {
        const ext = assetPath.split('.').pop();
        // `mjs` MUST resolve to a JS MIME type — pdfjs-dist ships its
        // worker as `pdf.worker.min.mjs`, and Vite emits other ESM
        // chunks under that extension. Without it the browser sees
        // `application/octet-stream` and rejects the script under
        // strict module MIME checks, surfacing as "PDF parser failed
        // to start" with no real recovery short of a hard refresh.
        // `map` covers source-maps emitted in dev/preview bundles.
        const mimeTypes: Record<string, string> = {
          js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
          svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
          woff2: 'font/woff2', woff: 'font/woff', map: 'application/json',
          json: 'application/json', wasm: 'application/wasm',
        };
        const content = readFileSync(assetPath);
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext || ''] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(content);
        return;
      }
    }

    // Simulation dashboard at /sim (SPA)
    if (pathname === '/sim' || pathname.startsWith('/sim/') || pathname === '/sim/index.html') {
      if (hasViteBuild) {
        const html = readFileSync(resolve(distDir, 'index.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  }) as MarsServer;

  // Clean up rate limiter on server close
  (server as Server).on('close', () => { if (rateLimiter) rateLimiter.destroy(); });

  const marsServer = Object.assign(server, {
    async startWithConfig(config: NormalizedSimulationConfig, hooks?: StartConfigHooks) {
      // Clear previous run data
      clearEventBuffer();
      simConfig = config;
      simRunning = true;
      // Per-run AbortController. Held in a local so the finally block
      // only clears the global flag when it still points to *our* run.
      // Without the identity check, a slow cleanup on an old run could
      // null the active controller of a newer run that /setup just
      // started, breaking the disconnect watchdog's abort path.
      const controller = new AbortController();
      activeSimAbortController = controller;
      try {
        // Thread the currently-active scenario through to the pair
        // runner. Without this the runner defaults to Mars regardless
        // of which scenario the user compiled, so the page title would
        // show the custom name but the simulation would run Mars
        // hooks + content. Fork path (Spec 2B) dispatches to
        // runForkSimulation instead of the pair runner when the
        // config carries a forkFrom reference.
        if (config.forkFrom) {
          await runForkSimulation(config, broadcast, controller.signal, activeScenario, hooks?.onArtifact);
        } else if (config.actors.length >= 3) {
          // Tier 5 Quickstart dispatches N >= 3 leaders to the batch
          // runner (same SSE contract per leader, no verdict).
          await runBatchSimulations(config, broadcast, controller.signal, activeScenario, hooks?.onArtifact);
        } else {
          await startSimulations(config, broadcast, controller.signal, activeScenario, hooks?.onArtifact);
        }
      } finally {
        disarmDisconnectWatchdog();
        if (activeSimAbortController === controller) {
          simRunning = false;
          activeSimAbortController = null;
        }
        // Else: a newer run already replaced us. Leave simRunning and
        // activeSimAbortController alone so the new run's watchdog
        // continues to work.
      }
    },
  });

  return marsServer;
}
