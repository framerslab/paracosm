import { expect, test, type Page } from '@playwright/test';
import { axeFindings, measureReadability, rowsOnOneRow } from '../support/first-screen-measure.js';
import { ENTRY_SCRIPT, SERVERS, holdScript, lookOf, openTab, routeScenario, scaleText, sectionMenuItem as menuItem } from '../support/frame.js';
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
    // The skip link reaches the page's words before the dashboard mounts.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page.locator('#main-content #boot-failed')).toHaveCount(1);
  }
});

test('feature 1: the page’s script stopped while it ran', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(ENTRY_SCRIPT, route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: 'throw new Error("The entry module stopped.");',
  }));
  await page.goto(SIM);
  const failure = page.locator('#boot-failed');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('This page did not load. Reload to try again.');
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
        await expect(foot).toContainText("Under 18? You need a parent's or guardian's permission to use this. Not for children under 13.");
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
        expect((await sections(page).boundingBox())!.y - (await banner(page).boundingBox())!.y).toBe(55);
        expect(await rowsOnOneRow(page)).toEqual([]);
        expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(start(page)).toHaveCount(1);
        await expect(banner(page).getByRole('button')).toHaveCount(3);
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
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
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
  await page.evaluate(() => sessionStorage.setItem('paracosm:keyOverrides', JSON.stringify({ openai: 'test-provider-key' })));
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
    await expect.poll(() => banner(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
// getByRole has no `has` option: the filter picks More out of the row's arrow keys.
const more = (page: Page) => sections(page).getByRole('button').filter({ has: page.locator('[data-more-label]') });
const sectionLink = (page: Page, name: string) => sections(page).getByRole('link', { name, exact: true });
const sectionMenu = (page: Page) => page.getByRole('menu', { name: 'Sections' });

test('feature 2: four keys on one row', async ({ page }) => {
  for (const look of LOOKS) {
    await page.emulateMedia({ colorScheme: look });
    await page.goto(SIM);
    for (const width of [320, 360, 390, 430, 480, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const keys = sections(page).getByRole('link').or(more(page));
      await expect(keys).toHaveCount(4);
      await expect(keys).toHaveText(['Run', 'Watch', 'Reports', 'More']);
      const boxes = await Promise.all((await keys.all()).map(key => key.boundingBox()));
      for (const [index, key] of (await keys.all()).entries()) {
        await expect(key).toHaveCSS('font-family', /JetBrains Mono/);
        await expect(key).toHaveCSS('font-size', '15px');
        await expect(key).toHaveCSS('text-transform', 'uppercase');
        await expect(key).toHaveCSS('letter-spacing', width < 360 ? 'normal' : '1px');
        expect(boxes[index]!.y).toBe(boxes[0]!.y);
        if (width === 320) {
          expect(boxes[index]!.height).toBe(48);
          expect(boxes[index]!.width).toBeGreaterThanOrEqual(72);
        }
      }
      await expect(sections(page).getByRole('button', { name: 'Next sections' })).toHaveCount(0);
      expect(await sections(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  }
});

test('feature 2 and 1: one bar from 1,100 px, two rows on a tablet', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.96' });
  await page.goto(demo);
  for (const width of [1440, 1100, 768, 600, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(visitor(page)).toHaveText(width < 600 ? '1 free run' : 'Free demo: 1 run left today', { useInnerText: true });
    const [brand, nav, help, toggle] = await Promise.all(
      [home(page), sections(page), how(page), switchLook(page)].map(key => key.boundingBox()),
    );
    expect(brand!.x).toBeLessThan(help!.x);
    expect(help!.x).toBeLessThan(toggle!.x);
    if (width >= 1100) {
      expect((await banner(page).boundingBox())!.height).toBe(56);
      expect(nav!.x).toBeGreaterThan(brand!.x);
      expect(nav!.x + nav!.width).toBeLessThan(help!.x);
      if (width === 1440) expect(brand!.x).toBe(120);
    } else {
      expect(nav!.y).toBeGreaterThan(brand!.y + brand!.height);
    }
  }
  await more(page).click();
  await expect(sectionMenu(page).getByText('Free demo: 1 run left today', { exact: true })).toBeVisible();
});

test('feature 2: MORE lists six tabs and three links', async ({ page }) => {
  await page.goto(SIM);
  const menu = sectionMenu(page);
  const labels = ['Studio', 'Visualization', 'Chat', 'Library', 'Settings', 'About', 'Docs', 'GitHub', 'npm'];
  const descriptions = [
    'Open run files and branch a run.', 'Everyone in the run, drawn as a living map.',
    'Talk with a character from the run.', 'Your saved runs.', 'Leaders, models and your own API key.',
    'What Paracosm is.', 'The API reference and guides.', 'The source code.', 'The package to install.',
  ];
  for (const [width, menuWidth] of [[390, 390], [600, 320], [1100, 360], [1440, 520]]) {
    await page.setViewportSize({ width, height: 844 });
    await more(page).click();
    expect((await menu.boundingBox())!.width).toBe(menuWidth);
    if (width === 390) await expect(menu).toHaveCSS('position', 'fixed');
    await expect(menu.getByRole('menuitem')).toHaveCount(labels.length);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    for (const [index, label] of labels.entries()) {
      await expect(menuItem(page, label)).toHaveAccessibleName(`${label} ${descriptions[index]}`);
    }
    await expect(menuItem(page, 'Docs')).toHaveAttribute('href', '/docs');
    for (const [label, href] of [
      ['GitHub', 'https://github.com/framerslab/paracosm'],
      ['npm', 'https://www.npmjs.com/package/paracosm'],
    ]) {
      await expect(menuItem(page, label!)).toHaveAttribute('href', href!);
      await expect(menuItem(page, label!)).toHaveAttribute('target', '_blank');
      await expect(menuItem(page, label!)).toHaveAttribute('rel', 'noopener noreferrer');
    }
    await page.keyboard.press('Escape');
  }
  await more(page).click();
  await menuItem(page, 'Settings').click();
  await expect(page).toHaveURL(/[?&]tab=settings/);
  await expect(more(page)).toHaveAccessibleName('SETTINGS');
  await expect(more(page)).toHaveAttribute('aria-current', 'page');

  await routeScenario(page, scenario => ({
    ...scenario, policies: { ...scenario.policies, characterChat: false },
  }));
  await page.goto(SIM);
  await expect(page.getByTestId('scenario-figures')).toBeVisible();
  await more(page).click();
  await expect(menuItem(page, 'Chat')).toHaveCount(0);
});

test('feature 2: RUN, by keyboard, saved links and old addresses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.goto(SIM + '?tab=sim');
  await expect(sectionLink(page, 'Watch')).toHaveAttribute('aria-current', 'page');
  await sectionLink(page, 'Run').click();
  await expect(page).toHaveURL(/[?&]tab=quickstart/);
  await expect(sectionLink(page, 'Run')).toHaveAttribute('aria-current', 'page');
  await sectionLink(page, 'Reports').focus();
  await page.keyboard.press('Tab');
  await expect(more(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItem(page, 'Studio')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItem(page, 'Visualization')).toBeFocused();
  await page.keyboard.press('End');
  await expect(menuItem(page, 'npm')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menuItem(page, 'Studio')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sectionMenu(page)).toBeHidden();
  await expect(more(page)).toBeFocused();

  for (const [suffix, name] of [['?tab=library', 'Library'], ['?tab=branches', 'Studio'], ['?tab=log', 'Settings'], ['#sim', 'Watch']]) {
    await page.goto(SIM + suffix);
    await expect(page.getByRole('main', { name })).toBeVisible();
    if (name !== 'Watch') await expect(more(page)).toHaveAccessibleName(name!.toUpperCase());
  }
  await page.goto(SIM + '?tab=branches');
  await expect(page.getByRole('tab', { name: 'Branches' })).toHaveAttribute('aria-selected', 'true');
  await page.goto(SIM + '?tab=log');
  await expect(page.getByRole('tab', { name: 'Event Log' })).toHaveAttribute('aria-selected', 'true');
  await page.goto(SIM + '?tab=about');
  await expect(page).toHaveURL(SERVERS.dashboard + '/');
  await page.goto(SERVERS.replay + '/sim?tab=viz&replay=missing');
  await expect(more(page)).toHaveAccessibleName('VISUALIZATION');

  await page.setViewportSize({ width: 700, height: 844 });
  await page.goto(SIM);
  await more(page).click();
  await expect(sectionMenu(page)).toBeVisible();
  await page.setViewportSize({ width: 500, height: 844 });
  await expect(sectionMenu(page)).toBeHidden();
  await expect(more(page)).toBeFocused();

  await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.97' });
  await page.goto(demo);
  await expect(start(page)).toBeEnabled();
  try {
    await more(page).click();
    await expect(sectionMenu(page)).toBeVisible();
    // Activate Start without a pointer press, which would close the menu
    // before the run changes tabs.
    await start(page).evaluate(button => (button as HTMLButtonElement).click());
    await expect(sectionLink(page, 'Watch')).toHaveAttribute('aria-current', 'page');
    await expect(sectionMenu(page)).toBeHidden();
  } finally {
    await page.request.post(SERVERS.demo + '/clear').catch(() => undefined);
  }
});

test('feature 2: the row read aloud', async ({ page }) => {
  await page.goto(SIM);
  await expect(sections(page)).toBeVisible();
  await expect(sectionLink(page, 'Run')).toHaveAttribute('aria-current', 'page');
  await expect(sectionLink(page, 'Watch')).toBeVisible();
  await expect(sectionLink(page, 'Reports')).toBeVisible();
  const key = sections(page).getByRole('button', { name: 'More', exact: true });
  await expect(key).toHaveAttribute('aria-haspopup', 'menu');
  await expect(key).toHaveAttribute('aria-expanded', 'false');
});

test('feature 2: large text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(SIM);
  await expect(sections(page)).toBeVisible();
  await scaleText(page, 2);
  await expect(sections(page)).toHaveAttribute('data-row-fold', '1');
  await expect(sectionLink(page, 'Reports')).toHaveCount(0);
  await expect(sections(page).getByRole('button', { name: 'Next sections' })).toHaveCount(0);
  await expect.poll(() => spacingFaults(sections(page))).toEqual({ cut: [], overlaps: [] });
  await more(page).click();
  await expect(sectionMenu(page).getByRole('menuitem').first()).toHaveAccessibleName('Reports');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(sections(page)).toBeVisible();
  await scaleText(page, 4);
  const nav = sections(page);
  await expect(nav).toHaveAttribute('data-row-fold', '2');
  await expect.poll(() => nav.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(element).getPropertyValue('--frame-side-padding'));
    return { left: bounds.left, right: bounds.right, columnRight: window.innerWidth - padding, padding };
  })).toMatchObject({ left: 16, right: 304, columnRight: 304, padding: 16 });
  const previous = nav.getByRole('button', { name: 'Previous sections' });
  const next = sections(page).getByRole('button', { name: 'Next sections' });
  const row = nav.locator('[data-fade-end]');
  await expect.poll(() => row.evaluate(element => element.clientWidth)).toBeGreaterThan(0);
  await expect.poll(() => row.evaluate(element => element.scrollLeft)).toBe(0);
  await expect.poll(() => row.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(1);
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  for (const key of [previous, next]) expect(await key.boundingBox()).toMatchObject({ width: 44, height: 44 });
  const scroll = () => row.evaluate(element => element.scrollLeft / element.clientWidth);
  await next.click();
  await expect.poll(scroll).toBeGreaterThan(0.7);
});

test('feature 3: no old words from the header down', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(SIM);
  const heading = page.getByRole('heading', { name: 'Other scenarios' });
  await expect(heading).toBeAttached();
  const words = await heading.evaluate(end => {
    const range = document.createRange();
    range.setStartBefore(document.querySelector('[role=banner]')!);
    range.setEndAfter(end.closest('section') ?? end);
    const fragment = range.cloneContents();
    fragment.querySelectorAll('[data-testid="leader-orders"], [data-testid="hexaco-note"], [hidden], [aria-hidden=true], .sr-only')
      .forEach(element => element.remove());
    return fragment.textContent ?? '';
  });
  expect(words).not.toMatch(/\b(HEXACO|typed world|LLM|actor|seed|compile|Quickstart)\b/i);
});

test('the banner holds eight controls on the idle first screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SIM);
  await expect(banner(page).getByRole('link').or(banner(page).getByRole('button'))).toHaveCount(7);
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveCount(1);
});

test('reduced motion: MORE and the row move at once', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(SIM);
  await more(page).click();
  const menu = sectionMenu(page);
  await expect(menu).toHaveCSS('opacity', '1');
  expect(await menu.evaluate(element => element.getAnimations().length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(more(page)).toBeFocused();
  await home(page).focus();
  await scaleText(page, 4);
  const next = sections(page).getByRole('button', { name: 'Next sections' });
  await expect(next).toBeEnabled();
  const left = await next.evaluate(key => {
    (key as HTMLButtonElement).click();
    return key.parentElement!.querySelector('[data-fade-end]')!.scrollLeft;
  });
  expect(left).toBeGreaterThan(0);
});

const tabScripts = '**/assets/*.js';
const tabFailure = 'This tab did not load.';
const tabOffline = 'You are offline. This tab loads when you are back online.';
const emptyTitle = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });
const goToRun = (page: Page) => page.getByRole('link', { name: 'Go to Run', exact: true });

