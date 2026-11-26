import { networkInterfaces } from 'node:os';
import { openTab } from '../support/frame.js';
import { expect, test, type Page, type Request } from '@playwright/test';
import { mars, settingsBody } from '../../tests/cli/helpers/run-server.js';
import { pressStart } from '../support/start-run.js';

const RUN_SERVER = 'http://127.0.0.1:3470';
const CONSENT_SERVER = 'http://127.0.0.1:3464';
const REPLAY_SERVER = 'http://127.0.0.1:3462';
const SLOT = 'paracosm:keyOverrides';
const LAST_LAUNCH = 'paracosm:lastLaunchConfig';
const MARKER = 'visitor-key-browser-fixture';
const SEARCH_MARKER = 'visitor-search-browser-fixture';
const AGE = "Under 18? You need a parent's or guardian's permission to use this. Not for children under 13.";
const TEACHERS = "For teachers: run a simulation yourself and show it to your class, or share its replay link. A replay only plays back a finished run, and sends nothing new to an AI model.";
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
  await expect(page.getByTestId('note-ai')).toBeAttached();
  await expect.poll(() => stores(page)).toEqual({ local: null, session: old });
  expect(await savedLaunch(page)).toEqual(settingsBody(mars));
  await openTab(page, 'settings');
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
  const watchUrl = `${RUN_SERVER}/sim?tab=sim`;
  await page.goto(watchUrl);
  await expect(runAgain).toBeEnabled();
  // The redirect returns to the same URL. Wait for the new document and
  // the replayed completion event before reading its storage.
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame() && frame.url() === watchUrl),
    runAgain.click(),
  ]);
  await expect(runAgain).toBeEnabled();

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ seed: 8, apiKey: MARKER, serperKey: SEARCH_MARKER });
  const launch = await savedLaunch(page);
  expect(launch).toMatchObject({ seed: 8 });
  expect(JSON.stringify(launch)).not.toContain(MARKER);
  expect(JSON.stringify(launch)).not.toContain(SEARCH_MARKER);
  expect(await stores(page)).toEqual({
    local: null,
    session: JSON.stringify({ openai: MARKER, serper: SEARCH_MARKER }),
  });

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
  // The age terms live in the landing's Terms section alone, never on the app's screens.
  await expect(page.getByTestId('note-adults')).toHaveCount(0);
  await expect(page.getByTestId('foot-adults')).toHaveCount(0);
  await expect(page.getByText(AGE, { exact: true })).toHaveCount(0);

  await page.goto(`${RUN_SERVER}/#about`);
  await expect(page.locator('#about').getByText(TEACHERS, { exact: true })).toBeAttached();
  await expect(page.locator('#terms').getByText(TERMS, { exact: true })).toBeAttached();
  await expect(page.locator('#terms').getByText(AGE, { exact: true })).toBeAttached();
  await expect(page.locator('#about')).not.toContainText("guardian's permission");
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
  await openTab(page, 'chat');
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

// A scripted-runner server these tests have to themselves (playwright.config.ts): the runs they start take no place
// on the server the run-per-visitor spec fills to its cap.
const SCRIPTED_SERVER_PORT = 3475;
const VISITOR_KEY = 'sk-test-0000';
const REFUSAL = 'Send API keys over HTTPS, or use a dashboard on this computer.';

function networkDashboard(): string {
  const address = Object.values(networkInterfaces()).flat().find(entry => entry?.family === 'IPv4' && !entry.internal);
  if (!address) throw new Error('The visitor-key browser test needs a non-loopback IPv4 address.');
  return `http://${address.address}:${SCRIPTED_SERVER_PORT}`;
}

function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', request => requests.push(request));
  return requests;
}

function expectNoVisitorKey(requests: Request[]): void {
  const matchingPaths = requests
    .filter(request => request.postData()?.includes(VISITOR_KEY))
    .map(request => new URL(request.url()).pathname);
  expect(matchingPaths).toEqual([]);
}

const againButton = (page: Page) => page.getByRole('button', { name: /Run again with seed/ });
const chatRegion = (page: Page) => page.getByRole('region', { name: 'Agent chat' });

async function enterVisitorKey(page: Page): Promise<void> {
  await openTab(page, 'settings');
  await field(page, 'openai').fill(VISITOR_KEY);
}

async function saveLastLaunch(page: Page): Promise<void> {
  // Run again uses the saved Settings launch, which Start does not write.
  await page.evaluate(({ slot, launch }) => localStorage.setItem(slot, launch),
    { slot: LAST_LAUNCH, launch: JSON.stringify(settingsBody(mars)) });
}

async function typeChat(page: Page): Promise<void> {
  await openTab(page, 'chat');
  await chatRegion(page).getByRole('button', { name: /Lena Ortiz/ }).first().click();
  await chatRegion(page).getByRole('textbox', { name: 'Message Lena Ortiz' }).fill('How is the greenhouse?');
}

