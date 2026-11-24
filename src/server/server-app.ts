import { hookSourcesOf } from '../engine/compiler/hook-sources.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, createReadStream, realpathSync, type Stats } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeSimulationConfig, applyDemoCaps, countMissingOrders, DEMO_EXECUTION, type NormalizedSimulationConfig, type SimulationSetupPayload } from '../cli/sim-config.js';
import { runPairSimulations, runForkSimulation, runBatchSimulations, type BroadcastFn, type RunnerOptions } from '../cli/pair-runner.js';
import {
  handleFetchSeed, handleCompileFromSeed, handleCompileFromSeedStatus,
  handleGenerateActors, handleGroundScenario, handleSimulateIntervention,
  QUICKSTART_SCENARIO_ID_MAX, QUICKSTART_MODELS, defaultModelCalls, endFinishedJobsOf,
  type QuickstartDeps, type QuickstartModelCalls,
} from './routes/quickstart.js';
import { WorldModel } from '../runtime/world-model/index.js';
import { handleSimulate, type SimulateDeps } from './routes/simulate.js';
import { compileScenario as compileScenarioReal } from '../engine/compiler/index.js';
import { marsScenario } from '../engine/scenarios/index.js';
import { lunarScenario } from '../engine/scenarios/index.js';
import type { ScenarioPackage } from '../engine/types.js';
import { clipOrderText, MAX_ORDER_CHARS } from '../engine/presets/fill-instructions.js';
import {
  apiKeyForProvider,
  credentialFingerprint,
  hasProviderCredentials,
  normalizeCredential,
  resolveProviderFromCredentials,
} from '../engine/provider/credentials.js';
import { hostedModelRouting, hostedRunModels } from './hosted-model-policy.js';
import {
  describeCustomScenarioSource,
  type CustomScenarioEntry,
  isRunnableScenarioPackage,
  loadDiskCustomScenarios,
} from '../cli/custom-scenarios.js';
import {
  COMPILED_SCENARIOS_CAP,
  deletePersistedCompiledScenario,
  loadPersistedCompiledDrafts,
  persistCompiledScenario,
  scenarioJsonPath,
  SCENARIO_ID_RULE,
  type PersistedCompiledMeta,
} from '../cli/persisted-compiled-scenarios.js';
import { IpRateLimiter, readLimitFromEnv, readClientIpHeader } from './rate-limiter.js';
import type { QuickstartRefusal } from './routes/quickstart.js';
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
import { DEFAULT_MAX_SESSIONS, openSessionStore, type SessionStore, type TimestampedEvent } from './stores/session.js';
import { generateSessionTitle } from './session-title.js';
import { resolveServerMode } from './server-mode.js';
import {
  countAddresses,
  COUNT_FORWARDS_AT_ONCE,
  countEventFrom,
  CountEventLimit,
  forwardCountEvent,
  PLAUSIBLE_EVENT_URL,
  parseSiteAnalyticsIds,
  readSiteAnalyticsIds,
  sendsPrivacySignal,
  withSiteAnalytics,
  type SiteAnalyticsIds,
} from './site-analytics.js';
import {
  createRunRecord, hashActorConfig, publicResultFrame, recordedRunProvenance,
  resolveRunProvenance, withoutBrief, withRunProvenance,
} from './services/run-record.js';
import { makeRunProvenance } from '../engine/schema/index.js';
import { enrichRunRecordFromArtifact } from './services/enrich-run-record.js';
import { isRunOutputFileName, resolveRunsDir } from './services/run-artifact-file.js';
import { createNoopRunHistoryStore, type RunHistoryStore } from './stores/run-history.js';
import { createSqliteRunHistoryStore } from './stores/sqlite-run-history.js';
import type { RunScope } from './stores/run-history.js';
import { createWaitlistStore } from './stores/waitlist.js';
import { handleWaitlistClosed } from './routes/waitlist.js';
import { handlePublicDemoRoute } from './routes/public-demo.js';
import { handlePlatformApiRoute } from './routes/platform-api.js';
import { validateForkSetupPreconditions } from './fork-preconditions.js';
import { fetchSeedFromUrl } from '../cli/fetch-seed-url.js';
import {
  ANONYMOUS_VISITOR,
  LiveRunRegistry,
  RUN_CAPACITY_RETRY_AFTER_SECONDS,
  RunCapacityError,
  readVisitorId,
  runRecording,
  visitorCookie,
  type LiveRun,
} from './live-runs.js';

