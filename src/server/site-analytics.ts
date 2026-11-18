/**
 * Visitor analytics for the hosted demo at paracosm.agentos.sh, behind a
 * consent bar with a choice per purpose.
 *
 * Three purposes, besides what is strictly necessary:
 * - `count`: Plausible, self-hosted on the team's server and cookieless. On
 *   until the visitor turns it off. The page sends its page views to this
 *   server's `POST /api/event`, which forwards them, path only, to the
 *   shared Plausible instance (forwardCountEvent).
 * - `measure`: Google Analytics 4, off until the visitor turns it on.
 * - `record`: Microsoft Clarity, off until the visitor turns it on.
 *
 * The server puts no vendor tag in a page. It adds the bar's configuration,
 * its stylesheet and its script (assets/consent/), and the script loads
 * each vendor only under its purpose's yes. A privacy signal (the Sec-GPC
 * request header, navigator.globalPrivacyControl or Do Not Track) turns
 * every purpose off, the count included, and shows no bar. The landing
 * page's privacy section (#privacy) names each purpose and its vendor.
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
import type { ClientIpHeader } from './rate-limiter.js';

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

/** Whether a request carries the Global Privacy Control header, `Sec-GPC: 1`. */
export function sendsPrivacySignal(req: IncomingMessage): boolean {
  const value = req.headers['sec-gpc'];
  return (Array.isArray(value) ? value[0] : value)?.trim() === '1';
}

/** What a page's bar is given: the ids, whether the request sent a privacy signal, and the asset version. */
export interface SiteAnalyticsPage {
  ids: SiteAnalyticsIds;
  /** The request sent `Sec-GPC: 1`: the bar shows nothing and runs no purpose. */
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
  /** The page's address on the counted domain, path only: no query and no fragment. */
  url: string;
  domain: string;
  /** The referring site's origin, or empty. */
  referrer: string;
}

const MAX_PATH_LENGTH = 512;
const MAX_REFERRER_LENGTH = 2048;

/**
 * The page view a browser's `POST /api/event` body describes, or null for a
 * body that is not one. The body is `{"n":"pageview","u":"<path>","r":"<referrer>"}`
 * (assets/consent/consent.js sends it). The server builds the address
 * itself from the path alone, on the counted domain, and keeps only the
 * referrer's origin, so no query string, fragment or referring page's path
 * reaches the instance.
 */
export function countEventFrom(body: string): CountEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { n, u, r } = parsed as Record<string, unknown>;
  if (n !== 'pageview' || typeof u !== 'string' || !u.startsWith('/') || u.startsWith('//') || u.length > MAX_PATH_LENGTH) return null;
  let path: string;
  try {
    path = new URL(u, `https://${PLAUSIBLE_DOMAIN}`).pathname;
  } catch {
    return null;
  }
  let referrer = '';
  if (typeof r === 'string' && r.length > 0 && r.length <= MAX_REFERRER_LENGTH) {
    try {
      const from = new URL(r);
      if (from.protocol === 'https:' || from.protocol === 'http:') referrer = `${from.origin}/`;
    } catch {
      referrer = '';
    }
  }
  return { name: 'pageview', url: `https://${PLAUSIBLE_DOMAIN}${path}`, domain: PLAUSIBLE_DOMAIN, referrer };
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

/**
 * Sends one page view to the instance with the visitor's browser name and
 * address, as its events API asks, and resolves true when the instance
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
