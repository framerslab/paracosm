import { expect, test, type Page } from '@playwright/test';
import { mars, settingsBody } from '../../tests/cli/helpers/run-server.js';

const RUN_SERVER = 'http://127.0.0.1:3470';
const CONSENT_SERVER = 'http://127.0.0.1:3464';
const REPLAY_SERVER = 'http://127.0.0.1:3462';
const SLOT = 'paracosm:keyOverrides';
const LAST_LAUNCH = 'paracosm:lastLaunchConfig';
const MARKER = 'visitor-key-browser-fixture';
const SEARCH_MARKER = 'visitor-search-browser-fixture';
const AGE = "Under 18? You need a parent's or guardian's permission to use this. Not for children under 13.";
const TEACHERS = "For teachers: run a simulation yourself and show it to your class, or share its replay link. A replay only plays back a finished run, and sends nothing new to an AI model. A student who starts their own run must be 13 or over and have a parent's or guardian's permission.";
const TERMS = "If you add your own API key, you confirm it is yours and that your provider's terms let you use it here.";
const PRIVACY = "If you add API keys, we use them for the runs and chats you start. This tab keeps them until it closes or you select Forget my keys. Our server holds them in memory while in use and for up to 30 minutes afterward, then drops them. Each key is sent only to the provider it belongs to.";
const CHILDREN = 'Paracosm is for a general audience. It is not directed to children under 13, and we do not knowingly collect personal information from them. If you believe a child under 13 has used it, write to team@frame.dev and we will delete what we hold.';
const PROVIDERS = ['openai', 'anthropic', 'serper', 'firecrawl', 'tavily', 'cohere'];
const field = (page: Page, provider: string) => page.locator(`#key-${provider}`);
const keyGroup = (page: Page) => page.getByRole('group', { name: 'API Keys', exact: true });

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'These checks need the fixture servers.');

async function stores(page: Page) {
  return page.evaluate(slot => ({
    local: localStorage.getItem(slot),
    session: sessionStorage.getItem(slot),
  }), SLOT);
}

async function savedLaunch(page: Page): Promise<unknown> {
  return page.evaluate(slot => JSON.parse(localStorage.getItem(slot) ?? 'null'), LAST_LAUNCH);
}

