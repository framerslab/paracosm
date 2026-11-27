import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { measureReadability, rowsOnOneRow } from '../support/first-screen-measure.js';
import { openTab, scaleText, SERVERS } from '../support/frame.js';
import { FIGURES, measureText, saidOf, settle, spacingFaults } from '../support/readability.js';
import { startKey } from '../support/start-run.js';

const SERVER = SERVERS.demo;
const SLOT = 'paracosm:keyOverrides';
const FIELD_URL = '/sim?tab=settings&focus=api-key';
const REFUSED = 'Your API key was refused by its provider.';
const RETRY = 'Keys cleared from this tab. Select Forget my keys again to retry server cleanup.';
const CLEARED = 'Keys forgotten. Your held run and chat agents have been cleared.';
const PROVIDERS = ['openai', 'anthropic', 'serper', 'firecrawl', 'tavily', 'cohere'];
const SCENARIO_ID = 'key-refusal-fixture';
const field = (page: Page, provider = 'openai') => page.locator(`#key-${provider}`);
const keys = (page: Page) => page.getByRole('group', { name: 'API Keys', exact: true });
const saved = (page: Page) => keys(page).getByText('Key saved in this tab.', { exact: true });
const back = (page: Page) => keys(page).getByRole('link', { name: 'Back to Run', exact: true });
const recovery = (page: Page) => page.getByTestId('visitor-key-refusal');

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'These checks need the hosted fixture server.');
test.use({ baseURL: SERVER, deviceScaleFactor: 2 });

async function answerConsent(page: Page) {
  const reject = page.getByRole('button', { name: 'Reject all', exact: true });
  await reject.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await reject.isVisible()) await reject.click();
}

async function atLimit(page: Page) {
  await page.route('**/rate-limit', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), allowed: false, remaining: 0 } });
  });
}

async function openKeyLink(page: Page, link: Locator, provider: 'openai' | 'anthropic' = 'openai') {
  await link.focus();
  await expect(link).toBeFocused();
  await link.press('Enter');
  await expect(page).toHaveURL(provider === 'anthropic' ? /tab=settings&focus=api-key-anthropic$/ : /tab=settings&focus=api-key$/);
  await expect(field(page, provider)).toBeFocused();
}

test('key link focuses the mounted field', async ({ page }) => {
  await atLimit(page);
  await page.goto('/sim?size=2');
  await answerConsent(page);
  await openKeyLink(page, page.getByTestId('add-key-link'));
  await page.getByRole('tab', { name: 'Event Log', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Event Log', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/sub=log$/);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(field(page)).not.toBeFocused();

  await page.goto('/sim?tab=settings&focus=api-key&sub=log');
  await expect(field(page)).toBeFocused();
  await page.goto('/sim?tab=settings#key-openai');
  await expect(field(page)).toBeFocused();
  await openTab(page, 'quickstart');
  await openTab(page, 'settings');
  await expect(field(page)).toBeVisible();
  await expect(field(page)).not.toBeFocused();
  await expect(page).toHaveURL(/tab=settings$/);

  await openTab(page, 'quickstart');
  await openKeyLink(page, page.getByTestId('paste-at-limit').getByRole('link'));
});

test('a key field address is dropped on the Event Log and Settings stays open', async ({ page }) => {
  const log = page.getByRole('tab', { name: 'Event Log', exact: true });
  for (const [address, provider] of [['/sim?tab=settings#key-anthropic', 'anthropic'], ['/sim#key-openai', 'openai']] as const) {
    await page.goto(address);
    await answerConsent(page);
    await expect(field(page, provider)).toBeFocused();
    await log.click();
    await expect(log).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/sim\?tab=settings&sub=log$/);
    await page.reload();
    await expect(log).toHaveAttribute('aria-selected', 'true');
    await expect(field(page, provider)).toHaveCount(0);
  }
});

test('saved key returns to Run', async ({ page }) => {
  await atLimit(page);
  await page.goto('/sim?scenario=lunar-outpost&size=2&tab=settings&focus=api-key');
  await answerConsent(page);
  await field(page, 'serper').fill('fixture-search');
  await field(page).fill('sk-...');
  await expect(saved(page)).toHaveCount(0);
  await expect(back(page)).toHaveCount(0);

  await field(page, 'anthropic').fill('fixture-anthropic');
  await expect(saved(page)).toBeVisible();
  await expect(back(page)).toBeVisible();
  await back(page).press('Enter');
  await expect(page).toHaveURL(/scenario=lunar-outpost&size=2&tab=quickstart$/);
  await expect(startKey(page)).toBeEnabled();
  await expect(page.getByTestId('notice-pays')).toHaveText(
    'This run uses your Anthropic API key, and your provider bills you. Runs on your key skip the daily limit and do not use your free runs. They are not held to this demo’s size, so they can be larger than the free run.',
  );

  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage && key === 'paracosm:keyOverrides') {
        throw new DOMException('Storage blocked', 'SecurityError');
      }
      setItem.call(this, key, value);
    };
    sessionStorage.removeItem('paracosm:keyOverrides');
  });
  await page.goto(FIELD_URL);
  await field(page).fill('fixture-openai');
  await field(page).evaluate((input: HTMLInputElement) => input.blur());
  await expect(saved(page)).toHaveCount(0);
  await expect(back(page)).toHaveCount(0);
});

