import { expect, test, type Page } from '@playwright/test';
import { axeFindings, measureReadability, rowsOnOneRow } from '../support/first-screen-measure.js';
import { ENTRY_SCRIPT, SERVERS, holdScript, lookOf, openTab, scaleText } from '../support/frame.js';
import { FIGURES, measureText, spacingFaults } from '../support/readability.js';

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

const runMenu = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true });
const replayStatus = (page: Page) => page.getByRole('status').filter({ hasText: /^REPLAYING/i });
const runStatus = (page: Page) => page.getByRole('region', { name: 'Run status' });
const savedPair = (page: Page) => page.getByRole('region', { name: 'Saved runs' })
  .getByRole('link', { name: /(?=.*Aria Chen)(?=.*Dietrich Voss)(?=.*Mars Genesis)/i });
const start = (page: Page) => page.getByRole('button', { name: /^Start\b/i });

test('the RUN menu leaves, and saved runs are in Library', async ({ page }) => {
  await page.goto(SERVERS.replay + '/sim');
  for (const tab of ['quickstart', 'sim', 'reports', 'settings', 'studio', 'library'] as const) {
    await openTab(page, tab);
    await expect(runMenu(page)).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'Saved runs', exact: true })).toBeVisible();
  await expect(savedPair(page)).toBeVisible();
  const replay = new URL((await savedPair(page).getAttribute('href'))!, page.url());
  expect(replay.searchParams.get('replay')).toBeTruthy();
  expect(replay.searchParams.get('tab')).toBe('sim');
  await savedPair(page).click();
  await expect(page).toHaveURL(replay.href);
  await expect(replayStatus(page)).toBeVisible();
});

test('runs kept in this browser are in Library', async ({ page }) => {
  await page.goto(SERVERS.replay + '/sim?tab=library');
  await savedPair(page).click();
  await expect(runStatus(page).getByRole('status', { name: /^Simulation status: Complete/ })).toBeVisible();
  await page.goto(SERVERS.replay + '/sim?tab=library');
  const local = page.getByRole('region', { name: 'Kept in this browser' });
  const restore = local.getByRole('button', { name: 'Restore', exact: true }).first();
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page).toHaveURL(/[?&]tab=sim/);
  await expect(runStatus(page)).toBeVisible();
  await openTab(page, 'library');
  const question = page.waitForEvent('dialog');
  const answer = question.then(dialog => dialog.dismiss());
  await restore.click();
  expect((await question).message()).toBe('Replace the run on screen with this one?');
  await answer;
  await expect(page).toHaveURL(/[?&]tab=library/);
  await expect(runStatus(page)).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await local.getByRole('button', { name: 'Clear this list' }).click();
  await expect(local).toHaveCount(0);
});

test('a run file opens from Studio, or dropped anywhere', async ({ page }) => {
  await page.goto(SIM);
  await openTab(page, 'studio');
  const contents = JSON.stringify({
    schemaVersion: 3,
    events: ['turn_start', 'turn_done'].map(type => ({
      type, leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' },
    })),
  });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Open a run file', exact: true }).click(),
  ]);
  await chooser.setFiles({ name: 'run.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
  const preview = page.getByRole('dialog', { name: 'Load simulation' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await openTab(page, 'quickstart');
  const dataTransfer = await page.evaluateHandle(body => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([body], 'run.json', { type: 'application/json' }));
    return transfer;
  }, contents);
  await page.locator('body').dispatchEvent('drop', { dataTransfer });
  await expect(preview).toBeVisible();
});

