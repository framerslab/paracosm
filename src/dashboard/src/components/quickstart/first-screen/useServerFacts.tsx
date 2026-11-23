/**
 * What the server answers that the Run tab's first screen reads: the day's
 * free runs (GET /rate-limit), whether this is the hosted demo and its caps
 * (GET /admin-config), and the saved runs (GET /sessions, through
 * useSessions). Each is asked once a page, with two more reads: the day's
 * count is read again once its reset time has come while none is left, and
 * a read of /admin-config that failed is tried again, at 2 seconds and then
 * at longer gaps up to 15. A press of Start that the server
 * refuses at the day's limit is kept too, so the screen says the limit
 * even when the count it last read said a run was left; while it is kept
 * and the count could not be read, the count is asked for again at the same
 * gaps, so the screen learns the reset time and, once the refused day has
 * reset, that a run is left. Every field of an answer is
 * checked before it is used; a field that is missing or of the wrong kind is
 * left out, so the words that read it are left out rather than drawn blank.
 *
 * @module paracosm/dashboard/quickstart/first-screen/useServerFacts
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { savedSessions, useSessions, type SessionsStatus, type StoredSessionMeta } from '../../../hooks/useSessions';

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

export type RateLimitState = { status: 'loading' | 'ready' | 'unlimited' | 'error'; answer?: RateLimitAnswer };
type AdminConfigState = { status: 'loading' | 'ready' | 'error'; hostedDemo?: boolean; demoCaps?: DemoCaps };

export interface ServerFacts {
  /** `refresh` asks again and answers what the server said, so a press of Start reads the count it acts on. */
  rateLimit: RateLimitState & { refresh(): Promise<RateLimitState> };
  adminConfig: AdminConfigState;
  /** `refresh` asks again and settles once the answer is in. */
  sessions: { status: SessionsStatus; rows: SessionRow[]; refresh(): Promise<void> };
  /** True once a press of Start was refused at the day's limit (POST /setup answered 429 with none left). */
  limitMet: boolean;
  /**
   * Keeps that the day's limit was met, until a count read after that day's
   * reset says a run is left, or the page leaves. `resetAt` is that day's
   * reset time: the refusal's own, or the count's read before the press.
   */
  markLimitMet(resetAt?: number): void;
}

