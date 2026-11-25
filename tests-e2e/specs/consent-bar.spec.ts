/**
 * The hosted demo's consent bar and the analytics it gates.
 *
 * The pages talk to a real server of their own in hosted_demo mode, the mode
 * paracosm.agentos.sh runs in (tests-e2e/support/consent-server.ts), with
 * made-up Google Analytics and Clarity ids. Every vendor host, and the
 * shared Plausible instance, is answered by the test itself, so no case
 * reaches one. The count events the server forwards land in the support
 * server's sink, which the tests read.
 *
 * What it proves, on the landing page, the dashboard and the API docs:
 * - before any answer, the bar offers Reject all, Choose and Accept all,
 *   no request goes to Google, Microsoft, PostHog or Plausible itself, and
 *   the page sends one count event to the product's own endpoint, which
 *   forwards it as the page's public address;
 * - no page asks Google's font service for anything, before or after an
 *   answer: the fonts come from the site itself;
 * - the three keys stay on one row from 320 to 768 px wide, in that order,
 *   drawn alike, with text of 14 px or more and keys 44 px tall;
 * - Reject all ends the count; Accept all loads Google Analytics and
 *   Clarity; Choose turns on one purpose alone;
 * - the dashboard reads each purpose's answer from window.paracosmConsent,
 *   which says no before an answer and after Reject all, and which other
 *   code on the page cannot replace;
 * - a privacy signal (the Sec-GPC header, the DNT header alone, or
 *   navigator.globalPrivacyControl) shows no bar and loads nothing optional,
 *   and the footer's control then explains the signal instead of the bar;
 * - an earlier Reject all or count switch off holds while the bar asks
 *   again for a stored answer that is missing or out of date;
 * - a stored answer of another version, or given to other words, counts as
 *   none, and the words' hash covers every word the bar shows;
 * - Choose moves focus into the choices, Tab follows the order on screen,
 *   and Escape goes back to Choose; at 320 by 180 px the whole bar fits the
 *   screen, scrolls as one panel, and focus never lands off screen;
 * - the footer's Analytics choices control reopens the choices, also when
 *   the dashboard's own script does not load, with a focus ring of 3:1 or
 *   more in both looks, and turning a purpose off there clears that
 *   vendor's cookies;
 * - when the browser refuses to store an answer, the answer just given is
 *   the one that runs, and the bar says it could not be saved;
 * - turning recordings off stops Clarity on the page with no further
 *   upload, its own last one included, and a Clarity tag that arrives after
 *   a withdrawal, even one the browser refused to store, never records;
 * - answers given in one tab reach another open tab of the same browser
 *   without reloading it, and a withdrawal there stops a Clarity that would
 *   restart itself.
 *
 * It also writes pictures of the bar at 390 and 1440 px in both looks into
 * test-results/consent-bar-captures, which CI uploads.
 */
import { test, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The hosted-demo server with analytics runs locally, on a port of its own.');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASE = 'http://127.0.0.1:3464';
const SINK = 'http://127.0.0.1:3465';
/** The ids tests-e2e/support/consent-server.ts gives the server. */
const GA_ID = 'G-E2E0TEST00';
const CLARITY_ID = 'e2econsent';
const CAPTURES = path.resolve(ROOT, 'test-results/consent-bar-captures');

/** The hosts a page may reach only after its purpose's yes, and Plausible's, which a page never reaches itself. */
const VENDOR_HOST = /(^|\.)(googletagmanager\.com|google-analytics\.com|clarity\.ms|posthog\.com|plausible\.io|analytics\.manic\.agency)$/;
/** Google's font service, which no page asks. */
const FONT_HOST = /^fonts\.(googleapis|gstatic)\.com$/;
/** Every host the test answers itself: the vendors and the shared Plausible instance. */
const ANSWERED_HOST = /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|google\.com|clarity\.ms|bing\.com|posthog\.com|analytics\.manic\.agency)(:\d+)?\//;

// /docs answers a redirect to the module index, the page the API docs open on.
const DOCS_BUILT = existsSync(path.resolve(ROOT, 'docs/api/modules.html'));
const PAGES = ['/', '/sim', ...(DOCS_BUILT ? ['/docs/modules.html'] : [])];
const PHONE_WIDTHS = [320, 360, 390, 430, 480, 768];
/** Long enough for a script a page should not load to have asked for its host. */
const SETTLE_MS = 1500;

interface Watch {
  vendor: string[];
  counts: Request[];
  fonts: string[];
}