test('feature 2: Watch and Reports with no run', async ({ page }) => {
  for (const width of [390, 1440]) {
    for (const look of LOOKS) {
      await test.step(width + ' px, ' + look, async () => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: look });
        await page.goto(SIM);

        await openTab(page, 'sim');
        await expect(emptyTitle(page, 'No run yet.')).toBeVisible();
        const watch = page.getByRole('region', { name: 'Watch', exact: true });
        await expect(watch).toContainText('Set up a run on the Run tab, then press Start. The run shows here, turn by turn.');
        const line = watch.getByTestId('empty-run-line');
        await expect(line).toHaveAttribute('aria-hidden', 'true');
        await expect(line.locator('li')).toHaveCount(6);
        await expect(line).toContainText('Verdict');
        await expect(watch.getByRole('button', { name: /^(Start|Run|Launch)\b/i })).toHaveCount(0);
        await expect(watch.getByText(/guided tour/i)).toHaveCount(0);
        expect((await goToRun(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await goToRun(page).click();
        await expect(page.getByTestId('run-first-screen')).toBeVisible();
        await expect(sectionLink(page, 'Run')).toHaveAttribute('aria-current', 'page');

        await openTab(page, 'reports');
        await expect(emptyTitle(page, 'No report yet.')).toBeVisible();
        const reports = page.getByRole('region', { name: 'Reports', exact: true });
        await expect(reports).toContainText('A report is written when a run ends: a verdict for a pair, a ranking by quarters for 3 or more leaders.');
        const tracks = reports.getByTestId('empty-score-tracks');
        await expect(tracks).toHaveAttribute('aria-hidden', 'true');
        await expect(tracks.locator('li')).toHaveCount(4);
        await expect(reports.getByRole('button', { name: /^(Start|Run|Launch)\b/i })).toHaveCount(0);
        await expect(reports.getByText(/guided tour/i)).toHaveCount(0);
        await goToRun(page).click();
        await expect(page.getByTestId('run-first-screen')).toBeVisible();
      });
    }
  }
});