test('editing a key stores it for this tab and masks all key inputs from recordings and analytics', async ({ page }) => {
  const analytics: string[] = [];
  const vendors = /(?:clarity\.ms|posthog\.com|googletagmanager\.com|google-analytics\.com|plausible\.io|analytics\.manic\.agency)(?::\d+)?\//;
  page.on('request', request => {
    if (vendors.test(request.url()) || new URL(request.url()).pathname === '/api/event') {
      analytics.push(`${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ''}`);
    }
  });
  await page.route(vendors, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(`${CONSENT_SERVER}/sim?tab=settings`);
  const clarity = page.waitForRequest(request => request.url().includes('clarity.ms/tag/'));
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await clarity;

  await field(page, 'openai').pressSequentially(MARKER);
  await field(page, 'serper').fill(SEARCH_MARKER);
  await field(page, 'serper').blur();
  await expect.poll(() => stores(page)).toEqual({
    local: null,
    session: JSON.stringify({ openai: MARKER, serper: SEARCH_MARKER }),
  });
  for (const provider of PROVIDERS) {
    await expect(field(page, provider)).toHaveAttribute('type', 'password');
    await expect(field(page, provider)).toHaveAttribute('autocomplete', 'off');
    await expect(field(page, provider)).toHaveAttribute('data-clarity-mask', 'True');
    await expect(field(page, provider)).toHaveClass(/\bph-no-capture\b/);
  }
  await page.reload();
  await expect(field(page, 'openai')).toHaveValue(MARKER);
  await expect(field(page, 'serper')).toHaveValue(SEARCH_MARKER);
  expect(analytics.length).toBeGreaterThan(0);
  expect(analytics.join('\n')).not.toContain(MARKER);
  expect(analytics.join('\n')).not.toContain(SEARCH_MARKER);
});

test('the first dashboard load moves an old model and search key to tab storage', async ({ page }) => {
  const old = JSON.stringify({ openai: MARKER, tavily: SEARCH_MARKER });
  // Earlier releases also saved the keys inside the last launch, through Run again.
  const oldLaunch = JSON.stringify({ ...settingsBody(mars), apiKey: MARKER, tavilyKey: SEARCH_MARKER });
  await page.addInitScript(({ slot, old, launchSlot, oldLaunch }) => {
    localStorage.setItem(slot, old);
    localStorage.setItem(launchSlot, oldLaunch);
  }, { slot: SLOT, old, launchSlot: LAST_LAUNCH, oldLaunch });
  await page.goto(`${RUN_SERVER}/sim`);
  await expect(page.getByTestId('note-adults')).toBeAttached();
  await expect.poll(() => stores(page)).toEqual({ local: null, session: old });
  expect(await savedLaunch(page)).toEqual(settingsBody(mars));
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(field(page, 'openai')).toHaveValue(MARKER);
  await expect(field(page, 'tavily')).toHaveValue(SEARCH_MARKER);
});

test('Run again sends the tab keys and keeps them out of the launch this device saves', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route(`${RUN_SERVER}/setup`, async route => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ redirect: '/sim' }) });
  });
  // A finished run, so the Run again row shows.
  await page.route('**/events', route => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: 'event: connected\ndata: {}\n\nevent: complete\ndata: {}\n\n',
  }));
  await page.goto(`${RUN_SERVER}/sim?tab=settings`);
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  await field(page, 'openai').fill(MARKER);
  await field(page, 'serper').fill(SEARCH_MARKER);
  await page.evaluate(({ launchSlot, launch }) => { localStorage.setItem(launchSlot, launch); },
    { launchSlot: LAST_LAUNCH, launch: JSON.stringify({ ...settingsBody(mars), seed: 7 }) });

  const runAgain = page.getByText('Spin up a new run').locator('..').getByRole('button');
  await page.goto(`${RUN_SERVER}/sim?tab=sim`);
  await expect(runAgain).toBeEnabled();
  await runAgain.click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ seed: 8, apiKey: MARKER, serperKey: SEARCH_MARKER });
  // Run again saves its launch, then reloads the page: one read covers both.
  await expect.poll(async () => {
    const saved = JSON.stringify(await savedLaunch(page));
    return { savedNextSeed: saved.includes('"seed":8'), holdsAKey: saved.includes(MARKER) || saved.includes(SEARCH_MARKER) };
  }).toEqual({ savedNextSeed: true, holdsAKey: false });

  // Forgotten keys never ride along on the next Run again.
  await page.goto(`${RUN_SERVER}/sim?tab=settings`);
  await keyGroup(page).getByRole('button', { name: 'Forget my keys', exact: true }).click();
  await expect(keyGroup(page).getByRole('status')).toHaveText('Keys forgotten. Your held run and chat agents have been cleared.');
  await page.goto(`${RUN_SERVER}/sim?tab=sim`);
  await expect(runAgain).toBeEnabled();
  await runAgain.click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ seed: 9 });
  expect(JSON.stringify(bodies[1])).not.toContain(MARKER);
  expect(JSON.stringify(bodies[1])).not.toContain(SEARCH_MARKER);
});

