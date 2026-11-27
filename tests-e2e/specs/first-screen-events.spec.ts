import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContextOptions, type Locator, type Page, type Request } from '@playwright/test';
import type { FirstScreenEventName } from '../../src/analytics/first-screen-events.js';
import { lookOf, openTab, routeScenario, SERVERS } from '../support/frame.js';
import { failures, measureText, saidOf, settle, spacingFaults } from '../support/readability.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The event sink and hosted fixture run together.');

const countURL = 'http://127.0.0.1:3465/received';
const publicRunURL = 'https://paracosm.agentos.sh/sim';

type Event = { n: string; u: string; p: Record<string, string> };
const event = (name: string, fields: Event['p'] = {}): Event => ({ n: name, u: '/sim', p: fields });
const view = (entry: string, state = 'ready') => event('qs_view', { entry, state });
const tab = (to: string) => event('tab_change', { to });
const start = (key = 'host', size = '2') => event('qs_start', { picked: 'no', key, size });
const failed = (reason: string) => event('run_failed', { reason });

async function open(browser: Browser, host: string = SERVERS.demo, options: BrowserContextOptions = {}) {
  const id = randomUUID();
  const bytes = Buffer.from(id.replaceAll('-', ''), 'hex');
  const agent = 'paracosm-first-screen-events/' + id;
  const context = await browser.newContext({
    baseURL: host,
    userAgent: agent,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'x-real-ip': `198.19.${bytes[0]}.${bytes[1]}` },
    ...options,
  });
  await context.route(url => /(^|\.)(googletagmanager\.com|google-analytics\.com|clarity\.ms|plausible\.io|analytics\.manic\.agency)$/.test(url.hostname),
    route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const requests: Event[] = [];
  const posts: Request[] = [];
  const vendor: string[] = [];
  const page = await context.newPage();
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== host) vendor.push(url.hostname);
    if (request.method() !== 'POST' || url.pathname !== '/api/event') return;
    posts.push(request);
    const payload = request.postDataJSON();
    if (payload.n !== 'pageview') requests.push(payload);
  });
  const assertEvents = async (expected: Event[]) => {
    await expect.poll(() => requests.slice()).toEqual(expected);
    const sortRows = <T extends { name: string; props: Record<string, string> }>(rows: T[]): T[] => (
      rows.sort((a, b) => (a.name + JSON.stringify(a.props)).localeCompare(b.name + JSON.stringify(b.props)))
    );
    await expect.poll(async () => {
      const response = await context.request.get(countURL);
      const records = await response.json() as Array<{
        userAgent: string;
        body: { name: string; url: string; domain: string; props: Record<string, string> };
      }>;
      return sortRows(records.filter(row => row.userAgent === agent && row.body.name !== 'pageview').map(row => row.body));
    }).toEqual(sortRows(expected.map(({ n, p }) => ({
      name: n, url: publicRunURL, domain: 'paracosm.agentos.sh', props: p,
    }))));
    expect(requests).toEqual(expected);
  };
  return { context, page, requests, posts, vendor, assertEvents };
}

const band = (page: Page) => page.getByTestId('start-band');
const startKey = (page: Page) => band(page).getByTestId('start-key');
const leaders = (page: Page) => page.getByTestId('leaders');
const helpKey = (page: Page) => page.getByRole('button', { name: 'How it works', exact: true });
const moreKey = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
  .getByRole('button').filter({ has: page.locator('[data-more-label]') });
const consent = (page: Page) => page.getByRole('region', { name: 'Analytics choices' });

function gate() {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}

function quota(remaining: number) {
  return { allowed: remaining > 0, remaining, limit: 1, resetAt: Date.now() + 60_000 };
}

for (const entry of ['direct', 'from_landing'] as const) {
  test(`the first visible Run view records ${entry}`, async ({ browser }) => {
    const { context, page, assertEvents } = await open(browser);
    try {
      if (entry === 'from_landing') {
        await page.goto('/?ref=private-marker');
        await page.getByRole('link', { name: 'Launch Sim', exact: true }).first().click();
      } else {
        await page.goto('/sim?name=private-marker#private-marker', { referer: 'https://example.test/private-marker' });
      }
      await expect(startKey(page)).toBeEnabled();
      await assertEvents([view(entry)]);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId('leaders').scrollIntoViewIfNeeded();
      await assertEvents([view(entry)]);
    } finally {
      await context.close();
    }
  });
}

