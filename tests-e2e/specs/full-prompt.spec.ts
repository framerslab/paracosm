import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { LeaderPromptAnswer } from '../../src/api/leader-prompt.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { lookOf, scaleText, SERVERS } from '../support/frame.js';
import { axeFindings, measureReadability, rowsOnOneRow } from '../support/first-screen-measure.js';
import { FIGURES, measureText, settle, spacingFaults } from '../support/readability.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The prompt spec uses the hosted and installed fixture servers.');

const trigger = 'See the full prompt';
const ownModel = 'With your own API key, the model is the one chosen in Settings.';
const headings = {
  system: '1. System prompt',
  opening: '2. Opening message',
  sampleTurn: '3. A sample turn',
} as const;
const dialog = (page: Page) => page.getByRole('dialog', { name: /'s full prompt$/ });
const opener = (root: Page | Locator) => root.getByRole('button', { name: trigger, exact: true });
const consent = (page: Page) => page.getByRole('region', { name: 'Analytics choices' });
const leaderTab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(name) });

const mars = JSON.parse(readFileSync(new URL('../../scenarios/mars.json', import.meta.url), 'utf8'));
const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'emotionality', 'honesty-humility'];
const figures = [
  ['0.95', '0.35', '0.85', '0.55', '0.30', '0.65'],
  ['0.25', '0.97', '0.30', '0.60', '0.70', '0.90'],
];
const speaking = [
  'emotionality (low), extraversion (high), openness (high)',
  'honesty-humility (high), emotionality (high), extraversion (low), conscientiousness (high), openness (low)',
];

test.beforeEach(async ({ context }) => {
  const address = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
  await context.setExtraHTTPHeaders({ 'x-real-ip': `198.18.${address[0]}.${address[1]}` });
});

async function openRun(page: Page, origin: string = SERVERS.demo, scenario = 'Mars Genesis') {
  await page.goto(origin + '/sim');
  await expect(page.getByRole('heading', { name: scenario, exact: true, level: 1 })).toBeVisible();
  if (origin === SERVERS.demo) {
    const reject = consent(page).getByRole('button', { name: 'Reject all', exact: true });
    await reject.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
    if (await reject.isVisible()) await reject.click();
    await expect(page.getByTestId('scenario-figures')).toBeVisible();
  }
}

function promptResponse(page: Page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === '/leader-prompt');
}

async function readFrom(page: Page, key: Locator, place: number, own = false) {
  const responseReady = promptResponse(page);
  await key.click();
  const response = await responseReady;
  expect(response.status()).toBe(200);
  const request = response.request();
  const url = new URL(response.url());
  expect(url.searchParams.get('place')).toBe(String(place));
  expect([...url.searchParams.keys()].sort()).toEqual(['place', 'scenario']);
  expect(request.method()).toBe('GET');
  expect(request.postData()).toBeNull();
  expect(request.headers()['x-paracosm-prompt-mode']).toBe(own ? 'own' : undefined);
  expect(request.headers().authorization).toBeUndefined();
  return await response.json() as LeaderPromptAnswer;
}

async function expectParts(panel: Locator, data: LeaderPromptAnswer) {
  for (const part of ['system', 'opening', 'sampleTurn'] as const) {
    const title = panel.getByRole('heading', { name: headings[part], exact: true, level: 3 });
    const button = title.getByRole('button');
    if (await button.isVisible() && await button.getAttribute('aria-expanded') === 'false') await button.click();
    const quote = panel.getByRole('region', { name: headings[part], exact: true }).locator('blockquote');
    await expect(quote).toBeVisible();
    expect(await quote.textContent()).toBe(data.parts[part]);
    await expect(quote).toHaveAttribute('translate', 'no');
  }
}