test('a key the tab could not save over a saved one is not called saved', async ({ page }) => {
  await page.goto(FIELD_URL);
  await answerConsent(page);
  await field(page).fill('fixture-openai');
  await expect(saved(page)).toBeVisible();
  await page.evaluate(slot => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage && key === slot) throw new DOMException('Storage blocked', 'SecurityError');
      setItem.call(this, key, value);
    };
  }, SLOT);
  await field(page).fill('fixture-openai-replaced');
  await field(page).evaluate((input: HTMLInputElement) => input.blur());
  await expect(saved(page)).toHaveCount(0);
  await expect(back(page)).toHaveCount(0);
});

test('Forget clears this tab and retries server cleanup', async ({ page, browser }) => {
  await page.addInitScript(slot => {
    if (sessionStorage.getItem('migration-fixture')) return;
    localStorage.setItem(slot, JSON.stringify({ openai: 'fixture-old-model', tavily: 'fixture-old-search' }));
    sessionStorage.setItem('migration-fixture', '1');
  }, SLOT);
  await page.goto(FIELD_URL);
  await answerConsent(page);
  const stored = () => page.evaluate(slot => ({
    local: localStorage.getItem(slot) !== null,
    tab: sessionStorage.getItem(slot) !== null,
  }), SLOT);
  await expect.poll(stored).toEqual({ local: false, tab: true });
  await expect(saved(page)).toBeVisible();
  await field(page).fill('fixture-openai');
  await field(page, 'serper').fill('fixture-search');
  const config = await page.request.get('/admin-config');
  expect(config.ok()).toBe(true);
  const { visitorKeyIdleMinutes: minutes } = await config.json();
  expect(minutes).toBeGreaterThan(0);
  const notes = keys(page).getByTestId('visitor-key-notes');
  await expect(notes.locator('p')).toHaveText([
    'Runs on your key are billed to your OpenAI or Anthropic account, under your agreement with them.',
    `We send your key to our server for each run and chat you start. It stays in our server's memory while they are in use, for ${minutes} minutes at most after you stop, and is never written to disk or to a log.`,
    'This browser tab keeps your key until you close it. "Forget my keys" removes it now.',
    'Use a separate key with a spending limit, and delete it at your provider when you are done.',
    'Or run paracosm on your own computer, and your key never leaves it.',
  ]);
  await expect(notes.getByRole('link')).toHaveAttribute('href', '/#get-started');
  for (const provider of PROVIDERS) {
    await expect(field(page, provider)).toHaveAttribute('type', 'password');
    await expect(field(page, provider)).toHaveAttribute('autocomplete', 'off');
    await expect(field(page, provider)).toHaveAttribute('data-clarity-mask', 'True');
    await expect(field(page, provider)).toHaveClass(/\bph-no-capture\b/);
    await expect(field(page, provider)).toHaveClass(/\bph-mask\b/);
  }

  const independent = await browser.newContext({ baseURL: SERVER });
  try {
    const other = await independent.newPage();
    await other.goto(FIELD_URL);
    await answerConsent(other);
    await field(other).fill('fixture-other-visitor');
    await expect(saved(other)).toBeVisible();
    const requests: boolean[] = [];
    let fail = false;
    let unblock = () => {};
    const pending = new Promise<void>(resolve => { unblock = resolve; });
    await page.route('**/forget-keys', async route => {
      requests.push(route.request().method() === 'POST' && route.request().postData() === null);
      if (!fail) return route.continue();
      await pending;
      return route.fulfill({ status: 503 });
    });
    const forget = keys(page).getByRole('button', { name: 'Forget my keys', exact: true });
    await forget.click();
    await expect(keys(page).getByText(CLEARED, { exact: true })).toBeVisible();
    expect(requests).toEqual([true]);
    for (const provider of PROVIDERS) await expect(field(page, provider)).toHaveValue('');
    expect(await stored()).toEqual({ local: false, tab: false });
    await expect(saved(page)).toHaveCount(0);
    await expect(back(page)).toHaveCount(0);
    await page.reload();
    await expect(field(page)).toHaveValue('');
    await expect(field(page, 'serper')).toHaveValue('');

    await field(page).fill('fixture-openai');
    await field(page, 'serper').fill('fixture-search');
    fail = true;
    await forget.click();
    try {
      await expect(forget).toBeDisabled();
      await expect(field(page)).toHaveValue('');
      await expect(field(page, 'serper')).toHaveValue('');
      expect(await stored()).toEqual({ local: false, tab: false });
      await expect(saved(page)).toHaveCount(0);
    } finally {
      unblock();
    }
    await expect(keys(page).getByText(RETRY, { exact: true })).toBeVisible();
    fail = false;
    await forget.click();
    await expect(keys(page).getByText(CLEARED, { exact: true })).toBeVisible();
    expect(requests).toEqual([true, true, true]);
    await other.reload();
    await expect(saved(other)).toBeVisible();
  } finally {
    await independent.close();
  }
});

