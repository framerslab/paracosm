/**
 * IP-based rate limiter with optional JSON-file persistence.
 *
 * Extracted from server-app.ts so the quota machinery can be unit-tested
 * without spinning up the whole HTTP server and so createMarsServer reads
 * more like a route file. Behavior is unchanged.
 *
 * Four buckets keyed by IP:
 *   - simStore / maxPerDay:        /setup and a hosted Digital Twin run
 *                                  (most expensive action, daily)
 *   - compileStore / maxCompilePerDay: /compile and a hosted Quickstart
 *                                  compile (~$0.10 per call, daily)
 *   - chatStore / maxChatPerHour:  /chat (hourly, users legitimately
 *                                  burst but scripts/loops flatten the
 *                                  budget if unlimited)
 *   - quickstartStore / maxQuickstartPerDay: the hosted Quickstart's
 *                                  grounding, actor and URL routes (daily)
 *
 * The IP is the connection's address unless the server names the one
 * proxy header it trusts (PARACOSM_CLIENT_IP_HEADER, see
 * readClientIpHeader). Reading a limit adds no entry; only a charge does.
 *
 * When a persistencePath is supplied, state is loaded on construct and
 * flushed on every mutation via a 500ms-debounced atomic write
 * (tmp + rename). pm2 restarts preserve user quotas. Missing or corrupt
 * files self-heal at next mutation.
 *
 * @module paracosm/cli/rate-limiter
 */

import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';

/** The proxy headers a server can be told to read the client's address from. */
export type ClientIpHeader = 'cf-connecting-ip' | 'x-real-ip' | 'x-forwarded-for';
const CLIENT_IP_HEADERS: readonly ClientIpHeader[] = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for'];

/**
 * Reads PARACOSM_CLIENT_IP_HEADER: the one header the proxy in front of the
 * server sets to the client's address. Unset or empty, the limits key on
 * the connection's address and every address header is ignored, since any
 * caller can send one. Set it only when every request reaches the server
 * through that proxy, which overwrites the header: `cf-connecting-ip` behind
 * Cloudflare, `x-real-ip` or `x-forwarded-for` behind a proxy that sets them.
 * Any other value logs a warning and keys on the connection's address.
 */
export function readClientIpHeader(env: NodeJS.ProcessEnv): ClientIpHeader | null {
  const raw = (env.PARACOSM_CLIENT_IP_HEADER ?? '').trim().toLowerCase();
  if (!raw) return null;
  if ((CLIENT_IP_HEADERS as readonly string[]).includes(raw)) return raw as ClientIpHeader;
  console.warn(`  [rate-limit] PARACOSM_CLIENT_IP_HEADER=${JSON.stringify(env.PARACOSM_CLIENT_IP_HEADER)} is not one of ${CLIENT_IP_HEADERS.join(', ')}; keying limits on the connection's address.`);
  return null;
}

interface RateLimitEntry {
  count: number;
  resetAt: number; // epoch ms
}

/**
 * Supported rate-limit windows. Daily resets at next UTC midnight, hourly
 * resets on the hour, so the math is always easy to eyeball in logs.
 */
type WindowKind = 'daily' | 'hourly';

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Reads a limit from the server's environment as a whole number of zero or
 * more, written in digits. Unset or empty gives `fallback`. Any other value
 * (abc, -1, 2.5, 10abc, 1e3) also gives `fallback` and logs one warning that
 * names it. parseInt would read those as NaN, a negative number or a
 * truncated one, and a NaN or negative RATE_LIMIT turns the limit off, which
 * on the hosted demo means unlimited use of the host's keys.
 */
export function readLimitFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
  console.warn(`  [rate-limit] ${name}=${JSON.stringify(raw)} is not a whole number of zero or more; using ${fallback}.`);
  return fallback;
}