for (const width of [390, 1440]) {
  test(`the written Mars pair shows its own exact inputs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openRun(page);
    for (const [index, leader] of mars.presets[0].leaders.entries()) {
      if (width === 390 && index === 1) await leaderTab(page, leader.name).click();
      const key = width === 390 ? opener(page) : opener(page.getByRole('article', { name: leader.name, exact: true }));
      const data = await readFrom(page, key, index + 1);
      expect(data.scenarioId).toBe(mars.id);
      const panel = page.getByRole('dialog', { name: `${leader.name}'s full prompt`, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/Everything this leader is given, in three parts\./)).toBeVisible();
      await expect(panel.getByText(`Model on a free run: ${data.model?.provider} ${data.model?.model}`, { exact: true })).toBeVisible();
      await expectParts(panel, data);
      await expect(panel).not.toContainText(mars.presets[0].leaders[1 - index].instructions);
      expect(await panel.locator('blockquote').evaluateAll(blocks => blocks.every(block => block.childElementCount === 0))).toBe(true);
      await expect(panel.locator('input, textarea, [contenteditable], [data-ai-generated]')).toHaveCount(0);
      const scoreLabel = `${leader.name}'s six scores: ${traits.map((trait, t) => `${trait} ${figures[index][t]}`).join(', ')}`;
      const scores = panel.getByRole('img', { name: scoreLabel, exact: true });
      await expect(scores.getByTestId('prompt-score')).toHaveText(figures[index]);
      await expect(panel.getByText(`Each score far from the middle adds one line to part 1's personality section. For ${leader.name}: ${speaking[index]}.`, { exact: true })).toBeVisible();
      await expect(panel.getByText(/The standing instructions the model reads first/)).toBeVisible();
      await expect(panel.getByText(/The leader hears about its personality twice/)).toBeVisible();
      await expect(panel.getByText(/Sent once, before turn 1/)).toBeVisible();
      await expect(panel.getByText(/The shape of what the leader receives each turn/)).toBeVisible();
      await expect(panel.getByText(/Bar: the chance at which/)).toBeVisible();
      await expect(panel.getByTestId('prompt-bar')).toHaveText(`${index === 0 ? 36 : 82} in 100`);
      await panel.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(panel).toBeHidden();
    }
  });
}

test('a tab key sends only the preview mode and the installed server needs no mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SERVERS.demo + '/sim?tab=settings#key-openai');
  await consent(page).getByRole('button', { name: 'Reject all' }).click();
  await page.locator('#key-openai').fill('fixture-prompt-preview');
  await page.getByRole('link', { name: 'Back to Run' }).click();
  await expect(page.getByTestId('scenario-figures')).toContainText('100 people');
  await readFrom(page, opener(page), 1, true);
  await expect(dialog(page).getByText(ownModel, { exact: true })).toBeVisible();
  await expect(dialog(page)).not.toContainText('fixture-prompt-preview');
  await openRun(page, SERVERS.dashboard);
  const answer = await readFrom(page, opener(page), 1);
  expect(answer.model).toBeNull();
  await expect(dialog(page).getByText(ownModel, { exact: true })).toBeVisible();
});

test('a written place with blank orders opens its deterministic fill and a placeholder has no key', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await openRun(page);
  const leader = { ...mars.presets[0].leaders[0], instructions: '', description: 'Keep the inventory current.' };
  const id = 'prompt-fill-fixture';
  const stored = await page.request.post(SERVERS.demo + '/scenario/store', { data: { scenario: {
    ...marsScenario, id, labels: { ...marsScenario.labels, name: 'Prompt Fill Fixture' },
    presets: [{ id: 'one', label: 'One', leaders: [leader] }],
  } } });
  expect((await stored.json()).switchable).toBe(true);
  expect((await page.request.post(SERVERS.demo + '/scenario/switch', { data: { id } })).ok()).toBe(true);
  await openRun(page, SERVERS.demo, 'Prompt Fill Fixture');
  await expect(opener(page.getByRole('article', { name: 'Leader 2', exact: true }))).toHaveCount(0);
  const answer = await readFrom(page, opener(page), 1);
  expect(answer.filled).toBe(true);
  await expect(dialog(page).getByText('This leader had no written orders, so Paracosm wrote these from its title and temperament.', { exact: true })).toBeVisible();
  expect(answer.parts.system).toContain(leader.description);
  await expectParts(dialog(page), answer);
});

