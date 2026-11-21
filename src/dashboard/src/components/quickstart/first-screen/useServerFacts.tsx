/**
 * What the server answers that the Run tab's first screen reads: the day's
 * free runs (GET /rate-limit), whether this is the hosted demo and its caps
 * (GET /admin-config), and the saved runs (GET /sessions, through
 * useSessions). Each is asked once a page. Every field of an answer is
 * checked before it is used; a field that is missing or of the wrong kind is
 * left out, so the words that read it are left out rather than drawn blank.
 *
 * @module paracosm/dashboard/quickstart/first-screen/useServerFacts
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSessions, type SessionsStatus, type StoredSessionMeta } from '../../../hooks/useSessions';

/** The day's count of free runs for this internet address. */
export interface RateLimitAnswer {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** When the count resets, in milliseconds since the epoch. */
  resetAt: number;
}

/** The host's caps on a run on its keys. */
export interface DemoCaps {
  maxTurns?: number;
  maxPopulation?: number;
  maxActiveDepartments?: number;
}

/** A saved run as the list names it. */
export type SessionRow = StoredSessionMeta & { pinned?: boolean };

type RateLimitState = { status: 'loading' | 'ready' | 'unlimited' | 'error'; answer?: RateLimitAnswer };
type AdminConfigState = { status: 'loading' | 'ready' | 'error'; hostedDemo?: boolean; demoCaps?: DemoCaps };

export interface ServerFacts {
  rateLimit: RateLimitState & { refresh(): Promise<void> };
  adminConfig: AdminConfigState;
  sessions: { status: SessionsStatus; rows: SessionRow[]; refresh(): void };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** GET /rate-limit's answer: unlimited, a whole count, or an error when a field is missing. */
export function parseRateLimit(body: unknown): RateLimitState {
  if (!isObject(body)) return { status: 'error' };
  if (body.unlimited === true) return { status: 'unlimited' };
  const { allowed, remaining, limit, resetAt } = body;
  if (typeof allowed !== 'boolean' || !isWhole(remaining) || !isWhole(limit) || !isWhole(resetAt)) return { status: 'error' };
  return { status: 'ready', answer: { allowed, remaining, limit, resetAt } };
}

/** GET /admin-config's answer: hostedDemo when it is a boolean, and each cap that is a whole number above 0. */
export function parseAdminConfig(body: unknown): AdminConfigState {
  if (!isObject(body)) return { status: 'error' };
  const out: AdminConfigState = { status: 'ready' };
  const hostedDemo = body.hostedDemo;
  if (typeof hostedDemo === 'boolean') out.hostedDemo = hostedDemo;
  const demoCaps = body.demoCaps;
  if (isObject(demoCaps)) {
    const caps: DemoCaps = {};
    for (const key of ['maxTurns', 'maxPopulation', 'maxActiveDepartments'] as const) {
      const value = demoCaps[key];
      if (isWhole(value) && value > 0) caps[key] = value;
    }
    out.demoCaps = caps;
  }
  return out;
}

const ServerFactsContext = createContext<ServerFacts | null>(null);

/** Asks the server once a page and gives its answers to the first screen. */
export function ServerFactsProvider({ children }: { children: ReactNode }) {
  const [rateLimit, setRateLimit] = useState<RateLimitState>({ status: 'loading' });
  const [adminConfig, setAdminConfig] = useState<AdminConfigState>({ status: 'loading' });
  const sessions = useSessions();

  const refreshRateLimit = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/rate-limit', { cache: 'no-store' });
      setRateLimit(res.ok ? parseRateLimit(await res.json()) : { status: 'error' });
    } catch {
      setRateLimit({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void refreshRateLimit();
  }, [refreshRateLimit]);

  useEffect(() => {
    let cancelled = false;
    fetch('/admin-config', { cache: 'no-store' })
      .then(async (res) => (res.ok ? parseAdminConfig(await res.json()) : ({ status: 'error' } as const)))
      .catch(() => ({ status: 'error' } as const))
      .then((state) => {
        if (!cancelled) setAdminConfig(state);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ServerFacts>(() => ({
    rateLimit: { ...rateLimit, refresh: refreshRateLimit },
    adminConfig,
    sessions: { status: sessions.status, rows: sessions.sessions as SessionRow[], refresh: sessions.refresh },
  }), [rateLimit, refreshRateLimit, adminConfig, sessions.status, sessions.sessions, sessions.refresh]);

  return <ServerFactsContext.Provider value={value}>{children}</ServerFactsContext.Provider>;
}

/** The server's answers, inside ServerFactsProvider. */
export function useServerFacts(): ServerFacts {
  const facts = useContext(ServerFactsContext);
  if (!facts) throw new Error('useServerFacts must be used within ServerFactsProvider');
  return facts;
}
