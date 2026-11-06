/**
 * Each visitor's run stays their own.
 *
 * The server held one run for everyone: a second visitor's Run aborted the
 * first visitor's run, the first page showed its run as interrupted, and one
 * visitor's Clear wiped another's run. Each browser context here is a
 * visitor, holding the paracosm_visitor cookie the dashboard's HTML gives it.
 *
 * The pages talk to a real server whose runner is scripted
 * (tests-e2e/support/stub-runner-server.ts), through the real /setup, so no
 * model is called. That server runs at most two runs at once
 * (PARACOSM_MAX_RUNS=2), and its runs share that cap, so the tests run in
 * order.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

test.skip(!!process.env.PARACOSM_E2E_BASE_URL, 'The scripted runner runs on a local server of its own.');
const BASE = 'http://127.0.0.1:3459';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial' });

const RUN_MS = 30_000;
const runMenuButton = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true });
const runNewItem = (page: Page) => page.getByRole('menuitem', { name: /Run New Simulation|Loading scenario/ });
const pill = (page: Page, text: string) => page.getByRole('status', { name: new RegExp(`^${text}\\.`) }).first();
/** Text the page shows: its hidden panels (another tab's header, the Settings form) hold the names too. */
const shown = (page: Page, text: string) => page.getByText(text).filter({ visible: true });
const finishedRun = (page: Page) => shown(page, 'Spin up a new run').first();
const emptyStateRun = (page: Page) => page.getByRole('button', { name: /^(Run Simulation|Loading scenario)/ });

interface Visit { context: BrowserContext; page: Page }

/** A browser of its own on the Sim tab, picked into `scenarioId` first when given. */
async function visit(browser: Browser, scenarioId?: string): Promise<Visit> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  if (scenarioId) {
    // page.request shares the page's cookies, so the pick it gets is the page's.
    expect((await page.request.post('/scenario/switch', { data: { id: scenarioId } })).ok()).toBe(true);
  }
  await page.goto('/sim?tab=sim');
  return { context, page };
}

async function pressRun(page: Page): Promise<void> {
  await runMenuButton(page).click();
  await expect(runNewItem(page)).toHaveText(/Run New Simulation/);
  await runNewItem(page).click();
}

async function expectComplete(page: Page): Promise<void> {
  await expect(finishedRun(page)).toBeVisible({ timeout: RUN_MS });
  await expect(pill(page, 'Complete')).toBeVisible();
  await expect(pill(page, 'Interrupted')).toHaveCount(0);
}

async function results(page: Page): Promise<{ isComplete: boolean; scenarioId?: string; runKey?: string | null }> {
  return (await page.request.get('/results')).json();
}

