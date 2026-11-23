/**
 * A finished run's forged tool "Show in Event Log" key and its "Share viz link" controls.
 *
 * The page talks to the real server over HTTP (tests-e2e/support/shared-run-server.ts):
 * one Mars Genesis pair run is stored there as the server stores a finished
 * run, so /sim?replay=<id> plays it through the server's own replay route,
 * and the Library lists Aria Chen's run with its session beside it.
 *
 * - "Show in Event Log", in the Record of a forged tool's trace, which opens
 *   from the tool's row in the Reports tab's toolbox and in the Sim tab's
 *   toolbox dialog, opens the Event Log filtered to that tool's forge and
 *   use events, as the guided tour says it does.
 * - "Share viz link", in a run's drawer and in the run actions menu, shows the
 *   link, says whether it was copied, and says who can open it; a refused or
 *   unanswered clipboard says what failed and leaves the link to copy by hand.
 *   The Library card's Share key does the same, also where the page has no
 *   clipboard at all (plain http on a network address).
 * - Changing an Event Log filter keeps the rest of the address, so a refresh
 *   reopens the same replay, tab, sub view and filter. A Library search on a
 *   replay keeps the replay in the address the same way.
 * - The other copy keys say when the copy fails: the run actions menu's Copy
 *   on a page with no clipboard, the verdict's export key on a refused
 *   clipboard, and the landing page's Copy key on a code block in both cases.
 *   The verdict and a landing code block hold the place for their copy
 *   result before any press, only the last press's result shows (also when
 *   an earlier press is answered after a later one), and a refused verdict
 *   export says nothing on a run loaded after it, the same saved run loaded
 *   again included. A verdict the visitor collapsed stays collapsed when
 *   Exit Replay connects the live feed. A copy that works is said in the
 *   status region too, for a screen reader.
 *
 * Each width and look saves a picture of what the press shows into
 * test-pictures/toolbox-log-and-share-link/, which CI uploads.
 */
import { test, expect, type Locator, type Page, type APIRequestContext } from '@playwright/test';
import { openTab } from '../support/frame.js';

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
/** The Sim tab's toolbox dialog, named for the run's count of tools. */
const toolboxDialog = (page: Page) => page.getByRole('dialog', { name: /^Forged toolbox, \d+ tools?$/ });
/** The Reports tab's toolbox, in its page. */
const reportsToolbox = (page: Page) => page.locator('#toolbox');
/** A tool's row in a toolbox: the key that opens the tool's trace. */
const toolRow = (toolbox: Locator, tool: string) => toolbox.locator(`[data-tool-row][data-tool-name="${tool}"]`).getByRole('button');

/** Presses a tool's "Show in Event Log": its row opens its trace, whose Record holds the key. */
async function showInEventLog(page: Page, toolbox: Locator, tool: string): Promise<void> {
  await toolRow(toolbox, tool).click();
  const trace = page.getByRole('dialog', { name: new RegExp(`^${tool}, forged tool \\d+$`) });
  await expect(trace).toBeVisible();
  await trace.getByRole('button', { name: 'Record', exact: true }).click();
  await trace.getByRole('button', { name: 'Show in Event Log', exact: true }).click();
  await expect(trace).toBeHidden();
}

/** Opens the Reports tab's toolbox, folded until it is opened. */
async function openReportsToolbox(page: Page, tool: string): Promise<Locator> {
  const toolbox = reportsToolbox(page);
  const fold = toolbox.locator('summary').first();
  await expect(fold).toBeVisible();
  // The row is in the page once the replay has played the tool in, shown or folded away.
  const row = toolbox.locator(`[data-tool-row][data-tool-name="${tool}"]`);
  await expect(row).toBeAttached();
  if (!(await row.isVisible())) await fold.click();
  return toolbox;
}

/** Opens the Sim tab's toolbox dialog from the footer's key. */
async function openSimToolbox(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Open Forged Toolbox/ }).click();
  const toolbox = toolboxDialog(page);
  await expect(toolbox).toBeVisible();
  return toolbox;
}
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

