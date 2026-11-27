import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { LeaderPromptAnswer } from '../../src/api/leader-prompt.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { SERVERS } from '../support/frame.js';

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
    await page.request.post(SERVERS.demo + '/cancel');
  }
});