function projectScenarioForClient(sc: ScenarioPackage) {
  const sources = hookSourcesOf(sc);
  const compiled = sources && Object.keys(sources.hooks).length > 0;
  return {
    ...(compiled ? { provenance: makeRunProvenance({ compiler: sources.model }) } : {}),
    id: sc.id,
    sourceUrl: sc.sourceUrl,
    version: sc.version,
    labels: sc.labels,
    theme: sc.theme,
    setup: sc.setup,
    departments: sc.departments.map(d => ({ id: d.id, label: d.label, role: d.role, icon: d.icon })),
    presets: sc.presets,
    // A percent metric is held as 0.65 or as 65. The dashboard needs its world
    // field's ceiling, or failing that its starting value, to show it once.
    ui: {
      ...sc.ui,
      headerMetrics: sc.ui?.headerMetrics?.map(m => {
        const field = sc.world?.metrics?.[m.id];
        return { ...m, max: field?.max, initial: typeof field?.initial === 'number' ? field.initial : undefined };
      }),
    },
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

/** The first-party cookie that holds the scenario a visitor picked. */
export const SCENARIO_PICK_COOKIE = 'paracosm_scenario';
/** Thirty days, in seconds: a returning visitor finds the scenario they picked. */
const SCENARIO_PICK_MAX_AGE_SECONDS = 2_592_000;
// A pick cookie lives 30 days. The extra day covers a cookie set by a
// request that resolved the scenario before it left the catalog.
const RETIRED_SCENARIO_ID_MS = (SCENARIO_PICK_MAX_AGE_SECONDS + 86_400) * 1000;
/**
 * The longest cookie value held as a pick. RFC 6265 section 6.1 asks a
 * browser for at least 4096 bytes per cookie, name and attributes
 * included; 1024 leaves them room.
 */
const SCENARIO_PICK_MAX_BYTES = 1024;

/**
 * The largest scenario POST /scenario/store holds in memory, as JSON
 * (256 KiB). The largest scenario under scenarios/ is about 33 KB.
 */
export const MEMORY_SCENARIO_MAX_BYTES = 256 * 1024;
/** The most scenarios one visitor holds in memory. */
export const MEMORY_SCENARIOS_PER_VISITOR = 10;
/** The most scenarios the memory store holds, every visitor's together. */
export const MEMORY_SCENARIOS_CAP = 100;
/**
 * The most scenarios the memory store holds for one address, every visitor
 * id that address sends together. The address is the one the rate limiter
 * keys on (IpRateLimiter.getIp), so one client that sends many visitor ids
 * holds a fifth of the store at most.
 */
export const MEMORY_SCENARIOS_PER_ADDRESS = 20;
/**
 * How long the memory store holds a scenario after it was last stored, read
 * by its id or run: 24 hours. A scenario idle for longer is dropped, so a
 * full store empties by itself and never stays full until a restart.
 */
export const MEMORY_SCENARIO_IDLE_MS = 24 * 60 * 60 * 1000;

/** What POST /compile answers for an id it may not take. */
function scenarioIdTakenMessage(id: string): string {
  return `"${id}" is taken on this server. Give your scenario an id of its own.`;
}

/**
 * The scenario id in the request's `paracosm_scenario` cookie: the first
 * such pair of the Cookie header, percent-decoded. Null when there is
 * none, when its value is over 1024 bytes, or when it does not decode.
 */
export function readVisitorScenarioId(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== SCENARIO_PICK_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.length === 0 || Buffer.byteLength(raw) > SCENARIO_PICK_MAX_BYTES) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The Set-Cookie value that records a visitor's pick. The id is
 * percent-encoded, since a cookie value may not hold whitespace, quotes,
 * commas, semicolons or backslashes and a stored scenario's id can be any
 * string. Null when the encoded id is over 1024 bytes or does not encode.
 * `secure` adds `Secure`, for the hosted demo, which browsers reach over
 * HTTPS. A local server answers plain HTTP, where a browser would refuse a
 * `Secure` cookie.
 */
export function pickCookie(id: string, secure = false): string | null {
  let value: string;
  try {
    value = encodeURIComponent(id);
  } catch {
    return null;
  }
  if (Buffer.byteLength(value) > SCENARIO_PICK_MAX_BYTES) return null;
  return `${SCENARIO_PICK_COOKIE}=${value}; Path=/; Max-Age=${SCENARIO_PICK_MAX_AGE_SECONDS}; SameSite=Lax; HttpOnly${secure ? '; Secure' : ''}`;
}

/**
 * GET /scenario and GET /scenarios answer each visitor by their cookie, so
 * no shared cache in front of the server may hand one visitor's answer to
 * another.
 */
const PER_VISITOR_HEADERS: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Cookie' };

/** Puts {@link PER_VISITOR_HEADERS} on an answer a route handler writes itself. */
function sendPerVisitor(res: ServerResponse): void {
  for (const [name, value] of Object.entries(PER_VISITOR_HEADERS)) res.setHeader(name, value);
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The hostname of a `Host` header value (`name:port`, `[v6]:port`), lowercased; '' when it has none. */
function hostHeaderName(value: string | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** The additional origins whose pages the hosted demo answers on its own keys. */
function readAllowedOrigins(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const origins = new Set<string>();
  let dropped = 0;
  for (const entry of (env.PARACOSM_ALLOWED_ORIGINS ?? '').split(',')) {
    const piece = entry.trim();
    if (!piece) continue;
    try {
      const parsed = new URL(piece);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === piece.toLowerCase()) {
        origins.add(piece.toLowerCase());
        continue;
      }
    } catch {
      // Count an entry that does not parse with the other invalid entries.
    }
    dropped++;
  }
  if (dropped > 0) console.warn(`[origin] PARACOSM_ALLOWED_ORIGINS: dropped ${dropped} entries that are not origins (https://host or https://host:port)`);
  return origins;
}

/** The additional host names a local server answers, on any port. */
function readAllowedHosts(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const hosts = new Set<string>();
  let dropped = 0;
  for (const entry of (env.PARACOSM_ALLOWED_HOSTS ?? '').split(',')) {
    const piece = entry.trim();
    if (!piece) continue;
    if (hostHeaderName(piece) === piece.toLowerCase()) hosts.add(piece.toLowerCase());
    else dropped++;
  }
  if (dropped > 0) console.warn(`[host] PARACOSM_ALLOWED_HOSTS: dropped ${dropped} entries that are not host names (a name with no port)`);
  return hosts;
}

/**
 * Listed origins take precedence over fetch metadata, with Origin as the fallback.
 * With origins listed, a request whose Origin is any other origin (not `null`)
 * is another site's, whatever Sec-Fetch-Site says.
 */
function fromAnotherSite(req: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined && allowedOrigins.has(origin.toLowerCase())) return false;
  if (origin !== undefined && allowedOrigins.size > 0 && origin.trim().toLowerCase() !== 'null') return true;
  const site = req.headers['sec-fetch-site'];
  switch (typeof site === 'string' ? site.trim().toLowerCase() : '') {
    case 'cross-site':
    case 'same-site':
      return true;
    case 'same-origin':
    case 'none':
      return false;
  }
  if (origin === undefined) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.host !== (req.headers.host ?? '').toLowerCase();
  } catch {
    return true;
  }
}

const VISITOR_KEY_FIELDS = ['apiKey', 'anthropicKey', 'serperKey', 'firecrawlKey', 'tavilyKey', 'cohereKey'] as const;

/**
 * Keys travel over TLS or stay on this computer. A request came over HTTPS
 * when its own connection is TLS, or when `X-Forwarded-Proto: https` comes
 * from a proxy on this computer or from the proxy the operator named
 * (`namedProxy`: PARACOSM_CLIENT_IP_HEADER is set). A browser that addressed
 * this computer by a loopback name, with no proxy between, sends from this
 * computer, through a container's published port too.
 */
function refuseUnencryptedKeys(req: IncomingMessage, res: ServerResponse, namedProxy: boolean, keys: Record<string, unknown>): boolean {
  if (!VISITOR_KEY_FIELDS.some(field => normalizeCredential(keys[field]) !== undefined)) return false;
  if ((req.socket as TLSSocket).encrypted) return false;

  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
  const proxyScheme = req.headers['x-forwarded-proto'];
  const localPeer = LOOPBACK_HOSTNAMES.has(peer) || peer === '::1';
  if (proxyScheme === 'https' && (localPeer || namedProxy)) return false;
  if (proxyScheme === undefined && LOOPBACK_HOSTNAMES.has(hostHeaderName(req.headers.host))) return false;

  res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Send API keys over HTTPS, or use a dashboard on this computer.' }));
  return true;
}

/** Uses the compiler's seed test, including truthy values that are not strings. */
function compileUsesHostSearch(body: Record<string, unknown>, env: NodeJS.ProcessEnv): boolean {
  const seeded = Boolean(body.seedText || body.seedUrl);
  const scrapes = Boolean(body.seedUrl) && normalizeCredential(env.FIRECRAWL_API_KEY) !== undefined;
  return seeded && ((body.webSearch ?? true) !== false || scrapes);
}

/**
 * Whether a local server answers the name this request was sent to.
 *
 * The name the request was sent to (its `Host`) must be one the server is
 * served under: a loopback name, an address literal, a listed name, or the name `HOST`
 * gives. A site that points a name of its own at this machine (DNS
 * rebinding) sends that name in `Host`, and in `Origin` when it sends one,
 * so a name is never taken because the two agree. An address literal names
 * this machine itself, and no other site's page can be served from it.
 */
function localHostKnown(hostHeader: string | undefined, servedHost: string, allowedHosts: ReadonlySet<string>): boolean {
  const name = hostHeaderName(hostHeader);
  if (!name) return false;
  const served = hostHeaderName(servedHost.trim());
  return LOOPBACK_HOSTNAMES.has(name) || isIP(name.replace(/^\[|\]$/g, '')) !== 0 ||
    (served.length > 0 && name === served) || allowedHosts.has(name);
}

/**
 * Whether a local server answers this request: first its Host is known.
 *
 * Then the request carries no Origin (a same-origin GET, curl, a script),
 * or its Origin is a loopback address on any port (the dashboard itself,
 * the Vite dev server), or its Origin is the host the request was sent to
 * (the dashboard served under its address or its `HOST` name).
 * `Origin: null` and any other site are refused.
 */
export function localOriginAllowed(req: IncomingMessage, servedHost = '', allowedHosts: ReadonlySet<string> = new Set()): boolean {
  if (!localHostKnown(req.headers.host, servedHost, allowedHosts)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (LOOPBACK_HOSTNAMES.has(parsed.hostname)) return true;
  const host = req.headers.host;
  return typeof host === 'string' && host.length > 0 && parsed.host === host.toLowerCase();
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The path's stats when it names a regular file; undefined for a folder, nothing, or an unreadable path. */
function regularFileStat(path: string): Stats | undefined {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stream one file into a response. The status and headers are written only
 * once the file has opened, so a file that cannot be opened (removed or made
 * unreadable after the route checked it) answers 500. A read error after the
 * headers went out closes the connection. Every error is handled here: a read
 * stream's error with no listener is thrown and stops the whole process.
 */
function streamFile(
  res: ServerResponse,
  path: string,
  status: number,
  headers: Record<string, string>,
  range?: { start: number; end: number },
): void {
  const file = createReadStream(path, range);
  file.once('open', () => {
    if (res.destroyed) { file.destroy(); return; }
    res.writeHead(status, headers);
    pipeline(file, res, (err) => {
      if (!err || (err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      console.warn(`[static] stopped streaming ${path}: ${err.message}`);
    });
  });
  file.once('error', (err) => {
    if (res.headersSent) return;
    console.warn(`[static] could not open ${path}: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Read failed');
  });
  // A visitor who leaves before the file opens: release the file handle.
  res.once('close', () => { if (!res.writableFinished) file.destroy(); });
}

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

/**
 * Whether a presented admin token matches the server's, compared in
 * constant time: both are hashed to the same length first, so neither the
 * length nor the first differing byte of the server's token shows in how
 * long the comparison takes.
 */
function adminTokenMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Whether every percent escape in the request's path decodes to text. A `%`
 * not followed by two hex digits, or escapes whose bytes are not UTF-8,
 * make decodeURIComponent throw, so the routes that read an id from the
 * path decode it only once this holds.
 */
function pathDecodes(url: string | undefined): boolean {
  const path = (url ?? '/').split('?')[0];
  try {
    decodeURIComponent(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a request target names an `/api/v1/` route, read as the routes
 * read it: the target as written (the bundle and Library import routes match
 * it) or the path the URL parser gives it (handlePlatformApiRoute's), which
 * resolves dot segments and reduces an absolute-form target to its path, so
 * `/./api/v1/runs` and `http://host/api/v1/runs` name `/api/v1/runs` too.
 */
function namesPlatformApiRoute(url: string | undefined): boolean {
  if (url === undefined) return false;
  if (url.startsWith('/api/v1/')) return true;
  try {
    return new URL(url, 'http://localhost').pathname.startsWith('/api/v1/');
  } catch {
    return false;
  }
}

function writeJsonError(res: ServerResponse, error: unknown, fallbackStatus = 400): void {
  const status = error instanceof RequestBodyTooLargeError
    ? error.statusCode
    : fallbackStatus;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: String(error) }));
}

/** Resolves when the response can take more, or when it has closed. */
function waitForDrain(res: ServerResponse): Promise<void> {
  return new Promise(resolveDrain => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolveDrain();
    };
    res.on('drain', done);
    res.on('close', done);
  });
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
      leader: import('../runtime/orchestrator/index.js').ActorConfig,
    ) => void | Promise<void>,
    /**
     * The server's runs directory, which each leader's output file is
     * written to, and on the hosted demo the empty environment the run's
     * web search reads its keys from.
     */
    runnerOptions?: RunnerOptions,
  ) => Promise<void>;
  /** Runs a fork's branch (a `/setup` body with `forkFrom`); defaults to the pair runner's `runForkSimulation`. */
  runForkSimulation?: typeof runForkSimulation;
  /** Runs a run of three or more actors; defaults to the pair runner's `runBatchSimulations`. */
  runBatchSimulations?: typeof runBatchSimulations;
  /**
   * The model call behind a saved run's title; defaults to AgentOS's
   * `generateText`. `apiKey` is the run's own key for the title's provider,
   * absent on a host-paid run, which then uses the environment's key. A
   * call on the run's own key carries `fallbackProviders: []`.
   */
  generateText?: (args: { provider: string; model: string; prompt: string; apiKey?: string; fallbackProviders?: [] }) => Promise<{ text: string }>;
  compileScenario?: (scenarioJson: Record<string, unknown>, options: Record<string, unknown>) => Promise<ScenarioPackage>;
  /**
   * The compile behind POST /api/quickstart/compile-from-seed; defaults to
   * the engine's `compileFromSeed`. A test gives a stub that returns a
   * fixture, so no model is called.
   */
  compileFromSeed?: QuickstartDeps['compileFn'];
  scenarioDir?: string;
  /** Max simulations per IP per day. 0 = unlimited. Overrides the RATE_LIMIT env var; with neither set the limit is 1. */
  maxSimsPerDay?: number;
  /**
   * Grace period (ms) between a run's last viewer (an /events stream)
   * leaving and the server cancelling that run. Default 600_000ms (10
   * minutes): a hosted demo run takes about 4 to 5 minutes, and a phone
   * drops its stream as soon as the visitor switches apps, so a shorter
   * grace stops runs whose viewer is coming back. See the watchdog
   * comment in createMarsServer for the case that set it.
   */
  disconnectGraceMs?: number;
  /**
   * Override the idle time of a run. A run nobody has read or watched for
   * longer is let go, its file included, and a run written to disk longer
   * ago is not read back at boot. Production default is 30 minutes;
   * tests inject a small value (e.g. 100ms) to exercise the gate
   * without waiting half an hour.
   */
  staleBufferMs?: number;
  /**
   * Override how long the memory store holds a scenario nobody stored, read
   * by its id or ran (MEMORY_SCENARIO_IDLE_MS, 24 hours). Tests give a small
   * value.
   */
  memoryScenarioIdleMs?: number;
  /**
   * The most runs the server has in flight at once, every visitor's
   * together; a visitor above it is told to wait (503). Overrides the
   * PARACOSM_MAX_RUNS env var; with neither set it is 3.
   */
  maxRuns?: number;
  /**
   * The most finished runs held for their visitors; the oldest goes first.
   * Overrides PARACOSM_MAX_HELD_RUNS; default 10.
   */
  maxHeldRuns?: number;
  /**
   * The most the finished runs' event buffers may hold together, in UTF-16
   * code units of SSE text; the oldest run goes first. Overrides
   * PARACOSM_MAX_HELD_RUN_BYTES; default 67_108_864 (64 MiB).
   */
  maxHeldRunBytes?: number;
  /**
   * Builds or reuses a character's chat agent for /chat. Defaults to the
   * agent pool in runtime/agents/chat-agents.ts; a test passes one that
   * calls no model.
   */
  chatAgent?: typeof import('../runtime/agents/chat-agents.js').getOrCreateChatAgent;
  generateActorObject?: QuickstartDeps['generateActorObject'];
  /**
   * Override the session store instance. Intended for tests; the
   * default production path opens a SQLite store at
   * `${APP_DIR}/data/sessions.db`.
   */
  sessionStore?: SessionStore;
  runHistoryStore?: RunHistoryStore;
  /** Maximum accepted HTTP request body size. Defaults to 5 MiB. */
  maxRequestBodyBytes?: number;
  /**
   * Supplies the digital-twin world in place of compiling
   * scenarios/t2d-glp1-protocol.json, so a test can run the route with a stub
   * engine. Absent: the compile, which calls a model on its first use.
   */
  getDigitalTwinWorld?: () => Promise<WorldModel | null>;
  /**
   * The hosted demo's Google Analytics and Clarity ids. Absent: the ids the
   * dashboard's build wrote into its site-analytics.json
   * (src/server/site-analytics.ts). A test gives made-up ones.
   */
  siteAnalyticsIds?: SiteAnalyticsIds;
  /**
   * Where the hosted demo's `POST /api/event` forwards page views. Absent:
   * the shared Plausible instance (PLAUSIBLE_EVENT_URL). A test gives a
   * local sink, so nothing it sends is counted.
   */
  countEventUrl?: string;
}

/**
 * Optional hooks the /setup handler can pass to startWithConfig so that
 * per-artifact post-flight work (Library-tab record persistence, future
 * webhook notifications, etc.) can run with /setup-handler scope (which
 * is where hasUserKeys, the runRecord base, and the run's scenario
 * already live).
 */
export interface StartConfigHooks {
  /** Count of admitted leaders whose source orders needed filling. */
  filledOrderCount?: number;
  /**
   * The scenario the config was normalized for: the one the /setup body
   * named, a fork's parent's, or the visitor's pick. Absent: the server's
   * default, Mars Genesis.
   */
  scenario?: ScenarioPackage;
  /**
   * The natural-language brief the scenario was compiled from, when it came
   * out of compile-from-seed. It rides on the run's `active_scenario` event
   * into the saved session, whose replay banner shows it.
   */
  seedText?: string | null;
  /**
   * The visitor whose run this is (the `paracosm_visitor` cookie of the
   * request that started it); it replaces that visitor's current run.
   * Absent: the anonymous visitor, whose run every caller without the
   * cookie reads (the CLI's own run is one).
   */
  visitorId?: string;
  /**
   * The client address of a run on the caller's own key; such runs from
   * one address hold at most all but one of the run slots.
   */
  ownKeyAddress?: string | null;
  /**
   * The environment the run's web search reads a search key from when the
   * run's config names none. Omitted, `process.env`; the hosted demo passes
   * `{}`, so its runs search on the request's own search keys alone.
   */
  searchEnv?: NodeJS.ProcessEnv;
  /** The run's key, which its `active_scenario` event carries; minted when absent. */
  runKey?: string;
  /**
   * Fired once per completed leader artifact. Failures inside the hook
   * are caught and logged by the runner; they do not abort the run.
   */
  onArtifact?: (
    artifact: import('../engine/schema/index.js').RunArtifact,
    leader: import('../runtime/orchestrator/index.js').ActorConfig,
  ) => void | Promise<void>;
}

export interface MarsServer extends Server {
  /**
   * Opens a run for `hooks.visitorId` (the anonymous visitor when absent),
   * replacing that visitor's current run, and resolves when the run ends.
   * Throws {@link RunCapacityError} synchronously, before any run opens,
   * when the server already has its most runs in flight; an `await` of the
   * call sees it as a rejection.
   */
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
      const lines = publicResultFrame(msg).split('\n');
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
  const allowedOrigins = serverMode === 'hosted_demo' ? readAllowedOrigins(env) : new Set<string>();
  const allowedHosts = serverMode === 'local_demo' ? readAllowedHosts(env) : new Set<string>();
  // The one directory run output, imported artifacts, run reads, the
  // retention sweep and the output wipe all use.
  const runsDir = resolveRunsDir(env);
  // Visitor analytics run on the hosted demo at paracosm.agentos.sh only; a
  // copy run from the package or a clone sends its pages without them. Each
  // runs only under the visitor's yes to its purpose (src/server/site-analytics.ts).
  const siteAnalytics = serverMode === 'hosted_demo';
  const countEventUrl = options.countEventUrl ?? PLAUSIBLE_EVENT_URL;
  /** When the last failed forward of a page view was logged; one line a minute at most. */
  let countForwardWarnedAt = 0;
  /** The page views forwarded per address this minute, and the forwards open now. */
  const countEventLimit = new CountEventLimit();
  let countForwardsOpen = 0;
  const pickCookieSecure = serverMode === 'hosted_demo';
  /** The visitor whose compile installed each compiled scenario's brief. */
  const compiledBriefOwners = new Map<string, string>();
  /**
   * The brief a compiled scenario came from, for this request: on the hosted
   * demo only the visitor whose compile installed it reads it (a caller with
   * no cookie, or a brief loaded from disk at boot, is read by no one); a
   * local server shows it to its operator.
   */
  const briefFor = (id: string, req: IncomingMessage, seedText: string | null | undefined): string | undefined => {
    if (seedText === null || seedText === undefined) return undefined;
    if (serverMode !== 'hosted_demo') return seedText;
    const visitorId = readVisitorId(req);
    return visitorId !== ANONYMOUS_VISITOR && compiledBriefOwners.get(id) === visitorId ? seedText : undefined;
  };
  /**
   * The key a visitor's saved sessions are stored under: a SHA-256 of their
   * visitor id, so the session store holds no cookie value. The anonymous
   * visitor (every caller that sent no cookie) owns none.
   */
  const sessionOwner = (visitorId: string): string | null => visitorId === ANONYMOUS_VISITOR
    ? null
    : createHash('sha256').update(`paracosm-session-owner:${visitorId}`).digest('hex');
  /**
   * Whether a saved session's brief is kept from this request: on the
   * hosted demo, for a session no admin saved, from every caller but the
   * visitor whose run it was. A session saved with no visitor shows its
   * brief to no caller there.
   */
  const briefHiddenFrom = (session: { meta: { pinned?: boolean }; owner: string | null }, req: IncomingMessage): boolean =>
    serverMode === 'hosted_demo' && !session.meta.pinned
    && (session.owner === null || session.owner !== sessionOwner(readVisitorId(req)));
  /**
   * The visitor a run a request opens belongs to: the request's own
   * visitor, except that on the hosted demo a caller that sent no cookie
   * gets a fresh visitor id (and the Set-Cookie that gives it to them),
   * since the anonymous visitor holds no run there.
   */
  const runVisitorFor = (req: IncomingMessage): { visitorId: string; setCookie: string | null } => {
    const visitorId = readVisitorId(req);
    if (visitorId !== ANONYMOUS_VISITOR || serverMode !== 'hosted_demo') return { visitorId, setCookie: null };
    const fresh = randomUUID();
    return { visitorId: fresh, setCookie: visitorCookie(fresh, pickCookieSecure) };
  };
  // Rate limit default: 1 simulation per IP per day for the public-demo
  // path. Even on DEMO_MODELS + DEMO_EXECUTION a run costs ~$0.40 against
  // the host's keys, so 1/day caps worst-case monthly spend at roughly
  // $30 × unique-daily-IPs. Users who want more runs provide their own
  // key, which fully bypasses rate limiting. Override with RATE_LIMIT
  // env var or maxSimsPerDay option when hosting on your own infra. A
  // RATE_LIMIT that is not a whole number keeps the default, with a warning.
  const maxSims = options.maxSimsPerDay ?? readLimitFromEnv(env, 'RATE_LIMIT', 1);
  const adminWrite = (env.ADMIN_WRITE || 'false').toLowerCase() === 'true';
  // Per-request token gate for /admin/* routes and the disk write of
  // POST /scenario/store. When ADMIN_WRITE=true, ADMIN_TOKEN must be set
  // to a non-empty secret (paracosm fails the request closed otherwise),
  // and the header is compared with it in constant time. The dashboard's
  // Wipe All path sends the token via the `X-Admin-Token` header (read from localStorage,
  // matches the existing key-overrides pattern). Operators set
  // ADMIN_TOKEN once in /opt/paracosm/.env; the dashboard pastes it
  // once into Settings. Drive-by visitors get 401.
  const adminToken = (env.ADMIN_TOKEN || '').trim();
  /**
   * Whether the request carries the admin credential: ADMIN_WRITE on, an
   * ADMIN_TOKEN set, and an X-Admin-Token header that matches it. Writes
   * no answer; requireAdminToken answers a request that does not.
   */
  const holdsAdminToken = (req: IncomingMessage): boolean => {
    if (!adminWrite || !adminToken) return false;
    const headerToken = String(req.headers['x-admin-token'] ?? '').trim();
    return headerToken.length > 0 && adminTokenMatches(headerToken, adminToken);
  };
  /**
   * Whose runs a run-history request reaches. On the hosted demo a visitor
   * reaches the runs recorded under their own owner key, the key their
   * saved sessions are stored under (sessionOwner), so the run list and
   * the saved-session list agree on who a visitor is; a caller that sent
   * no cookie reaches none, and the admin credential reaches every run. A
   * local server and the platform API reach every run.
   */
  const runScopeFor = (req: IncomingMessage): RunScope | undefined => (
    serverMode !== 'hosted_demo' || holdsAdminToken(req)
      ? undefined
      : { owner: sessionOwner(readVisitorId(req)) }
  );
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
    if (!holdsAdminToken(req)) {
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
  // A hosted install keeps administrator saves in its writable state tree.
  const scenarioStoreDir = env.PARACOSM_SCENARIO_STORE_DIR
    ? resolve(env.PARACOSM_SCENARIO_STORE_DIR)
    : scenarioDir;
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
  const chatPerHour = readLimitFromEnv(env, 'CHAT_RATE_LIMIT', 30);
  // Global /chat cap (hourly, across all IPs). Defends against IP
  // rotation: even if an attacker burns a fresh per-IP quota every
  // request via a proxy pool, they can't exceed the aggregate budget
  // for the host's chat traffic. 500/hr ≈ $1-2 worst-case host spend
  // per hour. Override via CHAT_RATE_LIMIT_GLOBAL.
  const chatGlobalPerHour = readLimitFromEnv(env, 'CHAT_RATE_LIMIT_GLOBAL', 500);
  const rateLimiter = maxSims > 0
    ? new IpRateLimiter(maxSims, 5, chatPerHour, rateLimitStatePath, chatGlobalPerHour)
    : null;
  // The header the proxy in front of the server sets to the client's
  // address (PARACOSM_CLIENT_IP_HEADER). Unset: the connection's address.
  const clientIpHeader = readClientIpHeader(env);

  /** The most web searches one /compile runs on the hosted demo. */
  const HOSTED_COMPILE_MAX_SEARCHES = 5;

  /**
   * The Quickstart routes' limits on the hosted demo, where every
   * Quickstart call bills the host's keys (the routes take no caller key):
   * a compile counts against the caller's daily compile limit, as /compile
   * does;
   * the grounding, actor and URL routes against a daily Quickstart limit of
   * their own; a Digital Twin run against the day's run limit, as /setup
   * does, on the demo's turn cap and the economy tier. Elsewhere the
   * operator's keys pay.
   */
  const quickstartHostLimits = (req: IncomingMessage): QuickstartDeps['hostLimits'] => {
    const limiter = rateLimiter;
    if (serverMode !== 'hosted_demo' || !limiter) return undefined;
    const ip = IpRateLimiter.getIp(req, clientIpHeader);
    const refusal = (decision: { limit: number; resetAt: number }, what: string, retryAfter: string): QuickstartRefusal => ({
      status: 429,
      headers: {
        'Retry-After': retryAfter,
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(decision.resetAt / 1000)),
      },
      body: { error: `Rate limit exceeded. Maximum ${decision.limit} ${what} per day.`, limit: decision.limit, remaining: 0, resetAt: decision.resetAt },
    });
    return {
      admitCompile: () => {
        const decision = limiter.consumeCompile(ip);
        if (decision.allowed) return null;
        console.log(`  [rate-limit] Quickstart compile blocked (${decision.limit}/${decision.limit} used)`);
        return refusal(decision, 'compiles', String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))));
      },
      admitCall: () => {
        const decision = limiter.consumeQuickstart(ip);
        if (decision.allowed) return null;
        console.log(`  [rate-limit] Quickstart call blocked (${decision.limit}/${decision.limit} used)`);
        return refusal(decision, 'Quickstart grounding, actor and URL requests', String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))));
      },
      run: {
        admit: () => {
          const decision = limiter.check(ip);
          if (!decision.allowed) {
            console.log(`  [rate-limit] Digital Twin run blocked (${decision.limit}/${decision.limit} used)`);
            return refusal(decision, 'simulations', '86400');
          }
          limiter.record(ip);
          return null;
        },
        refund: () => limiter.unrecord(ip),
      },
      maxTurns: DEMO_EXECUTION.maxTurns,
      maxActors: DEMO_EXECUTION.maxActors,
    };
  };

  // Concurrent-/chat limiter: hard cap on in-flight LLM calls. Stops
  // a burst of N parallel POSTs from spawning N parallel LLM calls
  // before any per-IP / global counter has had a chance to throw.
  // Excess requests get a 429 (clients can retry); we don't queue
  // because long queues hide the back-pressure from clients.
  const chatConcurrencyCap = readLimitFromEnv(env, 'CHAT_CONCURRENCY', 4);
  let chatInflight = 0;

  // What /results and /chat read from a run's buffer, kept per run until
  // the buffer changes, so a reader polling a finished run does not parse
  // every frame again on each request. A buffer only grows, or is trimmed
  // as a frame is added, so its length, size and last frame say whether it
  // changed.
  interface BufferRead<T> { length: number; bytes: number; last: string | undefined; value: T }
  const resultsByRun = new WeakMap<LiveRun, BufferRead<ReturnType<typeof buildResultsPayloadFromEventBuffer>>>();
  const simEventsByRun = new WeakMap<LiveRun, BufferRead<any[]>>();
  const readBuffer = <T>(cache: WeakMap<LiveRun, BufferRead<T>>, run: LiveRun, build: (buffer: readonly string[]) => T): T => {
    const last = run.buffer[run.buffer.length - 1];
    const held = cache.get(run);
    if (held && held.length === run.buffer.length && held.bytes === run.bytes && held.last === last) return held.value;
    const value = build(run.buffer);
    cache.set(run, { length: run.buffer.length, bytes: run.bytes, last, value });
    return value;
  };
  const resultsOf = (run: LiveRun) => readBuffer(resultsByRun, run, buildResultsPayloadFromEventBuffer);
  const simEventsOf = (run: LiveRun) => readBuffer(simEventsByRun, run, buffer => buffer
    .filter(msg => msg.startsWith('event: sim\n'))
    .map(msg => { try { return JSON.parse(msg.split('data: ')[1]); } catch { return null; } })
    .filter(Boolean));

  // New runs one client address may import a day (UTC):
  // PARACOSM_IMPORTS_PER_DAY, 500 by default. A run id the store already
  // holds is not counted.
  const maxImportsPerDay = readLimitFromEnv(env, 'PARACOSM_IMPORTS_PER_DAY', 500);
  const importsByAddress = new Map<string, { count: number; resetAt: number }>();
  const sweepImports = (): void => {
    const now = Date.now();
    for (const [address, entry] of importsByAddress) {
      if (now >= entry.resetAt) importsByAddress.delete(address);
    }
  };
  const importCleanupTimer = setInterval(sweepImports, 60 * 60 * 1000);
  importCleanupTimer.unref?.();
  const admitImport = (address: string): boolean => {
    const now = Date.now();
    let entry = importsByAddress.get(address);
    if (!entry || now >= entry.resetAt) {
      if (importsByAddress.size >= 10_000) {
        sweepImports();
      }
      const resetAt = new Date(now);
      resetAt.setUTCHours(24, 0, 0, 0);
      entry = { count: 0, resetAt: resetAt.getTime() };
      importsByAddress.set(address, entry);
    }
    if (entry.count >= maxImportsPerDay) return false;
    entry.count += 1;
    return true;
  };

  // Open event streams (/events and session replays): at most
  // PARACOSM_MAX_STREAMS_PER_ADDRESS from one client address (32) and
  // PARACOSM_MAX_STREAMS in all (2000). A stream over either answers 429;
  // a stream's slot is given back when its response closes.
  const maxStreamsPerAddress = readLimitFromEnv(env, 'PARACOSM_MAX_STREAMS_PER_ADDRESS', 32);
  const maxStreams = readLimitFromEnv(env, 'PARACOSM_MAX_STREAMS', 2000);
  const openStreamsByAddress = new Map<string, number>();
  let openStreams = 0;
  const admitStream = (req: IncomingMessage, res: ServerResponse, headers: Record<string, string>): boolean => {
    // A reader that left before its stream starts (a replay waits for its
    // session to load) has nothing to hold, and its response's 'close'
    // has already fired, so a slot taken now would never be given back.
    if (res.destroyed || res.closed || req.destroyed) return false;
    const address = IpRateLimiter.getIp(req, clientIpHeader);
    const held = openStreamsByAddress.get(address) ?? 0;
    if (held >= maxStreamsPerAddress || openStreams >= maxStreams) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '10', ...headers });
      res.end(JSON.stringify({
        error: 'Too many open streams. Close another tab or try again shortly.',
        limit: held >= maxStreamsPerAddress ? maxStreamsPerAddress : maxStreams,
      }));
      return false;
    }
    openStreamsByAddress.set(address, held + 1);
    openStreams += 1;
    res.once('close', () => {
      const left = (openStreamsByAddress.get(address) ?? 1) - 1;
      if (left > 0) openStreamsByAddress.set(address, left);
      else openStreamsByAddress.delete(address);
      openStreams -= 1;
    });
    return true;
  };

  // Output retention: sweep run output (v3-*.json, imported copies
  // included) older than OUTPUT_RETENTION_DAYS from the runs directory
  // on boot. Other files there are left alone: PARACOSM_OUTPUT_DIR can
  // name a directory that holds more than run output.
  // The directory otherwise grows unbounded (~300KB per run × N daily runs = GB over months).
  // Default 30 days. Set to 0 to disable the sweep. Non-fatal on any
  // filesystem error — missing dir is fine, permission denied is
  // logged once and skipped.
  (() => {
    const retentionDays = parseInt(env.OUTPUT_RETENTION_DAYS || '30', 10);
    if (retentionDays <= 0) return;
    const outputDir = runsDir;
    if (!existsSync(outputDir)) return;
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      for (const name of readdirSync(outputDir)) {
        if (!isRunOutputFileName(name)) continue;
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
  // There is no server-wide scenario. Each request runs in or reads the
  // scenario it names, else the visitor's pick (the paracosm_scenario
  // cookie), else Mars Genesis; see resolveRequestScenario. Nor is there a
  // server-wide run: each visitor's run is their own (liveRuns).
  //
  // The runs are read back from disk first, before the scenario catalog
  // loads, so the idle time of a run read back counts from the boot itself.

  // Runs nobody has read or watched for STALE_BUFFER_MS are let go, and a
  // run written to disk longer ago than that is not read back at boot: a
  // run that has not moved in 30 minutes is terminal in practice (complete
  // and walked away, aborted and walked away, or crashed mid-run).
  // Replaying one of those to its visitor surfaces an "Interrupted" badge,
  // a stale turn counter and a leftover cost meter on the dashboard's first
  // paint, which was an audit's P0 finding. Completed runs a visitor wants
  // to revisit live in sessions.db through the auto-save path; that store
  // is canonical for replay, the live runs are not.
  const STALE_BUFFER_MS = options.staleBufferMs ?? 30 * 60 * 1000;
  const visitorKeyIdleMinutes = STALE_BUFFER_MS / 60_000;
  let chatAgentPool: typeof import('../runtime/agents/chat-agents.js') | undefined;

  // Bound each run's event buffer. At 300 actors × 20 turns a buffer
  // approaches 100k events at ~1-3KB per SSE message: 150MB+ resident in
  // the Node process plus a same-size file on disk. Once growth crosses the
  // trim threshold the oldest events go FIFO down to the cap, so live
  // clients keep seeing the most recent N events while late reconnects miss
  // the earliest. Configurable via env to let operators size against their
  // box and typical cohort load.
  const EVENT_BUFFER_MAX_ENTRIES = (() => {
    const raw = env.PARACOSM_EVENT_BUFFER_MAX;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    // Floor at 1 (cap=0 would mean "drop every event" which makes the
    // SSE replay path useless). No upper floor — operators sizing
    // against a small box are free to drop to 5_000 or so.
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 100_000;
  })();

  // --- Cancel-on-disconnect watchdog ---------------------------------
  //
  // While a run is in flight, watch for its viewers (the /events streams
  // of its visitor, or the streams that named it) going to none. If they
  // stay at none for `disconnectGraceMs`, the run is aborted so the server
  // stops burning API credits on work nobody is watching. A run that never
  // had a viewer (the CLI's own run, a /setup from curl) is never stopped
  // this way.
  //
  // The run's buffer stays intact: a returning visitor reconnects, sees
  // all events up to the cancellation point, and the dashboard labels the
  // run "Unfinished" via the sim_aborted SSE event the orchestrator emits
  // on cancel.
  //
  // The grace period covers a viewer who leaves and comes back: a
  // refresh, an internal link, or a phone that drops its EventSource
  // the moment the visitor switches apps. The default is 10 minutes.
  // A hosted demo run takes about 4 to 5 minutes (30 October 2026:
  // 20:24:31 to 20:29:11 UTC). With the earlier 30 s grace, on 31
  // October 2026 a phone visitor's second /events stream ended 26 s
  // after POST /setup, nothing reconnected, and the watchdog aborted
  // the run about 30 s later after one turn, with nothing saved. Ten
  // minutes outlasts a whole demo run, so a viewer who returns finds it
  // finished, and a run nobody returns to still stops. The spend a
  // longer grace allows is bounded: the hosted demo caps a run at 6
  // turns on the economy profile, and the per-IP limit (50 runs a day on
  // the hosted server) caps how many one visitor can start. At that cap
  // a demo pair cost 0.7397 USD on 1 November 2026 (0.2898 and 0.4499
  // for its two leaders) and 1.6138 USD on 30 October 2026 (1.0529 and
  // 0.5609). The per-LLM-call abort gates in the orchestrator
  // still let at most one in-flight call finish after the watchdog
  // trips.
  const disconnectGraceMs = options.disconnectGraceMs ?? 600_000;

  // Each visitor's run, with its own buffer, viewers, watchdog and flags
  // (live-runs.ts). The server runs at most PARACOSM_MAX_RUNS at once (3):
  // a hosted demo pair cost 2.2498 USD over about six and a half minutes
  // on 2 November 2026, so three in flight is at most three times the rate
  // of the one run at a time the server held before; the per-IP day limit
  // still bounds each visitor. Finished runs are held for their visitors,
  // at most PARACOSM_MAX_HELD_RUNS (10) of them and PARACOSM_MAX_HELD_RUN_BYTES
  // (64 MiB) of buffers, and written to ${APP_DIR}/.live-runs/ so a restart
  // (a deploy, a pm2 reload, a crash) does not evaporate a finished run from
  // its visitor's /chat and /results.
  let legacyBufferPath = resolve(env.APP_DIR || '.', '.event-buffer.json');
  // A root-owned application directory may expose a link to writable state.
  // Delete the legacy data there while leaving the application tree alone.
  try { legacyBufferPath = realpathSync(legacyBufferPath); } catch { /* no legacy data */ }
  const liveRuns = new LiveRunRegistry({
    dir: resolve(env.APP_DIR || '.', '.live-runs'),
    legacyBufferPath,
    maxRuns: Math.max(1, options.maxRuns ?? readLimitFromEnv(env, 'PARACOSM_MAX_RUNS', 3)),
    maxHeldRuns: options.maxHeldRuns ?? readLimitFromEnv(env, 'PARACOSM_MAX_HELD_RUNS', 10),
    maxHeldRunBytes: options.maxHeldRunBytes ?? readLimitFromEnv(env, 'PARACOSM_MAX_HELD_RUN_BYTES', 67_108_864),
    staleMs: STALE_BUFFER_MS,
    disconnectGraceMs,
    bufferMaxEntries: EVENT_BUFFER_MAX_ENTRIES,
    // A visitor with no run of their own watches the anonymous run so the
    // browser that opens the CLI's dashboard sees the CLI's run. The hosted
    // demo has no such run: an anonymous run there is a cookieless caller's,
    // and no visitor's page shows it.
    shareAnonymousRun: serverMode !== 'hosted_demo',
    // On simulation completion, snapshot the run's schema-retry payload to
    // the cross-run ring so /retry-stats can aggregate across production
    // runs, and save a clean run to the session ring.
    onComplete: run => {
      captureRetrySnapshot(run);
      autoSaveOnComplete(run).catch((err) => {
        console.error('[sessions] auto-save failed:', err);
      });
    },
    // A dropped run's chat agents (their memories and histories) go with it.
    onDrop: run => {
      chatAgentPool?.clearPool(run.key);
    },
  });

  // The scenario JSON each visitor stored through POST /scenario/store
  // without a disk write, by visitor (the paracosm_visitor cookie; every
  // caller with no cookie is the one anonymous visitor), then by id. A
  // visitor's stored scenarios are theirs alone: they never enter the
  // catalog below, so no other visitor lists, reads or runs them. Held at
  // most MEMORY_SCENARIOS_PER_VISITOR a visitor, MEMORY_SCENARIOS_PER_ADDRESS
  // an address and MEMORY_SCENARIOS_CAP in all, each until it has gone
  // unused for the idle time or its id enters the catalog (enterCatalog).
  interface MemoryScenario {
    scenario: unknown;
    /** The address that first stored it (IpRateLimiter.getIp), for the per-address count. */
    address: string;
    /** When it was last stored, read by its id or run. */
    usedAt: number;
  }
  const memoryScenarios = new Map<string, Map<string, MemoryScenario>>();
  let memoryScenarioCount = 0;
  const memoryScenarioIdleMs = options.memoryScenarioIdleMs ?? MEMORY_SCENARIO_IDLE_MS;
  /** Drops `id` from one visitor's store. */
  const dropMemoryScenario = (visitorId: string, id: string): boolean => {
    const own = memoryScenarios.get(visitorId);
    if (!own?.delete(id)) return false;
    memoryScenarioCount -= 1;
    if (own.size === 0) memoryScenarios.delete(visitorId);
    return true;
  };
  /** Drops `id` from every visitor's store and returns how many held it. */
  const dropFromEveryMemoryStore = (id: string): number => {
    let dropped = 0;
    for (const visitorId of [...memoryScenarios.keys()]) {
      if (dropMemoryScenario(visitorId, id)) dropped += 1;
    }
    return dropped;
  };
  /** Drops every stored scenario past the idle time. The store holds 100 at most, so each read of it runs this. */
  const dropIdleMemoryScenarios = (): void => {
    const cutoff = Date.now() - memoryScenarioIdleMs;
    for (const [visitorId, own] of [...memoryScenarios]) {
      for (const [id, held] of [...own]) {
        if (held.usedAt < cutoff) dropMemoryScenario(visitorId, id);
      }
    }
  };
  const ownMemoryScenarios = (req: IncomingMessage): Map<string, MemoryScenario> | undefined => {
    dropIdleMemoryScenarios();
    return memoryScenarios.get(readVisitorId(req));
  };
  // Runnable scenarios that can appear in the catalog and be switched to.
  // Disk-loaded + builtins register into the SAME map so the switch /
  // list / active-derivation code is universal — no hardcoded branches
  // for specific IDs. New builtins ship by adding one more
  // customScenarioCatalog.set(id, { scenario, source: 'builtin' }) here.
  const customScenarioCatalog = loadDiskCustomScenarios(scenarioDir);
  if (scenarioStoreDir !== scenarioDir) {
    for (const [id, entry] of loadDiskCustomScenarios(scenarioStoreDir)) {
      customScenarioCatalog.set(id, entry);
    }
  }
  // The two builtins are JSON as well. src/engine/scenarios/index.ts lifts
  // scenarios/mars.json and scenarios/lunar.json, with their knowledge
  // bundles, when it is imported, and the per-agent physics the data-driven
  // hooks DSL cannot express (radiation dose and bone-density decay on Mars,
  // regolith exposure and atrophy under 1/6 g on the Moon) is the
  // src/engine/physics module each file names in
  // `dataDrivenHooks.progressionPhysics`. They register as 'builtin', in
  // place of any entry the disk loader made from the same files, because
  // the package exports them, a fresh server starts on Mars, and the
  // catalog refuses to rename or delete a builtin. Every other scenario in
  // `scenarios/` is lifted at boot by `loadDiskCustomScenarios` →
  // `liftDataDrivenDraft` → `buildDataDrivenHooksFromJson`, so a new one is
  // a JSON file checked into `scenarios/`.
  customScenarioCatalog.set(marsScenario.id, { scenario: marsScenario, source: 'builtin' });
  customScenarioCatalog.set(lunarScenario.id, { scenario: lunarScenario, source: 'builtin' });

  // Persistence metadata for compile-from-seed scenarios — keyed by
  // scenario id. Carries `compiledAt` + truncated `seedText` so the
  // /scenarios endpoint can render "compiled 3 days ago from a brief
  // about ..." without re-deriving from the scenario body. Populated
  // both at boot (from on-disk persisted drafts) and at runtime (when
  // a fresh compile-from-seed completes). Plain Map<id, meta> rather
  // than a CustomScenarioEntry extension so the existing entry shape
  // and every consumer of `customScenarioCatalog` stays unchanged.
  const compiledScenarioMeta = new Map<string, PersistedCompiledMeta>();
  const compiledEntryInfo = new Map<string, { enteredAt: number; address: string | null }>();
  // Digests keep each retired id the same size, regardless of its length.
  const retiredScenarioIds = new Map<string, number>();
  const pruneRetiredScenarioIds = (): void => {
    const now = Date.now();
    for (const [digest, retiredAt] of retiredScenarioIds) {
      if (now - retiredAt < RETIRED_SCENARIO_ID_MS) break;
      retiredScenarioIds.delete(digest);
    }
  };

  // Ids of the persisted compiled drafts boot is still re-compiling. Filled
  // before the first compile starts and emptied one id at a time as each
  // lands in the catalog or fails. A visitor whose pick is one of them is
  // told to wait (503 with Retry-After) instead of being run in Mars
  // Genesis: the first reload after a deploy would otherwise answer Mars,
  // and the page would stop retrying and run Mars against a valid pick.
  const hydratingScenarioIds = new Set<string>();

  /**
   * Puts a scenario in the catalog every visitor reads. Its id leaves every
   * visitor's memory store: from here on the id names the catalog's entry
   * (lookupScenario reads the catalog first), so a stored copy would be
   * hidden and would still count toward its visitor's and the store's caps.
   */
  const enterCatalog = (id: string, entry: CustomScenarioEntry): void => {
    customScenarioCatalog.set(id, entry);
    dropFromEveryMemoryStore(id);
  };

  /** The saved drafts that folder clean-up must keep. */
  const keep = (id: string): boolean =>
    customScenarioCatalog.get(id)?.source === 'compiled' || hydratingScenarioIds.has(id);

  /** Removes one compiled entry or waiting draft and retires its id. */
  const evictCompiled = (id: string): void => {
    const entry = customScenarioCatalog.get(id);
    if (entry?.source === 'compiled') customScenarioCatalog.delete(id);
    hydratingScenarioIds.delete(id);
    compiledScenarioMeta.delete(id);
    compiledBriefOwners.delete(id);
    groundingCitationsByScenarioId.delete(id);
    compiledEntryInfo.delete(id);
    deletePersistedCompiledScenario(scenarioDir, id);
    pruneRetiredScenarioIds();
    const digest = createHash('sha256').update(id).digest('hex');
    retiredScenarioIds.delete(digest);
    retiredScenarioIds.set(digest, Date.now());
    if (entry?.source === 'compiled') endFinishedJobsOf(entry.scenario);
    console.log(`[scenarios] ${JSON.stringify(id)} left the catalog to keep it at ${COMPILED_SCENARIOS_CAP} compiled scenarios`);
  };

  /** Makes room after a compile, preserving the new entry and every run's scenario. */
  const makeRoomAfter = (enteredId: string): void => {
    const compiledIds = new Set([
      ...[...customScenarioCatalog].filter(([, entry]) => entry.source === 'compiled').map(([id]) => id),
      ...[...hydratingScenarioIds].filter(id => !customScenarioCatalog.has(id)),
    ]);
    const protectedIds = liveRuns.scenarioIdsInRuns();
    while (compiledIds.size > COMPILED_SCENARIOS_CAP) {
      const addressCounts = new Map<string, number>();
      if (serverMode === 'hosted_demo') {
        for (const id of compiledIds) {
          const address = compiledEntryInfo.get(id)?.address;
          if (address != null) addressCounts.set(address, (addressCounts.get(address) ?? 0) + 1);
        }
      }
      // Map order breaks equal timestamps. Null addresses each hold one.
      let oldest: { id: string; enteredAt: number; count: number } | undefined;
      for (const [id, info] of compiledEntryInfo) {
        if (!compiledIds.has(id) || id === enteredId || protectedIds.has(id)) continue;
        const count = serverMode === 'hosted_demo' && info.address !== null
          ? addressCounts.get(info.address) ?? 1 : 1;
        if (!oldest || count > oldest.count || (count === oldest.count && info.enteredAt < oldest.enteredAt)) {
          oldest = { id, enteredAt: info.enteredAt, count };
        }
      }
      if (!oldest) {
        console.log(`[scenarios] kept ${compiledIds.size} compiled scenarios, over the cap of ${COMPILED_SCENARIOS_CAP}: every other one is in a run the server holds`);
        break;
      }
      evictCompiled(oldest.id);
      compiledIds.delete(oldest.id);
    }
  };

  /**
   * Whether `id` already names a scenario for someone other than
   * `visitorId` alone: the catalog holds it (a built-in, a curated or a
   * compiled scenario, which any visitor may have picked), boot is still
   * re-compiling it, its retired digest is held for a recent eviction, or
   * another visitor holds it in memory. A compile never
   * lands under such an id, so it never changes what an id already names
   * for another visitor.
   */
  const scenarioIdTaken = (visitorId: string, id: string): boolean => {
    if (customScenarioCatalog.has(id) || hydratingScenarioIds.has(id)) return true;
    pruneRetiredScenarioIds();
    const retiredAt = retiredScenarioIds.get(createHash('sha256').update(id).digest('hex'));
    if (retiredAt !== undefined && Date.now() - retiredAt < RETIRED_SCENARIO_ID_MS) return true;
    dropIdleMemoryScenarios();
    for (const [holder, own] of memoryScenarios) {
      if (holder !== visitorId && own.has(id)) return true;
    }
    return false;
  };

  // Boot-time restore of persisted compile-from-seed scenarios, in the
  // background: server boot doesn't await it, so the listen() port never
  // waits on it. Each saved scenario's hooks are rebuilt from the sources
  // saved with it, or for a file written before files carried them, from
  // the compiler's disk cache under the model that wrote them, with no
  // model call and on any host, whatever provider keys it holds
  // (`restore` in CompileOptions). Only a saved draft whose hooks neither
  // holds is compiled again, at the going rate (50 drafts x 30s LLM each
  // when every one is cold). As each one resolves the scenario lands in
  // the catalog and shows up in subsequent /scenarios responses.
  void (async () => {
    let saved;
    try {
      saved = loadPersistedCompiledDrafts(scenarioDir);
    } catch (err) {
      console.warn('[scenarios] loadPersistedCompiledDrafts failed:', err);
      return;
    }
    // A saved draft never takes the place of a scenario the catalog already
    // holds (a built-in or one from the scenarios folder): it is left out,
    // uncompiled, and the catalog's scenario stays.
    const drafts = saved.filter(({ id }) => {
      if (!customScenarioCatalog.has(id)) return true;
      console.warn(`[scenarios] left out the persisted compiled draft ${id}: the catalog already holds a scenario under that id`);
      return false;
    });
    if (drafts.length === 0) return;
    for (const { id, meta } of drafts) {
      hydratingScenarioIds.add(id);
      compiledEntryInfo.set(id, { enteredAt: Date.parse(meta.compiledAt) || 0, address: null });
    }
    console.log(`[scenarios] restoring ${drafts.length} persisted compiled draft(s) from disk…`);
    // Wrap the dynamic import + per-draft loop in its own try-catch
    // so a module-resolution failure (deploy with broken compiler
    // bundle, fs hiccup) doesn't surface as an unhandled promise
    // rejection on the top-level IIFE — the catalog stays at builtins
    // only and the server keeps serving live runs.
    //
    // Honor `options.compileScenario` when present (existing
    // injection seam used by the digital-twin path; tests can plug
    // in a stub compiler that returns a fixture without LLM cost).
    // Fallback dynamically-imports the real compileScenario for
    // the production happy path.
    // On the hosted demo the host's keys pay for a compile here, which runs
    // only for a draft whose hooks are neither saved nor cached, so it runs
    // on OpenAI and falls back to no other provider (hosted-model-policy.ts);
    // a host with no OpenAI key leaves such a draft out. A restore resolves
    // no provider, so the routing does not touch it.
    const hostedCompileRouting = serverMode === 'hosted_demo' ? { provider: 'openai' as const, stayOnProvider: true } : {};
    try {
      const compileScenario = options.compileScenario
        ?? (await import('../engine/compiler/index.js')).compileScenario;
      for (const { id, draft, meta, hookSources } of drafts) {
        try {
          if (!hydratingScenarioIds.has(id)) {
            console.log(`[scenarios] left out the persisted compiled draft ${id}: it left the catalog while boot re-compiled it`);
            continue;
          }
          const compiled = await compileScenario(draft as Record<string, unknown>, {
            cache: true,
            ...hostedCompileRouting,
            restore: hookSources ? { hookSources } : {},
          });
          if (!hydratingScenarioIds.has(id)) {
            console.log(`[scenarios] left out the persisted compiled draft ${id}: it left the catalog while boot re-compiled it`);
            continue;
          }
          // Checked again under the compiled id: an earlier draft of this
          // loop, or a scenario saved while this one compiled, may hold it.
          if (customScenarioCatalog.has(compiled.id)) {
            console.warn(`[scenarios] left out the persisted compiled draft ${id}: the catalog already holds a scenario under that id`);
            continue;
          }
          enterCatalog(compiled.id, { scenario: compiled, source: 'compiled' });
          if (compiled.id !== id) {
            compiledEntryInfo.set(compiled.id, compiledEntryInfo.get(id)!);
            hydratingScenarioIds.delete(id);
          }
          compiledScenarioMeta.set(compiled.id, meta);
          makeRoomAfter(compiled.id);
          console.log(`[scenarios] hydrated ${compiled.id} (${meta.compiledAt})`);
        } catch (err) {
          console.warn(`[scenarios] failed to re-compile persisted draft ${id}:`, err);
        } finally {
          hydratingScenarioIds.delete(id);
          if (customScenarioCatalog.get(id)?.source !== 'compiled') compiledEntryInfo.delete(id);
        }
      }
    } catch (err) {
      console.warn('[scenarios] compiler import failed during hydration:', err);
    } finally {
      // Nothing is loading any more: a pick that never landed reads as
      // unknown, so its visitor gets the default.
      for (const id of hydratingScenarioIds) {
        if (customScenarioCatalog.get(id)?.source !== 'compiled') compiledEntryInfo.delete(id);
      }
      hydratingScenarioIds.clear();
    }
  })();

  type ScenarioResolution =
    | { scenario: ScenarioPackage }
    | { unknown: string }
    | { notRunnable: string }
    | { loading: string };

  /**
   * The scenario a request runs in or reads. In order: an id the request
   * names (`explicitId`: ?id= on GET /scenario, the /setup body's
   * scenarioId or quickstart.scenarioId, the id /scenario/switch is given),
   * else a fork's parent's (`parentId`), else the visitor's pick, else the
   * server's default, Mars Genesis, which never changes at run time.
   *
   * A named id must be in the catalog. A pick that is not (a deleted or
   * unknown id) reads as no pick, so its visitor gets the default. An id
   * boot is still re-compiling answers `loading` either way.
   */
  const resolveRequestScenario = (req: IncomingMessage, explicitId?: unknown, parentId?: unknown): ScenarioResolution => {
    const named = typeof explicitId === 'string' ? explicitId : typeof parentId === 'string' ? parentId : null;
    if (named !== null) {
      const scenario = lookupScenario(req, named);
      if (scenario) return { scenario };
      if (hydratingScenarioIds.has(named)) return { loading: named };
      if (ownMemoryScenarios(req)?.has(named)) return { notRunnable: named };
      return { unknown: named };
    }
    const picked = readVisitorScenarioId(req);
    if (picked !== null) {
      const scenario = lookupScenario(req, picked);
      if (scenario) return { scenario };
      if (hydratingScenarioIds.has(picked)) return { loading: picked };
    }
    return { scenario: marsScenario };
  };

  /**
   * The runnable scenario `id` names for this request: the catalog's, which
   * every visitor shares, else one this visitor stored in memory. A
   * visitor's stored scenario never shadows a catalog entry.
   */
  function lookupScenario(req: IncomingMessage, id: string): ScenarioPackage | undefined {
    const entry = customScenarioCatalog.get(id);
    if (entry) return entry.scenario;
    const held = ownMemoryScenarios(req)?.get(id);
    if (!held || !isRunnableScenarioPackage(held.scenario)) return undefined;
    held.usedAt = Date.now();
    return held.scenario;
  }

  /** Answers a request whose scenario did not resolve: 503 while it loads, 400 otherwise. */
  const writeScenarioRefusal = (
    res: ServerResponse,
    refusal: Exclude<ScenarioResolution, { scenario: ScenarioPackage }>,
    headers: Record<string, string> = {},
  ): void => {
    if ('loading' in refusal) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5', ...headers });
      res.end(JSON.stringify({ error: `Scenario ${refusal.loading} is still loading after a restart. Try again in a few seconds.` }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json', ...headers });
    if ('notRunnable' in refusal) {
      res.end(JSON.stringify({
        error: `Scenario "${refusal.notRunnable}" is stored but not runnable: it is a source JSON (missing hooks, world, or canonical policies shape). Click Compile in the Scenario Editor to generate its hooks first.`,
        storedButUnrunnable: true,
        id: refusal.notRunnable,
      }));
      return;
    }
    res.end(JSON.stringify({ error: `Unknown scenario: ${refusal.unknown}. Use /compile or /scenario/store for custom scenarios.` }));
  };

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
  // The first request that finds no world compiles one and the server
  // keeps it; later requests reuse the same WorldModel, so a series of
  // digital-twin runs costs one compile. A kept world is served to every
  // request: it holds no key, and serving it calls no model.
  //
  // Off the hosted demo the compile runs on the server's keys, on OpenAI
  // with the compiler's own fallback, and one compile in flight serves
  // every request that arrives before it ends.
  //
  // On the hosted demo the compile is a model call of the request that
  // finds no world, routed as that request's other calls are
  // (hosted-model-policy.ts): on the visitor's key and that key's provider
  // when the request brought one, else on the host's OpenAI key, with the
  // Quickstart model of its provider and no fallback to another provider.
  // A compile in flight serves only the requests the same key pays for
  // (the provider and a fingerprint of its key, `env` for the host's); a
  // request another key pays for starts a compile of its own. A compile
  // that fails is not kept, so it fails no later request, and its own
  // request runs in the world another request's compile has left meanwhile,
  // when one has. At most MAX_DIGITAL_TWIN_COMPILES compiles run at once,
  // whoever pays: a request past them starts none, waits for them to end
  // and runs in the world they leave.
  let digitalTwinWorld: WorldModel | null = null;
  const digitalTwinCompiles = new Map<string, Promise<WorldModel | null>>();
  const MAX_DIGITAL_TWIN_COMPILES = 4;
  const compileDigitalTwinWorld = async (calls: QuickstartModelCalls | undefined): Promise<WorldModel | null> => {
    const scenarioPath = resolve(scenarioDir, 't2d-glp1-protocol.json');
    if (!existsSync(scenarioPath)) {
      console.log(`  [digital-twin] Scenario file missing: ${scenarioPath}`);
      return null;
    }
    try {
      const raw = JSON.parse(readFileSync(scenarioPath, 'utf-8')) as Record<string, unknown>;
      const compiled = await compileScenarioReal(raw, calls
        ? {
            provider: calls.provider,
            model: calls.model,
            cache: true,
            ...(calls.apiKey ? { apiKey: calls.apiKey } : {}),
            ...(calls.anthropicKey ? { anthropicKey: calls.anthropicKey } : {}),
            stayOnProvider: true,
          }
        : { provider: 'openai', model: 'gpt-5.4-mini', cache: true });
      // Two compiles on different keys may both end: the first one's world is kept.
      digitalTwinWorld ??= WorldModel.fromScenario(compiled);
      console.log(`  [digital-twin] Compiled + cached ${compiled.id} (${compiled.labels?.name ?? 'unnamed'})`);
      return digitalTwinWorld;
    } catch (err) {
      console.error('  [digital-twin] Compile failed:', err);
      // The world a compile on another key left while this one ran, if any.
      return digitalTwinWorld;
    }
  };
  const getDigitalTwinWorld = (calls?: QuickstartModelCalls): Promise<WorldModel | null> => {
    if (options.getDigitalTwinWorld) return options.getDigitalTwinWorld();
    if (digitalTwinWorld) return Promise.resolve(digitalTwinWorld);
    const hostedDemo = serverMode === 'hosted_demo';
    // On the hosted demo nothing is compiled for a caller with no routing.
    if (hostedDemo && !calls) return Promise.resolve(null);
    const routed = hostedDemo ? calls : undefined;
    const payer = routed
      ? `${routed.provider}:${credentialFingerprint(apiKeyForProvider(routed.provider, routed))}`
      : 'server';
    const inFlight = digitalTwinCompiles.get(payer);
    if (inFlight) return inFlight;
    // Each key could otherwise start a compile of its own with no bound.
    if (digitalTwinCompiles.size >= MAX_DIGITAL_TWIN_COMPILES) {
      return Promise.all([...digitalTwinCompiles.values()]).then(() => digitalTwinWorld);
    }
    const compile = compileDigitalTwinWorld(routed);
    digitalTwinCompiles.set(payer, compile);
    // `compile` never rejects. It leaves the map once it has ended, whatever
    // its result: a world is read from `digitalTwinWorld`, and a failed
    // compile is tried again by the next request.
    void compile.finally(() => {
      if (digitalTwinCompiles.get(payer) === compile) digitalTwinCompiles.delete(payer);
    });
    return compile;
  };
  // Pre-warm the digital-twin world on server boot so the first user
  // request does not pay the ~30-60s compile inside its response. Cloudflare
  // proxies paracosm.agentos.sh with a 100s gateway timeout, so a cold
  // compile + 2-turn simulation reliably tripped 524 errors. Pre-warming
  // moves the compile off the user's critical path; the cookbook's
  // disk cache means restarts after the first one are nearly free.
  // Fire-and-forget: a failure is logged from inside the compile, and the
  // first request after a failed pre-warm compiles the world again.
  //
  // On the hosted demo the host pays for this compile, as it pays for a
  // request that brings no key: it runs on the host's OpenAI key. A host
  // with no OpenAI key compiles nothing here and says so once.
  const bootRouting = hostedModelRouting({ hostedDemo: serverMode === 'hosted_demo', env, credentials: {} });
  if (!bootRouting || options.getDigitalTwinWorld) {
    void getDigitalTwinWorld();
  } else if (bootRouting.payer === 'host') {
    void getDigitalTwinWorld({
      provider: bootRouting.provider,
      model: QUICKSTART_MODELS[bootRouting.provider],
      stayOnProvider: true,
      hostPaid: true,
    });
  } else {
    console.log('  [digital-twin] World not compiled at boot: the hosted demo has no host OpenAI key to pay for the compile');
  }

  // Auto-save on clean completion. AUTO_SAVE_MIN_TURNS floors the run
  // length at one completed turn: accidental clicks never get saved (no
  // turn_done → nothing to replay anyway), but a legitimate 1- or 2-turn
  // run does. The earlier value of 3 silently excluded most hosted-demo
  // runs from the cache ring, which kept the LoadMenu perpetually empty
  // for visitors.
  const AUTO_SAVE_MIN_TURNS = 1;

  // Persistent storage for completed sim runs. Lives at
  // `${APP_DIR}/data/sessions.db`; the directory is created on first
  // open. On the hosted demo each visitor keeps their 10 newest saved runs
  // and the server keeps at most 50 unpinned runs in all: past that, the
  // save evicts the oldest run of the visitor holding the most, and when
  // every visitor holds one, the oldest run in the store, another
  // visitor's included. Runs an admin saved are never evicted. A local
  // server keeps one ring of 10, whoever saved them (stores/session.ts).
  // The store is opened once at server start so the SQLite handle and
  // prepared statements stay warm across requests.
  let sessionStore: SessionStore | null = options.sessionStore ?? null;
  const sessionsDbPath = resolve(env.APP_DIR || '.', 'data', 'sessions.db');
  if (!sessionStore) try {
    sessionStore = openSessionStore(sessionsDbPath, DEFAULT_MAX_SESSIONS, { ownerRings: serverMode === 'hosted_demo' });
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
  /**
   * The session ids the session store holds; with no store, or a store that
   * cannot be read, none, since no replay link could be checked. Run
   * records are then listed without their session links, never refused.
   */
  const savedSessionIds = async (ids: readonly string[]): Promise<ReadonlySet<string>> => {
    if (!sessionStore) return new Set<string>();
    try {
      return await sessionStore.existingIds(ids);
    } catch (err) {
      console.warn('[sessions] could not read which sessions the store holds; run records go out without session links:', err);
      return new Set<string>();
    }
  };

  // The landing-page waitlist is closed (routes/waitlist.ts answers
  // 410), so the server leaves the signups it collected in
  // `${APP_DIR}/data/waitlist.db` alone and does not open the file.
  // PARACOSM_WAITLIST_STORE=1 opens an existing store at startup and
  // logs how many signups it holds, for the operator who is about to
  // export them (`scripts/send-waitlist-broadcast.ts --dry-run` lists
  // the addresses). Opening runs the store's own schema bootstrap;
  // no server code inserts, updates or deletes a signup.
  if (env.PARACOSM_WAITLIST_STORE === '1') {
    const waitlistDbPath = resolve(env.APP_DIR || '.', 'data', 'waitlist.db');
    if (existsSync(waitlistDbPath)) {
      createWaitlistStore({ dbPath: waitlistDbPath })
        .count()
        .then((n) => console.log(
          `  [waitlist] Opened waitlist store at ${waitlistDbPath} (${n} signup${n === 1 ? '' : 's'} stored; the route accepts no new ones)`,
        ))
        .catch((err) => console.log(`  [waitlist] Failed to read waitlist store: ${err}`));
    } else {
      console.log(`  [waitlist] No waitlist store at ${waitlistDbPath}; nothing to read`);
    }
  }

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
   * Scan a run's event buffer back-to-front for the first event
   * whose `_cost` payload carries a `schemaRetries` field. That event
   * has the run's terminal per-schema rollup; earlier events have
   * partial counts. Push to the ring and persist.
   */
  const captureRetrySnapshot = (run: LiveRun) => {
    const eventBuffer = run.buffer;
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
   * Links a saved run's Library records (the RunRecords onArtifactPersist
   * inserted for it) to its saved session. A link that fails is written
   * with the run as still to do and tried again after 1, 5 and 30 seconds,
   * and at the next start, so the records get their replay link once the
   * run-history store answers. Never rejects.
   */
  const LINK_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
  /**
   * The saves whose session is not committed yet, and the Wipe All in
   * progress that deletes the saved sessions. Such a wipe waits for each
   * save in flight to commit before it deletes the sessions; a save whose
   * recording was still being read when it began is not committed, and a
   * save that starts during it waits for it to end and is not made for a
   * run it let go of (`runsWiped`); so no session the wipe deleted comes
   * back. A wipe that keeps the sessions changes no save, and neither does
   * a held run's eviction.
   */
  const savesCommitting = new Set<Promise<void>>();
  let wipeGeneration = 0;
  let wipeInProgress: Promise<void> | null = null;
  const runsWiped = new WeakSet<LiveRun>();
  const linkRetryTimers = new Set<ReturnType<typeof setTimeout>>();
  let linkRetriesStopped = false;
  const linkLibraryRecords = async (run: LiveRun, sessionId: string, attempt = 0): Promise<void> => {
    if (run.insertedRunIds.length === 0 || !runHistoryStore.linkSessionId) return;
    try {
      await runHistoryStore.linkSessionId([...run.insertedRunIds], sessionId);
      liveRuns.setPendingLink(run, null);
    } catch (error) {
      console.warn(`[run-history] linkSessionId failed for run ${run.key} (try ${attempt + 1}):`, error);
      liveRuns.setPendingLink(run, sessionId);
      const delay = LINK_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || linkRetriesStopped) return;
      const timer = setTimeout(() => {
        linkRetryTimers.delete(timer);
        void linkLibraryRecords(run, sessionId, attempt + 1);
      }, delay);
      timer.unref?.();
      linkRetryTimers.add(timer);
    }
  };

  /**
   * Persist a run to the session ring when it completes cleanly. Called
   * from the run's broadcast on an `event: complete` frame. Silent no-op
   * when conditions aren't met. Errors are logged but never propagate: a
   * cache write failure must not fail the client-facing broadcast.
   */
  const autoSaveOnComplete = async (run: LiveRun) => {
    const broadcast = liveRuns.broadcastFor(run);
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
    // A run whose save is decided, or in flight here, is not saved again: a
    // doubled `complete` returns here.
    if (run.saved || run.saving) {
      console.log('[sessions] auto-save skipped: already saved for this run');
      return;
    }
    /** The run will never be saved: says why, and lets go of its recording. */
    const skipForGood = (reason: string, detail: Record<string, unknown> = {}) => {
      liveRuns.settleSave(run);
      emitSaveStatus('skipped', { reason, ...detail });
    };
    // A digital-twin run's artifact comes back in its answer, and a saved
    // session replays in the two-column layout, which has no place for it.
    if (run.kind === 'intervention') {
      console.log('[sessions] auto-save skipped: digital-twin run');
      skipForGood('digital_twin');
      return;
    }
    if (!sessionStore) {
      // Not decided: a restart that opens the store saves the run.
      console.log('[sessions] auto-save skipped: session store not initialized');
      emitSaveStatus('skipped', { reason: 'store_not_initialized' });
      return;
    }
    if (run.aborted) {
      console.log('[sessions] auto-save skipped: run was aborted');
      skipForGood('run_aborted');
      return;
    }
    if (run.errored) {
      console.log('[sessions] auto-save skipped: run had sim_error events');
      skipForGood('run_errored');
      return;
    }
    if (run.buffer.length === 0 && run.spooled === 0) {
      console.log('[sessions] auto-save skipped: empty event buffer');
      skipForGood('empty_buffer');
      return;
    }

    // Completed actor-turns, each counted once, as the run broadcast them
    // (the buffer's trim does not lower the count). A frame that names no
    // actor or turn counts once by itself.
    const turnDoneCount = run.actorTurnsDone;
    if (turnDoneCount < AUTO_SAVE_MIN_TURNS) {
      console.log(`[sessions] auto-save skipped: turn_done count ${turnDoneCount} below AUTO_SAVE_MIN_TURNS (${AUTO_SAVE_MIN_TURNS})`);
      skipForGood('below_min_turns', { turnDoneCount, minTurns: AUTO_SAVE_MIN_TURNS });
      return;
    }

    // Full-completion gate: only cache runs that played every actor
    // through every turn they ran. A pair run of six turns reports 12
    // actor-turns, a run of 300 actors 1,800, and a fork from turn 4 of a
    // six-turn run 2 for its one actor; fewer means the run bailed early
    // (orchestrator timeout, watchdog disconnect, mid-run crash that did
    // not raise sim_error/sim_aborted) and the cached session would replay
    // a half-finished trajectory. The expected count is written with the
    // run, so the gate holds for a run read back after a restart; it is
    // null only for a run with no config (a Digital Twin run, or one
    // written before the count was).
    const expectedTurnDone = run.expectedActorTurns;
    if (expectedTurnDone !== null && expectedTurnDone > 0 && turnDoneCount < expectedTurnDone) {
      console.log(`[sessions] auto-save skipped: ${turnDoneCount} actor-turns completed, below the ${expectedTurnDone} expected — partial run`);
      skipForGood('partial_completion', {
        turnDoneCount,
        expectedTurnDone,
        ...(run.config ? { actors: run.config.actors.length, turns: run.config.turns } : {}),
      });
      return;
    }

    // Claim the save BEFORE the first await so a synchronous double
    // `complete` broadcast doesn't race past the guard above. The save is
    // decided only once it commits: a server stopped before then saves the
    // run after its restart, under the run's key, so it is saved once.
    run.saving = true;
    try {
      if (wipeInProgress) {
        await wipeInProgress;
        // The wipe deleted the saved sessions and let go of this run.
        if (runsWiped.has(run)) {
          console.log(`[sessions] auto-save skipped: a Wipe All let go of run ${run.key} before its save`);
          skipForGood('wiped');
          return;
        }
      }
      const generation = wipeGeneration;
      let releaseCommit: () => void = () => {};
      const commit = new Promise<void>(resolve => { releaseCommit = () => resolve(); });
      savesCommitting.add(commit);
      let events!: TimestampedEvent[];
      let result!: { id: string; evictedId?: string };
      try {
        // Every frame the run broadcast: the frames its live buffer trimmed
        // are read back once, from the run's recording file, so the trim never
        // shortens the saved session.
        const recording = await runRecording(run);
        if (!recording) {
          console.log(`[sessions] auto-save skipped: the recording of run ${run.key} is not whole`);
          skipForGood('recording_incomplete');
          return;
        }
        if (generation !== wipeGeneration) {
          console.log(`[sessions] auto-save skipped: a Wipe All began while run ${run.key} was being saved`);
          skipForGood('wiped');
          return;
        }
        const now = Date.now();
        events = recording.frames.map((sse, i) => ({
          ts: recording.timestamps[i] || now,
          sse,
        }));
        // Each actor's final artifact cost, once each, summed; the verdict
        // and title calls are not an actor's. A run with no artifact costs
        // (a runner that hands none back) takes the cost its frames carry.
        const artifactCosts = [...run.artifactCosts.values()];
        const override = {
          provenance: run.provenance,
          ...(artifactCosts.length > 0 ? { totalCostUSD: artifactCosts.reduce((sum, cost) => sum + cost, 0) } : {}),
        };
        result = await sessionStore.saveSession(events, override, { owner: sessionOwner(run.visitorId), runKey: run.key });
      } finally {
        savesCommitting.delete(commit);
        releaseCommit();
      }
      // The Library link is written as still to do with the decision, before
      // any await, so a server stopped during the count or the first link
      // links the records at its next start; the link clears it once written.
      liveRuns.settleSave(run, { sessionId: result.id, linkPending: run.insertedRunIds.length > 0 && Boolean(runHistoryStore.linkSessionId) });
      // The row count is for the log line and the status alone: a store
      // that cannot count once the save committed still reports the save,
      // links the run's Library records and titles it.
      let storeCount: number | null = null;
      try {
        storeCount = await sessionStore.count();
      } catch (err) {
        console.warn(`[sessions] saved run ${result.id}, but could not count the saved runs:`, err);
      }
      console.log(`[sessions] auto-saved run ${result.id}: ${events.length} events, ${turnDoneCount} actor-turns (store count: ${storeCount ?? 'unknown'})`);
      // The session is committed and listed, so its page is told now, not
      // once the Library link answers.
      emitSaveStatus('saved', {
        id: result.id,
        evictedId: result.evictedId,
        eventCount: events.length,
        turnCount: turnDoneCount,
        ...(storeCount !== null ? { totalStored: storeCount } : {}),
      });
      // Backfill session_id onto every RunRecord that onArtifactPersist
      // inserted for this broadcast. A link failure does not abort the save:
      // the run is already in the session store and replayable by
      // sessionId, and the link is tried again (linkLibraryRecords).
      await linkLibraryRecords(run, result.id);
      // Title-generation pipeline: fire-and-forget nano-tier LLM call
      // off the save hot path. A failed / slow title call must not
      // block the broadcast pipeline, so the promise is intentionally
      // unawaited. Emits a second `sim_saved` event when the title
      // lands so the dashboard can patch its in-memory session list
      // without a round-trip to /sessions.
      // A run read back after a restart holds no config, so the key that
      // paid for it is gone: it gets no title from a model, since the call
      // would bill the host's key or reach a provider the visitor did not
      // pick.
      if (run.config === null) {
        console.log(`[sessions] saved run ${result.id} gets no title: the key that paid for it is gone after a restart`);
        return;
      }
      // The title call bills whoever pays for the run: the run's own key
      // when the request brought one (the provider that key belongs to, as
      // each leader's run picks it), the environment's key on a host-paid
      // run, where no key is passed.
      const titleCredentials = { apiKey: run.config?.apiKey, anthropicKey: run.config?.anthropicKey };
      const titleProvider = resolveProviderFromCredentials(run.config?.provider, titleCredentials, 'openai');
      const titleApiKey = apiKeyForProvider(titleProvider, titleCredentials);
      const store = sessionStore; // non-null inside this closure
      void generateSessionTitle(events, titleProvider, runGenerateText, undefined, titleApiKey, run.config?.stayOnProvider === true).then(async (title) => {
        if (!title) return;
        try {
          await store.updateTitle(result.id, title);
          console.log(`[sessions] titled run ${result.id}: ${JSON.stringify(title)}`);
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
      // Not decided: the run stays unsaved, so a restart saves it.
      liveRuns.abandonSave(run);
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[sessions] auto-save failed:', err);
      emitSaveStatus('failed', { error: message });
    }
  };

  const startSimulations = options.runPairSimulations ?? runPairSimulations;
  const startFork = options.runForkSimulation ?? runForkSimulation;
  const startBatch = options.runBatchSimulations ?? runBatchSimulations;

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

  /**
   * Answers a request the hosted model policy refuses (hosted-model-policy.ts):
   * a host-paid request on a hosted demo whose host holds no OpenAI key.
   */
  const writeHostedRefusal = (res: ServerResponse, refusal: { status: number; error: string }): void => {
    res.writeHead(refusal.status, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: refusal.error }));
  };

  const writeCrossSiteRefusal = (res: ServerResponse): void => {
    console.warn("[origin] refused a request from another site on the host's keys");
    res.writeHead(403, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({
      error: 'cross_site_refused',
      message: "This request came from a page on another site. The hosted demo takes it from its own pages, or on /setup, /compile and /chat with the caller's own provider key (on /compile, and no seed the host's search or scraping keys would read).",
    }));
  };

  const writeLocalRefusal = (res: ServerResponse, logLine: string): void => {
    console.warn(logLine);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'cross_site_refused',
      message: 'This local server answers requests from its own pages and from localhost only, sent to a loopback name, its address, the name HOST gives or a name PARACOSM_ALLOWED_HOSTS lists.',
    }));
  };

  /** Answers a run the server has no room for: 503 with the run cap. Nothing has been charged to the caller. */
  const writeRunCapacityRefusal = (res: ServerResponse, err: RunCapacityError): void => {
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': String(RUN_CAPACITY_RETRY_AFTER_SECONDS),
      ...corsHeaders,
    });
    res.end(JSON.stringify(err.body()));
  };

  /** Whether a buffered `complete` frame says the run was stopped before its end. */
  const completeFrameAborted = (frame: string): boolean => {
    const data = frame.split('\n').find(line => line.startsWith('data: '));
    if (!data) return false;
    try {
      return (JSON.parse(data.slice('data: '.length)) as { aborted?: unknown })?.aborted === true;
    } catch {
      return false;
    }
  };

  /** The run a request names with `?run=<key>`, or null when it names none. */
  const namedRunKey = (url: string | undefined): string | null => {
    if (!url || !url.includes('?')) return null;
    try {
      const key = new URL(url, 'http://localhost').searchParams.get('run');
      return key && key.length > 0 ? key : null;
    } catch {
      return null;
    }
  };

  const writeUnknownRun = (res: ServerResponse, key: string): void => {
    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders, ...PER_VISITOR_HEADERS });
    res.end(JSON.stringify({ error: `Unknown run: ${key}` }));
  };

  /**
   * What the consent bar on the page a request gets is given: the analytics
   * ids (the option, or the dashboard build's site-analytics.json, read per
   * page as the landing page is), whether the request sent a privacy signal,
   * and the version its asset addresses carry.
   */
  const analyticsPage = (req: IncomingMessage) => ({
    ids: options.siteAnalyticsIds
      ? parseSiteAnalyticsIds(options.siteAnalyticsIds)
      : readSiteAnalyticsIds(resolve(__dirname, '../dashboard/dist')),
    signal: sendsPrivacySignal(req),
    assetVersion: PARACOSM_VERSION,
  });

  /** Whether a path names an API docs page TypeDoc built, inside docs/api. */
  const isDocsPage = (pathname: string): boolean => {
    const docsDir = resolve(__dirname, '..', '..', 'docs', 'api');
    const filePath = resolve(docsDir, pathname.replace(/^\/docs\//, ''));
    if (!filePath.startsWith(docsDir + sep)) return false;
    try {
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  };

  /**
   * POST /api/event on the hosted demo: one page view from the consent bar's
   * script (assets/consent/consent.js), forwarded to the shared Plausible
   * instance as the public page it names (countEventFrom), with nothing of
   * the referring page, and with the visitor's full User-Agent header and
   * one address, as its events API asks. A request from another site, one that
   * sends a privacy signal, or a path that is no page of the site is
   * answered 204 and forwards nothing. Past COUNT_EVENTS_PER_MINUTE from one
   * address (an IPv6 address by its /64), or COUNT_FORWARDS_AT_ONCE forwards
   * open, it answers 429 and forwards nothing.
   */
  const handleCountEvent = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (fromAnotherSite(req, allowedOrigins) || sendsPrivacySignal(req)) {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    let event: ReturnType<typeof countEventFrom>;
    try {
      event = countEventFrom(await readBody(req, 4096), isDocsPage);
    } catch (error) {
      // The answer names the refusal alone, never the error's text.
      const tooLarge = error instanceof RequestBodyTooLargeError;
      res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: tooLarge ? 'body_too_large' : 'invalid_event' }));
      return;
    }
    if (event === 'unlisted') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
    if (!event || !userAgent) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'invalid_event' }));
      return;
    }
    const { limitKey, address } = countAddresses(req, clientIpHeader);
    if (countForwardsOpen >= COUNT_FORWARDS_AT_ONCE || !countEventLimit.take(limitKey)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: 'too_many_events' }));
      return;
    }
    countForwardsOpen += 1;
    let accepted = false;
    try {
      accepted = await forwardCountEvent(countEventUrl, event, { userAgent, address });
    } finally {
      countForwardsOpen -= 1;
    }
    if (!accepted && Date.now() - countForwardWarnedAt > 60_000) {
      countForwardWarnedAt = Date.now();
      console.warn('  [analytics] The Plausible instance did not accept a page view; further failures this minute are not logged.');
    }
    res.writeHead(accepted ? 202 : 502, { 'Cache-Control': 'no-store' });
    res.end();
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (serverMode === 'local_demo' && !localHostKnown(req.headers.host, env.HOST ?? '', allowedHosts)) {
      writeLocalRefusal(res, '[host] refused a request sent to a name this local server does not answer');
      return;
    }

    // CORS preflight for browser-based requests across the public API.
    // DELETE is in the allow-list because /admin/scenarios/:id is a
    // cross-origin candidate for the embedded landing-page demos;
    // X-Admin-Token sits next to Content-Type so admin-gated routes
    // can pass their token through preflight without the browser
    // refusing the actual DELETE.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // A local server answers its own pages and other local ports alone: a
    // request a browser sends from a page on another site carries that
    // site's Origin, and is refused before any route reads or spends.
    if (serverMode === 'local_demo' && !localOriginAllowed(req, env.HOST ?? '', allowedHosts)) {
      writeLocalRefusal(res, '[origin] refused a request from another site on a local server');
      return;
    }

    if (serverMode === 'hosted_demo' && req.method === 'POST' &&
        (req.url?.startsWith('/api/quickstart/') || req.url === '/scenario/switch' || req.url === '/forget-keys') &&
        fromAnotherSite(req, allowedOrigins)) {
      writeCrossSiteRefusal(res);
      return;
    }

    // A path whose percent escapes do not decode names no route.
    if (!pathDecodes(req.url)) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ error: 'invalid_path', message: 'The path holds a percent escape that does not decode.' }));
      return;
    }

    // The consent bar's page views, on the hosted demo only.
    if (siteAnalytics && (req.url ?? '').split('?')[0] === '/api/event') {
      await handleCountEvent(req, res);
      return;
    }

    if (handlePublicDemoRoute(serverMode, req, res, corsHeaders, adminWrite && adminToken.length > 0)) {
      return;
    }
    // The platform API mode serves /api/v1 to holders of the admin
    // credential alone (requireAdminToken: 403 without ADMIN_WRITE, 503
    // without ADMIN_TOKEN, 401 without a matching X-Admin-Token), in every
    // form of request target that reaches one (namesPlatformApiRoute).
    if (serverMode === 'platform_api' && namesPlatformApiRoute(req.url) && !requireAdminToken(req, res)) {
      return;
    }
    const runHistoryRoutesDefault = serverMode !== 'hosted_demo';
    const runHistoryEnvFlag = (env.PARACOSM_ENABLE_RUN_HISTORY_ROUTES ?? '').toLowerCase();
    const paracosmRoutesEnabled =
      runHistoryEnvFlag === 'true' ? true :
      runHistoryEnvFlag === 'false' ? false :
      runHistoryRoutesDefault;
    // On the hosted demo a run-history answer is its caller's own, so no
    // shared cache in front of the server may keep one.
    const perVisitorRunHistory = serverMode === 'hosted_demo' && paracosmRoutesEnabled;

    // Bundle + Library-import handlers run BEFORE handlePlatformApiRoute
    // because that handler's "unknown_platform_route" 404 fires for any
    // /api/v1/* path it doesn't recognize — including these. Without
    // this ordering the Compare modal showed
    // 'Failed to load bundle: HTTP 404 unknown_platform_route' on every
    // bundle fetch, even though a perfectly good bundle handler lived
    // 30 lines further down.
    if (paracosmRoutesEnabled && req.url === '/api/v1/library/import' && req.method === 'POST') {
      if (perVisitorRunHistory) sendPerVisitor(res);
      if (!runHistoryStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Run-history store disabled' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req, maxRequestBodyBytes));
        const { handleLibraryImport } = await import('./routes/library-import.js');
        const address = IpRateLimiter.getIp(req, clientIpHeader);
        // An imported run belongs to the visitor who imports it, as a run
        // they start does: on the hosted demo a caller that sent no cookie
        // gets a visitor id of its own with the answer (runVisitorFor).
        const { visitorId: importVisitorId, setCookie: importSetCookie } = runVisitorFor(req);
        const importOwner = sessionOwner(importVisitorId);
        if (importSetCookie) res.setHeader('Set-Cookie', importSetCookie);
        await handleLibraryImport(req, res, body, {
          runHistoryStore,
          sourceMode: serverMode,
          runsDir,
          admitNewRun: () => admitImport(address),
          owner: importOwner,
          runScope: runScopeFor(req) ? { owner: importOwner } : undefined,
        });
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Compare-runs UI: bundle endpoints. /api/v1/bundles/:id and
    // /api/v1/bundles/:id/aggregate are read-only views over the
    // RunHistoryStore. Same gating as platform-api routes below.
    if (paracosmRoutesEnabled && req.url?.startsWith('/api/v1/bundles/') && req.method === 'GET') {
      if (perVisitorRunHistory) sendPerVisitor(res);
      const match = req.url.match(/^\/api\/v1\/bundles\/([^/?]+)(\/aggregate)?(\?.*)?$/);
      if (!match) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Invalid bundle URL' }));
        return;
      }
      const bundleId = decodeURIComponent(match[1]);
      const isAggregate = !!match[2];
      const { handleListBundle, handleBundleAggregate } = await import('./routes/bundle.js');
      const runScope = runScopeFor(req);
      try {
        if (isAggregate) await handleBundleAggregate(bundleId, res, { runHistoryStore, runScope });
        else await handleListBundle(bundleId, res, { runHistoryStore, runScope, savedSessionIds });
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    if (await handlePlatformApiRoute(req, res, {
      runHistoryStore,
      corsHeaders: perVisitorRunHistory ? { ...corsHeaders, ...PER_VISITOR_HEADERS } : corsHeaders,
      paracosmRoutesEnabled,
      runsDir,
      scenarioLookup: (id) => lookupScenario(req, id),
      runScope: runScopeFor(req),
      savedSessionIds,
      savedVerdict: async (id, actorName) => {
        const session = await sessionStore?.getSession(id).catch(() => null);
        const event = session?.events.slice().reverse().find(({ sse }) => /^event: (?:cohort_)?verdict\r?\n/.test(sse));
        const json = event?.sse.split('\n').find(line => line.startsWith('data: '))?.slice(6);
        if (!json) return undefined;
        try {
          const verdict = JSON.parse(json) as Record<string, unknown>;
          const fields = Object.fromEntries(
            ['headline', 'summary', 'keyDivergence', 'reasoning', 'verdictModel']
              .filter(field => typeof verdict[field] === 'string')
              .map(field => [field, verdict[field]]),
          );
          const ranking = actorName && Array.isArray(verdict.rankings)
            ? verdict.rankings.find(entry => entry?.actorName === actorName) : undefined;
          if (typeof ranking?.rationale === 'string') {
            return { ...fields, rankings: [{ actorName, rationale: ranking.rationale }] };
          }
          return fields;
        } catch {
          return undefined;
        }
      },
    })) {
      return;
    }

    if (req.url === '/events' || req.url?.startsWith('/events?')) {
      // The stream is its visitor's: it replays and carries their current
      // run, the one they start next included (or, while they have none of
      // their own, the anonymous visitor's, so the browser that opened the
      // CLI's dashboard sees the CLI's run). /events?run=<key> follows one
      // run instead; a key reaches the public only through a saved session,
      // whose replay discloses the run already. On the hosted demo such a
      // stream of another visitor's run carries none of the brief that
      // visitor compiled, as the saved replay and GET /sessions/:id do.
      //
      // Per-actor channel: /events?actor=<leaderName> filters the stream to
      // events tagged with that leader plus all global events (status,
      // active_scenario, complete, etc.). Without it the stream carries
      // everything, which the constellation, distribution panel, and table
      // need.
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
      const visitorId = readVisitorId(req);
      const runKey = namedRunKey(req.url);
      // A run nobody has read or watched for the idle time goes before a
      // stream attaches, so its visitor gets the empty state instead of an
      // "Interrupted" badge and a frozen turn counter as their first paint.
      liveRuns.sweep();
      if (runKey !== null && !liveRuns.get(runKey)) {
        writeUnknownRun(res, runKey);
        return;
      }
      const run = runKey !== null ? liveRuns.get(runKey) : liveRuns.watched(visitorId);
      if (!admitStream(req, res, { 'Access-Control-Allow-Origin': '*' })) return;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      const connected = { actorFilter, runKey: run?.key ?? null, visitorId, ...(run ? { provenance: run.provenance } : {}) };
      res.write(`event: connected\ndata: ${JSON.stringify(connected)}\n\n`);
      // Replay the run's buffered events so a new client catches up. The
      // trailing `replay_done` marker lets the client distinguish
      // historical-buffer events from truly live ones so toasts (transient
      // per-event notifications) only fire for events that arrive AFTER the
      // user reached the page, never for the replay of a prior run.
      //
      // The replay and the attach run on one Node turn, with no `await`
      // between them, so no event of the run falls between the replay and
      // the stream's first live frame.
      const hideBrief = serverMode === 'hosted_demo' && runKey !== null && run !== undefined && run.visitorId !== visitorId;
      if (run) liveRuns.replay(res, run, actorFilter, hideBrief);
      try { res.write('event: replay_done\ndata: {}\n\n'); } catch {}
      // Attaching disarms the watchdog of the run the stream watches, so a
      // returning viewer keeps the run going.
      liveRuns.attach(res, { visitorId, runKey, actorFilter, hideBrief });
      // A run whose last viewer leaves starts its grace-period countdown; if
      // no viewer comes back before it fires, the watchdog stops that run.
      req.on('close', () => liveRuns.detach(res));
      return;
    }

    // The scenario for this caller: ?id= when given, else the visitor's
    // pick, else the server's default. The dashboard never sends ?id=; its
    // Run controls stay disabled until this answers 200, so a 503 while the
    // pick re-compiles after a restart makes the page wait and try again.
    if ((req.url === '/scenario' || req.url?.startsWith('/scenario?')) && req.method === 'GET') {
      let namedId: string | undefined;
      if (req.url?.includes('?')) {
        try {
          namedId = new URL(req.url, 'http://localhost').searchParams.get('id') ?? undefined;
        } catch {
          namedId = undefined;
        }
      }
      const resolved = resolveRequestScenario(req, namedId);
      const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...PER_VISITOR_HEADERS };
      if ('scenario' in resolved) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(projectScenarioForClient(resolved.scenario)));
      } else if ('loading' in resolved) {
        writeScenarioRefusal(res, resolved, { 'Access-Control-Allow-Origin': '*', ...PER_VISITOR_HEADERS });
      } else {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: `Unknown scenario: ${'unknown' in resolved ? resolved.unknown : resolved.notRunnable}` }));
      }
      return;
    }

    // List scenarios that can be switched to. Builtins, disk-loaded and
    // compiled scenarios all live in the same catalog, and this endpoint is
    // a uniform iteration over it, followed by the runnable scenarios this
    // visitor stored in memory, which no other visitor sees. No hardcoded
    // IDs. `active` is this visitor's pick (or the default), so the answer
    // varies by cookie.
    //
    // Each entry now carries persistence metadata + a run-count from
    // the run-history store so the dashboard's scenario picker can
    // render "compiled 3 days ago · 12 runs" alongside the name.
    // Counts come from `aggregateStats({scenarioId})`; missing store /
    // missing aggregate impl falls through to a 0 count rather than
    // failing the whole list.
    if (req.url === '/scenarios' && req.method === 'GET') {
      type ScenarioListEntry = {
        id: string;
        name: string;
        description: string;
        departments: number;
        source: string;
        compiledAt?: string;
        seedText?: string | null;
        runCount?: number;
      };
      const entries: ScenarioListEntry[] = [];
      for (const [id, entry] of customScenarioCatalog) {
        const sc = entry.scenario;
        const meta = compiledScenarioMeta.get(id);
        entries.push({
          id,
          name: sc.labels?.name || id,
          description: describeCustomScenarioSource(entry.source),
          departments: sc.departments?.length || 0,
          source: entry.source,
          compiledAt: meta?.compiledAt,
          seedText: briefFor(id, req, meta?.seedText),
        });
      }
      // The runnable scenarios this visitor stored in memory, theirs alone.
      for (const [id, { scenario: stored }] of ownMemoryScenarios(req) ?? new Map<string, MemoryScenario>()) {
        if (customScenarioCatalog.has(id) || !isRunnableScenarioPackage(stored)) continue;
        entries.push({
          id,
          name: stored.labels?.name || id,
          description: describeCustomScenarioSource('memory'),
          departments: stored.departments?.length || 0,
          source: 'memory',
        });
      }
      // While the pick re-compiles after a restart, `active` is its id, so
      // the selector shows it once the list holds it.
      const pick = resolveRequestScenario(req);
      const active = 'scenario' in pick ? pick.scenario.id : 'loading' in pick ? pick.loading : marsScenario.id;
      // Best-effort run-count enrichment. Aggregate one query per
      // scenario id rather than one bulk because aggregateStats
      // already accepts a scenarioId filter. The catalog holds at most 50
      // compiled entries, or one more than the compiled scenarios the
      // server's runs have held, beside the built-ins, the scenarios folder
      // and this visitor's own memory scenarios.
      if (runHistoryStore?.aggregateStats) {
        await Promise.all(entries.map(async (entry) => {
          try {
            const agg = await runHistoryStore.aggregateStats!({ scenarioId: entry.id });
            entry.runCount = agg.totalRuns;
          } catch {
            entry.runCount = 0;
          }
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...PER_VISITOR_HEADERS });
      res.end(JSON.stringify({ scenarios: entries, active }));
      return;
    }

    // POST /scenarios/:id/rename — let users replace the auto-
    // generated `labels.name` from a compile-from-seed run with a
    // friendlier display name ("Pandemic Sim" instead of
    // `dual-superintelligence-council-x9k2`). The id (and on-disk
    // filename) never change — only the display label flips, so
    // every existing run record + URL keeps resolving. Restricted
    // to `compiled` source: builtins and curated disk drafts are
    // tracked outside the dashboard and shouldn't drift via API. The
    // name is every visitor's and the rename writes the scenario's file,
    // so it takes the admin credential DELETE /admin/scenarios/:id takes.
    const scenarioRenameMatch = req.url
      ? req.url.match(/^\/scenarios\/([^/?#]+)\/rename$/)
      : null;
    if (scenarioRenameMatch && req.method === 'POST') {
      if (!requireAdminToken(req, res)) {
        console.warn('[scenarios] rename refused: admin credential missing, wrong or not configured');
        return;
      }
      const id = decodeURIComponent(scenarioRenameMatch[1]);
      const entry = customScenarioCatalog.get(id);
      if (!entry) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'scenario_not_found', id }));
        return;
      }
      if (entry.source !== 'compiled') {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({
          error: 'cannot_rename_non_compiled',
          id,
          source: entry.source,
          message: 'Only compile-from-seed scenarios can be renamed. Builtins and curated disk drafts are tracked in source and read-only via API.',
        }));
        return;
      }
      let body: { name?: unknown } = {};
      try {
        const raw = await readBody(req, maxRequestBodyBytes);
        if (raw) body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'invalid_json_body' }));
        return;
      }
      if (customScenarioCatalog.get(id) !== entry) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'scenario_not_found', id }));
        return;
      }
      const rawName = typeof body.name === 'string' ? body.name : '';
      // Sanitize: strip control chars (0x00-0x1F + DEL) + HTML
      // angle-brackets so a crafted name never sneaks markup into
      // the dashboard. Collapse repeated whitespace and hard cap at
      // 100 chars. Empty after sanitize → 400 — we never persist a
      // blank labels.name field.
      const sanitized = rawName
        .replace(/[\x00-\x1F\x7F<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
      if (sanitized.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'name_required' }));
        return;
      }
      // Mutate the scenario's labels.name in place. Every reader
      // (TopBar, /scenario, /scenarios listing) looks it up in
      // customScenarioCatalog, so each sees the new name on the next
      // request without an explicit fan-out.
      // Clone the labels record so we don't pin a mutable reference
      // back into the engine's frozen scenario builtins by accident.
      const sc = entry.scenario;
      sc.labels = { ...sc.labels, name: sanitized };
      // Re-persist so the rename survives a server restart. The
      // existing seedText metadata is preserved across the write —
      // we re-read the meta map so the on-disk file never loses the
      // original seed prompt the user submitted.
      const existingMeta = compiledScenarioMeta.get(id);
      const persistResult = persistCompiledScenario(scenarioDir, sc, existingMeta?.seedText ?? null, keep);
      if (persistResult) {
        compiledScenarioMeta.set(id, persistResult.meta);
      }
      console.log(`[scenarios] renamed ${JSON.stringify(id)} → ${JSON.stringify(sanitized)}`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ id, name: sanitized }));
      return;
    }

    // GET /scenarios/:id — single-scenario detail for the dashboard's
    // ScenarioDetailDrawer. Mirrors /scenarios but returns the full
    // scenario shape (presets, departments, world summary) for one
    // entry so the drawer can preview leader pairs + department
    // chips without booting the whole compiled package into memory
    // for every catalog card.
    const scenarioDetailMatch = req.url
      ? req.url.match(/^\/scenarios\/([^/?#]+)$/)
      : null;
    if (scenarioDetailMatch && req.method === 'GET') {
      const id = decodeURIComponent(scenarioDetailMatch[1]);
      // The catalog's scenario, else one this visitor stored in memory, as
      // GET /scenarios lists them: the answer varies by visitor.
      const entry = customScenarioCatalog.get(id);
      const sc = lookupScenario(req, id);
      const detailHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...PER_VISITOR_HEADERS };
      if (!sc) {
        res.writeHead(404, detailHeaders);
        res.end(JSON.stringify({ error: 'scenario_not_found', id }));
        return;
      }
      const source = entry?.source ?? 'memory';
      const meta = entry ? compiledScenarioMeta.get(id) : undefined;
      const runCount = await (async () => {
        if (!runHistoryStore?.aggregateStats) return 0;
        try {
          const agg = await runHistoryStore.aggregateStats({ scenarioId: id });
          return agg.totalRuns;
        } catch {
          return 0;
        }
      })();
      // Project the scenario down to the fields the drawer actually
      // renders. Hooks are stripped (function values don't serialize)
      // and large bodies (knowledge.topics, full event registry,
      // names.first/last) are dropped to keep the response under a
      // few KB even for elaborate cohort scenarios.
      const presets = (sc.presets ?? []).map((p) => {
        // ScenarioPreset.leaders is the canonical post-0.5 field;
        // some legacy compile-from-seed paths shipped `.actors`
        // instead before the rename. Cast through `unknown` to read
        // both without a TS error since the engine's ScenarioPreset
        // interface only declares `leaders`.
        const raw = p as unknown as {
          leaders?: Array<{ name: string; archetype: string; unit?: string; hexaco?: Record<string, number>; instructions?: string }>;
          actors?: Array<{ name: string; archetype: string; unit?: string; hexaco?: Record<string, number>; instructions?: string }>;
        };
        const leaderList = raw.leaders ?? raw.actors ?? [];
        return {
          id: p.id,
          label: p.label,
          leaders: leaderList.map((l) => ({
            name: l.name,
            archetype: l.archetype,
            unit: l.unit,
            hexaco: l.hexaco ?? {},
            instructions: typeof l.instructions === 'string' ? l.instructions.slice(0, 600) : '',
          })),
        };
      });
      const departments = (sc.departments ?? []).map((d) => ({
        id: d.id,
        label: d.label,
        role: d.role,
        icon: d.icon,
      }));
      res.writeHead(200, detailHeaders);
      res.end(JSON.stringify({
        id,
        name: sc.labels?.name ?? id,
        shortName: sc.labels?.shortName,
        description: describeCustomScenarioSource(source),
        source,
        compiledAt: meta?.compiledAt,
        seedText: briefFor(id, req, meta?.seedText),
        runCount,
        presets,
        departments,
        defaultTurns: sc.setup?.defaultTurns,
        defaultPopulation: sc.setup?.defaultPopulation,
      }));
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
      const { DEMO_EXECUTION } = await import('../cli/sim-config.js');
      // `memoryScenarios` is this visitor's own, so the answer varies by cookie.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...PER_VISITOR_HEADERS });
      res.end(JSON.stringify({
        adminWrite,
        hostedDemo,
        serverMode,
        visitorKeyIdleMinutes,
        demoCaps: {
          maxTurns: DEMO_EXECUTION.maxTurns,
          maxPopulation: DEMO_EXECUTION.maxPopulation,
          maxActiveDepartments: DEMO_EXECUTION.maxActiveDepartments,
        },
        memoryScenarios: [...(ownMemoryScenarios(req)?.keys() ?? [])],
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

    // Store a scenario in this visitor's memory (any visitor) or, with
    // saveToDisk, write it to <scenarioStoreDir>/<id>.json and the catalog every
    // visitor reads. The disk write takes the admin credential the /admin/*
    // routes take (requireAdminToken) and an id that names one file directly
    // in the scenarios folder (scenarioJsonPath). A memory store is the
    // storing visitor's alone (memoryScenarios), so it never takes an id the
    // catalog holds, and it is held to MEMORY_SCENARIO_MAX_BYTES,
    // MEMORY_SCENARIOS_PER_VISITOR, MEMORY_SCENARIOS_PER_ADDRESS and
    // MEMORY_SCENARIOS_CAP. A refused request stores nothing.
    if (req.url === '/scenario/store' && req.method === 'POST') {
      try {
        const { scenario: scenarioJson, saveToDisk } = JSON.parse(await readBody(req, maxRequestBodyBytes));
        if (!scenarioJson || !scenarioJson.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'scenario with id required' }));
          return;
        }
        const refuse = (status: number, error: string, log: string): void => {
          console.warn(`[scenarios] scenario store refused: ${log}`);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error }));
        };
        const switchable = isRunnableScenarioPackage(scenarioJson);
        let savedToDisk = false;
        if (saveToDisk) {
          if (!requireAdminToken(req, res)) {
            console.warn('[scenarios] scenario disk write refused: admin credential missing, wrong or not configured');
            return;
          }
          const diskPath = scenarioJsonPath(scenarioStoreDir, scenarioJson.id);
          if (!diskPath) {
            console.warn('[scenarios] scenario disk write refused: the id is not a plain scenario id');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Invalid scenario id for a disk write: ${SCENARIO_ID_RULE}.` }));
            return;
          }
          const { writeFileSync, mkdirSync } = await import('node:fs');
          mkdirSync(scenarioStoreDir, { recursive: true });
          writeFileSync(diskPath, JSON.stringify(scenarioJson, null, 2));
          savedToDisk = true;
          // The saved file takes the id from a compiled scenario or a draft
          // boot is re-compiling, runnable or not: its saved draft goes, so
          // a restart never brings the compiled scenario back. A save that
          // is not runnable also takes the compiled scenario out of the
          // catalog and ends boot's re-compile of it; the file loads at the
          // next restart when the boot loader can read it.
          if (customScenarioCatalog.get(scenarioJson.id)?.source === 'compiled' || hydratingScenarioIds.has(scenarioJson.id)) {
            deletePersistedCompiledScenario(scenarioDir, scenarioJson.id);
            compiledScenarioMeta.delete(scenarioJson.id);
            compiledBriefOwners.delete(scenarioJson.id);
            compiledEntryInfo.delete(scenarioJson.id);
            if (!switchable) {
              if (customScenarioCatalog.get(scenarioJson.id)?.source === 'compiled') customScenarioCatalog.delete(scenarioJson.id);
              groundingCitationsByScenarioId.delete(scenarioJson.id);
              hydratingScenarioIds.delete(scenarioJson.id);
            }
          }
          if (switchable) {
            enterCatalog(scenarioJson.id, {
              scenario: scenarioJson,
              source: 'disk',
            });
          }
        } else {
          const id: unknown = scenarioJson.id;
          if (typeof id !== 'string') {
            refuse(400, 'The scenario id must be a string.', 'an id that is not a string');
            return;
          }
          if (customScenarioCatalog.has(id) || hydratingScenarioIds.has(id)) {
            refuse(409, `"${id}" is the id of a scenario every visitor sees. Give your copy an id of its own.`, 'an id the shared catalog holds');
            return;
          }
          if (Buffer.byteLength(JSON.stringify(scenarioJson)) > MEMORY_SCENARIO_MAX_BYTES) {
            refuse(413, `A scenario held in memory is at most ${MEMORY_SCENARIO_MAX_BYTES / 1024} KiB of JSON.`, 'over the size held in memory');
            return;
          }
          // The counts below are of what is still held: a scenario past the idle time goes first.
          dropIdleMemoryScenarios();
          const visitorId = readVisitorId(req);
          const own = memoryScenarios.get(visitorId) ?? new Map<string, MemoryScenario>();
          const held = own.get(id);
          if (held) {
            held.scenario = scenarioJson;
            held.usedAt = Date.now();
          } else {
            if (own.size >= MEMORY_SCENARIOS_PER_VISITOR) {
              refuse(507, `This server holds at most ${MEMORY_SCENARIOS_PER_VISITOR} scenarios in memory for one visitor. Store over one of yours.`, 'the visitor holds the most scenarios in memory');
              return;
            }
            const address = IpRateLimiter.getIp(req, clientIpHeader);
            let atAddress = 0;
            for (const stored of memoryScenarios.values()) {
              for (const other of stored.values()) {
                if (other.address === address) atAddress += 1;
              }
            }
            if (atAddress >= MEMORY_SCENARIOS_PER_ADDRESS) {
              refuse(507, `This server holds at most ${MEMORY_SCENARIOS_PER_ADDRESS} scenarios in memory for one address. Store over one of yours.`, 'the address holds the most scenarios in memory');
              return;
            }
            if (memoryScenarioCount >= MEMORY_SCENARIOS_CAP) {
              const idle = memoryScenarioIdleMs >= 3_600_000
                ? `${Math.round(memoryScenarioIdleMs / 3_600_000)} hours`
                : `${Math.round(memoryScenarioIdleMs / 1000)} seconds`;
              refuse(507, `This server holds at most ${MEMORY_SCENARIOS_CAP} scenarios in memory, every visitor's together, and it is full. It drops a stored scenario that goes unused for ${idle}, so try again later.`, 'the memory store is full');
              return;
            }
            memoryScenarios.set(visitorId, own);
            memoryScenarioCount += 1;
            own.set(id, { scenario: scenarioJson, address, usedAt: Date.now() });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ stored: true, id: scenarioJson.id, savedToDisk, adminWrite, switchable }));
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // Record this visitor's pick. Uniform catalog lookup: builtins
    // (mars-genesis, lunar-outpost) are registered into the same map at
    // server init, so this handler has no hardcoded ids. Any id that
    // resolves to a runnable entry is answered with the paracosm_scenario
    // cookie; source JSONs that were /scenario/store'd but never compiled
    // get a specific "needs compile" error instead of the misleading
    // "Unknown". The pick is the visitor's alone: the event buffer and the
    // run in it belong to whoever ran it, so nothing shared changes here.
    if (req.url === '/scenario/switch' && req.method === 'POST') {
      try {
        const { id } = JSON.parse(await readBody(req, maxRequestBodyBytes)) as { id?: unknown };
        const named = typeof id === 'string' ? id : String(id);
        const resolved = resolveRequestScenario(req, named);
        if (!('scenario' in resolved)) {
          writeScenarioRefusal(res, resolved);
          return;
        }
        const cookie = pickCookie(named, pickCookieSecure);
        if (!cookie) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Scenario id is too long to hold as a pick: it must percent-encode to at most ${SCENARIO_PICK_MAX_BYTES} bytes.` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Set-Cookie': cookie });
        res.end(JSON.stringify({ active: resolved.scenario.id, name: resolved.scenario.labels?.name }));
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    // The landing-page waitlist is closed: the route answers 410
    // `{ error: 'waitlist_closed' }` without reading the body or
    // touching the stored signups.
    if (req.url === '/api/waitlist' && req.method === 'POST') {
      handleWaitlistClosed(res);
      return;
    }

    // Tier 5 Quickstart onboarding endpoints.
    if (req.url?.startsWith('/api/quickstart/') && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, maxRequestBodyBytes));
        if (body && typeof body === 'object' && refuseUnencryptedKeys(req, res, clientIpHeader !== null, body as Record<string, unknown>)) return;
        const quickstartVisitor = readVisitorId(req);
        const quickstartDeps: QuickstartDeps = {
          generateActorObject: options.generateActorObject,
          installCompiledScenario: (compiledFromSeed, seedText) => {
            const seed = typeof seedText === 'string' && seedText.trim().length > 0
              ? seedText.slice(0, 1000)
              : null;
            // The compile picks the id, and it never replaces a scenario
            // that id already names (scenarioIdTaken): the compiled scenario
            // lands under the next free id instead, `<id>-2`, `<id>-3`, with
            // the id cut short where it must be so the whole stays within
            // QUICKSTART_SCENARIO_ID_MAX, the longest id the page's next
            // Quickstart calls take. The catalog's own entry for this very
            // scenario (a second request for a compile that already landed)
            // keeps its id.
            let sc = compiledFromSeed;
            if (customScenarioCatalog.get(sc.id)?.scenario === sc) return sc;
            if (scenarioIdTaken(quickstartVisitor, sc.id)) {
              const takenId = sc.id;
              const withSuffix = (n: number): string => {
                const tail = `-${n}`;
                return `${takenId.slice(0, Math.max(0, QUICKSTART_SCENARIO_ID_MAX - tail.length))}${tail}`;
              };
              let suffix = 2;
              while (scenarioIdTaken(quickstartVisitor, withSuffix(suffix))) suffix += 1;
              sc = { ...sc, id: withSuffix(suffix) };
            }
            // Quickstart-compiled scenarios reuse the 'compiled' source
            // tag; same post-compile semantics, no new source state
            // required. Nothing becomes active for anyone: the visitor who
            // compiled it gets it as their pick through pickHeaders on the
            // answers they receive.
            enterCatalog(sc.id, { scenario: sc, source: 'compiled' });
            compiledEntryInfo.set(sc.id, {
              enteredAt: Date.now(),
              address: serverMode === 'hosted_demo' ? IpRateLimiter.getIp(req, clientIpHeader) : null,
            });
            makeRoomAfter(sc.id);
            // Auto-persist to disk so the catalog survives server
            // restarts. The hooks themselves are excluded (functions
            // don't serialize); their sources are saved beside the
            // scenario (`_persistHooks`), and boot rebuilds the hooks
            // from them with no model call.
            // Persistence metadata (compiledAt, truncated seedText)
            // travels alongside the scenario for catalog rendering.
            // Best-effort: filesystem failures stay silent so a read-
            // only volume doesn't break the in-memory run.
            //
            // Mirror the EXACT meta block written to disk into the
            // in-memory map so subsequent /scenarios responses agree
            // with what a fresh restart would re-load. Re-deriving the
            // timestamp here would drift by however long writeFileSync
            // took to flush. A failed write still records the meta in
            // memory, so /setup carries the brief into the run either way.
            const persistResult = persistCompiledScenario(scenarioDir, sc, seed, keep);
            compiledScenarioMeta.set(sc.id, persistResult?.meta ?? { compiledAt: new Date().toISOString(), seedText: seed });
            return sc;
          },
          getScenarioById: (id) => lookupScenario(req, id),
          pickHeaders: (id): Record<string, string> => {
            const cookie = pickCookie(id, pickCookieSecure);
            return cookie ? { 'Set-Cookie': cookie } : {};
          },
          fetchSeedFromUrl,
          // The provider and model of a Quickstart request that brings no
          // provider key off the hosted demo, matching compileScenario's
          // default. A request with the visitor's key runs on that key's
          // provider (defaultModelCalls, modelCalls below).
          defaultProvider: 'openai',
          defaultModel: 'gpt-5.4-mini',
          // The hosted demo's model policy (hosted-model-policy.ts) for the
          // draft, its hook compile, the actors, a Digital Twin run and the
          // compile of the Digital Twin's world when no request has compiled it: on
          // the visitor's key and its provider, else on the host's keys on
          // OpenAI with the demo's models, turn cap and leader cap (whether
          // or not the limiter is on), never with a fallback to another
          // provider; a host-paid request on a host with no OpenAI key is
          // refused.
          modelCalls: (credentials) => {
            const routing = hostedModelRouting({ hostedDemo: serverMode === 'hosted_demo', env, credentials });
            if (!routing) return defaultModelCalls({ defaultProvider: 'openai', defaultModel: 'gpt-5.4-mini' }, credentials);
            if (routing.payer === 'refused') {
              console.log('  [demo-mode] Quickstart request refused: a host-paid request needs the host OpenAI key');
              return { status: routing.status, headers: {}, body: { error: routing.error } };
            }
            if (routing.payer === 'host') {
              return {
                provider: routing.provider,
                model: QUICKSTART_MODELS[routing.provider],
                stayOnProvider: true,
                hostPaid: true,
                runModels: hostedRunModels(),
                maxTurns: DEMO_EXECUTION.maxTurns,
                maxActors: DEMO_EXECUTION.maxActors,
              };
            }
            return {
              provider: routing.provider,
              model: QUICKSTART_MODELS[routing.provider],
              ...(routing.apiKey ? { apiKey: routing.apiKey } : {}),
              ...(routing.anthropicKey ? { anthropicKey: routing.anthropicKey } : {}),
              stayOnProvider: true,
              hostPaid: false,
            };
          },
          recordGroundingCitations: (scenarioId, citations) => {
            groundingCitationsByScenarioId.set(scenarioId, citations);
          },
          getDigitalTwinWorld,
          ...(options.compileFromSeed ? { compileFn: options.compileFromSeed } : {}),
          outputDir: runsDir,
          // A digital-twin run is its caller's run, as a /setup run is: it
          // replaces their current run and leaves every other visitor's
          // alone, and it holds a capacity slot until `finish`. Its events go
          // through the broadcast bound to it, so a late event of a twin its
          // visitor has since replaced is discarded.
          openRun: (scenario, runKey, calls, costPreset) => {
            // A twin on the caller's own key skips the day limit, as a /setup
            // run on one does, so its address holds all but one of the run
            // slots; and it has no config to hold its keys, so the run keeps
            // them, in memory alone, for a chat that brings none.
            const ownKeys = !calls.hostPaid
              ? {
                  provider: calls.provider,
                  ...(calls.apiKey ? { apiKey: calls.apiKey } : {}),
                  ...(calls.anthropicKey ? { anthropicKey: calls.anthropicKey } : {}),
                }
              : null;
            const run = liveRuns.open({
              visitorId: runVisitorFor(req).visitorId,
              kind: 'intervention',
              scenario,
              seedText: briefFor(scenario.id, req, compiledScenarioMeta.get(scenario.id)?.seedText) ?? null,
              config: null,
              provenance: resolveRunProvenance({ ...calls, models: calls.runModels, costPreset }, env),
              runKey,
              ownKeyAddress: ownKeys ? IpRateLimiter.getIp(req, clientIpHeader) : null,
              ownKeys,
            });
            return {
              runKey: run.key,
              visitorId: run.visitorId,
              broadcast: liveRuns.broadcastFor(run),
              finish: () => liveRuns.finish(run),
            };
          },
          isRunKeyUsed: (runKey) => liveRuns.isKeyUsed(runKey),
          hostLimits: quickstartHostLimits(req),
        };
        // compile-from-seed is the first call in a new Quickstart launch
        // flow. Dropping the caller's finished run here means their streams
        // reconnecting between compile and /setup won't re-receive events
        // from it (which was leaving QuickstartProgress's "Run N
        // simulations" stage card with 100+ stale events from the previous
        // bookstore/AGI/clinical run before the new run had even started
        // simulating). A run of theirs in flight is left alone, and so is
        // every other visitor's run. Status polls are NOT a fresh-launch
        // event: they fire every 2s while a compile is in flight.
        // The brief a compile installs is its visitor's (briefFor).
        const installCompiled = quickstartDeps.installCompiledScenario;
        quickstartDeps.installCompiledScenario = (scenario, seedText) => {
          const installed: unknown = installCompiled(scenario, seedText);
          const installedId = installed && typeof installed === 'object' && typeof (installed as { id?: unknown }).id === 'string'
            ? (installed as { id: string }).id
            : scenario.id;
          compiledBriefOwners.set(installedId, readVisitorId(req));
          return installed as ReturnType<typeof installCompiled>;
        };
        if (req.url === '/api/quickstart/compile-from-seed') {
          const own = liveRuns.current(readVisitorId(req));
          if (own && !own.inFlight) liveRuns.clear(own, 'a new compile');
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
        if (refuseUnencryptedKeys(req, res, clientIpHeader !== null, simulateCredentials)) return;
        const hasUserKeys = hasProviderCredentials(simulateCredentials);
        if (serverMode === 'hosted_demo' && !hasUserKeys && fromAnotherSite(req, allowedOrigins)) {
          writeCrossSiteRefusal(res);
          return;
        }
        // The hosted demo's model policy (hosted-model-policy.ts), checked
        // before the day's limit counts the request: a host-paid run on
        // OpenAI with the hosted models, a run on the caller's key on that
        // key's provider, and no fallback to another provider.
        const simulateRouting = hostedModelRouting({ hostedDemo: serverMode === 'hosted_demo', env, credentials: simulateCredentials });
        if (simulateRouting?.payer === 'refused') {
          console.log('  [demo-mode] /simulate refused: a host-paid run needs the host OpenAI key');
          writeHostedRefusal(res, simulateRouting);
          return;
        }
        // On the hosted demo the compile behind /simulate reads no seed URL
        // and runs no web search: both would run on the host's scraping and
        // search keys, which the caller's model keys do not pay for.
        const simulateSeedUrl = (body as { options?: { seedUrl?: unknown } } | null)?.options?.seedUrl;
        if (simulateRouting && typeof simulateSeedUrl === 'string' && simulateSeedUrl.trim() !== '') {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'This server reads no seed URL for /simulate. Send the seed as options.seedText.' }));
          return;
        }
        // Rate limit with BYO-key bypass, matching the /setup pattern.
        // `.check()` alone is advisory; `.record()` consumes the slot.
        if (rateLimiter && !hasUserKeys) {
          const ip = IpRateLimiter.getIp(req, clientIpHeader);
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
          console.log(`  [rate-limit] /simulate: ${remaining - 1} remaining of ${limit}`);
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
            const { runSimulation } = await import('../runtime/orchestrator/index.js');
            const actor = simulateRouting?.payer === 'host' && leader.instructions?.trim()
              ? { ...leader, instructions: clipOrderText(leader.instructions) }
              : leader;
            return runSimulation(actor, keyPersonnel, { ...runOpts, outputDir: runsDir });
          },
        };
        await handleSimulate(req, res, body, deps, simulateCredentials, simulateRouting
          ? {
              ...(simulateRouting.payer === 'host' ? { provider: simulateRouting.provider, models: hostedRunModels() } : {}),
              stayOnProvider: true,
              serverSearch: false,
            }
          : {});
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
        if (refuseUnencryptedKeys(req, res, clientIpHeader !== null, { apiKey, anthropicKey })) return;
        if (!scenarioJson || typeof scenarioJson !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'scenario JSON object required' }));
          return;
        }
        if (Buffer.byteLength(JSON.stringify(scenarioJson)) > MEMORY_SCENARIO_MAX_BYTES) {
          console.warn('[scenarios] compile refused: over the size a compile takes');
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `A scenario sent to /compile is at most ${MEMORY_SCENARIO_MAX_BYTES / 1024} KiB of JSON.` }));
          return;
        }
        const compileCredentials = {
          apiKey: normalizeCredential(apiKey),
          anthropicKey: normalizeCredential(anthropicKey),
        };
        if (serverMode === 'hosted_demo' &&
            (!hasProviderCredentials(compileCredentials) || compileUsesHostSearch(body, env)) &&
            fromAnotherSite(req, allowedOrigins)) {
          writeCrossSiteRefusal(res);
          return;
        }
        // The hosted demo's model policy (hosted-model-policy.ts), checked
        // before the compile limit counts the request: a host-paid compile
        // on OpenAI, a compile on the caller's key on that key's provider,
        // and no fallback to another provider.
        const compileRouting = hostedModelRouting({
          hostedDemo: serverMode === 'hosted_demo',
          env,
          credentials: compileCredentials,
          requestedProvider: typeof requestedProvider === 'string' ? requestedProvider as 'openai' | 'anthropic' : undefined,
        });
        if (compileRouting?.payer === 'refused') {
          console.log('  [demo-mode] /compile refused: a host-paid compile needs the host OpenAI key');
          writeHostedRefusal(res, compileRouting);
          return;
        }

        // A compile lands in the catalog every visitor reads, under the id
        // its JSON carries, so it takes only an id that names nothing yet
        // for anyone else (scenarioIdTaken). Refused here, before the stream
        // opens, the compiler runs or the day's compile count moves.
        const compileVisitor = readVisitorId(req);
        const sourceId: unknown = (scenarioJson as { id?: unknown }).id;
        if (typeof sourceId === 'string' && scenarioIdTaken(compileVisitor, sourceId)) {
          console.warn('[scenarios] compile refused: its id is taken');
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: scenarioIdTakenMessage(sourceId) }));
          return;
        }

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
          const ip = IpRateLimiter.getIp(req, clientIpHeader);
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
          console.log(`  [rate-limit] /compile: ${remaining} remaining of ${limit}`);
        }

        // Web search on the hosted demo runs on the host's search keys,
        // whoever pays for the model. A compile there runs at most
        // HOSTED_COMPILE_MAX_SEARCHES searches, and a caller with their own
        // model key gets the host's search on the same daily compile limit:
        // past it, the compile runs without web search. A seed URL is read
        // through the host's scraping key (FIRECRAWL_API_KEY) whatever
        // webSearch says, so an own-key compile from one counts too, and
        // past the limit it is refused.
        let compileWebSearch = webSearch ?? true;
        let compileMaxSearches = maxSearches;
        if (isHostedDemoCompile) {
          const requested = typeof maxSearches === 'number' && Number.isFinite(maxSearches) ? Math.floor(maxSearches) : HOSTED_COMPILE_MAX_SEARCHES;
          compileMaxSearches = Math.max(0, Math.min(requested, HOSTED_COMPILE_MAX_SEARCHES));
          // A compile searches only for a seed (seedText or seedUrl), so one
          // with neither spends none of the allowance.
          const hasSeedUrl = typeof seedUrl === 'string' && seedUrl.trim() !== '';
          const hasSeed = hasSeedUrl || (typeof seedText === 'string' && seedText.trim() !== '');
          const scrapesOnHostKey = hasSeedUrl && normalizeCredential(env.FIRECRAWL_API_KEY) !== undefined;
          if (userSuppliedKey && hasSeed && (compileWebSearch !== false || scrapesOnHostKey) && rateLimiter) {
            const ip = IpRateLimiter.getIp(req, clientIpHeader);
            const decision = rateLimiter.consumeCompile(ip);
            if (!decision.allowed && scrapesOnHostKey) {
              console.log(`  [rate-limit] /compile: own model key past the compile limit; seed URL refused`);
              res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))),
                'X-RateLimit-Limit': String(decision.limit),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.floor(decision.resetAt / 1000)),
              });
              res.end(JSON.stringify({
                error: `Compile rate limit exceeded. Maximum ${decision.limit} compiles a day read a seed URL through this server's keys; send the seed as seedText instead.`,
                limit: decision.limit,
                remaining: 0,
                resetAt: decision.resetAt,
              }));
              return;
            }
            if (!decision.allowed) {
              compileWebSearch = false;
              console.log(`  [rate-limit] /compile: own model key past the compile limit; compiling without the host's web search`);
            }
          }
        }

        const envDefaultProvider = env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY ? 'anthropic' : 'openai';
        const provider = compileRouting
          ? compileRouting.provider
          : resolveProviderFromCredentials(requestedProvider, compileCredentials, envDefaultProvider);
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
          webSearch: compileWebSearch,
          maxSearches: compileMaxSearches,
          apiKey: compileCredentials.apiKey,
          anthropicKey: compileCredentials.anthropicKey,
          ...(compileRouting ? { stayOnProvider: true } : {}),
          telemetry: compileTelemetry,
          onProgress(hookName: string, status: string) {
            res.write(`event: progress\ndata: ${JSON.stringify({ hook: hookName, status })}\n\n`);
          },
        });

        // Checked again under the compiled id: the compile took a while, and
        // another compile or a store may have taken the id since.
        if (scenarioIdTaken(compileVisitor, compiled.id)) {
          console.warn('[scenarios] compile not kept: its id was taken while it ran');
          res.write(`event: error\ndata: ${JSON.stringify({ error: scenarioIdTakenMessage(compiled.id) })}\n\n`);
          res.end();
          return;
        }

        // Into the catalog only, where it leaves its visitor's memory store
        // if they had stored it. The response is a stream whose headers went
        // out before the compile, so it cannot carry a cookie; the editor
        // that compiled it posts /scenario/switch with the id from
        // `complete`, which makes it that visitor's pick.
        enterCatalog(compiled.id, { scenario: compiled, source: 'compiled' });
        compiledEntryInfo.set(compiled.id, {
          enteredAt: Date.now(),
          address: serverMode === 'hosted_demo' ? IpRateLimiter.getIp(req, clientIpHeader) : null,
        });
        makeRoomAfter(compiled.id);

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

    // POST /clear drops the caller's own current run: a run in flight is
    // stopped (reason user_aborted), and its other viewers (the visitor's
    // other tabs) are told with `run_cleared`. An optional `{ runKey }`
    // body names the run the page held: a page posts /clear and its next
    // run together, and a /clear that lands after the new run opened names
    // the old one, so it stops nothing. A key of another visitor's run is
    // refused. A caller with no run of their own clears nothing: the
    // anonymous run they may be watching is not theirs.
    if (req.url === '/clear' && req.method === 'POST') {
      let body: { runKey?: unknown } = {};
      try {
        const raw = await readBody(req, maxRequestBodyBytes);
        if (raw.trim()) {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as { runKey?: unknown };
        }
      } catch (err) {
        if (err instanceof RequestBodyTooLargeError) {
          writeJsonError(res, err);
          return;
        }
        // Not JSON: read as the empty body the dashboard sends.
      }
      const visitorId = readVisitorId(req);
      const own = liveRuns.current(visitorId);
      const answer = (status: number, payload: Record<string, unknown>) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify(payload));
      };
      const named = typeof body.runKey === 'string' && body.runKey.length > 0 ? body.runKey : null;
      if (named !== null && named !== own?.key) {
        const other = liveRuns.get(named);
        if (other && other.visitorId !== visitorId) {
          answer(403, { error: 'Not your run' });
        } else {
          answer(200, { cleared: false, reason: 'not_current' });
        }
        return;
      }
      if (!own) {
        answer(200, { cleared: false, reason: 'no_run' });
        return;
      }
      liveRuns.clear(own);
      answer(200, { cleared: true, runKey: own.key });
      return;
    }

    if (req.url === '/forget-keys' && req.method === 'POST') {
      const visitorId = readVisitorId(req);
      const run = visitorId === ANONYMOUS_VISITOR ? undefined : liveRuns.current(visitorId);
      // The run their chats went to: their own, else on a local server the
      // shared run they watch, whose agents go and which stays.
      const chatRun = visitorId === ANONYMOUS_VISITOR ? undefined : liveRuns.watched(visitorId);
      const runConfigsDropped = run && (run.config || run.ownKeys) ? 1 : 0;
      const chatAgentsDropped = chatRun ? chatAgentPool?.clearPool(chatRun.key) ?? 0 : 0;
      if (run) liveRuns.clear(run, 'keys_forgotten');
      res.writeHead(200, { 'Content-Type': 'application/json', ...PER_VISITOR_HEADERS });
      res.end(JSON.stringify({ runConfigsDropped, chatAgentsDropped }));
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
        const { agentId, message, history, apiKey, anthropicKey, runKey: chatRunKey, leader: chatLeader } = parsed;
        if (refuseUnencryptedKeys(req, res, clientIpHeader !== null, { apiKey, anthropicKey })) return;
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

        // The run the chat reads: the caller's own current run, else, while
        // they have none, the anonymous run they watch. A `runKey` in the
        // body may name only the caller's own current run: a key read out
        // of a public session replay must not reach another visitor's
        // characters, their memories or their histories.
        const chatVisitor = readVisitorId(req);
        if (chatRunKey !== undefined && chatRunKey !== null && chatRunKey !== liveRuns.current(chatVisitor)?.key) {
          res.writeHead(403, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ error: 'Not your run' }));
          return;
        }
        const chatRun = liveRuns.watched(chatVisitor);

        const ownChatCredentials = {
          apiKey: normalizeCredential(apiKey),
          anthropicKey: normalizeCredential(anthropicKey),
        };
        if (serverMode === 'hosted_demo' && !hasProviderCredentials(ownChatCredentials) && fromAnotherSite(req, allowedOrigins)) {
          writeCrossSiteRefusal(res);
          return;
        }
        // On the hosted demo a chat that brings no key of its own, on a run
        // the visitor's own key paid for, runs on that run's key and
        // provider: the run is the visitor's (their cookie names it) and its
        // people are the run's, so the chat is billed as the run was. A chat
        // on a host-paid run is host-paid. Elsewhere a chat runs on the keys
        // it brings, else the environment's. A /setup run's keys are in its
        // config; a Digital Twin run, which has none, keeps its own.
        const runOwnKeys = chatRun?.config ?? chatRun?.ownKeys;
        const runChatCredentials = {
          apiKey: normalizeCredential(runOwnKeys?.apiKey),
          anthropicKey: normalizeCredential(runOwnKeys?.anthropicKey),
        };
        const chatCredentials = serverMode === 'hosted_demo'
          && !hasProviderCredentials(ownChatCredentials)
          && hasProviderCredentials(runChatCredentials)
          ? runChatCredentials
          : ownChatCredentials;
        const chatUserKey = hasProviderCredentials(chatCredentials);
        // The hosted demo's model policy (hosted-model-policy.ts), checked
        // before the chat limit counts the request.
        const chatRouting = hostedModelRouting({
          hostedDemo: serverMode === 'hosted_demo',
          env,
          credentials: chatCredentials,
          requestedProvider: runOwnKeys?.provider,
        });
        if (chatRouting?.payer === 'refused') {
          console.log('  [demo-mode] /chat refused: a host-paid chat needs the host OpenAI key');
          writeHostedRefusal(res, chatRouting);
          return;
        }

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
          const ip = IpRateLimiter.getIp(req, clientIpHeader);
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
            console.log(`  [rate-limit] /chat: ${remaining} remaining of ${limit}`);
          }
        }
        chatInflight++;
        inflightSlot = true;

        // The chat route builds agents from the run's event buffer. If there
        // is no run (the visitor has not run one, the buffer went with the
        // idle time, or the visitor hit /clear) there is nothing to build
        // from. Phrase the error so users understand it is a server-side
        // emptiness, not "the run you just finished is gone forever".
        if (!chatRun || chatRun.buffer.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server has no simulation in memory right now. Run a new simulation from the Settings tab, or reload this page so your saved events restore from cache.' }));
          return;
        }
        liveRuns.touch(chatRun);

        // Import chat agent system (lazy to avoid startup cost)
        const chatAgents = chatAgentPool ??= await import('../runtime/agents/chat-agents.js');
        if (chatRun.dropped) {
          res.writeHead(409, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ error: 'This run has been cleared.' }));
          return;
        }
        const { extractColonistMemories, extractColonistRoster, extractRunTurns } = chatAgents;
        const getOrCreateChatAgent = options.chatAgent ?? chatAgents.getOrCreateChatAgent;

        // Extract sim events and find colonist profile
        const runSimEvents = simEventsOf(chatRun);
        const reactsAs = (r: any) =>
          r.agentId === agentId || String(r.name || '').toLowerCase().includes(String(agentId).toLowerCase());

        // A pair run holds two colonies of the same people, one under each
        // leader. The character speaks from one of them: the leader the
        // request names, else the first leader under whom they reacted, so
        // their memories, their roster and their agent are that colony's
        // alone and never a mix of two lives.
        const runLeaders: string[] = [];
        for (const e of runSimEvents as any[]) {
          const name = typeof e.leader === 'string' ? e.leader : '';
          if (name && !runLeaders.includes(name)) runLeaders.push(name);
        }
        if (chatLeader !== undefined && chatLeader !== null && (typeof chatLeader !== 'string' || !runLeaders.includes(chatLeader))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No leader named ${JSON.stringify(chatLeader)} in this run.` }));
          return;
        }
        const reactedUnder = (runSimEvents as any[]).find(e =>
          e.type === 'agent_reactions' && typeof e.leader === 'string' && e.leader && (e.data?.reactions || []).some(reactsAs),
        )?.leader as string | undefined;
        const leaderName: string | undefined = typeof chatLeader === 'string' ? chatLeader : reactedUnder ?? runLeaders[0];
        const simEvents = leaderName
          ? (runSimEvents as any[]).filter(e => e.leader === leaderName)
          : runSimEvents;

        const agentReactions = simEvents
          .filter((e: any) => e.type === 'agent_reactions')
          .flatMap((e: any) => (e.data?.reactions || []).filter(reactsAs));
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

        // Extract simulation memories for this colonist. The nouns are the
        // run's, whatever scenario this visitor has picked since.
        const runScenario = chatRun.scenario ?? customScenarioCatalog.get(chatRun.scenarioId)?.scenario ?? marsScenario;
        const runLabels = runScenario.labels;
        const memories = extractColonistMemories(agentId, simEvents, runLabels?.timeUnitNoun, runLabels);
        // Extract the full agent roster from the latest systems_snapshot so
        // the chat agent knows who else exists. Without this, the agent
        // confabulates fake bios for any name the user invents.
        const roster = extractColonistRoster(simEvents);
        // The turns this life ran through, each with its year: the character
        // is told these and the leader, which no memory or roster line names.
        const turns = extractRunTurns(simEvents);
        // The Chat tab opens once the first turn is done, so the run may
        // still be going: its turns so far are then not the run's. The
        // run has ended once its buffer holds the `complete` frame, as
        // /results reads it.
        const runEnded = chatRun.buffer.some(msg => msg.startsWith('event: complete\n'));
        // A run cancelled or cut by a provider error ends with a `complete`
        // frame too, one that says `aborted`: its last turn may not have
        // finished, so its turns are not told as the whole run.
        const runStopped = chatRun.buffer.some(msg => msg.startsWith('event: complete\n') && completeFrameAborted(msg));

        // Get or create the agent (lazy init with memory seeding). The pool
        // keys it by run and leader, so two visitors talking to one
        // colonist id in two runs, or one visitor talking to the same
        // person under each leader, get agents with their own memories;
        // and by whether the run had ended, so the first chat after the
        // end gets an agent made from the whole run.
        const envDefaultProvider = env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY ? 'anthropic' : 'openai';
        const provider = chatRouting
          ? chatRouting.provider
          : resolveProviderFromCredentials(chatRun.config?.provider, chatCredentials, envDefaultProvider);
        const { session, isNew, release, model } = await getOrCreateChatAgent(profile, memories, {
          provider,
          apiKey: chatCredentials.apiKey,
          anthropicKey: chatCredentials.anthropicKey,
          visitorKeyIdleMs: STALE_BUFFER_MS,
          isRunDropped: () => chatRun.dropped,
          ...(chatRouting ? { stayOnProvider: true } : {}),
          settlementNoun: runLabels?.settlementNoun,
          populationNoun: runLabels?.populationNoun,
          labels: runLabels,
          roster,
          runKey: chatRun.key,
          leader: leaderName,
          turns,
          runEnded,
          runStopped,
        });

        // Send message through the agent session (full history + memory + RAG automatic)
        const result = await session.send(message).finally(() => release?.());
        const { model: responseModel, modelId } = result as { model?: unknown; modelId?: unknown };
        const reportedModel = responseModel ?? modelId;
        const chatModel = typeof reportedModel === 'string' && reportedModel.trim() ? reportedModel : model;

        // Surface per-turn token usage + cost so the dashboard footer
        // can fold chat spend into the run-total display. Without this,
        // the cost readout only reflected the simulation pipeline and
        // users racked up chat charges invisibly.
        const usage = (result as { usage?: { totalTokens?: number; costUSD?: number; promptTokens?: number; completionTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } }).usage ?? {};
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          reply: result.text,
          ...(chatModel ? { aiAuthorship: { model: chatModel, fields: ['reply'] } } : {}),
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

    // GET /results[?run=<key>] — full structured simulation results
    // including verdict, of the named run, else of the caller's current run
    // (the anonymous run while they have none of their own). Reconstructs
    // per-leader payloads from the run's SSE buffer so consumers get the
    // same rich data the dashboard sees, without having to scrape raw
    // events themselves. The answer varies by cookie, so no cache keeps it.
    if ((req.url === '/results' || req.url?.startsWith('/results?')) && req.method === 'GET') {
      const runKey = namedRunKey(req.url);
      liveRuns.sweep();
      const run = runKey !== null ? liveRuns.get(runKey) : liveRuns.watched(readVisitorId(req));
      if (runKey !== null && !run) {
        writeUnknownRun(res, runKey);
        return;
      }
      if (run) liveRuns.touch(run);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json', ...PER_VISITOR_HEADERS });
      res.end(JSON.stringify(run
        ? { ...resultsOf(run), runKey: run.key, scenarioId: run.scenarioId, inFlight: run.inFlight }
        : { ...buildResultsPayloadFromEventBuffer([]), runKey: null }));
      return;
    }

    if (req.url === '/rate-limit' && req.method === 'GET') {
      const clientIp = IpRateLimiter.getIp(req, clientIpHeader);
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
          runsInFlight: liveRuns.inFlightCount(),
          runsHeld: liveRuns.heldCount(),
          maxRuns: liveRuns.maxRuns,
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

    // Saves the run named with ?run=<key>, else the admin's current run.
    if ((req.url === '/admin/sessions/save' || req.url?.startsWith('/admin/sessions/save?')) && req.method === 'POST') {
      if (!requireAdminToken(req, res)) return;
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      const runKey = namedRunKey(req.url);
      const run = runKey !== null ? liveRuns.get(runKey) : liveRuns.watched(readVisitorId(req));
      if (runKey !== null && !run) {
        writeUnknownRun(res, runKey);
        return;
      }
      if (!run || run.buffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'no buffered events to save' }));
        return;
      }
      try {
        // Build the timestamped event array from the run's recording (the
        // buffer, with any frames its trim took before the run's save was
        // decided, read back from its recording file). For events whose
        // timestamp is 0 (rehydrated from disk pre-timestamp-tracking), use
        // the next known timestamp so replay pacing stays monotonic instead
        // of bunching at the start.
        const now = Date.now();
        let events: TimestampedEvent[];
        if (run.framesLost) {
          // The buffer no longer holds every frame and no recording file
          // holds the rest: the whole run is its committed session.
          const stored = run.savedSessionId !== null ? await sessionStore.getSession(run.savedSessionId) : null;
          if (!stored) {
            res.writeHead(409, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ error: "the run's buffer no longer holds every frame, and no saved session holds the run" }));
            return;
          }
          events = stored.events;
        } else {
          const recording = await runRecording(run);
          if (!recording) {
            res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
            res.end(JSON.stringify({ error: "the run's recording is not whole: a frame its buffer trimmed could not be read back" }));
            return;
          }
          events = recording.frames.map((sse, i) => ({
            ts: recording.timestamps[i] || now,
            sse,
          }));
        }
        // An admin save is pinned: listed to every visitor, never evicted.
        const result = await sessionStore.saveSession(events, undefined, { pinned: true });
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

    // Admin scenario delete: drops a single auto-persisted compiled
    // scenario from disk + the in-memory catalog. Builtins (mars,
    // lunar) are protected — those ship with the engine and can't be
    // removed via API. Disk-loaded scenarios from the hand-curated
    // /scenarios directory are also protected so an admin click on a
    // catalog card never wipes a tracked draft. Effectively the
    // catalog gain a per-card delete affordance for compiled
    // scenarios only.
    const adminScenarioMatch = req.url
      ? req.url.match(/^\/admin\/scenarios\/([^/?#]+)$/)
      : null;
    if (adminScenarioMatch && req.method === 'DELETE') {
      if (!requireAdminToken(req, res)) return;
      const id = decodeURIComponent(adminScenarioMatch[1]);
      const entry = customScenarioCatalog.get(id);
      // A scenario visitors stored in memory under this id goes from every
      // visitor's store; the catalog's entry, if any, is handled below.
      const dropFromMemory = (): number => dropFromEveryMemoryStore(id);
      if (!entry) {
        const memoryDeleted = dropFromMemory();
        if (memoryDeleted > 0) {
          console.log(`[scenarios] admin deleted ${id} from ${memoryDeleted} visitor memory store(s)`);
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ deleted: true, id, fileDeleted: false, catalogDeleted: false, metaDeleted: false, memoryDeleted }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'scenario_not_found', id }));
        return;
      }
      if (entry.source === 'builtin') {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'cannot_delete_builtin', id }));
        return;
      }
      if (entry.source === 'disk') {
        // Hand-curated drafts in scenarios/ are tracked in git for the
        // operator's deployment. Admin delete from the dashboard would
        // bypass that workflow. Refuse and tell the user to remove the
        // file via their normal repo flow.
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({
          error: 'cannot_delete_curated_disk_scenario',
          id,
          message: 'Disk-loaded scenarios are tracked in scenarios/. Remove the file via your repo to delete.',
        }));
        return;
      }
      // Compiled-from-seed scenarios: drop disk file (best-effort) +
      // in-memory catalog + meta map. A visitor whose cookie still names
      // it reads as having no pick and gets the default, Mars Genesis.
      const fileDeleted = deletePersistedCompiledScenario(scenarioDir, id);
      const catalogDeleted = customScenarioCatalog.delete(id);
      const metaDeleted = compiledScenarioMeta.delete(id);
      compiledEntryInfo.delete(id);
      compiledBriefOwners.delete(id);
      groundingCitationsByScenarioId.delete(id);
      const memoryDeleted = dropFromMemory();
      console.log(`[scenarios] admin deleted ${id} (file=${fileDeleted} catalog=${catalogDeleted} meta=${metaDeleted} memory=${memoryDeleted})`);
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({
        deleted: true,
        id,
        fileDeleted,
        catalogDeleted,
        metaDeleted,
        memoryDeleted,
      }));
      return;
    }

    // Admin destructive wipe: clears the runs + sessions tables and
    // optionally the v3-*.json artifact files in the runs directory
    // (run output and imported copies).
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
      // Default-on: the live runs' buffers are the SSE replay source.
      // Leaving them intact while wiping every other store means a page
      // reload re-renders the just-wiped run from its buffer, which
      // surprised users and looked like Wipe All wasn't actually working.
      // Runs in flight are left alone: they are some visitor's live run.
      const wipeEventBuffer = body.wipeEventBuffer !== false;

      const result: { runs: number; sessions: number; outputFiles: number; eventBuffer: boolean; runsKept?: number } = { runs: 0, sessions: 0, outputFiles: 0, eventBuffer: false };
      // A wipe that deletes the saved sessions: a save whose recording is
      // still being read is not committed; one already committing is waited
      // for, so the wipe deletes it; a save that starts now waits for the
      // wipe.
      const wipesSessions = Boolean(wipeSessions && sessionStore);
      let finishWipe: () => void = () => {};
      const wipe = new Promise<void>(resolve => { finishWipe = () => resolve(); });
      if (wipesSessions) {
        wipeGeneration += 1;
        wipeInProgress = wipe;
      }
      try {
        if (wipesSessions) await Promise.all([...savesCommitting]);
        if (wipeRuns && runHistoryStore?.wipeAll) {
          result.runs = await runHistoryStore.wipeAll();
        }
        if (wipeSessions && sessionStore) {
          result.sessions = await sessionStore.wipeAll();
        }
        if (wipeEventBuffer) {
          // Every visitor's finished runs go, with their files under
          // .live-runs/; their pages are told with run_cleared.
          result.runsKept = liveRuns.dropFinished(wipesSessions ? run => runsWiped.add(run) : undefined);
          result.eventBuffer = true;
        }
        if (wipeOutput) {
          const outputDir = runsDir;
          if (existsSync(outputDir)) {
            for (const file of readdirSync(outputDir)) {
              if (isRunOutputFileName(file)) {
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
      } finally {
        if (wipeInProgress === wipe) wipeInProgress = null;
        finishWipe();
      }
      return;
    }

    // The session routes match on the parsed path, so a query (`?speed=`)
    // never sends a replay request to the metadata route.
    const sessionsPath = req.url?.startsWith('/sessions') ? new URL(req.url, 'http://localhost').pathname : null;
    const sessionMetaId = sessionsPath !== null ? /^\/sessions\/([^/]+)$/.exec(sessionsPath)?.[1] ?? null : null;
    const sessionReplayId = sessionsPath !== null ? /^\/sessions\/([^/]+)\/replay$/.exec(sessionsPath)?.[1] ?? null : null;

    if (sessionsPath === '/sessions' && req.method === 'GET') {
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      try {
        // On the hosted demo a visitor's list holds their own saved runs and
        // the sessions an admin saved; a local server lists every session.
        const sessions = await sessionStore.listSessions(
          serverMode === 'hosted_demo' ? { owner: sessionOwner(readVisitorId(req)) } : undefined,
        );
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders, ...PER_VISITOR_HEADERS });
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
    if (sessionsPath?.startsWith('/sessions/') && sessionReplayId === null && req.method === 'GET') {
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      const id = sessionMetaId;
      if (!id) {
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
      // The brief a run started from goes only to the visitor whose run it
      // was, or with an admin-saved session, on the hosted demo.
      const meta = briefHiddenFrom(session, req)
        ? { ...session.meta, seedText: undefined }
        : session.meta;
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders, ...PER_VISITOR_HEADERS });
      res.end(JSON.stringify({ meta }));
      return;
    }

    if (sessionReplayId !== null && req.method === 'GET') {
      if (!sessionStore) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session store unavailable' }));
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const id = sessionReplayId;
      const speedRaw = url.searchParams.get('speed');
      // Default replay mode is INSTANT (no pacing) — when the user clicks
      // a cached run from the Library / Load menu, they want to scrub
      // through it like a saved file, not watch it play out in real time.
      // The original wall-clock pacing is still available via explicit
      // `?speed=1` (or any number) for callers that want replay-theater.
      // `?speed=instant` and the omitted-param default both bypass pacing
      // entirely.
      const isInstant = !speedRaw || speedRaw === 'instant' || speedRaw === '0';
      const speed = isInstant ? 0 : Math.max(0.25, Math.min(50, parseFloat(speedRaw) || 1));
      const session = await sessionStore.getSession(id);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'session not found', id }));
        return;
      }
      // SSE stream: same headers as /events. By default events are
      // delivered as fast as the socket allows so the dashboard
      // visualization populates immediately. Pass `?speed=1` (or any
      // positive number) to fall back to the original wall-clock pacing
      // scaled by that factor (1 = real-time, 4 = 4x faster, 0.5 = half).
      if (!admitStream(req, res, corsHeaders)) return;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...corsHeaders,
      });
      let cancelled = false;
      req.on('close', () => { cancelled = true; });
      res.on('close', () => { cancelled = true; });
      // A replay is shared by its link, but the brief the run started from
      // follows the metadata route's rule: only the visitor whose run it
      // was reads it, on the hosted demo.
      const hideBrief = briefHiddenFrom(session, req);
      void (async () => {
        const provenance = session.meta.provenance
          ?? recordedRunProvenance(session.events.map(event => event.sse))
          ?? makeRunProvenance({});
        if (session.events.length === 0) {
          res.end(`event: provenance\ndata: ${JSON.stringify({ provenance })}\n\n`);
          return;
        }
        let first = true;
        let prevTs = session.events[0].ts;
        for (const ev of session.events) {
          if (cancelled || res.destroyed) return;
          if (!isInstant) {
            const delay = Math.max(0, (ev.ts - prevTs) / speed);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
            prevTs = ev.ts;
          }
          try {
            // A frame the reader has not taken yet waits for 'drain', so
            // a reader that does not read holds a buffer's worth of the
            // session, never the whole of it.
            const frame = publicResultFrame(ev.sse);
            const visible = hideBrief ? withoutBrief(frame) : frame;
            const outgoing = first ? withRunProvenance(visible, provenance) : visible;
            first = false;
            if (!res.write(outgoing)) await waitForDrain(res);
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
        if (refuseUnencryptedKeys(req, res, clientIpHeader !== null, config)) return;

        // The run's scenario: the one the body names (Settings and the
        // re-run button at the top level, the Quickstart tab under
        // quickstart), else a fork's parent's, else the visitor's pick,
        // else the server's default. It supplies every setup value the body
        // omits (start time, time per turn, population, seed, turns, key
        // personnel). The Quickstart tab posts only the leaders, turns and
        // seed, so without the scenario here an Atlas Lab run started at
        // "Month 2035" with the Mars colonists. Resolved before the rate
        // limit, so a refused or waiting request does not spend the day's run.
        const bodyScenarioId = config.scenarioId ?? (config.quickstart as { scenarioId?: unknown } | undefined)?.scenarioId;
        const forkParentScenarioId = (config.forkFrom as
          | { parentArtifact?: { metadata?: { scenario?: { id?: unknown } } } }
          | undefined)?.parentArtifact?.metadata?.scenario?.id;
        const resolvedScenario = resolveRequestScenario(
          req,
          typeof bodyScenarioId === 'string' ? bodyScenarioId : undefined,
          config.forkFrom ? forkParentScenarioId : undefined,
        );
        if (!('scenario' in resolvedScenario)) {
          writeScenarioRefusal(res, resolvedScenario);
          return;
        }
        const runScenario = resolvedScenario.scenario;
        const runScenarioSeedText = briefFor(runScenario.id, req, compiledScenarioMeta.get(runScenario.id)?.seedText) ?? null;

        // The per-IP day limit is bypassed when the request brings its own
        // provider keys. It is checked here and charged only once the run
        // is admitted, below: a request refused for any reason costs no run.
        const requestCredentials = {
          apiKey: normalizeCredential(config.apiKey),
          anthropicKey: normalizeCredential(config.anthropicKey),
        };
        const hasUserKeys = hasProviderCredentials(requestCredentials);
        if (serverMode === 'hosted_demo' && !hasUserKeys && fromAnotherSite(req, allowedOrigins)) {
          writeCrossSiteRefusal(res);
          return;
        }
        const rateIp = rateLimiter && !hasUserKeys ? IpRateLimiter.getIp(req, clientIpHeader) : null;
        /** Answers 429 and returns true when the caller's IP has used its runs of the day. */
        const overTheDay = (): boolean => {
          if (!rateLimiter || rateIp === null) return false;
          const { allowed, limit, resetAt } = rateLimiter.check(rateIp);
          if (allowed) return false;
          console.log(`  [rate-limit] /setup blocked (${limit}/${limit} used)`);
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
            // When the day's count resets, as GET /rate-limit says it: the
            // page keeps the refusal until a count for a later day has a run.
            resetAt,
          }));
          return true;
        };
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

        // The visitor whose run this is: the paracosm_visitor cookie the
        // dashboard's HTML gave the browser, else the anonymous visitor. On
        // the hosted demo every caller that sends no cookie is a different
        // person, so such a caller's run gets a visitor id of its own, sent
        // back as its cookie and in the answer (runVisitorFor).
        const { visitorId, setCookie: visitorSetCookie } = runVisitorFor(req);
        const setup = config as SimulationSetupPayload;
        let simConfig = normalizeSimulationConfig(setup, runScenario);

        // Spec 2B: validate fork preconditions against the supplied
        // parent artifact before spinning up the orchestrator.
        if (simConfig.forkFrom) {
          const { parentArtifact } = simConfig.forkFrom;
          const forkTurn = simConfig.forkFrom.atTurn;
          const forkValidation = validateForkSetupPreconditions({
            parentArtifact,
            atTurn: forkTurn,
            activeScenarioId: runScenario.id,
            // Only the caller's own run in flight refuses a fork; another
            // visitor's run is theirs.
            activeRunInProgress: liveRuns.current(visitorId)?.inFlight === true,
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
        // The hosted demo's model policy (hosted-model-policy.ts): a run on
        // the host's keys runs on OpenAI with the demo's models and caps, a
        // run on the visitor's key on that key's provider, and no call of
        // either falls back to another provider. A host with no OpenAI key
        // refuses a host-paid run, whatever other key it holds, before the
        // run counts toward the day.
        const setupRouting = hostedModelRouting({
          hostedDemo: isHostedDemo,
          env,
          credentials: requestCredentials,
          requestedProvider: simConfig.provider,
        });
        if (setupRouting?.payer === 'refused') {
          console.log('  [demo-mode] /setup refused: a host-paid run needs the host OpenAI key');
          writeHostedRefusal(res, setupRouting);
          return;
        }
        if (setupRouting) simConfig = { ...simConfig, stayOnProvider: true };
        if (setupRouting?.payer === 'host') {
          simConfig = applyDemoCaps(simConfig);
          console.log(
            `  [demo-mode] Capped run: turns=${simConfig.turns} pop=${simConfig.initialPopulation} ` +
            `depts=${simConfig.activeDepartments.length} models=${simConfig.models.commander}`,
          );
        }
        // A run's web search on the hosted demo uses only the search keys
        // the request names: the day's run limit does not count a run on
        // the caller's own model key, so the host's search keys would have
        // no bound there. Such a run with no search key of its own runs
        // without live search.
        const hasOwnSearchKey = [simConfig.serperKey, simConfig.firecrawlKey, simConfig.tavilyKey]
          .some(key => normalizeCredential(key) !== undefined);
        if (isHostedDemo && simConfig.liveSearch && !hasOwnSearchKey) {
          simConfig = { ...simConfig, liveSearch: false };
        }

        // `turns` is the absolute final turn, after the demo cap. A fork
        // with none left would answer 200 here and fail in the runner.
        if (simConfig.forkFrom && simConfig.turns <= simConfig.forkFrom.atTurn) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `A fork at turn ${simConfig.forkFrom.atTurn} has no turn left to run: this run ends at turn ${simConfig.turns}. Fork at an earlier turn.`,
          }));
          return;
        }

        // The config this request launches. It was a closure variable that
        // a concurrent /clear nulled during the awaits below, which
        // produced "Cannot read properties of null (reading 'actors')"
        // 400s; it is this request's own now.
        const launchConfig = simConfig;
        // The run's key, minted here so the answer and the run's
        // `active_scenario` event carry the same one.
        const launchRunKey = randomUUID();

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
        const { generateBundleId } = await import('./services/bundle-id.js');
        const bundleId = launchConfig.actors.length >= 2 ? generateBundleId() : undefined;
        const runRecord = createRunRecord({
          scenarioId: runScenario.id,
          scenarioVersion: runScenario.version,
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
          leader: import('../runtime/orchestrator/index.js').ActorConfig,
        ) => {
          // The actor's final cost, kept with the run for its saved
          // session whatever happens to the run-history insert below. It is
          // kept under the actor's place in the launch: an artifact's run id
          // is `<scenario>-<archetype>-<ms>`, which two actors of one
          // archetype that finish in one millisecond share.
          const actorCost = (artifact as { cost?: { totalUSD?: unknown } }).cost?.totalUSD;
          const run = liveRuns.get(launchRunKey);
          const actorIndex = (launchConfig.actors as readonly unknown[]).indexOf(leader);
          const costKey = actorIndex >= 0
            ? `actor:${actorIndex}`
            : typeof artifact.metadata?.runId === 'string' ? artifact.metadata.runId : null;
          if (run && costKey !== null && typeof actorCost === 'number' && Number.isFinite(actorCost)) {
            run.artifactCosts.set(costKey, actorCost);
          }
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
            // The run is its visitor's: recorded under the key their saved
            // sessions are stored under.
            await runHistoryStore.insertRun(enriched, { owner: sessionOwner(visitorId) });
            // Remember the runId so autoSaveOnComplete can backfill
            // session_id once the broadcast's sessionStore.saveSession
            // returns. The push happens AFTER insertRun resolves so a
            // failed insert doesn't enqueue a runId that doesn't exist.
            liveRuns.get(launchRunKey)?.insertedRunIds.push(enriched.runId);
          } catch (error) {
            console.warn('[run-history] per-artifact insert failed:', error);
          }
        };

        // From here to the charge there is no await: of two requests of one
        // IP at its last run of the day, one gets the run, and a refused
        // request stops nothing. A refused request leaves the visitor's run
        // alone: over their day, or the server at its run cap. The visitor's
        // run in flight, which this run replaces and stops as it opens, does
        // not count against them, nor does a run their Clear stopped right
        // before; every other run still settling does, and so does a Digital
        // Twin run of theirs, which nothing stops
        // (LiveRunRegistry.checkCapacity). The new run's runner waits for the
        // run it replaced to settle (startWithConfig).
        if (overTheDay()) return;

        // startWithConfig opens the run with its active_scenario event, so a
        // page that connects later replays it too.
        const launched = (() => {
          try {
            return marsServer.startWithConfig(launchConfig, {
              scenario: runScenario,
              seedText: runScenarioSeedText,
              onArtifact: onArtifactPersist,
              visitorId,
              runKey: launchRunKey,
              ownKeyAddress: hasUserKeys ? IpRateLimiter.getIp(req, clientIpHeader) : null,
              searchEnv: isHostedDemo ? {} : undefined,
              filledOrderCount: countMissingOrders(
                setup.actors.slice(0, launchConfig.actors.length),
                setupRouting?.payer === 'host' ? MAX_ORDER_CHARS : undefined,
              ),
            });
          } catch (err) {
            if (err instanceof RunCapacityError) return err;
            throw err;
          }
        })();
        if (launched instanceof RunCapacityError) {
          console.log(`  [runs] Refused a run for ${visitorId.slice(0, 8)}: ${launched.runsInFlight} in flight, the most is ${launched.maxRuns}`);
          writeRunCapacityRefusal(res, launched);
          return;
        }
        console.log(`  Running scenario: ${JSON.stringify(runScenario.labels?.name ?? runScenario.id)} (${JSON.stringify(runScenario.id)})`);
        launched.catch((error) => {
          console.warn('[setup] simulation failed:', error);
        });
        if (rateLimiter && rateIp !== null) {
          rateLimiter.record(rateIp);
          const { remaining } = rateLimiter.check(rateIp);
          console.log(`  [rate-limit] /setup: ${remaining} remaining of ${maxSims}`);
        } else if (hasUserKeys) {
          console.log(`  [rate-limit] Bypassed — user provided API keys`);
        }

        // A run in a scenario that is not the visitor's pick makes it their
        // pick. The dashboard opens /sim after a run, and a page shows a run
        // only in its own scenario; two tabs of one browser share the
        // cookie, so a tab that loaded Mars Genesis before another tab
        // picked Atlas Lab would otherwise come up without the Mars Genesis
        // run it started.
        const currentPick = resolveRequestScenario(req);
        const runPickCookie = 'scenario' in currentPick && currentPick.scenario.id === runScenario.id
          ? null
          : pickCookie(runScenario.id, pickCookieSecure);
        const setupCookies = [runPickCookie, visitorSetCookie].filter((c): c is string => typeof c === 'string');
        res.writeHead(200, { 'Content-Type': 'application/json', ...(setupCookies.length > 0 ? { 'Set-Cookie': setupCookies } : {}) });
        res.end(JSON.stringify({
          redirect: '/sim',
          scenarioId: runScenario.id,
          scenarioName: runScenario.labels?.name,
          // The run's key (its active_scenario event's runKey) and the
          // visitor it belongs to. A page whose stream was opened under
          // another visitor id reopens it (two tabs opened at once).
          runKey: launchRunKey,
          visitorId,
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

    // Serve hand-crafted diagram SVGs (system flow, etc). Single source
    // at `assets/diagrams/` — referenced from landing.html and the
    // README. Same path-traversal guard as `/brand/` and `/demo/`; same
    // file types; same cache policy.
    if (req.url?.split('?')[0].startsWith('/diagrams/')) {
      try {
        const diagramRoot = resolve(__dirname, '..', '..', 'assets', 'diagrams');
        const diagramPath = resolve(diagramRoot, req.url.split('?')[0].replace('/diagrams/', ''));
        const insideRoot = diagramPath === diagramRoot || diagramPath.startsWith(diagramRoot + sep);
        if (insideRoot && existsSync(diagramPath) && statSync(diagramPath).isFile()) {
          const ext = diagramPath.split('.').pop() || '';
          const types: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg' };
          res.writeHead(200, {
            'Content-Type': types[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600, s-maxage=300',
          });
          res.end(readFileSync(diagramPath));
          return;
        }
      } catch (err) {
        console.warn(`[diagrams] failed to serve ${req.url}: ${(err as Error).message}`);
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
      // Only a regular file is served. `/demo/` itself, or any folder under
      // it, answers 404: a folder handed to the read stream fails with EISDIR.
      const stat = insideDemo ? regularFileStat(demoPath) : undefined;
      if (stat) {
        const ext = demoPath.split('.').pop() || '';
        const types: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg' };
        const contentType = types[ext] || 'application/octet-stream';
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
          // Stream the requested chunk so we don't buffer the whole
          // file into memory per request.
          streamFile(res, demoPath, 206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
          }, { start, end });
          return;
        }

        // No Range header: full-file response, but still advertise
        // Accept-Ranges so browsers know they can seek on subsequent
        // requests.
        streamFile(res, demoPath, 200, {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        });
        return;
      }
    }

    // SEO + AI-crawler assets — sitemap.xml, robots.txt, llms.txt, and
    // llms-full.txt live in the dashboard's public/ tree (Vite copies
    // them to dist/ on build) but Vite only mounts that tree under its
    // own asset routes. Serve them explicitly from the root so
    // paracosm.agentos.sh/sitemap.xml + /robots.txt + /llms.txt +
    // /llms-full.txt resolve cleanly. Without these handlers Cloudflare
    // returns 404 and Search Console / GPTBot / Perplexity can't crawl.
    // /.well-known/llms.txt mirrors /llms.txt for forward-compatibility
    // with the proposed RFC location.
    if (
      req.url === '/sitemap.xml' ||
      req.url === '/robots.txt' ||
      req.url === '/llms.txt' ||
      req.url === '/llms-full.txt' ||
      req.url === '/.well-known/llms.txt'
    ) {
      try {
        // server-app.ts now lives at src/server/, dashboard at src/dashboard/.
        // Resolve relative to the parent (`..`) so the path lands on the
        // sibling dashboard tree rather than `src/server/dashboard/...`.
        const distDir = resolve(__dirname, '../dashboard/dist');
        const fileName = req.url === '/.well-known/llms.txt' ? 'llms.txt' : req.url.slice(1);
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
    // server-app.ts is at src/server/, dashboard build at src/dashboard/dist/.
    // The leading `..` walks up to src/ before descending into dashboard.
    const distDir = resolve(__dirname, '../dashboard/dist');
    const hasViteBuild = existsSync(resolve(distDir, 'index.html'));
    const pathname = (req.url || '/').split('?')[0];

    // Landing page at /
    if (pathname === '/' || pathname === '/index.html') {
      const landingPath = resolve(__dirname, '../dashboard/landing.html');
      if (existsSync(landingPath)) {
        // Inject the package version into the schema.org LD+JSON block
        // so search engines and social previews show the real current
        // release instead of the stale literal that sat there
        // (`0.1.0` lingered in the HTML long after we shipped 0.4.x).
        // The placeholder is what lives on disk; we swap it per-request
        // since it's a one-line string replace on a cached template.
        const page = readFileSync(landingPath, 'utf-8').replace(
          /__PARACOSM_VERSION__/g,
          PARACOSM_VERSION,
        ).replaceAll('__VISITOR_KEY_IDLE_MINUTES__', String(visitorKeyIdleMinutes));
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
        res.end(siteAnalytics ? withSiteAnalytics(page, analyticsPage(req)) : page);
        return;
      }
    }

    // API docs (TypeDoc generated). Only /docs and paths under /docs/ reach
    // this route, and it serves only what resolves inside docs/api: the
    // request path arrives as the visitor sent it, `..` segments included.
    // A real file is served first. A path that names no file answers 301 to
    // `<path>.html` when that page exists, so a link written without `.html`
    // finds its page; the page wins over a folder of the same name, as
    // TypeDoc writes both modules.html and modules/. Then a folder serves
    // its index.html.
    if (pathname === '/docs' || pathname.startsWith('/docs/')) {
      const docsDir = resolve(__dirname, '..', '..', 'docs', 'api');
      // The npm package does not ship docs/api, so an install sends the landing
      // page's and the dashboard's docs links to the hosted paracosm reference
      // instead of answering 404.
      if (!existsSync(docsDir)) {
        res.writeHead(302, { Location: 'https://docs.agentos.sh/paracosm' });
        res.end();
        return;
      }
      // A permanent redirect: the navigation, the footers and the structured
      // data all link /docs, and the module index is its page.
      if (pathname === '/docs' || pathname === '/docs/') {
        res.writeHead(301, { Location: '/docs/modules.html' });
        res.end();
        return;
      }
      let docPath = pathname.replace('/docs', '');
      if (!docPath || docPath === '/') docPath = '/modules.html';
      const filePath = resolve(docsDir, docPath.startsWith('/') ? docPath.slice(1) : docPath);
      if (filePath !== docsDir && !filePath.startsWith(docsDir + sep)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      // A path that names no file: the page with `.html` added, one trailing
      // slash dropped, answers 301. The target comes from the resolved path,
      // so it stays inside docs/api.
      const htmlPath = resolve(docsDir, docPath.slice(1).replace(/\/$/, '') + '.html');
      const redirectToPage = (): boolean => {
        let isPage = false;
        try {
          isPage = htmlPath.startsWith(docsDir + sep) && statSync(htmlPath).isFile();
        } catch {}
        if (!isPage) return false;
        const queryAt = (req.url || '').indexOf('?');
        const query = queryAt === -1 ? '' : (req.url || '').slice(queryAt);
        res.writeHead(301, { Location: `/docs/${relative(docsDir, htmlPath).split(sep).join('/')}${query}` });
        res.end();
        return true;
      };
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
              `<link rel="icon" href="/favicon.png" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link href="/brand/fonts/fonts.css" rel="stylesheet"><link rel="stylesheet" href="/docs/assets/paracosm-override.css">
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
    <a href="https://github.com/framerslab/paracosm" target="_blank" rel="noopener">GitHub</a>
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
  <a href="https://github.com/framerslab/paracosm" target="_blank" rel="noopener">GitHub</a>
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
    <a href="https://github.com/framerslab/paracosm">GitHub</a>
    <a href="https://www.npmjs.com/package/paracosm">npm</a>
    <a href="https://frame.dev">Frame.dev</a>
    <a href="https://frame.dev">Frame</a>
    <a href="/#privacy">Privacy</a>${siteAnalytics ? '\n    <button type="button" class="pdf-consent" data-consent-open hidden>Analytics choices</button>' : ''}
  </div>
  <span><span style="font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-weight:700;letter-spacing:.08em;font-size:10px">PARA<span style="color:#e8b44a">COSM</span></span> &middot; Apache-2.0 &middot; <a href="https://frame.dev">Frame.dev</a></span>
</div></body>`);
            res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
            res.end(siteAnalytics ? withSiteAnalytics(html, analyticsPage(req)) : html);
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
        // The page wins over a folder of the same name.
        if (redirectToPage()) return;
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
      } catch {
        // statSync throws when no file or folder has that name.
        if (redirectToPage()) return;
      }
    }

    // Vite assets (CSS, JS, fonts)
    if (req.url?.startsWith('/assets/')) {
      const assetPath = resolve(distDir, req.url.slice(1));
      // Path-traversal guard: same vulnerability as the /brand/ and
      // /demo/ routes. Reject anything that resolves outside distDir.
      const insideDist = assetPath === distDir || assetPath.startsWith(distDir + sep);
      // A folder (`/assets/` itself, or one inside it) answers 404; reading
      // it as a file throws EISDIR.
      if (insideDist && regularFileStat(assetPath)) {
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
        // The dashboard's HTML gives a browser its visitor id, once: the one
        // answer every dashboard load gets before any script runs. The page
        // opens /events and fetches /scenario at the same moment, so if those
        // minted ids too the stream and the run could belong to two visitors.
        // No cache may hand one visitor's id to another.
        const htmlHeaders: Record<string, string> = { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' };
        if (readVisitorId(req) === ANONYMOUS_VISITOR) {
          htmlHeaders['Set-Cookie'] = visitorCookie(randomUUID(), pickCookieSecure);
        }
        res.writeHead(200, htmlHeaders);
        res.end(siteAnalytics ? withSiteAnalytics(html, analyticsPage(req)) : html);
        return;
      }
      // A source checkout has no dashboard build until it runs one; the npm
      // package always ships it (scripts/pack-dashboard.mjs refuses to pack without).
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The dashboard is not built. Run `npm install` in src/dashboard, then `npm run dashboard:build` in the repository root, and reload.');
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };

  // Every request's handler is awaited here, so an error a route did not
  // catch answers 500 (or ends a response already under way) instead of
  // rejecting the listener's promise, which Node's default unhandled
  // rejection mode turns into the process's exit.
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      console.error('[server] request failed:', req.method, req.url?.slice(0, 200), err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'internal_error' }));
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  }) as MarsServer;

  // Clean up on server close: the rate limiter's timers, and the live runs'
  // pending writes (flushed, so a restart reads every run back) and timers.
  (server as Server).on('close', () => {
    clearInterval(importCleanupTimer);
    if (rateLimiter) rateLimiter.destroy();
    linkRetriesStopped = true;
    for (const timer of linkRetryTimers) clearTimeout(timer);
    linkRetryTimers.clear();
    liveRuns.close();
  });

  // A run that finished before the server last stopped, with its save not
  // yet committed, is saved now, under its run key, so it is saved once.
  for (const run of liveRuns.finishedUnsaved()) {
    console.log(`[sessions] saving run ${run.key}, which finished before the restart`);
    autoSaveOnComplete(run).catch((err) => console.warn('[sessions] save after restart failed:', err));
  }
  // A run saved before the restart whose Library link had failed is linked now.
  for (const run of liveRuns.pendingLinks()) {
    console.log(`[run-history] linking the Library records of run ${run.key}, saved before the restart`);
    void linkLibraryRecords(run, run.pendingLink!);
  }

  const marsServer = Object.assign(server, {
    startWithConfig(config: NormalizedSimulationConfig, hooks?: StartConfigHooks): Promise<void> {
      // Opening the run is synchronous: admission (RunCapacityError when the
      // server is at its cap), the replacement of the visitor's current run,
      // and the run's active_scenario event, so /setup can answer 503 before
      // any run exists.
      const runScenario = hooks?.scenario ?? marsScenario;
      const visitorId = hooks?.visitorId ?? ANONYMOUS_VISITOR;
      // Run pressed while running means start over: the visitor's run in
      // flight is replaced as this one opens, dropped (its later events go
      // nowhere) and stopped.
      const replacing = liveRuns.current(visitorId);
      const run = liveRuns.open({
        visitorId,
        runKey: hooks?.runKey,
        ownKeyAddress: hooks?.ownKeyAddress ?? null,
        kind: config.forkFrom ? 'fork' : config.actors.length >= 3 ? 'batch' : 'pair',
        scenario: runScenario,
        seedText: hooks?.seedText ?? null,
        config,
        provenance: resolveRunProvenance(config, env),
        forkedFrom: config.forkFrom
          ? { parentRunId: config.forkFrom.parentArtifact.metadata.runId, atTurn: config.forkFrom.atTurn }
          : null,
      });
      const filledOrderCount = hooks?.filledOrderCount ?? 0;
      if (filledOrderCount > 0) console.log(`[orders] filled empty instructions for ${filledOrderCount} leader(s)`);
      // The run writes to its own buffer and viewers. Once its visitor has
      // replaced or cleared it, its last events and its end go nowhere.
      const runBroadcast = liveRuns.broadcastFor(run);
      const signal = run.controller!.signal;
      return (async () => {
        try {
          // The run this one replaced gets up to 5 s to settle first, so its
          // last model calls do not run beside this run's first. A Digital
          // Twin run takes no signal, so there is nothing to wait for.
          if (replacing?.inFlight && replacing.kind !== 'intervention') {
            console.log(`  [setup] Run ${run.key} waits for run ${replacing.key}, which it replaced, to stop`);
            const waitStart = Date.now();
            while (replacing.inFlight && Date.now() - waitStart < 5000) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }
          // Thread the run's scenario through to the pair
          // runner. Without this the runner defaults to Mars regardless
          // of which scenario the user compiled, so the page title would
          // show the custom name but the simulation would run Mars
          // hooks + content. Fork path (Spec 2B) dispatches to
          // runForkSimulation instead of the pair runner when the
          // config carries a forkFrom reference.
          if (config.forkFrom) {
            await startFork(config, runBroadcast, signal, runScenario, hooks?.onArtifact, { outputDir: runsDir, searchEnv: hooks?.searchEnv });
          } else if (config.actors.length >= 3) {
            // Tier 5 Quickstart dispatches N >= 3 leaders to the batch
            // runner (same SSE contract per leader, no verdict).
            await startBatch(config, runBroadcast, signal, runScenario, hooks?.onArtifact, undefined, { outputDir: runsDir, searchEnv: hooks?.searchEnv });
          } else {
            await startSimulations(config, runBroadcast, signal, runScenario, hooks?.onArtifact, { outputDir: runsDir, searchEnv: hooks?.searchEnv });
          }
        } finally {
          // The run's capacity slot is free once its runner has settled,
          // whether or not it was dropped before that.
          liveRuns.finish(run);
        }
      })();
    },
  });

  return marsServer;
}