test('a visible Run panel waits for consent startup, then records just once', async ({ browser }) => {
  const { context, page, assertEvents } = await open(browser);
  try {
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      const state = window as unknown as { finishConsentStartup: () => void };
      const ready = new Promise<void>(resolve => { state.finishConsentStartup = resolve; });
      crypto.subtle.digest = async (...args) => {
        await ready;
        return digest(...args);
      };
    });
    await page.goto('/sim');
    await expect(startKey(page)).toBeEnabled();
    await assertEvents([]);
    await page.evaluate(() => (window as unknown as { finishConsentStartup: () => void }).finishConsentStartup());
    await assertEvents([view('direct')]);
  } finally {
    await context.close();
  }
});

test('a hidden Run panel sends no view while the allowance is pending or after it settles', async ({ browser }) => {
  const { context, page, assertEvents } = await open(browser);
  const count = gate();
  try {
    await page.route('**/rate-limit', async route => {
      await count.held;
      await route.fulfill({ json: quota(0) });
    });
    await page.goto('/sim?tab=sim');
    await openTab(page, 'quickstart');
    await expect(band(page)).toHaveAttribute('data-state', 'waiting');
    await openTab(page, 'reports');
    const settled = page.waitForResponse('**/rate-limit');
    count.release();
    await settled;
    await assertEvents([tab('quickstart'), tab('reports')]);

    await openTab(page, 'quickstart');
    await expect(band(page).getByTestId('at-limit')).toBeVisible();
    const visibleLimit = [tab('quickstart'), view('from_tab', 'no_run_left'), event('qs_no_run_left_view')];
    const expected = [tab('quickstart'), tab('reports'), ...visibleLimit];
    await assertEvents(expected);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertEvents(expected);
    await openTab(page, 'sim');
    await openTab(page, 'quickstart');
    await assertEvents([...expected, tab('sim'), ...visibleLimit]);
  } finally {
    count.release();
    await context.close();
  }
});

test('pair, help and frame count each changed selection once', async ({ browser }) => {
  const { context, page, assertEvents } = await open(browser);
  try {
    await routeScenario(page, scenario => ({
      ...scenario, policies: { ...scenario.policies, characterChat: true },
    }));
    await page.goto('/sim');
    await expect(leaders(page).getByRole('article')).toHaveCount(2);
    await assertEvents([view('direct')]);
    await page.setViewportSize({ width: 390, height: 844 });
    const second = leaders(page).getByRole('tab').nth(1);
    await second.click();
    await second.click();
    await second.press('ArrowLeft');
    await expect(leaders(page).getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 1440, height: 900 });
    await helpKey(page).click();
    await page.getByTestId('how-it-works-close').click();
    await helpKey(page).click();
    await page.keyboard.press('Escape');
    await openTab(page, 'sim');
    await helpKey(page).click();
    await page.keyboard.press('Escape');
    await openTab(page, 'quickstart');
    await openTab(page, 'quickstart');
    await openTab(page, 'reports');
    await moreKey(page).click();
    await page.keyboard.press('Escape');

    const expected = [
      view('direct'), event('qs_pair_switch', { to: '2' }), event('qs_pair_switch', { to: '1' }),
      event('qs_how_open'), event('qs_how_open'), tab('sim'), event('qs_how_open'),
      tab('quickstart'), view('from_tab'), tab('reports'),
    ];
    await assertEvents(expected);
    await moreKey(page).focus();
    await moreKey(page).press('Enter');
    await page.getByRole('menuitem', { name: /^Studio / }).press('Enter');
    expected.push(tab('studio'));
    for (const section of ['viz', 'chat', 'library', 'settings'] as const) {
      await openTab(page, section);
      expected.push(tab(section));
    }
    await moreKey(page).click();
    const menu = page.getByRole('menu', { name: 'Sections', exact: true });
    const docs = menu.getByRole('menuitem').filter({ has: page.getByText('Docs', { exact: true }) });
    const popup = context.waitForEvent('page');
    await docs.click({ modifiers: ['Control'] });
    await (await popup).close();
    await assertEvents(expected);
    await openTab(page, 'about');
    await expect(page).toHaveURL(url => url.pathname === '/');
    await assertEvents([...expected, tab('about')]);
  } finally {
    await context.close();
  }
});

