/**
 * Visitor analytics for the hosted demo at paracosm.agentos.sh, behind a
 * consent bar with a choice per purpose.
 *
 * Three purposes, besides what is strictly necessary:
 * - `count`: Plausible, self-hosted on the team's server and cookieless. On
 *   until the visitor turns it off. The page sends its page views to this
 *   server's `POST /api/event`, which forwards each as the public page it
 *   names, with nothing of the referring page, to the shared Plausible
 *   instance (countEventFrom, forwardCountEvent).
 * - `measure`: Google Analytics 4, off until the visitor turns it on.
 * - `record`: Microsoft Clarity, off until the visitor turns it on.
 *
 * The server puts no vendor tag in a page. It adds the bar's configuration,
 * its stylesheet and its script (assets/consent/), and the script loads
 * each vendor only under its purpose's yes. A privacy signal (the Sec-GPC
 * or DNT request header, navigator.globalPrivacyControl or
 * navigator.doNotTrack) turns
 * every purpose off, the count included, and shows no bar. The landing
 * page's privacy section (#privacy) names each purpose and its vendor.
 *
 * The fonts every page uses are served from this site (assets/fonts/), so
 * no page asks a font service for anything.
 *
 * Only the hosted demo loads any of it: the server adds it to the pages it
 * sends in hosted_demo mode (PARACOSM_HOSTED_DEMO=true), so a copy run from
 * the npm package or a clone serves its pages without analytics. The
 * Google Analytics and Clarity ids are configuration, never source: the
 * dashboard's build writes them into site-analytics.json beside itself from
 * VITE_GA_MEASUREMENT_ID and VITE_CLARITY_PROJECT_ID (src/dashboard/vite.config.ts),
 * which the deploy workflow sets for the hosted demo's build only.
 *
 * @module paracosm/server/site-analytics
 */
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { IpRateLimiter, type ClientIpHeader } from './rate-limiter.js';

/** The site the hosted demo counts under on the shared Plausible instance, analytics.manic.agency. */
export const PLAUSIBLE_DOMAIN = 'paracosm.agentos.sh';

/** The shared Plausible instance's events endpoint, which `POST /api/event` forwards to. */
export const PLAUSIBLE_EVENT_URL = 'https://analytics.manic.agency/api/event';

/** The file the dashboard's build writes the analytics ids into, beside its index.html. */
export const SITE_ANALYTICS_FILE = 'site-analytics.json';

/** The element id of the bar's configuration in a page; assets/consent/consent.js reads it. */
export const CONSENT_CONFIG_ID = 'paracosm-consent-config';

/** The ids the bar's script loads Google Analytics and Clarity with; an empty id loads nothing. */
export interface SiteAnalyticsIds {
  /** The Google Analytics 4 measurement id, `G-` and capitals or digits. */
  ga: string;
  /** The Microsoft Clarity project id, lower-case letters and digits. */
  clarity: string;
}

const GA_ID = /^G-[A-Z0-9]{6,16}$/;
const CLARITY_ID = /^[a-z0-9]{6,16}$/;

/**
 * The ids in a parsed site-analytics.json. An id of any other shape is
 * dropped, so nothing but an id of its vendor's form reaches a page.
 */
export function parseSiteAnalyticsIds(value: unknown): SiteAnalyticsIds {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const ga = typeof record.ga === 'string' ? record.ga.trim() : '';
  const clarity = typeof record.clarity === 'string' ? record.clarity.trim() : '';
  return { ga: GA_ID.test(ga) ? ga : '', clarity: CLARITY_ID.test(clarity) ? clarity : '' };
}

/**
 * Reads the ids the dashboard's build wrote into `<distDir>/site-analytics.json`.
 * A build without the file, or with a file that does not parse, gives empty
 * ids: the bar then offers the count alone.
 */
export function readSiteAnalyticsIds(distDir: string): SiteAnalyticsIds {
  const file = resolve(distDir, SITE_ANALYTICS_FILE);
  if (!existsSync(file)) return { ga: '', clarity: '' };
  try {
    return parseSiteAnalyticsIds(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return { ga: '', clarity: '' };
  }
}

/**
 * Whether a request sends a privacy signal: the Global Privacy Control
 * header, `Sec-GPC: 1`, or the Do Not Track header, `DNT: 1`. Both the
 * pages' bar configuration and `POST /api/event` read it.
 */
export function sendsPrivacySignal(req: IncomingMessage): boolean {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim();
  };
  return header('sec-gpc') === '1' || header('dnt') === '1';
}