test('feature 2: Watch your last run again', async ({ page }) => {
  const launchPaths: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/setup' || path.startsWith('/api/quickstart')) launchPaths.push(path);
  });
  for (const [width, look, tab] of [[390, 'light', 'sim'], [1440, 'dark', 'reports']] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: look });
    await page.goto(SERVERS.replay + '/sim');
    // The Run screen reads its own scenario before the replay action.
    await expect(page.getByTestId('scenario-figures')).toBeVisible();
    await openTab(page, 'sim');
    const replay = page.getByRole('link', { name: 'Watch your last run again', exact: true });
    for (const target of ['sim', 'reports'] as const) {
      await openTab(page, target);
      await expect(replay).toBeVisible();
      const box = (await replay.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual((await goToRun(page).boundingBox())!.y + 44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await openTab(page, tab);
    const href = (await replay.getAttribute('href'))!;
    expect(new URL(href, page.url()).searchParams.get('replay')).toBeTruthy();
    launchPaths.length = 0;
    await replay.click();
    await expect(replayStatus(page)).toBeVisible();
    await expect(page.getByTestId('watch-grid-panel')).toHaveCount(2);
    expect(launchPaths).toEqual([]);
  }
});

test('feature 2: a tab that did not load, and Try again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SIM);
  await expect(start(page)).toBeVisible();
  await page.route(tabScripts, route => route.abort());
  await openTab(page, 'reports');
  await expect(sections(page)).toBeVisible();
  const problem = page.getByRole('status').filter({ hasText: tabFailure });
  await expect(problem).toBeVisible();
  await expect(problem.locator('svg[aria-hidden="true"]')).toBeVisible();
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  const box = (await retry.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(96);

  await page.unroute(tabScripts);
  await page.route(tabScripts, async route => {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    await route.continue();
  });
  const reportAssets: number[] = [];
  page.on('response', response => {
    if (/\/assets\/ReportView-[^/]+\.js$/.test(new URL(response.url()).pathname)) {
      reportAssets.push(response.status());
    }
  });
  await retry.click();
  await expect(page.getByRole('button', { name: 'Trying…', exact: true })).toBeDisabled();
  await expect.poll(() => reportAssets, { message: 'Reports retries the built script on the dashboard server' }).toContain(200);
  await expect(emptyTitle(page, 'No report yet.')).toBeVisible();
});