for (const size of [24, 300]) {
  test(`a run of ${size} counts each change of the shown leader on a phone`, async ({ browser }) => {
    const { context, page, assertEvents } = await open(browser, SERVERS.demo, { viewport: { width: 390, height: 844 } });
    try {
      await saveKey(page);
      await page.goto(`/sim?size=${size}`);
      await expect(startKey(page)).toBeEnabled();
      await expect(page.getByTestId('writes-all')).toBeVisible();
      await assertEvents([view('direct')]);
      const second = leaders(page).getByRole('tab').nth(1);
      await second.click();
      await second.click();
      await second.press('ArrowLeft');
      await expect(leaders(page).getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
      await assertEvents([view('direct'), event('qs_pair_switch', { to: '2' }), event('qs_pair_switch', { to: '1' })]);
    } finally {
      await context.close();
    }
  });
}

test('double presses through preflight and setup count one real launch', async ({ browser }) => {
  const { context, page, assertEvents } = await open(browser);
  const count = gate();
  const setup = gate();
  let holdCount = false;
  let setups = 0;
  try {
    await page.route('**/rate-limit', async route => {
      if (holdCount) await count.held;
      await route.continue();
    });
    await page.route('**/setup', async route => {
      setups++;
      await setup.held;
      await route.continue();
    });
    await page.goto('/sim');
    await expect(startKey(page)).toBeEnabled();
    holdCount = true;
    await startKey(page).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(band(page)).toHaveAttribute('data-state', 'checking');
    count.release();
    await expect(band(page)).toHaveAttribute('data-state', 'starting');
    await startKey(page).dispatchEvent('click');
    await expect(page.getByTestId('shared-colony').locator('canvas')).toBeVisible();
    await assertEvents([view('direct'), start()]);
    setup.release();
    await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'sim');
    expect(setups).toBe(1);
    await assertEvents([view('direct'), start(), event('run_started', { key: 'host' })]);
  } finally {
    count.release();
    setup.release();
    await context.request.post('/clear').catch(() => undefined);
    await context.close();
  }
});

const refusedSetups = [
  { label: 'server quota', status: 429, body: { remaining: 0 }, reason: 'no_run_left' },
  { label: 'busy', status: 503, body: {}, reason: 'capacity' },
  { label: 'all slots', status: 503, body: { maxRuns: 2 }, reason: 'capacity' },
  { label: 'aborted connection', status: null, body: {}, reason: 'network' },
  { label: 'visitor key refusal', status: 401, own: true, body: {}, reason: 'key_refused' },
  { label: 'server error', status: 500, body: {}, reason: 'other' },
  { label: 'missing redirect', status: 200, body: {}, reason: 'other' },
];

for (const refusal of refusedSetups) {
  test(`a launch with ${refusal.label} counts a single failure`, async ({ browser }) => {
    const { context, page, assertEvents } = await open(browser);
    try {
      if (refusal.own) await saveKey(page);
      await page.route('**/setup', route => refusal.status === null
        ? route.abort('failed')
        : route.fulfill({ status: refusal.status, json: refusal.body }));
      await page.goto('/sim');
      await expect(startKey(page)).toBeEnabled();
      await startKey(page).click();
      const key = refusal.own ? 'own' : 'host';
      const expected = [view('direct'), start(key), failed(refusal.reason)];
      if (refusal.reason === 'no_run_left') expected.push(event('qs_no_run_left_view'));
      await assertEvents(expected);
      if (refusal.status === 500) {
        await expect(startKey(page)).toBeEnabled();
        await startKey(page).click();
        await assertEvents([...expected, start(key), failed(refusal.reason)]);
      }
    } finally {
      await context.close();
    }
  });
}

async function saveKey(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('paracosm:keyOverrides', '{"openai":"sk-test"}'));
}

