/**
 * Pure helpers for useLoadFromUrl. URL parsing + filename derivation
 * live here so they can run under node:test without a DOM shim.
 *
 * @module paracosm/cli/dashboard/hooks/useLoadFromUrl.helpers
 */

/** Whitelisted schemes for the `?load=<url>` param. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/** Outcome of parsing the `?load=` query param off a dashboard URL. */
export type LoadUrlParamResult =
  | { ok: true; url: URL }
  | { ok: false; reason: 'missing' | 'malformed' | 'unsupported-scheme' };

/**
 * Parse the `?load=<url>` param off a dashboard href and validate the
 * inner URL. Accepts only `http:` + `https:` schemes; any other scheme
 * is rejected as `unsupported-scheme`. Missing / empty param returns
 * `missing`; a value that doesn't construct as a URL returns
 * `malformed`.
 *
 * Pure function — takes a raw href (typically `window.location.href`)
 * so tests don't need a real DOM.
 */
export function parseLoadUrlParam(href: string): LoadUrlParamResult {
  let outer: URL;
  try {
    outer = new URL(href);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  const raw = outer.searchParams.get('load');
  if (!raw) return { ok: false, reason: 'missing' };

  let inner: URL;
  try {
    inner = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!ALLOWED_SCHEMES.has(inner.protocol)) {
    return { ok: false, reason: 'unsupported-scheme' };
  }
  return { ok: true, url: inner };
}

const DEFAULT_REMOTE_FILENAME = 'remote-run.json';

/**
 * Pick a display-friendly filename from a remote URL's path. Last
 * non-empty segment wins; URL-decoded. Falls back to
 * `'remote-run.json'` for root-only paths.
 */
export function deriveFileNameFromUrl(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return DEFAULT_REMOTE_FILENAME;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * True when `url`'s origin differs from the current dashboard's origin.
 * Different host, port, or scheme all count as cross-origin per the
 * browser's standard same-origin policy.
 */
export function isCrossOrigin(url: URL, currentHref: string): boolean {
  try {
    const current = new URL(currentHref);
    return url.origin !== current.origin;
  } catch {
    return true;
  }
}

/**
 * Read `?autoload=` and decide whether the dashboard should bypass the
 * F9 preview modal. Designed for one-click share links — e.g. a Reddit
 * post that drops the user straight onto a viz. Truthy values are `1`
 * and `true` (case-insensitive); everything else is false.
 */
export function parseAutoloadParam(href: string): boolean {
  let outer: URL;
  try {
    outer = new URL(href);
  } catch {
    return false;
  }
  const raw = outer.searchParams.get('autoload');
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Read `?tab=` and return the value when it is a member of `validTabs`.
 * Returns `null` for missing / invalid / unknown values. Caller picks a
 * fallback. Kept pure so it can be reused without coupling helpers to
 * the {@link DashboardTab} union from tab-routing.
 */
export function parseDestinationTabParam<T extends string>(
  href: string,
  validTabs: readonly T[],
): T | null {
  let outer: URL;
  try {
    outer = new URL(href);
  } catch {
    return null;
  }
  const raw = outer.searchParams.get('tab');
  if (!raw) return null;
  return (validTabs as readonly string[]).includes(raw) ? (raw as T) : null;
}