test('feature 2: a slow tab shows its shapes, offline says so', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [i, look] of LOOKS.entries()) {
    await page.emulateMedia({ colorScheme: look });
    await page.goto(SIM);
    await expect(start(page)).toBeVisible();
    if (i === 0) {
      await page.route(tabScripts, async route => {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        await route.continue();
      });
      await openTab(page, 'reports');
      await expect(page.getByTestId('tab-loading')).toBeVisible();
      await expect(sections(page).getByRole('link')).toHaveText(['Run', 'Watch', 'Reports'], { ignoreCase: true });
      await expect(more(page)).toHaveAccessibleName('More', { ignoreCase: true });
      await expect(emptyTitle(page, 'No report yet.')).toBeVisible();
      await page.unroute(tabScripts);
    }
    await openTab(page, 'sim');
    await expect(emptyTitle(page, 'No run yet.')).toBeVisible();
    await openTab(page, 'quickstart');
    await context.setOffline(true);
    try {
      await openTab(page, 'sim');
      await expect(emptyTitle(page, 'No run yet.')).toBeVisible();
      await openTab(page, 'quickstart');
      await expect(page.getByTestId('run-first-screen')).toBeVisible();
      await openTab(page, 'library');
      const problem = page.getByRole('status').filter({ hasText: tabOffline });
      await expect(problem).toBeVisible();
      await expect(problem.locator('svg[aria-hidden="true"]')).toBeVisible();
      if (i === 1) await page.route(tabScripts, route => route.abort());
    } finally {
      await context.setOffline(false);
    }
    if (i === 0) {
      await expect(page.getByRole('heading', { name: 'Saved runs', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('status').filter({ hasText: tabFailure })).toBeVisible();
      const retry = page.getByRole('button', { name: 'Try again', exact: true });
      await retry.click();
      await expect(retry).toBeEnabled();
      await expect(page.getByRole('status').filter({ hasText: tabFailure })).toBeVisible();
      await page.unroute(tabScripts);
    }
  }
});

