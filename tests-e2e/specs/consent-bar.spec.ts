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
 *   no request goes to Google, Microsoft or PostHog, and the page sends one
 *   count event to the product's own endpoint, which forwards it path only;
 * - the three keys stay on one row from 320 to 768 px wide, with text of
 *   14 px or more and keys 44 px tall;
 * - Reject all ends the count; Accept all loads Google Analytics and
 *   Clarity; Choose turns on one purpose alone;
 * - a privacy signal (the Sec-GPC header, or navigator.globalPrivacyControl)
 *   shows no bar and loads nothing optional;
 * - the footer's Analytics choices control reopens the choices, and turning
 *   a purpose off there clears that vendor's cookies.
 * - a choice saved in one tab reaches another tab of the same browser that
 *   is already open.
 *
 * It also writes pictures of the bar at 390 and 1440 px in both looks into
 * test-results/consent-bar-captures, which CI uploads.
 */
import { test, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Request } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The hosted-demo server with analytics runs locally, on a port of its own.');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASE = 'http://127.0.0.1:3462';
const SINK = 'http://127.0.0.1:3463';
/** The ids tests-e2e/support/consent-server.ts gives the server. */
const GA_ID = 'G-E2E0TEST00';
const CLARITY_ID = 'e2econsent';
const CAPTURES = path.resolve(ROOT, 'test-results/consent-bar-captures');

/** The hosts a page may reach only after its purpose's yes. */
const VENDOR_HOST = /(^|\.)(googletagmanager\.com|google-analytics\.com|clarity\.ms|posthog\.com)$/;
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
}

/** A context whose browser identifies itself uniquely, so the sink's events can be told apart by test. */
async function open(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<{ context: BrowserContext; page: Page; watch: Watch; agent: string }> {
  const agent = `paracosm-consent-e2e/${name.replace(/[^a-z0-9]+/gi, '-')}-${Math.random().toString(36).slice(2, 10)}`;
  const context = await browser.newContext({ baseURL: BASE, userAgent: agent, ...options });
  await context.route(ANSWERED_HOST, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  const watch: Watch = { vendor: [], counts: [] };
  page.on('request', request => {
    const url = new URL(request.url());
    if (VENDOR_HOST.test(url.hostname)) watch.vendor.push(request.url());
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

async function stored(page: Page): Promise<{ purposes: Record<string, boolean> } | null> {
  const raw = await page.evaluate(() => localStorage.getItem('analytics_consent_purposes'));
  return raw === null ? null : JSON.parse(raw) as { purposes: Record<string, boolean> };
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
        await page.goto(`${pathname}?utm_source=e2e#top`);
        await expect(bar(page)).toBeVisible();
        for (const key of keys(page)) await expect(key).toBeVisible();
        await count;
        await page.waitForTimeout(SETTLE_MS);

        expect(watch.vendor, 'no request to Google, Microsoft or PostHog before an answer').toEqual([]);
        expect(watch.counts, 'one count event to the site itself').toHaveLength(1);
        expect(await page.evaluate(() => localStorage.getItem('plausible_ignore'))).toBeNull();

        // The server forwards it under the site's Plausible domain, path only.
        await expect.poll(async () => (await forwarded(agent)).length).toBe(1);
        const [event] = await forwarded(agent);
        expect(event.body.name).toBe('pageview');
        expect(event.body.domain).toBe('paracosm.agentos.sh');
        expect(event.body.url).toBe(`https://paracosm.agentos.sh${pathname}`);
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
      expect(watch.vendor.some(url => /(^|\.)posthog\.com$/.test(new URL(url).hostname))).toBe(false);
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

  test('a Sec-GPC header shows no bar and loads nothing optional, the count included', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'gpc-header', { extraHTTPHeaders: { 'Sec-GPC': '1' } });
    try {
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

  test('a choice saved in one tab stops the count and the tools in another tab that is already open', async ({ browser }) => {
    const { context, page, watch } = await open(browser, 'two-tabs');
    try {
      await page.goto('/');
      const google = page.waitForRequest(request => request.url().startsWith(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`));
      await bar(page).getByRole('button', { name: 'Accept all', exact: true }).click();
      await google;

      // A second tab of the same browser rejects everything.
      const other = await context.newPage();
      await other.goto('/sim');
      await other.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
      await bar(other).getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(bar(other)).toBeHidden();

      // The first tab stops Google Analytics at once and counts no later page of its own.
      await expect.poll(() => page.evaluate(id => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA_ID)).toBe(true);
      const before = watch.counts.length;
      await page.evaluate(() => history.pushState({}, '', '/another-page'));
      await page.waitForTimeout(SETTLE_MS);
      expect(watch.counts.length, 'no count from the first tab after the second rejected').toBe(before);
    } finally {
      await context.close();
    }
  });

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