const shareNote = (page: Page) => page.getByRole('status', { name: 'Share link' });
const runCard = (page: Page) => page.getByRole('article', { name: 'Run mars-genesis by Aria Chen' });
const cardShareKey = (page: Page) => runCard(page).getByRole('button', { name: 'Copy a deep link that opens this run on the visualization tab' });

/**
 * Saves a picture of what a press shows. It waits a moment for the share
 * note so the picture holds it when there is one; the test's own checks
 * come after and decide.
 */
async function pictureOfPress(page: Page, path: string): Promise<void> {
  const note = shareNote(page);
  if (await note.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path });
}

/** Presses "Show in Event Log" for Aria Chen's tool: from the Sim tab's toolbox dialog at 390, from the Reports tab's toolbox at 1440. */
async function pressLandingShowInEventLog(page: Page, id: string, width: number): Promise<void> {
  if (width === 390) {
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
    await showInEventLog(page, await openSimToolbox(page), LANDING);
  } else {
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=reports`);
    await showInEventLog(page, await openReportsToolbox(page, LANDING), LANDING);
  }
}

/** The address holds the replay, the Settings tab and its Event Log sub view. */
function expectAddressOnReplayLog(page: Page, id: string): void {
  const params = new URL(page.url()).searchParams;
  expect(params.get('replay')).toBe(id);
  expect(params.get('tab')).toBe('settings');
  expect(params.get('sub')).toBe('log');
}

/** Replaces the page's clipboard before any script runs. */
async function clipboardThat(page: Page, answer: 'refuses' | 'never-answers' | 'is-absent'): Promise<void> {
  await page.addInitScript((how) => {
    if (how === 'is-absent') {
      // A page served over plain http at a network address has no clipboard.
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      return;
    }
    const writeText = how === 'refuses'
      ? () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
      : () => new Promise<void>(() => { /* the browser never answers */ });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: () => Promise.resolve('') } });
  }, answer);
}

/** What the verdict's export key says when the browser does not copy the verdict. */
const VERDICT_NOT_COPIED = 'The browser refused to copy the verdict.';

/** What a screen reader hears when the verdict's export key copies the verdict. */
const VERDICT_COPIED = 'The verdict was copied as markdown.';

/** What a screen reader hears when a landing page code block's Copy key copies the code. */
const CODE_COPIED = 'The code was copied.';

/** What a landing page code block says when its Copy key's copy does not happen. */
const CODE_NOT_COPIED = 'The browser did not copy the code. Select it and copy it.';

/** The landing page's install code block, the first one with a Copy key. */
const installBlock = (page: Page) => page.locator('.code-block').filter({ hasText: 'Install (npm, pnpm, or bun)' });

/** The page errors that name the clipboard, gathered from now on. */
function clipboardErrorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (/clipboard|writeText/i.test(error.message)) errors.push(error.message);
  });
  return errors;
}

/**
 * A saved Mars Genesis pair run with its verdict, as the dashboard's Save
 * writes it: the stream's events and the pair verdict the server broadcast.
 */
const SAVED_RUN_WITH_VERDICT = {
  schemaVersion: 3,
  events: [
    { type: 'turn_start', leader: 'Aria Chen', data: { turn: 1, time: 2043, title: 'Landfall' } },
    { type: 'turn_start', leader: 'Dietrich Voss', data: { turn: 1, time: 2043, title: 'Landfall' } },
    { type: 'turn_done', leader: 'Aria Chen', data: { turn: 1, time: 2043, title: 'Landfall' } },
    { type: 'turn_done', leader: 'Dietrich Voss', data: { turn: 1, time: 2043, title: 'Landfall' } },
  ],
  verdict: {
    winner: 'A',
    winnerName: 'Aria Chen',
    headline: 'Aria Chen leads on survival',
    summary: 'Aria Chen scored the landing sites before choosing one; Dietrich Voss landed at the first site with ice.',
    keyDivergence: 'The landing site in turn 1.',
    scores: {
      a: { survival: 8, prosperity: 7, morale: 7, innovation: 8 },
      b: { survival: 6, prosperity: 6, morale: 5, innovation: 6 },
    },
    leaderA: { name: 'Aria Chen', archetype: 'The Visionary', unit: 'Ares' },
    leaderB: { name: 'Dietrich Voss', archetype: 'The Engineer', unit: 'Olympus' },
    settlementNoun: 'colony',
    finalStats: {
      a: { population: 100, morale: 0.72, food: 14, power: 410, modules: 6, science: 21, tools: 1 },
      b: { population: 96, morale: 0.58, food: 11, power: 380, modules: 5, science: 15, tools: 1 },
    },
  },
};

/**
 * Drops a saved run on the page, as a visitor drags a saved file in, and loads it.
 * The page takes a drop once its drop listeners are set, which is after the
 * document's load, so the drop is made again until the load preview opens.
 */
async function dropSavedRun(page: Page, run: unknown): Promise<void> {
  const preview = page.getByRole('dialog', { name: 'Load simulation' });
  await expect(async () => {
    await page.evaluate((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'saved-run.json', { type: 'application/json' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        window.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    }, JSON.stringify(run));
    await expect(preview).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await preview.getByRole('button', { name: /^(Load|Load anyway|Replace current simulation)$/ }).click();
  await expect(preview).toHaveCount(0);
}

/**
 * A clipboard whose writes are answered or refused in the order given;
 * every write after the last one named is answered.
 */
async function clipboardAnswering(page: Page, answers: Array<'ok' | 'refused'>): Promise<void> {
  await page.addInitScript((order) => {
    let writes = 0;
    const writeText = () => (order[writes++] === 'refused'
      ? Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
      : Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: () => Promise.resolve('') } });
  }, answers);
}

/**
 * A clipboard that holds its first write until {@link answerFirstWrite}
 * answers it, and refuses every later write, so the first press is answered
 * after the second press's refusal.
 */
async function clipboardAnsweringFirstWriteLast(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let writes = 0;
    const writeText = () => {
      writes += 1;
      if (writes === 1) {
        return new Promise<void>((resolve) => {
          (window as unknown as { answerFirstWrite: () => void }).answerFirstWrite = resolve;
        });
      }
      return Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: () => Promise.resolve('') } });
  });
}

/** Answers the held first write, and gives the page time to take the answer. */
async function answerFirstWrite(page: Page): Promise<void> {
  await page.evaluate(async () => {
    (window as unknown as { answerFirstWrite: () => void }).answerFirstWrite();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

for (const size of WIDTHS) {
  for (const look of LOOKS) {
    test.describe(`at ${size.width} in ${look}`, () => {
      test.use({ viewport: size });

      test('a forged tool\'s Show in Event Log opens the Event Log filtered to that tool', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await useLook(page, look);
        // The Sim tab's toolbox dialog at 390; the Reports tab's toolbox, folded until it is opened, at 1440.
        await pressLandingShowInEventLog(page, id, size.width);

        await expectLogFilteredToLandingTool(page);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-show-in-event-log-opens-event-log.png` });
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

      test('the Library card\'s Share key on a page with no clipboard shows the link to copy by hand', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await clipboardThat(page, 'is-absent');
        await useLook(page, look);
        await page.goto('/sim?tab=library');
        await cardShareKey(page).click();

        await pictureOfPress(page, `${PICTURES}/${size.width}-${look}-library-card-share-no-clipboard.png`);
        await expectShareNote(page, id, 'The browser refused to copy the link. Select the link and copy it.');
        // The press made the note, not the run's drawer.
        await expect(page.getByRole('dialog', { name: 'Run detail' })).toHaveCount(0);
      });

      test('clearing an Event Log filter keeps the replay, tab and sub view, and a refresh reopens them with the filter', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await useLook(page, look);
        await pressLandingShowInEventLog(page, id, size.width);
        await expectLogFilteredToLandingTool(page);
        expectAddressOnReplayLog(page, id);

        // Clear the tool chip, then filter by text instead.
        const log = eventLog(page);
        await log.getByRole('button', { name: 'Clear tool filter' }).click();
        await expect(log.getByText(`tool: ${LANDING}`)).toHaveCount(0);
        expectAddressOnReplayLog(page, id);
        await log.getByRole('searchbox', { name: /^Filter log by text/ }).fill('forge_attempt');
        await expect.poll(() => new URL(page.url()).searchParams.get('logQuery')).toBe('forge_attempt');
        expectAddressOnReplayLog(page, id);

        await page.reload();
        expectAddressOnReplayLog(page, id);
        const reopened = eventLog(page);
        await expect(reopened).toBeVisible();
        await expect(reopened.getByRole('searchbox', { name: /^Filter log by text/ })).toHaveValue('forge_attempt');
        // Show in Event Log keeps the log to the tool's actor, and clearing the tool leaves that:
        // of the replay's 13 forge events, the 6 of Aria Chen and none of Dietrich Voss's 7.
        expect(new URL(page.url()).searchParams.get('logLeader')).toBe('Aria Chen');
        await expect(reopened.locator('summary')).toHaveCount(6);
        await expect(reopened).toContainText(/forge_attempt\s*Aria Chen/);
        await expect(reopened).not.toContainText(/forge_attempt\s*Dietrich Voss/);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-log-filter-kept-after-refresh.png` });
      });

      test('the verdict\'s export key on a refused clipboard says the verdict was not copied', async ({ page }) => {
        await clipboardThat(page, 'refuses');
        await useLook(page, look);
        await page.goto('/sim?tab=sim');
        await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
        const exportKey = page.getByRole('button', { name: 'Copy verdict as markdown' });
        await expect(exportKey).toBeVisible();
        await exportKey.click();

        // Wait a moment for the words so the picture holds them; the check below decides.
        await page.getByText(VERDICT_NOT_COPIED, { exact: true }).waitFor({ timeout: 5_000 }).catch(() => undefined);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-verdict-export-refused.png` });
        await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toBeVisible();
      });

      test('the landing page\'s Copy key on a page with no clipboard says the code was not copied', async ({ page }) => {
        await clipboardThat(page, 'is-absent');
        await useLook(page, look);
        const clipboardErrors = clipboardErrorsOf(page);
        await page.goto('/');
        const block = installBlock(page);
        await block.getByRole('button', { name: 'Copy', exact: true }).click();

        // Wait a moment for the words so the picture holds them; the checks below decide.
        await block.getByRole('status').waitFor({ timeout: 5_000 }).catch(() => undefined);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-landing-copy-no-clipboard.png` });
        await expect(block.getByRole('status')).toHaveText(CODE_NOT_COPIED);
        expect(clipboardErrors).toEqual([]);
      });
    });
  }
}

test.describe('the other copy keys and the Library\'s address', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the run actions menu\'s Copy on a page with no clipboard says the summary was not copied', async ({ page, request }) => {
    const id = await storedSessionId(request);
    await clipboardThat(page, 'is-absent');
    const clipboardErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (/clipboard|writeText/i.test(error.message)) clipboardErrors.push(error.message);
    });
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
    await expect(page.getByRole('progressbar', { name: 'Simulation progress, turn 2 of 2' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open run actions menu' }).click();
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();

    await expect(page.getByText('Clipboard access denied.', { exact: true })).toBeVisible();
    expect(clipboardErrors).toEqual([]);
  });

  test('the landing page\'s Copy key on a refused clipboard says the code was not copied, and a copy that works takes the words away', async ({ page }) => {
    await clipboardAnswering(page, ['refused']);
    const clipboardErrors = clipboardErrorsOf(page);
    await page.goto('/');
    const block = installBlock(page);
    const copyKey = block.getByRole('button', { name: /^(Copy|Copied)$/ });

    await copyKey.click();
    await expect(block.getByRole('status')).toHaveText(CODE_NOT_COPIED);
    await expect(copyKey).toHaveText('Copy');

    await copyKey.click();
    await expect(copyKey).toHaveText('Copied');
    await expect(block.getByText(CODE_NOT_COPIED, { exact: true })).toHaveCount(0);
    expect(clipboardErrors).toEqual([]);
  });

  test('a landing page code block has the place for its copy result before any press', async ({ page }) => {
    await page.goto('/');
    // There from the start and empty, so a screen reader announces the words put in it.
    await expect(installBlock(page).getByRole('status')).toHaveText('');
  });

  test('a landing page copy that works says so in the block\'s status region', async ({ page }) => {
    await clipboardAnswering(page, ['ok']);
    await page.goto('/');
    const block = installBlock(page);
    await block.getByRole('button', { name: /^(Copy|Copied)$/ }).click();
    // The words are for a screen reader; the key itself shows Copied.
    await expect(block.getByRole('status')).toHaveText(CODE_COPIED);
  });

  test('a verdict export that works says so in its status region', async ({ page }) => {
    await clipboardAnswering(page, ['ok']);
    await page.goto('/sim?tab=sim');
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    await page.getByRole('button', { name: 'Copy verdict as markdown' }).click();
    // The key keeps its name, so the region carries the result for a screen reader.
    await expect(page.getByRole('status', { name: 'Verdict copy result' })).toHaveText(VERDICT_COPIED);
  });

  test('a landing page copy that is refused after one that worked says only that the code was not copied', async ({ page }) => {
    await clipboardAnswering(page, ['ok', 'refused']);
    await page.goto('/');
    const block = installBlock(page);
    const copyKey = block.getByRole('button', { name: /^(Copy|Copied)$/ });

    await copyKey.click();
    await expect(copyKey).toHaveText('Copied');
    await copyKey.click();
    await expect(block.getByText(CODE_NOT_COPIED, { exact: true })).toBeVisible();
    // Read at once: the key must not go on saying Copied beside the words.
    expect(await copyKey.textContent()).toBe('Copy');
  });

  test('the verdict has the place for its copy result before any press', async ({ page }) => {
    await page.goto('/sim?tab=sim');
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    await expect(page.getByRole('button', { name: 'Copy verdict as markdown' })).toBeVisible();
    // There with the key and empty, so a screen reader announces the words put in it.
    await expect(page.getByRole('status', { name: 'Verdict copy result' })).toHaveText('');
  });

  test('a verdict export that is refused after one that worked says only that the verdict was not copied', async ({ page }) => {
    await clipboardAnswering(page, ['ok', 'refused']);
    await page.goto('/sim?tab=sim');
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    const exportKey = page.getByRole('button', { name: 'Copy verdict as markdown' });

    await exportKey.click();
    await expect(exportKey).toHaveText('COPIED ✓');
    await exportKey.click();
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toBeVisible();
    // Read at once: the key must not go on saying it copied beside the words.
    expect(await exportKey.textContent()).toBe('EXPORT MD');
  });

  test('a refused verdict export says nothing on the verdict of a run loaded after it', async ({ page }) => {
    await clipboardThat(page, 'refuses');
    await page.goto('/sim?tab=sim');
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    await page.getByRole('button', { name: 'Copy verdict as markdown' }).click();
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toBeVisible();

    // Another saved run: its verdict was never exported.
    await dropSavedRun(page, {
      ...SAVED_RUN_WITH_VERDICT,
      verdict: { ...SAVED_RUN_WITH_VERDICT.verdict, winner: 'B', winnerName: 'Dietrich Voss', headline: 'Dietrich Voss leads on power' },
    });
    await expect(page.getByText('Dietrich Voss leads on power', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy verdict as markdown' })).toBeVisible();
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toHaveCount(0);
  });

  test('a refused verdict export says nothing when the same saved run is loaded again', async ({ page }) => {
    await clipboardThat(page, 'refuses');
    await page.goto('/sim?tab=sim');
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    await page.getByRole('button', { name: 'Copy verdict as markdown' }).click();
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toBeVisible();

    // The same file again: a run of its own, and its verdict was never exported.
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    await expect(page.getByRole('button', { name: 'Copy verdict as markdown' })).toBeVisible();
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toHaveCount(0);
  });

  test('a verdict the visitor collapsed stays collapsed when Exit Replay connects the live feed', async ({ page, request }) => {
    const id = await storedSessionId(request);
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=sim`);
    await expect(page.getByRole('progressbar', { name: 'Simulation progress, turn 2 of 2' })).toBeVisible({ timeout: 30_000 });
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    await page.getByRole('button', { name: 'Collapse verdict' }).click();
    await expect(page.getByRole('button', { name: 'Expand verdict' })).toBeVisible();

    // Exit Replay drops the replay and opens the live feed, a source of its own.
    const liveFeed = page.waitForResponse((response) => new URL(response.url()).pathname === '/events');
    await page.getByRole('button', { name: 'EXIT REPLAY' }).click();
    await liveFeed;
    // The feed's first frame follows its headers; give the page time to take it.
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('button', { name: 'Expand verdict' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy verdict as markdown' })).toHaveCount(0);
  });

  test('a verdict export answered after a later press leaves what the later press showed', async ({ page }) => {
    await clipboardAnsweringFirstWriteLast(page);
    await page.goto('/sim?tab=sim');
    await dropSavedRun(page, SAVED_RUN_WITH_VERDICT);
    const exportKey = page.getByRole('button', { name: 'Copy verdict as markdown' });

    await exportKey.click();
    await exportKey.click();
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toBeVisible();
    // The first press's copy is answered now, after the second press was refused.
    await answerFirstWrite(page);
    expect(await exportKey.textContent()).toBe('EXPORT MD');
    await expect(page.getByText(VERDICT_NOT_COPIED, { exact: true })).toBeVisible();
  });

  test('a landing page copy answered after a later press leaves what the later press showed', async ({ page }) => {
    await clipboardAnsweringFirstWriteLast(page);
    await page.goto('/');
    const block = installBlock(page);
    const copyKey = block.getByRole('button', { name: /^(Copy|Copied)$/ });

    await copyKey.click();
    await copyKey.click();
    await expect(block.getByText(CODE_NOT_COPIED, { exact: true })).toBeVisible();
    // The first press's copy is answered now, after the second press was refused.
    await answerFirstWrite(page);
    expect(await copyKey.textContent()).toBe('Copy');
    await expect(block.getByText(CODE_NOT_COPIED, { exact: true })).toBeVisible();
  });

  test('a Library search on a replay keeps the replay in the address, and a refresh reopens the replay with the search', async ({ page, request }) => {
    const id = await storedSessionId(request);
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=library`);
    await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
    await expect(runCard(page)).toBeVisible();

    await page.getByRole('textbox', { name: 'Search runs' }).fill('mars');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('mars');
    const params = new URL(page.url()).searchParams;
    expect(params.get('replay')).toBe(id);
    expect(params.get('tab')).toBe('library');

    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: /^REPLAYING/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search runs' })).toHaveValue('mars');
    await expect(runCard(page)).toBeVisible();
  });
});

test.describe('filters left from an earlier visit', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Show in Event Log shows its tool\'s events whatever Event Log filters the address still holds', async ({ page, request }) => {
    const id = await storedSessionId(request);
    // An earlier visit to the Event Log left a type filter that matches none of the tool's events.
    await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=reports&logTypes=decision_made&logLeader=${encodeURIComponent('Dietrich Voss')}`);
    await showInEventLog(page, await openReportsToolbox(page, LANDING), LANDING);

    await expectLogFilteredToLandingTool(page);
  });
});