for (const size of [24, 300]) {
  test(`a keyed run of ${size} sends its size bucket and the launch outcome`, async ({ browser }) => {
    const { context, page, assertEvents } = await open(browser);
    try {
      await saveKey(page);
      let setups = 0;
      await page.route('**/api/quickstart/generate-actors', async route => {
        expect(route.request().postDataJSON().count).toBe(size);
        if (size === 300) {
          await route.fulfill({ status: 429, json: { remaining: 0 } });
          return;
        }
        const response = await context.request.get('/scenario');
        const scenario = await response.json();
        const preset = scenario.presets[0];
        const template = (preset.leaders ?? preset.actors)[0];
        const actors = Array.from({ length: size }, (_, i) => ({ ...template, name: `private-marker-${i}` }));
        await route.fulfill({ json: { actors } });
      });
      await page.route('**/events', route => {
        if (setups === 0) return route.continue();
        return route.fulfill({
          contentType: 'text/event-stream',
          body: 'event: sim_error\ndata: {"error":"Fixture simulation ended early"}\n\n',
        });
      });
      await page.route('**/setup', async route => {
        setups++;
        expect(route.request().postDataJSON().actors).toHaveLength(size);
        await route.fulfill({ json: { redirect: '/sim' } });
      });
      await page.goto(`/sim?size=${size}`);
      await expect(startKey(page)).toBeEnabled();
      await startKey(page).click();
      if (size === 24) {
        await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'sim');
        expect(setups).toBe(1);
        await expect(page.getByText('Fixture simulation ended early', { exact: true })).toBeVisible();
        await assertEvents([view('direct'), start('own', '9_24'), event('run_started', { key: 'own' })]);
      } else {
        await assertEvents([view('direct'), start('own', '101_300'), failed('other')]);
        expect(setups).toBe(0);
      }
    } finally {
      await context.close();
    }
  });
}

for (const choice of ['own', 'team', 'neither', 'ready'] as const) {
  test(`the replay and Settings actions under the ${choice} allowance state`, async ({ browser }) => {
    const { context, page, assertEvents } = await open(browser);
    try {
      const response = await context.request.get('http://127.0.0.1:3472/legacy-notice-fixture');
      const { id } = await response.json() as { id: string };
      let preflight = false;
      let setups = 0;
      await page.route('**/setup', route => { setups++; return route.abort(); });
      await page.route('**/rate-limit', route => route.fulfill({ json: quota(preflight ? 0 : 1) }));
      await page.route('**/sessions', route => route.fulfill({ json: { sessions: choice === 'neither' ? [] : [
        { id, pinned: choice === 'team', leaders: ['Leader A', 'Leader B'], scenarioName: 'Atlas Lab', turnCount: 6 },
      ] } }));
      await page.goto('/sim');
      await expect(startKey(page)).toBeEnabled();
      const expected = [view('direct')];
      if (choice === 'ready') {
        await page.getByTestId('last-run-link').click();
        await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'sim');
      } else {
        preflight = true;
        await startKey(page).click();
        await expect(band(page).getByTestId('at-limit')).toBeVisible();
        expected.push(start(), failed('no_run_left'), event('qs_no_run_left_view'));
        if (choice === 'neither') {
          await expect(page.getByTestId('replay-key')).toHaveCount(0);
          await page.getByTestId('add-key-link').click();
          await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'settings' && url.searchParams.get('focus') === 'api-key');
          expected.push(event('qs_no_run_left_action', { action: 'add_key' }));
        } else {
          await page.getByTestId('replay-key').click();
          await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'sim' && url.href.includes(id));
          expected.push(event('qs_no_run_left_action', { action: 'replay_last' }));
        }
      }
      expect(setups).toBe(0);
      await assertEvents(expected);
    } finally {
      await context.close();
    }
  });
}

test('the installed dashboard sends nothing during actual Run and frame actions', async ({ browser }) => {
  const { context, page, posts, vendor, assertEvents } = await open(browser, SERVERS.dashboard);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sim');
    await expect(consent(page)).toHaveCount(0);
    await leaders(page).getByRole('tab').nth(1).click();
    await helpKey(page).click();
    await page.keyboard.press('Escape');
    await openTab(page, 'sim');
    await openTab(page, 'quickstart');
    await expect(startKey(page)).toBeEnabled();
    expect(await page.evaluate(() => ['paracosmConsent', 'gtag', 'clarity'].filter(key => key in window))).toEqual([]);
    expect(posts).toEqual([]);
    expect(vendor).toEqual([]);
    await assertEvents([]);
  } finally {
    await context.close();
  }
});