test('the run actions leave the idle page and stay in Settings', async ({ page }) => {
  await page.goto(SERVERS.admin + '/sim?tab=settings');
  const actions = page.getByRole('button', { name: 'Open run actions menu' });
  const stored = page.getByRole('group', { name: 'Stored data' });
  await expect(stored).toBeVisible();
  await expect(actions).toHaveCount(0);
  const questions: string[] = [];
  page.on('dialog', async dialog => {
    questions.push(dialog.message());
    if (dialog.message().startsWith('Clear local data?')) await dialog.dismiss();
    else await dialog.accept();
  });
  await stored.getByRole('button', { name: 'Clear local data' }).click();
  expect(questions[0]).toMatch(/^Clear local data\?/);
  await page.locator('#admin-token').fill('e2e-admin-token');
  await page.getByRole('button', { name: 'Save admin token' }).click();
  const wipe = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/admin/data/wipe');
  await page.route('**/admin/data/wipe', route => route.fulfill({ status: 200, json: { ok: true } }));
  await stored.getByRole('button', { name: 'Delete server data' }).click();
  await wipe;
  expect(questions[1]).toMatch(/^Delete server data\?/);

  await page.goto(SERVERS.replay + '/sim?tab=library');
  await savedPair(page).click();
  await expect(runStatus(page)).toBeVisible();
  await actions.click();
  for (const name of ['Save', 'Share viz link', 'Copy', 'Clear local data']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
});

test('feature 13: the foot ends every tab', async ({ page, context }) => {
  test.setTimeout(120_000);
  const foot = page.getByRole('contentinfo');
  const nav = foot.getByRole('navigation', { name: 'Site links' });
  const pages = ['quickstart', 'sim', 'reports', 'studio', 'viz', 'library', 'settings'] as const;
  const links = [
    ['Docs', '/docs'],
    ['GitHub', 'https://github.com/framerslab/paracosm'],
    ['npm', 'https://www.npmjs.com/package/paracosm'],
    ['Privacy', '/#privacy'],
  ] as const;
  for (const look of LOOKS) {
    await page.emulateMedia({ colorScheme: look });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(SIM);
      for (const tab of pages) {
        await openTab(page, tab);
        await expect(foot).toHaveCount(1);
        await expect(page.getByRole('main').getByRole('contentinfo')).toHaveCount(0);
        await expect(foot).toContainText("For adults. Under 18? Use it with a parent’s or guardian’s permission.");
        await expect(foot).toContainText('Paracosm · Apache-2.0 · Frame.dev');
        const before = (await foot.boundingBox())!.y;
        await foot.scrollIntoViewIfNeeded();
        expect((await foot.boundingBox())!.y).toBeLessThan(before);
        for (const [name, href] of links) {
          const link = nav.getByRole('link', { name, exact: true });
          await expect(link).toHaveAttribute('href', href);
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          if (name === 'GitHub' || name === 'npm') await expect(link).toHaveAttribute('target', '_blank');
        }
        await expect(nav.getByRole('link', { name: 'Terms', exact: true })).toHaveCount(0);
        await expect(foot.locator('img, canvas')).toHaveCount(0);
        await expect(runStatus(page)).toHaveCount(0);
        expect(await measureReadability(page, '[role="contentinfo"]')).toEqual([]);
      }
      await context.setOffline(true);
      await expect(nav.getByRole('link')).toHaveText(links.map(([label]) => label));
      await context.setOffline(false);
    }
    await page.goto(SIM);
    for (const width of [320, 360, 390, 430, 480, 600, 768, 1100, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(nav.getByRole('link')).toHaveCount(4);
      const boxes = await Promise.all((await nav.getByRole('link').all()).map(async link => (await link.boundingBox())!));
      expect(boxes.every(box => Math.abs(box.y - boxes[0].y) <= 1)).toBe(true);
      if (width === 320) expect(boxes[1].x - boxes[0].x - boxes[0].width).toBeGreaterThanOrEqual(8);
      if (width >= 600) {
        const licence = (await foot.getByTestId('foot-licence').boundingBox())!;
        const last = boxes[boxes.length - 1];
        expect(licence.x).toBeGreaterThan(last.x + last.width);
      }
      expect(await foot.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await scaleText(page, 2);
    const more = nav.getByRole('button', { name: 'More links' });
    await expect(nav.getByRole('link', { name: 'Privacy' })).toBeVisible();
    await more.click();
    await expect(nav.getByRole('menuitem')).toHaveText(['Docs', 'GitHub', 'npm']);
  }
});

test('feature 13: one Analytics choices control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SERVERS.consent + '/sim?tab=reports');
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  const choices = page.getByRole('button', { name: 'Analytics choices', exact: true });
  await expect(choices).toHaveCount(1);
  await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Analytics choices' }).getByRole('switch')).toHaveCount(3);
  await page.goto(SIM);
  await expect(choices).toHaveCount(0);
});

test('the run’s status bar shows only while a run exists', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.82' });
  await page.goto(SERVERS.demo + '/sim');
  await expect(start(page)).toBeEnabled();
  await expect(runStatus(page)).toHaveCount(0);
  try {
    await start(page).click();
    await expect(runStatus(page).getByRole('status', { name: /^Simulation status: Running/ })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
  } finally {
    await page.request.post(SERVERS.demo + '/clear').catch(() => undefined);
  }
});

test('one way to start a run, and Start lands on Watch', async ({ page }) => {
  for (const [index, width] of [390, 1440].entries()) {
    await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.' + (83 + index) });
    await page.setViewportSize({ width, height: 844 });
    await page.goto(SERVERS.demo + '/sim');
    await expect(start(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^(RUN|Run New Simulation|Run Simulation)$/ })).toHaveCount(0);
    try {
      await start(page).click();
      await expect(page).toHaveURL(/[?&]tab=sim/);
      await expect(page.getByTestId('watch-grid-panel')).toHaveCount(2);
    } finally {
      await page.request.post(SERVERS.demo + '/clear').catch(() => undefined);
    }
  }
});

test('no tour', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await Promise.all([390, 1440].map(async width => {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 844 });
      await page.goto(SIM);
      const how = page.getByRole('button', { name: 'How it works', exact: true });
      await expect(how).toBeVisible();
      await page.waitForTimeout(30_000);
      await expect(page.locator('[data-tour-overlay]')).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: /Guided tour/i })).toHaveCount(0);
      await expect(page.getByText('Take the guided tour')).toHaveCount(0);
      const card = page.getByRole('dialog', { name: 'How it works' });
      await how.click();
      await expect(card).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      await how.click();
      await expect(card).toBeVisible();
    }));
  } finally {
    await context.close();
  }
});