/** Whether this internet address has no free run left today: the count says none, or a press was refused at the limit. */
export function noFreeRunLeft(facts: Pick<ServerFacts, 'rateLimit' | 'limitMet'>): boolean {
  return facts.limitMet || (facts.rateLimit.status === 'ready' && facts.rateLimit.answer?.remaining === 0);
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

/** How long after the reset time the count is read again, so the server's own clock has passed it. */
const RESET_READ_MARGIN_MS = 1_000;
/** The longest wait a browser's timer holds (2^31 - 1 milliseconds). */
const LONGEST_TIMER_MS = 2_147_483_647;
/** A read of /admin-config that failed is tried again after this long, then at twice the gap each time. */
const SETTINGS_RETRY_FIRST_MS = 2_000;
/** The longest gap between two tries of /admin-config. */
const SETTINGS_RETRY_MAX_MS = 15_000;
/**
 * The count is asked for again after this long, then at twice the gap each
 * time: a read of /rate-limit that failed while a refusal is kept, a count
 * with no run left whose reset time has passed by this page's clock, and a
 * read made for a count with no run left that failed.
 */
const COUNT_RETRY_FIRST_MS = 2_000;
/** The longest gap between two of those tries. */
const COUNT_RETRY_MAX_MS = 15_000;

/** One read of GET /rate-limit, checked. It changes nothing on the page. */
async function readRateLimit(): Promise<RateLimitState> {
  try {
    const res = await fetch('/rate-limit', { cache: 'no-store' });
    return res.ok ? parseRateLimit(await res.json()) : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Asks the server and gives its answers to the first screen. */
export function ServerFactsProvider({ children }: { children: ReactNode }) {
  const [rateLimit, setRateLimit] = useState<RateLimitState>({ status: 'loading' });
  const [adminConfig, setAdminConfig] = useState<AdminConfigState>({ status: 'loading' });
  const [limitMet, setLimitMet] = useState(false);
  const sessions = useSessions();
  // The reset time of the day the kept refusal belongs to, when a count was read before it.
  const refusedDay = useRef<number | undefined>(undefined);
  const markLimitMet = useCallback((resetAt?: number) => {
    refusedDay.current = resetAt;
    setLimitMet(true);
  }, []);
  const refreshSessions = useCallback(() => savedSessions.refresh(), []);

  const refreshRateLimit = useCallback(async (): Promise<RateLimitState> => {
    const next = await readRateLimit();
    setRateLimit(next);
    return next;
  }, []);

  useEffect(() => {
    void refreshRateLimit();
  }, [refreshRateLimit]);

  // With no free run left, the count is read again once its reset time has
  // come, so a page left open offers Start again without a reload. A reset
  // time that has already passed by this page's clock (an answer that came
  // after the reset, or a clock ahead of the server's, whose read at the
  // reset time the server still answers for the old day) is read again after
  // a short wait, then at twice the gap each time, until the server names a
  // later day or a run is left. The effect runs again with each answer. A
  // read that fails keeps the count the page has and is tried again at the
  // same gaps, so the reads go on. An answer that arrives after another
  // answer has reached the page is left unused, and the effect reads again
  // from the one on the page.
  const noneLeft = limitMet || (rateLimit.status === 'ready' && rateLimit.answer?.remaining === 0);
  const countAnswer = rateLimit.status === 'ready' ? rateLimit.answer : undefined;
  const pastResetWait = useRef(COUNT_RETRY_FIRST_MS);
  useEffect(() => {
    if (!noneLeft) pastResetWait.current = COUNT_RETRY_FIRST_MS;
    if (!noneLeft || countAnswer === undefined) return undefined;
    const until = countAnswer.resetAt - Date.now();
    let wait: number;
    if (until > 0) {
      pastResetWait.current = COUNT_RETRY_FIRST_MS;
      wait = until + RESET_READ_MARGIN_MS;
      if (wait > LONGEST_TIMER_MS) return undefined;
    } else {
      wait = pastResetWait.current;
      pastResetWait.current = Math.min(wait * 2, COUNT_RETRY_MAX_MS);
    }
    let cancelled = false;
    let failedWait = COUNT_RETRY_FIRST_MS;
    let timer: number | undefined;
    const read = () => {
      void readRateLimit().then((next) => {
        if (cancelled) return;
        if (next.status === 'error') {
          timer = window.setTimeout(read, failedWait);
          failedWait = Math.min(failedWait * 2, COUNT_RETRY_MAX_MS);
          return;
        }
        setRateLimit(next);
        // A run is left again: a refusal kept from before the reset no longer holds.
        if (next.status === 'ready' && (next.answer?.remaining ?? 0) > 0) setLimitMet(false);
      });
    };
    timer = window.setTimeout(read, wait);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [noneLeft, countAnswer]);

  // A kept refusal ends with any count for a later day than the refused
  // one that has a run left: the read straight after the refusal, a read
  // asked again below, or the read at the reset time above.
  useEffect(() => {
    if (!limitMet) return;
    const day = refusedDay.current;
    const answer = rateLimit.status === 'ready' ? rateLimit.answer : undefined;
    if (answer && day !== undefined && answer.resetAt > day && answer.remaining > 0) setLimitMet(false);
  }, [limitMet, rateLimit]);

  // A refusal is kept and the count could not be read: no reset time is
  // known, so the read above sets no timer. The count is asked for again
  // until it answers; the effect above reads each answer.
  const countUnread = limitMet && rateLimit.status === 'error';
  useEffect(() => {
    if (!countUnread) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let wait = COUNT_RETRY_FIRST_MS;
    const read = () => {
      void refreshRateLimit().then((next) => {
        if (next.status !== 'error' || cancelled) return;
        timer = window.setTimeout(read, wait);
        wait = Math.min(wait * 2, COUNT_RETRY_MAX_MS);
      });
    };
    timer = window.setTimeout(read, wait);
    wait = Math.min(wait * 2, COUNT_RETRY_MAX_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [countUnread, refreshRateLimit]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let wait = SETTINGS_RETRY_FIRST_MS;
    const read = () => {
      fetch('/admin-config', { cache: 'no-store' })
        .then(async (res) => (res.ok ? parseAdminConfig(await res.json()) : ({ status: 'error' } as const)))
        .catch(() => ({ status: 'error' } as const))
        .then((state) => {
          if (cancelled) return;
          setAdminConfig(state);
          if (state.status !== 'error') return;
          // The read failed: the page says so where it matters, and asks again by itself.
          timer = window.setTimeout(read, wait);
          wait = Math.min(wait * 2, SETTINGS_RETRY_MAX_MS);
        });
    };
    read();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const value = useMemo<ServerFacts>(() => ({
    rateLimit: { ...rateLimit, refresh: refreshRateLimit },
    adminConfig,
    sessions: { status: sessions.status, rows: sessions.sessions as SessionRow[], refresh: refreshSessions },
    limitMet,
    markLimitMet,
  }), [rateLimit, refreshRateLimit, adminConfig, sessions.status, sessions.sessions, refreshSessions, limitMet, markLimitMet]);

  return <ServerFactsContext.Provider value={value}>{children}</ServerFactsContext.Provider>;
}

/** The server's answers, inside ServerFactsProvider. */
export function useServerFacts(): ServerFacts {
  const facts = useContext(ServerFactsContext);
  if (!facts) throw new Error('useServerFacts must be used within ServerFactsProvider');
  return facts;
}