test('Forget my keys empties the fields and both stores and drops the held run', async ({ page }) => {
  await page.goto(`${RUN_SERVER}/sim?tab=settings`);
  await page.getByRole('button', { name: 'Reject all', exact: true }).click();
  await field(page, 'openai').fill(MARKER);
  await field(page, 'serper').fill(SEARCH_MARKER);
  const run = await page.request.post(`${RUN_SERVER}/setup`, {
    data: { ...settingsBody(mars), apiKey: MARKER, serperKey: SEARCH_MARKER },
  });
  expect(run.ok()).toBe(true);
  const { runKey } = await run.json();
  expect(typeof runKey).toBe('string');
  const chat = await page.request.post(`${RUN_SERVER}/chat`, {
    data: { runKey, agentId: 'col-bruno-morales', message: 'What happened?', apiKey: MARKER },
  });
  expect(chat.ok()).toBe(true);
  expect(await chat.json()).toMatchObject({ firstMessage: true });
  await page.evaluate(({ slot, marker }) => { localStorage.setItem(slot, JSON.stringify({ openai: marker })); },
    { slot: SLOT, marker: MARKER });

  let forgotten: { status: number; body: unknown } | undefined;
  await page.route(`${RUN_SERVER}/forget-keys`, async route => {
    // Forward the real click's request and read the full server response
    // before the page processes the cleanup and refreshes its live stream.
    const answer = await route.fetch();
    forgotten = { status: answer.status(), body: await answer.json() };
    await route.fulfill({ response: answer });
  });
  await keyGroup(page).getByRole('button', { name: 'Forget my keys', exact: true }).click();
  await expect.poll(() => forgotten).toEqual({
    status: 200, body: { runConfigsDropped: 1, chatAgentsDropped: 1 },
  });
  await expect(keyGroup(page).getByRole('status')).toHaveText('Keys forgotten. Your held run and chat agents have been cleared.');
  for (const provider of PROVIDERS) await expect(field(page, provider)).toHaveValue('');
  expect(await stores(page)).toEqual({ local: null, session: null });
  const results = await page.request.get(`${RUN_SERVER}/results`);
  expect((await results.json()).runKey).toBeNull();
});

test('Settings, Terms, Privacy, the start path, footer and share help show the agreed words', async ({ page }) => {
  await page.goto(`${RUN_SERVER}/sim?tab=settings`);
  const lines = keyGroup(page).locator('[data-testid="visitor-key-notes"] p');
  await expect(lines).toHaveText([
    'Runs on your key are billed to your OpenAI or Anthropic account, under your agreement with them.',
    "We send your key to our server for each run and chat you start. It stays in our server's memory while they are in use, for 30 minutes at most after you stop, and is never written to disk or to a log.",
    'This browser tab keeps your key until you close it. "Forget my keys" removes it now.',
    'Use a separate key with a spending limit, and delete it at your provider when you are done.',
    'Or run paracosm on your own computer, and your key never leaves it.',
  ]);
  await expect(lines.getByRole('link')).toHaveAttribute('href', '/#get-started');

  await page.goto(`${RUN_SERVER}/sim`);
  await expect(page.getByTestId('note-adults')).toHaveText(AGE);
  await expect(page.getByTestId('foot-adults')).toHaveText(AGE);

  await page.goto(`${RUN_SERVER}/#about`);
  await expect(page.locator('#about').getByText(TEACHERS, { exact: true })).toBeAttached();
  await expect(page.locator('#terms').getByText(TERMS, { exact: true })).toBeAttached();
  await expect(page.locator('#privacy').getByText(PRIVACY, { exact: true })).toBeAttached();
  await expect(page.locator('#privacy').getByText(CHILDREN, { exact: true })).toBeAttached();

  const chats: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/chat') chats.push(request.url());
  });
  await openShareNote(page);
  const note = page.getByRole('status', { name: 'Share link' });
  await expect(note.getByText(TEACHERS, { exact: true })).toBeVisible();

  await note.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'CHAT', exact: true }).click();
  await expect(page.getByText('Start your own run to chat with its characters.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agent chat', exact: true })).toHaveCount(0);
  expect(chats).toEqual([]);
});

async function openShareNote(page: Page) {
  const response = await page.request.get(`${REPLAY_SERVER}/sessions`);
  const { sessions } = await response.json() as { sessions: { id: string }[] };
  expect(sessions).toHaveLength(1);
  await page.goto(`${REPLAY_SERVER}/sim?replay=${encodeURIComponent(sessions[0].id)}&tab=sim`);
  await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
  await page.getByRole('button', { name: 'Open run actions menu' }).click();
  await page.getByRole('menuitem', { name: /Share viz link/ }).click();
}