/** What a page's bar is given: the ids, whether the request sent a privacy signal, and the asset version. */
export interface SiteAnalyticsPage {
  ids: SiteAnalyticsIds;
  /** The request sent `Sec-GPC: 1` or `DNT: 1`: the bar shows nothing and runs no purpose. */
  signal: boolean;
  /** Appended to the bar's asset addresses so a release's browsers fetch its own copy. */
  assetVersion: string;
}

/**
 * Adds the consent bar to a page just before its `</head>`: its
 * configuration (a JSON script element, which runs nothing), its stylesheet
 * and its deferred script. It puts `data-clarity-mask="True"` on `<body>`:
 * Clarity masks the text and images of a marked element and everything
 * inside it, whatever the project's masking mode
 * (https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking).
 * A page without `</head>` comes back unchanged.
 */
export function withSiteAnalytics(html: string, page: SiteAnalyticsPage): string {
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) return html;
  const config = JSON.stringify({
    domain: PLAUSIBLE_DOMAIN,
    ga: page.ids.ga,
    clarity: page.ids.clarity,
    signal: page.signal,
  }).replace(/</g, '\\u003c');
  const version = encodeURIComponent(page.assetVersion);
  const tags = [
    `<script type="application/json" id="${CONSENT_CONFIG_ID}">${config}</script>`,
    `<link rel="stylesheet" href="/brand/consent/consent.css?v=${version}">`,
    `<script defer src="/brand/consent/consent.js?v=${version}"></script>`,
  ];
  const tagged = `${html.slice(0, headEnd)}${tags.join('\n')}\n${html.slice(headEnd)}`;
  return tagged.replace(/<body(?=[\s>])/, '<body data-clarity-mask="True"');
}

/** A page view as the shared Plausible instance takes it (https://plausible.io/docs/events-api). */
export interface CountEvent {
  name: 'pageview';
  /** One of the site's public pages, on the counted domain: the landing page, the dashboard or a built API docs page. */
  url: string;
  domain: string;
}

const MAX_PATH_LENGTH = 512;
/** The shape of an API docs page's path; only a page that is built counts under its own path. */
const DOCS_PAGE = /^\/docs\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.html$/;

/**
 * The public page a path counts as, or null for a path that is no page of
 * the site: `/` (and `/index.html`), `/sim` for the dashboard (it answers
 * any path under `/sim`, whose rest is never sent), and an API docs page
 * under its own path when `isDocsPage` says the page is built.
 */
export function countedPage(pathname: string, isDocsPage: (path: string) => boolean = () => false): string | null {
  if (pathname === '/' || pathname === '/index.html') return '/';
  if (pathname === '/sim' || pathname.startsWith('/sim/')) return '/sim';
  if (DOCS_PAGE.test(pathname) && !pathname.split('/').includes('..') && isDocsPage(pathname)) return pathname;
  return null;
}

/**
 * The page view a browser's `POST /api/event` body describes: an event, the
 * word `unlisted` for a path that is no page of the site (nothing is
 * forwarded for it), or null for a body that is not a page view. The body
 * is `{"n":"pageview","u":"<path>"}` (assets/consent/consent.js sends it).
 * The server builds the address itself from countedPage, on the counted
 * domain, and sends no referrer: any other field of the body is ignored, so
 * no query string, fragment, unlisted path or referring page reaches the
 * instance.
 */
export function countEventFrom(body: string, isDocsPage?: (path: string) => boolean): CountEvent | 'unlisted' | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { n, u } = parsed as Record<string, unknown>;
  if (n !== 'pageview' || typeof u !== 'string' || !u.startsWith('/') || u.startsWith('//') || u.length > MAX_PATH_LENGTH) return null;
  let path: string;
  try {
    path = new URL(u, `https://${PLAUSIBLE_DOMAIN}`).pathname;
  } catch {
    return null;
  }
  const page = countedPage(path, isDocsPage);
  if (page === null) return 'unlisted';
  return { name: 'pageview', url: `https://${PLAUSIBLE_DOMAIN}${page}`, domain: PLAUSIBLE_DOMAIN };
}