export class IpRateLimiter {
  private simStore = new Map<string, RateLimitEntry>();
  private compileStore = new Map<string, RateLimitEntry>();
  private chatStore = new Map<string, RateLimitEntry>();
  private quickstartStore = new Map<string, RateLimitEntry>();
  /** Single-bucket global counter for /chat. Per-IP caps are
   *  trivially evaded by IP rotation (VPNs, proxy pools, residential
   *  proxies), so we additionally cap the hosted-key chat budget
   *  across all IPs. When this budget is exhausted, every non-keyed
   *  request gets 429'd until the hour rolls over. */
  private chatGlobal: RateLimitEntry = { count: 0, resetAt: 0 };
  private maxPerDay: number;
  private maxCompilePerDay: number;
  private maxChatPerHour: number;
  private maxChatGlobalPerHour: number;
  private maxQuickstartPerDay: number;
  private cleanupTimer: ReturnType<typeof setInterval>;
  private persistencePath: string | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    maxPerDay: number = 3,
    maxCompilePerDay: number = 5,
    maxChatPerHour: number = 30,
    persistencePath: string | null = null,
    maxChatGlobalPerHour: number = 500,
    maxQuickstartPerDay: number = 20,
  ) {
    this.maxQuickstartPerDay = maxQuickstartPerDay;
    this.maxPerDay = maxPerDay;
    this.maxCompilePerDay = maxCompilePerDay;
    this.maxChatPerHour = maxChatPerHour;
    this.maxChatGlobalPerHour = maxChatGlobalPerHour;
    this.persistencePath = persistencePath;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    this.load();
  }

  /** Load persisted state from disk. Silently tolerates missing/corrupt files. */
  private load(): void {
    if (!this.persistencePath) return;
    try {
      if (!existsSync(this.persistencePath)) return;
      const raw = readFileSync(this.persistencePath, 'utf-8');
      const data = JSON.parse(raw) as {
        sim?: Record<string, RateLimitEntry>;
        compile?: Record<string, RateLimitEntry>;
        chat?: Record<string, RateLimitEntry>;
        quickstart?: Record<string, RateLimitEntry>;
      };
      const now = Date.now();
      const hydrate = (store: Map<string, RateLimitEntry>, src: Record<string, RateLimitEntry> | undefined) => {
        if (!src) return;
        for (const [ip, entry] of Object.entries(src)) {
          if (entry?.resetAt && entry.resetAt > now) store.set(ip, entry);
        }
      };
      hydrate(this.simStore, data.sim);
      hydrate(this.compileStore, data.compile);
      hydrate(this.chatStore, data.chat);
      hydrate(this.quickstartStore, data.quickstart);
    } catch {
      // Missing file, permission denied, corrupt JSON — start fresh.
    }
  }

  /** Debounced flush to disk. Writes atomically via tmp+rename. */
  private persist(): void {
    if (!this.persistencePath) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (!this.persistencePath) return;
      try {
        const dump = (s: Map<string, RateLimitEntry>): Record<string, RateLimitEntry> => {
          const out: Record<string, RateLimitEntry> = {};
          for (const [ip, e] of s) out[ip] = e;
          return out;
        };
        const payload = JSON.stringify({
          sim: dump(this.simStore),
          compile: dump(this.compileStore),
          chat: dump(this.chatStore),
          quickstart: dump(this.quickstartStore),
        });
        const tmp = `${this.persistencePath}.tmp`;
        writeFileSync(tmp, payload, 'utf-8');
        renameSync(tmp, this.persistencePath);
      } catch {
        // Disk full, permission denied — swallow; logs would be noisy.
      }
    }, 500);
  }

  /** The client's address: the connection's, or, when the server trusts
   *  one proxy header (readClientIpHeader), that header's value.
   *
   *  Behind Cloudflare, `cf-connecting-ip` is set by Cloudflare on every
   *  request to the original client IP and Cloudflare strips any inbound
   *  copy, so it is reliable only for requests that came through
   *  Cloudflare. `x-forwarded-for` is read from its last entry, the one the
   *  trusted proxy appended; the entries before it are the caller's own.
   *  A header value that is not an IPv4 or IPv6 address (node:net isIP) is
   *  ignored, so a caller cannot make a key of any text they like. */
  static getIp(req: IncomingMessage, trustedHeader: ClientIpHeader | null = null): string {
    const socketIp = req.socket.remoteAddress || 'unknown';
    if (!trustedHeader) return socketIp;
    const raw = req.headers[trustedHeader];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    if (!value) return socketIp;
    const candidate = trustedHeader === 'x-forwarded-for'
      ? (value.split(',').pop() ?? '').trim()
      : value.trim();
    return isIP(candidate) ? candidate : socketIp;
  }

  private nextReset(kind: WindowKind): number {
    if (kind === 'daily') {
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      return tomorrow.getTime();
    }
    const nextHour = new Date();
    nextHour.setUTCMinutes(60, 0, 0);
    return nextHour.getTime();
  }

  private bump(
    store: Map<string, RateLimitEntry>,
    ip: string,
    limit: number,
    kind: WindowKind,
    mutate: boolean,
  ): RateLimitDecision {
    const now = Date.now();
    let entry = store.get(ip);
    let mutated = false;
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: this.nextReset(kind) };
      // A read leaves the store as it was: only a charge keeps an entry.
      if (!mutate) return { allowed: entry.count < limit, remaining: limit, resetAt: entry.resetAt, limit };
      store.set(ip, entry);
      mutated = true;
    }
    const allowed = entry.count < limit;
    if (allowed && mutate) {
      entry.count++;
      mutated = true;
    }
    const remaining = Math.max(0, limit - entry.count);
    if (mutated) this.persist();
    return { allowed, remaining, resetAt: entry.resetAt, limit };
  }

  /** Check the simulation-per-day quota without consuming it. */
  check(ip: string): RateLimitDecision {
    return this.bump(this.simStore, ip, this.maxPerDay, 'daily', false);
  }

  /** Record a simulation start. Prefer `check` + `record` for legacy callers. */
  record(ip: string): void {
    this.bump(this.simStore, ip, Number.POSITIVE_INFINITY, 'daily', true);
  }

  /** Gives back a simulation charged by `record` for a run that did not start. */
  unrecord(ip: string): void {
    const entry = this.simStore.get(ip);
    if (entry && entry.count > 0) {
      entry.count--;
      this.persist();
    }
  }

  /** Check AND consume a slot for /compile (daily bucket, ~$0.10/call). */
  consumeCompile(ip: string): RateLimitDecision {
    return this.bump(this.compileStore, ip, this.maxCompilePerDay, 'daily', true);
  }

  /** Check AND consume a slot for the hosted Quickstart's grounding, actor
   *  and URL routes (daily bucket of their own). */
  consumeQuickstart(ip: string): RateLimitDecision {
    return this.bump(this.quickstartStore, ip, this.maxQuickstartPerDay, 'daily', true);
  }

  /** Check AND consume a slot for /chat (hourly bucket).
   *  Returns the FIRST tripwire to fail: either the per-IP bucket
   *  exhausted by this caller, or the global hourly cap exhausted
   *  by aggregate traffic across all IPs. The global cap only
   *  decrements when the per-IP slot was actually granted, so a
   *  blocked-by-IP attempt doesn't burn the shared budget. */
  consumeChat(ip: string): RateLimitDecision {
    const ipResult = this.bump(this.chatStore, ip, this.maxChatPerHour, 'hourly', true);
    if (!ipResult.allowed) return ipResult;
    // Per-IP slot granted; now charge the global bucket.
    const now = Date.now();
    if (this.chatGlobal.resetAt <= now) {
      this.chatGlobal = { count: 0, resetAt: this.nextReset('hourly') };
    }
    if (this.chatGlobal.count >= this.maxChatGlobalPerHour) {
      // Global cap hit. Refund the per-IP slot we just took so the
      // caller can retry next hour without losing their per-IP budget
      // to a shared-quota miss.
      const ipEntry = this.chatStore.get(ip);
      if (ipEntry && ipEntry.count > 0) ipEntry.count--;
      return {
        allowed: false,
        remaining: 0,
        resetAt: this.chatGlobal.resetAt,
        limit: this.maxChatGlobalPerHour,
      };
    }
    this.chatGlobal.count++;
    return ipResult;
  }

  /** Get stats for monitoring endpoints. */
  stats(): {
    totalIps: number;
    sim: Array<{ ip: string; count: number; resetAt: string }>;
    compile: Array<{ ip: string; count: number; resetAt: string }>;
    chat: Array<{ ip: string; count: number; resetAt: string }>;
  } {
    const dump = (s: Map<string, RateLimitEntry>) =>
      [...s.entries()].map(([ip, e]) => ({ ip, count: e.count, resetAt: new Date(e.resetAt).toISOString() }));
    return {
      totalIps: this.simStore.size + this.compileStore.size + this.chatStore.size,
      sim: dump(this.simStore),
      compile: dump(this.compileStore),
      chat: dump(this.chatStore),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    let mutated = false;
    for (const store of [this.simStore, this.compileStore, this.chatStore, this.quickstartStore]) {
      for (const [ip, entry] of store) {
        if (now >= entry.resetAt) {
          store.delete(ip);
          mutated = true;
        }
      }
    }
    if (mutated) this.persist();
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }
}
