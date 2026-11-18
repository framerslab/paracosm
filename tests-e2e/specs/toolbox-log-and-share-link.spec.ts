/**
 * A finished run's forged tool "↗ LOG" key and its "Share viz link" controls.
 *
 * The page talks to the real server over HTTP (tests-e2e/support/shared-run-server.ts):
 * one Mars Genesis pair run is stored there as the server stores a finished
 * run, so /sim?replay=<id> plays it through the server's own replay route,
 * and the Library lists Aria Chen's run with its session beside it.
 *
 * - The "↗ LOG" key of a tool, in the Reports tab's toolbox and in the Sim
 *   tab's toolbox dialog, opens the Event Log filtered to that tool's forge
 *   and use events, as the guided tour says it does.
 * - "Share viz link", in a run's drawer and in the run actions menu, shows the
 *   link, says whether it was copied, and says who can open it; a refused or
 *   unanswered clipboard says what failed and leaves the link to copy by hand.
 *
 * Each width and look saves a picture of what the press shows into
 * test-pictures/toolbox-log-and-share-link/, which CI uploads.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored run lives on a local server of its own.');

const SERVER = 'http://127.0.0.1:3462';
const LANDING = 'mars_landing_site_score';
const WATER = 'perchlorate_water_response_score';
// The spec's server is served at 127.0.0.1, and a link to a local address
// opens only on the computer that serves it, so the note says so.
const WHO_CAN_OPEN = 'This link opens only on this computer: the dashboard is served at a local address.';
const PICTURES = 'test-pictures/toolbox-log-and-share-link';

test.use({ baseURL: SERVER, deviceScaleFactor: 2 });

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
const LOOKS = ['light', 'dark'] as const;

async function storedSessionId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${SERVER}/sessions`);
  expect(res.ok()).toBe(true);
  const { sessions } = await res.json() as { sessions: Array<{ id: string }> };
  expect(sessions).toHaveLength(1);
  return sessions[0].id;
}

async function useLook(page: Page, look: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((t) => { window.localStorage.setItem('paracosm-theme', t); }, look);
}

const shareUrl = (id: string) => `${SERVER}/sim?replay=${encodeURIComponent(id)}&tab=viz`;
const logKey = (page: Page, tool: string) => page.getByRole('button', { name: `Open ${tool} in simulation log` });
const eventLog = (page: Page) => page.getByRole('log', { name: 'Event log' });

/** The Event Log shows the three events of Aria Chen's tool and nothing of the other tool. */
async function expectLogFilteredToLandingTool(page: Page): Promise<void> {
  const log = eventLog(page);
  await expect(log).toBeVisible();
  await expect(log.getByText(`tool: ${LANDING}`)).toBeVisible();
  await expect(log.getByRole('heading', { name: /^Event Log \(3 of \d+ events\)$/ })).toBeVisible();
  // Its forge in turn 1, the report that used it in turn 1, the report that used it again in turn 2.
  await expect(log.locator('summary')).toHaveText([
    /forge_attempt\s*Aria Chen\s*T1\s*engineering/,
    /specialist_done\s*Aria Chen\s*T1\s*engineering/,
    /specialist_done\s*Aria Chen\s*T2\s*engineering/,
  ]);
  await expect(log).not.toContainText(WATER);
}

/** The share note: the link in a field, the result of the copy, and who can open the link. */
async function expectShareNote(page: Page, id: string, result: string | RegExp): Promise<void> {
  const note = page.getByRole('status', { name: 'Share link' });
  await expect(note).toBeVisible();
  await expect(note.getByRole('textbox', { name: 'Link to this run' })).toHaveValue(shareUrl(id));
  await expect(note.getByText(result)).toBeVisible();
  await expect(note.getByText(WHO_CAN_OPEN, { exact: true })).toBeVisible();
}