async function openProviderFailure(page: Page, kind: 'auth' | 'quota', look = 'dark', provider: 'openai' | 'anthropic' = 'openai') {
  await page.addInitScript(({ expected, look }) => {
    localStorage.setItem('paracosm-theme', look);
    const NativeSource = window.EventSource;
    window.EventSource = class extends NativeSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener('sim', event => {
          const { type, data } = JSON.parse((event as MessageEvent<string>).data);
          if (type === 'provider_error' && data.kind === expected) {
            document.documentElement.dataset.testProviderError = expected;
          }
        });
      }
    };
  }, { expected: kind, look });
  await page.goto(FIELD_URL);
  await answerConsent(page);
  const scenario = { ...marsScenario, id: SCENARIO_ID };
  const stored = await page.request.post('/scenario/store', { data: { scenario } });
  expect(stored.ok()).toBe(true);
  expect((await stored.json()).switchable).toBe(true);
  const switched = await page.request.post('/scenario/switch', { data: { id: SCENARIO_ID } });
  expect(switched.ok()).toBe(true);
  await page.reload();
  // Each call must reach the provider wire, including retries and other pictures.
  const marker = `fixture-${provider}-${kind}:${randomUUID()}`;
  await field(page, provider).fill(marker);
  await openTab(page, 'quickstart');
  await expect(startKey(page)).toBeEnabled();
  let accepted: { ok: boolean; hasRunId: boolean; sentProviderKey: boolean } | undefined;
  await page.route('**/setup', async route => {
    const response = await route.fetch();
    const body = await response.json();
    accepted = {
      ok: response.ok(),
      hasRunId: typeof body.runKey === 'string' && body.runKey.length > 0,
      sentProviderKey: route.request().postDataJSON()[provider === 'anthropic' ? 'anthropicKey' : 'apiKey'] === marker,
    };
    await route.fulfill({ response });
  }, { times: 1 });
  await startKey(page).click();
  await expect.poll(() => accepted).toEqual({ ok: true, hasRunId: true, sentProviderKey: true });
  await expect(page).toHaveURL(/[?&]tab=sim(?:&|$)/);
  await expect(page.locator('html')).toHaveAttribute('data-test-provider-error', kind);
}

test('refused key opens the same field', async ({ page }) => {
  await openProviderFailure(page, 'auth');
  const alert = recovery(page);
  await expect(alert).toHaveText(/Your API key was refused by its provider\./);
  await expect(alert.getByText(REFUSED, { exact: true })).toBeVisible();
  await expect(alert.locator('[aria-hidden="true"]')).toHaveText('!');
  await openKeyLink(page, alert.getByRole('link', { name: 'Check it in Settings', exact: true }));

  await openProviderFailure(page, 'quota');
  await expect(page.getByRole('link', { name: 'Add credits →' })).toBeVisible();
  await expect(recovery(page)).toHaveCount(0);
  const replay = await page.request.get('http://127.0.0.1:3472/key-refusal-replay');
  expect(replay.ok()).toBe(true);
  const { id } = await replay.json();
  await page.goto(`/sim?tab=sim&replay=${id}`);
  await expect(page.getByRole('link', { name: 'Fix key →' })).toBeVisible();
  await expect(recovery(page)).toHaveCount(0);
});