for (const look of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`the dashboard Privacy link shows the disclosures in ${look} at ${width} px`, async ({ browser }) => {
      const { context, page } = await open(browser, SERVERS.demo, {
        viewport: { width, height: 844 },
        deviceScaleFactor: 2,
      });
      try {
        await context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
        await page.goto('/sim');
        await consent(page).getByRole('button', { name: 'Reject all', exact: true }).click();
        const foot = page.getByRole('contentinfo').getByRole('navigation', { name: 'Site links' });
        await foot.getByRole('link', { name: 'Privacy', exact: true }).click();
        await expect(page).toHaveURL(url => url.pathname === '/' && url.hash === '#privacy');
        expect((await lookOf(page)).light).toBe(look === 'light');
        await expect(consent(page)).toBeHidden();

        const privacy = page.locator('#privacy');
        await expect(privacy.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
        const paragraphs = privacy.locator('p');
        for (const [lead, text] of [
          ['Viewing the Run screen', /Plausible counts.*Google Analytics 4 measures.*Microsoft Clarity marks/],
          ['Opening How it works', /switching between the two leaders.*choosing a section.*Plausible.*Google Analytics 4/],
          ['To run a simulation', /OpenAI or Anthropic.*orders you write for a leader/],
          ['Our server saves finished runs', /visitor cookie lets this browser list your saved runs.*runs our team has pinned/],
          ['Anyone with a replay link', /watch that run.*orders you wrote that appear in the replay.*original brief is visible only to your browser/],
          ['We keep your saved replay', /ten newer runs.*50 unpinned replays.*removed sooner/],
          ['This browser keeps a separate history', /on this device.*Clearing this site's data.*removes that local history/],
        ] as const) {
          await expect(paragraphs.filter({ hasText: lead })).toContainText(text);
        }
        await expect(privacy).not.toContainText("shows on no one else's");

        const date = privacy.locator('time[datetime]');
        await expect(date).toHaveCount(1);
        await expect(date).toBeVisible();
        await expect(date).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
        const published = new Date((await date.getAttribute('datetime')) + 'T00:00:00Z');
        await expect(date).toHaveText(new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(published));
        await expect(date.locator('..')).toContainText('Updated');

        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await expect.poll(() => privacy.locator('.rv').evaluateAll(parts => (
          parts.length > 0 && parts.every(part => getComputedStyle(part).opacity === '1')
        ))).toBe(true);
        await expect(paragraphs.first()).toBeVisible();
        await expect(paragraphs.last()).toBeVisible();

        if (width === 390) {
          const measured = await measureText(page, privacy);
          for (const words of ['Viewing the Run screen', 'Opening How it works', 'To run a simulation',
            'Our server saves finished runs', 'Anyone with a replay link', 'We keep your saved replay',
            'This browser keeps a separate history', 'data policy', "Clarity's terms", await date.innerText()]) {
            expect(measured.some(row => row.text.includes(words)), words).toBe(true);
          }
          expect(failures(measured).map(saidOf)).toEqual([]);
        }

        await privacy.screenshot({
          path: `test-pictures/sim-first-screen/events-privacy/${width}-${look}.png`,
          animations: 'disabled',
          scale: 'device',
          style: '.nav { visibility: hidden; }',
        });
      } finally {
        await context.close();
      }
    });
  }
}

// The privacy section as a visitor reads it, at every width the site
// designs for, and the review material the pull request publishes.

const PRIVACY_WIDTHS = [320, 360, 390, 430, 480, 600, 768, 1100, 1440] as const;
const WALKED_WIDTHS: readonly number[] = [320, 390, 1440];
const MEASURED_WIDTHS: readonly number[] = [320, 390, 600, 768, 1100, 1440];
/** Words from each text node of the section: a measure that misses one of them fails. */
const DISCLOSURE_WORDS = [
  'Privacy', 'Updated', 'use up to three tools', 'Count visits: Plausible Analytics', 'Measure use: Google Analytics 4',
  'Record sessions: Microsoft Clarity', 'Viewing the Run screen', 'Opening How it works',
  'If your browser sends a privacy signal', 'Strictly necessary', 'paracosm_scenario', 'paracosm_visitor', '_clck',
  'To run a simulation', 'Our server saves finished runs', 'Anyone with a replay link', 'We keep your saved replay',
  'This browser keeps a separate history', 'To apply its usage limits', 'If you add API keys',
  'Paracosm is for a general audience', 'A copy of Paracosm you install', '/sim', 'data policy', "Clarity's terms",
  'team@frame.dev',
] as const;
/** The paragraphs held to the body text's figures. */
const BODY_LEADS = [
  'use up to three tools', 'Viewing the Run screen', 'Opening How it works', 'To run a simulation',
  'Our server saves finished runs', 'Anyone with a replay link', 'We keep your saved replay',
  'This browser keeps a separate history',
] as const;
const NAMED_EVENTS: readonly FirstScreenEventName[] = [
  'qs_view', 'qs_start', 'run_started', 'run_failed', 'qs_how_open',
  'qs_no_run_left_view', 'qs_no_run_left_action', 'qs_pair_switch', 'tab_change',
];
/** WCAG 1.4.12's text spacing, as the W3C's bookmarklet sets it, on the privacy section. */
const PRIVACY_TEXT_SPACING = [
  '#privacy, #privacy * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }',
  '#privacy p { margin-bottom: 2em !important; }',
].join('\n');