test('feature 2: nothing refused at the day’s limit', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [i, look] of LOOKS.entries()) {
    await page.emulateMedia({ colorScheme: look });
    await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.' + (104 + i + info.retry * 2) });
    await page.goto(demo);
    await expect(start(page)).toBeEnabled();
    try {
      await start(page).click();
      await expect(page.getByTestId('watch-grid-panel')).toHaveCount(2);
    } finally {
      await page.request.post(SERVERS.demo + '/clear').catch(() => undefined);
    }
    await page.goto(demo);
    await expect(visitor(page)).toHaveText('No free run', { useInnerText: true });
    for (const [tab, name] of [['sim', 'Watch'], ['reports', 'Reports'], ['quickstart', 'Run']] as const) {
      await openTab(page, tab);
      await expect(page.getByRole('main', { name, exact: true })).toBeVisible();
    }
    await more(page).click();
    await expect(sectionMenu(page)).toBeVisible();
    await menuItem(page, 'Library').click();
    await expect(page.getByRole('heading', { name: 'Saved runs', exact: true })).toBeVisible();
  }
});

test('legal L8: the run screen’s event label reads 4.5 to 1', async ({ page }) => {
  await page.goto(SERVERS.replay + '/sim?tab=library');
  const href = await savedPair(page).getAttribute('href');
  expect(href).toBeTruthy();
  for (const width of [390, 1440]) {
    for (const look of LOOKS) {
      await test.step(width + ' px, ' + look, async () => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: look });
        await page.goto(new URL(href!, page.url()).href);
        await expect(replayStatus(page)).toBeVisible();
        const chips = page.locator('[class*="compactCrisis"], [class*="chipCrisis"]');
        await expect(chips.first()).toBeVisible();
        for (const chip of await chips.all()) {
          const words = await measureText(page, chip);
          expect(words.length).toBeGreaterThan(0);
          for (const word of words) expect(word.ratio, word.selector).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

test('sweep: the frame at 320, 390 and 1,440 px in both looks', async ({ page }) => {
  test.setTimeout(240_000);
  const layoutExpect = expect.configure({ soft: true });
  const foot = page.getByRole('contentinfo');
  const chrome = ['[role="banner"]', '[role="contentinfo"]'];
  const menu = '[role="menu"][aria-label="Sections"]';
  const tabs = [
    ['quickstart', 'Run'], ['sim', 'Watch'], ['reports', 'Reports'], ['library', 'Library'],
  ] as const;

  for (const look of LOOKS) {
    await page.emulateMedia({ colorScheme: look, reducedMotion: 'reduce' });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [tab, name] of tabs) {
        await test.step(`${name}, ${width} px, ${look}`, async () => {
          await page.goto(`${demo}?tab=${tab}`);
          await expect(visitor(page)).toHaveText(width < 600 ? '1 free run' : 'Free demo: 1 run left today', { useInnerText: true });
          await expect(page.getByRole('main', { name, exact: true })).toBeVisible();
          expect(await lookOf(page)).toEqual(EXPECTED_LOOK[look]);
          expect.soft(await rowsOnOneRow(page)).toEqual([]);
          await expect(banner(page).locator('img')).toHaveAttribute('src', '/favicon.svg');
          await expect(banner(page).locator('picture, canvas, video')).toHaveCount(0);
          await expect(foot.locator('img, picture, canvas, video')).toHaveCount(0);

          await foot.scrollIntoViewIfNeeded();
          for (const root of chrome) {
            expect.soft(await measureReadability(page, root), root).toEqual([]);
            expect.soft(await axeFindings(page, root), root).toEqual([]);
          }

          await more(page).click();
          await expect(sectionMenu(page)).toBeVisible();
          // At phone widths the menu puts the description below each key's name.
          if (width === 1440) expect.soft(await rowsOnOneRow(page)).toEqual([]);
          await expect(sectionMenu(page).locator('img, picture, canvas, video')).toHaveCount(0);
          expect.soft(await measureReadability(page, menu)).toEqual([]);
          expect.soft(await axeFindings(page, menu)).toEqual([]);
          await layoutExpect.poll(() => page.evaluate(() => {
            const root = document.documentElement;
            return root.scrollWidth - root.clientWidth;
          })).toBeLessThanOrEqual(1);

          await page.keyboard.press('Escape');
          await expect(sectionMenu(page)).toHaveCount(0);
          await scaleText(page, 2);
          for (const row of [banner(page), sections(page), foot]) {
            await layoutExpect.poll(() => spacingFaults(row)).toEqual({ cut: [], overlaps: [] });
          }
          const nav = sections(page);
          if (await nav.getByRole('button', { name: 'Next sections', exact: true }).isVisible()) {
            const viewport = nav.locator('[data-fade-start][data-fade-end]');
            for (const key of await viewport.locator(':scope > :is(a, button):visible').all()) {
              await key.scrollIntoViewIfNeeded();
              const [box, view] = await Promise.all([key.boundingBox(), viewport.boundingBox()]);
              expect(box!.x).toBeGreaterThanOrEqual(view!.x - 1);
              expect(box!.x + box!.width).toBeLessThanOrEqual(view!.x + view!.width + 1);
              expect(await spacingFaults(key)).toEqual({ cut: [], overlaps: [] });
            }
          }
        });
      }
    }
  }
});

test('pictures', async ({ browser }, info) => {
  test.setTimeout(120_000);
  for (const [lookIndex, look] of LOOKS.entries()) {
    for (const [widthIndex, width] of [390, 1440].entries()) {
      await test.step(`${width} px, ${look}`, async () => {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 2,
          colorScheme: look,
          reducedMotion: 'reduce',
          extraHTTPHeaders: { 'x-real-ip': `192.0.2.${120 + lookIndex * 2 + widthIndex + info.retry * 4}` },
        });
        const page = await context.newPage();
        const capture = async (state: string) => {
          await expect(page.locator('#pcc')).toBeHidden();
          await page.screenshot({
            path: `test-pictures/sim-frame/${width}-${look}-${state}.png`,
            animations: 'disabled',
          });
        };

        try {
          await page.goto(demo);
          await page.getByRole('button', { name: 'Reject all', exact: true }).click();
          await expect(start(page)).toBeEnabled();
          await expect(visitor(page)).toHaveText(width < 600 ? '1 free run' : 'Free demo: 1 run left today', { useInnerText: true });
          await expect(page.getByTestId('scenario-figures')).toBeVisible();
          await capture('free-run');

          await more(page).click();
          await expect(sectionMenu(page)).toBeVisible();
          await capture('more');
          await page.keyboard.press('Escape');

          await openTab(page, 'sim');
          await expect(emptyTitle(page, 'No run yet.')).toBeVisible();
          await capture('empty-watch');

          const foot = page.getByRole('contentinfo');
          await foot.scrollIntoViewIfNeeded();
          await expect(foot).toBeInViewport({ ratio: 1 });
          await expect(foot.getByRole('button', { name: 'Analytics choices', exact: true })).toBeInViewport({ ratio: 1 });
          await capture('foot');

          await page.route(tabScripts, route => route.abort());
          await openTab(page, 'reports');
          await expect(page.getByRole('status').filter({ hasText: tabFailure })).toBeVisible();
          await capture('tab-did-not-load');
          await page.unroute(tabScripts);

          await openTab(page, 'quickstart');
          await expect(start(page)).toBeEnabled();
          try {
            await start(page).click();
            await expect(page.getByTestId('watch-grid-panel')).toHaveCount(2);
          } finally {
            await page.request.post(SERVERS.demo + '/clear').catch(() => undefined);
          }
          await page.goto(demo);
          await expect(visitor(page)).toHaveText(width < 600 ? 'No free run' : 'Free demo: no run left today', { useInnerText: true });
          await capture('no-free-run');
        } finally {
          await context.close();
        }
      });
    }
  }
});

