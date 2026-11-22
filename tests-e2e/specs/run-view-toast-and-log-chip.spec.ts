/**
 * The run view's toasts and the Event Log as it opens, on a finished Mars
 * Genesis pair run of six turns.
 *
 * The page talks to the real server over HTTP
 * (tests-e2e/support/six-turn-run-server.ts): the run is stored there as the
 * server stores a finished run, so /sim?replay=<id> plays it through the
 * server's own replay route. Aria Chen's engineering department forges
 * mars_landing_site_score in turn 1 and uses it in every turn, so the Event
 * Log on that tool holds seven events under a filter bar with every type, the
 * leader picker and the turns range (tests-e2e/support/six-turn-run.ts).
 *
 * - A toast is told to a screen reader: the page holds a polite status region
 *   for its toasts before any shows, and a toast's words land in it, once on
 *   the page. The run actions menu's Copy on a refused clipboard shows the
 *   toast "Copy Failed / Clipboard access denied.".
 * - A forged tool's Show in Event Log opens the Event Log with its heading,
 *   its search field and the tool's chip in view, under no other element: the
 *   element at the centre of each is that element, and a press at the centre
 *   of the chip's x clears the tool's filter.
 * - A reload of the replay's Event Log opens with its heading and filters in
 *   view.
 *
 * 390 is checked at 390 by 664, the page's visible area in a 390-wide phone's
 * browser (Playwright's iPhone 12, 13 and 14 devices), and 1440 at 1440 by
 * 900. Each width and look saves a picture of what the press or the reload
 * shows into test-pictures/run-view-toast-and-log-chip/, which CI uploads.
 */
import { test, expect, type Locator, type Page, type APIRequestContext } from '@playwright/test';
import { LANDING } from '../support/pair-run.js';
import { SIX_TURN_EVENTS } from '../support/six-turn-run.js';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The stored run lives on a local server of its own.');

const SERVER = 'http://127.0.0.1:3468';
const PICTURES = 'test-pictures/run-view-toast-and-log-chip';

test.use({ baseURL: SERVER, deviceScaleFactor: 2 });

const WIDTHS = [
  { width: 390, height: 664 },
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

/** Replaces the page's clipboard, before any script runs, with one that refuses every write. */
async function clipboardThatRefuses(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: () => Promise.resolve('') } });
  });
}

const replayOf = (id: string, tab: string) => `/sim?replay=${encodeURIComponent(id)}&tab=${tab}`;
/** The footer's run status once the replay has played every turn. */
const runComplete = (page: Page) => page.getByRole('status', { name: /^Simulation status: Complete\./ });
/** The place a screen reader hears the page's toasts from. */
const toastRegion = (page: Page) => page.getByRole('status', { name: 'Notifications' });
const eventLog = (page: Page) => page.getByRole('log', { name: 'Event log' });
const logSearch = (log: Locator) => log.getByRole('searchbox', { name: /^Filter log by text/ });

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

/** Presses Aria Chen's tool's Show in Event Log: from the Sim tab's toolbox dialog at 390, from the Reports tab's toolbox at 1440. */
async function pressLandingShowInEventLog(page: Page, id: string, width: number): Promise<void> {
  if (width === 390) {
    await page.goto(replayOf(id, 'sim'));
    await page.getByRole('button', { name: /^Open Forged Toolbox/ }).click();
    const toolbox = page.getByRole('dialog', { name: /^Forged toolbox, \d+ tools?$/ });
    await expect(toolbox).toBeVisible();
    await showInEventLog(page, toolbox, LANDING);
    return;
  }
  await page.goto(replayOf(id, 'reports'));
  const toolbox = page.locator('#toolbox');
  const fold = toolbox.locator('summary').first();
  await expect(fold).toBeVisible();
  // The row is in the page once the replay has played the tool in, shown or folded away.
  const row = toolbox.locator(`[data-tool-row][data-tool-name="${LANDING}"]`);
  await expect(row).toBeAttached();
  if (!(await row.isVisible())) await fold.click();
  await showInEventLog(page, toolbox, LANDING);
}