test('an exhausted daily allowance leaves the prompt readable and the count unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const quota = async () => (await page.request.get(SERVERS.demo + '/rate-limit')).json();
  const start = await page.request.post(SERVERS.demo + '/setup', { data: {
    quickstart: { scenarioId: mars.id }, actors: mars.presets[0].leaders, turns: 1, seed: mars.setup.defaultSeed,
  } });
  expect(start.ok()).toBe(true);
  const spent = await quota();
  expect(spent.remaining).toBe(0);
  try {
    await openRun(page);
    for (let read = 0; read < 5; read++) {
      await readFrom(page, opener(page), 1);
      await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    }
    expect(await quota()).toEqual(spent);
  } finally {
    await page.request.post(SERVERS.demo + '/clear');
  }
});

const close = (page: Page) => dialog(page).getByRole('button', { name: 'Close', exact: true });
const retry = (page: Page) => dialog(page).getByRole('button', { name: 'Try again', exact: true });
const routePrompt = '**/leader-prompt?*';

function gate() {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}

test('slow input opens immediately and a closed request cannot paint into another leader', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRun(page);
  const held = gate();
  const received = gate();
  let reads = 0;
  await page.route(routePrompt, async route => {
    if (++reads !== 1) return route.continue();
    try {
      const response = await route.fetch();
      received.release();
      await held.held;
      await route.fulfill({ response }).catch(() => {});
    } finally {
      received.release();
    }
  });
  const key = opener(page);
  await key.evaluate(element => { element.click(); element.click(); });
  await received.held;
  const panel = dialog(page);
  await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(Object.values(headings).map(title => new RegExp(title.replace('.', '\\.'))));
  await expect(panel.getByTestId('prompt-skeleton')).toHaveCount(3);
  await expect(panel.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  await expect(panel.getByRole('status')).toHaveText('Loading the prompt');
  expect(reads).toBe(1);
  await page.keyboard.press('Escape');
  await expect(key).toBeFocused();

  await leaderTab(page, 'Dietrich Voss').click();
  const answer = await readFrom(page, opener(page), 2);
  await expect(panel.getByRole('status')).toHaveText('Prompt loaded');
  held.release();
  await expectParts(panel, answer);
  await expect(panel).not.toContainText(mars.presets[0].leaders[0].instructions);
  await close(page).click();
  await expect(opener(page)).toBeFocused();
  await readFrom(page, opener(page), 2);
  expect(reads).toBe(3);
});

test('a payer change discards the held host answer without moving the phone header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRun(page);
  const held = gate();
  const received = gate();
  await page.route(routePrompt, async route => {
    if (route.request().headers()['x-paracosm-prompt-mode'] === 'own') return route.continue();
    try {
      const response = await route.fetch();
      received.release();
      await held.held;
      await route.fulfill({ response }).catch(() => {});
    } finally {
      received.release();
    }
  });
  await opener(page).click();
  await received.held;
  const panel = dialog(page);
  const title = panel.getByRole('heading', { level: 2 });
  const part = panel.getByRole('heading', { name: headings.system, level: 3, exact: true });
  const before = [await title.boundingBox(), await part.boundingBox()].map(box => box?.y);
  const response = promptResponse(page);
  await page.evaluate(() => {
    sessionStorage.setItem('paracosm:keyOverrides', JSON.stringify({ openai: 'fixture-mode-change' }));
    window.dispatchEvent(new Event('paracosm:key-overrides-changed'));
  });
  const result = await response;
  expect(result.request().headers()['x-paracosm-prompt-mode']).toBe('own');
  await expect(panel.getByRole('status')).toHaveText('Prompt loaded');
  held.release();
  expect([await title.boundingBox(), await part.boundingBox()].map(box => box?.y)).toEqual(before);
  await expect(panel.getByText(ownModel, { exact: true })).toBeVisible();
  await expectParts(panel, await result.json());
});