const banner = (page: Page) => page.locator('#root').getByRole('banner');
const home = (page: Page) => banner(page).getByRole('link', { name: 'Paracosm home' });
const how = (page: Page) => banner(page).getByRole('button', { name: 'How it works', exact: true });
const switchLook = (page: Page, look?: Look) => banner(page).getByRole('button', {
  name: look ? `Switch to ${look} look` : /^Switch to (light|dark) look$/,
});
const visitor = (page: Page) => banner(page).getByRole('status');
const demo = SERVERS.demo + '/sim';

test('feature 1: the row on a first visit', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.85' });
  for (const [width, look] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: look });
    await page.goto(demo);
    await expect(visitor(page)).toHaveText(look === 'light' ? 'Free demo: 1 run left today' : '1 free run', { useInnerText: true });
    expect(await lookOf(page)).toEqual(EXPECTED_LOOK[look]);
    if (look === 'light') await expect(home(page)).toHaveText('PARACOSM');
    await expect(how(page)).toBeVisible();
    await expect(switchLook(page, look === 'light' ? 'dark' : 'light')).toBeVisible();
    await page.waitForTimeout(10_000);
    await expect(page.locator('[data-tour-overlay]')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /Guided tour/i })).toHaveCount(0);
  }
});

test('feature 1: the switch keeps the choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(SIM);
  await switchLook(page, 'dark').click();
  expect(await lookOf(page)).toEqual(EXPECTED_LOOK.dark);
  for (const locator of [page.locator('html'), banner(page)]) {
    expect(await locator.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  }
  await page.reload();
  await expect(switchLook(page, 'light')).toBeVisible();
  expect(await lookOf(page)).toEqual(EXPECTED_LOOK.dark);
});

test('feature 1: one row from 320 px', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.86' });
  for (const look of LOOKS) {
    await page.emulateMedia({ colorScheme: look });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(demo);
    for (const width of [320, 360, 390, 430, 480, 768]) {
      await test.step(`${width} px, ${look}`, async () => {
        await page.setViewportSize({ width, height: 844 });
        await expect(visitor(page)).toHaveText(width < 600 ? '1 free run' : 'Free demo: 1 run left today', { useInnerText: true });
        await expect(visitor(page)).toHaveAttribute('aria-live', 'polite');
        await expect(home(page).locator('img')).toHaveAttribute('src', '/favicon.svg');
        if (width < 430) await expect(home(page).getByText('PARA')).toBeHidden();
        else await expect(home(page).getByText('PARA')).toBeVisible();
        await expect(how(page)).toHaveText(width < 360 ? '' : 'How it works', { useInnerText: true });
        const row = banner(page).locator('[data-row="Header"]');
        expect((await row.boundingBox())!.height).toBe(56);
        expect(await rowsOnOneRow(page)).toEqual([]);
        expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(start(page)).toHaveCount(1);
        await expect(banner(page).getByRole('button')).toHaveCount(2);
      });
    }
  }
});

