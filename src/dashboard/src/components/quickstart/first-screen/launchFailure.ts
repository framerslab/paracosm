/**
 * What the Run tab's first screen says when a run cannot start, and the
 * time the day's free runs reset.
 *
 * @module paracosm/dashboard/quickstart/first-screen/launchFailure
 */

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