test('a blocked read, a 429 and offline each recover through one explicit retry', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRun(page);
  const held = gate();
  let reads = 0;
  await page.route(routePrompt, async route => {
    switch (++reads) {
      case 1: return route.abort();
      case 2: return route.fulfill({ status: 429, json: { error: 'prompt_read_limit' } });
      case 3: await held.held; break;
    }
    return route.continue();
  });
  await opener(page).click();
  await expect(dialog(page).getByText('The prompt did not load.', { exact: true })).toBeVisible();
  const bounds = await retry(page).boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(96);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await retry(page).click();
  await expect(dialog(page).getByText('Too many requests from this connection. Try again in a minute.', { exact: true })).toBeVisible();
  await retry(page).evaluate(element => { element.click(); element.click(); });
  await expect(dialog(page).getByRole('button', { name: 'Trying…' })).toBeDisabled();
  await expect.poll(() => reads).toBe(3);
  held.release();
  await expect(dialog(page).getByRole('status')).toHaveText('Prompt loaded');
  await close(page).click();

  await context.setOffline(true);
  await opener(page).click();
  await expect(dialog(page).getByText('You are offline. The prompt loads when you are back online.', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(retry(page)).toBeEnabled();
  expect(reads).toBe(3);
  await retry(page).click();
  await expect(dialog(page).getByRole('status')).toHaveText('Prompt loaded');
  expect(reads).toBe(4);
});

test('a second tab can change the scenario and Reload replaces the stale leaders', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRun(page);
  const second = await context.newPage();
  await openRun(second);
  expect((await second.request.post(SERVERS.demo + '/scenario/switch', { data: { id: 'lunar-outpost' } })).ok()).toBe(true);
  await opener(page).click();
  await expect(dialog(page).getByText('The scenario has changed since this page loaded. Reload to read its leaders.', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(leaderTab(page, 'Commander Sarah Lindgren')).toBeVisible();
  expect((await readFrom(page, opener(page), 1)).scenarioId).toBe('lunar-outpost');
});

test('keyboard wraps inside the desktop dialog and jumps land below its header', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRun(page);
  const key = opener(page.getByRole('article', { name: 'Dietrich Voss', exact: true }));
  await key.scrollIntoViewIfNeeded();
  const scrollBefore = await key.evaluate(element => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node.scrollTop) return node.scrollTop;
    }
    return window.scrollY;
  });
  await readFrom(page, key, 2);
  const panel = dialog(page);
  await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close(page)).toBeFocused();
  const last = panel.locator('blockquote').last();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close(page)).toBeFocused();
  const link = panel.getByRole('link', { name: headings.sampleTurn, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'location');
  const part = panel.getByRole('heading', { level: 3, name: headings.sampleTurn, exact: true });
  expect((await part.boundingBox())!.y).toBeGreaterThanOrEqual((await close(page).boundingBox())!.y + 44);
  await close(page).click();
  await expect(key).toBeFocused();
  expect(await key.evaluate(element => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node.scrollTop) return node.scrollTop;
    }
    return window.scrollY;
  })).toBe(scrollBefore);
});

test('phone headings open independently and prompt text reflows with 200% text spacing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openRun(page);
  await readFrom(page, opener(page), 1);
  const panel = dialog(page);
  const system = panel.getByRole('heading', { name: headings.system, exact: true }).getByRole('button');
  const opening = panel.getByRole('heading', { name: headings.opening, exact: true }).getByRole('button');
  await expect(system).toHaveAttribute('aria-expanded', 'true');
  await opening.click();
  await expect(opening).toHaveAttribute('aria-expanded', 'true');
  await system.click();
  await expect(system).toHaveAttribute('aria-expanded', 'false');
  await expect(opening).toHaveAttribute('aria-expanded', 'true');
  await scaleText(page, 2);
  await page.addStyleTag({ content: 'dialog, dialog * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }' });
  await expect(close(page)).toBeVisible();
  expect(await panel.evaluate(el => [el, ...el.querySelectorAll('div, blockquote, h2, h3')]
    .filter(node => !node.closest('.sr-only') && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1).map(node => node.tagName))).toEqual([]);
});