for (const size of WIDTHS) {
  test.describe(`one tool after another at ${size.width}`, () => {
    test.use({ viewport: size });

    test('the Reports toolbox and the Sim toolbox dialog each open the Event Log on the tool pressed', async ({ page, request }) => {
      const id = await storedSessionId(request);
      await page.goto(`/sim?replay=${encodeURIComponent(id)}&tab=reports`);
      await showInEventLog(page, await openReportsToolbox(page, LANDING), LANDING);
      await expectLogFilteredToLandingTool(page);

      // A second press, from the other toolbox, replaces the first tool's filter with its own.
      await openTab(page, 'sim');
      await showInEventLog(page, await openSimToolbox(page), WATER);

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
      await expect(toolboxDialog(page)).toHaveCount(0);
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

  test('the Library card\'s Share key copies the link and says who can open it', async ({ page, context, request }) => {
    const id = await storedSessionId(request);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
    await page.goto('/sim?tab=library');
    await cardShareKey(page).click();
    await expectShareNote(page, id, 'Link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl(id));
    // Closing the note leaves the Library as it was.
    await shareNote(page).getByRole('button', { name: 'Close' }).click();
    await expect(shareNote(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Run detail' })).toHaveCount(0);
  });

  test('the Library card\'s Share key on a refused clipboard says so', async ({ page, request }) => {
    const id = await storedSessionId(request);
    await clipboardThat(page, 'refuses');
    await page.goto('/sim?tab=library');
    await cardShareKey(page).click();
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