/** Opens the landing page's privacy section on the hosted server in one look, the bar answered. */
async function openPrivacy(browser: Browser, width: number, look: 'light' | 'dark', options: BrowserContextOptions = {}) {
  const opened = await open(browser, SERVERS.demo, { viewport: { width, height: 844 }, ...options });
  await opened.context.addInitScript(theme => localStorage.setItem('paracosm-theme', theme), look);
  const { page } = opened;
  if (WALKED_WIDTHS.includes(width)) {
    await page.goto('/sim');
    await consent(page).getByRole('button', { name: 'Reject all', exact: true }).click();
    const foot = page.getByRole('contentinfo').getByRole('navigation', { name: 'Site links' });
    await foot.getByRole('link', { name: 'Privacy', exact: true }).click();
  } else {
    await page.goto('/#privacy');
    await consent(page).getByRole('button', { name: 'Reject all', exact: true }).click();
  }
  await expect(page).toHaveURL(url => url.pathname === '/' && url.hash === '#privacy');
  await expect(consent(page)).toBeHidden();
  expect((await lookOf(page)).light).toBe(look === 'light');
  const privacy = page.locator('#privacy');
  await expect(privacy.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  return { ...opened, privacy };
}

/** Waits for the local fonts and for every scroll-revealed part of the section to show in full. */
async function revealed(page: Page, privacy: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(() => privacy.locator('.rv').evaluateAll(parts => (
    parts.length > 0 && parts.every(part => getComputedStyle(part).opacity === '1')
  ))).toBe(true);
  await settle(privacy);
}

/** How far the whole document reaches past the window's width, and the parts that reach past it. */
async function sideways(page: Page): Promise<{ over: number; past: string[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    const past = over <= 1 ? [] : Array.from(document.querySelectorAll('body *'))
      .filter(el => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 8)
      .map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
        + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''));
    return { over, past };
  });
}

/** Each part of the section with words of its own: its role and its line height over its font size. */
async function lineHeights(privacy: Locator): Promise<Array<{ text: string; role: string; ratio: number }>> {
  return privacy.evaluate(root => Array.from(root.querySelectorAll('*')).flatMap(el => {
    const own = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
    if (!own) return [];
    const cs = getComputedStyle(el);
    const role = el.closest('[data-text]')?.getAttribute('data-text') ?? 'other';
    const lineHeight = cs.lineHeight === 'normal' ? Number.NaN : parseFloat(cs.lineHeight);
    return [{ text: own.slice(0, 48), role, ratio: lineHeight / parseFloat(cs.fontSize) }];
  }));
}

/** Every part of the section drawn past either side of the window. */
async function outsideWindow(privacy: Locator): Promise<string[]> {
  return privacy.evaluate(root => Array.from(root.querySelectorAll('*')).flatMap(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || (r.left >= -1 && r.right <= window.innerWidth + 1)) return [];
    return [`${el.tagName.toLowerCase()} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`];
  }));
}

/**
 * Words drawn over other words, read from where each text node draws its
 * lines. A link that wraps keeps its words on its own lines, so its box is
 * not read as a control over the paragraph around it.
 */
