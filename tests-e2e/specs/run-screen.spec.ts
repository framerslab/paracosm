import { mkdir } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { pressStart } from '../support/start-run.js';

const host = 'http://127.0.0.1:3476';
const base = 'http://127.0.0.1:3478';
const pictures = 'test-pictures/run-screen-a';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The pair screen uses its own fixture server.');
test.describe.configure({ mode: 'serial' });

async function openPair(browser: Browser, origin: string, width: number, look: string, visitor: number) {
  const context = await browser.newContext({
    baseURL: origin, viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 2, reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-real-ip': `192.0.2.${visitor}` },
  });
  await context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
  const page = await context.newPage();
  await page.goto('/sim?tab=quickstart');
  const reject = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await reject.isVisible()) await reject.click();
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/setup');
  await pressStart(page);
  const { runKey } = await (await accepted).json() as { runKey: string };
  expect(runKey).toBeTruthy();
  await expect(page).toHaveURL(/[?&]tab=sim\b/);
  return { page, context, runKey };
}

async function release(page: Page, runKey: string, phase: string, turn = 1) {
  const response = await page.request.post('/__watch_frames', { params: { runKey, phase, turn } });
  expect(response.status()).toBe(204);
}

async function capture(page: Page, side: 'before' | 'after', name: string) {
  const dir = `${pictures}/${side}`;
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

test('one turn compares the two decisions while they arrive', async ({ browser }, info) => {
  test.setTimeout(180_000);
  let visitor = 1 + 5 * info.retry;
  for (const look of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const suffix = `${width}-${look}`;
      if (process.env.WATCH_BASE_DIST) {
        const prior = await openPair(browser, base, width, look, visitor);
        try {
          for (const phase of ['crisis', 'departments', 'decisions']) await release(prior.page, prior.runKey, phase);
          await expect(prior.page.getByTestId('watch-grid-panel').first()).toBeVisible();
          await capture(prior.page, 'before', `playing-${suffix}`);
        } finally {
          await prior.page.request.post('/clear');
          await prior.context.close();
        }
      }
      const { page, context, runKey } = await openPair(browser, host, width, look, visitor++);
      try {
        const watch = page.locator('#tabpanel-sim');
        await release(page, runKey, 'crisis');
        await expect(watch.getByRole('region', { name: 'Turn 1 of 6', exact: true })).toBeVisible();
        await expect(watch.getByText('Crisis 3 of 3', { exact: true })).toBeVisible();
        await expect(watch.getByText('Deciding…', { exact: true }).first()).toBeVisible();
        await release(page, runKey, 'departments');
        await expect(watch.getByText('Medical is reporting.', { exact: true }).first()).toBeVisible();
        await release(page, runKey, 'decisions');

        const grid = watch.getByTestId('watch-grid');
        await expect(grid.getByTestId('watch-grid-panel').first()).toBeVisible();
        const pick = (place: string) => watch.getByRole('button', { name: place });
        if (width === 390) {
          await expect(grid.getByTestId('watch-grid-panel').nth(1)).toBeHidden();
          await pick('2 Dietrich Voss').click();
          await expect(grid.getByTestId('watch-grid-panel').nth(1)).toBeVisible();
          await expect(watch.getByText('Balanced leader.', { exact: false }).first()).toBeVisible();
          await pick('1 Aria Chen').click();
        } else {
          await expect(grid.getByTestId('watch-grid-panel').nth(1)).toBeVisible();
        }
        for (const text of ['RISKY WIN', 'SAFE WIN', 'RISKY LOSS', 'SAFE LOSS']) {
          await expect(watch.getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
        }
        for (const text of ['Bold leader.', 'Careful leader.', 'the water reserve was empty']) {
          await expect(watch.getByText(text, { exact: false }).first()).toBeVisible();
        }
        const choice = watch.getByText('Ration the water for the greenhouse.', { exact: true }).first();
        await expect(choice).toHaveAttribute('data-ai-generated', 'true');
        const crisis = watch.getByRole('button', { name: 'Read the whole crisis' }).first();
        await capture(page, 'after', `playing-${suffix}`);
        await crisis.click();
        await expect(crisis).toHaveAttribute('aria-expanded', 'true');
        await capture(page, 'after', `crisis-open-${suffix}`);

        if (width === 390) await pick('2 Dietrich Voss').click();
        await expect(watch.getByText('No decision came back for this crisis.', { exact: true })).toBeVisible();
        const log = watch.getByRole('link', { name: 'See the run’s log in Reports' });
        await log.focus();
        await log.press('Enter');
        await expect(page).toHaveURL(/[?&]tab=reports\b.*#turn-1$/);
        await expect(page.locator('#turn-1')).toBeFocused();
        await expect(page.getByText('AI-written', { exact: true })).toHaveCount(0);
      } finally {
        await page.request.post('/clear');
        await context.close();
      }
    }
  }
});