async function openDrawerAndShare(page: Page): Promise<void> {
  await page.goto('/sim?tab=library');
  // Exact: the card's Share key is named "Copy a deep link that opens this run ...".
  await page.getByRole('article', { name: 'Run mars-genesis by Aria Chen' }).getByRole('button', { name: 'Open', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Run detail' });
  await expect(drawer.getByRole('heading', { name: 'Mars Genesis' })).toBeVisible();
  await drawer.getByText('Share viz link', { exact: true }).click();
}

/** Replaces the page's clipboard before any script runs. */
async function clipboardThat(page: Page, answer: 'refuses' | 'never-answers'): Promise<void> {
  await page.addInitScript((how) => {
    const writeText = how === 'refuses'
      ? () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
      : () => new Promise<void>(() => { /* the browser never answers */ });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: () => Promise.resolve('') } });
  }, answer);
}

for (const size of WIDTHS) {
  for (const look of LOOKS) {
    test.describe(`at ${size.width} in ${look}`, () => {
      test.use({ viewport: size });

      test('a forged tool\'s log key opens the Event Log filtered to that tool', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await useLook(page, look);
        if (size.width === 390) {
          // The Sim tab's toolbox dialog.
          await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
          await page.getByRole('button', { name: /^Open Forged Toolbox/ }).click();
          await expect(page.getByRole('dialog', { name: /^Forged Toolbox/ })).toBeVisible();
        } else {
          // The Reports tab's toolbox, folded until it is opened.
          await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=reports`);
          const fold = page.locator('#toolbox summary').first();
          await expect(fold).toBeVisible();
          if (!(await logKey(page, LANDING).isVisible())) await fold.click();
        }
        await logKey(page, LANDING).click();

        await expectLogFilteredToLandingTool(page);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-log-key-opens-event-log.png` });
      });

      test('"Share viz link" in a run\'s drawer shows the copied link and who can open it', async ({ page, context, request }) => {
        const id = await storedSessionId(request);
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
        await useLook(page, look);
        await openDrawerAndShare(page);

        await expectShareNote(page, id, 'Link copied.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl(id));
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-share-link-shown.png` });
      });
    });
  }
}

test.describe('filters left from an earlier visit', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a log key shows its tool\'s events whatever Event Log filters the address still holds', async ({ page, request }) => {
    const id = await storedSessionId(request);
    // An earlier visit to the Event Log left a type filter that matches none of the tool's events.
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=reports&logTypes=decision_made&logLeader=${encodeURIComponent('Dietrich Voss')}`);
    const fold = page.locator('#toolbox summary').first();
    await expect(fold).toBeVisible();
    if (!(await logKey(page, LANDING).isVisible())) await fold.click();
    await logKey(page, LANDING).click();

    await expectLogFilteredToLandingTool(page);
  });
});