/**
 * The element at the centre of the target's box, read without scrolling:
 * "itself" when it is the target or inside it, else what covers the centre.
 * A press there is a press on the target only when it says "itself".
 */
async function atCentreOf(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit !== null && (hit === el || el.contains(hit))) return 'itself';
    if (hit === null) return `nothing: its centre is outside the window, at y ${Math.round(box.top + box.height / 2)}`;
    const label = hit.getAttribute('aria-label') ?? hit.getAttribute('role') ?? (hit.textContent ?? '').trim().slice(0, 40);
    return `${hit.tagName.toLowerCase()} "${label}"`;
  });
}

/** Lets the page paint once, so a picture and a box read show where the page settled. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const size of WIDTHS) {
  for (const look of LOOKS) {
    test.describe(`at ${size.width} in ${look}`, () => {
      test.use({ viewport: size });

      test('the run actions menu\'s Copy on a refused clipboard is told to a screen reader', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await clipboardThatRefuses(page);
        await useLook(page, look);
        await page.goto(replayOf(id, 'sim'));
        await expect(runComplete(page)).toBeVisible({ timeout: 30_000 });

        // Read before the press: the region a screen reader hears the toasts from.
        const beforePress = await toastRegion(page).evaluateAll((regions) => regions.map((r) => r.textContent ?? ''));
        await page.getByRole('button', { name: 'Open run actions menu' }).click();
        await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
        // The toast on screen; the picture holds it, and the checks below decide.
        await expect(page.getByText('Clipboard access denied.', { exact: true })).toBeVisible();
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-copy-refused-toast.png` });

        // There before any toast and empty, so a screen reader announces the words put in it.
        expect(beforePress, 'the toast region, present and empty before the press').toEqual(['']);
        await expect(toastRegion(page)).toContainText('Copy Failed');
        await expect(toastRegion(page)).toContainText('Clipboard access denied.');
        // The words are on the page once, in the toast the eye sees, so a
        // search for them finds one element.
        await expect(page.getByText('Clipboard access denied.')).toHaveCount(1);
      });

      test('Show in Event Log opens the Event Log with its heading, search field and tool chip in view', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await useLook(page, look);
        await pressLandingShowInEventLog(page, id, size.width);

        const log = eventLog(page);
        const heading = log.getByRole('heading', { name: /^Event Log \(7 of \d+ events\)$/ });
        const clearTool = log.getByRole('button', { name: 'Clear tool filter' });
        await expect(heading).toBeAttached();
        await expect(log.getByText(`tool: ${LANDING}`)).toBeAttached();
        await settle(page);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-show-in-event-log-chip.png` });

        expect(await atCentreOf(heading), 'the Event Log heading').toBe('itself');
        expect(await atCentreOf(logSearch(log)), 'the Event Log search field').toBe('itself');
        expect(await atCentreOf(clearTool), 'the tool chip\'s x').toBe('itself');

        // A press at the centre of the x, where it sits, with no scroll first.
        const box = await clearTool.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await expect(log.getByText(`tool: ${LANDING}`)).toHaveCount(0);
        await expect(clearTool).toHaveCount(0);
      });

      test('a reload of the replay\'s Event Log opens with its heading and filters in view', async ({ page, request }) => {
        const id = await storedSessionId(request);
        await useLook(page, look);
        // The replay's link with the Event Log view, as the address holds it once the view is open.
        await page.goto(`${replayOf(id, 'settings')}&sub=log`);
        const log = eventLog(page);
        const everyEvent = log.getByRole('heading', { name: `Event Log (${SIX_TURN_EVENTS} events)`, exact: true });
        await expect(everyEvent).toBeAttached({ timeout: 30_000 });

        await page.reload();
        await expect(everyEvent).toBeAttached({ timeout: 30_000 });
        await settle(page);
        await page.screenshot({ path: `${PICTURES}/${size.width}-${look}-event-log-after-reload.png` });

        expect(await atCentreOf(everyEvent), 'the Event Log heading').toBe('itself');
        expect(await atCentreOf(logSearch(log)), 'the Event Log search field').toBe('itself');
        expect(await atCentreOf(log.getByRole('button', { name: 'Reset filters' })), 'the Reset filters key').toBe('itself');
      });
    });
  }
}