/**
 * Sets every text size to the page's own times `factor`, from the sizes it
 * had before any scaling. The reset and the new sizes land in one task, so
 * the rows never measure the unscaled page in between.
 */
async function setTextScale(page: Page, factor: number): Promise<void> {
  await page.evaluate((scale) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('body, body *'));
    for (const element of elements) {
      element.style.removeProperty('font-size');
      element.style.removeProperty('line-height');
    }
    if (scale === 1) return;
    const sizes = elements.map(element => {
      const style = getComputedStyle(element);
      return { element, fontSize: parseFloat(style.fontSize), lineHeight: style.lineHeight };
    });
    for (const { element, fontSize, lineHeight } of sizes) {
      if (Number.isFinite(fontSize)) element.style.setProperty('font-size', fontSize * scale + 'px', 'important');
      if (lineHeight.endsWith('px')) element.style.setProperty('line-height', parseFloat(lineHeight) * scale + 'px', 'important');
    }
  }, factor);
}

test('feature 2: the More menu closes when the row refolds', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(SIM);
  await expect(sections(page)).toBeVisible();
  await scaleText(page, 2);
  await expect(sections(page)).toHaveAttribute('data-row-fold', '1');
  await more(page).focus();
  await page.keyboard.press('Enter');
  await expect(sectionMenu(page).getByRole('menuitem').first()).toBeFocused();
  await setTextScale(page, 1);
  await expect(sections(page)).toHaveAttribute('data-row-fold', '0');
  await expect(sectionMenu(page)).toHaveCount(0);
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(more(page)).toBeFocused();
});

