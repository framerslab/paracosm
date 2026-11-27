import { mkdir } from 'node:fs/promises';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { openTab } from '../support/frame.js';
import type { WatchPhase } from '../support/watch-pair-frames.js';
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
  const response = await accepted;
  expect(response.ok()).toBe(true);
  const { runKey } = await response.json() as { runKey: string };
  expect(runKey).toBeTruthy();
  await expect(page).toHaveURL(/[?&]tab=sim\b/);
  return { page, context, runKey };
}

async function release(page: Page, runKey: string, phase: WatchPhase, turn = 1) {
  const response = await page.request.post('/__watch_frames', { params: { runKey, phase, turn } });
  expect(response.status()).toBe(204);
}

async function capture(page: Page, side: 'before' | 'after', name: string) {
  const dir = `${pictures}/${side}`;
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

const tones = (element: Locator) => element.evaluate(node => {
  const { color, backgroundColor, borderBlockEndColor, borderBlockStartColor } = getComputedStyle(node);
  return { color, backgroundColor, borderBlockEndColor, borderBlockStartColor };
});

async function expectInkOutsideCanvas(watch: Locator) {
  const offenders = await watch.evaluate(root => {
    const swatch = document.createElement('span');
    swatch.style.color = 'var(--eng)';
    root.append(swatch);
    const teal = getComputedStyle(swatch).color;
    swatch.remove();
    return Array.from(root.querySelectorAll('*'))
      .filter(element => element.tagName !== 'CANVAS' && element.getClientRects().length > 0)
      .filter(element => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor].includes(teal);
      })
      .map(element => element.tagName + ' ' + (element.getAttribute('class') ?? ''));
  });
  expect(offenders).toEqual([]);
}

test('one turn compares the two decisions while they arrive', async ({ browser }, info) => {
  test.setTimeout(240_000);
  let visitor = 1 + 5 * info.retry;
  for (const look of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const suffix = `${width}-${look}`;
      if (process.env.WATCH_BASE_DIST) {
        const prior = await openPair(browser, base, width, look, visitor);
        try {
          for (const phase of ['crisis', 'departments', 'decisions'] as const) await release(prior.page, prior.runKey, phase);
          await expect(prior.page.getByTestId('watch-grid-panel').first()).toBeVisible();
          await capture(prior.page, 'before', `playing-${suffix}`);
          await prior.page.locator('#turn-row-1').getByText('Landfall', { exact: true }).first().scrollIntoViewIfNeeded();
          await capture(prior.page, 'before', `crisis-open-${suffix}`);
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
          await pick('1 Aria Chen').focus();
          const selected = await tones(pick('1 Aria Chen'));
          await pick('2 Dietrich Voss').focus();
          await pick('2 Dietrich Voss').press('Enter');
          expect(await tones(pick('2 Dietrich Voss'))).toEqual(selected);
          await expect(grid.getByTestId('watch-grid-panel').nth(1)).toBeVisible();
          await expect(watch.getByText('Balanced leader.', { exact: false }).first()).toBeVisible();
          await pick('1 Aria Chen').click();
        } else {
          await expect(grid.getByTestId('watch-grid-panel').nth(1)).toBeVisible();
          const decisions = watch.getByRole('article', { name: /’s decision$/ });
          for (const ci of [0, 2]) {
            expect(await tones(decisions.nth(ci))).toEqual(await tones(decisions.nth(ci + 1)));
            expect(await tones(decisions.nth(ci).getByRole('img'))).toEqual(await tones(decisions.nth(ci + 1).getByRole('img')));
          }
        }
        await page.mouse.move(0, 0);
        await expectInkOutsideCanvas(watch);
        for (const text of ['RISKY WIN', 'SAFE WIN', 'RISKY LOSS', 'SAFE LOSS']) {
          await expect(watch.getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
        }
        for (const text of ['Bold leader.', 'Careful leader.', 'the water reserve was empty']) {
          await expect(watch.getByText(text, { exact: false }).first()).toBeVisible();
        }
        const choice = watch.getByText('Ration the water for the greenhouse.', { exact: true }).first();
        await expect(choice).toHaveAttribute('data-ai-generated', 'true');
        await expect(watch.getByText('RISKY: took the bold option.', { exact: false }).filter({ visible: true })).toHaveCount(1);
        await expect(watch.getByText('The bar comes from the leader’s traits', { exact: false }).filter({ visible: true })).toHaveCount(1);
        const reason = watch.getByRole('button', { name: 'Full reasoning and policies' }).first();
        await reason.click();
        await expect(watch.getByText('Retain a reserve', { exact: true }).filter({ visible: true })).toHaveAttribute('data-ai-generated', 'true');
        await reason.click();
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
        await openTab(page, 'sim');
        if (width === 390) await pick('1 Aria Chen').click();

        await release(page, runKey, 'result-first');
        await expect(watch.getByText('Bar 36', { exact: false }).first()).toBeVisible();
        await expect(watch.getByText('Bar 44', { exact: false })).toHaveCount(0);
        for (const phase of ['crisis', 'departments', 'decisions'] as const) await release(page, runKey, phase, 2);
        await expect(watch.getByText('Different crises this turn', { exact: true }).filter({ visible: true })).toHaveCount(2);
        await expect(watch.getByText('Bar 44', { exact: false }).first()).toBeVisible();
        await release(page, runKey, 'result-second');
        if (width === 390) await pick('2 Dietrich Voss').click();
        await expect(watch.getByText('Bar 44', { exact: false }).filter({ visible: true }).first()).toBeVisible();
        await expect(watch.getByRole('button', { name: 'What the stamps mean' }).first()).toBeVisible();

        await watch.getByRole('button', { name: 'Read all 2 turns at once' }).click();
        await expect(watch.locator('#turn-row-1')).toBeVisible();
        await expectInkOutsideCanvas(watch);
        await watch.getByRole('button', { name: 'Back to one turn at a time' }).click();
        await expect(watch.locator('#watch-turn-heading')).toBeFocused();
        await release(page, runKey, 'verdict');
        await expect(watch.getByText('Stored water protected the colony.', { exact: true })).toBeVisible();
        await expect(watch.getByRole('status', { name: 'Simulation verdict' })).toHaveCount(0);
        await expectInkOutsideCanvas(watch);
      } finally {
        await page.request.post('/clear');
        await context.close();
      }
    }
  }
});