async function wordsOverWords(privacy: Locator): Promise<string[]> {
  return privacy.evaluate(root => {
    const lines: Array<{ said: string; node: Node; rect: DOMRect }> = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const said = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!said) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0 && rect.height > 0) lines.push({ said: said.slice(0, 40), node, rect });
      }
    }
    const out: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const [p, q] = [lines[i].rect, lines[j].rect];
        if (lines[i].node === lines[j].node) continue;
        const across = Math.min(p.right, q.right) - Math.max(p.left, q.left);
        const down = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
        if (across > 2 && down > 2) out.push(`"${lines[i].said}" over "${lines[j].said}"`);
      }
    }
    return out;
  });
}

/** Clipped words, words over other words, and sideways scroll of the whole document. */
async function expectLaidOut(page: Page, privacy: Locator, where: string): Promise<void> {
  const faults = await spacingFaults(privacy);
  expect.soft(faults.cut, `${where}: no word is cut`).toEqual([]);
  expect.soft(await wordsOverWords(privacy), `${where}: no word overlaps another`).toEqual([]);
  expect.soft(await outsideWindow(privacy), `${where}: every part stays inside the window`).toEqual([]);
  const { over, past } = await sideways(page);
  expect.soft(over, `${where}: the page does not scroll sideways (${past.join(', ')})`).toBeLessThanOrEqual(1);
}

/** Every disclosure measured on its drawn ground, held to its role's figures. */
async function expectMeasured(page: Page, privacy: Locator, where: string): Promise<void> {
  const measured = await measureText(page, privacy);
  const date = await privacy.locator('time[datetime]').innerText();
  for (const words of [...DISCLOSURE_WORDS, date]) {
    expect.soft(measured.some(row => row.text.includes(words)), `${where}: "${words}" is measured`).toBe(true);
  }
  for (const lead of BODY_LEADS) {
    expect.soft(measured.find(row => row.text.includes(lead))?.role, `${where}: "${lead}" is body text`).toBe('body');
  }
  expect.soft(measured.find(row => row.text === 'Privacy')?.role, `${where}: the title is a heading`).toBe('heading');
  expect.soft(measured.find(row => row.text === date)?.role, `${where}: the date is a label`).toBe('other');
  expect.soft(failures(measured).map(saidOf), `${where}: body and headings at 18 px and 12:1, labels at 15 px and 7:1`).toEqual([]);
}

/** A link reached by the keyboard draws a ring at least 2 px wide, at 4.5:1 or more on the section's ground. */
async function expectFocusRing(page: Page, privacy: Locator, where: string): Promise<void> {
  const link = privacy.locator('a[href]').first();
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const ring = await link.evaluate(el => {
    const rgb = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]): number => {
      const [lr, lg, lb] = [r, g, b].map(c => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const cs = getComputedStyle(el);
    const colour = rgb(cs.outlineColor);
    const ground = rgb(getComputedStyle(el.closest('#privacy') ?? document.body).backgroundColor);
    const [hi, lo] = [luminance(colour), luminance(ground)].sort((a, b) => b - a);
    return {
      focusVisible: el.matches(':focus-visible'),
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
      opaque: (colour[3] ?? 1) === 1 && (ground[3] ?? 1) === 1,
      ratio: (hi + 0.05) / (lo + 0.05),
    };
  });
  expect.soft(ring.focusVisible, `${where}: the keyboard's focus shows`).toBe(true);
  expect.soft(ring.style, `${where}: the focus ring is drawn`).not.toBe('none');
  expect.soft(ring.width, `${where}: the focus ring's width`).toBeGreaterThanOrEqual(2);
  expect.soft(ring.opaque, `${where}: the ring and its ground are opaque`).toBe(true);
  expect.soft(ring.ratio, `${where}: the focus ring's contrast`).toBeGreaterThanOrEqual(4.5);
}