test('refused Anthropic key opens the Anthropic field', async ({ page }) => {
  await openProviderFailure(page, 'auth', 'dark', 'anthropic');
  const alert = recovery(page);
  await expect(alert.getByText(REFUSED, { exact: true })).toBeVisible();
  await openKeyLink(page, alert.getByRole('link', { name: 'Check it in Settings', exact: true }), 'anthropic');
  await expect(field(page)).not.toBeFocused();
});

function isUncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return middle !== null && el.contains(middle);
  });
}

/** Whether the element's first and last lines both show, not only its middle. */
function isWhollyUncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    return [box.top + 1, box.bottom - 1].every(y => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && el.contains(hit);
    });
  });
}

/** How many CSS px of the element sit below what its clipping and scrolling ancestors show. */
function hiddenBelow(locator: Locator): Promise<number> {
  return locator.evaluate(el => {
    let shown = window.innerHeight;
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (getComputedStyle(node).overflowY !== 'visible') shown = Math.min(shown, node.getBoundingClientRect().bottom);
    }
    return Math.ceil(el.getBoundingClientRect().bottom - shown);
  });
}

for (const width of [390, 1440]) {
  for (const look of ['light', 'dark']) {
    test(`pictures: Settings and Watch at ${width} in ${look}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const capture = async (view: string, part: Locator) => {
        await expect(part).toBeVisible();
        await expect(page.locator('html')).toHaveClass(look === 'light' ? /\blight\b/ : /^(?!.*\blight\b)/);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        if (view === 'watch-refusal') {
          await part.evaluate(element => element.scrollIntoView({ block: 'start' }));
          const link = part.getByRole('link');
          // Let the transient run notices finish before framing the persistent recovery action.
          await expect(page.getByRole('status', { name: /^Simulation status: Interrupted/ })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0, { timeout: 20_000 });
          await settle(part);
          expect(await isUncovered(link), 'the recovery link is uncovered in the picture').toBe(true);
        } else {
          // At the phone width the fields stack. A taller window fits the
          // same columns, the actions and all of the key explanation.
          if (width === 390) await page.setViewportSize({ width, height: 1440 });
          const dismissOldBanner = page.getByRole('button', { name: 'Dismiss banner', exact: true });
          if (await dismissOldBanner.isVisible()) await dismissOldBanner.click();
          const lastNote = keys(page).getByTestId('visitor-key-notes').locator('p').last();
          const frame = async () => {
            await field(page).locator('..').evaluate(element => element.scrollIntoView({ block: 'start' }));
            await settle(keys(page));
          };
          await field(page).focus();
          await frame();
          // The refused key's alert and the two-row top bar stay above the
          // scroller, so the window grows by the part the scrollers still hide.
          for (let grow = 0; width === 390 && grow < 3 && !(await isWhollyUncovered(lastNote)); grow++) {
            const height = page.viewportSize()?.height ?? 1440;
            await page.setViewportSize({ width, height: height + Math.max(await hiddenBelow(lastNote), 0) + 48 });
            await frame();
          }
          for (const control of [field(page), back(page)]) {
            expect(await isUncovered(control), 'the key and return link are in frame').toBe(true);
          }
          expect(await isWhollyUncovered(lastNote), 'the whole key explanation is in frame').toBe(true);
        }
        await page.screenshot({ path: `test-pictures/sim-first-screen/server-answers/${view}-${width}-${look}.png`, animations: 'disabled' });
      };
      await openProviderFailure(page, 'auth', look);
      await capture('watch-refusal', recovery(page));
      await openKeyLink(page, recovery(page).getByRole('link', { name: 'Check it in Settings', exact: true }));
      await expect(saved(page)).toBeVisible();
      await capture('settings-keys', saved(page));
    });
  }
}

/*
 * The release checks of the changed surfaces: the Settings key group and the
 * refused key's alert on Watch at nine widths, under reduced motion, with the
 * words measured at six widths; one-row actions, 44 px targets, focus, line
 * heights, text spacing and 200 per cent text.
 */
const KEY_GROUP = '[data-testid="settings-key-group"]';
const REFUSAL = '[data-testid="visitor-key-refusal"]';
const MEASURE_WIDTHS = [320, 390, 600, 768, 1100, 1440];

for (const look of ['light', 'dark']) {
  test(`changed text meets the size and contrast floors in ${look}`, async ({ page, context }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openProviderFailure(page, 'auth', look);
    const settings = await context.newPage();
    try {
      await settings.emulateMedia({ reducedMotion: 'reduce' });
      await settings.goto(FIELD_URL);
      await answerConsent(settings);
      await expect(field(settings)).toBeFocused();
      await field(settings).fill('fixture-openai');
      await expect(saved(settings)).toBeVisible();

      for (const width of [320, 360, 390, 430, 480, 600, 768, 1100, 1440]) {
        await test.step(`Settings and Watch at ${width}`, async () => {
          const viewport = { width, height: width < 900 ? 844 : 900 };
          await Promise.all([page.setViewportSize(viewport), settings.setViewportSize(viewport)]);
          for (const [surfacePage, selector] of [[settings, KEY_GROUP], [page, REFUSAL]] as const) {
            const surface = surfacePage.locator(selector);
            if (MEASURE_WIDTHS.includes(width)) {
              const faults = await measureReadability(surfacePage, selector);
              if (selector === REFUSAL) {
                // The warning mark is a glyph. Apply its contrast floor to the same measurement.
                const glyph = (await measureText(surfacePage, surface)).find(part => part.text === '!');
                expect(glyph).toBeDefined();
                expect.soft(glyph!.ratio).toBeGreaterThanOrEqual(FIGURES.glyphRatio);
                expect.soft(faults.filter(fault => !fault.endsWith(saidOf(glyph!))), selector).toEqual([]);
              } else {
                expect.soft(faults, selector).toEqual([]);
              }
            }
            expect.soft(await overflowOf(surface), selector).toBeLessThanOrEqual(1);
            expect.soft(await rowsOnOneRow(surfacePage), selector).toEqual([]);
          }
          const forget = keys(settings).getByRole('button', { name: 'Forget my keys', exact: true });
          const checkKey = recovery(page).getByRole('link');
          const dismiss = recovery(page).getByRole('button');
          await expectOneRow(forget, back(settings).locator('..'));
          await expectOneRow(checkKey, dismiss);
          for (const control of [field(settings), back(settings), forget, checkKey, dismiss]) {
            expect.soft(await control.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
          }
        });
      }
      await expect(field(settings)).toBeFocused();
      await expect(field(settings)).toHaveCSS('outline-style', 'solid');
      await recovery(page).getByRole('link').focus();
      await expect(recovery(page).getByRole('link')).toBeFocused();
      for (const [word, ratio] of [[saved(settings), 1.4], [back(settings), 1.4],
        [keys(settings).getByTestId('visitor-key-notes').locator('p').first(), 1.55],
        [recovery(page).getByText(REFUSED, { exact: true }), 1.55]] as const) {
        expect.soft(await word.evaluate(el => {
          const css = getComputedStyle(el);
          return parseFloat(css.lineHeight) / parseFloat(css.fontSize);
        })).toBeCloseTo(ratio, 2);
      }

      for (const [surfacePage, selector] of [[settings, KEY_GROUP], [page, REFUSAL]] as const) {
        await surfacePage.setViewportSize({ width: 320, height: 844 });
        const surface = surfacePage.locator(selector);
        const spacing = await surfacePage.addStyleTag({ content: `
          ${selector}, ${selector} * { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; }
          ${selector} p { margin-bottom: 2em !important; }
        ` });
        expect.soft((await spacingFaults(surface)).cut, `text spacing on ${selector}`).toEqual([]);
        expect.soft(await overflowOf(surface)).toBeLessThanOrEqual(1);
        await spacing.evaluate(el => el.remove());
        await scaleText(surfacePage, 2);
        expect.soft((await spacingFaults(surface)).cut, `200 percent text on ${selector}`).toEqual([]);
        expect.soft(await ownOverflowOf(surface), `200 percent text on ${selector}`).toBeLessThanOrEqual(1);
      }
    } finally {
      await settings.close();
    }
  });
}

async function expectOneRow(a: Locator, b: Locator) {
  const [left, right] = await Promise.all([a.boundingBox(), b.boundingBox()]);
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect.soft(Math.max(left!.y, right!.y)).toBeLessThan(Math.min(left!.y + left!.height, right!.y + right!.height));
}

/** How far the surface, or the page around it, scrolls sideways, in px. */
function overflowOf(surface: Locator): Promise<number> {
  return surface.evaluate(el => Math.max(
    el.scrollWidth - el.clientWidth,
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  ));
}

/** How far the surface scrolls sideways or stands past the window's right edge, in px. */
function ownOverflowOf(surface: Locator): Promise<number> {
  return surface.evaluate(el => Math.max(
    el.scrollWidth - el.clientWidth,
    el.getBoundingClientRect().right - document.documentElement.clientWidth,
  ));
}