/**
 * The visitor's address to forward to the instance, which works out a
 * country from it and then discards it. It is the connection's address,
 * or, when the server trusts one proxy header (PARACOSM_CLIENT_IP_HEADER),
 * that header's value read as IpRateLimiter.getIp reads it; a value that
 * is not an address falls back to the connection's.
 */
export function clientAddress(req: IncomingMessage, trustedHeader: ClientIpHeader | null): string {
  const socket = (req.socket.remoteAddress ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!trustedHeader) return socket;
  const raw = req.headers[trustedHeader];
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (!value) return socket;
  const candidate = trustedHeader === 'x-forwarded-for' ? (value.split(',').pop() ?? '').trim() : value.trim();
  return isIP(candidate) ? candidate : socket;
}

/** The most page views `POST /api/event` forwards from one address in a minute. */
export const COUNT_EVENTS_PER_MINUTE = 120;

/** The most page views `POST /api/event` holds open on their way to the instance at once. */
export const COUNT_FORWARDS_AT_ONCE = 32;

/** The most addresses the per-address limit tracks; past it, a new address is refused until windows end. */
const COUNT_LIMIT_ADDRESSES = 50_000;

/** How long one address's window lasts, and how long the limit holds the address. */
export const COUNT_WINDOW_MS = 60_000;

/**
 * The per-address limit on forwarded page views: a window from an address's
 * first page view, COUNT_EVENTS_PER_MINUTE in it. It keys on the address
 * as IpRateLimiter.getIp gives it (an IPv6 address by its /64), holds it
 * in memory only, and drops it when its window ends: a timer set for the
 * oldest window, and a sweep on every take. No more than
 * COUNT_LIMIT_ADDRESSES are held at once.
 */
export class CountEventLimit {
  /** Kept in the order the windows began, so the oldest is first. */
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly perWindow = COUNT_EVENTS_PER_MINUTE,
    private readonly windowMs = COUNT_WINDOW_MS,
  ) {}

  /** How many addresses the limit holds now. */
  get size(): number {
    return this.windows.size;
  }

  /** Takes one page view for the address key; false when its window is full. */
  take(key: string, now = Date.now()): boolean {
    this.sweep(now);
    const current = this.windows.get(key);
    if (current === undefined) {
      if (this.windows.size >= COUNT_LIMIT_ADDRESSES) return false;
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.schedule();
      return true;
    }
    if (current.count >= this.perWindow) return false;
    current.count += 1;
    return true;
  }

  /** Stops the timer; the limit holds nothing after it. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.windows.clear();
  }

  /** Drops every ended window, oldest first. */
  private sweep(now: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.resetAt > now) break;
      this.windows.delete(key);
    }
  }

  /** Sets the timer for the oldest window's end, when none is set. */
  private schedule(): void {
    if (this.timer) return;
    const oldest = this.windows.values().next();
    if (oldest.done) return;
    const timer = setTimeout(() => {
      this.timer = null;
      this.sweep(Date.now());
      this.schedule();
    }, Math.max(0, oldest.value.resetAt - Date.now()) + 5);
    // The timer never keeps the process running on its own.
    (timer as { unref?: () => void }).unref?.();
    this.timer = timer;
  }
}

/**
 * The two forms of a visitor's address the count route uses: the key the
 * count limit holds (IpRateLimiter.getIp, an IPv6 address by its /64), and
 * the full address, which goes only to the instance in the forward.
 */
export function countAddresses(req: IncomingMessage, trustedHeader: ClientIpHeader | null): { limitKey: string; address: string } {
  return { limitKey: IpRateLimiter.getIp(req, trustedHeader), address: clientAddress(req, trustedHeader) };
}

/**
 * Sends one page view to the instance with the visitor's full User-Agent
 * header and one address, as its events API asks, and resolves true when the instance
 * accepted it. It never throws: a refusal, a network error or a timeout
 * resolves false.
 */
export async function forwardCountEvent(
  url: string,
  event: CountEvent,
  visitor: { userAgent: string; address: string },
  timeoutMs = 5_000,
): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': visitor.userAgent };
  if (visitor.address) headers['X-Forwarded-For'] = visitor.address;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