for (const size of WIDTHS) {
  test.describe(`one tool after another at ${size.width}`, () => {
    test.use({ viewport: size });

    test('the Reports toolbox and the Sim toolbox dialog each open the Event Log on the tool pressed', async ({ page, request }) => {
      const id = await storedSessionId(request);
      await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=reports`);
      const fold = page.locator('#toolbox summary').first();
      await expect(fold).toBeVisible();
      if (!(await logKey(page, LANDING).isVisible())) await fold.click();
      await logKey(page, LANDING).click();
      await expectLogFilteredToLandingTool(page);

      // A second press, in the other toolbox, replaces the first tool's filter with its own.
      await page.locator('#tab-sim').click();
      await page.getByRole('button', { name: /^Open Forged Toolbox/ }).click();
      const dialog = page.getByRole('dialog', { name: /^Forged Toolbox/ });
      await expect(dialog).toBeVisible();
      await logKey(page, WATER).click();

      const log = eventLog(page);
      await expect(log).toBeVisible();
      await expect(log.getByText(`tool: ${WATER}`)).toBeVisible();
      await expect(log.getByRole('heading', { name: /^Event Log \(2 of \d+ events\)$/ })).toBeVisible();
      // Its forge in turn 1 and the one report that used it.
      await expect(log.locator('summary')).toHaveText([
        /forge_attempt\s*Dietrich Voss\s*T1\s*medical/,
        /specialist_done\s*Dietrich Voss\s*T1\s*medical/,
      ]);
      await expect(log).not.toContainText(LANDING);
      // The dialog left with its tab.
      await expect(dialog).toHaveCount(0);
    });
  });
}

test.describe('when the copy does not happen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a refused clipboard says so and leaves the link to copy by hand', async ({ page, request }) => {
    const id = await storedSessionId(request);
    await clipboardThat(page, 'refuses');
    await openDrawerAndShare(page);
    await expectShareNote(page, id, 'The browser refused to copy the link. Select the link and copy it.');
  });

  test('a clipboard that never answers says the link was not copied', async ({ page, request }) => {
    const id = await storedSessionId(request);
    await clipboardThat(page, 'never-answers');
    await openDrawerAndShare(page);
    await expectShareNote(page, id, 'The browser did not copy the link. Select the link and copy it.');
  });
});

test.describe('the run actions menu', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the share note goes when Clear local data empties the page', async ({ page, context, request }) => {
    const id = await storedSessionId(request);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
    await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: /Share viz link/ }).click();
    await expectShareNote(page, id, 'Link copied.');

    page.once('dialog', dialog => { void dialog.accept(); });
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: 'Clear local data' }).click();

    await expect(page.getByRole('status', { name: 'Share link' })).toHaveCount(0);
  });

  test('the share note goes when a loaded file replaces the replayed run', async ({ page, context, request }) => {
    const id = await storedSessionId(request);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
    await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: /Share viz link/ }).click();
    await expectShareNote(page, id, 'Link copied.');

    const ownRun = {
      schemaVersion: 3,
      events: [
        { type: 'turn_start', leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' } },
        { type: 'turn_done', leader: 'A', data: { turn: 1, time: 1, title: 'Turn 1' } },
      ],
    };
    // Dropped on the page, as a visitor drags a saved run in.
    await page.evaluate((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'own-run.json', { type: 'application/json' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        window.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    }, JSON.stringify(ownRun));
    const preview = page.getByRole('dialog', { name: 'Load simulation' });
    await preview.getByRole('button', { name: /^(Load|Load anyway|Replace current simulation)$/ }).click();
    await expect(preview).toHaveCount(0);

    await expect(page.getByRole('status', { name: 'Share link' })).toHaveCount(0);
  });

  test('"Share viz link" shows the copied link, and another visitor who opens it watches the run', async ({ page, context, browser, request }) => {
    const id = await storedSessionId(request);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
    await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: /Share viz link/ }).click();

    await expectShareNote(page, id, 'Link copied.');
    await page.screenshot({ path: `${PICTURES}/1440-dark-run-actions-share-link-shown.png` });
    // The note covers none of the top bar's keys.
    await page.getByRole('button', { name: 'RUN', exact: true }).click({ trial: true, timeout: 5_000 });
    await page.getByRole('button', { name: 'Open run actions menu' }).click({ trial: true, timeout: 5_000 });

    // The note is about this run: once the page leaves the replay, it goes.
    await page.getByRole('button', { name: 'EXIT REPLAY' }).click();
    await expect(page.getByRole('status', { name: 'Share link' })).toHaveCount(0);

    // A browser with none of this visitor's storage opens the link and watches the run.
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const visitor = await other.newPage();
      await visitor.goto(shareUrl(id));
      await expect(visitor.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
      // The banner shows before the stream answers; the turn counter reaches
      // the run's last turn only when the run's events have arrived.
      await expect(visitor.getByRole('progressbar', { name: 'Simulation progress, turn 2 of 2' })).toBeVisible({ timeout: 30_000 });
    } finally {
      await other.close();
    }
  });
});
