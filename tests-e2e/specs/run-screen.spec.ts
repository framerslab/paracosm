import { mkdir } from 'node:fs/promises';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { openTab, waitForRunConnection } from '../support/frame.js';
import { watchPairReplay, type WatchPhase } from '../support/watch-pair-frames.js';
import { pressStart } from '../support/start-run.js';

const host = 'http://127.0.0.1:3476';
const base = 'http://127.0.0.1:3478';
const pictures = 'test-pictures/run-screen-a';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The pair screen uses its own fixture server.');
test.describe.configure({ mode: 'serial' });

async function openPair(browser: Browser, origin: string, width: number, look: string, visitor: number, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  const context = await browser.newContext({
    baseURL: origin, viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 2, reducedMotion,
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
  await expect(page).toHaveURL(/[?&]tab=sim\b/);
  let runKey = '';
  await expect.poll(async () => {
    const current = await page.request.get('/results');
    if (!current.ok()) return false;
    const run = await current.json() as { runKey?: string };
    runKey = run.runKey ?? '';
    return Boolean(runKey);
  }).toBe(true);
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
      .map(element => ({
        tag: element.tagName,
        class: element.getAttribute('class'),
        label: element.getAttribute('aria-label'),
        text: element.textContent?.trim().slice(0, 80),
      }));
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
          await expect(pick('2 Dietrich Voss')).toHaveAttribute('aria-pressed', 'true');
          await expect(grid.getByTestId('watch-grid-panel').nth(1)).toBeVisible();
          await expect.poll(() => tones(pick('2 Dietrich Voss'))).toEqual(selected);
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
        if (width >= 768) {
          const featured = grid.getByTestId('watch-grid-panel').nth(1).getByRole('button', { name: /^Spotlight:/ }).first();
          await expect(featured).toBeVisible();
          expect(await featured.evaluate(element => {
            const ink = document.createElement('span');
            ink.style.color = 'var(--text-1)';
            element.append(ink);
            const expected = getComputedStyle(ink).color;
            ink.remove();
            return getComputedStyle(element.querySelector('[aria-hidden]')!).color === expected;
          })).toBe(true);
        }
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
        const history = watch.locator('.sim-columns');
        expect((await history.boundingBox())?.height).toBeGreaterThan(0);
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

async function loadPairRecording(page: Page, turns: number, stopped = false) {
  const preview = page.getByRole('dialog', { name: 'Load simulation' });
  await expect(async () => {
    await page.evaluate(text => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'saved-pair.json', { type: 'application/json' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        window.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    }, JSON.stringify(watchPairReplay(turns, stopped)));
    await expect(preview).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await preview.getByRole('button', { name: /^(Load|Load anyway|Replace current simulation)$/ }).click();
  await expect(preview).toHaveCount(0);
}

test('one playhead follows the pair from Watch into Viz', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const { page, context, runKey } = await openPair(browser, host, 1440, 'dark', 40 + info.retry, 'no-preference');
  const watch = page.locator('#tabpanel-sim');
  const line = page.getByRole('slider', { name: 'Run line' });
  const turn = (value: number) => expect(line).toHaveAttribute('aria-valuenow', String(value));
  const key = (name: string | RegExp) => watch.getByRole('button', { name });
  const mark = (value: number) => line.locator(`[data-run-mark="${value}"]`);
  const fields = (root: Locator, value: number) => root.getByRole('img', { name: new RegExp(`colony, turn ${value}\\b`, 'i') });
  const sendTurn = async (n: number) => {
    for (const phase of ['crisis', 'departments', 'decisions'] as const) await release(page, runKey, phase, n);
  };
  const pace = async (speed: string) => {
    await key(/^Speed,/).click();
    await expect(watch.getByRole('menu', { name: 'Pace of the turns that have arrived' })).toBeVisible();
    await watch.getByRole('menuitemradio', { name: speed, exact: true }).click();
    await expect(key(`Speed, ${speed}`)).toBeFocused();
  };
  try {
    await expect(line).toHaveAttribute('aria-valuenow', '0');
    await expect(mark(1)).toHaveAttribute('data-pending', 'true');
    await expect(key('Back')).toBeDisabled();
    await sendTurn(1);
    await turn(1);
    await expect(mark(1)).toHaveAttribute('data-selected', 'true');
    for (const n of [2, 3]) await sendTurn(n);
    await turn(3);
    await expect(mark(4)).toHaveAttribute('data-pending', 'true');
    await expect(mark(3)).toHaveAttribute('data-selected', 'true');
    await expect(mark(3)).toHaveAttribute('title', 'Turn 3, 2051: Dust Season');
    await expect(mark(3)).toHaveAttribute('data-ai-generated', 'true');
    await expect(fields(watch, 3)).toHaveCount(2);
    await expect(watch.getByRole('region', { name: 'Leader statistics' }).getByText('430', { exact: true })).toBeVisible();

    await key('Pause').click();
    await expect(key('Play')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const canvas = fields(watch, 3).first();
    const frame = () => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
    const pausedFrame = await frame();
    await sendTurn(4);
    await turn(3);
    await expect(key('Turn 4 is in')).toBeEnabled();
    expect(await frame()).toBe(pausedFrame);
    await expect.poll(() => line.evaluate(slider => {
      const track = slider.querySelector(':scope > div[data-arrived]')!;
      const fill = getComputedStyle(track, '::after');
      const arrived = slider.querySelector('[data-run-mark="4"]')!.getBoundingClientRect();
      const fillEnd = track.getBoundingClientRect().left + Number.parseFloat(fill.left) + Number.parseFloat(fill.width);
      return Math.abs(fillEnd - (arrived.left + arrived.width / 2));
    })).toBeLessThanOrEqual(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await capture(page, 'after', 'held-1440-dark');
    await expect(watch.getByText('Turn 3: Ration the water for the greenhouse.', { exact: true }).first()).toBeVisible();
    await expect(fields(watch, 3)).toHaveCount(2);
    await expect(watch.getByRole('region', { name: 'Leader statistics' }).getByText('430', { exact: true })).toBeVisible();

    await openTab(page, 'viz');
    await expect(fields(page.locator('#tabpanel-viz'), 3)).toHaveCount(2);
    await openTab(page, 'sim');
    await turn(3);
    await expect(mark(3)).toHaveAttribute('data-selected', 'true');
    await page.reload();
    await turn(3);
    await expect(page).toHaveURL(/[?&]watchTurn=3\b/);
    await expect(fields(watch, 3)).toHaveCount(2);

    await context.setOffline(true);
    await line.focus();
    await line.press('Home');
    await turn(1);
    await expect(key('Back')).toBeDisabled();
    await line.press('ArrowRight');
    await turn(2);
    await context.setOffline(false);
    await expect(page.getByRole('main')).toHaveAttribute('data-run-connection', 'connected');
    await turn(2);

    await mark(1).click();
    await expect(watch.locator('#watch-turn-heading')).toBeFocused();
    const disclosure = key('Read the whole crisis').first();
    await disclosure.focus();
    await disclosure.press('Space');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(key('Play')).toBeVisible();
    await line.focus();
    await line.press('End');
    await turn(4);
    await expect(fields(watch, 4)).toHaveCount(1);
    await expect(fields(watch, 3)).toHaveCount(1);
    await expect(watch.getByText('Figure unavailable', { exact: true }).first()).toBeVisible();
    await expect(key('Forward')).toBeDisabled();

    for (const speed of ['0.5x', '4x', '2x', '1x']) await pace(speed);
    await page.clock.install();
    await line.press('Home');
    await turn(1);
    await key('Play').click();
    await page.clock.fastForward(29_000);
    await turn(1);
    await page.clock.fastForward(1_000);
    await turn(2);
    await key('Pause').click();
    await pace('2x');
    await key('Play').click();
    await page.clock.fastForward(14_000);
    await turn(2);
    await page.clock.fastForward(1_000);
    await turn(3);
    await key('Pause').click();
    await key('Turn 4 is in').click();
    await turn(4);
    await expect(key('Latest')).toBeDisabled();

    for (const width of [320, 360, 390, 430, 480, 600, 768, 1100, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const keys = await watch.locator('[data-watch-play-keys] button').evaluateAll(buttons =>
        buttons.map(button => button.getBoundingClientRect().toJSON() as DOMRect),
      );
      if (width < 768) {
        expect(keys).toHaveLength(5);
        expect(new Set(keys.map(box => box.y)).size).toBe(1);
        for (const box of keys) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }

    await sendTurn(5);
    await sendTurn(6);
    await turn(6);
    await key('Pause').click();
    await release(page, runKey, 'verdict');
    await expect(watch.getByText('The verdict is in. Press Latest to see it, or keep going and it follows turn 6.')).toBeVisible();
    await expect(watch.getByText('Stored water protected the colony.', { exact: true })).toHaveCount(0);
    await key('Latest').click();
    await expect(line).toHaveAttribute('aria-valuetext', 'Verdict');
    await expect(key('Back')).toHaveCount(0);
    await expect(key('Forward')).toHaveCount(0);
    await expect(key('Latest')).toHaveCount(0);
    await expect(watch.getByText('Stored water protected the colony.', { exact: true })).toBeVisible();
    await capture(page, 'after', 'finish-1440-dark');
    await key('Play from turn 1').click();
    await turn(1);
    await expect(key('Latest')).toHaveCount(0);
    await page.clock.fastForward(15_000);
    await turn(2);
    await key('Back').click();
    await turn(1);
  } finally {
    await page.request.post('/clear');
    await context.close();
  }

  const saved = await browser.newContext({ baseURL: host, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    const page = await saved.newPage();
    await page.goto('/sim?tab=sim');
    await waitForRunConnection(page);
    const reject = page.getByRole('button', { name: 'Reject all', exact: true });
    if (await reject.isVisible()) await reject.click();
    const line = page.getByRole('slider', { name: 'Run line' });
    for (const total of [12, 100]) {
      await loadPairRecording(page, total);
      await expect(line).toHaveAttribute('aria-valuetext', 'Verdict');
      await expect(line.locator('[data-run-mark]:not([data-run-mark="end"])')).toHaveCount(total);
      await expect(line.locator('[data-run-number]:visible')).toHaveCount(total === 100 ? 10 : total);
      await line.press('Home');
      await line.press('ArrowRight');
      await expect(line).toHaveAttribute('aria-valuenow', '2');
      await page.setViewportSize({ width: 390, height: 844 });
      await line.press('ArrowRight');
      await expect(line).toHaveAttribute('aria-valuetext', `Turn 3 of ${total} on screen`);
      await expect(line.locator('[data-run-number]:visible')).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await loadPairRecording(page, 3, true);
    await expect(line.locator('[data-run-mark="3"]')).toHaveAttribute('data-interrupted', 'true');
    await expect(line.locator('[data-run-mark]')).toHaveCount(3);
    await expect(line).toHaveAttribute('aria-valuenow', '3');
    await line.press('ArrowLeft');
    await expect(line).toHaveAttribute('aria-valuenow', '2');
    await line.press('ArrowRight');
    await expect(line).toHaveAttribute('aria-valuenow', '3');
  } finally {
    await saved.close();
  }
});
