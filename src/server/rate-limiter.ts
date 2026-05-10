/**
 * IP-based rate limiter with optional JSON-file persistence.
 *
 * Extracted from server-app.ts so the quota machinery can be unit-tested
 * without spinning up the whole HTTP server and so createMarsServer reads
 * more like a route file. Behavior is unchanged.
 *
 * Three buckets keyed by IP:
 *   - simStore / maxPerDay:        /setup (most expensive action, daily)
 *   - compileStore / maxCompilePerDay: /compile (~$0.10 per call, daily)
 *   - chatStore / maxChatPerHour:  /chat (hourly, users legitimately
 *                                  burst but scripts/loops flatten the
 *                                  budget if unlimited)
 *
 * When a persistencePath is supplied, state is loaded on construct and
 * flushed on every mutation via a 500ms-debounced atomic write
 * (tmp + rename). pm2 restarts preserve user quotas. Missing or corrupt
 * files self-heal at next mutation.
 *
 * @module paracosm/cli/rate-limiter
 */

import type { IncomingMessage } from 'node:http';
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';

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

export class IpRateLimiter {
  private simStore = new Map<string, RateLimitEntry>();
  private compileStore = new Map<string, RateLimitEntry>();
  private chatStore = new Map<string, RateLimitEntry>();
  /** Last waitlist-submission timestamp per IP (Unix ms). 5-minute
   *  sliding window — abuse mitigation only; genuine users only
   *  submit once. */
  private waitlistLastSeen = new Map<string, number>();
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
  private cleanupTimer: ReturnType<typeof setInterval>;
  private persistencePath: string | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    maxPerDay: number = 3,
    maxCompilePerDay: number = 5,
    maxChatPerHour: number = 30,
    persistencePath: string | null = null,
    maxChatGlobalPerHour: number = 500,
  ) {
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
        });
        const tmp = `${this.persistencePath}.tmp`;
        writeFileSync(tmp, payload, 'utf-8');
        renameSync(tmp, this.persistencePath);
      } catch {
        // Disk full, permission denied — swallow; logs would be noisy.
      }
    }, 500);
  }

  /** Extract client IP, respecting reverse proxy headers (Cloudflare,
   *  nginx, etc).
   *
   *  Header priority is intentional. Behind Cloudflare,
   *  `cf-connecting-ip` is set by CF on every request to the original
   *  client IP and CANNOT be spoofed by the client (CF strips any
   *  inbound copy). It's the only header that's reliable when the
   *  origin is reachable through CF.
   *
   *  `x-forwarded-for` goes second because nginx configurations differ
   *  on whether they preserve, append, or overwrite the chain — when
   *  nginx replaces XFF with `$remote_addr` (the immediate-upstream
   *  CF edge IP), the "first" in the chain becomes a rotating CF edge
   *  IP and the rate limiter ends up keying every request to a fresh
   *  IP. Production traffic was effectively unlimited under this bug
   *  until cf-connecting-ip was promoted to the top of the chain. */
  static getIp(req: IncomingMessage): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) {
      const v = Array.isArray(cfIp) ? cfIp[0] : cfIp;
      if (v) return v;
    }
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
      if (first) return first;
    }
    const realIp = req.headers['x-real-ip'];
    if (realIp) return Array.isArray(realIp) ? realIp[0] : realIp;
    return req.socket.remoteAddress || 'unknown';
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
    const entry = this.simStore.get(ip);
    if (entry) {
      entry.count++;
      this.persist();
    }
  }

  /** Check AND consume a slot for /compile (daily bucket, ~$0.10/call). */
  consumeCompile(ip: string): RateLimitDecision {
    return this.bump(this.compileStore, ip, this.maxCompilePerDay, 'daily', true);
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

  /** Per-IP 5-minute sliding cooldown for waitlist submissions.
   *  Decision shape matches the bucket-based methods so callers can
   *  treat them uniformly. Genuine users only ever submit once;
   *  the cap exists as abuse mitigation, not a budget. */
  consumeWaitlist(ip: string): RateLimitDecision {
    const COOLDOWN_MS = 5 * 60 * 1000;
    const now = Date.now();
    const last = this.waitlistLastSeen.get(ip);
    if (last !== undefined && now - last < COOLDOWN_MS) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: last + COOLDOWN_MS,
        limit: 1,
      };
    }
    this.waitlistLastSeen.set(ip, now);
    return {
      allowed: true,
      remaining: 0,
      resetAt: now + COOLDOWN_MS,
      limit: 1,
    };
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
    for (const store of [this.simStore, this.compileStore, this.chatStore]) {
      for (const [ip, entry] of store) {
        if (now >= entry.resetAt) {
          store.delete(ip);
          mutated = true;
        }
      }
    }
    const WAITLIST_COOLDOWN_MS = 5 * 60 * 1000;
    for (const [ip, last] of this.waitlistLastSeen) {
      if (now - last >= WAITLIST_COOLDOWN_MS) {
        this.waitlistLastSeen.delete(ip);
        // No persist() — waitlistLastSeen is in-memory only; the
        // persistence path only writes the count-based buckets.
      }
    }
    if (mutated) this.persist();
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }
}
