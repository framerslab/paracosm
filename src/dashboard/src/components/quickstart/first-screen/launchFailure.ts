/**
 * What the Run tab's first screen says when a run cannot start, which saved
 * run it offers in Start's place at the day's limit, and the time the day's
 * free runs reset.
 *
 * @module paracosm/dashboard/quickstart/first-screen/launchFailure
 */
import type { LaunchFailureInput } from './effectiveLaunch.js';

/**
 * Why a run did not start: no connection, the day's free runs used, every
 * run slot on the server in use, a busy server, or any other refusal.
 */
export type LaunchFailureKind = 'offline' | 'limit' | 'slots' | 'busy' | 'other';

/**
 * Sorts a failed launch by what the server answered, never by its words.
 * In order: no connection when the request never reached the server or the
 * page is offline; the day's limit on a 429 that says none is left
 * (POST /setup's own refusal: `{ error, limit, remaining: 0 }`); every run
 * slot in use on a 503 that names the most runs the server holds
 * (`{ error, runsInFlight, maxRuns }`); a busy server on any other 429 or
 * 503; anything else.
 *
 * The route that writes the leaders has a day's limit of its own on the
 * hosted demo and refuses in the same shape. That refusal is not the day's
 * limit of runs, which is still unspent: it reads as a run that did not
 * start, and Start stays.
 */
export function classifyLaunchFailure(i: LaunchFailureInput & { online?: boolean }): { kind: LaunchFailureKind } {
  if (i.networkError || i.online === false) return { kind: 'offline' };
  const remaining = i.body?.remaining;
  const maxRuns = i.body?.maxRuns;
  if (i.status === 429 && remaining === 0) return { kind: i.request === 'leaders' ? 'other' : 'limit' };
  if (i.status === 503 && typeof maxRuns === 'number' && Number.isFinite(maxRuns)) return { kind: 'slots' };
  if (i.status === 429 || i.status === 503) return { kind: 'busy' };
  return { kind: 'other' };
}

/** What the choice reads of a saved run, as GET /sessions lists it. */
export interface ChoiceRow {
  id: string;
  createdAt?: number;
  pinned?: boolean;
  leaders?: string[];
  leaderA?: string;
  leaderB?: string;
}

/** A pair: two leaders listed, or, on a row that lists none, both of its two leader fields. */
const isPair = (row: ChoiceRow): boolean =>
  (Array.isArray(row.leaders) ? row.leaders.length === 2 : Boolean(row.leaderA && row.leaderB));

/** The newest of the rows that pass, by when each was made; the list's own order breaks a tie. */
function newest<R extends ChoiceRow>(rows: readonly R[], pass: (row: R) => boolean): R | undefined {
  let best: R | undefined;
  for (const row of rows) {
    if (!pass(row)) continue;
    if (!best || (row.createdAt ?? -Infinity) > (best.createdAt ?? -Infinity)) best = row;
  }
  return best;
}

/**
 * The saved run offered in Start's place when no free run is left: the
 * visitor's own newest run (a row the team did not pin), else the team's
 * newest pinned run of a pair, else neither. A team run of 3 or more
 * leaders is not offered here.
 */
export function atLimitChoice<R extends ChoiceRow>(rows: readonly R[]): { kind: 'own'; row: R } | { kind: 'team'; row: R } | { kind: 'neither' } {
  const own = newest(rows, (row) => row.pinned !== true);
  if (own) return { kind: 'own', row: own };
  const team = newest(rows, (row) => row.pinned === true && isPair(row));
  if (team) return { kind: 'team', row: team };
  return { kind: 'neither' };
}

/**
 * The time the day's free runs reset, as a clock time with its time zone,
 * in the visitor's own zone and their browser's own format: "4:00 PM PST".
 * Never a running clock. An unreadable time reads as nothing, so the
 * sentence that holds it is left out.
 */
export function formatResetTime(resetAt: number, locale?: string, timeZone?: string): string {
  if (!Number.isFinite(resetAt)) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(resetAt));
  } catch {
    return '';
  }
}

/** A time of day on a 24-hour clock. */
export interface ClockTime {
  hour: number;
  minute: number;
}

/**
 * The reset time's hour (0 to 23) and minute in the visitor's own zone, or
 * the zone named, for the clock face's hands. Null for a time that is none.
 */
export function resetClockTime(resetAt: number, timeZone?: string): ClockTime | null {
  if (!Number.isFinite(resetAt)) return null;
  try {
    const parts: Record<string, string> = {};
    const format = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) });
    for (const part of format.formatToParts(new Date(resetAt))) parts[part.type] = part.value;
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    return Number.isInteger(hour) && Number.isInteger(minute) ? { hour, minute } : null;
  } catch {
    return null;
  }
}

/**
 * Where the clock face's hands point, in degrees clockwise from 12: the
 * hour hand moves on with the minutes, half a degree a minute.
 */
export function clockHands(t: ClockTime): { hour: number; minute: number } {
  return { hour: (t.hour % 12) * 30 + t.minute / 2, minute: t.minute * 6 };
}