test.describe('Run per visitor @runs', () => {
  test('two visitors run beside each other, and each page shows only its own run', async ({ browser }) => {
    const a = await visit(browser);
    const b = await visit(browser, 'atlas-lab');
    try {
      await pressRun(a.page);
      await expect(shown(a.page, 'Aria Chen').first()).toBeVisible();
      await pressRun(b.page);
      await expect(shown(b.page, 'Marcus Reinhardt').first()).toBeVisible();

      await expectComplete(a.page);
      await expect(shown(a.page, 'Dietrich Voss').first()).toBeVisible();
      await expect(shown(a.page, 'Marcus Reinhardt')).toHaveCount(0);
      await expectComplete(b.page);
      await expect(shown(b.page, 'Priya Kapoor').first()).toBeVisible();
      await expect(shown(b.page, 'Aria Chen')).toHaveCount(0);

      const aResults = await results(a.page);
      expect(aResults.isComplete).toBe(true);
      expect(aResults.scenarioId).toBe('mars-genesis');
      const bResults = await results(b.page);
      expect(bResults.isComplete).toBe(true);
      expect(bResults.scenarioId).toBe('atlas-lab');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('a reload and a second tab of the same browser find the run', async ({ browser }) => {
    const a = await visit(browser);
    try {
      await pressRun(a.page);
      await expectComplete(a.page);
      await a.page.reload();
      await expectComplete(a.page);
      await expect(shown(a.page, 'Aria Chen').first()).toBeVisible();

      const second = await a.context.newPage();
      await second.goto('/sim?tab=sim');
      await expectComplete(second);
      await expect(shown(second, 'Dietrich Voss').first()).toBeVisible();
    } finally {
      await a.context.close();
    }
  });

  test("one visitor's Clear leaves another visitor's run", async ({ browser }) => {
    const a = await visit(browser);
    const b = await visit(browser, 'atlas-lab');
    try {
      await pressRun(a.page);
      await pressRun(b.page);
      await expectComplete(a.page);
      await expectComplete(b.page);

      a.page.once('dialog', dialog => dialog.accept());
      await a.page.getByRole('button', { name: 'Open run actions menu' }).click();
      await a.page.getByRole('menuitem', { name: 'Clear local data' }).click();
      // Clearing opens Settings when no admin token is stored; the Sim tab is empty.
      await a.page.getByRole('tab', { name: 'SIM', exact: true }).click();
      await expect(emptyStateRun(a.page)).toBeVisible();
      await expect.poll(async () => (await results(a.page)).runKey).toBeNull();

      await b.page.reload();
      await expectComplete(b.page);
      expect((await results(b.page)).isComplete).toBe(true);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("a run loaded from a file stays when the visitor's live run is cleared", async ({ browser }) => {
    const a = await visit(browser);
    try {
      await pressRun(a.page);
      await expectComplete(a.page);

      // The page saves its run to a file and loads the file back: the run it
      // shows is the file's now, not the feed's.
      const download = a.page.waitForEvent('download');
      await a.page.getByRole('button', { name: 'Open run actions menu' }).click();
      await a.page.getByRole('menuitem', { name: 'Save', exact: true }).click();
      const file = await (await download).path();
      await runMenuButton(a.page).click();
      const chooser = a.page.waitForEvent('filechooser');
      await a.page.getByRole('menuitem', { name: /Load from file/ }).click();
      await (await chooser).setFiles(file);
      await a.page.getByRole('dialog', { name: 'Load simulation' })
        .getByRole('button', { name: /^(Load|Load anyway|Replace current simulation)$/ }).click();
      await expect(a.page.getByRole('dialog', { name: 'Load simulation' })).toHaveCount(0);
      await expect(finishedRun(a.page)).toBeVisible();

      // The visitor's live run goes (another tab's Clear, or the server
      // letting it go): the server tells the page's stream.
      expect((await a.page.request.post('/clear')).ok()).toBe(true);
      await expect.poll(async () => (await results(a.page)).runKey).toBeNull();
      // The run_cleared frame reaches the page within milliseconds; give it
      // time to act before reading what the page still shows.
      await a.page.waitForTimeout(1500);

      await expect(finishedRun(a.page)).toBeVisible();
      await expect(shown(a.page, 'Aria Chen').first()).toBeVisible();
      await expect(emptyStateRun(a.page)).toHaveCount(0);
    } finally {
      await a.context.close();
    }
  });

  test("a person's chat opens with their greeting, as the leader they lived under", async ({ browser }) => {
    const a = await visit(browser);
    try {
      await pressRun(a.page);
      await expectComplete(a.page);
      await a.page.getByRole('tab', { name: 'CHAT', exact: true }).click();
      await a.page.getByRole('button', { name: /Lena Ortiz/ }).first().click();
      await expect(shown(a.page, 'I lived through this simulation').first()).toBeVisible();
    } finally {
      await a.context.close();
    }
  });

  test('above the run cap a visitor is told to wait, and the runs in flight go on', async ({ browser }) => {
    const a = await visit(browser);
    const b = await visit(browser, 'atlas-lab');
    const c = await visit(browser);
    try {
      await pressRun(a.page);
      await pressRun(b.page);
      await expect(shown(b.page, 'Marcus Reinhardt').first()).toBeVisible();
      await pressRun(c.page);
      await expect(shown(c.page, 'running 2 simulations right now, the most it runs at once').first()).toBeVisible();
      await expectComplete(a.page);
      await expectComplete(b.page);
    } finally {
      await a.context.close();
      await b.context.close();
      await c.context.close();
    }
  });
});