for (const look of ['light', 'dark'] as const) {
  for (const width of PRIVACY_WIDTHS) {
    test(`the privacy section reads whole in ${look} at ${width} px`, async ({ browser }) => {
      test.setTimeout(120_000);
      const where = `${width} px, ${look}`;
      const { context, page, privacy } = await openPrivacy(browser, width, look);
      try {
        await revealed(page, privacy);
        await expectLaidOut(page, privacy, where);

        if (MEASURED_WIDTHS.includes(width)) {
          await expectMeasured(page, privacy, where);
          for (const row of await lineHeights(privacy)) {
            const least = row.role === 'body' ? 1.55 : 1.4;
            expect.soft(row.ratio + 0.001, `${where}: "${row.text}" (${row.role}) line height`).toBeGreaterThanOrEqual(least);
          }
        }

        if (WALKED_WIDTHS.includes(width)) {
          // Read the section through the last line of its last paragraph.
          const last = privacy.locator('p').last();
          await expect(last).toContainText('Questions about this site');
          await last.scrollIntoViewIfNeeded();
          // The page scrolls smoothly, so the read repeats until the scroll has ended.
          await expect.poll(() => last.evaluate(el => {
            const words = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
            const range = document.createRange();
            range.selectNodeContents(words[words.length - 1]);
            const rects = Array.from(range.getClientRects());
            const line = rects[rects.length - 1];
            const hit = document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2);
            return line.top >= 0 && line.bottom <= window.innerHeight && hit !== null && el.contains(hit);
          }), { message: `${where}: the section's last line shows, with nothing over it` }).toBe(true);
          await expectFocusRing(page, privacy, where);
          // The consent control still opens from the page's foot.
          await page.getByRole('contentinfo').getByRole('button', { name: 'Analytics choices', exact: true }).click();
          await expect(consent(page)).toBeVisible();
          await expect(consent(page).getByRole('button', { name: 'Reject all', exact: true })).toBeVisible();
        }
      } finally {
        await context.close();
      }
    });
  }

  test(`the privacy section at 320 px in ${look} keeps every word at 200% text with WCAG text spacing`, async ({ browser }) => {
    test.setTimeout(120_000);
    const where = `320 px, ${look}, 200% text and text spacing`;
    const { context, page, privacy } = await openPrivacy(browser, 320, look);
    try {
      await revealed(page, privacy);
      // Every size read first, then each set to twice itself, so no size doubles twice.
      await privacy.evaluate(root => {
        const sized = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].map(el => {
          const cs = getComputedStyle(el);
          return { el: el as HTMLElement, fontSize: parseFloat(cs.fontSize) };
        });
        for (const { el, fontSize } of sized) el.style.setProperty('font-size', `${fontSize * 2}px`, 'important');
      });
      await page.addStyleTag({ content: PRIVACY_TEXT_SPACING });
      await settle(privacy);
      expect(await privacy.locator('p').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(36);
      await expectLaidOut(page, privacy, where);
    } finally {
      await context.close();
    }
  });
}

test('the privacy section shows at once and reads whole under reduced motion', async ({ browser }) => {
  test.setTimeout(120_000);
  const where = '320 px, dark, reduced motion';
  const { context, page, privacy } = await openPrivacy(browser, 320, 'dark', { reducedMotion: 'reduce' });
  try {
    // No scroll and no wait reveals it: every part is already shown in full.
    expect(await privacy.locator('.rv').evaluateAll(parts => (
      parts.length > 0 && parts.every(part => getComputedStyle(part).opacity === '1')
    )), `${where}: the section needs no reveal`).toBe(true);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expectLaidOut(page, privacy, where);
    await expectMeasured(page, privacy, where);
  } finally {
    await context.close();
  }
});

test('the API guide names the nine dashboard events the count route takes', () => {
  const guide = readFileSync(new URL('../../docs/HTTP_API.md', import.meta.url), 'utf8');
  const start = guide.indexOf('## `POST /api/event`');
  expect(start, 'the guide has a section for the count route').toBeGreaterThan(-1);
  const end = guide.indexOf('\n## ', start + 1);
  const section = guide.slice(start, end === -1 ? undefined : end);
  for (const name of NAMED_EVENTS) expect.soft(section, name).toContain('`' + name + '`');
  expect(section, 'the named event body').toContain('"n": "qs_pair_switch"');
  expect(section, 'the page view body').toContain('{ "n": "pageview", "u": "/sim" }');
});

test('the pull request publishes the four privacy pictures at twice their width', () => {
  for (const look of ['light', 'dark'] as const) {
    for (const width of [390, 1440]) {
      const png = readFileSync(new URL(`../../docs/design/sim-first-screen/events-privacy/${width}-${look}.png`, import.meta.url));
      expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${width}-${look} is a PNG`).toBe(true);
      expect(png.toString('latin1', 12, 16), `${width}-${look} starts with its header`).toBe('IHDR');
      expect(png.readUInt32BE(16), `${width}-${look} is ${width * 2} pixels wide`).toBe(width * 2);
    }
  }
});