test('feature 2: the More menu follows its key when the row scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(SIM);
  await expect(sections(page)).toBeVisible();
  await scaleText(page, 4);
  const nav = sections(page);
  await expect(nav).toHaveAttribute('data-row-fold', '2');
  await more(page).click();
  await expect(sectionMenu(page)).toBeVisible();
  const row = nav.locator('[data-fade-end]');
  const before = await more(page).evaluate(key => key.getBoundingClientRect().left);
  // A wheel or a swipe moves the row without a press on More.
  await row.evaluate(element => { element.scrollLeft = 0; });
  await expect.poll(() => more(page).evaluate(key => key.getBoundingClientRect().left)).not.toBe(before);
  await expect(sectionMenu(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Sections"]');
    const key = document.querySelector('nav[aria-label="Sections"] [data-more-label]')?.closest('button');
    if (!menu || !key) return Number.NaN;
    return Math.abs(parseFloat(menu.style.getPropertyValue('--more-anchor-left')) - key.getBoundingClientRect().left);
  })).toBeLessThanOrEqual(1);
});

test('feature 2: a tab whose stylesheet did not load, and Try again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SIM);
  await expect(start(page)).toBeVisible();
  const refused: string[] = [];
  const styles = '**/assets/*.css';
  await page.route(styles, route => {
    refused.push(route.request().url());
    return route.abort();
  });
  await openTab(page, 'studio');
  await expect(page.getByRole('status').filter({ hasText: tabFailure })).toBeVisible();
  expect(refused.length).toBeGreaterThan(0);
  await page.unroute(styles);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: tabFailure })).toHaveCount(0);
  // Studio shows with every stylesheet it asked for loaded, not unstyled.
  await expect.poll(() => page.evaluate(urls => urls.every(url => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .some(link => link.href === url && link.sheet !== null)), refused)).toBe(true);
});

test('feature 13: a More links item that opens a new tab leaves focus on More links', async ({ page, context }) => {
  await context.route(/^https:\/\/(github\.com|www\.npmjs\.com)\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(SIM);
  const nav = page.getByRole('contentinfo').getByRole('navigation', { name: 'Site links' });
  await expect(nav).toBeVisible();
  await scaleText(page, 2);
  const key = nav.getByRole('button', { name: 'More links' });
  await key.focus();
  await page.keyboard.press('Enter');
  const github = nav.getByRole('menuitem', { name: 'GitHub', exact: true });
  await github.focus();
  const opened = context.waitForEvent('page');
  await page.keyboard.press('Enter');
  await (await opened).close();
  await expect(nav.getByRole('menu')).toHaveCount(0);
  await expect(key).toBeFocused();
});

test('feature 13: an open More links menu stays open when the row folds further', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(SIM);
  const nav = page.getByRole('contentinfo').getByRole('navigation', { name: 'Site links' });
  await expect(nav).toHaveAttribute('data-row-fold', '0');
  const foldAt = async (target: string, from: number): Promise<number> => {
    for (let factor = from; factor <= 4; factor = Math.round((factor + 0.05) * 100) / 100) {
      await setTextScale(page, factor);
      // The row measures its fit on the next frames.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await nav.getAttribute('data-row-fold') === target) return factor;
    }
    throw new Error('The foot never folded to ' + target);
  };
  const one = await foldAt('1', 1.05);
  await nav.getByRole('button', { name: 'More links' }).focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('menuitem').first()).toBeFocused();
  await foldAt('2', one + 0.05);
  await expect(nav.getByRole('menu')).toBeVisible();
  await expect(nav.getByRole('menuitem').first()).toBeFocused();
});