/** A context whose browser identifies itself uniquely, so the sink's events can be told apart by test. */
async function open(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<{ context: BrowserContext; page: Page; watch: Watch; agent: string }> {
  const agent = `paracosm-consent-e2e/${name.replace(/[^a-z0-9]+/gi, '-')}-${Math.random().toString(36).slice(2, 10)}`;
  const context = await browser.newContext({ baseURL: BASE, userAgent: agent, ...options });
  await context.route(ANSWERED_HOST, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  const watch: Watch = { vendor: [], counts: [], fonts: [] };
  page.on('request', request => {
    const url = new URL(request.url());
    if (VENDOR_HOST.test(url.hostname)) watch.vendor.push(request.url());
    if (FONT_HOST.test(url.hostname)) watch.fonts.push(request.url());
    if (request.method() === 'POST' && url.origin === BASE && url.pathname === '/api/event') watch.counts.push(request);
  });
  return { context, page, watch, agent };
}

function bar(page: Page) {
  return page.getByRole('region', { name: 'Analytics choices' });
}

function keys(page: Page) {
  const region = bar(page);
  return [
    region.getByRole('button', { name: 'Reject all', exact: true }),
    region.getByRole('button', { name: 'Choose', exact: true }),
    region.getByRole('button', { name: 'Accept all', exact: true }),
  ];
}

async function stored(page: Page): Promise<{ purposes: Record<string, boolean>; words: string; version: number } | null> {
  await page.waitForLoadState('load');
  const raw = await page.evaluate(() => localStorage.getItem('analytics_consent_purposes'));
  return raw === null ? null : JSON.parse(raw) as { purposes: Record<string, boolean>; words: string; version: number };
}

/** Whether a loaded font face of the family is on the page. */
function loadedFace(page: Page, family: string): Promise<boolean> {
  return page.evaluate(async name => {
    await document.fonts.ready;
    return Array.from(document.fonts).some(face => face.family.replace(/["']/g, '') === name && face.status === 'loaded');
  }, family);
}

/**
 * Clarity's tag as it behaves: it runs what was queued before it loaded,
 * starts recording either way, sends what it records every 150 ms, and,
 * like clarity-js's consentv2 when analytics storage is denied, stops and
 * starts again 300 ms later without cookies. Only its stop call ends it,
 * and, as clarity-js's stop does, it sends one last upload by beacon then.
 */
const CLARITY_TAG = `(function () {
  var queued = (window.clarity && window.clarity.q) || [];
  var timer = null, restart = null;
  function begin() {
    if (timer) return;
    timer = setInterval(function () { fetch('https://www.clarity.ms/collect', { method: 'POST', body: 'events' }).catch(function () {}); }, 150);
  }
  function end() { clearInterval(timer); timer = null; }
  var api = {
    start: begin,
    stop: function () {
      clearTimeout(restart);
      if (timer) navigator.sendBeacon('https://www.clarity.ms/collect', 'last');
      end();
    },
    consentv2: function (state) {
      if (state && state.analytics_Storage === 'denied' && timer) { end(); restart = setTimeout(begin, 300); }
    },
    consent: function (value) { if (value === false) api.consentv2({ analytics_Storage: 'denied' }); },
  };
  window.clarity = function (method) {
    var call = api[method];
    if (call) return call.apply(null, Array.prototype.slice.call(arguments, 1));
  };
  window.clarity.v = 'test';
  while (queued.length) window.clarity.apply(null, queued.shift());
  begin();
})();`;

/** Answers Clarity's tag with CLARITY_TAG in this context; registered after open()'s route, so it wins. */
async function withClarityTag(context: BrowserContext): Promise<void> {
  await context.route(/^https:\/\/www\.clarity\.ms\/tag\//, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: CLARITY_TAG }));
}

/** Answers Clarity's tag with CLARITY_TAG only when the returned function is called. */
async function withLateClarityTag(context: BrowserContext): Promise<() => void> {
  let release: () => void = () => {};
  const released = new Promise<void>(resolveRelease => { release = resolveRelease; });
  await context.route(/^https:\/\/www\.clarity\.ms\/tag\//, async route => {
    await released;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: CLARITY_TAG });
  });
  return release;
}

/** The uploads Clarity's tag sent, of every request seen so far. */
function uploads(watch: Watch): string[] {
  return watch.vendor.filter(url => url.startsWith('https://www.clarity.ms/collect'));
}

/** The contrast of two CSS colours, each as rgb() or rgba() with full alpha. */
function contrast(first: string, second: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Waits until a page has stopped Google Analytics and then sends nothing to any vendor for 1.5 s. */
async function goesQuiet(page: Page, watch: Watch, label: string): Promise<void> {
  // The tag is turned off, or the page was reloaded and loaded none.
  await expect.poll(() => page.evaluate(id => {
    const flags = window as unknown as Record<string, unknown>;
    return flags[`ga-disable-${id}`] === true || !('dataLayer' in window);
  }, GA_ID), { timeout: 10_000 }).toBe(true);
  // Past the restart a cookieless Clarity would make.
  await page.waitForTimeout(1000);
  const seen = watch.vendor.length;
  await page.waitForTimeout(SETTLE_MS);
  expect(watch.vendor.slice(seen), label).toEqual([]);
}

async function forwarded(agent: string): Promise<Array<{ body: { name?: string; url?: string; domain?: string; referrer?: string } }>> {
  const response = await fetch(`${SINK}/received`);
  const all = await response.json() as Array<{ body: { name?: string; url?: string; domain?: string }; userAgent: string | null }>;
  return all.filter(event => event.userAgent === agent);
}

test.describe('the consent bar on the hosted demo', () => {
  for (const pathname of PAGES) {
    test(`before any answer on ${pathname}, the bar offers three keys, no vendor is asked and one count event goes to the site's own endpoint`, async ({ browser }) => {
      const { context, page, watch, agent } = await open(browser, `first-${pathname}`);
      try {
        const count = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/event');
        await page.goto(`${pathname}?utm_source=e2e#top`, { referer: 'https://ticket-123.internal/' });
        await expect(bar(page)).toBeVisible();
        for (const key of keys(page)) await expect(key).toBeVisible();
        await count;
        await page.waitForTimeout(SETTLE_MS);

        expect(watch.vendor, 'no request to Google, Microsoft, PostHog or Plausible before an answer').toEqual([]);
        expect(watch.fonts, 'no request to Google\'s font service').toEqual([]);
        expect(await loadedFace(page, 'Inter'), 'Inter loads from the site itself').toBe(true);
        expect(watch.counts, 'one count event to the site itself').toHaveLength(1);
        expect(await page.evaluate(() => localStorage.getItem('plausible_ignore'))).toBeNull();

        // The server forwards it under the site's Plausible domain, path only.
        await expect.poll(async () => (await forwarded(agent)).length).toBe(1);
        const [event] = await forwarded(agent);
        expect(event.body.name).toBe('pageview');
        expect(event.body.domain).toBe('paracosm.agentos.sh');
        expect(event.body.url).toBe(`https://paracosm.agentos.sh${pathname}`);
        expect(event.body, 'nothing of the referring page is forwarded').not.toHaveProperty('referrer');
      } finally {
        await context.close();
      }
    });
  }

  test('the three keys stay on one row from 320 to 768 px, with text of 14 px or more and keys 44 px tall', async ({ browser }) => {
    const { context, page } = await open(browser, 'row');
    try {
      for (const pathname of ['/', '/sim']) {
        for (const width of PHONE_WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(pathname);
          await expect(bar(page)).toBeVisible();
          const boxes = [];
          for (const key of keys(page)) {
            await expect(key).toBeVisible();
            const box = await key.boundingBox();
            expect(box, `${pathname} at ${width} px: a key has no box`).not.toBeNull();
            boxes.push(box!);
            const size = await key.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
            expect(size, `${pathname} at ${width} px: key text size`).toBeGreaterThanOrEqual(14);
            expect(box!.height, `${pathname} at ${width} px: key height`).toBeGreaterThanOrEqual(44);
            expect(box!.x + box!.width, `${pathname} at ${width} px: a key runs past the screen`).toBeLessThanOrEqual(width + 0.5);
          }
          const tops = boxes.map(box => Math.round(box.y));
          expect(Math.max(...tops) - Math.min(...tops), `${pathname} at ${width} px: the keys sit on one row`).toBeLessThanOrEqual(1);
          const widths = boxes.map(box => Math.round(box.width));
          expect(Math.max(...widths) - Math.min(...widths), `${pathname} at ${width} px: the keys have equal weight`).toBeLessThanOrEqual(2);
          expect(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x, `${pathname} at ${width} px: Reject all, Choose, Accept all from left to right`).toBe(true);
          const order = await bar(page).evaluate(region => Array.from(region.querySelectorAll('button'))
            .map(button => button.textContent?.trim() ?? '')
            .filter(name => ['Reject all', 'Choose', 'Accept all'].includes(name)));
          expect(order, `${pathname} at ${width} px: the keys' order in the page`).toEqual(['Reject all', 'Choose', 'Accept all']);
          const looks = [];
          for (const key of keys(page)) {
            looks.push(await key.evaluate(element => {
              const style = getComputedStyle(element);
              return ['font-size', 'font-weight', 'font-family', 'color', 'background-color', 'background-image', 'border-top-width', 'border-top-style', 'border-top-color', 'text-decoration-line', 'box-shadow', 'opacity']
                .map(property => `${property}: ${style.getPropertyValue(property)}`);
            }));
          }
          expect(looks[1], `${pathname} at ${width} px: Choose is drawn as Reject all is`).toEqual(looks[0]);
          expect(looks[2], `${pathname} at ${width} px: Accept all is drawn as Reject all is`).toEqual(looks[0]);
          const textSize = await bar(page).locator('p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          expect(textSize, `${pathname} at ${width} px: the bar's text size`).toBeGreaterThanOrEqual(14);
        }
      }
    } finally {
      await context.close();
    }
  });

  test('Reject all ends the count and loads no vendor on the next page', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'reject');
    try {
      await page.goto('/');
      await expect(bar(page)).toBeVisible();
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(bar(page)).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem('plausible_ignore'))).toBe('true');
      expect((await stored(page))?.purposes).toEqual({ count: false, measure: false, record: false });

      const before = watch.counts.length;
      await page.goto('/sim');
      await page.waitForTimeout(SETTLE_MS);
      await expect(bar(page)).toBeHidden();
      expect(watch.counts.length, 'no count event after Reject all').toBe(before);
      expect(watch.vendor).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('Accept all loads Google Analytics and Clarity, and the next page loads them without asking again', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'accept');
    try {
      await page.goto('/');
      await expect(bar(page)).toBeVisible();
      const google = page.waitForRequest(request => request.url().startsWith(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`));
      const clarity = page.waitForRequest(request => request.url().startsWith(`https://www.clarity.ms/tag/${CLARITY_ID}`));
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await Promise.all([google, clarity]);
      await expect(bar(page)).toBeHidden();
      expect((await stored(page))?.purposes).toEqual({ count: true, measure: true, record: true });

      const googleAgain = page.waitForRequest(request => request.url().startsWith('https://www.googletagmanager.com/gtag/js'));
      const clarityAgain = page.waitForRequest(request => request.url().startsWith('https://www.clarity.ms/tag/'));
      const count = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/event');
      await page.goto('/sim');
      await Promise.all([googleAgain, clarityAgain, count]);
      await expect(bar(page)).toBeHidden();
      expect(watch.vendor.some(url => /(^|\.)(posthog\.com|plausible\.io|analytics\.manic\.agency)$/.test(new URL(url).hostname))).toBe(false);
      expect(watch.fonts, 'no request to Google\'s font service after the yes').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('Choose shows strictly necessary as always on and one switch per purpose; measurement alone asks Google and not Microsoft', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'choose');
    try {
      await page.goto('/');
      await bar(page).getByRole('button', { name: 'Choose', exact: true }).click();
      await expect(bar(page).getByText('Always on')).toBeVisible();
      const switches = bar(page).getByRole('switch');
      await expect(switches).toHaveCount(3);
      const count = bar(page).getByRole('switch', { name: /Plausible/ });
      const measure = bar(page).getByRole('switch', { name: /Google Analytics/ });
      const record = bar(page).getByRole('switch', { name: /Microsoft Clarity/ });
      await expect(count).toHaveAttribute('aria-checked', 'true');
      await expect(measure).toHaveAttribute('aria-checked', 'false');
      await expect(record).toHaveAttribute('aria-checked', 'false');
      expect(watch.vendor, 'opening Choose asks no vendor').toEqual([]);
      await expect(bar(page).getByText(/full User-Agent/), 'the count row says what Plausible receives').toBeVisible();

      await measure.click();
      await expect(measure).toHaveAttribute('aria-checked', 'true');
      const google = page.waitForRequest(request => request.url().startsWith(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`));
      await bar(page).getByRole('button', { name: 'Save choices', exact: true }).click();
      await google;
      await expect(bar(page)).toBeHidden();
      await page.waitForTimeout(SETTLE_MS);
      expect(watch.vendor.filter(url => new URL(url).hostname.endsWith('clarity.ms')), 'no request to Microsoft without the recordings yes').toEqual([]);
      expect((await stored(page))?.purposes).toEqual({ count: true, measure: true, record: false });
    } finally {
      await context.close();
    }
  });

  test('the dashboard reads each purpose\'s answer from paracosmConsent: measure is false before an answer, true after Accept all and false after Reject all', async ({ browser }) => {
    const { context, page } = await open(browser, 'allows');
    await context.addInitScript(() => {
      const state = window as unknown as { consentReadyEvents: number };
      state.consentReadyEvents = 0;
      window.addEventListener('paracosm:consent-ready', () => { state.consentReadyEvents++; });
    });
    try {
      const allows = (purpose: string) => page.evaluate(name => {
        const consent = (window as unknown as { paracosmConsent?: { allows?: (purpose: string) => unknown } }).paracosmConsent;
        return typeof consent?.allows === 'function' ? consent.allows(name) : 'paracosmConsent.allows is missing';
      }, purpose);
      await page.goto('/sim');
      await expect(bar(page)).toBeVisible();
      const readiness = () => page.evaluate(() => {
        const state = window as unknown as { paracosmConsent?: { ready?: boolean }; consentReadyEvents: number };
        return { ready: state.paracosmConsent?.ready, events: state.consentReadyEvents };
      });
      expect(await readiness()).toEqual({ ready: true, events: 1 });
      expect(await allows('count'), 'count before any answer').toBe(true);
      expect(await allows('measure'), 'measure before any answer').toBe(false);
      expect(await allows('record'), 'record before any answer').toBe(false);

      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await expect(bar(page)).toBeHidden();
      expect(await allows('measure'), 'measure after Accept all').toBe(true);
      expect(await allows('record'), 'record after Accept all').toBe(true);
      expect(await allows('count'), 'count after Accept all').toBe(true);
      expect(await allows('anything'), 'a purpose the bar does not offer').toBe(false);

      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await expect(bar(page)).toBeVisible();
      await bar(page).getByRole('switch', { name: /Plausible/ }).click();
      await bar(page).getByRole('button', { name: 'Save choices', exact: true }).click();
      await expect(bar(page)).toBeHidden();
      expect(await allows('count'), 'count after turning its switch off').toBe(false);
      expect(await allows('measure'), 'measure after turning count off').toBe(true);
      expect(await allows('record'), 'record after turning count off').toBe(true);

      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(bar(page)).toBeHidden();
      expect(await readiness()).toEqual({ ready: true, events: 1 });
      expect(await allows('count'), 'count after Reject all').toBe(false);
      expect(await allows('measure'), 'measure after Reject all').toBe(false);
      expect(await allows('record'), 'record after Reject all').toBe(false);

      // Other code on the page cannot turn the answer into a yes.
      await page.evaluate(() => {
        const page = window as unknown as { paracosmConsent: { allows: (purpose: string) => boolean } };
        try { page.paracosmConsent = { allows: () => true }; } catch { /* a read-only property refuses */ }
        try { page.paracosmConsent.allows = () => true; } catch { /* a frozen object refuses */ }
      });
      expect(await allows('measure'), 'measure after other code tried to replace the answer').toBe(false);
    } finally {
      await context.close();
    }
  });

  test('a Sec-GPC header shows no bar and loads nothing optional, the count included', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'gpc-header', { extraHTTPHeaders: { 'Sec-GPC': '1' } });
    try {
      for (const pathname of ['/', '/sim']) {
        await page.goto(pathname);
        await page.waitForTimeout(SETTLE_MS);
        await expect(bar(page)).toBeHidden();
        expect(await page.evaluate(() => {
          const consent = (window as unknown as { paracosmConsent: { ready: boolean; allows: (purpose: string) => boolean } }).paracosmConsent;
          return [consent.ready, consent.allows('count'), consent.allows('measure'), consent.allows('record')];
        })).toEqual([true, false, false, false]);
      }
      expect(watch.vendor).toEqual([]);
      expect(watch.counts).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('a DNT: 1 header alone shows no bar and loads nothing optional, the count included', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'dnt-header', { extraHTTPHeaders: { DNT: '1' } });
    try {
      for (const pathname of PAGES) {
        await page.goto(pathname);
        expect(await page.evaluate(() => navigator.doNotTrack), 'the page itself sees no Do Not Track').not.toBe('1');
        await page.waitForTimeout(SETTLE_MS);
        await expect(bar(page)).toBeHidden();
      }
      expect(watch.vendor).toEqual([]);
      expect(watch.counts).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('a stored answer of another version, given to other words, or unreadable counts as none: the bar asks and nothing optional loads', async ({ browser }) => {
    const records = [
      JSON.stringify({ version: 0, purposes: { measure: true, record: true } }),
      JSON.stringify({ version: 1, purposes: { count: true, measure: true, record: true }, words: 'f'.repeat(64), at: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ version: 1, purposes: { count: true, measure: true, record: true }, words: '', at: '2026-01-01T00:00:00.000Z' }),
      'not json',
    ];
    for (const [index, record] of records.entries()) {
      const { context, page, watch } = await open(browser, `stale-${index}`);
      try {
        await context.addInitScript(value => { localStorage.setItem('analytics_consent_purposes', value); }, record);
        await page.goto('/sim');
        await expect(bar(page), record).toBeVisible();
        await page.waitForTimeout(SETTLE_MS);
        expect(watch.vendor, record).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });

  test('the stored answer carries the hash of every word the bar shows, ready before any key can save it', async ({ browser }) => {
    const { context, page } = await open(browser, 'words');
    try {
      // A digest that takes its time: no key may save before it is done.
      await context.addInitScript(() => {
        const digest = SubtleCrypto.prototype.digest;
        SubtleCrypto.prototype.digest = function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto['digest']>) {
          return new Promise(resolveLater => setTimeout(resolveLater, 800)).then(() => digest.apply(this, args));
        } as SubtleCrypto['digest'];
      });
      await page.goto('/');
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      const record = await stored(page);
      expect(record?.words, 'the answer carries a SHA-256').toMatch(/^[0-9a-f]{64}$/);
      expect(record?.version).toBe(1);

      // The hash is of the bar's words, all of them.
      const words = await page.evaluate(() => JSON.stringify((window as unknown as { __paracosmConsent: { words: unknown } }).__paracosmConsent.words));
      expect(record?.words).toBe(createHash('sha256').update(words).digest('hex'));
      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      const shown = await bar(page).evaluate(region => {
        const texts: string[] = [];
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim();
          if (text) texts.push(text);
        }
        for (const element of Array.from(region.querySelectorAll('[aria-label]'))) texts.push(element.getAttribute('aria-label') ?? '');
        texts.push(region.getAttribute('aria-label') ?? '');
        return texts;
      });
      const hashed = new Set<string>();
      const collect = (value: unknown): void => {
        if (typeof value === 'string') hashed.add(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
      };
      collect(JSON.parse(words));
      for (const text of shown) expect(hashed.has(text), `"${text}" is among the hashed words`).toBe(true);
      expect(shown.length).toBeGreaterThan(10);
    } finally {
      await context.close();
    }
  });

  test('Choose moves focus to the first switch, Tab follows the order on screen, and Escape goes back to Choose with the first layer still there', async ({ browser }) => {
    // At phone width the bar is one column, so the order on screen is top to bottom.
    const { context, page } = await open(browser, 'focus', { viewport: { width: 390, height: 844 } });
    try {
      await page.goto('/');
      const choose = bar(page).getByRole('button', { name: 'Choose', exact: true });
      await choose.focus();
      await page.keyboard.press('Enter');
      const choices = page.getByRole('region', { name: 'Choose what runs' });
      await expect(choices).toBeVisible();
      await expect(bar(page).getByRole('switch', { name: /Plausible/ })).toBeFocused();

      const order = [
        bar(page).getByRole('switch', { name: /Plausible/ }),
        bar(page).getByRole('switch', { name: /Google Analytics/ }),
        bar(page).getByRole('switch', { name: /Microsoft Clarity/ }),
        bar(page).getByRole('button', { name: 'Save choices', exact: true }),
        bar(page).getByRole('link', { name: 'How each tool works', exact: true }),
        bar(page).getByRole('button', { name: 'Reject all', exact: true }),
        choose,
        bar(page).getByRole('button', { name: 'Accept all', exact: true }),
      ];
      // Where each element sits in the bar as laid out, whatever the choices' own scroll.
      const place = (locator: typeof choose) => locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        let y = rect.top;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) y += parent.scrollTop;
        return { x: rect.left, y, height: rect.height, name: element.textContent?.trim() || element.getAttribute('aria-labelledby') || element.tagName };
      });
      let previous = await place(order[0]);
      for (const next of order.slice(1)) {
        await page.keyboard.press('Tab');
        await expect(next).toBeFocused();
        const box = await place(next);
        const below = box.y >= previous.y + previous.height - 1;
        const rightOnRow = Math.abs(box.y - previous.y) <= 1 && box.x > previous.x;
        expect(below || rightOnRow, `focus moves down the bar, then left to right along a row: ${JSON.stringify(previous)} then ${JSON.stringify(box)}`).toBe(true);
        previous = box;
      }

      await choose.focus();
      await page.keyboard.press('Escape');
      await expect(choices).toBeHidden();
      await expect(choose).toBeFocused();
      await expect(choose).toHaveAttribute('aria-expanded', 'false');
      await expect(bar(page)).toBeVisible();
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      expect((await stored(page))?.purposes).toEqual({ count: true, measure: true, record: true });
    } finally {
      await context.close();
    }
  });

  test('the Analytics choices control is on the dashboard page when its script does not load, with text of 14 px or more and a 44 px target on a phone', async ({ browser }) => {
    const { context, page } = await open(browser, 'shell-control', { viewport: { width: 390, height: 844 } });
    try {
      for (const pathname of PAGES) {
        await page.goto(pathname);
        const control = page.getByRole('button', { name: 'Analytics choices', exact: true });
        await expect(control, pathname).toBeVisible();
        expect(await control.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), `${pathname}: text size`).toBeGreaterThanOrEqual(14);
        expect((await control.boundingBox())!.height, `${pathname}: target height`).toBeGreaterThanOrEqual(44);
      }
      await page.goto('/');
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();

      // The dashboard's own script fails; the consent bar's still loads.
      await context.route(url => url.origin === BASE && url.pathname.endsWith('.js') && !url.pathname.startsWith('/brand/'), route => route.abort());
      await page.goto('/sim');
      const control = page.getByRole('button', { name: 'Analytics choices', exact: true });
      await expect(control).toBeVisible();
      expect(await control.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await control.click();
      await expect(bar(page)).toBeVisible();
      await expect(bar(page).getByRole('switch', { name: /Google Analytics/ })).toHaveAttribute('aria-checked', 'true');
    } finally {
      await context.close();
    }
  });

  test('when the browser refuses to store an answer, the answer just given runs and the bar says it could not be saved', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'refused');
    try {
      await page.goto('/');
      const google = page.waitForRequest(request => request.url().startsWith(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`));
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await google;

      // From here on the browser stores nothing.
      await page.evaluate(() => {
        Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      });
      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();

      await expect(bar(page)).toBeVisible();
      await expect(bar(page).getByText('could not be saved on this device')).toBeVisible();
      expect(await page.evaluate(id => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA_ID), 'Google Analytics stays off').toBe(true);
      expect((await stored(page))?.purposes, 'the old answer is still what is stored').toEqual({ count: true, measure: true, record: true });

      const before = watch.counts.length;
      await page.evaluate(() => history.pushState({}, '', '/sim'));
      await page.waitForTimeout(SETTLE_MS);
      expect(watch.counts.length, 'no count after Reject all, though it was not stored').toBe(before);
      expect(await page.evaluate(id => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA_ID), 'Google Analytics is still off').toBe(true);
    } finally {
      await context.close();
    }
  });

  test('Accept all on a page opened after Reject all counts that page at once, without a reload', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'yes-after-no');
    try {
      await page.goto('/');
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await page.goto('/sim');
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });
      const before = watch.counts.length;

      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await expect.poll(() => watch.counts.length, { timeout: 10_000, message: 'this page is counted after the yes' }).toBe(before + 1);
      expect(watch.counts[before].postDataJSON()).toEqual({ n: 'pageview', u: '/sim' });
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true), 'the page was not reloaded').toBe(true);
    } finally {
      await context.close();
    }
  });

  test('when the earlier no to the count cannot be cleared, the yes just given still counts and the bar says it could not be saved', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'ignore-stuck');
    try {
      await page.goto('/');
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await page.goto('/sim');
      await page.waitForTimeout(SETTLE_MS);
      const before = watch.counts.length;

      // The answer itself stores; removing the earlier no to the count does not.
      await page.evaluate(() => {
        Storage.prototype.removeItem = function () { throw new DOMException('The operation is insecure.', 'SecurityError'); };
      });
      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await expect(bar(page).getByText('could not be saved on this device')).toBeVisible();
      await expect.poll(() => watch.counts.length, { timeout: 10_000, message: 'this page is counted after the yes' }).toBe(before + 1);

      await page.evaluate(() => history.pushState({}, '', '/'));
      await expect.poll(() => watch.counts.length, { timeout: 10_000, message: 'the next path of this page is counted too' }).toBe(before + 2);
    } finally {
      await context.close();
    }
  });

  test('navigator.globalPrivacyControl shows no bar and loads nothing optional, the count included', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'gpc-navigator');
    try {
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
      });
      for (const pathname of ['/', '/sim']) {
        await page.goto(pathname);
        await page.waitForTimeout(SETTLE_MS);
        await expect(bar(page)).toBeHidden();
      }
      expect(watch.vendor).toEqual([]);
      expect(watch.counts).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('the footer control reopens the choices at the answer given, and turning purposes off there clears their cookies', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'footer');
    try {
      await page.goto('/');
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await expect(bar(page)).toBeHidden();
      // The cookies the two vendors set, as their scripts would have.
      await context.addCookies(['_ga', '_ga_E2E0TEST00', '_clck', '_clsk'].map(name => ({ name, value: '1', domain: '127.0.0.1', path: '/' })));

      for (const pathname of ['/', '/sim']) {
        await page.goto(pathname);
        await expect(bar(page)).toBeHidden();
        await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
        await expect(bar(page)).toBeVisible();
        await expect(bar(page).getByRole('switch', { name: /Plausible/ })).toHaveAttribute('aria-checked', 'true');
        await expect(bar(page).getByRole('switch', { name: /Google Analytics/ })).toHaveAttribute('aria-checked', 'true');
        await expect(bar(page).getByRole('switch', { name: /Microsoft Clarity/ })).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');
        await expect(bar(page)).toBeHidden();
      }

      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('switch', { name: /Google Analytics/ }).click();
      await bar(page).getByRole('switch', { name: /Microsoft Clarity/ }).click();
      await bar(page).getByRole('button', { name: 'Save choices', exact: true }).click();
      await expect(bar(page)).toBeHidden();
      const left = (await context.cookies(BASE)).map(cookie => cookie.name).filter(name => /^(_ga|_clck|_clsk)/.test(name));
      expect(left, 'the vendor cookies are gone').toEqual([]);
      expect((await stored(page))?.purposes).toEqual({ count: true, measure: false, record: false });

      const before = watch.vendor.length;
      await page.goto('/');
      await page.waitForTimeout(SETTLE_MS);
      expect(watch.vendor.slice(before), 'no vendor on the next page').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('Reject all, Accept all, Reject all in one tab: the other open tab follows each without reloading, and its Clarity stops for good each time', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'two-tabs');
    try {
      await withClarityTag(context);
      await page.goto('/');
      const recording = page.waitForRequest(request => request.url().startsWith('https://www.clarity.ms/collect'));
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await recording;

      const other = await context.newPage();
      await other.goto('/sim');
      const answer = async (name: 'Reject all' | 'Accept all') => {
        await other.waitForLoadState('load');
        await other.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
        await bar(other).getByRole('button', { name, exact: true }).click();
        await other.waitForLoadState('load');
        await expect(bar(other)).toBeHidden();
      };

      // A mark on the first tab's document: a reload would lose it, and with it anything typed and unsent.
      const mark = () => page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });
      const sameDocument = () => page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);
      await mark();
      await answer('Reject all');
      await goesQuiet(page, watch, 'the first tab sends nothing to a vendor after the first Reject all');
      expect(await sameDocument(), 'the first tab was not reloaded').toBe(true);

      // Google Analytics comes back on this page; recordings, ended on it, start with its next load.
      await answer('Accept all');
      await expect.poll(() => page.evaluate(id => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA_ID), { timeout: 10_000 }).toBe(false);
      const tagAgain = page.waitForRequest(request => request.url().startsWith(`https://www.clarity.ms/tag/${CLARITY_ID}`));
      await page.reload();
      await tagAgain;
      await page.waitForRequest(request => request.url().startsWith('https://www.clarity.ms/collect'));

      await mark();
      await answer('Reject all');
      await goesQuiet(page, watch, 'the first tab sends nothing to a vendor after the second Reject all');
      expect(await sameDocument(), 'the first tab was not reloaded').toBe(true);

      const before = watch.counts.length;
      await page.evaluate(() => history.pushState({}, '', '/sim'));
      await page.waitForTimeout(SETTLE_MS);
      expect(watch.counts.length, 'no count from the first tab after the other rejected').toBe(before);
    } finally {
      await context.close();
    }
  });

  test('Reject all while Clarity records stops it on the page with no further upload, its own last one included', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'stop-in-place');
    try {
      await withClarityTag(context);
      await page.goto('/');
      const recording = page.waitForRequest(request => request.url().startsWith('https://www.clarity.ms/collect'));
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await recording;
      await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });

      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      // The count starts at the withdrawal: an upload sent before the click is not one after it.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      const before = uploads(watch).length;
      await page.waitForTimeout(SETTLE_MS);
      expect(uploads(watch).slice(before), 'no upload after Reject all').toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true), 'the page was not reloaded').toBe(true);
      // Nothing on the page can start it again.
      await page.evaluate(() => { (window as unknown as { clarity?: (...args: unknown[]) => void }).clarity?.('start'); });
      await page.waitForTimeout(SETTLE_MS);
      expect(uploads(watch).slice(before), 'no upload after a later start call').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('a Reject all the browser refused to store, with Clarity\'s tag arriving after it, never lets recording start', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'refused-late-tag');
    try {
      const release = await withLateClarityTag(context);
      await page.goto('/');
      const tag = page.waitForRequest(request => request.url().startsWith(`https://www.clarity.ms/tag/${CLARITY_ID}`));
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await tag;

      // The browser stores nothing from here on, and the tag is still on its way.
      await page.evaluate(() => {
        Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      });
      await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(page).getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(bar(page).getByText('could not be saved on this device')).toBeVisible();

      release();
      await page.waitForTimeout(SETTLE_MS * 2);
      expect(uploads(watch), 'Clarity never records').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('an earlier Reject all holds while the bar asks again for a stored answer that is missing or out of date', async ({ browser }) => {
    const records = [
      null,
      JSON.stringify({ version: 1, purposes: { count: false, measure: false, record: false }, words: 'f'.repeat(64), at: '2026-01-01T00:00:00.000Z' }),
    ];
    for (const [index, record] of records.entries()) {
      const { context, page, watch } = await open(browser, `ignore-${index}`);
      try {
        await context.addInitScript(value => {
          localStorage.setItem('plausible_ignore', 'true');
          if (value !== null) localStorage.setItem('analytics_consent_purposes', value);
        }, record);
        await page.goto('/sim');
        await expect(bar(page), String(record)).toBeVisible();
        await page.waitForTimeout(SETTLE_MS);
        expect(watch.counts, `${record}: no count before a new answer`).toEqual([]);
        await bar(page).getByRole('button', { name: 'Choose', exact: true }).click();
        await expect(bar(page).getByRole('switch', { name: /Plausible/ }), String(record)).toHaveAttribute('aria-checked', 'false');
        await page.evaluate(() => history.pushState({}, '', '/'));
        await page.waitForTimeout(SETTLE_MS);
        expect(watch.counts, `${record}: no count on the next page either`).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });

  test('under a privacy signal the footer control explains the signal and never opens the bar', async ({ browser }) => {
    const { context, page } = await open(browser, 'signal-footer', { extraHTTPHeaders: { DNT: '1' } });
    try {
      for (const pathname of PAGES) {
        await page.goto(pathname);
        const control = page.getByRole('button', { name: 'Analytics choices', exact: true }).first();
        await expect(control, pathname).toBeVisible();
        await control.click();
        const note = page.getByRole('dialog', { name: 'Privacy signal' });
        await expect(note, pathname).toBeVisible();
        await expect(note.getByText(/asks sites not to track/), pathname).toBeVisible();
        await expect(note.getByText(/nothing optional runs on this site/), pathname).toBeVisible();
        await expect(bar(page), `${pathname}: no bar`).toHaveCount(0);
        await expect(page.getByRole('switch'), `${pathname}: no switches`).toHaveCount(0);
        await expect(note.getByRole('button', { name: 'Close', exact: true }), pathname).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(note, pathname).toBeHidden();
        await expect(control, `${pathname}: focus goes back to the control`).toBeFocused();
      }
    } finally {
      await context.close();
    }
  });

  test('at 320 by 180 px the whole bar fits the screen, scrolls as one panel, and focus never lands off screen', async ({ browser }) => {
    const { context, page } = await open(browser, 'short', { viewport: { width: 320, height: 180 } });
    try {
      await page.goto('/');
      const choose = bar(page).getByRole('button', { name: 'Choose', exact: true });
      await choose.focus();
      await page.keyboard.press('Enter');
      await expect(bar(page).getByRole('switch', { name: /Plausible/ })).toBeFocused();

      const panel = await bar(page).evaluate(region => {
        const rect = region.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, overflowY: getComputedStyle(region).overflowY, scrolls: region.scrollHeight > region.clientHeight };
      });
      expect(panel.top, 'the bar starts on screen').toBeGreaterThanOrEqual(-0.5);
      expect(panel.bottom, 'the bar ends on screen').toBeLessThanOrEqual(180.5);
      expect(panel.overflowY, 'the bar scrolls').toBe('auto');
      expect(panel.scrolls, 'the bar holds more than the screen').toBe(true);

      // Every stop of the keyboard's way through the bar is on screen when it is focused.
      for (let step = 0; step < 8; step++) {
        const focused = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || !element.closest('#pcc')) return null;
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, name: element.textContent?.trim() || element.getAttribute('aria-labelledby') || element.tagName };
        });
        expect(focused, `step ${step}: focus stays in the bar`).not.toBeNull();
        expect(focused!.top, `step ${step}: ${focused!.name} starts on screen`).toBeGreaterThanOrEqual(-0.5);
        expect(focused!.bottom, `step ${step}: ${focused!.name} ends on screen`).toBeLessThanOrEqual(180.5);
        await page.keyboard.press('Tab');
      }
    } finally {
      await context.close();
    }
  });

  for (const look of ['light', 'dark'] as const) {
    test(`the dashboard page's own Analytics choices control has a focus ring of 3:1 or more in the ${look} look`, async ({ browser }) => {
      const { context, page } = await open(browser, `shell-focus-${look}`, { colorScheme: look });
      try {
        // The dashboard's script and stylesheet fail; the consent bar's still load.
        await context.route(url => url.origin === BASE && /\.(js|css)$/.test(url.pathname) && !url.pathname.startsWith('/brand/'), route => route.abort());
        await page.goto('/sim');
        const control = page.locator('#pcc-reopen');
        await expect(control).toBeVisible();
        for (let step = 0; step < 30; step++) {
          if (await control.evaluate(element => element === document.activeElement)) break;
          await page.keyboard.press('Tab');
        }
        await expect(control).toBeFocused();
        const ring = await control.evaluate(element => {
          const style = getComputedStyle(element);
          let background = 'rgba(0, 0, 0, 0)';
          for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; }
          }
          return { color: style.outlineColor, style: style.outlineStyle, width: parseFloat(style.outlineWidth), background };
        });
        // A page with no background of its own shows the browser's: white in the light look, Chromium's #121212 in the dark one.
        const background = ring.background === 'rgba(0, 0, 0, 0)' ? (look === 'light' ? 'rgb(255, 255, 255)' : 'rgb(18, 18, 18)') : ring.background;
        expect(ring.style, 'a solid ring').toBe('solid');
        expect(ring.width, 'a ring 2 px wide or more').toBeGreaterThanOrEqual(2);
        expect(contrast(ring.color, background), `ring ${ring.color} on ${background}`).toBeGreaterThanOrEqual(3);
      } finally {
        await context.close();
      }
    });
  }

  test('pictures of the bar at 390 and 1440 px in both looks', async ({ browser }) => {
    mkdirSync(CAPTURES, { recursive: true });
    for (const look of ['dark', 'light'] as const) {
      for (const width of [390, 1440]) {
        const { context, page } = await open(browser, `picture-${look}-${width}`, {
          viewport: { width, height: width < 600 ? 844 : 900 },
          deviceScaleFactor: 2,
          colorScheme: look,
        });
        try {
          await context.addInitScript(value => { localStorage.setItem('paracosm-theme', value); }, look);
          await page.goto('/');
          await expect(bar(page)).toBeVisible();
          await page.screenshot({ path: path.join(CAPTURES, `bar-${look}-${width}.png`) });
          await bar(page).getByRole('button', { name: 'Choose', exact: true }).click();
          await expect(bar(page).getByRole('switch')).toHaveCount(3);
          await page.screenshot({ path: path.join(CAPTURES, `choices-${look}-${width}.png`) });
        } finally {
          await context.close();
        }
      }
    }
  });
});