test('feature 1: names, sizes and the live tokens', async ({ page }) => {
  test.setTimeout(90_000);
  for (const look of LOOKS) {
    await page.emulateMedia({ colorScheme: look });
    await page.setViewportSize({ width: 1440, height: 844 });
    await page.goto(SIM);
    await expect(home(page)).toBeVisible();
    await expect(how(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(switchLook(page, look === 'light' ? 'dark' : 'light')).toBeVisible();
    await expect(banner(page)).toHaveCSS('background-color', EXPECTED_LOOK[look].ground);
    await expect(home(page)).toHaveCSS('color', look === 'light' ? 'rgb(26, 18, 8)' : 'rgb(245, 240, 228)');
    await expect(home(page).getByText('COSM')).toHaveCSS('color', look === 'light' ? 'rgb(107, 71, 0)' : 'rgb(232, 180, 74)');
    expect(await measureReadability(page, '[role="banner"]')).toEqual([]);
    expect(await axeFindings(page, '[role="banner"]')).toEqual([]);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const [brand, help, toggle] = await Promise.all([home(page).boundingBox(), how(page).boundingBox(), switchLook(page).boundingBox()]);
      expect(brand!.height).toBeGreaterThanOrEqual(44);
      expect(help!.height).toBeGreaterThanOrEqual(44);
      if (width === 320) expect(help!.width).toBe(44);
      else expect(help!.width).toBeGreaterThanOrEqual(120);
      expect(toggle).toMatchObject({ width: 44, height: 44 });
      expect(toggle!.x - help!.x - help!.width).toBeCloseTo(8);
    }
  }
});

test('feature 1: the visitor’s state by who pays', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${87 + info.retry}` });
  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto(demo);
  await expect(visitor(page)).toHaveText('Free demo: 1 run left today', { useInnerText: true });
  const keys = () => Promise.all([home(page).boundingBox(), how(page).boundingBox(), switchLook(page).boundingBox()]);
  const before = await keys();
  await page.route('**/rate-limit', route => route.abort());
  await page.reload();
  await expect(visitor(page)).toHaveText('', { useInnerText: true });
  await expect(switchLook(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await keys()).toEqual(before);
  await page.unroute('**/rate-limit');
  await page.reload();
  await expect(start(page)).toBeEnabled();
  try {
    await start(page).click();
    await expect(page).toHaveURL(/[?&]tab=sim/);
    await expect(page.getByTestId('watch-grid-panel')).toHaveCount(2);
  } finally {
    await page.request.post(SERVERS.demo + '/clear').catch(() => undefined);
  }
  await page.goto(demo);
  for (const width of [768, 1440, 320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(visitor(page)).toHaveText(width < 600 ? 'No free run' : 'Free demo: no run left today', { useInnerText: true });
  }
  await page.evaluate(() => localStorage.setItem('paracosm:keyOverrides', JSON.stringify({ openai: 'test-provider-key' })));
  await page.reload();
  await expect(visitor(page)).toHaveText('Your key', { useInnerText: true });
  await page.setViewportSize({ width: 1440, height: 844 });
  await expect(visitor(page)).toHaveText('Your API key', { useInnerText: true });
  await page.goto(SIM);
  await expect(visitor(page)).toHaveText("This server's API keys", { useInnerText: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(visitor(page)).toHaveText('Server keys', { useInnerText: true });
});

test('feature 1: the same row on every tab, and offline', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(SIM);
    await expect(visitor(page)).toContainText(width < 600 ? 'Server keys' : "This server's API keys");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const keys = () => Promise.all([home(page).boundingBox(), how(page).boundingBox(), switchLook(page).boundingBox()]);
    const before = await keys();
    for (const tab of ['sim', 'reports'] as const) {
      await openTab(page, tab);
      await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}\\b`));
      expect(await keys()).toEqual(before);
    }
    await context.setOffline(true);
    try {
      const card = page.getByRole('dialog', { name: 'How it works' });
      await how(page).click();
      await expect(card).toBeVisible();
      await expect(how(page)).toHaveAttribute('aria-expanded', 'true');
      const key = (await how(page).boundingBox())!;
      await page.mouse.click(key.x + key.width / 2, key.y + key.height / 2);
      await expect(card).toHaveCount(0);
      await expect(how(page)).toHaveAttribute('aria-expanded', 'false');
      const opposite = (await lookOf(page)).light ? 'dark' : 'light';
      await switchLook(page, opposite).click();
      expect(await lookOf(page)).toEqual(EXPECTED_LOOK[opposite]);
    } finally {
      await context.setOffline(false);
    }
  }
});

test('feature 1: large text in the header', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(SIM);
    await expect(switchLook(page)).toBeVisible();
    await scaleText(page, 2);
    await expect(how(page)).toBeVisible();
    await expect.poll(() => spacingFaults(banner(page))).toEqual({ cut: [], overlaps: [] });
    expect(await banner(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
});