test('the run actions menu moves by its arrow keys', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.goto(SERVERS.replay + '/sim');
  await expect(page.getByTestId('scenario-figures')).toBeVisible();
  await openTab(page, 'sim');
  await page.getByRole('link', { name: 'Watch your last run again', exact: true }).click();
  await expect(replayStatus(page)).toBeVisible();
  await banner(page).getByRole('button', { name: 'Open run actions menu' }).click();
  const items = banner(page).getByRole('menu').getByRole('menuitem');
  const count = await items.count();
  expect(count).toBeGreaterThan(1);
  await items.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(count - 1)).toBeFocused();
  // Tab leaves the menu, as it leaves the More menu: closed, focus on its key.
  await page.keyboard.press('Tab');
  await expect(banner(page).getByRole('menu')).toHaveCount(0);
  await expect(banner(page).getByRole('button', { name: 'Open run actions menu' })).toBeFocused();
});

test('feature 2: two tabs that retry while one stylesheet still loads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SIM);
  await expect(start(page)).toBeVisible();
  const assets = '**/assets/*.{js,css}';
  await page.route(assets, route => route.abort());
  for (const tab of ['studio', 'library'] as const) {
    await openTab(page, tab);
    await expect(page.getByRole('status').filter({ hasText: tabFailure })).toBeVisible();
  }
  await page.unroute(assets);
  // The stylesheets answer slowly. Opening a tab that failed retries it, so
  // Library retries while Studio's stylesheet is still on its way.
  await page.route('**/assets/*.css', async route => {
    await new Promise(resolve => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await openTab(page, 'studio');
  await expect(page.getByTestId('tab-loading')).toBeVisible();
  await openTab(page, 'library');
  await expect(page.getByRole('heading', { name: 'Saved runs', exact: true })).toBeVisible({ timeout: 20_000 });
  await openTab(page, 'studio');
  await expect(page.getByRole('status').filter({ hasText: tabFailure })).toHaveCount(0);
  await expect(page.getByTestId('tab-loading')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('main', { name: 'Studio', exact: true })).toBeVisible();
});

test('feature 1: a key saved in Settings shows in the header at once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.goto(SIM + '?tab=settings');
  const field = page.locator('#key-openai');
  await expect(field).toBeVisible();
  await expect(visitor(page)).not.toHaveText('Your API key', { useInnerText: true });
  await field.fill('visitor-key-header-fixture');
  await expect(visitor(page)).toHaveText('Your API key', { useInnerText: true });
});

test('Settings opens where the browser refuses local storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage unavailable', 'SecurityError'); },
    });
  });
  await page.goto(SIM + '?tab=settings');
  await expect(page.getByRole('group', { name: 'Stored data' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Stored data' }).getByRole('button', { name: 'Clear local data' })).toBeVisible();
});

test('a Restore while a started run has sent nothing yet asks first', async ({ page }) => {
  await page.goto(SERVERS.replay + '/sim?tab=library');
  await savedPair(page).click();
  await expect(runStatus(page).getByRole('status', { name: /^Simulation status: Complete/ })).toBeVisible();
  // Start was pressed and the page moved on, and the run's first frame has not come.
  await page.route('**/events', () => undefined);
  await page.evaluate(() => localStorage.setItem('paracosm:launchPending', '1'));
  await page.goto(SERVERS.replay + '/sim?tab=library');
  const restore = page.getByRole('region', { name: 'Kept in this browser' })
    .getByRole('button', { name: 'Restore', exact: true }).first();
  await expect(restore).toBeVisible();
  const question = page.waitForEvent('dialog', { timeout: 10_000 });
  const answer = question.then(dialog => dialog.dismiss());
  await restore.click();
  expect((await question).message()).toBe('Replace the run on screen with this one?');
  await answer;
  await expect(page).toHaveURL(/[?&]tab=library/);
});

test('Delete server data appears once a failed admin read is answered, with Settings open', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('paracosm:adminToken', 'e2e-admin-token'));
  let failing = true;
  let held = 0;
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/admin-config', async route => {
    if (!failing) return route.continue();
    held += 1;
    await released;
    await route.fulfill({ status: 503, json: { error: 'unavailable' } });
    held -= 1;
  });
  await page.goto(SERVERS.admin + '/sim?tab=settings');
  const stored = page.getByRole('group', { name: 'Stored data' });
  await expect(stored.getByRole('button', { name: 'Clear local data' })).toBeVisible();
  // The page's reads fail after the Settings controls are on screen.
  await expect.poll(() => held).toBeGreaterThan(0);
  release();
  await expect.poll(() => held).toBe(0);
  failing = false;
  await expect(stored.getByRole('button', { name: 'Delete server data' })).toBeVisible({ timeout: 20_000 });
});