test('network HTTP keeps the visitor key in Settings through Start, Run again and chat', async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto(`${networkDashboard()}/sim?tab=sim`);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

  // A search field that holds only spaces is no key to the server, so it
  // holds no run back here either.
  await openTab(page, 'settings');
  await field(page, 'serper').fill('   ');

  // Make a finished Mars Genesis run without a visitor key, using the real
  // scenario and /setup. That supplies both Run again and the Chat roster.
  await pressStart(page);
  await expect(againButton(page)).toBeEnabled();
  await enterVisitorKey(page);
  await saveLastLaunch(page);
  const settingsRefusal = keyGroup(page).getByText(REFUSAL, { exact: true });
  await expect.soft(settingsRefusal).toBeVisible();

  await typeChat(page);
  await chatRegion(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect.soft(chatRegion(page).getByText(REFUSAL, { exact: true })).toBeVisible();

  await openTab(page, 'sim');
  await againButton(page).click();
  await expect.soft(againButton(page).locator('..').getByText(REFUSAL, { exact: true })).toBeVisible();

  await pressStart(page);
  await expect.soft(page.getByTestId('start-band').getByText(REFUSAL, { exact: true })).toBeVisible();
  await openTab(page, 'settings');
  await expect(field(page, 'openai')).toHaveValue(VISITOR_KEY);
  expectNoVisitorKey(requests);
});

test('loopback HTTP still sends the visitor key on Start, Run again and chat', async ({ page }) => {
  const requests = recordRequests(page);
  // Keep the browser's real chat request and answer without calling a model.
  await page.route('**/chat', route => route.fulfill({ json: { reply: 'The greenhouse is open.' } }));
  await page.goto(`http://localhost:${SCRIPTED_SERVER_PORT}/sim?tab=sim`);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await enterVisitorKey(page);
  await saveLastLaunch(page);
  await expect(keyGroup(page).getByText(REFUSAL, { exact: true })).toHaveCount(0);

  await pressStart(page);
  await expect(againButton(page)).toBeEnabled();
  const rerun = page.waitForResponse(response => new URL(response.url()).pathname === '/setup');
  const loaded = page.waitForEvent('load');
  await againButton(page).click();
  expect((await rerun).ok()).toBe(true);
  await loaded;
  await expect(againButton(page)).toBeEnabled();

  await typeChat(page);
  await chatRegion(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chatRegion(page).getByText('The greenhouse is open.')).toBeVisible();

  const keyRequests = requests.filter(request => request.postData()?.includes(VISITOR_KEY));
  expect(keyRequests.map(request => new URL(request.url()).pathname)).toEqual(['/setup', '/setup', '/chat']);
  for (const request of keyRequests) expect(request.postDataJSON()).toMatchObject({ apiKey: VISITOR_KEY });
});

test('a key forgotten while a Digital Twin run waits on its reset never reaches that run', async ({ page }) => {
  // The twin run's own answer is not under test: the request's body is.
  const twinBodies: string[] = [];
  await page.route('**/api/quickstart/simulate-intervention', route => {
    twinBodies.push(route.request().postData() ?? '');
    return route.fulfill({ status: 500, json: { error: 'The twin run is not under test here.' } });
  });
  await page.goto(`http://localhost:${SCRIPTED_SERVER_PORT}/sim?tab=settings`);
  await field(page, 'openai').fill(VISITOR_KEY);
  await field(page, 'openai').blur();
  await expect.poll(async () => (await stores(page)).session ?? '').toContain(VISITOR_KEY);
  await page.goto(`http://localhost:${SCRIPTED_SERVER_PORT}/sim?tab=quickstart`);

  // Hold the reset's /clear, which the card awaits before it posts the run.
  let releaseClear = () => {};
  const clearHeld = new Promise<void>(resolve => { releaseClear = resolve; });
  let clearSeen = () => {};
  const clearArrived = new Promise<void>(resolve => { clearSeen = resolve; });
  await page.route('**/clear', async route => {
    clearSeen();
    await clearHeld;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Patient · treatment' }).click();
  await page.getByRole('button', { name: 'Run digital twin' }).click();
  await clearArrived;

  await openTab(page, 'settings');
  await page.getByRole('button', { name: 'Forget my keys', exact: true }).click();
  await expect.poll(async () => (await stores(page)).session ?? '').not.toContain(VISITOR_KEY);
  releaseClear();

  await expect.poll(() => twinBodies.length).toBe(1);
  expect(twinBodies[0]).not.toContain(VISITOR_KEY);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const look of ['dark', 'light'] as const) {
    test(`network HTTP key notice at ${viewport.width} in ${look}`, async ({ page }, testInfo) => {
      // Every project would write the same four files, so one project takes the pictures.
      test.skip(testInfo.project.name !== 'chromium-desktop', 'The desktop project takes the pictures.');
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: look, reducedMotion: 'reduce' });
      await page.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
      await page.goto(`${networkDashboard()}/sim?tab=settings`);
      const settings = keyGroup(page);
      await expect(settings.getByText(REFUSAL, { exact: true })).toBeVisible();
      // Give the Settings scroll pane enough height to capture the whole fieldset.
      const height = await settings.evaluate(el => Math.ceil(el.getBoundingClientRect().height));
      await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height + 240) });
      await settings.scrollIntoViewIfNeeded();
      await expect(settings).toBeInViewport({ ratio: 0.99 });
      await settings.screenshot({
        path: `test-pictures/keys-secure-context/${viewport.width}-${look}.png`,
        animations: 'disabled',
      });
    });
  }
}