for (const width of [390, 1440]) {
  for (const look of ['light', 'dark'] as const) {
    test(`captures the Mars prompt and Privacy at ${width}px in ${look}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      try {
        await context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
        const page = await context.newPage();
        await openRun(page);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const root = width === 390 ? page : page.getByRole('article', { name: 'Aria Chen', exact: true });
        const key = opener(root);
        await key.scrollIntoViewIfNeeded();
        const snap = async (surface: string) => {
          const file = `${surface}-${width}-${look}.png`;
          const actual = await page.screenshot({
            path: `test-pictures/sim-first-screen/full-prompt/${file}`,
            animations: 'disabled',
          });
          const published = readFileSync(new URL(`../../docs/design/sim-first-screen/full-prompt/${file}`, import.meta.url));
          const result = await page.evaluate(async ({ before, after }) => {
            const decode = (png: string) => createImageBitmap(
              new Blob([Uint8Array.from(atob(png), char => char.charCodeAt(0))], { type: 'image/png' }),
            );
            const [reference, rendered] = await Promise.all([decode(before), decode(after)]);
            const size = [reference.width, reference.height];
            const renderedSize = [rendered.width, rendered.height];
            const canvas = document.createElement('canvas');
            canvas.width = reference.width;
            canvas.height = reference.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            const pixelsOf = (bitmap: ImageBitmap) => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(bitmap, 0, 0);
              bitmap.close();
              return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            };
            const expected = pixelsOf(reference);
            const current = pixelsOf(rendered);
            return { size, renderedSize, samePixels: expected.every((byte, index) => byte === current[index]) };
          }, { before: published.toString('base64'), after: actual.toString('base64') });
          expect.soft(result, file).toEqual({ size: [width * 2, 1688], renderedSize: [width * 2, 1688], samePixels: true });
        };
        await snap('card');
        await readFrom(page, key, 1);
        await expect(dialog(page).getByRole('status')).toHaveText('Prompt loaded');
        await snap('dialog');
        await close(page).click();
        await page.goto(SERVERS.demo + '/#privacy');
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const paragraph = page.locator('#privacy p').filter({ hasText: 'opening a leader’s full prompt' });
        await paragraph.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await expect(paragraph).toBeInViewport();
        await snap('privacy');
      } finally {
        await context.close();
      }
    });
  }
}

const panelRoot = 'dialog[open][aria-labelledby]';
const keyRoot = '[data-testid="leaders"] button[aria-haspopup="dialog"]';
const privacyRoots = [
  '#privacy .privacy-updated',
  '#privacy p:has-text("opening a leader’s full prompt")',
  '#privacy p:has-text("It counts full prompt reads separately")',
];

async function measurePromptWords(page: Page, root: string, minLine: number) {
  const surface = page.locator(root);
  await expect(surface.first()).toBeVisible();
  for (const item of await surface.all()) {
    const words = await measureText(page, item, { unroundedContrast: true });
    expect(words.length, root).toBeGreaterThan(0);
    for (const word of words) {
      const large = word.role === 'body' || word.role === 'heading';
      expect.soft(word.px, word.selector).toBeGreaterThanOrEqual(large ? FIGURES.bodyPx : FIGURES.otherPx);
      const floor = large ? FIGURES.bodyRatio : word.inactive ? FIGURES.glyphRatio : FIGURES.otherRatio;
      expect.soft(word.ratio, word.selector).toBeGreaterThanOrEqual(floor);
    }
    const styles = await item.evaluate((el, min) => [el, ...el.querySelectorAll('*')].flatMap(node => {
      const own = [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      if (!own || node.closest('.sr-only, [hidden]') || !node.getClientRects().length) return [];
      const style = getComputedStyle(node);
      if (style.visibility !== 'visible') return [];
      const face = node.matches('code') ? 'JetBrains Mono' : 'Inter';
      const role = node.closest('[data-text]')?.getAttribute('data-text');
      const floor = role === 'body' ? 1.55 : min;
      const line = parseFloat(style.lineHeight) / parseFloat(style.fontSize);
      return style.fontFamily.startsWith('"' + face + '"') || style.fontFamily.startsWith(face)
        ? (['400', '600'].includes(style.fontWeight) && line + 0.001 >= floor ? [] : [`${node.textContent?.trim().slice(0, 60)}: ${style.fontWeight}, line height ${line}`])
        : [`${node.textContent?.trim().slice(0, 60)}: ${style.fontFamily}`];
    }), minLine);
    expect.soft(styles, root).toEqual([]);
  }
}

async function expectPromptReflow(page: Page) {
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect.soft(await rowsOnOneRow(page)).toEqual([]);
  expect.soft(await dialog(page).evaluate(el => [el, ...el.querySelectorAll('header, nav, section, div, blockquote, h2, h3, button, a, p')]
    .filter(node => !node.closest('.sr-only') && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)
    .map(node => node.tagName + ' ' + (node.textContent ?? '').trim().slice(0, 60)))).toEqual([]);
}

async function expectTarget(key: Locator, width: number, height: number) {
  const rect = await key.boundingBox();
  expect.soft(rect?.width, 'target width').toBeGreaterThanOrEqual(width);
  expect.soft(rect?.height, 'target height').toBeGreaterThanOrEqual(height);
}

async function expectPromptPalette(page: Page, look: 'light' | 'dark') {
  const [ink, quiet, quote, edge, amber] = look === 'light'
    ? [15.51, 8.72, 18.52, 5.45, 6.96]
    : [16.54, 11.81, 17.17, 6.65, 9.91];
  const panel = dialog(page);
  const nav = panel.getByRole('navigation').locator('[aria-current]');
  const title = panel.getByRole('heading', { level: 2 });
  const model = panel.getByText(/^Model on a free run:/);
  const quoteBlock = panel.locator('blockquote').first();
  for (const [word, expected] of [[title, ink], [model, quiet], [quoteBlock, quote]] as const) {
    const measured = await measureText(page, word, { unroundedContrast: true });
    expect(measured.length).toBeGreaterThan(0);
    for (const part of measured) expect.soft(Number(part.ratio.toFixed(2)), part.selector).toBe(expected);
  }
  // Focus from the initial heading so the real keyboard focus ring is painted.
  await title.focus();
  await page.keyboard.press('Tab');
  await expect(close(page)).toBeFocused();
  const paints = await panel.evaluate((el) => {
    const css = (node: Element) => getComputedStyle(node);
    const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const light = (value: string) => rgb(value).reduce((total, channel, i) => {
      const c = channel / 255;
      return total + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    }, 0);
    const ground = light(css(el).backgroundColor);
    const contrast = (paint: string) => {
      const luminance = light(paint);
      return Number(((Math.max(luminance, ground) + 0.05) / (Math.min(luminance, ground) + 0.05)).toFixed(2));
    };
    const closeStyle = css(el.querySelector('header button')!);
    const quoteStyle = css(el.querySelector('blockquote')!);
    const speaking = el.querySelector('[data-speaking="true"]')!;
    return {
      closeEdge: contrast(closeStyle.borderTopColor),
      quoteEdge: contrast(quoteStyle.borderInlineStartColor),
      quoteWidth: quoteStyle.borderInlineStartWidth,
      quoteInset: quoteStyle.paddingInlineStart,
      trackEdge: contrast(css(speaking.parentElement!).borderTopColor),
      fill: contrast(css(speaking).backgroundColor),
      ring: contrast(closeStyle.outlineColor),
      ringWidth: closeStyle.outlineWidth,
      ringGap: closeStyle.outlineOffset,
    };
  });
  expect.soft(paints).toEqual({
    closeEdge: edge, quoteEdge: edge, quoteWidth: '3px', quoteInset: '12px',
    trackEdge: edge, fill: amber, ring: amber, ringWidth: '2px', ringGap: '2px',
  });
  if (await nav.isVisible()) {
    const mark = await nav.evaluate(el => {
      const style = getComputedStyle(el);
      return [style.borderInlineStartWidth, style.fontWeight, style.borderInlineStartColor];
    });
    expect.soft(mark).toEqual(['3px', '600', await close(page).evaluate(el => getComputedStyle(el).outlineColor)]);
  }
}

for (const look of ['light', 'dark'] as const) {
  for (const width of [320, 390, 600, 768, 1100, 1440]) {
    test(`prompt readability and layout at ${width}px in ${look}`, async ({ page, context }) => {
      test.setTimeout(60_000);
      await context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openRun(page);
      expect((await lookOf(page)).light).toBe(look === 'light');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const key of await opener(page).all()) await expectTarget(key, 44, 44);
      await measurePromptWords(page, keyRoot, 1.4);

      // Force one failed read, then hold its retry long enough to measure its pending state.
      const held = gate();
      let requests = 0;
      await page.route(routePrompt, async route => {
        if (++requests === 1) return route.abort();
        if (requests === 2) {
          await held.held;
          return route.fulfill({ status: 429, json: { error: 'prompt_read_limit' } });
        }
        return route.continue();
      });
      await opener(page).first().click();
      await expect(retry(page)).toBeEnabled();
      await expectTarget(retry(page), 96, 44);
      expect.soft(await measureReadability(page, panelRoot)).toEqual([]);
      await measurePromptWords(page, panelRoot, 1.4);
      await retry(page).click();
      const trying = dialog(page).getByRole('button', { name: 'Trying…' });
      try {
        await expect(trying).toBeDisabled();
        await measurePromptWords(page, panelRoot, 1.4);
        await expectPromptReflow(page);
      } finally {
        held.release();
      }
      await expect(dialog(page).getByText('Too many requests from this connection. Try again in a minute.')).toBeVisible();
      expect.soft(await measureReadability(page, panelRoot)).toEqual([]);
      await measurePromptWords(page, panelRoot, 1.4);
      const response = promptResponse(page);
      await retry(page).click();
      const answer: LeaderPromptAnswer = await (await response).json();
      const panel = dialog(page);
      await expectParts(panel, answer);
      await settle(panel);
      expect.soft(await measureReadability(page, panelRoot)).toEqual([]);
      await measurePromptWords(page, panelRoot, 1.4);
      await expectPromptReflow(page);
      await expectTarget(close(page), 44, 44);
      await expectPromptPalette(page, look);

      const size = (await panel.boundingBox())!;
      const nav = panel.getByRole('navigation');
      if (width < 600) {
        expect(size).toMatchObject({ x: 0, y: 0, width, height: 844 });
        for (const heading of await panel.getByRole('heading', { level: 3 }).all()) await expectTarget(heading.getByRole('button'), 44, 48);
      } else {
        expect(size.height).toBeLessThanOrEqual(844 * 0.9 + 1);
        if (width < 1100) {
          expect(size.width).toBeGreaterThanOrEqual(560);
          expect(size.width).toBeLessThanOrEqual(720);
        } else {
          expect(size.width).toBe(width === 1440 ? 1120 : 960);
          expect((await nav.boundingBox())?.width).toBe(240);
          for (const link of await nav.getByRole('link').all()) await expectTarget(link, 44, 44);
        }
        const opening = panel.getByRole('region', { name: headings.opening });
        const note = (await opening.getByText(/^Sent once/).boundingBox())!;
        const quote = (await opening.locator('blockquote').boundingBox())!;
        if (width === 1440) expect(note.x + note.width).toBeLessThan(quote.x);
        else expect(note.y).toBeLessThan(quote.y);
      }
      expect.soft(await panel.evaluate(el => [getComputedStyle(el).animationName, getComputedStyle(el.querySelector('[aria-busy]')!).scrollBehavior]))
        .toEqual(['none', 'auto']);
      if (width === 390 || width === 1440) expect.soft(await axeFindings(page, 'body')).toEqual([]);

      await close(page).click();
      await context.setOffline(true);
      try {
        await opener(page).first().click();
        await expect(panel.getByText(/^You are offline/)).toBeVisible();
        expect.soft(await measureReadability(page, panelRoot)).toEqual([]);
        await measurePromptWords(page, panelRoot, 1.4);
        await close(page).click();
      } finally {
        await context.setOffline(false);
      }

      expect((await page.request.post(SERVERS.demo + '/scenario/switch', { data: { id: 'lunar-outpost' } })).ok()).toBe(true);
      await opener(page).first().click();
      const reload = panel.getByRole('button', { name: 'Reload', exact: true });
      await expect(reload).toBeVisible();
      await expectTarget(reload, 96, 44);
      expect.soft(await measureReadability(page, panelRoot)).toEqual([]);
      await measurePromptWords(page, panelRoot, 1.4);
      await close(page).click();
      for (let index = 0; index < await page.locator(keyRoot).count(); index++) {
        expect.soft(await measureReadability(page, `${keyRoot} >> nth=${index}`)).toEqual([]);
      }
      await page.goto(SERVERS.demo + '/#privacy');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect((await lookOf(page)).light).toBe(look === 'light');
      for (const root of privacyRoots) {
        expect.soft(await measureReadability(page, root)).toEqual([]);
        await measurePromptWords(page, root, 1.4);
        expect.soft(await spacingFaults(page.locator(root))).toEqual({ cut: [], overlaps: [] });
      }
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    });
  }
}

for (const width of [390, 1440]) {
  for (const look of ['light', 'dark'] as const) {
    for (const access of ['own key', 'daily limit'] as const) {
      test(`prompt accessibility with ${access} at ${width}px in ${look}`, async ({ page, context }) => {
        await page.setViewportSize({ width, height: 844 });
        await context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        if (access === 'daily limit') {
          const start = await page.request.post(SERVERS.demo + '/setup', { data: {
            quickstart: { scenarioId: mars.id }, actors: mars.presets[0].leaders, turns: 1, seed: mars.setup.defaultSeed,
          } });
          expect(start.ok()).toBe(true);
          expect((await (await page.request.get(SERVERS.demo + '/rate-limit')).json()).remaining).toBe(0);
        } else {
          await context.addInitScript(() => sessionStorage.setItem('paracosm:keyOverrides', JSON.stringify({ openai: 'fixture-prompt-access' })));
        }
        try {
          await openRun(page);
          const answer = await readFrom(page, opener(page).first(), 1, access === 'own key');
          await expectParts(dialog(page), answer);
          expect(await axeFindings(page, 'body')).toEqual([]);
        } finally {
          if (access === 'daily limit') await page.request.post(SERVERS.demo + '/clear');
        }
      });
    }
  }
}

test('the existing grid and written comparison survive opening and closing at 2, 24 and 300', async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 844 });
  await context.addInitScript(() => sessionStorage.setItem('paracosm:keyOverrides', JSON.stringify({ openai: 'fixture-prompt-scale' })));
  for (const size of [2, 24, 300]) {
    await page.goto(SERVERS.demo + '/sim?size=' + size);
    const reject = consent(page).getByRole('button', { name: 'Reject all' });
    if (size === 2) await reject.click();
    const field = page.getByTestId('run-size').getByRole('spinbutton');
    await expect(field).toHaveValue(String(size));
    const colony = page.getByTestId('shared-colony');
    const cards = page.getByTestId('leaders').getByRole('article');
    const check = async () => {
      await expect(colony.locator('canvas')).toBeVisible();
      await expect(colony.locator('canvas')).toHaveCount(1);
      await expect(cards).toHaveCount(2);
      const [left, right] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
      expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
      expect(left!.y).toBe(right!.y);
    };
    await check();
    const key = opener(cards.first());
    await readFrom(page, key, 1, true);
    await expect(dialog(page).getByRole('status')).toHaveText('Prompt loaded');
    await close(page).click();
    await expect(key).toBeFocused();
    await expect(field).toHaveValue(String(size));
    await check();
  }
});

for (const look of ['light', 'dark'] as const) {
  test(`prompt targets and rows fit at intermediate widths in ${look}`, async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
    await page.setViewportSize({ width: 320, height: 844 });
    await openRun(page);
    for (const width of [320, 360, 390, 430, 480, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await readFrom(page, opener(page), 1);
      await expect(dialog(page).getByRole('status')).toHaveText('Prompt loaded');
      await expectPromptReflow(page);
      await expectTarget(close(page), 44, 44);
      await close(page).click();
    }
  });
}
