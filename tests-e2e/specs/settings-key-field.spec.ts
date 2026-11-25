import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { openTab, SERVERS } from '../support/frame.js';
import { settle } from '../support/readability.js';
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

async function openKeyLink(page: Page, link: Locator) {
  await link.focus();
  await expect(link).toBeFocused();
  await link.press('Enter');
  await expect(page).toHaveURL(/tab=settings&focus=api-key$/);
  await expect(field(page)).toBeFocused();
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

async function openProviderFailure(page: Page, kind: 'auth' | 'quota', look = 'dark') {
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
  const marker = `fixture-openai-${kind}:${randomUUID()}`;
  await field(page).fill(marker);
  await openTab(page, 'quickstart');
  await expect(startKey(page)).toBeEnabled();
  let accepted: { ok: boolean; hasRunId: boolean; sentProviderKey: boolean } | undefined;
  await page.route('**/setup', async route => {
    const response = await route.fetch();
    const body = await response.json();
    accepted = {
      ok: response.ok(),
      hasRunId: typeof body.runKey === 'string' && body.runKey.length > 0,
      sentProviderKey: route.request().postDataJSON().apiKey === marker,
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

function isUncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate(el => {
    const box = el.getBoundingClientRect();
    const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return middle !== null && el.contains(middle);
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
          await field(page).focus();
          await field(page).locator('..').evaluate(element => element.scrollIntoView({ block: 'start' }));
          await settle(keys(page));
          const visible = [field(page), back(page), keys(page).getByTestId('visitor-key-notes').locator('p').last()];
          for (const control of visible) {
            expect(await isUncovered(control), 'the key, return link and explanation are in frame').toBe(true);
          }
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
