/**
 * Client-side helper for the async-job compile-from-seed endpoint.
 *
 * The server splits compile into start (`POST /compile-from-seed` →
 * 202 + jobId) and status (`POST /compile-from-seed/status` → 200 +
 * status). This avoids Cloudflare's 100s edge timeout on long
 * compiles by keeping every individual response sub-second.
 *
 * `compileScenarioWithPolling` does the full dance:
 *   1. POST start with the seed payload.
 *   2. If the server returns a fully-resolved scenario inline (cache
 *      hit), return it immediately — no polling round-trip.
 *   3. Otherwise poll status every `pollIntervalMs` until status is
 *      `'done'` (return scenario), `'error'` (throw with the message),
 *      or `timeoutMs` elapses (throw a timeout error).
 *
 * Cancellation: an optional `AbortSignal` aborts both the start POST
 * and the polling loop — if the user navigates away mid-compile the
 * server-side compile keeps running but the client stops listening.
 *
 * @module paracosm/dashboard/quickstart/compile-poll
 */
import type { ScenarioPackage } from '../../../../engine/types.js';

export interface CompileFromSeedPayload {
  seedText: string;
  sourceUrl?: string;
  domainHint?: string;
  actorCount?: number;
}

export interface CompileScenarioResult {
  scenario: ScenarioPackage;
  scenarioId: string;
  jobId: string;
}

interface CompilePollOptions {
  /** Override fetch — used by tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the wait between polls — used by tests. Default 2000 ms. */
  pollIntervalMs?: number;
  /** Hard cap on total elapsed time before throwing. Default 5 min. */
  timeoutMs?: number;
  /** Cancellation signal. Throws an `AbortError` when triggered. */
  signal?: AbortSignal;
  /** Override the wait primitive — used by tests to step time. */
  waitImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Compile-job response shape — matches both the start endpoint's
 *  202 / inline-cache 200 response and the status endpoint's 200. */
interface JobResponse {
  jobId: string;
  status: 'pending' | 'done' | 'error';
  scenario?: ScenarioPackage;
  scenarioId?: string;
  error?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readJobResponse(res: Response): Promise<JobResponse> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Compile returned non-JSON HTTP ${res.status} response`);
  }
  if (!res.ok && (!parsed || typeof parsed !== 'object')) {
    throw new Error(`Compile failed: HTTP ${res.status}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Compile returned empty body');
  }
  return parsed as JobResponse;
}

export async function compileScenarioWithPolling(
  payload: CompileFromSeedPayload,
  opts: CompilePollOptions = {},
): Promise<CompileScenarioResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wait = opts.waitImpl ?? defaultWait;
  const startedAt = Date.now();

  const startRes = await fetchImpl('/api/quickstart/compile-from-seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });
  if (!startRes.ok && startRes.status !== 202) {
    const body = await startRes.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error ?? `Compile failed: HTTP ${startRes.status}`);
  }
  const start = await readJobResponse(startRes);

  if (start.status === 'done' && start.scenario) {
    return { scenario: start.scenario, scenarioId: start.scenario.id, jobId: start.jobId };
  }
  if (start.status === 'error') {
    throw new Error(start.error ?? 'Compile failed');
  }

  // Poll until done, error, or timeout. Each poll is sub-second so
  // Cloudflare's 100s edge timeout never fires.
  while (Date.now() - startedAt < timeoutMs) {
    await wait(pollIntervalMs, opts.signal);
    const statusRes = await fetchImpl('/api/quickstart/compile-from-seed/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: start.jobId }),
      signal: opts.signal,
    });
    if (!statusRes.ok) {
      // 404 means the job vanished from the server's TTL cache. Treat
      // it as terminal; without server-side state the user must retry.
      if (statusRes.status === 404) {
        throw new Error('Compile job expired or not found. Please retry.');
      }
      const body = await statusRes.json().catch(() => ({} as { error?: string }));
      throw new Error(body.error ?? `Compile status check failed: HTTP ${statusRes.status}`);
    }
    const job = await readJobResponse(statusRes);
    if (job.status === 'done' && job.scenario) {
      return { scenario: job.scenario, scenarioId: job.scenario.id, jobId: job.jobId };
    }
    if (job.status === 'error') {
      throw new Error(job.error ?? 'Compile failed');
    }
  }

  throw new Error(
    `Compile is taking longer than ${Math.round(timeoutMs / 1000)}s. The server may still be working — please retry in a minute.`,
  );
}
