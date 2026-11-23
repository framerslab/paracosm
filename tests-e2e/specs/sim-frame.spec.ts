import { expect, test, type Page } from '@playwright/test';
import { measureReadability } from '../support/first-screen-measure.js';
import { ENTRY_SCRIPT, SERVERS, holdScript, lookOf } from '../support/frame.js';
import { FIGURES, measureText } from '../support/readability.js';

const LOOKS = ['light', 'dark'] as const;
type Look = typeof LOOKS[number];
const EXPECTED_LOOK = {
  light: { light: true, scheme: 'light', ground: 'rgb(240, 230, 210)', metas: ['#f0e6d2'] },
  dark: { light: false, scheme: 'dark', ground: 'rgb(10, 8, 6)', metas: ['#0a0806'] },
};

const SIM = SERVERS.dashboard + '/sim';

async function checkPaint(page: Page, look: Look): Promise<void> {
  await holdScript(page, 3_000);
  await page.goto(SIM, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body && getComputedStyle(document.body).getPropertyValue('--bg-deep').trim());
  await expect(page.locator('#seo-shell')).toBeAttached();
  expect(await lookOf(page)).toEqual(EXPECTED_LOOK[look]);
  await expect(page.locator('#root').getByRole('banner')).toBeAttached();
  await expect(page.locator('#seo-shell')).toHaveCount(0);
  expect(await lookOf(page)).toEqual(EXPECTED_LOOK[look]);
}

test('feature 1: the first paint takes the browser’s look', async ({ browser }) => {
  for (const width of [390, 1440]) {
    for (const look of LOOKS) {
      await test.step(width + ' px, ' + look, async () => {
        const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme: look });
        try {
          await checkPaint(page, look);
        } finally {
          await page.close();
        }
      });
    }
  }
});

test('feature 1: a stored look wins, junk and a throwing storage do not', async ({ browser }) => {
  for (const [stored, look] of [['dark', 'dark'], ['system', 'light'], ['"dark"', 'light'], [null, 'light']] as const) {
    await test.step(stored ?? 'storage throws', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
      try {
        await page.addInitScript((value) => {
          if (value === null) {
            Storage.prototype.getItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
            Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
          } else {
            window.localStorage.setItem('paracosm-theme', value);
          }
        }, stored);
        await checkPaint(page, look);
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect.poll(() => lookOf(page)).toEqual(EXPECTED_LOOK.dark);
        if (stored === null) {
          await page.getByRole('button', { name: /switch to light/i }).click();
          expect(await lookOf(page)).toEqual(EXPECTED_LOOK.light);
          await page.emulateMedia({ colorScheme: 'light' });
          await page.emulateMedia({ colorScheme: 'dark' });
          expect(await lookOf(page)).toEqual(EXPECTED_LOOK.light);
        }
      } finally {
        await page.close();
      }
    });
  }
});

test('feature 1: the page’s script did not load', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(ENTRY_SCRIPT, (route) => route.abort());
  for (const look of LOOKS) {
    await page.emulateMedia({ colorScheme: look });
    await page.goto(SIM);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Paracosm home' })).toBeVisible();
    const failure = page.locator('#boot-failed');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('This page did not load. Reload to try again.');
    await expect(failure.locator('svg[aria-hidden="true"]')).toBeVisible();
    const reload = failure.getByRole('link', { name: 'Reload', exact: true });
    expect(await reload.evaluate((link: HTMLAnchorElement) => link.href)).toBe(page.url());
    expect(await measureReadability(page, '.boot-row')).toEqual([]);
  }
});

test('feature 1: one skip link, first in the tab order', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const look of LOOKS) {
      await page.emulateMedia({ colorScheme: look });
      await page.goto(SIM);
      const main = page.getByRole('main');
      const skip = page.getByRole('link', { name: 'Skip to main content', exact: true });
      await expect(page.locator('#main-content')).toHaveCount(1);
      await expect(main).toHaveCount(1);
      await expect(skip).toHaveCount(1);

      await page.keyboard.press('Tab');
      await expect(skip).toBeFocused();
      const box = (await skip.boundingBox())!;
      expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(200);
      const [label] = await measureText(page, skip);
      expect(label?.ratio).toBeGreaterThanOrEqual(FIGURES.bodyRatio);
      await page.keyboard.press('Enter');
      await expect(main).toBeFocused();
    }
  }
});

test('the faces load early and their swap moves nothing', async ({ browser }) => {
  for (const width of [390, 1440]) {
    const viewport = { width, height: 844 };
    const loaded = await browser.newPage({ viewport });
    const fallback = await browser.newPage({ viewport });
    try {
      await fallback.route('**/brand/fonts/*.woff2', (route) => route.abort());
      await Promise.all([loaded.goto(SIM), fallback.goto(SIM)]);
      const preloads = loaded.locator('link[rel="preload"][as="font"][crossorigin]');
      await expect(preloads).toHaveCount(2);
      expect(await preloads.evaluateAll((links) => links.map((link) => link.getAttribute('href')).sort())).toEqual([
        '/brand/fonts/inter-latin-wght-normal.woff2',
        '/brand/fonts/jetbrains-mono-latin-wght-normal.woff2',
      ]);
      const [withFonts, withoutFonts] = await Promise.all([geometry(loaded), geometry(fallback)]);
      expect(Math.abs(withFonts.bannerHeight - withoutFonts.bannerHeight)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(withFonts.mainTop - withoutFonts.mainTop)).toBeLessThanOrEqual(0.5);
    } finally {
      await Promise.all([loaded.close(), fallback.close()]);
    }
  }
});

async function geometry(page: Page) {
  const banner = page.getByRole('banner');
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  const family = await page.evaluate(async () => {
    await document.fonts.ready;
    return getComputedStyle(document.body).fontFamily;
  });
  expect(family).toMatch(/^["']?Inter["']?,/);
  return { bannerHeight: (await banner.boundingBox())!.height, mainTop: (await main.boundingBox())!.y };
}
